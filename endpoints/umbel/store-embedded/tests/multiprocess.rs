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
use support::{ENV_MODE, Pass, index_pass, open, open_index, open_with, spawn_writer};
use umbel_store::conformance::{ENV_COUNT, ENV_ID, WROTE_PREFIX, samples};
use umbel_store::{DocumentStore, Expect, ReaderFilter, SearchIndex, StoreError};
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

fn parse_pass(line: &str) -> Pass {
    let numbers: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .map(|n| n.parse().expect("a revision"))
        .collect();
    Pass {
        index_before: numbers[0],
        index_after: numbers[1],
        graph_before: numbers[2],
        graph_after: numbers[3],
    }
}

#[test]
fn two_indexer_processes_take_turns_and_neither_lowers_applied() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = open(dir.path(), "main").expect("opening");
    let mut children = Vec::new();
    for name in ["a", "b"] {
        let mut command = spawn_writer(dir.path());
        command
            .env(ENV_ID, name)
            .env(ENV_COUNT, "25")
            .env(ENV_MODE, "index")
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
    let mut everything = 0;
    for child in children {
        let output = child.wait_with_output().expect("waiting");
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(
            output.status.success(),
            "a child failed:\n{stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let passes: Vec<Pass> = stdout
            .lines()
            .filter(|l| l.starts_with("UMBEL-INDEXED"))
            .map(parse_pass)
            .collect();
        assert_eq!(passes.len(), 25, "every pass reported");
        everything += passes.len();
        for pass in &passes {
            // A pass never lowers either revision...
            assert!(pass.index_after >= pass.index_before, "{pass:?}");
            assert!(pass.graph_after >= pass.graph_before, "{pass:?}");
        }
        // ...and what the next pass of one process sees is never below what its last left, even
        // with another process indexing in between.
        for pair in passes.windows(2) {
            assert!(pair[1].index_before >= pair[0].index_after, "{pair:?}");
            assert!(pair[1].graph_before >= pair[0].graph_after, "{pair:?}");
        }
    }
    assert_eq!(everything, 50);
    // One more pass from here catches up whatever the last committer did not see.
    let last = index_pass(&stores).expect("a final pass");
    assert_eq!(last.index_after, 50);
    assert_eq!(stores.documents.head().expect("head"), 50);
    let index = stores.index.expect("an index");
    assert_eq!(index.applied().expect("applied"), 50);
    assert_eq!(stores.graph.applied().expect("applied"), 50);
    let hits = index
        .search(
            &umbel_store::IndexQuery {
                text: "indexed".to_owned(),
                filters: umbel_store::IndexFilters::default(),
                limit: 100,
            },
            &space_reader(),
        )
        .expect("search");
    assert_eq!(hits.len(), 50, "every document is indexed once, none lost");
}

/// Spawn a child that takes the index writer and prints `UMBEL-HELD`.
///
/// The child's output stays readable for as long as the returned reader lives: a child whose
/// standard output is closed fails when the test harness prints its own result line.
fn hold_the_index(
    dir: &std::path::Path,
) -> (
    std::process::Child,
    std::process::ChildStdin,
    std::io::BufReader<std::process::ChildStdout>,
) {
    use std::io::{BufRead, BufReader};
    let mut command = spawn_writer(dir);
    command
        .env(ENV_MODE, "hold")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().expect("spawning the holder");
    let mut out = BufReader::new(child.stdout.take().expect("stdout"));
    loop {
        let mut line = String::new();
        assert!(
            out.read_line(&mut line).expect("a line") > 0,
            "the holder said nothing"
        );
        if line.starts_with("UMBEL-HELD") {
            break;
        }
    }
    let stdin = child.stdin.take().expect("stdin");
    (child, stdin, out)
}

#[test]
fn a_second_process_waits_for_the_index_writer_then_is_busy() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    // The directory exists (and the index with it) before the holder starts.
    let index = open_index(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 300,
        },
    )
    .expect("opening");
    let (mut holder, mut stdin, _out) = hold_the_index(dir.path());
    let started = Instant::now();
    assert_eq!(index.writer().err(), Some(StoreError::Busy));
    let waited = started.elapsed();
    assert!(
        waited >= Duration::from_millis(250),
        "the wait was bounded below by the timeout: {waited:?}"
    );
    assert!(waited < Duration::from_secs(10), "and above: {waited:?}");
    // Readers are not blocked by the writer.
    assert_eq!(index.applied().expect("applied"), 0);
    // Told to commit, the holder releases the writer, and the waiter gets it.
    let patient = open_index(dir.path(), "main", StoreOptions::default()).expect("opening");
    let waiting = std::thread::spawn(move || {
        let session = patient.writer();
        session.map(|s| s.applied().expect("applied"))
    });
    std::thread::sleep(Duration::from_millis(200));
    stdin.write_all(b"commit\n").expect("telling the holder");
    drop(stdin);
    let outcome = waiting.join().expect("the waiting thread");
    assert_eq!(
        outcome.expect("the waiter got the writer once it was free"),
        7,
        "and read the revision the holder committed, under the lock"
    );
    assert!(holder.wait().expect("the holder exits").success());
}

#[test]
fn a_killed_indexer_leaves_no_stale_lock() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let index = open_index(dir.path(), "main", StoreOptions::default()).expect("opening");
    let (mut holder, stdin, _out) = hold_the_index(dir.path());
    holder.kill().expect("killing the holder");
    holder.wait().expect("reaping it");
    drop(stdin);
    let mut writer = index
        .writer()
        .expect("the OS released the killed holder's lock");
    assert_eq!(
        writer.applied().expect("applied"),
        0,
        "nothing was committed"
    );
    writer.commit(1).expect("and the index is usable");
}

#[test]
fn a_run_after_a_crash_between_the_two_commits_redoes_only_the_lagging_store() {
    use umbel_store::{DocGraph, GraphBatch, Node};
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = open(dir.path(), "main").expect("opening");
    for n in 0..5 {
        let id = format!("a/doc-{n}");
        stores
            .documents
            .put_document(samples::document(&id, &["space"], &id, "t"), Expect::Absent)
            .expect("put");
    }
    // The graph commit of the first run went through; the process died before the index's.
    let batch = GraphBatch {
        entries: (0..5)
            .map(|n| {
                let id = format!("a/doc-{n}");
                (
                    id.clone(),
                    Some(DocGraph {
                        nodes: vec![Node {
                            id: format!("doc:{id}"),
                            kind: "document".to_owned(),
                            label: id,
                        }],
                        edges: vec![],
                    }),
                )
            })
            .collect(),
    };
    stores.graph.apply(batch, 5).expect("the graph commit");
    let index = stores.index.clone().expect("an index");
    assert_eq!(index.applied().expect("applied"), 0, "the index is behind");
    let pass = index_pass(&stores).expect("the next run");
    assert_eq!(
        (pass.index_before, pass.graph_before),
        (0, 5),
        "it starts from the smaller revision"
    );
    assert_eq!((pass.index_after, pass.graph_after), (5, 5));
    let nodes = stores
        .graph
        .subgraph(&ReaderFilter::derivation())
        .expect("subgraph")
        .nodes;
    assert_eq!(nodes.len(), 5, "the graph was not rebuilt or doubled");
    let hits = index
        .search(
            &umbel_store::IndexQuery {
                text: "indexed".to_owned(),
                filters: umbel_store::IndexFilters::default(),
                limit: 10,
            },
            &space_reader(),
        )
        .expect("search");
    assert_eq!(hits.len(), 5, "the lagging index caught up");
}
