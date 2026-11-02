//! What a call did to the stores, kept for the plugin gate (phase 2 specification, section 3.3,
//! rules 6 and 8).
//!
//! The services of a call record the revisions it wrote and whether it touched a store or a
//! file; the plugin gate reads the record after the handler returns and sets
//! `dev.umbel/changes` and `dev.umbel/replay`. The two meet by the call's trace id: a middleware
//! cannot change what a handler sees, so the context cannot carry the record. Every surface sets
//! a trace id; two concurrent calls that share (or both lack) one would share a record, which
//! affects only the event's `changes` range and the replay stamp.

use std::collections::HashMap;
use std::sync::Mutex;

/// What one call did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CallRecord {
    /// Whether the call used a store, the content grant or `as_reader`: replay returns the
    /// journaled result and never re-runs the handler against a different store.
    pub(crate) used: bool,
    /// The lowest revision the call wrote.
    pub(crate) from_rev: u64,
    /// The highest.
    pub(crate) to_rev: u64,
    /// How many revisions it wrote.
    pub(crate) count: u64,
}

/// The records of the calls in flight, by trace id.
#[derive(Debug, Default)]
pub(crate) struct Ledger {
    calls: Mutex<HashMap<String, CallRecord>>,
}

impl Ledger {
    fn with(&self, trace: &str, change: impl FnOnce(&mut CallRecord)) {
        if let Ok(mut calls) = self.calls.lock() {
            change(calls.entry(trace.to_owned()).or_default());
        }
    }

    /// The call used a store, a file or another principal's view.
    pub(crate) fn note_use(&self, trace: &str) {
        self.with(trace, |record| record.used = true);
    }

    /// The call wrote revision `rev`.
    pub(crate) fn note_write(&self, trace: &str, rev: u64) {
        self.with(trace, |record| {
            record.used = true;
            record.from_rev = if record.count == 0 {
                rev
            } else {
                record.from_rev.min(rev)
            };
            record.to_rev = record.to_rev.max(rev);
            record.count += 1;
        });
    }

    /// Take (and forget) the record of the call `trace`.
    pub(crate) fn take(&self, trace: &str) -> CallRecord {
        self.calls
            .lock()
            .ok()
            .and_then(|mut calls| calls.remove(trace))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_make_a_range_and_a_count_and_take_forgets() {
        let ledger = Ledger::default();
        assert_eq!(ledger.take("t"), CallRecord::default());
        ledger.note_write("t", 7);
        ledger.note_write("t", 5);
        ledger.note_write("t", 9);
        ledger.note_use("u");
        assert_eq!(
            ledger.take("t"),
            CallRecord {
                used: true,
                from_rev: 5,
                to_rev: 9,
                count: 3
            }
        );
        assert_eq!(ledger.take("t"), CallRecord::default());
        assert!(ledger.take("u").used);
    }
}
