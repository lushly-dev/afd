//! The key file (phase 3 sections 5.4 and 7.4, D83, D89): the table of missing and mismatched
//! files, one case each; provisioning, with a database and no `meta`, adoption, and the temporary
//! file; a crash at every point of 7.4 in a child process, then reopened; `UMBEL_TEST_FAIL_AT`; a
//! marker and an absent entry through `get`, `invalidate` and `confirm`; a forget of an absent
//! entry leaving a marker; roll-forward from each write path, a read writing nothing, one
//! tombstone when two writers meet a marker, none for a purge, the `session` prefix surviving a
//! crash; two processes writing keys and a third forgetting; orphans counted and kept by a default
//! reindex and removed only with `removeOrphans`, never a marker; the pragmas read back on each
//! new connection to the key file.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use rusqlite::Connection;
use support::open_memory;
use umbel_store::conformance::samples;
use umbel_store::memory::{
    AsOf, Confirm, DAY_MS, Forget, Invalidate, InvalidationReason, KeyFileState, MemoryList,
    MemoryOrder, ReadFlags, RecallQuery, Retention, Sweep, WalState, WriteRefusal,
};
use umbel_store::{
    ForgetSelector, MemoryBatch, MemoryQuery, MemoryStore, MemoryWrite, ReaderFilter, ScopeQuery,
    StoreError,
};
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

const ADA: &str = "human:ada";
const P_ADA: &str = "principal:human:ada";
const T0: i64 = samples::MEMORY_AT;
const NOW: i64 = T0 + 10;
const CHILD_DIR: &str = "UMBEL_KEYFILE_CHILD";
const CHILD_OP: &str = "UMBEL_KEYFILE_OP";

fn ada() -> ReaderFilter {
    ReaderFilter::tokens([P_ADA, "space"]).expect("a valid reader")
}

fn flags() -> ReadFlags {
    ReadFlags {
        include_flagged: true,
        include_expired: true,
        now: NOW,
    }
}

fn open(dir: &Path) -> std::sync::Arc<SqliteMemoryStore> {
    open_memory(dir, "main", StoreOptions::default()).expect("opening")
}

fn store_dir(dir: &Path) -> PathBuf {
    dir.join("store")
}

fn db_path(dir: &Path) -> PathBuf {
    store_dir(dir).join("memory.sqlite3")
}

fn keys_path(dir: &Path) -> PathBuf {
    store_dir(dir).join("memory.keys")
}

fn raw_db(dir: &Path) -> Connection {
    Connection::open(db_path(dir)).expect("the database")
}

fn raw_keys(dir: &Path) -> Connection {
    Connection::open(keys_path(dir)).expect("the key file")
}

fn id(n: u64) -> String {
    samples::memory_id(n)
}

/// Record `n` in session `s<session>`.
fn entry(n: u64, session: u64) -> MemoryWrite {
    let mut e = samples::memory_entry(
        n,
        ADA,
        &[P_ADA],
        &format!("note {n}"),
        &format!("keyed words number {n}"),
    );
    e.scope.session = Some(format!("s{session}"));
    samples::agree(&mut e);
    e
}

fn write(m: &dyn MemoryStore, entries: Vec<MemoryWrite>) {
    m.write(samples::memory_batch(T0, entries)).expect("write");
}

/// A captured write: record `n` under capture key `claude-code:s<session>:w<window>`.
fn capture(m: &dyn MemoryStore, n: u64, session: u64, window: u64) -> Result<(), StoreError> {
    let mut batch: MemoryBatch = samples::memory_batch(T0, vec![entry(n, session)]);
    batch.capture_key = Some(format!("claude-code:s{session}:w{window}"));
    let receipt = m.write(batch)?;
    if receipt.refused == Some(WriteRefusal::Erased) {
        return Err(StoreError::invalid("refused: erased"));
    }
    Ok(())
}

fn get(m: &dyn MemoryStore, n: u64) -> Result<Option<String>, StoreError> {
    m.get(&id(n), AsOf::at(NOW), flags(), &ada())
        .map(|r| r.map(|r| r.text))
}

fn list(m: &dyn MemoryStore) -> Result<umbel_store::memory::MemoryPage, StoreError> {
    m.list(
        &MemoryList {
            scope: ScopeQuery::default(),
            classes: Vec::new(),
            tags: Vec::new(),
            authorities: Vec::new(),
            push: None,
            as_of: AsOf::at(NOW),
            flags: flags(),
            order: MemoryOrder::Recorded,
            after: None,
            limit: 100,
        },
        &ada(),
    )
}

fn recall(m: &dyn MemoryStore, text: &str) -> Result<umbel_store::memory::RecallPage, StoreError> {
    m.recall(
        &RecallQuery {
            query: MemoryQuery::parse(text).expect("a query"),
            scope: ScopeQuery::default(),
            classes: Vec::new(),
            tags: Vec::new(),
            authorities: Vec::new(),
            push: None,
            as_of: AsOf::at(NOW),
            flags: flags(),
            limit: 100,
        },
        &ada(),
    )
}

fn forget(m: &dyn MemoryStore, selector: ForgetSelector) -> umbel_store::memory::ForgetReceipt {
    m.forget(Forget {
        owner: ADA.into(),
        equivalents: Vec::new(),
        selector,
        at: NOW,
        trace_id: Some("t-forget".into()),
    })
    .expect("forget")
}

fn invalidate(m: &dyn MemoryStore, n: u64) -> Result<(), StoreError> {
    m.invalidate(
        Invalidate {
            id: id(n),
            at: NOW,
            valid_until: NOW,
            by: ADA.into(),
            reason: InvalidationReason::Outdated,
            note: None,
            expect_version: None,
            trace_id: None,
        },
        &ada(),
    )
    .map(drop)
}

fn confirm(m: &dyn MemoryStore, n: u64) -> Result<(), StoreError> {
    m.confirm(
        Confirm {
            id: id(n),
            by: ADA.into(),
            equivalents: Vec::new(),
            content_hash: "sha256:".into(),
            at: NOW,
            trace_id: None,
            assurance: Some(umbel_store::Assurance::terminal()),
        },
        &ada(),
    )
    .map(drop)
}

fn sweep(m: &dyn MemoryStore) -> umbel_store::memory::SweepReceipt {
    m.sweep(Sweep {
        now: T0 + 91 * DAY_MS,
        limit: 100,
        retention: Retention::default(),
    })
    .expect("sweep")
}

/// `(key is null, kind, settled)` of `n`'s entry, or `None` when it is absent.
fn entry_of(dir: &Path, n: u64) -> Option<(bool, Option<String>, bool)> {
    rusqlite::OptionalExtension::optional(raw_keys(dir).query_row(
        "SELECT key IS NULL, kind, settled FROM record_keys WHERE id = ?1",
        [id(n)],
        |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
    ))
    .expect("the key file")
}

fn row_exists(dir: &Path, n: u64) -> bool {
    raw_db(dir)
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM records WHERE id = ?1)",
            [id(n)],
            |r| r.get(0),
        )
        .expect("records")
}

fn tombstones(dir: &Path, n: u64) -> Vec<String> {
    let raw = raw_db(dir);
    let mut stmt = raw
        .prepare("SELECT kind FROM tombstones WHERE id = ?1")
        .expect("tombstones");
    stmt.query_map([id(n)], |r| r.get(0))
        .expect("tombstones")
        .collect::<Result<_, _>>()
        .expect("tombstones")
}

fn change_kinds(dir: &Path, n: u64) -> Vec<String> {
    let raw = raw_db(dir);
    let mut stmt = raw
        .prepare("SELECT kind FROM changes WHERE id = ?1 ORDER BY rev")
        .expect("changes");
    stmt.query_map([id(n)], |r| r.get(0))
        .expect("changes")
        .collect::<Result<_, _>>()
        .expect("changes")
}

/// Mark `n`'s key destroyed by hand, as a forget's step 2 leaves it.
fn plant_marker(dir: &Path, n: u64, kind: &str, settled: bool) {
    raw_keys(dir)
        .execute(
            "UPDATE record_keys SET key = NULL, destroyed_at = ?2, kind = ?3, settled = ?4 \
             WHERE id = ?1",
            rusqlite::params![id(n), NOW, kind, i64::from(settled)],
        )
        .expect("planting a marker");
}

fn files_in(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(store_dir(dir))
        .map(|d| {
            d.map(|e| {
                e.expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

// ---------------------------------------------------------------------------------------------
// The child.

/// Runs `op` on the store under `dir` in a child process, with `env` set. Returns its stdout
/// and whether it exited successfully.
fn child(dir: &Path, op: &str, env: &[(&str, &str)]) -> (bool, String) {
    let exe = std::env::current_exe().expect("the test binary");
    let mut command = Command::new(exe);
    command
        .args(["--exact", "keyfile_child", "--nocapture"])
        .env(CHILD_DIR, dir)
        .env(CHILD_OP, op)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (k, v) in env {
        command.env(k, v);
    }
    let output = command.output().expect("running the child");
    (
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
    )
}

fn crash(dir: &Path, op: &str, point: &str) {
    let (ok, out) = child(dir, op, &[("UMBEL_TEST_CRASH_AT", point)]);
    assert!(!ok, "the child should abort at {point}: {out}");
}

#[test]
fn writer_child() {
    support::writer_child();
}

#[test]
fn keyfile_child() {
    let Ok(dir) = std::env::var(CHILD_DIR) else {
        return;
    };
    let dir = PathBuf::from(dir);
    let m = open(&dir);
    match std::env::var(CHILD_OP).as_deref() {
        Ok("provision") => write(&*m, vec![entry(1, 1)]),
        Ok("write") => write(&*m, vec![entry(9, 1)]),
        Ok("forget") => {
            let receipt = forget(&*m, ForgetSelector::Ids(vec![id(1)]));
            println!("UMBEL-WAL {:?}", receipt.wal);
        }
        Ok("forget-session") => {
            let receipt = forget(&*m, ForgetSelector::Session("s1".into()));
            println!("UMBEL-WAL {:?}", receipt.wal);
        }
        Ok("sweep") => {
            let receipt = sweep(&*m);
            println!("UMBEL-PURGED {}", receipt.purged);
        }
        Ok("backup") => {
            m.backup(&dir.join("copy")).expect("backup");
        }
        Ok("open") => {
            let _ = get(&*m, 2);
        }
        other => panic!("unknown op {other:?}"),
    }
}

// ---------------------------------------------------------------------------------------------
// Section 5.4's table, one case each.

#[test]
fn not_provisioned_reads_create_nothing() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open(dir.path());
    assert!(matches!(get(&*m, 1), Err(StoreError::NotProvisioned)));
    assert!(matches!(m.key_status(), Err(StoreError::NotProvisioned)));
    assert!(
        files_in(dir.path()).is_empty(),
        "{:?}",
        files_in(dir.path())
    );
    write(&*m, vec![entry(1, 1)]);
    assert_eq!(
        files_in(dir.path())
            .into_iter()
            .filter(|f| !f.ends_with("-wal") && !f.ends_with("-shm"))
            .collect::<Vec<_>>(),
        vec!["memory.keys".to_owned(), "memory.sqlite3".to_owned()],
        "a write provisions both, with no temporary file left"
    );
    let status = m.key_status().expect("key status");
    assert_eq!(status.file, KeyFileState::Present);
    assert_eq!(
        (
            status.unsettled,
            status.destroyed,
            status.orphans,
            status.absent
        ),
        (0, 0, 0, 0)
    );
}

#[test]
fn a_missing_key_file_is_keys_missing_and_never_recreated() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    write(&*open(dir.path()), vec![entry(1, 1)]);
    std::fs::remove_file(keys_path(dir.path())).expect("losing the key file");
    let m = open(dir.path());
    assert!(matches!(get(&*m, 1), Err(StoreError::KeysMissing)));
    assert!(matches!(list(&*m), Err(StoreError::KeysMissing)));
    assert!(matches!(recall(&*m, "keyed"), Err(StoreError::KeysMissing)));
    assert!(matches!(
        m.history(&id(1), &ada()),
        Err(StoreError::KeysMissing)
    ));
    assert!(matches!(
        m.write(samples::memory_batch(T0, vec![entry(2, 1)])),
        Err(StoreError::KeysMissing)
    ));
    assert!(matches!(invalidate(&*m, 1), Err(StoreError::KeysMissing)));
    assert!(matches!(
        m.forget(Forget {
            owner: ADA.into(),
            equivalents: Vec::new(),
            selector: ForgetSelector::Ids(vec![id(1)]),
            at: NOW,
            trace_id: None
        }),
        Err(StoreError::KeysMissing)
    ));
    assert_eq!(
        m.key_status().expect("key status").file,
        KeyFileState::Missing
    );
    assert!(!keys_path(dir.path()).exists(), "never recreated");
    // Reads that hold no text still answer.
    assert_eq!(m.head().expect("head"), 1);
}

#[test]
fn another_stores_key_file_or_none_at_all_is_keys_mismatch() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let other = tempfile::tempdir().expect("another directory");
    write(&*open(dir.path()), vec![entry(1, 1)]);
    write(&*open(other.path()), vec![entry(1, 1)]);
    std::fs::copy(keys_path(other.path()), keys_path(dir.path())).expect("the wrong key file");
    let m = open(dir.path());
    assert!(matches!(get(&*m, 1), Err(StoreError::KeysMismatch)));
    assert!(matches!(
        m.write(samples::memory_batch(T0, vec![entry(2, 1)])),
        Err(StoreError::KeysMismatch)
    ));
    assert_eq!(
        m.key_status().expect("key status").file,
        KeyFileState::Mismatch
    );
    // Not a key file at all.
    std::fs::write(keys_path(dir.path()), b"not a database, only words").expect("garbage");
    let m = open(dir.path());
    assert!(matches!(get(&*m, 1), Err(StoreError::KeysMismatch)));
    assert_eq!(
        m.key_status().expect("key status").file,
        KeyFileState::Mismatch
    );
    // A SQLite file that is not a key file.
    std::fs::remove_file(keys_path(dir.path())).expect("removing");
    Connection::open(keys_path(dir.path()))
        .expect("a plain database")
        .execute_batch("CREATE TABLE meta (store_id TEXT); INSERT INTO meta VALUES ('x');")
        .expect("a plain table");
    let m = open(dir.path());
    assert!(matches!(get(&*m, 1), Err(StoreError::KeysMismatch)));
}

#[test]
fn a_key_file_without_its_database_is_keys_mismatch_and_nothing_is_created() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    write(&*open(dir.path()), vec![entry(1, 1)]);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", db_path(dir.path()).display()));
    }
    let m = open(dir.path());
    assert!(matches!(get(&*m, 1), Err(StoreError::KeysMismatch)));
    assert!(matches!(m.head(), Err(StoreError::KeysMismatch)));
    assert!(matches!(
        m.write(samples::memory_batch(T0, vec![entry(2, 1)])),
        Err(StoreError::KeysMismatch)
    ));
    assert_eq!(
        m.key_status().expect("key status").file,
        KeyFileState::Mismatch
    );
    assert_eq!(files_in(dir.path()), vec!["memory.keys".to_owned()]);
}

#[test]
fn a_marker_and_an_absent_entry_through_get_invalidate_and_confirm() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1), entry(2, 1), entry(3, 1)]);
    // Absent: the row's entry is gone.
    raw_keys(dir.path())
        .execute("DELETE FROM record_keys WHERE id = ?1", [id(1)])
        .expect("removing an entry");
    assert!(matches!(get(&*m, 1), Err(StoreError::KeyAbsent { .. })));
    assert!(matches!(
        invalidate(&*m, 1),
        Err(StoreError::KeyAbsent { .. })
    ));
    assert!(matches!(confirm(&*m, 1), Err(StoreError::KeyAbsent { .. })));
    // A settled marker on a row that remains, as a file-level copy put back leaves it.
    plant_marker(dir.path(), 2, "forget", true);
    assert_eq!(get(&*m, 2).expect("get"), None, "forgotten");
    assert!(m.history(&id(2), &ada()).expect("history").is_empty());
    assert!(matches!(invalidate(&*m, 2), Err(StoreError::NotFound)));
    assert!(matches!(confirm(&*m, 2), Err(StoreError::NotFound)));
    // List and recall leave out both; only the absent one counts as unreadable.
    let page = list(&*m).expect("list");
    assert_eq!(
        page.items.iter().map(|i| i.id.clone()).collect::<Vec<_>>(),
        vec![id(3)]
    );
    assert_eq!(page.unreadable, 1);
    let hits = recall(&*m, "keyed").expect("recall");
    assert_eq!(
        hits.hits
            .iter()
            .map(|h| h.record.id.clone())
            .collect::<Vec<_>>(),
        vec![id(3)]
    );
    assert_eq!(hits.unreadable, 1);
    let status = m.key_status().expect("key status");
    assert_eq!((status.absent, status.destroyed), (1, 1));
    // A record with an absent key can still be forgotten, and leaves a marker.
    let receipt = forget(&*m, ForgetSelector::Ids(vec![id(1)]));
    assert_eq!((receipt.erased, receipt.wal), (1, WalState::Clean));
    assert_eq!(
        entry_of(dir.path(), 1),
        Some((true, Some("forget".to_owned()), true)),
        "a marker for an entry that was absent"
    );
    assert!(!row_exists(dir.path(), 1));
}

// ---------------------------------------------------------------------------------------------
// Provisioning.

#[test]
fn provisioning_adopts_a_key_file_left_before_the_store_id_was_committed() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    crash(dir.path(), "provision", "provision-keys");
    assert!(db_path(dir.path()).exists() && keys_path(dir.path()).exists());
    let left: String = raw_keys(dir.path())
        .query_row("SELECT store_id FROM meta", [], |r| r.get(0))
        .expect("the key file's store id");
    // The schema and the meta rows were in the transaction the crash rolled back.
    let meta: i64 = raw_db(dir.path())
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'meta'",
            [],
            |r| r.get(0),
        )
        .expect("sqlite_master");
    assert_eq!(meta, 0, "a database with no meta row");
    let m = open(dir.path());
    assert!(
        matches!(get(&*m, 1), Err(StoreError::NotProvisioned)),
        "not provisioned"
    );
    write(&*m, vec![entry(1, 1)]);
    assert_eq!(m.info().expect("info").store_id, left, "adopted");
    assert_eq!(
        get(&*m, 1).expect("get").as_deref(),
        Some("keyed words number 1")
    );
}

#[test]
fn provisioning_removes_a_leftover_temporary_key_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    std::fs::create_dir_all(store_dir(dir.path())).expect("the store directory");
    let leftover = store_dir(dir.path()).join(".memory-keys-deadbeef.tmp");
    std::fs::write(&leftover, b"a dead process's store id").expect("a leftover");
    write(&*open(dir.path()), vec![entry(1, 1)]);
    assert!(!leftover.exists(), "removed");
    assert!(
        !files_in(dir.path()).iter().any(|f| f.ends_with(".tmp")),
        "{:?}",
        files_in(dir.path())
    );
}

#[cfg(unix)]
#[test]
fn the_key_file_is_private_and_its_pragmas_are_set_on_each_connection() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open_memory(
        dir.path(),
        "main",
        StoreOptions {
            lock_timeout_ms: 4321,
        },
    )
    .expect("opening");
    write(&*m, vec![entry(1, 1)]);
    let mode = std::fs::metadata(keys_path(dir.path()))
        .expect("the key file")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "{mode:o}");
    for _ in 0..3 {
        let info = m.keys_info().expect("keys info");
        assert_eq!(info.journal_mode, "delete");
        assert_eq!(info.synchronous, 3, "EXTRA");
        assert!(info.secure_delete);
        assert_eq!(info.full_fsync, cfg!(target_os = "macos"));
        assert_eq!(info.busy_timeout_ms, 4321);
        assert_eq!(info.application_id, 0x554D_424B);
        assert_eq!(info.user_version, 1);
        assert_eq!(info.store_id, m.info().expect("info").store_id);
    }
    // They reset per connection.
    let raw = raw_keys(dir.path());
    let int = |p: &str| -> i64 {
        raw.query_row(&format!("PRAGMA {p}"), [], |r| r.get(0))
            .expect("a pragma")
    };
    assert_eq!(int("secure_delete"), 0);
    assert_ne!(int("synchronous"), 3);
    assert_eq!(
        files_in(dir.path())
            .iter()
            .filter(|f| f.starts_with("memory.keys"))
            .count(),
        1,
        "rollback journal mode: one file at rest"
    );
}

// ---------------------------------------------------------------------------------------------
// Crash points.

fn two_records(dir: &Path) {
    let m = open(dir);
    capture(&*m, 1, 1, 1).expect("record 1, captured");
    write(&*m, vec![entry(2, 2)]);
}

#[test]
fn a_crash_after_the_keys_commit_leaves_an_orphan_and_no_row() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    two_records(dir.path());
    crash(dir.path(), "write", "write-keys");
    assert_eq!(
        entry_of(dir.path(), 9).map(|e| e.0),
        Some(false),
        "key kept"
    );
    let m = open(dir.path());
    assert_eq!(get(&*m, 9).expect("get"), None, "no row");
    let status = m.key_status().expect("key status");
    assert_eq!((status.orphans, status.absent), (1, 0));
    assert_eq!(
        get(&*m, 2).expect("get").as_deref(),
        Some("keyed words number 2")
    );
}

#[test]
fn a_crash_after_each_step_of_forget_is_finished_by_the_next_writer() {
    for point in ["forget-1", "forget-2", "forget-3", "forget-4", "forget-5"] {
        let dir = tempfile::tempdir().expect("a temporary directory");
        two_records(dir.path());
        crash(dir.path(), "forget", point);
        let m = open(dir.path());
        match point {
            "forget-1" => {
                // No key destroyed: the record still reads, and its capture window is refused.
                assert_eq!(entry_of(dir.path(), 1).map(|e| e.0), Some(false), "{point}");
                assert!(get(&*m, 1).expect("get").is_some(), "{point}");
                assert!(capture(&*m, 7, 1, 1).is_err(), "{point}: the prefix holds");
                continue;
            }
            "forget-2" => {
                assert!(row_exists(dir.path(), 1), "{point}: rows stand");
                assert_eq!(get(&*m, 1).expect("get"), None, "{point}: no text opens");
                assert!(recall(&*m, "keyed").expect("recall").hits.len() == 1);
                assert_eq!(m.key_status().expect("status").unsettled, 1, "{point}");
            }
            "forget-3" | "forget-4" => {
                assert!(!row_exists(dir.path(), 1), "{point}: rows gone");
                assert_eq!(
                    entry_of(dir.path(), 1),
                    Some((true, Some("forget".to_owned()), false)),
                    "{point}: unsettled"
                );
            }
            _ => {
                assert_eq!(
                    entry_of(dir.path(), 1),
                    Some((true, Some("forget".to_owned()), true)),
                    "{point}: settled"
                );
            }
        }
        // A read writes nothing: the marker is as it was.
        let before = entry_of(dir.path(), 1);
        let _ = list(&*m).expect("list");
        assert_eq!(
            entry_of(dir.path(), 1),
            before,
            "{point}: a read rolls nothing forward"
        );
        // The next writer finishes it.
        write(&*m, vec![entry(5, 3)]);
        assert!(!row_exists(dir.path(), 1), "{point}");
        assert_eq!(
            entry_of(dir.path(), 1),
            Some((true, Some("forget".to_owned()), true)),
            "{point}: settled by the next writer"
        );
        let tombstones = tombstones(dir.path(), 1);
        assert_eq!(
            tombstones.len(),
            1,
            "{point}: one tombstone, {tombstones:?}"
        );
        let expected = if point == "forget-2" {
            "forget-recovered"
        } else {
            "forget"
        };
        assert_eq!(tombstones[0], expected, "{point}");
        assert_eq!(
            change_kinds(dir.path(), 1),
            vec!["created".to_owned(), "erased".to_owned()],
            "{point}"
        );
        assert!(capture(&*m, 7, 1, 1).is_err(), "{point}: the prefix holds");
        assert!(
            get(&*m, 2).expect("get").is_some(),
            "{point}: the other record stays"
        );
        assert_eq!(m.key_status().expect("status").unsettled, 0, "{point}");
    }
}

#[test]
fn a_session_forget_keeps_its_prefix_through_a_crash() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    two_records(dir.path());
    crash(dir.path(), "forget-session", "forget-2");
    let m = open(dir.path());
    // Another window of the forgotten session is refused, from the session-wide prefix step 1
    // committed before the key was destroyed.
    assert!(capture(&*m, 8, 1, 4).is_err(), "the session prefix holds");
    assert!(capture(&*m, 8, 2, 4).is_ok(), "another session is not");
}

#[test]
fn a_crash_after_each_step_of_a_purge_leaves_no_tombstone() {
    for point in ["purge-2", "purge-3", "purge-4"] {
        let dir = tempfile::tempdir().expect("a temporary directory");
        two_records(dir.path());
        invalidate(&*open(dir.path()), 1).expect("invalidate");
        crash(dir.path(), "sweep", point);
        let m = open(dir.path());
        assert_eq!(
            entry_of(dir.path(), 1).map(|e| (e.0, e.1)),
            Some((true, Some("purge".to_owned()))),
            "{point}"
        );
        assert_eq!(get(&*m, 1).expect("get"), None, "{point}");
        write(&*m, vec![entry(5, 3)]);
        assert!(!row_exists(dir.path(), 1), "{point}");
        assert_eq!(entry_of(dir.path(), 1).map(|e| e.2), Some(true), "{point}");
        assert!(
            tombstones(dir.path(), 1).is_empty(),
            "{point}: no tombstone"
        );
        assert_eq!(
            change_kinds(dir.path(), 1),
            vec![
                "created".to_owned(),
                "invalidated".to_owned(),
                "purged".to_owned()
            ],
            "{point}"
        );
    }
}

#[test]
fn a_failure_at_step_three_still_answers_success_pending() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    two_records(dir.path());
    let (ok, out) = child(dir.path(), "forget", &[("UMBEL_TEST_FAIL_AT", "forget-3")]);
    assert!(ok, "the forget succeeds: {out}");
    assert!(out.contains("UMBEL-WAL Pending"), "{out}");
    assert!(row_exists(dir.path(), 1), "step 3 rolled back");
    assert_eq!(
        entry_of(dir.path(), 1),
        Some((true, Some("forget".to_owned()), false)),
        "the key is destroyed, the marker unsettled"
    );
    let m = open(dir.path());
    assert_eq!(get(&*m, 1).expect("get"), None);
    write(&*m, vec![entry(5, 3)]);
    assert!(!row_exists(dir.path(), 1));
    assert_eq!(entry_of(dir.path(), 1).map(|e| e.2), Some(true));
    assert_eq!(
        tombstones(dir.path(), 1),
        vec!["forget-recovered".to_owned()]
    );
}

// ---------------------------------------------------------------------------------------------
// Roll-forward.

#[test]
fn each_write_path_rolls_forward_and_a_read_does_not() {
    type Path_ = fn(&dyn MemoryStore);
    let paths: [(&str, Path_); 6] = [
        ("write", |m| write(m, vec![entry(5, 3)])),
        ("invalidate", |m| invalidate(m, 2).expect("invalidate")),
        ("confirm", |m| {
            let _ = confirm(m, 2);
        }),
        ("forget", |m| {
            forget(m, ForgetSelector::Ids(vec![id(3)]));
        }),
        ("sweep", |m| {
            sweep(m);
        }),
        ("reindex", |m| {
            m.reindex(false).expect("reindex");
        }),
    ];
    for (name, run) in paths {
        let dir = tempfile::tempdir().expect("a temporary directory");
        let m = open(dir.path());
        write(&*m, vec![entry(1, 1), entry(2, 1), entry(3, 1)]);
        plant_marker(dir.path(), 1, "forget", false);
        let head = m.head().expect("head");
        assert_eq!(get(&*m, 1).expect("get"), None, "{name}");
        let _ = list(&*m).expect("list");
        let _ = recall(&*m, "keyed").expect("recall");
        assert!(row_exists(dir.path(), 1), "{name}: a read leaves the row");
        assert_eq!(
            m.head().expect("head"),
            head,
            "{name}: a read writes nothing"
        );
        run(&*m);
        assert!(!row_exists(dir.path(), 1), "{name}: rolled forward");
        assert_eq!(entry_of(dir.path(), 1).map(|e| e.2), Some(true), "{name}");
        assert_eq!(
            tombstones(dir.path(), 1),
            vec!["forget-recovered".to_owned()],
            "{name}"
        );
    }
}

#[test]
fn a_purge_marker_rolls_forward_without_a_tombstone() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1), entry(2, 1)]);
    plant_marker(dir.path(), 1, "purge", false);
    write(&*m, vec![entry(5, 3)]);
    assert!(!row_exists(dir.path(), 1));
    assert!(tombstones(dir.path(), 1).is_empty());
    assert_eq!(
        change_kinds(dir.path(), 1),
        vec!["created".to_owned(), "purged".to_owned()]
    );
}

#[test]
fn two_writers_meeting_one_marker_write_one_tombstone() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    write(&*open(dir.path()), vec![entry(1, 1), entry(2, 1)]);
    plant_marker(dir.path(), 1, "forget", false);
    let stores: Vec<_> = (0..2).map(|_| open(dir.path())).collect();
    std::thread::scope(|scope| {
        for (n, m) in stores.iter().enumerate() {
            scope.spawn(move || write(&**m, vec![entry(10 + n as u64, 4)]));
        }
    });
    assert_eq!(tombstones(dir.path(), 1).len(), 1);
    assert_eq!(
        change_kinds(dir.path(), 1),
        vec!["created".to_owned(), "erased".to_owned()]
    );
}

#[test]
fn two_processes_write_keys_while_a_third_forgets() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1)]);
    let mut children = Vec::new();
    for name in ["a", "b"] {
        let mut command = support::spawn_writer(dir.path());
        command
            .env(umbel_store::conformance::ENV_ID, name)
            .env(umbel_store::conformance::ENV_COUNT, "30")
            .env(umbel_store::conformance::ENV_KIND, "memory")
            .env(support::ENV_MODE, "memory-race")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        children.push(command.spawn().expect("a writer"));
    }
    for c in &mut children {
        use std::io::Write as _;
        c.stdin
            .take()
            .expect("stdin")
            .write_all(b"go\n")
            .expect("starting");
    }
    // Forget each record as it appears, while they write.
    let mut forgotten = std::collections::BTreeSet::new();
    let mut after = 0;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    while std::time::Instant::now() < deadline {
        let changes = m.changes(after, 1000, &ada(), None).expect("changes");
        for c in &changes {
            after = c.rev;
            if c.kind == umbel_store::memory::MemoryChangeKind::Created && c.rev % 3 == 0 {
                forget(&*m, ForgetSelector::Ids(vec![c.id.clone()]));
                forgotten.insert(c.id.clone());
            }
        }
        if children
            .iter_mut()
            .all(|c| c.try_wait().ok().flatten().is_some())
            && changes.is_empty()
        {
            break;
        }
    }
    let mut written = Vec::new();
    for c in children {
        let out = c.wait_with_output().expect("a writer");
        assert!(out.status.success());
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(rest) = line.strip_prefix(umbel_store::conformance::WROTE_PREFIX) {
                written.push(rest.trim().split_once(' ').expect("a line").1.to_owned());
            }
        }
    }
    assert_eq!(written.len(), 60);
    assert!(!forgotten.is_empty());
    for record in &written {
        let found = m
            .get(
                record,
                AsOf::at(samples::MEMORY_AT),
                ReadFlags::at(samples::MEMORY_AT),
                &ada(),
            )
            .expect("every kept record opens");
        assert_eq!(found.is_none(), forgotten.contains(record), "{record}");
    }
    let status = m.key_status().expect("key status");
    assert_eq!((status.absent, status.orphans, status.unsettled), (0, 0, 0));
}

// ---------------------------------------------------------------------------------------------
// Orphans (D89).

#[test]
fn orphans_are_counted_and_kept_unless_removal_is_asked() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1), entry(2, 1), entry(3, 1)]);
    forget(&*m, ForgetSelector::Ids(vec![id(3)]));
    // Two orphans: rows removed by hand, as a restored older copy would lack them.
    let raw = raw_db(dir.path());
    for n in [1, 2] {
        raw.execute("DELETE FROM records WHERE id = ?1", [id(n)])
            .expect("dropping a row");
    }
    drop(raw);
    let receipt = m.reindex(false).expect("reindex");
    assert_eq!((receipt.orphans, receipt.orphans_removed), (2, 0));
    assert_eq!(entry_of(dir.path(), 1).map(|e| e.0), Some(false), "kept");
    assert_eq!(m.key_status().expect("status").orphans, 2);
    sweep(&*m);
    write(&*m, vec![entry(4, 1)]);
    assert_eq!(
        m.key_status().expect("status").orphans,
        2,
        "neither a sweep nor a write removes them"
    );
    let receipt = m.reindex(true).expect("reindex removing orphans");
    assert_eq!((receipt.orphans, receipt.orphans_removed), (2, 2));
    assert_eq!(entry_of(dir.path(), 1), None);
    assert_eq!(entry_of(dir.path(), 2), None);
    assert_eq!(
        entry_of(dir.path(), 3).map(|e| e.0),
        Some(true),
        "a marker is never an orphan"
    );
    assert_eq!(
        get(&*m, 4).expect("get").as_deref(),
        Some("keyed words number 4")
    );
}
