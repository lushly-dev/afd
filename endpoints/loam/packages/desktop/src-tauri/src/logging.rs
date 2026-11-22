//! Tracing subscriber for Loam's desktop host (#1448).
//!
//! Building `tauri` with `features = ["tracing"]` compiles out Tauri's `eprintln!` in
//! `Webview::on_message`, which otherwise prints the real `__TAURI_INVOKE_KEY__` to stderr whenever
//! any frame posts an IPC message with a wrong key. This subscriber intercepts those `tracing::error!`
//! events by prefix without buffering the expected key or untrusted received value, writes a fixed
//! redacted line to stderr (so desktop suites can still count refusals), and drops all other tracing
//! events.

use std::fmt::{self, Write as _};
use std::io::Write as _;
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Level, Metadata, Subscriber};

/// The fixed, key-free line written to stderr when Tauri refuses an IPC message for its invoke key.
pub const REDACTED_INVOKE_KEY_LINE: &str =
    "__TAURI_INVOKE_KEY__ expected <key> but received <redacted>";

const INVOKE_KEY_PREFIX: &[u8] = b"__TAURI_INVOKE_KEY__ ";

/// Installs Loam's global tracing subscriber once at startup.
///
/// Subsequent calls (for example in tests) are no-ops once a global subscriber is set.
pub fn init() {
    let _ = tracing::subscriber::set_global_default(InvokeKeyRedactingSubscriber::stderr());
}

/// Minimal `tracing::Subscriber` that redacts Tauri's invoke-key refusal and drops everything else.
pub struct InvokeKeyRedactingSubscriber {
    sink: Box<dyn Fn(&str) + Send + Sync>,
}

impl InvokeKeyRedactingSubscriber {
    /// Creates a subscriber that writes redacted refusal lines to `stderr`, ignoring write errors
    /// (such as a closed pipe) so an untrusted subframe triggering refusals cannot panic the host.
    pub fn stderr() -> Self {
        Self::with_sink(|line| {
            let _ = writeln!(std::io::stderr(), "{line}");
        })
    }

    /// Creates a subscriber that delivers redacted refusal lines to a caller-supplied sink.
    pub fn with_sink(sink: impl Fn(&str) + Send + Sync + 'static) -> Self {
        Self {
            sink: Box::new(sink),
        }
    }
}

struct PrefixMatcher {
    matched: bool,
    pos: usize,
}

impl PrefixMatcher {
    fn new() -> Self {
        Self {
            matched: true,
            pos: 0,
        }
    }

    fn is_match(&self) -> bool {
        self.matched && self.pos == INVOKE_KEY_PREFIX.len()
    }
}

impl fmt::Write for PrefixMatcher {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        if !self.matched || self.pos >= INVOKE_KEY_PREFIX.len() {
            return Ok(());
        }
        for &byte in s.as_bytes() {
            if self.pos >= INVOKE_KEY_PREFIX.len() {
                break;
            }
            if byte != INVOKE_KEY_PREFIX[self.pos] {
                self.matched = false;
                break;
            }
            self.pos += 1;
        }
        Ok(())
    }
}

struct InvokeKeyVisitor {
    is_invoke_key_refusal: bool,
}

impl Visit for InvokeKeyVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == "message" && value.as_bytes().starts_with(INVOKE_KEY_PREFIX) {
            self.is_invoke_key_refusal = true;
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if field.name() == "message" {
            let mut matcher = PrefixMatcher::new();
            let _ = write!(&mut matcher, "{value:?}");
            if matcher.is_match() {
                self.is_invoke_key_refusal = true;
            }
        }
    }
}

impl Subscriber for InvokeKeyRedactingSubscriber {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.is_event()
            && *metadata.level() == Level::ERROR
            && metadata.target().starts_with("tauri::")
    }

    fn new_span(&self, _span: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {}

    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}

    fn event(&self, event: &Event<'_>) {
        if !self.enabled(event.metadata()) {
            return;
        }
        let mut visitor = InvokeKeyVisitor {
            is_invoke_key_refusal: false,
        };
        event.record(&mut visitor);
        if visitor.is_invoke_key_refusal {
            (self.sink)(REDACTED_INVOKE_KEY_LINE);
        }
    }

    fn enter(&self, _span: &Id) {}

    fn exit(&self, _span: &Id) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn redacts_tauri_invoke_key_refusal_without_leaking_key_or_payload() {
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured = lines.clone();
        let subscriber = InvokeKeyRedactingSubscriber::with_sink(move |line| {
            captured.lock().unwrap().push(line.to_owned());
        });
        let secret = "real-secret-invoke-key-abcdef123456";
        let hostile = "forged\nFAKE_LOG_LINE";
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(
                target: "tauri::webview",
                "__TAURI_INVOKE_KEY__ expected {secret} but received {hostile}"
            );
        });
        let recorded = lines.lock().unwrap();
        assert_eq!(recorded.as_slice(), &[REDACTED_INVOKE_KEY_LINE]);
        assert!(!recorded[0].contains(secret));
        assert!(!recorded[0].contains("forged"));
        assert!(!recorded[0].contains("FAKE_LOG_LINE"));
    }

    #[test]
    fn drops_unrelated_events() {
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured = lines.clone();
        let subscriber = InvokeKeyRedactingSubscriber::with_sink(move |line| {
            captured.lock().unwrap().push(line.to_owned());
        });
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(target: "tauri::webview", "failed to resolve data directory");
            tracing::info!(target: "tauri::webview", "__TAURI_INVOKE_KEY__ expected k but received x");
            tracing::error!(target: "reqwest::connect", "connection refused");
            tracing::error!(target: "other::crate", "__TAURI_INVOKE_KEY__ expected k but received x");
        });
        assert!(lines.lock().unwrap().is_empty());
    }
}
