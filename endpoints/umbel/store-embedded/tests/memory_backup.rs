//! `backup` through `ATTACH`, the restore by hand and the rebuild on open (phase 3 sections 5.4
//! and 7.4): the copy holds no canary, no `records_fts`, no `record_derived` and no key; rowids,
//! mode `0600` and `user_version` are kept; a record forgotten after the backup cannot be read
//! from it with the current key file; the restore rebuilds the index and drops marked rows, with a
//! prefix written for a forget and none for a purge, and no session-wide prefix (the stated
//! limit); a forget after the restore leaves no canary; a trial restore and the newer database
//! put back open every record; a file-level copy put back keeps its plaintext until
//! `memory-reindex`; a crash in the backup leaves no plaintext and no temporary file; a crash in
//! the rebuild is repeated by the next open; a read that opens a restored copy rebuilds it.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use rusqlite::Connection;
use support::{open_memory, restore_memory};
use umbel_store::conformance::samples;
use umbel_store::memory::{
    AsOf, DAY_MS, Forget, Invalidate, InvalidationReason, ReadFlags, RecallQuery, Retention, Sweep,
    WalState, WriteRefusal,
};
use umbel_store::{
    ForgetSelector, MemoryQuery, MemoryStore, MemoryWrite, ReaderFilter, ScopeQuery, StoreError,
};
use umbel_store_embedded::{SqliteMemoryStore, StoreOptions};

const ADA: &str = "human:ada";
const P_ADA: &str = "principal:human:ada";
const T0: i64 = samples::MEMORY_AT;
const NOW: i64 = T0 + 10;

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

fn db_path(dir: &Path) -> PathBuf {
    dir.join("store").join("memory.sqlite3")
}

fn raw_db(dir: &Path) -> Connection {
    Connection::open(db_path(dir)).expect("the database")
}

fn id(n: u64) -> String {
    samples::memory_id(n)
}

/// The canary words of record `n`: lowercase, unstemmed, sharing no prefix with another record's.
fn canaries(n: u64) -> [String; 3] {
    let tag = [
        "bqz", "cvx", "dkw", "fjp", "gnt", "hrm", "jxl", "kpv", "lzq",
    ][n as usize % 9];
    [
        format!("{tag}subjqxv{n}"),
        format!("{tag}textqxv{n}"),
        format!("{tag}tagqxv{n}"),
    ]
}

/// Record `n` holding its canaries, in session `s<session>`.
fn entry(n: u64, session: u64) -> MemoryWrite {
    let [subject, text, tag] = canaries(n);
    let mut e = samples::memory_entry(
        n,
        ADA,
        &[P_ADA],
        &format!("about {subject}"),
        &format!("the body holds {text} and kept words"),
    );
    e.tags = vec![tag];
    e.scope.session = Some(format!("s{session}"));
    samples::agree(&mut e);
    e
}

fn write(m: &dyn MemoryStore, entries: Vec<MemoryWrite>) {
    m.write(samples::memory_batch(T0, entries)).expect("write");
}

/// Record `n` under capture key `claude-code:s<session>:w<window>`; whether it was written.
fn capture(m: &dyn MemoryStore, n: u64, session: u64, window: u64) -> bool {
    let mut batch = samples::memory_batch(T0, vec![entry(n, session)]);
    batch.capture_key = Some(format!("claude-code:s{session}:w{window}"));
    m.write(batch).expect("capture").refused != Some(WriteRefusal::Erased)
}

fn get(m: &dyn MemoryStore, n: u64) -> Option<String> {
    m.get(&id(n), AsOf::at(NOW), flags(), &ada())
        .expect("get")
        .map(|r| r.text)
}

fn recall(m: &dyn MemoryStore, text: &str) -> Vec<String> {
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
    .expect("recall")
    .hits
    .into_iter()
    .map(|h| h.record.id)
    .collect()
}

fn forget(m: &dyn MemoryStore, selector: ForgetSelector) {
    let receipt = m
        .forget(Forget {
            owner: ADA.into(),
            selector,
            at: NOW,
            trace_id: None,
        })
        .expect("forget");
    assert_eq!(receipt.wal, WalState::Clean);
}

fn files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_owned()];
    while let Some(next) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else {
            continue;
        };
        for entry in entries {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                out.push(path);
            }
        }
    }
    out
}

/// The files under `dir` holding any of `needles`.
fn holding(dir: &Path, needles: &[Vec<u8>]) -> Vec<PathBuf> {
    files(dir)
        .into_iter()
        .filter(|f| {
            let bytes = std::fs::read(f).unwrap_or_default();
            needles
                .iter()
                .any(|n| bytes.windows(n.len()).any(|w| w == &n[..]))
        })
        .collect()
}

fn words(ns: &[u64]) -> Vec<Vec<u8>> {
    ns.iter()
        .flat_map(|n| canaries(*n))
        .map(String::into_bytes)
        .collect()
}

/// Every live key in the key file.
fn live_keys(dir: &Path) -> Vec<Vec<u8>> {
    let raw = Connection::open(dir.join("store").join("memory.keys")).expect("the key file");
    let mut stmt = raw
        .prepare("SELECT key FROM record_keys WHERE key IS NOT NULL")
        .expect("keys");
    stmt.query_map([], |r| r.get(0))
        .expect("keys")
        .collect::<Result<_, _>>()
        .expect("keys")
}

fn tables(path: &Path) -> Vec<String> {
    let raw = Connection::open(path).expect("a database");
    let mut stmt = raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .expect("tables");
    stmt.query_map([], |r| r.get(0))
        .expect("tables")
        .collect::<Result<_, _>>()
        .expect("tables")
}

fn rowids(path: &Path, sql: &str) -> Vec<i64> {
    let raw = Connection::open(path).expect("a database");
    let mut stmt = raw.prepare(sql).expect("rowids");
    stmt.query_map([], |r| r.get(0))
        .expect("rowids")
        .collect::<Result<_, _>>()
        .expect("rowids")
}

fn has_index(dir: &Path) -> bool {
    tables(&db_path(dir)).iter().any(|t| t == "records_fts")
}

#[test]
fn the_copy_holds_no_text_index_or_key_and_keeps_rowids_mode_and_version() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let copy = tempfile::tempdir().expect("a backup directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1), entry(2, 1), entry(3, 2)]);
    forget(&*m, ForgetSelector::Ids(vec![id(2)]));
    write(&*m, vec![entry(4, 2)]);
    let receipt = m.backup(copy.path()).expect("backup");
    let file = copy.path().join("memory.sqlite3");
    assert_eq!(receipt.file, file);
    assert_eq!(
        receipt.bytes,
        std::fs::metadata(&file).expect("the copy").len()
    );
    assert!(
        holding(copy.path(), &words(&[1, 2, 3, 4])).is_empty(),
        "no canary in the copy"
    );
    assert!(
        holding(copy.path(), &live_keys(dir.path())).is_empty(),
        "no key in the copy"
    );
    let names: Vec<String> = files(copy.path())
        .iter()
        .map(|f| f.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        names,
        vec!["memory.sqlite3".to_owned()],
        "no journal, key file or temporary"
    );
    let kept = tables(&file);
    assert!(
        !kept.iter().any(|t| t.starts_with("records_fts")),
        "{kept:?}"
    );
    assert!(!kept.iter().any(|t| t == "record_derived"), "{kept:?}");
    for table in [
        "meta",
        "records",
        "versions",
        "changes",
        "tombstones",
        "capture_erasures",
    ] {
        assert!(kept.iter().any(|t| t == table), "{table} kept: {kept:?}");
    }
    for sql in [
        "SELECT rowid FROM records ORDER BY rowid",
        "SELECT rowid FROM observations ORDER BY rowid",
        "SELECT rev FROM changes ORDER BY rev",
    ] {
        assert_eq!(
            rowids(&file, sql),
            rowids(&db_path(dir.path()), sql),
            "{sql}"
        );
    }
    let version: i64 = Connection::open(&file)
        .expect("the copy")
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version");
    assert_eq!(version, 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&file)
            .expect("the copy")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "{mode:o}");
    }
    // A second backup into the same directory is refused rather than overwriting it.
    assert!(matches!(m.backup(copy.path()), Err(StoreError::Invalid(_))));
}

#[test]
fn a_record_forgotten_after_the_backup_cannot_be_read_from_it() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let copy = tempfile::tempdir().expect("a backup directory");
    let m = open(dir.path());
    assert!(capture(&*m, 1, 1, 1), "record 1, captured in window 1");
    assert!(capture(&*m, 2, 2, 1), "record 2, captured in session 2");
    write(&*m, vec![entry(3, 3), entry(4, 3)]);
    m.invalidate(
        Invalidate {
            id: id(4),
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
    .expect("invalidate");
    m.backup(copy.path()).expect("backup");
    // After the backup: 1 forgotten by id, 2 by session, 4 purged.
    forget(&*m, ForgetSelector::Ids(vec![id(1)]));
    forget(&*m, ForgetSelector::Session("s2".into()));
    let swept = m
        .sweep(Sweep {
            now: T0 + 91 * DAY_MS,
            limit: 100,
            retention: Retention::default(),
        })
        .expect("sweep");
    assert_eq!(swept.purged, 1);
    drop(m);
    restore_memory(dir.path(), "main", copy.path()).expect("restore");
    assert!(!has_index(dir.path()), "a restored copy has no index");
    let m = open(dir.path());
    // A read opens it, and the open rebuilds.
    assert_eq!(get(&*m, 1), None, "forgotten after the backup");
    assert!(has_index(dir.path()), "rebuilt on open");
    assert_eq!(get(&*m, 2), None);
    assert_eq!(get(&*m, 4), None, "purged after the backup");
    assert!(m.history(&id(1), &ada()).expect("history").is_empty());
    for n in [1, 2] {
        let [subject, text, tag] = canaries(n);
        for word in [subject, text, tag] {
            assert!(recall(&*m, &word).is_empty(), "{word}");
        }
    }
    assert_eq!(
        get(&*m, 3).as_deref(),
        Some(format!("the body holds {} and kept words", canaries(3)[1]).as_str()),
        "a record not forgotten reads from the copy"
    );
    // The marked rows are gone from the rebuilt store: no canary of 1, 2 or 4 in any file.
    m.checkpoint().expect("checkpoint");
    let left = holding(&dir.path().join("store"), &words(&[1, 2, 4]));
    assert!(left.is_empty(), "canaries in the rebuilt store: {left:?}");
    // A forget's prefix comes back from its row; a purge writes none; the session-wide prefix of
    // a forget by session is in no row and is not recovered (section 5.4's stated limit).
    assert!(
        !capture(&*m, 11, 1, 1),
        "record 1's closed window stays refused"
    );
    assert!(
        !capture(&*m, 12, 2, 1),
        "record 2's own window stays refused"
    );
    assert!(
        capture(&*m, 13, 2, 5),
        "the session-wide prefix of s2 is not recovered"
    );
    let raw = raw_db(dir.path());
    let count =
        |sql: &str, n: u64| -> i64 { raw.query_row(sql, [id(n)], |r| r.get(0)).expect("a count") };
    assert_eq!(count("SELECT COUNT(*) FROM tombstones WHERE id = ?1", 1), 1);
    assert_eq!(
        count("SELECT COUNT(*) FROM tombstones WHERE id = ?1", 4),
        0,
        "purge"
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM changes WHERE id = ?1 AND kind = 'purged'",
            4
        ),
        1
    );
    // A forget after the restore leaves no canary: the rebuilt table has `secure-delete` again.
    assert!(m.info().expect("info").fts_secure_delete);
    forget(&*m, ForgetSelector::Ids(vec![id(3)]));
    let left = holding(&dir.path().join("store"), &words(&[3]));
    assert!(left.is_empty(), "canaries after a forget: {left:?}");
}

#[test]
fn a_trial_restore_then_the_newer_database_put_back_opens_every_record() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let older = tempfile::tempdir().expect("the older backup");
    let newer = tempfile::tempdir().expect("the newer backup");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1)]);
    m.backup(older.path()).expect("the older backup");
    write(&*m, vec![entry(2, 1), entry(3, 1)]);
    m.backup(newer.path()).expect("the newer backup");
    drop(m);
    restore_memory(dir.path(), "main", older.path()).expect("restoring the older copy");
    let m = open(dir.path());
    assert!(get(&*m, 1).is_some());
    assert_eq!(get(&*m, 2), None, "not in the older copy");
    // The later records' keys are orphans here; a default reindex keeps them (D89).
    let receipt = m.reindex(false).expect("reindex");
    assert_eq!((receipt.orphans, receipt.orphans_removed), (2, 0));
    drop(m);
    restore_memory(dir.path(), "main", newer.path()).expect("putting the newer back");
    let m = open(dir.path());
    for n in 1..=3 {
        assert!(get(&*m, n).is_some(), "record {n} opens");
    }
    let status = m.key_status().expect("key status");
    assert_eq!((status.orphans, status.absent), (0, 0));
}

#[test]
fn a_file_level_copy_put_back_keeps_its_text_until_reindex() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let saved = tempfile::tempdir().expect("a file copy");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1), entry(2, 1)]);
    m.checkpoint().expect("checkpoint");
    std::fs::copy(db_path(dir.path()), saved.path().join("memory.sqlite3")).expect("cp");
    forget(&*m, ForgetSelector::Ids(vec![id(1)]));
    drop(m);
    // Put back by hand: a file-level copy, with its own `records_fts`, so no rebuild runs.
    restore_memory(dir.path(), "main", saved.path()).expect("put back");
    let m = open(dir.path());
    assert!(has_index(dir.path()));
    assert_eq!(get(&*m, 1), None, "the marker keeps it forgotten");
    assert!(
        recall(&*m, &canaries(1)[1]).is_empty(),
        "no snippet is served"
    );
    assert!(
        !holding(&dir.path().join("store"), &words(&[1])).is_empty(),
        "its plaintext stays in the file: the stated limit"
    );
    assert_eq!(m.key_status().expect("key status").destroyed, 1);
    let receipt = m.reindex(false).expect("reindex");
    assert_eq!(receipt.reindexed, 1);
    let left = holding(&dir.path().join("store"), &words(&[1]));
    assert!(left.is_empty(), "removed by reindex: {left:?}");
    assert!(get(&*m, 2).is_some());
}

// ---------------------------------------------------------------------------------------------
// Crashes.

const CHILD_DIR: &str = "UMBEL_BACKUP_CHILD";
const CHILD_OP: &str = "UMBEL_BACKUP_OP";

#[test]
fn backup_child() {
    let Ok(dir) = std::env::var(CHILD_DIR) else {
        return;
    };
    let dir = PathBuf::from(dir);
    let m = open(&dir);
    match std::env::var(CHILD_OP).as_deref() {
        Ok("backup") => {
            m.backup(&dir.join("copy")).expect("backup");
        }
        Ok("open") => {
            let _ = get(&*m, 2);
        }
        other => panic!("unknown op {other:?}"),
    }
}

fn crash(dir: &Path, op: &str, point: &str) {
    let exe = std::env::current_exe().expect("the test binary");
    let status = Command::new(exe)
        .args(["--exact", "backup_child", "--nocapture"])
        .env(CHILD_DIR, dir)
        .env(CHILD_OP, op)
        .env("UMBEL_TEST_CRASH_AT", point)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("the child");
    assert!(!status.success(), "the child should abort at {point}");
}

#[test]
fn a_crash_in_the_backup_leaves_no_plaintext_and_no_temporary_file() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    write(&*open(dir.path()), vec![entry(1, 1), entry(2, 1)]);
    crash(dir.path(), "backup", "backup-copy");
    let copy = dir.path().join("copy");
    let names: Vec<String> = files(&copy)
        .iter()
        .map(|f| f.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert!(
        names
            .iter()
            .all(|n| n == "memory.sqlite3" || n == "memory.sqlite3-journal"),
        "only the destination and its journal: {names:?}"
    );
    assert!(holding(&copy, &words(&[1, 2])).is_empty(), "no plaintext");
    assert!(holding(&copy, &live_keys(dir.path())).is_empty(), "no key");
    // The live store carries on.
    assert!(get(&*open(dir.path()), 1).is_some());
}

#[test]
fn a_crash_in_the_rebuild_is_repeated_by_the_next_open() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let copy = tempfile::tempdir().expect("a backup directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1), entry(2, 1)]);
    m.backup(copy.path()).expect("backup");
    forget(&*m, ForgetSelector::Ids(vec![id(1)]));
    drop(m);
    restore_memory(dir.path(), "main", copy.path()).expect("restore");
    crash(dir.path(), "open", "rebuild");
    assert!(!has_index(dir.path()), "the killed rebuild rolled back");
    let m = open(dir.path());
    assert_eq!(get(&*m, 1), None);
    assert!(has_index(dir.path()));
    assert!(get(&*m, 2).is_some());
}

#[test]
fn a_restored_copy_with_its_key_file_missing_is_keys_missing() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let copy = tempfile::tempdir().expect("a backup directory");
    let m = open(dir.path());
    write(&*m, vec![entry(1, 1)]);
    m.backup(copy.path()).expect("backup");
    drop(m);
    restore_memory(dir.path(), "main", copy.path()).expect("restore");
    std::fs::remove_file(dir.path().join("store").join("memory.keys")).expect("losing the keys");
    let m = open(dir.path());
    assert!(matches!(
        m.get(&id(1), AsOf::at(NOW), flags(), &ada()),
        Err(StoreError::KeysMissing)
    ));
    assert!(!has_index(dir.path()), "no rebuild without the key file");
}
