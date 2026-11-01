//! The SQLite backend's own promises (specification section 3.2): WAL, durability pragmas,
//! schema versioning, the checkpoint policy and what a damaged file does.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use rusqlite::Connection;
use support::open_with;
use umbel_store::conformance::samples;
use umbel_store::{DocumentStore, Expect, StoreError};
use umbel_store_embedded::{SqliteStore, StoreOptions};

#[test]
fn writer_child() {
    support::writer_child();
}

fn database(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("store").join("store.sqlite3")
}

#[test]
fn the_store_is_wal_full_sync_with_the_default_autocheckpoint() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 1234,
        },
    )
    .expect("opening");
    let info = store.info().expect("info");
    assert_eq!(info.schema_version, 1);
    assert_eq!(info.journal_mode, "wal");
    assert!(
        info.synchronous_full,
        "decision traces must survive power loss"
    );
    assert!(info.foreign_keys);
    assert_eq!(info.busy_timeout_ms, 1234);
    assert_eq!(info.wal_autocheckpoint, 1000, "SQLite's default is kept");
    assert_eq!(
        info.full_fsync,
        cfg!(target_os = "macos"),
        "fullfsync is on where synchronous=FULL does not flush the drive"
    );
    // The journal mode is persistent: a plain connection finds the file already in WAL.
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    let mode: String = raw
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .expect("journal_mode");
    assert_eq!(mode, "wal");
}

#[test]
fn a_newer_schema_is_refused_naming_what_this_build_serves() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(dir.path(), "main", StoreOptions::default()).expect("creating"));
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    raw.pragma_update(None, "user_version", 2)
        .expect("bumping the version");
    drop(raw);
    let error = SqliteStore::open(dir.path(), "main", StoreOptions::default())
        .err()
        .expect("a refusal");
    assert_eq!(
        error,
        StoreError::VersionUnsupported {
            found: 2,
            supported: 1
        }
    );
    assert!(
        error.to_string().contains("version 2") && error.to_string().contains("up to version 1")
    );
}

#[test]
fn a_store_belongs_to_its_space() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(dir.path(), "main", StoreOptions::default()).expect("creating"));
    let error = SqliteStore::open(dir.path(), "other", StoreOptions::default())
        .err()
        .expect("a refusal");
    assert!(
        matches!(error, StoreError::Invalid(ref m) if m.contains("main")),
        "{error:?}"
    );
    assert!(SqliteStore::open(dir.path(), "Not A Space", StoreOptions::default()).is_err());
}

#[test]
fn a_file_that_is_not_a_database_is_corrupt() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    std::fs::create_dir_all(dir.path().join("store")).expect("mkdir");
    std::fs::write(database(dir.path()), vec![b'x'; 4096]).expect("writing garbage");
    let error = SqliteStore::open(dir.path(), "main", StoreOptions::default())
        .err()
        .expect("a refusal");
    assert!(matches!(error, StoreError::Corrupt(_)), "{error:?}");
}

#[test]
fn checkpoint_truncates_the_wal_and_is_best_effort_beside_a_reader() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    for n in 0..20 {
        let id = format!("a/doc-{n}");
        store
            .put_document(samples::document(&id, &["space"], &id, "t"), Expect::Any)
            .expect("put");
    }
    assert!(
        store.info().expect("info").wal_bytes > 0,
        "writes are in the log until a checkpoint"
    );
    store.checkpoint().expect("a checkpoint");
    assert_eq!(
        store.info().expect("info").wal_bytes,
        0,
        "TRUNCATE empties the log"
    );
    // A reader holding a snapshot pins the log; the checkpoint must not fail or wait for it.
    let reader = Connection::open(database(dir.path())).expect("a raw connection");
    reader
        .execute_batch("BEGIN; SELECT count(*) FROM documents;")
        .expect("a read snapshot");
    store
        .put_document(
            samples::document("a/late", &["space"], "x", "t"),
            Expect::Any,
        )
        .expect("a write beside the reader");
    store
        .checkpoint()
        .expect("a busy checkpoint is not an error");
    reader
        .execute_batch("COMMIT")
        .expect("releasing the snapshot");
    store
        .checkpoint()
        .expect("and finishes once the reader is gone");
    assert_eq!(store.info().expect("info").wal_bytes, 0);
}

#[test]
fn reads_leave_no_transaction_open() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    store
        .put_document(
            samples::document("a/doc", &["space"], "x", "t"),
            Expect::Any,
        )
        .expect("put");
    let reader = umbel_store::ReaderFilter::tokens(["space"]).expect("reader");
    for _ in 0..5 {
        store.get_document("a/doc", &reader).expect("get");
        store
            .list_documents(&umbel_store::ListQuery::all(10), &reader)
            .expect("list");
    }
    // If any read had pinned the log, a TRUNCATE checkpoint would report busy and leave bytes.
    let raw = Connection::open(database(dir.path())).expect("a raw connection");
    let (busy, _, _): (i64, i64, i64) = raw
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .expect("a checkpoint");
    assert_eq!(busy, 0, "no read transaction is held open");
}
