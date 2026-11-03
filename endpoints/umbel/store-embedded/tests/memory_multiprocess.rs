//! Several processes on one space's memory store (phase 3 sections 5.3 and 12): writers in other
//! processes interleave with a reader here, revisions stay dense, a writer past the lock timeout
//! is told `Busy`, a killed writer loses no committed record, concurrent first writes end with
//! one `store_id`, a memory write does not move `store.sqlite3`'s head, the files are private,
//! and the pragmas are set on every new connection.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Stdio};

use rusqlite::Connection;
use support::{ENV_MODE, open, open_memory, spawn_writer};
use umbel_store::conformance::{ENV_COUNT, ENV_ID, ENV_KIND, WROTE_PREFIX, samples};
use umbel_store::memory::{AsOf, ReadFlags};
use umbel_store::{Expect, MemoryStore, ReaderFilter};
use umbel_store_embedded::StoreOptions;

#[test]
fn writer_child() {
    support::writer_child();
}

fn ada() -> ReaderFilter {
    ReaderFilter::tokens(["principal:human:ada", "space"]).expect("a valid reader")
}

fn memory_db(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("store").join("memory.sqlite3")
}

/// Spawn memory children in `mode` (with `ENV_KIND=memory` for the default child), start them
/// together, and return them.
fn spawn(dir: &std::path::Path, mode: Option<&str>, names: &[&str], count: usize) -> Vec<Child> {
    let mut children = Vec::new();
    for name in names {
        let mut command = spawn_writer(dir);
        command
            .env(ENV_ID, name)
            .env(ENV_COUNT, count.to_string())
            .env(ENV_KIND, "memory")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(mode) = mode {
            command.env(ENV_MODE, mode);
        }
        children.push(command.spawn().expect("spawning a child"));
    }
    for child in &mut children {
        let mut stdin = child.stdin.take().expect("a piped stdin");
        stdin.write_all(b"go\n").expect("starting a child");
    }
    children
}

/// Wait for the children and collect the `(rev, id)` pairs they print.
fn collect(children: Vec<Child>) -> BTreeMap<u64, String> {
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
fn two_writer_processes_and_a_reader_here() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = open(dir.path(), "main").expect("opening");
    let memory = stores.memory.clone().expect("a memory store");
    memory
        .write(samples::memory_batch(
            samples::MEMORY_AT,
            vec![samples::memory_entry(
                1,
                "human:ada",
                &["principal:human:ada"],
                "first",
                "provisions",
            )],
        ))
        .expect("the first write");
    let children = spawn(dir.path(), None, &["a", "b"], 80);
    // Read while they write: every read succeeds, and the changes come out dense.
    let mut after = 0;
    let mut reads = 0;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    while after < 161 && std::time::Instant::now() < deadline {
        for change in memory.changes(after, 1000, &ada(), None).expect("changes") {
            assert_eq!(change.rev, after + 1, "dense revisions");
            after = change.rev;
            let record = memory
                .get(
                    &change.id,
                    AsOf::at(samples::MEMORY_AT),
                    ReadFlags::at(samples::MEMORY_AT),
                    &ada(),
                )
                .expect("get");
            assert!(record.is_some(), "a visible change has its record");
        }
        reads += 1;
    }
    let seen = collect(children);
    assert_eq!(
        seen.keys().copied().collect::<Vec<_>>(),
        (2..=161).collect::<Vec<_>>(),
        "dense and unique across processes"
    );
    assert!(reads > 0);
    assert_eq!(memory.head().expect("head"), 161);
}

#[test]
fn concurrent_first_writes_end_with_one_store_id() {
    // The children open the memory store only after the start line, so both race to provision
    // it. (The suite's writer ids depend on the child's name, `a` or `b`.)
    let dir = tempfile::tempdir().expect("a temporary directory");
    let children = spawn(dir.path(), Some("memory-race"), &["a", "b"], 20);
    let seen = collect(children);
    assert_eq!(
        seen.keys().copied().collect::<Vec<_>>(),
        (1..=40).collect::<Vec<_>>(),
        "dense and unique"
    );
    let raw = Connection::open(memory_db(dir.path())).expect("a raw connection");
    let ids: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM meta WHERE key = 'store_id'",
            [],
            |r| r.get(0),
        )
        .expect("meta");
    assert_eq!(ids, 1, "one store_id");
    let memory = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let info = memory.info().expect("info");
    assert_eq!(
        info.store_id.len(),
        32,
        "128 bits in hex: {}",
        info.store_id
    );
    for id in seen.values() {
        assert!(
            memory
                .get(
                    id,
                    AsOf::at(samples::MEMORY_AT),
                    ReadFlags::at(samples::MEMORY_AT),
                    &ada()
                )
                .expect("get")
                .is_some(),
            "no lost write"
        );
    }
}

#[test]
fn a_writer_past_the_lock_timeout_is_busy() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let memory = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    memory
        .write(samples::memory_batch(
            samples::MEMORY_AT,
            vec![samples::memory_entry(
                1,
                "human:ada",
                &["principal:human:ada"],
                "first",
                "provisions",
            )],
        ))
        .expect("the first write");
    let mut holder = Connection::open(memory_db(dir.path())).expect("a raw connection");
    let tx = holder
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("holding the write lock");
    let mut command = spawn_writer(dir.path());
    command
        .env(ENV_MODE, "memory-busy")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command.output().expect("running the child");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("UMBEL-BUSY"), "{stdout}");
    tx.rollback().expect("releasing the lock");
    assert_eq!(
        memory.head().expect("head"),
        1,
        "the busy write wrote nothing"
    );
}

#[test]
fn a_killed_writer_loses_no_committed_record() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let memory = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    let mut command = spawn_writer(dir.path());
    command
        .env(ENV_MODE, "memory-forever")
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().expect("spawning the writer");
    let stdout = child.stdout.take().expect("a piped stdout");
    let mut committed = Vec::new();
    for line in BufReader::new(stdout).lines() {
        let line = line.expect("a line");
        if let Some(rest) = line.strip_prefix(WROTE_PREFIX) {
            let (_, id) = rest.trim().split_once(' ').expect("a child line");
            committed.push(id.to_owned());
            if committed.len() == 30 {
                child.kill().expect("killing the writer");
                break;
            }
        }
    }
    child.wait().expect("reaping the writer");
    let head = memory.head().expect("head");
    assert!(head >= 30, "every printed write is committed: head {head}");
    for id in &committed {
        assert!(
            memory
                .get(
                    id,
                    AsOf::at(samples::MEMORY_AT),
                    ReadFlags::at(samples::MEMORY_AT),
                    &ada()
                )
                .expect("get")
                .is_some(),
            "{id} was committed before the kill"
        );
    }
    let raw = Connection::open(memory_db(dir.path())).expect("a raw connection");
    let check: String = raw
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .expect("integrity_check");
    assert_eq!(check, "ok");
}

#[test]
fn a_memory_write_does_not_move_the_document_head() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let stores = open(dir.path(), "main").expect("opening");
    let doc = samples::document("notes/one", &["space"], "one", "t-doc");
    stores
        .documents
        .put_document(doc, Expect::Absent)
        .expect("a document");
    assert_eq!(stores.documents.head().expect("head"), 1);
    let memory = stores.memory.clone().expect("a memory store");
    for n in 1..=3 {
        memory
            .write(samples::memory_batch(
                samples::MEMORY_AT,
                vec![samples::memory_entry(
                    n,
                    "human:ada",
                    &["principal:human:ada"],
                    "a note",
                    &format!("note {n}"),
                )],
            ))
            .expect("a memory write");
    }
    assert_eq!(memory.head().expect("memory head"), 3);
    assert_eq!(
        stores.documents.head().expect("document head"),
        1,
        "the document head did not move"
    );
    assert!(memory_db(dir.path()).exists());
    assert!(dir.path().join("store").join("store.sqlite3").exists());
}

#[cfg(unix)]
#[test]
fn the_database_its_wal_and_shared_memory_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().expect("a temporary directory");
    let memory = open_memory(dir.path(), "main", StoreOptions::default()).expect("opening");
    memory
        .write(samples::memory_batch(
            samples::MEMORY_AT,
            vec![samples::memory_entry(
                1,
                "human:ada",
                &["principal:human:ada"],
                "private",
                "whole conversations",
            )],
        ))
        .expect("a write");
    // The pool holds its connections open, so the WAL and shared-memory files exist.
    let db = memory_db(dir.path());
    for suffix in ["", "-wal", "-shm"] {
        let path = std::path::PathBuf::from(format!("{}{suffix}", db.display()));
        let mode = std::fs::metadata(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "{}: {mode:o}", path.display());
    }
}

#[test]
fn the_pragmas_are_read_back_on_each_new_connection() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let memory = open_memory(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 1234,
        },
    )
    .expect("opening");
    memory
        .write(samples::memory_batch(
            samples::MEMORY_AT,
            vec![samples::memory_entry(
                1,
                "human:ada",
                &["principal:human:ada"],
                "pragmas",
                "per connection",
            )],
        ))
        .expect("a write");
    // `info` opens a new connection each time, as the pool does.
    for _ in 0..3 {
        let info = memory.info().expect("info");
        assert_eq!(info.schema_version, 1);
        assert_eq!(info.journal_mode, "wal");
        assert!(info.synchronous_full, "synchronous=FULL");
        assert!(info.secure_delete, "secure_delete=ON");
        assert_eq!(info.busy_timeout_ms, 1234);
        assert_eq!(info.full_fsync, cfg!(target_os = "macos"), "fullfsync");
        assert!(info.fts_secure_delete, "FTS5 secure-delete");
    }
    // They reset per connection: a plain one has none of them, which is why each is set on
    // every connection the store makes.
    let raw = Connection::open(memory_db(dir.path())).expect("a raw connection");
    let int = |pragma: &str| -> i64 {
        raw.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get(0))
            .expect("a pragma")
    };
    assert_eq!(int("secure_delete"), 0, "secure_delete is off by default");
    assert_ne!(int("busy_timeout"), 1234, "not the store's lock timeout");
}
