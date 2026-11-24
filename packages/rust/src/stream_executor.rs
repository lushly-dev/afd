//! The stream executor: [`execute_stream`] and [`CommandRegistry::execute_stream`], as
//! TypeScript's `executeStream` (`packages/core/src/command-execution.ts`) behaves.
//!
//! This is not incremental streaming. The command runs once, to completion, through
//! [`CommandRegistry::execute`]'s checks (exposure, context, validation, middleware and approval
//! all apply), and the chunks are made from its result afterwards, on demand: an array is one data
//! chunk per item, any other data one data chunk, then a complete chunk; a failure is one error
//! chunk. No progress chunks are made. A streamed command's output budget is not checked
//! (`spec/output-budgets.md`, B7), as in TypeScript and C++.
//!
//! The call's cancellation signal ([`CommandContext::with_cancellation`]) stops the stream with
//! `STREAM_ABORTED` before the command runs, after it, or before a data chunk; once the last data
//! chunk is sent, the complete chunk follows whatever the signal does.
//! [`StreamExecutorOptions::timeout_ms`] gives the command a child of that signal, fires it when
//! the deadline passes and ends the stream with `STREAM_TIMEOUT`, even if the command ignores the
//! signal. Dropping the stream stops it too.

use std::collections::VecDeque;

use futures_util::stream::{self, BoxStream, StreamExt};
use serde_json::Value;

use crate::cancellation::CancellationSignal;
use crate::commands::{elapsed_ms, CommandContext, CommandRegistry};
use crate::errors::{error_codes, CommandError};
use crate::streaming::{
    create_complete_chunk, create_data_chunk, create_error_chunk, CompleteChunk, ErrorChunk,
    StreamChunk,
};
use crate::time::Instant;

/// Options for [`execute_stream`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct StreamExecutorOptions {
    /// A deadline for the whole stream, in milliseconds. When it passes, the command's
    /// cancellation signal fires and the stream ends with a `STREAM_TIMEOUT` error chunk, even if
    /// the command ignores the signal. `0` is a deadline that has already passed, so the stream
    /// always times out (in TypeScript, a command that finishes at once usually wins that race;
    /// unlike `CommandContext::timeout_ms`, where `0` means none); a deadline too far
    /// away to represent is none. Needs the `native` feature. Default: no deadline.
    pub timeout_ms: Option<u64>,
}

impl StreamExecutorOptions {
    /// No deadline.
    pub fn new() -> Self {
        Self::default()
    }

    /// End the stream with `STREAM_TIMEOUT` after `timeout_ms` milliseconds.
    pub fn with_timeout_ms(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }
}

impl CommandRegistry {
    /// Execute a command and stream its result: [`execute_stream`] on this registry.
    pub fn execute_stream<'a>(
        &'a self,
        name: &'a str,
        input: Value,
        context: Option<CommandContext>,
        options: StreamExecutorOptions,
    ) -> BoxStream<'a, StreamChunk<Value>> {
        execute_stream(self, name, input, context, options)
    }
}

/// Where the stream stopped, for the error chunk's message and `resumeFrom`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Starting,
    Execution,
    Data,
}

/// What stops the stream: the caller's signal, and the deadline with the signal it fires.
struct Stop {
    caller: Option<CancellationSignal>,
    deadline: Option<Deadline>,
}

struct Deadline {
    at: Instant,
    timeout_ms: u64,
    signal: CancellationSignal,
}

impl Stop {
    /// The error chunk that ends the stream now, if anything stops it: the deadline first, then
    /// the caller's signal.
    fn check(&self, phase: Phase, emitted: usize) -> Option<ErrorChunk> {
        if let Some(deadline) = &self.deadline {
            if Instant::now() >= deadline.at {
                deadline.signal.cancel();
                return Some(timeout_chunk(deadline.timeout_ms, emitted, phase));
            }
        }
        self.caller
            .as_ref()
            .filter(|signal| signal.is_cancelled())
            .map(|_| aborted_chunk(phase, emitted))
    }
}

fn aborted_chunk(phase: Phase, emitted: usize) -> ErrorChunk {
    let message = match phase {
        Phase::Starting => "Stream was aborted before starting",
        Phase::Execution => "Stream was aborted during execution",
        Phase::Data => "Stream was aborted",
    };
    let error = CommandError::new(error_codes::STREAM_ABORTED, message)
        .with_suggestion("Start the stream again if the result is still needed")
        .with_retryable(true);
    resumable(create_error_chunk(error, emitted, true), phase, emitted)
}

fn timeout_chunk(timeout_ms: u64, emitted: usize, phase: Phase) -> ErrorChunk {
    let error = CommandError::new(
        error_codes::STREAM_TIMEOUT,
        format!("Stream timed out after {timeout_ms}ms"),
    )
    .with_suggestion("Increase the stream timeout, or request less data, and retry")
    .with_retryable(true);
    resumable(create_error_chunk(error, emitted, true), phase, emitted)
}

/// In the data phase, the stream can resume after the chunks already sent.
fn resumable(chunk: ErrorChunk, phase: Phase, emitted: usize) -> ErrorChunk {
    if phase == Phase::Data {
        chunk.with_resume_from(emitted)
    } else {
        chunk
    }
}

/// The stream's state between chunks.
enum State<'a> {
    Start {
        registry: &'a CommandRegistry,
        name: &'a str,
        input: Value,
        context: Box<CommandContext>,
        timeout_ms: Option<u64>,
    },
    Data(Box<DataState>),
    Done,
}

/// The successful result being sent, one chunk at a time.
struct DataState {
    items: VecDeque<Value>,
    total: usize,
    emitted: usize,
    complete: CompleteChunk<Value>,
    started: Instant,
    stop: Stop,
}

impl DataState {
    /// The next chunk: the next item (or an error if the signal or the deadline stops the stream
    /// before it), else the complete chunk.
    fn advance<'a>(mut self: Box<Self>) -> (StreamChunk<Value>, State<'a>) {
        match self.items.pop_front() {
            Some(item) => {
                // Before each data chunk, as TypeScript and C++ check; never before the complete
                // chunk, so a stream whose items were all sent completes.
                if let Some(chunk) = self.stop.check(Phase::Data, self.emitted) {
                    return (StreamChunk::Error(chunk), State::Done);
                }
                let is_last = self.emitted + 1 == self.total;
                let chunk = create_data_chunk(item, self.emitted, is_last);
                self.emitted += 1;
                (StreamChunk::Data(chunk), State::Data(self))
            }
            None => {
                let state = *self;
                let complete = CompleteChunk {
                    total_chunks: state.emitted,
                    total_duration_ms: elapsed_ms(state.started),
                    ..state.complete
                };
                (StreamChunk::Complete(complete), State::Done)
            }
        }
    }
}

/// Execute `name` once through [`CommandRegistry::execute`] with `context`, and stream its
/// result: one data chunk per array item (or one for any other data), then a complete chunk with
/// the result's confidence, reasoning and metadata, or a single error chunk for a failure
/// (`recoverable` when the error is retryable). See the [module](self) for cancellation and the
/// deadline.
pub fn execute_stream<'a>(
    registry: &'a CommandRegistry,
    name: &'a str,
    input: Value,
    context: Option<CommandContext>,
    options: StreamExecutorOptions,
) -> BoxStream<'a, StreamChunk<Value>> {
    let start = State::Start {
        registry,
        name,
        input,
        context: Box::new(context.unwrap_or_default()),
        timeout_ms: options.timeout_ms,
    };
    stream::unfold(start, |state| async move {
        match state {
            State::Start {
                registry,
                name,
                input,
                context,
                timeout_ms,
            } => Some(run(registry, name, input, *context, timeout_ms).await),
            State::Data(data) => Some(data.advance()),
            State::Done => None,
        }
    })
    .boxed()
}

/// The first chunk, and the state after it: run the command, or stop before it.
async fn run<'a>(
    registry: &'a CommandRegistry,
    name: &'a str,
    input: Value,
    mut context: CommandContext,
    timeout_ms: Option<u64>,
) -> (StreamChunk<Value>, State<'a>) {
    let started = Instant::now();
    let caller = context.cancellation().cloned();
    if caller
        .as_ref()
        .is_some_and(CancellationSignal::is_cancelled)
    {
        let chunk = aborted_chunk(Phase::Starting, 0);
        return (StreamChunk::Error(chunk), State::Done);
    }
    let deadline = match timeout_ms {
        Some(timeout_ms) => {
            if !cfg!(feature = "native") {
                let error = CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Stream timeouts require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout_ms from the options")
                .with_retryable(false);
                return (
                    StreamChunk::Error(create_error_chunk(error, 0, false)),
                    State::Done,
                );
            }
            // The command gets a child of the caller's signal: the deadline fires it, and the
            // caller's own signal is never fired by the deadline.
            let signal = caller
                .as_ref()
                .map_or_else(CancellationSignal::new, CancellationSignal::child);
            context = context.with_cancellation(signal.clone());
            started
                .checked_add(std::time::Duration::from_millis(timeout_ms))
                .map(|at| Deadline {
                    at,
                    timeout_ms,
                    signal,
                })
        }
        None => None,
    };
    let stop = Stop { caller, deadline };

    let call = registry.execute_with_budget(name, input, Some(context), false);
    let result = match &stop.deadline {
        #[cfg(feature = "native")]
        Some(deadline) => {
            let left = deadline.at.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left, call).await {
                Ok(result) => result,
                Err(_) => {
                    // The command ignored the signal: the deadline ends the wait.
                    deadline.signal.cancel();
                    let chunk = timeout_chunk(deadline.timeout_ms, 0, Phase::Execution);
                    return (StreamChunk::Error(chunk), State::Done);
                }
            }
        }
        _ => call.await,
    };

    if let Some(chunk) = stop.check(Phase::Execution, 0) {
        return (StreamChunk::Error(chunk), State::Done);
    }
    if !result.success {
        let error = result.error.unwrap_or_else(|| {
            CommandError::new(error_codes::COMMAND_FAILED, "Command execution failed")
                .with_suggestion("Check the command input and try again")
        });
        let recoverable = error.retryable.unwrap_or(false);
        let chunk = create_error_chunk(error, 0, recoverable);
        return (StreamChunk::Error(chunk), State::Done);
    }

    let mut complete = create_complete_chunk(0, 0.0);
    complete.confidence = result.confidence;
    complete.reasoning = result.reasoning;
    complete.metadata = result.metadata;
    let items: VecDeque<Value> = match result.data {
        Some(Value::Array(items)) => items.into(),
        Some(data) => VecDeque::from([data]),
        None => VecDeque::from([Value::Null]),
    };
    Box::new(DataState {
        total: items.len(),
        items,
        emitted: 0,
        complete,
        started,
        stop,
    })
    .advance()
}

#[cfg(test)]
mod tests;
