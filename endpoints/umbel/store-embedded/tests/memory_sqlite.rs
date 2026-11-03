//! The phase 3 specification's SQLite experiments (its Status section), first run on Python's
//! SQLite 3.53.4, repeated here on the bundled SQLite the store links, as step 3a's plan asks.
//! Each test is plain `rusqlite` against a scratch file, so a later SQLite that behaves
//! differently fails here before it fails a promise of section 5.4.

// Integration-test helpers fail by panicking; clippy exempts only `#[test]` bodies themselves.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::path::Path;

use rusqlite::Connection;

const CANARY: &str = "zqxcanarybkdf";

fn bytes_hold(path: &Path, needle: &str) -> bool {
    std::fs::read(path)
        .unwrap_or_default()
        .windows(needle.len())
        .any(|w| w == needle.as_bytes())
}

fn wal_db(path: &Path) -> Connection {
    let conn = Connection::open(path).expect("open");
    conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0))
        .expect("WAL");
    conn.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))
        .expect("secure_delete");
    conn
}

/// Fill an FTS5 table `t(x)` with filler rows and one canary row, then delete the canary, then
/// `wal_checkpoint(TRUNCATE)`. Answers whether the canary is still in the database file.
fn delete_canary(table: &str, secure_delete: bool) -> bool {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("fts.sqlite3");
    let conn = wal_db(&path);
    conn.execute_batch(&format!("CREATE VIRTUAL TABLE t USING fts5({table});"))
        .expect("create");
    if secure_delete {
        conn.execute("INSERT INTO t (t, rank) VALUES ('secure-delete', 1)", [])
            .expect("secure-delete");
    }
    for n in 0..50 {
        conn.execute(
            "INSERT INTO t (rowid, x) VALUES (?1, ?2)",
            rusqlite::params![n, format!("filler words number {n}")],
        )
        .expect("filler");
    }
    conn.execute(
        "INSERT INTO t (rowid, x) VALUES (1000, ?1)",
        [format!("the {CANARY} row")],
    )
    .expect("the canary");
    conn.execute("DELETE FROM t WHERE rowid = 1000", [])
        .expect("delete");
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
        .expect("checkpoint");
    assert_eq!(busy, 0);
    drop(conn);
    bytes_hold(&path, CANARY)
}

#[test]
fn the_bundled_sqlite_is_the_version_the_specification_names() {
    let conn = Connection::open_in_memory().expect("open");
    let version: String = conn
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .expect("version");
    assert_eq!(
        version, "3.54.1",
        "a new bundled SQLite: re-run this file and re-check section 5.4"
    );
    let fts5: bool = conn
        .query_row("SELECT sqlite_compileoption_used('ENABLE_FTS5')", [], |r| {
            r.get(0)
        })
        .expect("compile options");
    assert!(fts5, "FTS5 is compiled in");
}

#[test]
fn an_ordinary_fts5_table_with_secure_delete_leaves_no_canary() {
    assert!(!delete_canary("x", true));
}

#[test]
fn without_secure_delete_the_ordinary_table_keeps_the_canary() {
    assert!(delete_canary("x", false), "the control finds it");
}

#[test]
fn a_contentless_delete_table_keeps_the_canary() {
    // Section 5.3's reason not to use one: the deleted term stays in the file.
    assert!(delete_canary("x, content='', contentless_delete=1", true));
}

#[test]
fn a_required_term_beside_a_plain_one_matches_only_the_required() {
    let conn = Connection::open_in_memory().expect("open");
    conn.execute_batch(
        "CREATE VIRTUAL TABLE t USING fts5(x);
         INSERT INTO t (rowid, x) VALUES (1, 'a'), (2, 'a b'), (3, 'b'), (4, 'c');
         INSERT INTO t (rowid, x) VALUES (5, 'd'), (6, 'e'), (7, 'f'), (8, 'g');",
    )
    .expect("rows");
    let mut stmt = conn
        .prepare("SELECT rowid FROM t WHERE t MATCH ?1 ORDER BY bm25(t), rowid")
        .expect("prepare");
    let hits: Vec<i64> = stmt
        .query_map([r#""a" AND ("a" OR "b")"#], |r| r.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");
    assert_eq!(hits, vec![2, 1], "only rows with a, the one with b first");
}

#[cfg(unix)]
#[test]
fn an_attach_copy_into_an_empty_private_file_holds_no_index_and_keeps_rowids() {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dir = tempfile::tempdir().expect("a temporary directory");
    let live = dir.path().join("live.sqlite3");
    let conn = wal_db(&live);
    conn.execute_batch(
        "CREATE TABLE kept (rowid INTEGER PRIMARY KEY, body BLOB);
         CREATE VIRTUAL TABLE fts USING fts5(x);
         PRAGMA user_version = 1;",
    )
    .expect("schema");
    for n in [3_i64, 7, 11] {
        conn.execute(
            "INSERT INTO kept (rowid, body) VALUES (?1, x'00010203')",
            [n],
        )
        .expect("kept");
        conn.execute(
            "INSERT INTO fts (rowid, x) VALUES (?1, ?2)",
            rusqlite::params![n, format!("{CANARY} {n}")],
        )
        .expect("fts");
    }
    let copy_dir = dir.path().join("copy");
    std::fs::create_dir(&copy_dir).expect("a destination");
    let copy = copy_dir.join("memory.sqlite3");
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&copy)
        .expect("an empty private file");
    conn.execute(
        "ATTACH DATABASE ?1 AS backup",
        [copy.to_str().expect("utf-8")],
    )
    .expect("attach");
    conn.execute_batch(
        "BEGIN;
         CREATE TABLE backup.kept (rowid INTEGER PRIMARY KEY, body BLOB);
         INSERT INTO backup.kept (rowid, body) SELECT rowid, body FROM main.kept;
         COMMIT;",
    )
    .expect("the copy");
    let copied_version: i64 = conn
        .query_row("PRAGMA backup.user_version", [], |r| r.get(0))
        .expect("user_version");
    assert_eq!(copied_version, 0, "nothing copies user_version");
    conn.execute_batch("PRAGMA backup.user_version = 1; DETACH DATABASE backup;")
        .expect("set and detach");
    // Only the copy is in the destination: no journal or temporary file is left.
    let left: Vec<_> = std::fs::read_dir(&copy_dir)
        .expect("listing")
        .map(|e| e.expect("an entry").file_name())
        .collect();
    assert_eq!(left, vec![std::ffi::OsString::from("memory.sqlite3")]);
    assert!(!bytes_hold(&copy, CANARY), "no index text in the copy");
    let mode = std::fs::metadata(&copy)
        .expect("metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "the mode is kept");
    let check = Connection::open(&copy).expect("open the copy");
    let rowids: Vec<i64> = check
        .prepare("SELECT rowid FROM kept ORDER BY rowid")
        .expect("prepare")
        .query_map([], |r| r.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows");
    assert_eq!(rowids, vec![3, 7, 11], "rowids are kept");
    let version: i64 = check
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("user_version");
    assert_eq!(version, 1);
}

#[test]
fn a_rollback_journal_file_with_secure_delete_forgets_a_nulled_key() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("memory.keys");
    let conn = Connection::open(&path).expect("open");
    let mode: String = conn
        .query_row("PRAGMA journal_mode = DELETE", [], |r| r.get(0))
        .expect("journal_mode");
    assert_eq!(mode, "delete");
    conn.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))
        .expect("secure_delete");
    conn.execute_batch(
        "CREATE TABLE record_keys (id TEXT PRIMARY KEY, key BLOB, destroyed_at INTEGER, \
         kind TEXT, settled INTEGER NOT NULL) WITHOUT ROWID;",
    )
    .expect("schema");
    let key: Vec<u8> = (0..32).map(|n| 0xA0 ^ n).collect();
    for n in 0..20 {
        let mut other = key.clone();
        other[0] = n;
        conn.execute(
            "INSERT INTO record_keys (id, key, settled) VALUES (?1, ?2, 1)",
            rusqlite::params![format!("mem-{n:024x}"), other],
        )
        .expect("a key");
    }
    conn.execute(
        "INSERT INTO record_keys (id, key, settled) VALUES ('mem-target', ?1, 1)",
        [&key],
    )
    .expect("the key");
    let hold = |p: &Path| {
        std::fs::read(p)
            .unwrap_or_default()
            .windows(key.len())
            .any(|w| w == key.as_slice())
    };
    assert!(hold(&path), "the key is in the file");
    conn.execute(
        "UPDATE record_keys SET key = NULL, destroyed_at = 1, kind = 'forget', settled = 0 \
         WHERE id = 'mem-target'",
        [],
    )
    .expect("destroy");
    assert!(!hold(&path), "the key's bytes left the file");
    drop(conn);
    let files: Vec<_> = std::fs::read_dir(dir.path())
        .expect("listing")
        .map(|e| e.expect("an entry").file_name())
        .collect();
    assert_eq!(
        files,
        vec![std::ffi::OsString::from("memory.keys")],
        "one file at rest"
    );
}

#[test]
fn a_checkpoint_is_refused_inside_a_transaction() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("wal.sqlite3");
    let mut conn = wal_db(&path);
    conn.execute_batch("CREATE TABLE t (x); INSERT INTO t VALUES (1);")
        .expect("a table");
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .expect("a transaction");
    tx.execute("INSERT INTO t VALUES (2)", []).expect("a write");
    let inside = tx.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| {
        r.get::<_, i64>(0)
    });
    assert!(
        !matches!(inside, Ok(0)),
        "a TRUNCATE checkpoint inside a transaction does not succeed: {inside:?}"
    );
    tx.commit().expect("commit");
    let outside: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
        .expect("outside");
    assert_eq!(outside, 0, "outside one it does");
}

#[test]
fn secure_delete_and_synchronous_are_per_connection() {
    let dir = tempfile::tempdir().expect("a temporary directory");
    let path = dir.path().join("pragmas.sqlite3");
    let first = wal_db(&path);
    first
        .pragma_update(None, "synchronous", "OFF")
        .expect("synchronous");
    let second = Connection::open(&path).expect("a second connection");
    let int = |conn: &Connection, pragma: &str| -> i64 {
        conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get(0))
            .expect("a pragma")
    };
    assert_eq!(int(&first, "secure_delete"), 1);
    assert_eq!(int(&second, "secure_delete"), 0, "not inherited");
    assert_eq!(int(&first, "synchronous"), 0);
    assert_ne!(int(&second, "synchronous"), 0, "not inherited");
}
