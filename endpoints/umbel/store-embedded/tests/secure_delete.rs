//! `secure_delete` on `store.sqlite3` (phase 4 specification, section 9.1, D103): every
//! connection of the document store reads back `secure_delete = 1`; a replaced record's and a
//! replaced document's canaries are absent from the raw bytes of every file in the store
//! directory after a `wal_checkpoint(TRUNCATE)`; a reader holding the log leaves the checkpoint
//! `Pending`, and a later checkpoint finishes it. The control, a connection with `secure_delete`
//! off, shows that the scan finds what an overwrite without it leaves.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde_json::json;
use support::open_with;
use umbel_store::conformance::samples;
use umbel_store::{DocumentStore, Expect};
use umbel_store_embedded::{StoreOptions, WalCheckpoint};

/// A fresh random canary of 24 lowercase letters.
fn canary() -> String {
    let mut out = String::from("canary");
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u8(1);
    let mut bits = hasher.finish();
    for _ in 0..18 {
        out.push(char::from(b'a' + u8::try_from(bits % 26).unwrap()));
        bits /= 26;
        if bits == 0 {
            let mut more = RandomState::new().build_hasher();
            more.write_u8(2);
            bits = more.finish();
        }
    }
    out
}

fn store_dir(dir: &Path) -> PathBuf {
    dir.join("store")
}

/// Every file of the store directory whose raw bytes hold `needle`.
fn files_holding(dir: &Path, needle: &str) -> Vec<PathBuf> {
    let mut hits = Vec::new();
    for entry in std::fs::read_dir(store_dir(dir)).expect("the store directory") {
        let path = entry.expect("an entry").path();
        if !path.is_file() {
            continue;
        }
        let bytes = std::fs::read(&path).expect("the file's bytes");
        if bytes
            .windows(needle.len())
            .any(|window| window == needle.as_bytes())
        {
            hits.push(path);
        }
    }
    hits
}

fn envelope(trace: &str) -> umbel_store::Envelope {
    samples::envelope(&["space"], trace, "2026-11-03T00:00:00Z")
}

/// A body that starts with the canary and keeps its row on one page.
fn body_with(canary: &str) -> serde_json::Value {
    json!({ "content": format!("{canary} {}", "x".repeat(200)), "title": canary })
}

#[test]
fn every_connection_reads_back_secure_delete_on() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    assert!(store.info().expect("info").secure_delete);
    // Several threads at once make the pool open connections beyond its first; each is made the
    // same way.
    std::thread::scope(|scope| {
        for _ in 0..8 {
            scope.spawn(|| {
                for _ in 0..25 {
                    assert!(store.info().expect("info").secure_delete);
                }
            });
        }
    });
    drop(store);
    let reopened = open_with(dir.path(), "main", StoreOptions::default()).expect("reopening");
    assert!(reopened.info().expect("info").secure_delete);
    // The pragma is per connection: a connection the store did not make has SQLite's default,
    // which this build leaves off. That is the control's premise.
    let raw = Connection::open(store_dir(dir.path()).join("store.sqlite3")).expect("raw");
    let default: i64 = raw
        .query_row("PRAGMA secure_delete", [], |r| r.get(0))
        .expect("the pragma");
    assert_eq!(default, 0);
}

#[test]
fn a_replaced_records_and_documents_canaries_are_gone_after_a_truncate_checkpoint() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    let (record, document) = (canary(), canary());
    store
        .put_record(
            "knowledge",
            "proposal",
            "p-1",
            body_with(&record),
            envelope("t1"),
            Expect::Absent,
        )
        .expect("the first version");
    store
        .put_document(
            samples::document(
                "notes/learned/c-1",
                &["space"],
                &format!("---\ntitle: Learned\n---\n{document} {}\n", "y".repeat(200)),
                "t2",
            ),
            Expect::Absent,
        )
        .expect("the first document");
    assert_eq!(
        store.truncate_wal().expect("a checkpoint"),
        WalCheckpoint::Clean
    );
    // The scan sees them while they are stored.
    assert!(!files_holding(dir.path(), &record).is_empty());
    assert!(!files_holding(dir.path(), &document).is_empty());

    // A redaction replaces the content.
    store
        .put_record(
            "knowledge",
            "proposal",
            "p-1",
            json!({ "content": null, "redacted": true }),
            envelope("t3"),
            Expect::Any,
        )
        .expect("the redacted version");
    store
        .put_document(
            samples::document(
                "notes/learned/c-1",
                &["space"],
                "---\ntitle: Learned\n---\nredacted\n",
                "t4",
            ),
            Expect::Any,
        )
        .expect("the replaced document");
    assert_eq!(
        store.truncate_wal().expect("a checkpoint"),
        WalCheckpoint::Clean
    );
    assert_eq!(
        store.info().expect("info").wal_bytes,
        0,
        "TRUNCATE empties the log"
    );
    assert_eq!(files_holding(dir.path(), &record), Vec::<PathBuf>::new());
    assert_eq!(files_holding(dir.path(), &document), Vec::<PathBuf>::new());
}

#[test]
fn a_reader_holding_the_log_leaves_the_checkpoint_pending_until_a_later_one() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let store = open_with(dir.path(), "main", StoreOptions::default()).expect("opening");
    let record = canary();
    store
        .put_record(
            "knowledge",
            "proposal",
            "p-1",
            body_with(&record),
            envelope("t1"),
            Expect::Absent,
        )
        .expect("the first version");
    assert_eq!(
        store.truncate_wal().expect("a checkpoint"),
        WalCheckpoint::Clean
    );

    let reader = Connection::open(store_dir(dir.path()).join("store.sqlite3")).expect("raw");
    reader
        .execute_batch("BEGIN; SELECT count(*) FROM records;")
        .expect("a read snapshot");
    store
        .put_record(
            "knowledge",
            "proposal",
            "p-1",
            json!({ "redacted": true }),
            envelope("t2"),
            Expect::Any,
        )
        .expect("a write beside the reader");
    let started = Instant::now();
    assert_eq!(
        store
            .truncate_wal()
            .expect("a busy checkpoint is not an error"),
        WalCheckpoint::Pending
    );
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "the reporting checkpoint takes no lock wait"
    );
    // The reader's snapshot still holds the old version, so its bytes are still on disk.
    assert!(!files_holding(dir.path(), &record).is_empty());

    reader
        .execute_batch("COMMIT")
        .expect("releasing the snapshot");
    // A later write's checkpoint retries it.
    store
        .put_record(
            "knowledge",
            "proposal",
            "p-2",
            json!({ "other": true }),
            envelope("t3"),
            Expect::Absent,
        )
        .expect("a later write");
    store.checkpoint().expect("the later checkpoint");
    assert_eq!(
        store.truncate_wal().expect("a checkpoint"),
        WalCheckpoint::Clean
    );
    assert_eq!(files_holding(dir.path(), &record), Vec::<PathBuf>::new());
}

#[test]
fn the_control_without_secure_delete_keeps_the_canary() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    drop(open_with(dir.path(), "main", StoreOptions::default()).expect("the schema"));
    let record = canary();
    let conn = Connection::open(store_dir(dir.path()).join("store.sqlite3")).expect("raw");
    conn.query_row("PRAGMA secure_delete = OFF", [], |r| r.get::<_, i64>(0))
        .expect("off");
    let body = body_with(&record).to_string();
    conn.execute(
        "INSERT INTO records (ns, kind, id, rev, content_hash, body, envelope) \
         VALUES ('knowledge', 'proposal', 'p-1', 1, 'sha256:0', ?1, '{}')",
        [&body],
    )
    .expect("insert");
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
        r.get::<_, i64>(0)
    })
    .expect("checkpoint");
    conn.execute(
        "UPDATE records SET body = '{\"redacted\":true}' WHERE id = 'p-1'",
        [],
    )
    .expect("replace");
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
        .expect("checkpoint");
    assert_eq!(busy, 0);
    assert!(
        !files_holding(dir.path(), &record).is_empty(),
        "without secure_delete the replaced bytes stay in a freed cell, and the scan finds them"
    );
}
