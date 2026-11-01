//! Virtualized WASI 0.2 (specification section 4): the clocks and random bytes of a component's
//! standard library come from the command context, so the journal's tape records them and a
//! replay restores them; stdout and stderr go to the host log under the same per-call cap as the
//! `log` grant; there is no environment, no argument, no stdin, no file and no network.

use std::convert::Infallible;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use afd::CommandContext;
use bytes::Bytes;
use rand::TryRng;
use wasmtime_wasi::cli::{IsTerminal, StdoutStream};
use wasmtime_wasi::p2::{OutputStream, Pollable, StreamResult};
use wasmtime_wasi::{HostMonotonicClock, HostWallClock, WasiCtx, WasiCtxBuilder, async_trait};

use super::super::grants::CallServices;

/// The most random bytes one WASI call may ask for. Each four bytes are one read of the context's
/// random source, and so one entry on the journal tape, so a large request would fill the tape.
const MAX_RANDOM_BYTES: u64 = 64 * 1024;
/// A line longer than this is logged in pieces.
const MAX_LINE_BYTES: usize = 8 * 1024;

/// Wall time is the command context's clock, in milliseconds.
struct ContextWallClock {
    context: CommandContext,
}

impl HostWallClock for ContextWallClock {
    fn resolution(&self) -> Duration {
        Duration::from_millis(1)
    }

    fn now(&self) -> Duration {
        Duration::from_millis(u64::try_from(self.context.clock().now()).unwrap_or(0))
    }
}

/// Monotonic time is nanoseconds since the call's first clock read, from the same clock.
struct ContextMonotonicClock {
    context: CommandContext,
    first: AtomicI64,
}

impl HostMonotonicClock for ContextMonotonicClock {
    fn resolution(&self) -> u64 {
        1_000_000
    }

    fn now(&self) -> u64 {
        let now = self.context.clock().now();
        let first = match self
            .first
            .compare_exchange(i64::MIN, now, Ordering::Relaxed, Ordering::Relaxed)
        {
            Ok(_) => now,
            Err(first) => first,
        };
        u64::try_from(now.saturating_sub(first)).unwrap_or(0) * 1_000_000
    }
}

/// Random bytes from the command context's source: each read of `next()` gives one 32-bit word
/// (`floor(next() * 2^32)`), little-endian. Not secret: the tape records every read.
struct ContextRng {
    context: CommandContext,
}

impl ContextRng {
    fn word(&self) -> u32 {
        let next = self.context.random().next().clamp(0.0, 1.0);
        // `next` is in [0, 1); a value of exactly 1.0 would overflow, so it is held just below.
        (next.min(1.0 - f64::EPSILON) * 4_294_967_296.0) as u32
    }
}

impl TryRng for ContextRng {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        Ok(self.word())
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        let low = u64::from(self.word());
        let high = u64::from(self.word());
        Ok(low | (high << 32))
    }

    fn try_fill_bytes(&mut self, destination: &mut [u8]) -> Result<(), Infallible> {
        for chunk in destination.chunks_mut(4) {
            let word = self.word().to_le_bytes();
            chunk.copy_from_slice(&word[..chunk.len()]);
        }
        Ok(())
    }
}

/// stdout and stderr, line-buffered into the host log.
struct LogSink {
    services: Arc<CallServices>,
    out: Mutex<Vec<u8>>,
    err: Mutex<Vec<u8>>,
}

impl LogSink {
    fn write(&self, stderr: bool, bytes: &[u8]) {
        let Ok(mut buffer) = (if stderr { &self.err } else { &self.out }).lock() else {
            return;
        };
        buffer.extend_from_slice(bytes);
        while let Some(end) = buffer
            .iter()
            .position(|&byte| byte == b'\n')
            .or_else(|| (buffer.len() >= MAX_LINE_BYTES).then_some(MAX_LINE_BYTES - 1))
        {
            let line: Vec<u8> = buffer.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line);
            self.services.wasi_line(stderr, text.trim_end_matches('\n'));
        }
    }

    /// Log what a component wrote without a final newline.
    fn finish(&self) {
        for (stderr, buffer) in [(false, &self.out), (true, &self.err)] {
            if let Ok(mut buffer) = buffer.lock()
                && !buffer.is_empty()
            {
                let text = String::from_utf8_lossy(&buffer).into_owned();
                buffer.clear();
                self.services.wasi_line(stderr, &text);
            }
        }
    }
}

struct LogStream {
    sink: Arc<LogSink>,
    stderr: bool,
}

impl IsTerminal for LogStream {
    fn is_terminal(&self) -> bool {
        false
    }
}

impl StdoutStream for LogStream {
    fn async_stream(&self) -> Box<dyn tokio::io::AsyncWrite + Send + Sync> {
        Box::new(tokio::io::sink())
    }

    fn p2_stream(&self) -> Box<dyn OutputStream> {
        Box::new(Self {
            sink: Arc::clone(&self.sink),
            stderr: self.stderr,
        })
    }
}

impl OutputStream for LogStream {
    fn write(&mut self, bytes: Bytes) -> StreamResult<()> {
        self.sink.write(self.stderr, &bytes);
        Ok(())
    }

    fn flush(&mut self) -> StreamResult<()> {
        Ok(())
    }

    fn check_write(&mut self) -> StreamResult<usize> {
        Ok(MAX_LINE_BYTES)
    }
}

#[async_trait]
impl Pollable for LogStream {
    async fn ready(&mut self) {}
}

/// Flushes what a component wrote to stdout and stderr without a final newline, when its call
/// ends.
pub(super) struct Flush(Arc<LogSink>);

impl Flush {
    pub(super) fn finish(&self) {
        self.0.finish();
    }
}

/// The WASI context of one call and the handle that flushes its output.
pub(super) fn virtualized(services: &Arc<CallServices>) -> (WasiCtx, Flush) {
    {
        let context = services.command_context();
        let sink = Arc::new(LogSink {
            services: Arc::clone(services),
            out: Mutex::new(Vec::new()),
            err: Mutex::new(Vec::new()),
        });
        let mut builder = WasiCtxBuilder::new();
        builder
            .stdout(LogStream {
                sink: Arc::clone(&sink),
                stderr: false,
            })
            .stderr(LogStream {
                sink: Arc::clone(&sink),
                stderr: true,
            })
            .wall_clock(ContextWallClock {
                context: context.clone(),
            })
            .monotonic_clock(ContextMonotonicClock {
                context: context.clone(),
                first: AtomicI64::new(i64::MIN),
            })
            .secure_random(ContextRng {
                context: context.clone(),
            })
            .insecure_random(ContextRng {
                context: context.clone(),
            })
            .max_random_size(MAX_RANDOM_BYTES);
        // The seed is the one value that cannot be read lazily; draw it only when the grant that
        // lets a component import `wasi:random` is held.
        let seed = if services.holds("random") {
            let rng = ContextRng { context };
            (0..4).fold(0u128, |seed, index| {
                seed | (u128::from(rng.word()) << (32 * index))
            })
        } else {
            0
        };
        builder.insecure_random_seed(seed);
        (builder.build(), Flush(sink))
    }
}
