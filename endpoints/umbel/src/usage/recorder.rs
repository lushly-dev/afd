//! The recorder: usage events leave the request path here (phase 5 section 12.3).
//!
//! A request hands its record to [`Recorder::submit`], which never waits and never fails: the
//! record joins a queue that one writer thread per HTTP surface drains into the store, in
//! batches, off the async runtime. A request is answered whether its record is written, waits,
//! or is dropped.
//!
//! **Bounded, and fair.** The queue holds at most [`Limits::total`] records and at most
//! [`Limits::per_principal`] of any one principal (the records of requests refused before their
//! caller was known share one budget), counted from submission until the writer has written or
//! failed them. A record past either bound is dropped and counted. So one caller's flood, however
//! fast, drops only that caller's own records: another's is dropped only when the store itself
//! stalls or fails, or when as many principals as the total holds are all at their own bound,
//! which says the store is behind for everyone, never who was busy.
//!
//! **Counted drops.** Every dropped record, and every record of a batch the store failed to
//! append, adds one to the drop count, which the next append that succeeds writes to the store
//! (only the operator and `usage.readers` read it) and a warning names in the log, at most once a
//! minute.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use crate::shared::usage::{DAY_MS, UsageStore};

/// How many records one append writes at most.
const BATCH: usize = 256;
/// How often an idle writer purges what passed the retention.
const PURGE_EVERY: Duration = Duration::from_secs(3600);
/// How often a warning about drops is logged at most.
const WARN_EVERY_MS: i64 = 60_000;

/// The queue's bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Limits {
    /// Records queued and being written, everyone's together.
    pub(crate) total: usize,
    /// Records queued and being written, of one principal.
    pub(crate) per_principal: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            total: 8192,
            per_principal: 512,
        }
    }
}

/// What the writer is handed: a `usage-event.v1` record, and the principal it is counted for
/// (`""` for a request refused before its caller was known).
pub(crate) struct Entry {
    pub(crate) record: Value,
    pub(crate) owner: String,
}

/// A stall a test puts before every append, with the batch's size: it may wait, or fail the
/// batch. **Test seam** (`testkit` only).
pub(crate) type Stall = Arc<dyn Fn(usize) -> Result<(), String> + Send + Sync>;

/// The records counted against the bounds.
#[derive(Default)]
struct Held {
    total: usize,
    by_owner: HashMap<String, usize>,
}

struct Shared {
    limits: Limits,
    held: Mutex<Held>,
    dropped: AtomicU64,
    last_warning_ms: AtomicI64,
}

impl Shared {
    fn hold(&self, owner: &str) -> bool {
        let mut held = self
            .held
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let own = held.by_owner.get(owner).copied().unwrap_or(0);
        if held.total >= self.limits.total || own >= self.limits.per_principal {
            return false;
        }
        held.total += 1;
        *held.by_owner.entry(owner.to_owned()).or_insert(0) += 1;
        true
    }

    fn release(&self, owners: impl Iterator<Item = String>) {
        let mut held = self
            .held
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for owner in owners {
            held.total = held.total.saturating_sub(1);
            if let Some(count) = held.by_owner.get_mut(&owner) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    held.by_owner.remove(&owner);
                }
            }
        }
    }

    fn count_dropped(&self, records: u64) {
        self.dropped.fetch_add(records, Ordering::SeqCst);
        let now = crate::shared::nonces::now_ms();
        let last = self.last_warning_ms.load(Ordering::SeqCst);
        if now.saturating_sub(last) >= WARN_EVERY_MS
            && self
                .last_warning_ms
                .compare_exchange(last, now, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        {
            tracing::warn!(
                target: "umbel::usage",
                dropped = self.dropped.load(Ordering::SeqCst),
                "usage records were dropped: the usage store is behind or failing; the count is kept and written with the next append"
            );
        }
    }
}

/// One HTTP surface's recorder. Dropping it ends its writer once the queue is drained.
pub(crate) struct Recorder {
    sender: Mutex<Sender<Entry>>,
    shared: Arc<Shared>,
}

impl std::fmt::Debug for Recorder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Recorder").finish_non_exhaustive()
    }
}

/// Everything the writer thread needs.
pub(crate) struct Writer {
    pub(crate) store: Arc<dyn UsageStore>,
    pub(crate) clock: Arc<dyn afd::Clock>,
    pub(crate) retention_days: u64,
    pub(crate) stall: Option<Stall>,
}

impl Writer {
    fn keep_from(&self, now_ms: i64) -> i64 {
        let days = i64::try_from(self.retention_days).unwrap_or(i64::MAX);
        now_ms.saturating_sub(days.saturating_mul(DAY_MS))
    }

    /// Purge everything past the retention, a batch at a time.
    fn purge(&self) {
        loop {
            let now = self.clock.now();
            match self.store.purge(self.keep_from(now)) {
                Ok(purged)
                    if purged >= u64::try_from(crate::shared::usage::PURGE_BATCH).unwrap_or(0) => {}
                Ok(_) => return,
                Err(error) => {
                    tracing::warn!(target: "umbel::usage", ?error, "purging usage records past their retention failed; the next append or purge tries again");
                    return;
                }
            }
        }
    }

    /// Fill in a task poll's command and space from its task's creation, as its owner recorded
    /// it, in this batch or before.
    fn complete(&self, batch: &mut [Entry]) {
        for index in 0..batch.len() {
            let (head, rest) = batch.split_at_mut(index);
            let record = &mut rest[0].record;
            let poll = matches!(
                record["method"].as_str(),
                Some("tasks/get" | "tasks/update" | "tasks/cancel")
            ) && record["outcome"] == "ok";
            let (Some(task), Some(principal), Some(actor)) = (
                record["task"].as_str(),
                record["principal"].as_str(),
                record["actor"].as_str(),
            ) else {
                continue;
            };
            if !poll {
                continue;
            }
            let earlier = head.iter().find(|entry| {
                entry.record["method"] == "tools/call"
                    && entry.record["task"].as_str() == Some(task)
                    && entry.record["principal"].as_str() == Some(principal)
                    && entry.record["actor"].as_str() == Some(actor)
            });
            let found = match earlier {
                Some(entry) => Some((
                    entry.record["command"].as_str().map(str::to_owned),
                    entry.record["space"].as_str().map(str::to_owned),
                )),
                None => self.store.creation(task, principal, actor).unwrap_or(None),
            };
            if let Some((command, space)) = found {
                record["command"] = command.map_or(Value::Null, Value::String);
                record["space"] = space.map_or(Value::Null, Value::String);
            }
        }
    }

    fn run(self, receiver: Receiver<Entry>, shared: Arc<Shared>) {
        self.purge();
        loop {
            let first = match receiver.recv_timeout(PURGE_EVERY) {
                Ok(entry) => entry,
                Err(RecvTimeoutError::Timeout) => {
                    self.purge();
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return,
            };
            let mut batch = vec![first];
            while batch.len() < BATCH {
                match receiver.try_recv() {
                    Ok(entry) => batch.push(entry),
                    Err(_) => break,
                }
            }
            self.complete(&mut batch);
            let mut invalid = 0u64;
            let records: Vec<Value> = batch
                .iter()
                .filter_map(|entry| {
                    if super::valid(&entry.record) {
                        Some(entry.record.clone())
                    } else {
                        invalid += 1;
                        None
                    }
                })
                .collect();
            if invalid > 0 {
                tracing::error!(target: "umbel::usage", invalid, "usage records the schema refuses were dropped");
                shared.count_dropped(invalid);
            }
            let stalled = self
                .stall
                .as_ref()
                .map_or(Ok(()), |stall| stall(records.len()));
            let dropped = shared.dropped.swap(0, Ordering::SeqCst);
            let now = self.clock.now();
            let written = stalled.map_err(|message| crate::shared::SharedError::Failed {
                store: crate::shared::usage::STORE,
                message,
            });
            let written = written.and_then(|()| {
                self.store
                    .append(&records, dropped, now, self.keep_from(now))
            });
            if let Err(error) = written {
                tracing::warn!(target: "umbel::usage", ?error, records = records.len(), "appending usage records failed; they are counted as dropped");
                shared.dropped.fetch_add(dropped, Ordering::SeqCst);
                shared.count_dropped(records.len() as u64);
            }
            shared.release(batch.into_iter().map(|entry| entry.owner));
        }
    }
}

impl Recorder {
    /// A recorder whose writer thread runs `writer`.
    pub(crate) fn start(writer: Writer, limits: Limits) -> Arc<Self> {
        let (sender, receiver) = std::sync::mpsc::channel();
        let shared = Arc::new(Shared {
            limits,
            held: Mutex::new(Held::default()),
            dropped: AtomicU64::new(0),
            last_warning_ms: AtomicI64::new(i64::MIN / 2),
        });
        let thread_shared = Arc::clone(&shared);
        let spawned = std::thread::Builder::new()
            .name("umbel-usage".to_owned())
            .spawn(move || writer.run(receiver, thread_shared));
        if let Err(error) = spawned {
            tracing::error!(target: "umbel::usage", %error, "the usage writer could not start; every usage record is dropped and counted");
        }
        Arc::new(Self {
            sender: Mutex::new(sender),
            shared,
        })
    }

    /// Queue `entry` for the writer, or drop and count it. Never waits on the store.
    pub(crate) fn submit(&self, entry: Entry) {
        if !self.shared.hold(&entry.owner) {
            self.shared.count_dropped(1);
            return;
        }
        let owner = entry.owner.clone();
        let sent = self
            .sender
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .send(entry);
        if sent.is_err() {
            self.shared.release(std::iter::once(owner));
            self.shared.count_dropped(1);
        }
    }

    /// The records queued or being written.
    #[cfg(test)]
    pub(crate) fn held(&self) -> usize {
        self.shared
            .held
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .total
    }

    /// The records dropped and not yet written to the store.
    #[cfg(test)]
    pub(crate) fn unwritten_drops(&self) -> u64 {
        self.shared.dropped.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::shared::SharedError;
    use crate::shared::usage::{UsagePage, UsageQuery};
    use std::sync::Condvar;

    /// A store that keeps what it is given, after an optional gate opens.
    #[derive(Default)]
    struct Kept {
        records: Mutex<Vec<Value>>,
        dropped: AtomicU64,
    }

    impl UsageStore for Kept {
        fn append(
            &self,
            records: &[Value],
            dropped: u64,
            _: i64,
            _: i64,
        ) -> Result<(), SharedError> {
            self.records.lock().unwrap().extend_from_slice(records);
            self.dropped.fetch_add(dropped, Ordering::SeqCst);
            Ok(())
        }
        fn creation(
            &self,
            _: &str,
            _: &str,
            _: &str,
        ) -> Result<Option<crate::shared::usage::Creation>, SharedError> {
            Ok(None)
        }
        fn list(&self, _: &UsageQuery) -> Result<UsagePage, SharedError> {
            Ok(UsagePage::default())
        }
        fn dropped(&self, _: i64) -> Result<u64, SharedError> {
            Ok(self.dropped.load(Ordering::SeqCst))
        }
        fn purge(&self, _: i64) -> Result<u64, SharedError> {
            Ok(0)
        }
    }

    fn record(n: usize, principal: &str) -> Value {
        serde_json::json!({
            "version": 1, "id": format!("u-{}", crate::auth::caller::base32(&(n as u128).to_be_bytes())),
            "at": "2026-11-03T10:00:00.000Z", "trace": null,
            "principal": principal, "actor": principal, "namespace": null,
            "transport": "http", "method": "tools/list", "tool": null,
            "command": null, "space": null, "outcome": "ok",
            "bytesIn": 1, "bytesOut": 2, "durationMs": 3, "task": null,
        })
    }

    /// A gate the writer waits at before every append until it opens.
    #[derive(Default)]
    struct Gate {
        open: Mutex<bool>,
        changed: Condvar,
        waiting: AtomicU64,
    }

    impl Gate {
        fn wait(&self) {
            self.waiting.fetch_add(1, Ordering::SeqCst);
            let mut open = self.open.lock().unwrap();
            while !*open {
                open = self.changed.wait(open).unwrap();
            }
        }
        fn open(&self) {
            *self.open.lock().unwrap() = true;
            self.changed.notify_all();
        }
    }

    fn eventually(mut condition: impl FnMut() -> bool) {
        for _ in 0..3000 {
            if condition() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("the condition never held");
    }

    #[test]
    fn a_stalled_store_drops_only_the_flooding_principal_s_records_and_counts_them() {
        let store = Arc::new(Kept::default());
        let gate = Arc::new(Gate::default());
        let stall: Stall = {
            let gate = Arc::clone(&gate);
            Arc::new(move |_| {
                gate.wait();
                Ok(())
            })
        };
        let recorder = Recorder::start(
            Writer {
                store: Arc::clone(&store) as Arc<dyn UsageStore>,
                clock: Arc::new(afd::fixed_clock(0)),
                retention_days: 400,
                stall: Some(stall),
            },
            Limits {
                total: 100,
                per_principal: 4,
            },
        );
        for n in 0..10 {
            recorder.submit(Entry {
                record: record(n, "human:ada"),
                owner: "human:ada".into(),
            });
        }
        // Ada's bound is 4, whatever the writer holds: 6 dropped, at once.
        assert_eq!(recorder.unwritten_drops(), 6);
        for n in 10..13 {
            recorder.submit(Entry {
                record: record(n, "human:bo"),
                owner: "human:bo".into(),
            });
        }
        assert_eq!(
            recorder.unwritten_drops(),
            6,
            "bo's records are not dropped"
        );
        eventually(|| gate.waiting.load(Ordering::SeqCst) >= 1);
        gate.open();
        eventually(|| store.records.lock().unwrap().len() == 7);
        // The drops are written with an append; ada's bound is hers again once hers are written.
        eventually(|| recorder.held() == 0);
        recorder.submit(Entry {
            record: record(20, "human:ada"),
            owner: "human:ada".into(),
        });
        eventually(|| store.records.lock().unwrap().len() == 8);
        assert_eq!(store.dropped.load(Ordering::SeqCst), 6);
        assert_eq!(recorder.unwritten_drops(), 0);
    }

    #[test]
    fn a_failing_store_counts_its_batches_as_dropped() {
        let store = Arc::new(Kept::default());
        let failing = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let attempted = Arc::new(AtomicU64::new(0));
        let stall: Stall = {
            let (failing, attempted) = (Arc::clone(&failing), Arc::clone(&attempted));
            Arc::new(move |size| {
                if failing.load(Ordering::SeqCst) {
                    attempted.fetch_add(size as u64, Ordering::SeqCst);
                    Err("the disk is full".into())
                } else {
                    Ok(())
                }
            })
        };
        let recorder = Recorder::start(
            Writer {
                store: Arc::clone(&store) as Arc<dyn UsageStore>,
                clock: Arc::new(afd::fixed_clock(0)),
                retention_days: 400,
                stall: Some(stall),
            },
            Limits::default(),
        );
        for n in 0..5 {
            recorder.submit(Entry {
                record: record(n, "human:ada"),
                owner: "human:ada".into(),
            });
        }
        eventually(|| attempted.load(Ordering::SeqCst) == 5);
        failing.store(false, Ordering::SeqCst);
        recorder.submit(Entry {
            record: record(9, "human:ada"),
            owner: "human:ada".into(),
        });
        eventually(|| store.records.lock().unwrap().len() == 1);
        assert_eq!(store.dropped.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn a_record_the_schema_refuses_is_dropped_not_written() {
        let store = Arc::new(Kept::default());
        let recorder = Recorder::start(
            Writer {
                store: Arc::clone(&store) as Arc<dyn UsageStore>,
                clock: Arc::new(afd::fixed_clock(0)),
                retention_days: 400,
                stall: None,
            },
            Limits::default(),
        );
        let mut bad = record(1, "human:ada");
        bad["query"] = serde_json::json!("canary text");
        recorder.submit(Entry {
            record: bad,
            owner: "human:ada".into(),
        });
        recorder.submit(Entry {
            record: record(2, "human:ada"),
            owner: "human:ada".into(),
        });
        eventually(|| store.records.lock().unwrap().len() == 1);
        assert!(
            !serde_json::to_string(&*store.records.lock().unwrap())
                .unwrap()
                .contains("canary")
        );
    }
}
