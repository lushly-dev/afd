//! Several Umbel processes on one space (D28, D51): writers in other processes interleave with
//! this one's, all revisions are dense and unique, nothing is lost, readers are not blocked, and
//! a writer past the lock timeout is told `Busy`.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::BTreeMap;
use std::io::Write;
use std::process::Stdio;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use support::{ENV_MODE, open_with, spawn_writer};
use umbel_store::conformance::{ENV_COUNT, ENV_ID, WROTE_PREFIX, samples};
use umbel_store::{DocumentStore, Expect, ReaderFilter, StoreError};
use umbel_store_embedded::StoreOptions;

#[test]
fn writer_child() {
    support::writer_child();
}

fn space_reader() -> ReaderFilter {
    ReaderFilter::tokens(["space"]).expect("a valid token")
}

/// Spawn children in `mode`, start them together with a line on standard input, and collect the
/// `(rev, id)` pairs they print.
fn run_children(
    dir: &std::path::Path,
    mode: &str,
    names: &[&str],
    count: usize,
) -> BTreeMap<u64, String> {
    let mut children = Vec::new();
    for name in names {
        let mut command = spawn_writer(dir);
        command
            .env(ENV_ID, name)
            .env(ENV_COUNT, count.to_string())
            .env(ENV_MODE, mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        children.push(command.spawn().expect("spawning a child"));
    }
    for child in &mut children {
        let mut stdin = child.stdin.take().expect("a piped stdin");
        stdin.write_all(b"go\n").expect("starting a child");
    }
    let mut seen = BTreeMap::new();
    for child in children {
        let output = child.wait_with_output().expect("waiting for a child");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "a child failed:\n{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        for line in stdout.lines().filter_map(|l| l.strip_prefix(WROTE_PREFIX)) {
            let (rev, id) = line.trim().split_once(' ').expect("a child line");
            assert!(
                seen.insert(rev.parse().expect("a revision"), id.to_owned())
                    .is_none(),
                "a revision was taken twice"
            );
        }
    }
    seen
}

#[test]
fn four_processes_create_and_fill_a_store_that_does_not_exist_yet() {
    // The children open the store only after the start line, so all four race to create it.
    let dir = tempfile::tempdir().expect("a temporary directory");
    let seen = run_children(dir.path(), "race", &["a", "b", "c", "d"], 25);
    assert_eq!(
        seen.keys().copied().collect::<Vec<_>>(),
        (1..=100).collect::<Vec<_>>(),
        "dense and unique"
    );
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening afterwards");
    assert_eq!(store.head().expect("head"), 100);
    for (rev, id) in &seen {
        let doc = store
            .get_document(id, &space_reader())
            .expect("get")
            .expect("no lost write");
        assert_eq!(doc.rev, *rev);
    }
}

#[test]
fn this_process_writes_while_two_others_do() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut children = Vec::new();
    for name in ["x", "y"] {
        let mut command = spawn_writer(dir.path());
        command
            .env(ENV_ID, name)
            .env(ENV_COUNT, "60")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        children.push(command.spawn().expect("spawning a child"));
    }
    for child in &mut children {
        child
            .stdin
            .take()
            .expect("stdin")
            .write_all(b"go\n")
            .expect("starting a child");
    }
    let mut mine = Vec::new();
    for n in 0..60 {
        let id = format!("mine/doc-{n:03}");
        let meta = store
            .put_document(
                samples::document(&id, &["space"], &id, "mine"),
                Expect::Absent,
            )
            .expect("a write beside other processes");
        mine.push(meta.rev);
        // A reader beside the writers sees whole commits: every change has its document.
        let changes = store
            .changes(
                meta.rev.saturating_sub(1),
                10,
                &ReaderFilter::derivation(),
                None,
            )
            .expect("changes");
        for change in changes {
            assert!(
                store
                    .get_document(&change.target, &ReaderFilter::derivation())
                    .expect("get")
                    .is_some()
            );
        }
    }
    let mut revs: Vec<u64> = mine;
    for child in children {
        let output = child.wait_with_output().expect("waiting");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8_lossy(&output.stdout);
        revs.extend(
            stdout
                .lines()
                .filter_map(|l| l.strip_prefix(WROTE_PREFIX))
                .map(|l| {
                    l.trim()
                        .split_once(' ')
                        .expect("line")
                        .0
                        .parse::<u64>()
                        .expect("rev")
                }),
        );
    }
    revs.sort_unstable();
    assert_eq!(
        revs,
        (1..=180).collect::<Vec<u64>>(),
        "three processes, dense and unique"
    );
    // Other processes' revisions interleave with ours, so a call's revisions are not a range:
    // the trace filter is how a consumer finds exactly its own (section 2.2).
    let traced = store
        .changes(0, 1000, &ReaderFilter::derivation(), Some("mine"))
        .expect("changes");
    assert_eq!(traced.len(), 60);
    // Whether they interleaved depends on scheduling, so nothing asserts it here; the four
    // processes creating one store at once (above) make interleaving certain.
    assert!(traced.windows(2).all(|w| w[1].rev > w[0].rev), "ascending");
}

fn hold_write_lock(dir: &std::path::Path) -> Connection {
    let conn = Connection::open(dir.join("store").join("store.sqlite3")).expect("a raw connection");
    conn.execute_batch("BEGIN IMMEDIATE")
        .expect("taking the write lock");
    conn
}

#[test]
fn a_writer_past_the_lock_timeout_is_busy_and_readers_are_not_blocked() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 300,
        },
    )
    .expect("opening");
    store
        .put_document(
            samples::document("a/seed", &["space"], "x", "t"),
            Expect::Any,
        )
        .expect("seed");
    let held = hold_write_lock(dir.path());
    let started = Instant::now();
    let result = store.put_document(
        samples::document("a/blocked", &["space"], "x", "t"),
        Expect::Any,
    );
    assert_eq!(result.unwrap_err(), StoreError::Busy);
    let waited = started.elapsed();
    assert!(
        waited >= Duration::from_millis(250),
        "the lock wait was bounded below by the timeout, not skipped: {waited:?}"
    );
    assert!(
        waited < Duration::from_secs(10),
        "and bounded above by it: {waited:?}"
    );
    // WAL: a reader does not wait for the writer.
    assert!(
        store
            .get_document("a/seed", &space_reader())
            .expect("a read beside the lock")
            .is_some()
    );
    assert_eq!(store.head().expect("head"), 1);
    held.execute_batch("ROLLBACK").expect("releasing the lock");
    store
        .put_document(
            samples::document("a/blocked", &["space"], "x", "t"),
            Expect::Any,
        )
        .expect("the lock is free again");
}

#[test]
fn another_process_past_the_lock_timeout_is_busy_too() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    store
        .put_document(
            samples::document("a/seed", &["space"], "x", "t"),
            Expect::Any,
        )
        .expect("seed");
    let held = hold_write_lock(dir.path());
    let mut command = spawn_writer(dir.path());
    command.env(ENV_MODE, "busy");
    let output = command.output().expect("running the child");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        stdout.lines().any(|l| l == "UMBEL-BUSY"),
        "the child was not told Busy:\n{stdout}"
    );
    held.execute_batch("ROLLBACK").expect("releasing the lock");
    assert_eq!(
        store.head().expect("head"),
        1,
        "the refused write left nothing behind"
    );
}
