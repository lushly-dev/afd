//! The usage store (phase 5 specification, sections 10.2 and 12.1; D122, owner decision 13):
//! `state/usage/usage.sqlite3`, where every process behind one URL appends its usage events and
//! from which `usage-list` reads them.
//!
//! **What a row holds**: one `usage-event.v1` record, checked against the schema by the writer
//! before it is appended ([`crate::usage`]), beside the columns it is found by: its time, its
//! principal and actor strings, its method, task id and command. Never an input, a result, a
//! token or anything else a request carried: the record has no field for one.
//!
//! **Drops.** A record the host could not write (its queue was full, or the store failed) is
//! counted, and the count is added to `drops`, by the minute, with the next append that succeeds.
//! Only the operator and `usage.readers` read it ([`UsageStore::dropped`]).
//!
//! **Retention.** A row older than `usage.retention_days` is never read, and is purged by the next
//! append or purge of any process: every append purges at most [`PURGE_BATCH`] rows, the writer
//! purges at start and every hour, with `secure_delete` on, and then truncates the write-ahead log
//! (`wal_checkpoint(TRUNCATE)`), so a purged record is left in neither file.
//!
//! The file is WAL, `synchronous = FULL`, mode 0600 in a 0700 `state/usage/`, schema
//! `user_version` 1. A writer opens it on first use; a reader never creates it, so a workspace
//! that never served HTTP has none. A lock wait past `store.lock_timeout_ms` is
//! [`SharedError::Timeout`], any other failure [`SharedError::Failed`].

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde_json::Value;

use super::SharedError;
use crate::workspace::WorkspaceError;

/// The store's name in errors and logs (`details.store`).
pub(crate) const STORE: &str = "usage";
/// The schema version this host writes (`PRAGMA user_version`).
const SCHEMA_VERSION: i64 = 1;
/// The most rows one append or purge removes.
pub(crate) const PURGE_BATCH: i64 = 4096;
/// One day in milliseconds.
pub(crate) const DAY_MS: i64 = 86_400_000;
/// One minute, the drop counts' bucket.
const MINUTE_MS: i64 = 60_000;

/// Whose records a read may return.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Readable {
    /// Every record (the operator, `usage.readers`).
    All,
    /// Only the records whose principal is one of these (the caller and the legacy principals
    /// it stands for); none when the list is empty.
    Own(Vec<String>),
}

/// One page's question.
#[derive(Debug, Clone)]
pub(crate) struct UsageQuery {
    /// Whose records may be returned.
    pub(crate) readable: Readable,
    /// Only this principal's, within what is readable.
    pub(crate) principal: Option<String>,
    /// Only records at or after this time.
    pub(crate) since_ms: Option<i64>,
    /// Only records before this time.
    pub(crate) until_ms: Option<i64>,
    /// Only records appended before this position (a cursor's).
    pub(crate) before: Option<i64>,
    /// At most this many.
    pub(crate) limit: usize,
    /// Nothing older than this is ever returned (the retention).
    pub(crate) keep_from_ms: i64,
}

/// One page: the records, newest first, each with its position, and whether more follow.
#[derive(Debug, Clone, Default)]
pub(crate) struct UsagePage {
    pub(crate) rows: Vec<(i64, Value)>,
    pub(crate) more: bool,
}

/// The command and space a task's creation recorded.
pub(crate) type Creation = (Option<String>, Option<String>);

/// The usage store (section 10.2). A networked backend for several machines implements the same
/// trait (phase 6).
pub(crate) trait UsageStore: Send + Sync {
    /// Append `records` (each a `usage-event.v1` record) and add `dropped` to the drop count of
    /// the minute of `now_ms`, in one transaction; purge at most [`PURGE_BATCH`] rows older than
    /// `keep_from_ms`.
    ///
    /// # Errors
    /// [`SharedError::Timeout`] when another process held the store past the lock timeout,
    /// [`SharedError::Failed`] otherwise; nothing is appended.
    fn append(
        &self,
        records: &[Value],
        dropped: u64,
        now_ms: i64,
        keep_from_ms: i64,
    ) -> Result<(), SharedError>;

    /// The command and space of the `tools/call` by `principal` and `actor` that created task
    /// `task`, if one was recorded: a poll of a task is metered with its task's command.
    ///
    /// # Errors
    /// As [`Self::append`].
    fn creation(
        &self,
        task: &str,
        principal: &str,
        actor: &str,
    ) -> Result<Option<Creation>, SharedError>;

    /// One page of the records `query` asks for, newest first. An absent store is an empty one.
    ///
    /// # Errors
    /// As [`Self::append`].
    fn list(&self, query: &UsageQuery) -> Result<UsagePage, SharedError>;

    /// The records dropped since `keep_from_ms`.
    ///
    /// # Errors
    /// As [`Self::append`].
    fn dropped(&self, keep_from_ms: i64) -> Result<u64, SharedError>;

    /// Purge at most [`PURGE_BATCH`] rows older than `keep_from_ms`; returns how many. An absent
    /// store purges nothing and is not created.
    ///
    /// # Errors
    /// As [`Self::append`].
    fn purge(&self, keep_from_ms: i64) -> Result<u64, SharedError>;
}

/// The SQLite usage store: `state/usage/usage.sqlite3`.
pub(crate) struct SqliteUsage {
    path: PathBuf,
    lock_timeout_ms: u64,
    connection: Mutex<Option<Connection>>,
    /// A read-only connection: a read never takes the write lock, so it neither waits for nor
    /// times out on another process's append.
    reader: Mutex<Option<Connection>>,
    /// A purge whose log truncation has not finished yet: every later write tries it again.
    truncation_owed: std::sync::atomic::AtomicBool,
}

impl std::fmt::Debug for SqliteUsage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteUsage").finish_non_exhaustive()
    }
}

fn shared_error(error: &rusqlite::Error) -> SharedError {
    match error.sqlite_error_code() {
        Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => {
            SharedError::Timeout { store: STORE }
        }
        _ => SharedError::Failed {
            store: STORE,
            message: error.to_string(),
        },
    }
}

fn failed(error: &dyn std::fmt::Display) -> SharedError {
    SharedError::Failed {
        store: STORE,
        message: error.to_string(),
    }
}

/// A text member of `record`.
fn text<'a>(record: &'a Value, member: &str) -> Option<&'a str> {
    record.get(member).and_then(Value::as_str)
}

/// The time of a record's `at`, in epoch milliseconds.
fn at_ms(record: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(text(record, "at")?)
        .ok()
        .map(|at| at.timestamp_millis())
}

/// Copy the write-ahead log into the database and truncate it, so a purged record's bytes, which
/// `secure_delete` zeroes in the database, are left in the log neither. `true` when it finished:
/// a reader (in any process) holding an older snapshot keeps the log from being reset, and then
/// the store tries again after its next write, until it finishes.
fn truncate_log(connection: &Connection) -> bool {
    connection
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .is_ok_and(|(busy, log)| busy == 0 && log <= 0)
}

/// Purge at most [`PURGE_BATCH`] rows, and the drop counts, older than `keep_from_ms`.
fn purge_in(
    transaction: &rusqlite::Transaction<'_>,
    keep_from_ms: i64,
) -> Result<u64, SharedError> {
    let rows = transaction
        .execute(
            "DELETE FROM usage WHERE seq IN
                 (SELECT seq FROM usage WHERE at_ms < ?1 ORDER BY at_ms LIMIT ?2)",
            params![keep_from_ms, PURGE_BATCH],
        )
        .map_err(|error| shared_error(&error))?;
    let drops = transaction
        .execute(
            "DELETE FROM drops WHERE minute_ms + ?2 <= ?1",
            params![keep_from_ms, MINUTE_MS],
        )
        .map_err(|error| shared_error(&error))?;
    Ok((rows + drops) as u64)
}

impl SqliteUsage {
    /// The store at `path`, waiting up to `lock_timeout_ms` for another process's write. Nothing
    /// is opened until the first use.
    pub(crate) fn new(path: &Path, lock_timeout_ms: u64) -> Self {
        Self {
            path: path.to_path_buf(),
            lock_timeout_ms,
            connection: Mutex::new(None),
            reader: Mutex::new(None),
            truncation_owed: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// After a write that purged `purged` rows: truncate the log when this purge, or an earlier
    /// one, left something in it.
    fn settle_log(&self, connection: &Connection, purged: u64) {
        use std::sync::atomic::Ordering;
        if purged > 0 || self.truncation_owed.load(Ordering::SeqCst) {
            self.truncation_owed
                .store(!truncate_log(connection), Ordering::SeqCst);
        }
    }

    /// Run `work` on a read-only connection; `Ok(None)` when the store is absent, or was created
    /// by a writer that has not yet made its tables.
    fn read<T>(
        &self,
        work: impl FnOnce(&Connection) -> Result<T, SharedError>,
    ) -> Result<Option<T>, SharedError> {
        let mut guard = self
            .reader
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            if !self.path.is_file() {
                return Ok(None);
            }
            let connection = Connection::open_with_flags(
                &self.path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|error| shared_error(&error))?;
            connection
                .busy_timeout(Duration::from_millis(self.lock_timeout_ms))
                .map_err(|error| shared_error(&error))?;
            *guard = Some(connection);
        }
        let Some(connection) = guard.as_ref() else {
            return Err(failed(&"the store is not open"));
        };
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| shared_error(&error))?;
        match version {
            SCHEMA_VERSION => work(connection).map(Some),
            0 => Ok(None),
            other => Err(failed(&format!(
                "the store has schema version {other}; this host reads {SCHEMA_VERSION}"
            ))),
        }
    }

    /// Run `work` on the open store, opening it first (creating it when `create`); `Ok(None)`
    /// when it is absent and not to be created.
    fn with<T>(
        &self,
        create: bool,
        work: impl FnOnce(&mut Connection) -> Result<T, SharedError>,
    ) -> Result<Option<T>, SharedError> {
        // A poisoned lock means a panic mid-call; its transaction was rolled back when dropped.
        let mut guard = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            if !create && !self.path.is_file() {
                return Ok(None);
            }
            *guard = Some(self.open_patiently()?);
        }
        let Some(connection) = guard.as_mut() else {
            return Err(failed(&"the store is not open"));
        };
        work(connection).map(Some)
    }

    /// Open the store, waiting up to the lock timeout while other processes opening it at the
    /// same moment hold it: then [`SharedError::Timeout`]; any other failure at once.
    fn open_patiently(&self) -> Result<Connection, SharedError> {
        let deadline =
            std::time::Instant::now() + Duration::from_millis(self.lock_timeout_ms.max(1));
        loop {
            match self.open() {
                Ok(connection) => return Ok(connection),
                Err(error) => {
                    let text = error.to_string();
                    let busy =
                        text.contains("database is locked") || text.contains("database is busy");
                    if !busy {
                        return Err(failed(&error));
                    }
                    if std::time::Instant::now() >= deadline {
                        return Err(SharedError::Timeout { store: STORE });
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        }
    }

    /// Open (creating when missing) the store.
    fn open(&self) -> Result<Connection, WorkspaceError> {
        let path = &self.path;
        let unwritable = |error: &dyn std::fmt::Display| WorkspaceError::unwritable(path, error);
        if let Some(dir) = path.parent() {
            // `state/usage/` is made inside the workspace's `state/`, never with it: a writer that
            // outlives its workspace (removed while a record was queued) fails, rather than
            // recreating the directories it was in.
            if !dir.parent().is_some_and(Path::is_dir) {
                return Err(unwritable(
                    &"the workspace's state directory does not exist",
                ));
            }
            super::ensure_dir(dir)?;
        }
        super::ensure_private_file(path)?;
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| unwritable(&error))?;
        connection
            .busy_timeout(Duration::from_millis(self.lock_timeout_ms))
            .map_err(|error| unwritable(&error))?;
        let mode: String = connection
            .query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(unwritable(&format!(
                "the store could not enter WAL mode (it reports {mode})"
            )));
        }
        connection
            .execute_batch(
                "PRAGMA synchronous = FULL;
                 PRAGMA secure_delete = ON;
                 BEGIN IMMEDIATE;
                 CREATE TABLE IF NOT EXISTS usage (
                     seq INTEGER PRIMARY KEY AUTOINCREMENT,
                     id TEXT NOT NULL UNIQUE,
                     at_ms INTEGER NOT NULL,
                     principal TEXT,
                     actor TEXT,
                     method TEXT NOT NULL,
                     task TEXT,
                     command TEXT,
                     record TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS usage_at ON usage (at_ms);
                 CREATE INDEX IF NOT EXISTS usage_principal ON usage (principal, seq);
                 CREATE INDEX IF NOT EXISTS usage_task ON usage (task) WHERE task IS NOT NULL;
                 CREATE TABLE IF NOT EXISTS drops (
                     minute_ms INTEGER PRIMARY KEY NOT NULL,
                     count INTEGER NOT NULL
                 ) WITHOUT ROWID;
                 COMMIT;",
            )
            .map_err(|error| unwritable(&error))?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        match version {
            0 => connection
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
                .map_err(|error| unwritable(&error))?,
            SCHEMA_VERSION => {}
            other => {
                return Err(unwritable(&format!(
                    "the store has schema version {other}; this host reads {SCHEMA_VERSION}"
                )));
            }
        }
        Ok(connection)
    }
}

impl UsageStore for SqliteUsage {
    fn append(
        &self,
        records: &[Value],
        dropped: u64,
        now_ms: i64,
        keep_from_ms: i64,
    ) -> Result<(), SharedError> {
        self.with(true, |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            for record in records {
                let (Some(id), Some(at), Some(method)) =
                    (text(record, "id"), at_ms(record), text(record, "method"))
                else {
                    return Err(failed(&"a record without its id, time or method"));
                };
                let body = serde_json::to_string(record).map_err(|error| failed(&error))?;
                transaction
                    .execute(
                        "INSERT INTO usage (id, at_ms, principal, actor, method, task, command, record)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            id,
                            at,
                            text(record, "principal"),
                            text(record, "actor"),
                            method,
                            text(record, "task"),
                            text(record, "command"),
                            body
                        ],
                    )
                    .map_err(|error| shared_error(&error))?;
            }
            if dropped > 0 {
                let minute = now_ms.div_euclid(MINUTE_MS) * MINUTE_MS;
                transaction
                    .execute(
                        "INSERT INTO drops (minute_ms, count) VALUES (?1, ?2)
                         ON CONFLICT (minute_ms) DO UPDATE SET count = count + excluded.count",
                        params![minute, i64::try_from(dropped).unwrap_or(i64::MAX)],
                    )
                    .map_err(|error| shared_error(&error))?;
            }
            let purged = purge_in(&transaction, keep_from_ms)?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            self.settle_log(connection, purged);
            Ok(())
        })
        .map(|_| ())
    }

    fn creation(
        &self,
        task: &str,
        principal: &str,
        actor: &str,
    ) -> Result<Option<Creation>, SharedError> {
        self.read(|connection| {
            let record: Option<String> = connection
                .query_row(
                    "SELECT record FROM usage
                     WHERE task = ?1 AND principal = ?2 AND actor = ?3 AND method = 'tools/call'
                     ORDER BY seq LIMIT 1",
                    params![task, principal, actor],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| shared_error(&error))?;
            Ok(record
                .and_then(|record| serde_json::from_str::<Value>(&record).ok())
                .map(|record| {
                    (
                        text(&record, "command").map(str::to_owned),
                        text(&record, "space").map(str::to_owned),
                    )
                }))
        })
        .map(Option::flatten)
    }

    fn list(&self, query: &UsageQuery) -> Result<UsagePage, SharedError> {
        if query.limit == 0 {
            return Ok(UsagePage::default());
        }
        // The principals whose records are asked for; `None` for everyone's.
        let principals: Option<Vec<String>> = match (&query.readable, &query.principal) {
            (Readable::All, None) => None,
            (Readable::All, Some(principal)) => Some(vec![principal.clone()]),
            (Readable::Own(own), None) => Some(own.clone()),
            (Readable::Own(own), Some(principal)) => {
                Some(own.iter().filter(|p| *p == principal).cloned().collect())
            }
        };
        if principals.as_ref().is_some_and(Vec::is_empty) {
            return Ok(UsagePage::default());
        }
        let page = self.read(|connection| {
            let mut sql = String::from("SELECT seq, record FROM usage WHERE at_ms >= ?1");
            let mut values: Vec<rusqlite::types::Value> = vec![query.keep_from_ms.into()];
            if let Some(since) = query.since_ms {
                values.push(since.into());
                sql.push_str(&format!(" AND at_ms >= ?{}", values.len()));
            }
            if let Some(until) = query.until_ms {
                values.push(until.into());
                sql.push_str(&format!(" AND at_ms < ?{}", values.len()));
            }
            if let Some(before) = query.before {
                values.push(before.into());
                sql.push_str(&format!(" AND seq < ?{}", values.len()));
            }
            if let Some(principals) = &principals {
                let mut marks = Vec::new();
                for principal in principals {
                    values.push(principal.clone().into());
                    marks.push(format!("?{}", values.len()));
                }
                sql.push_str(&format!(" AND principal IN ({})", marks.join(", ")));
            }
            let wanted = query.limit.saturating_add(1);
            values.push(i64::try_from(wanted).unwrap_or(i64::MAX).into());
            sql.push_str(&format!(" ORDER BY seq DESC LIMIT ?{}", values.len()));
            let mut statement = connection
                .prepare(&sql)
                .map_err(|error| shared_error(&error))?;
            let rows = statement
                .query_map(rusqlite::params_from_iter(values), |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| shared_error(&error))?;
            let mut out = Vec::new();
            for row in rows {
                let (seq, record) = row.map_err(|error| shared_error(&error))?;
                let record: Value =
                    serde_json::from_str(&record).map_err(|error| failed(&error))?;
                out.push((seq, record));
            }
            let more = out.len() > query.limit;
            out.truncate(query.limit);
            Ok(UsagePage { rows: out, more })
        })?;
        Ok(page.unwrap_or_default())
    }

    fn dropped(&self, keep_from_ms: i64) -> Result<u64, SharedError> {
        let count = self.read(|connection| {
            connection
                .query_row(
                    "SELECT COALESCE(SUM(count), 0) FROM drops WHERE minute_ms + ?2 > ?1",
                    params![keep_from_ms, MINUTE_MS],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(|error| shared_error(&error))
        })?;
        Ok(count.map_or(0, |count| u64::try_from(count).unwrap_or(0)))
    }

    fn purge(&self, keep_from_ms: i64) -> Result<u64, SharedError> {
        let purged = self.with(false, |connection| {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| shared_error(&error))?;
            let purged = purge_in(&transaction, keep_from_ms)?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            self.settle_log(connection, purged);
            Ok(purged)
        })?;
        Ok(purged.unwrap_or(0))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    fn store(dir: &Path) -> SqliteUsage {
        SqliteUsage::new(&dir.join("usage").join("usage.sqlite3"), 1_000)
    }

    fn record(id: &str, at: &str, principal: Option<&str>) -> Value {
        json!({
            "version": 1, "id": id, "at": at, "trace": null,
            "principal": principal, "actor": principal, "namespace": null,
            "transport": "http", "method": "tools/call", "tool": "workspace-show",
            "command": "workspace-show", "space": null, "outcome": "ok",
            "bytesIn": 1, "bytesOut": 2, "durationMs": 3, "task": null,
        })
    }

    const T0: &str = "2026-11-03T10:00:00.000Z";
    const T0_MS: i64 = 1_793_700_000_000;

    fn all(limit: usize) -> UsageQuery {
        UsageQuery {
            readable: Readable::All,
            principal: None,
            since_ms: None,
            until_ms: None,
            before: None,
            limit,
            keep_from_ms: 0,
        }
    }

    #[test]
    fn a_reader_never_creates_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let usage = store(dir.path());
        assert!(usage.list(&all(10)).unwrap().rows.is_empty());
        assert_eq!(usage.dropped(0).unwrap(), 0);
        assert_eq!(usage.purge(i64::MAX).unwrap(), 0);
        assert_eq!(usage.creation("t", "p", "a").unwrap(), None);
        assert!(!dir.path().join("usage").exists());
    }

    #[test]
    fn records_read_back_newest_first_and_only_the_readable_ones() {
        let dir = tempfile::tempdir().unwrap();
        let usage = store(dir.path());
        assert_eq!(at_ms(&record("u-a", T0, None)), Some(T0_MS));
        usage
            .append(
                &[
                    record("u-1", T0, Some("human:ada")),
                    record("u-2", T0, Some("human:bo")),
                    record("u-3", T0, Some("human:ada")),
                ],
                0,
                T0_MS,
                0,
            )
            .unwrap();
        let ids = |page: UsagePage| -> Vec<String> {
            page.rows
                .iter()
                .map(|(_, r)| r["id"].as_str().unwrap().to_owned())
                .collect()
        };
        assert_eq!(ids(usage.list(&all(10)).unwrap()), ["u-3", "u-2", "u-1"]);
        let own = UsageQuery {
            readable: Readable::Own(vec!["human:ada".into()]),
            ..all(1)
        };
        let first = usage.list(&own).unwrap();
        assert!(first.more);
        let before = first.rows[0].0;
        assert_eq!(ids(first), ["u-3"]);
        let second = usage
            .list(&UsageQuery {
                before: Some(before),
                ..own.clone()
            })
            .unwrap();
        assert!(!second.more);
        assert_eq!(ids(second), ["u-1"]);
        // A filter naming someone the reader may not read finds nothing, as one naming no one.
        let other = UsageQuery {
            principal: Some("human:bo".into()),
            ..own.clone()
        };
        assert!(usage.list(&other).unwrap().rows.is_empty());
        let none = UsageQuery {
            readable: Readable::Own(Vec::new()),
            ..all(10)
        };
        assert!(usage.list(&none).unwrap().rows.is_empty());
    }

    #[test]
    fn retention_hides_then_purges_from_the_database_and_its_log() {
        let dir = tempfile::tempdir().unwrap();
        let usage = store(dir.path());
        let canary = "human:corp/canary-principal";
        usage
            .append(&[record("u-old", T0, Some(canary))], 3, T0_MS, 0)
            .unwrap();
        let file = dir.path().join("usage").join("usage.sqlite3");
        let read = |name: &str| std::fs::read(file.with_file_name(name)).unwrap_or_default();
        let held = |bytes: &[u8]| String::from_utf8_lossy(bytes).contains(canary);
        assert!(held(&read("usage.sqlite3")) || held(&read("usage.sqlite3-wal")));
        assert_eq!(usage.dropped(0).unwrap(), 3);
        // Past retention it is never read, even before a purge.
        let later = UsageQuery {
            keep_from_ms: T0_MS + 1,
            ..all(10)
        };
        assert!(usage.list(&later).unwrap().rows.is_empty());
        assert_eq!(usage.dropped(T0_MS + MINUTE_MS).unwrap(), 0);
        assert_eq!(usage.purge(T0_MS + MINUTE_MS).unwrap(), 2);
        assert!(usage.list(&all(10)).unwrap().rows.is_empty());
        assert!(!held(&read("usage.sqlite3")), "the database");
        assert!(!held(&read("usage.sqlite3-wal")), "the log");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&dir.path().join("usage")), 0o700);
            assert_eq!(mode(&file), 0o600);
        }
    }

    #[test]
    fn a_truncation_a_reader_held_up_is_finished_by_the_next_write() {
        let dir = tempfile::tempdir().unwrap();
        let usage = SqliteUsage::new(&dir.path().join("usage").join("usage.sqlite3"), 50);
        let canary = "human:corp/canary-held";
        usage
            .append(&[record("u-old", T0, Some(canary))], 0, T0_MS, 0)
            .unwrap();
        let file = dir.path().join("usage").join("usage.sqlite3");
        let held = || {
            ["usage.sqlite3", "usage.sqlite3-wal"].iter().any(|name| {
                String::from_utf8_lossy(
                    &std::fs::read(file.with_file_name(name)).unwrap_or_default(),
                )
                .contains(canary)
            })
        };
        // Another process reads from a snapshot taken before the purge.
        let reader = Connection::open(&file).unwrap();
        reader
            .execute_batch("BEGIN; SELECT COUNT(*) FROM usage;")
            .unwrap();
        assert_eq!(usage.purge(T0_MS + 1).unwrap(), 1);
        assert!(held(), "the reader's snapshot keeps the log");
        assert!(
            usage
                .truncation_owed
                .load(std::sync::atomic::Ordering::SeqCst)
        );
        reader.execute_batch("COMMIT").unwrap();
        drop(reader);
        // A later write with nothing to purge still finishes the truncation.
        usage
            .append(&[record("u-new", T0, Some("human:ada"))], 0, T0_MS + 2, 0)
            .unwrap();
        assert!(!held(), "a purged record left in the database or its log");
        assert!(
            !usage
                .truncation_owed
                .load(std::sync::atomic::Ordering::SeqCst)
        );
    }

    #[test]
    fn a_writer_never_recreates_a_workspace_that_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        let state = dir.path().join("state");
        let usage = SqliteUsage::new(&state.join("usage").join("usage.sqlite3"), 50);
        assert!(matches!(
            usage.append(&[record("u-1", T0, None)], 0, T0_MS, 0),
            Err(SharedError::Failed { .. })
        ));
        assert!(!state.exists(), "the state directory was made");
        std::fs::create_dir(&state).unwrap();
        usage
            .append(&[record("u-1", T0, None)], 0, T0_MS, 0)
            .unwrap();
        assert!(state.join("usage").is_dir());
    }

    #[test]
    fn a_task_s_creation_is_found_for_its_own_principal_and_actor_only() {
        let dir = tempfile::tempdir().unwrap();
        let usage = store(dir.path());
        let mut created = record("u-c", T0, Some("human:ada"));
        created["task"] = json!("abcdefghijklmnopqrstuvwxyz");
        created["command"] = json!("job-wait");
        created["space"] = json!("main");
        usage.append(&[created], 0, T0_MS, 0).unwrap();
        let task = "abcdefghijklmnopqrstuvwxyz";
        assert_eq!(
            usage.creation(task, "human:ada", "human:ada").unwrap(),
            Some((Some("job-wait".into()), Some("main".into())))
        );
        assert_eq!(usage.creation(task, "human:bo", "human:ada").unwrap(), None);
        assert_eq!(usage.creation(task, "human:ada", "agent:x").unwrap(), None);
    }

    #[test]
    fn a_held_store_times_out_and_appends_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage").join("usage.sqlite3");
        let quick = SqliteUsage::new(&path, 50);
        quick.append(&[], 0, T0_MS, 0).unwrap();
        let holder = Connection::open(&path).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert_eq!(
            quick
                .append(&[record("u-1", T0, None)], 0, T0_MS, 0)
                .unwrap_err(),
            SharedError::Timeout { store: STORE }
        );
        holder.execute_batch("ROLLBACK").unwrap();
        assert!(quick.list(&all(10)).unwrap().rows.is_empty());
    }

    #[test]
    fn a_read_never_waits_on_another_process_s_write() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage").join("usage.sqlite3");
        let writer = SqliteUsage::new(&path, 50);
        writer
            .append(&[record("u-1", T0, Some("human:ada"))], 2, T0_MS, 0)
            .unwrap();
        // Another process holds the write lock; a reader that opens now still answers at once,
        // so neither its time nor its failure says that someone else is writing.
        let holder = Connection::open(&path).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        let reader = SqliteUsage::new(&path, 50);
        assert_eq!(reader.list(&all(10)).unwrap().rows.len(), 1);
        assert_eq!(reader.dropped(0).unwrap(), 2);
        assert_eq!(reader.creation("t", "p", "a").unwrap(), None);
        holder.execute_batch("ROLLBACK").unwrap();
    }
}
