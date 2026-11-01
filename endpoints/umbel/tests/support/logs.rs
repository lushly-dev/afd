//! A tracing subscriber that keeps what the host logs, so a test can look for what a component
//! wrote to stdout, stderr or the `log` grant. One per test binary: it is the global default.
#![allow(
    dead_code,
    unreachable_pub,
    clippy::unwrap_used,
    clippy::expect_used,
    missing_docs
)]

use std::io::Write;
use std::sync::{Mutex, Once};

static BUFFER: Mutex<String> = Mutex::new(String::new());
static INSTALL: Once = Once::new();

struct Capture;

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        BUFFER
            .lock()
            .unwrap()
            .push_str(&String::from_utf8_lossy(bytes));
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Install the capturing subscriber (once per test binary).
pub fn install() {
    INSTALL.call_once(|| {
        let subscriber = tracing_subscriber::fmt()
            .with_writer(|| Capture)
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .finish();
        tracing::subscriber::set_global_default(subscriber).unwrap();
    });
}

/// Every logged line that contains `needle`.
pub fn lines(needle: &str) -> Vec<String> {
    BUFFER
        .lock()
        .unwrap()
        .lines()
        .filter(|line| line.contains(needle))
        .map(str::to_owned)
        .collect()
}
