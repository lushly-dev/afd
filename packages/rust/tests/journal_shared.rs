#![cfg(feature = "journal-file-shared")]

//! Several sinks, in one process here and in several in `umbel`, appending to one journal file.

use afd::{
    parse_journal, success, CommandContext, CommandDefinition, CommandHandler, CommandParameter,
    CommandRegistry, CommandResult, FileJournalSink, JournalContextDigest, JournalLockError,
    JournalRange, JournalRecord, JournalRecorder, JournalSink,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

fn state_dir(name: &str) -> tempfile_dir::Dir {
    tempfile_dir::Dir::new(name)
}

/// A scratch directory removed on drop (the crate has no `tempfile` dependency).
mod tempfile_dir {
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub struct Dir(PathBuf);

    impl Dir {
        pub fn new(name: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            Self(std::env::temp_dir().join(format!(
                "afd-journal-shared-it-{name}-{}-{n}",
                std::process::id()
            )))
        }

        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

fn sink(dir: &Path) -> FileJournalSink {
    FileJournalSink::shared(dir.join("journal.jsonl"), dir.join("state/lock"))
}

fn record(command: &str) -> JournalRecord {
    JournalRecord {
        timestamp: "2026-01-01T00:00:00.000Z".to_owned(),
        trace_id: None,
        command: command.to_owned(),
        input: json!({}),
        actor: None,
        context_digest: JournalContextDigest {
            hash: "sha256:00".to_owned(),
            interface: None,
        },
        context: None,
        context_omitted: None,
        output_budget: None,
        result: success(json!({})),
        duration_ms: 0.0,
        tape: None,
    }
}

fn seqs(path: &Path) -> Vec<u64> {
    let text = std::fs::read_to_string(path).unwrap();
    parse_journal(&text)
        .unwrap()
        .iter()
        .map(|e| e.seq)
        .collect()
}

fn append_many(sink: FileJournalSink, count: usize, command: &'static str) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    for _ in 0..count {
        runtime.block_on(sink.append(record(command))).unwrap();
    }
}

#[test]
fn two_sinks_appending_at_once_leave_no_gap_or_duplicate() {
    let dir = state_dir("concurrent");
    let path = dir.path().join("journal.jsonl");
    let threads: Vec<_> = ["one", "two"]
        .into_iter()
        .map(|name| {
            let sink = sink(dir.path());
            std::thread::spawn(move || append_many(sink, 100, name))
        })
        .collect();
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(seqs(&path), (1..=200).collect::<Vec<_>>());
}

#[test]
fn a_torn_tail_written_between_appends_is_repaired() {
    use std::io::Write;
    let dir = state_dir("torn");
    let path = dir.path().join("journal.jsonl");
    let (a, b) = (sink(dir.path()), sink(dir.path()));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    assert_eq!(runtime.block_on(a.append(record("a"))).unwrap().seq, 1);
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(b"{\"seq\":2,\"timest")
        .unwrap();
    // A read skips it; the next append, from the other sink, removes it.
    assert_eq!(
        runtime.block_on(a.read(JournalRange::all())).unwrap().len(),
        1
    );
    assert_eq!(runtime.block_on(b.append(record("b"))).unwrap().seq, 2);
    assert_eq!(runtime.block_on(a.append(record("a"))).unwrap().seq, 3);
    assert_eq!(seqs(&path), [1, 2, 3]);
}

#[test]
fn a_held_lock_makes_lock_time_out() {
    let dir = state_dir("timeout");
    let holder = sink(dir.path());
    let waiter = sink(dir.path()).with_lock_timeout(Duration::from_millis(40));
    let held = holder.lock().unwrap();
    match waiter.lock() {
        Err(JournalLockError::Timeout { waited_ms }) => assert!(waited_ms >= 40),
        other => panic!("expected a timeout, got {other:?}"),
    }
    drop(held);
    assert!(waiter.lock().is_ok());
}

#[test]
fn append_locked_with_another_sinks_lock_is_refused() {
    let (one, two) = (state_dir("own"), state_dir("other"));
    let (a, b) = (sink(one.path()), sink(two.path()));
    let lock = b.lock().unwrap();
    let error = a.append_locked(&lock, record("a")).unwrap_err();
    assert!(error.contains("not on this sink's lock file"), "{error}");
    assert!(!one.path().join("journal.jsonl").exists());
    drop(lock);
    let lock = a.lock().unwrap();
    assert_eq!(a.append_locked(&lock, record("a")).unwrap().seq, 1);
}

#[test]
fn read_while_another_sink_appends_never_fails() {
    let dir = state_dir("reading");
    let reader = sink(dir.path());
    let done = Arc::new(AtomicBool::new(false));
    let writer = {
        let sink = sink(dir.path());
        let done = Arc::clone(&done);
        std::thread::spawn(move || {
            append_many(sink, 200, "w");
            done.store(true, Ordering::SeqCst);
        })
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let mut seen = 0;
    while !done.load(Ordering::SeqCst) {
        let entries = runtime.block_on(reader.read(JournalRange::all())).unwrap();
        let numbers: Vec<u64> = entries.iter().map(|e| e.seq).collect();
        assert_eq!(numbers, (1..=numbers.len() as u64).collect::<Vec<_>>());
        assert!(numbers.len() >= seen);
        seen = numbers.len();
    }
    writer.join().unwrap();
    let entries = runtime.block_on(reader.read(JournalRange::all())).unwrap();
    assert_eq!(entries.len(), 200);
}

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

#[tokio::test]
async fn a_recorder_over_a_shared_sink_records_calls() {
    let dir = state_dir("recorder");
    let registry = CommandRegistry::new();
    registry
        .register(CommandDefinition::new(
            "note-echo",
            "Echo",
            vec![CommandParameter::optional_string("note", "A note")],
            Echo,
        ))
        .unwrap();
    registry.set_journal(JournalRecorder::new(Arc::new(sink(dir.path()))));
    for _ in 0..3 {
        assert!(
            registry
                .execute("note-echo", json!({"note": "hi"}), None)
                .await
                .success
        );
    }
    assert_eq!(seqs(&dir.path().join("journal.jsonl")), [1, 2, 3]);
}

#[test]
fn the_lock_is_held_across_appends_to_other_files() {
    // The seam a host uses to keep a second file in journal order.
    let dir = state_dir("across");
    let sink = sink(dir.path());
    let lock = sink.lock().unwrap();
    let first = sink.append_locked(&lock, record("a")).unwrap();
    let second = sink.append_locked(&lock, record("b")).unwrap();
    assert_eq!((first.seq, second.seq), (1, 2));
    let other: PathBuf = dir.path().join("journal.jsonl");
    assert_eq!(seqs(&other), [1, 2]);
}
