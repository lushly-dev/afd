//! Several host processes on one workspace (decision D29; specification sections 2, 6 and 10,
//! `multi_process.rs`).
//!
//! The in-process cases seal two `Host`s on one workspace: each takes the workspace lock on its
//! own file handle, so the OS lock really excludes. The last case runs the built binary.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod support;

use afd::{JournalRange, JournalSink};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Barrier, Mutex};
use support::*;
use umbel::{Host, HostBuilder};

fn sealed(dir: &Path) -> Host {
    HostBuilder::open(dir)
        .unwrap()
        .register(remember("note-remember"))
        .seal()
        .unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_hosts_interleave_two_hundred_mutations_without_a_gap() {
    let dir = two_spaces();
    let hosts = [Arc::new(sealed(dir.path())), Arc::new(sealed(dir.path()))];
    let finished = Arc::new(AtomicBool::new(false));

    // A reader beside the writers: it never fails, whatever line is in flight.
    let reader = {
        let (host, finished) = (Arc::clone(&hosts[0]), Arc::clone(&finished));
        let path = dir.path().to_path_buf();
        tokio::spawn(async move {
            let mut reads = 0u32;
            while !finished.load(Ordering::SeqCst) {
                let journal = host
                    .workspace()
                    .journal_sink()
                    .read(JournalRange::all())
                    .await;
                journal.expect("the journal reader tolerates a torn last line");
                for space in ["main", "second"] {
                    // Complete lines only, each parsing as JSON.
                    let text =
                        std::fs::read_to_string(events_path(&path, space)).unwrap_or_default();
                    let complete = text.rfind('\n').map_or("", |end| &text[..=end]);
                    for line in complete.lines() {
                        serde_json::from_str::<Value>(line).unwrap();
                    }
                }
                let listed = call(
                    &host,
                    agent("reader"),
                    "event-list",
                    json!({"space": "main"}),
                )
                .await;
                assert!(listed.success, "{listed:?}");
                reads += 1;
            }
            reads
        })
    };

    let mut writers = Vec::new();
    for index in 0..200usize {
        let host = Arc::clone(&hosts[index % 2]);
        writers.push(tokio::spawn(async move {
            let space = if index % 3 == 0 { "second" } else { "main" };
            let result = call(
                &host,
                agent("writer"),
                "note-remember",
                json!({"space": space, "text": format!("r{index}")}),
            )
            .await;
            assert!(result.success, "{result:?}");
        }));
    }
    for writer in writers {
        writer.await.unwrap();
    }
    finished.store(true, Ordering::SeqCst);
    assert!(reader.await.unwrap() > 0);

    let journal = journal_entries(dir.path());
    let seqs: Vec<u64> = journal.iter().map(|entry| entry.seq).collect();
    assert_eq!(
        seqs,
        (1..=journal.len() as u64).collect::<Vec<_>>(),
        "no gap, no duplicate"
    );
    assert_eq!(
        journal
            .iter()
            .filter(|e| e.command == "note-remember")
            .count(),
        200
    );

    let mut total = 0;
    for space in ["main", "second"] {
        let stream = events(dir.path(), space);
        total += stream.len();
        let mut last_journal = 0;
        for (index, event) in stream.iter().enumerate() {
            assert_eq!(event["seq"], index as u64 + 1, "{space}");
            let journal_seq = event["journalSeq"].as_u64().unwrap();
            assert!(journal_seq > last_journal, "{space}: journalSeq increases");
            last_journal = journal_seq;
        }
    }
    assert_eq!(total, 200);
    assert!(!dir.path().join("state/projection.pending").exists());
    let doctor = call(&hosts[1], agent("r"), "workspace-doctor", json!({})).await;
    assert!(doctor.success, "{doctor:?}");
}

/// Captures what `tracing` writes on this thread.
#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<u8>>>);

impl Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn a_lock_held_past_the_timeout_fails_a_rebuild_and_only_logs_for_a_mutation() {
    let dir = workspace("config_version = 1\n[journal]\nlock_timeout_ms = 100\n");
    let host = sealed(dir.path());
    call(
        &host,
        agent("w"),
        "note-remember",
        json!({"text": "before"}),
    )
    .await;

    let captured = Captured::default();
    let writer = captured.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    let lock = host.workspace().lock().unwrap();
    let rebuilt = host
        .cli_client()
        .call("event-rebuild", json!({}), None)
        .await;
    let error = rebuilt.error.expect("the rebuild cannot take the lock");
    assert_eq!(error.code, "WORKSPACE_LOCK_TIMEOUT");
    assert!(error.suggestion.unwrap().contains("umbel event rebuild"));
    assert_eq!(error.retryable, Some(true));

    let result = call(
        &host,
        agent("w"),
        "note-remember",
        json!({"text": "during"}),
    )
    .await;
    assert!(result.success, "a sink failure never changes the result");
    drop(lock);

    let log = String::from_utf8(captured.0.lock().unwrap().clone()).unwrap();
    assert!(log.contains("ERROR"), "{log}");
    assert!(log.contains("WORKSPACE_LOCK_TIMEOUT"), "{log}");
    assert!(log.contains("command note-remember"), "{log}");
    assert!(log.contains("trace "), "{log}");
    drop(_guard);

    // Neither the entry nor its event was written; the next call works.
    let commands: Vec<String> = journal_entries(dir.path())
        .iter()
        .map(|entry| entry.command.clone())
        .collect();
    assert_eq!(commands, ["note-remember"]);
    assert_eq!(events(dir.path(), "main").len(), 1);
    let after = call(&host, agent("w"), "note-remember", json!({"text": "after"})).await;
    assert!(after.success);
    assert_eq!(events(dir.path(), "main").len(), 2);
}

#[test]
fn two_hosts_opening_a_fresh_workspace_at_once_share_one_confirmation_key() {
    let dir = minimal();
    let barrier = Arc::new(Barrier::new(8));
    let keys: Vec<Vec<u8>> = (0..8)
        .map(|_| {
            let (path, barrier) = (dir.path().to_path_buf(), Arc::clone(&barrier));
            std::thread::spawn(move || {
                barrier.wait();
                let host = HostBuilder::open(&path).unwrap().seal().unwrap();
                host.workspace().confirmation_key().unwrap()
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    let distinct: BTreeSet<_> = keys.iter().collect();
    assert_eq!(distinct.len(), 1, "one shared key");
    let leftovers = std::fs::read_dir(dir.path().join("state/keys"))
        .unwrap()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(leftovers, 0);
}

#[test]
fn many_umbel_processes_append_to_one_journal_with_contiguous_seq() {
    let dir = minimal();
    // Create the workspace's state once so every process opens an existing layout.
    drop(HostBuilder::open(dir.path()).unwrap().seal().unwrap());
    let binary = env!("CARGO_BIN_EXE_umbel");
    let run = |args: Vec<String>| {
        std::process::Command::new(binary)
            .arg("--workspace")
            .arg(dir.path())
            .args(args)
            .env_remove("UMBEL_WORKSPACE")
            .env_remove("UMBEL_LOG")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap()
    };
    let mut children = Vec::new();
    for index in 0..12 {
        children.push(run(vec![
            "event".into(),
            "ack".into(),
            "cursor=v0:main:0".into(),
            format!("consumer=c{index}"),
        ]));
        children.push(run(vec!["event".into(), "list".into()]));
    }
    for child in children {
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let journal = journal_entries(dir.path());
    assert_eq!(journal.len(), 24);
    assert_eq!(
        journal.iter().map(|entry| entry.seq).collect::<Vec<_>>(),
        (1..=24).collect::<Vec<_>>()
    );
    let cursors = std::fs::read_dir(dir.path().join("state/spaces/main/cursors"))
        .unwrap()
        .flatten()
        .count();
    assert_eq!(
        cursors, 12,
        "one stored cursor per consumer, no temporary file"
    );
}
