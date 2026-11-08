//! The limit counters (phase 5 specification, section 11; D128), shared by every process behind
//! one URL in `state/shared/limits.sqlite3` (section 10.2).
//!
//! A limit of `n` per window admits at most `n` requests for one key in **any** window-long
//! interval: every admitted request is one row stamped with its time, and a request is admitted
//! only while fewer than `n` rows of its key fall within the window ending now. A refused request
//! writes nothing, so a caller over its limit cannot grow the store. Rows hold a key and two
//! times: no content, no token and no identity beyond the key's own text (for the IP limit, an
//! address). Every write purges at most 64 rows whose window has passed.
//!
//! The check and the insert are one `BEGIN IMMEDIATE` transaction, so two processes cannot both
//! admit the last request of a window.
//!
//! **Byte counters** (schema version 2, phase 5 step 3) hold `read_bytes_per_minute`: one row per
//! call with the bytes of its result, checked before the next call of the key on the bytes already
//! counted in the window, so a call's own result is never withheld after it ran.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, OptionalExtension, TransactionBehavior, params};

use super::SharedError;
use crate::workspace::WorkspaceError;

/// The store's name in errors and logs (`details.store`).
const STORE: &str = "limits";
/// The schema version this host writes (`PRAGMA user_version`).
const SCHEMA_VERSION: i64 = 2;
/// The most expired rows one write purges.
const PURGE_BATCH: i64 = 64;

/// What a limit decided for one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Admission {
    /// Under the limit: the request was counted.
    Allowed,
    /// At the limit: nothing was counted. A request at `retry_after_ms` from now is the earliest
    /// that the window can admit.
    Refused {
        /// Milliseconds until the oldest counted request that holds the key at its limit leaves
        /// the window; at least 1.
        retry_after_ms: i64,
    },
}

/// The limit counters' store (section 10.2). A networked backend for several machines implements
/// the same trait (phase 6).
pub(crate) trait LimitStore: Send + Sync {
    /// Count one request against `key` at `now_ms` when fewer than `limit` requests of `key` were
    /// counted in the `window_ms` before it, atomically across every process sharing the store.
    ///
    /// # Errors
    /// [`SharedError::Timeout`] when another process held the store past the lock timeout,
    /// [`SharedError::Failed`] when the store cannot be read or written. The caller fails closed.
    fn hit(
        &self,
        key: &str,
        limit: u64,
        window_ms: i64,
        now_ms: i64,
    ) -> Result<Admission, SharedError>;

    /// Whether `key` may make another call at `now_ms`: refused once the bytes counted for it in
    /// the `window_ms` before reach `limit`, until enough of them leave the window. Counts nothing.
    ///
    /// # Errors
    /// As [`Self::hit`].
    fn bytes_admit(
        &self,
        key: &str,
        limit: u64,
        window_ms: i64,
        now_ms: i64,
    ) -> Result<Admission, SharedError>;

    /// Count `bytes` against `key` at `now_ms`, for `window_ms`.
    ///
    /// # Errors
    /// As [`Self::hit`].
    fn bytes_add(
        &self,
        key: &str,
        bytes: u64,
        window_ms: i64,
        now_ms: i64,
    ) -> Result<(), SharedError>;
}

/// The SQLite limit store: `state/shared/limits.sqlite3`, WAL, mode 0600.
pub(crate) struct SqliteLimits {
    connection: Mutex<Connection>,
}

impl std::fmt::Debug for SqliteLimits {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteLimits").finish_non_exhaustive()
    }
}

impl SqliteLimits {
    /// Open (creating when missing) the store at `path`, waiting up to `lock_timeout_ms` for
    /// another process's write.
    ///
    /// # Errors
    /// `WORKSPACE_STATE_UNWRITABLE` when the file cannot be created, opened or set up, or holds
    /// a schema this host does not know.
    pub(crate) fn open(path: &Path, lock_timeout_ms: u64) -> Result<Self, WorkspaceError> {
        let unwritable = |error: &dyn std::fmt::Display| WorkspaceError::unwritable(path, error);
        if let Some(dir) = path.parent() {
            super::ensure_dir(dir)?;
        }
        super::ensure_private_file(path)?;
        let connection = Connection::open(path).map_err(|error| unwritable(&error))?;
        connection
            .busy_timeout(Duration::from_millis(lock_timeout_ms))
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
                "PRAGMA synchronous = NORMAL;
                 PRAGMA secure_delete = ON;
                 BEGIN IMMEDIATE;
                 CREATE TABLE IF NOT EXISTS hits (
                     key TEXT NOT NULL,
                     at_ms INTEGER NOT NULL,
                     expires_ms INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS hits_key_at ON hits (key, at_ms);
                 CREATE INDEX IF NOT EXISTS hits_expires ON hits (expires_ms);
                 CREATE TABLE IF NOT EXISTS bytes (
                     key TEXT NOT NULL,
                     at_ms INTEGER NOT NULL,
                     amount INTEGER NOT NULL,
                     expires_ms INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS bytes_key_at ON bytes (key, at_ms);
                 CREATE INDEX IF NOT EXISTS bytes_expires ON bytes (expires_ms);
                 COMMIT;",
            )
            .map_err(|error| unwritable(&error))?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| unwritable(&error))?;
        match version {
            // Version 1 had the request counters only; the byte counters were just created.
            0 | 1 => connection
                .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
                .map_err(|error| unwritable(&error))?,
            SCHEMA_VERSION => {}
            other => {
                return Err(unwritable(&format!(
                    "the store has schema version {other}; this host reads {SCHEMA_VERSION}"
                )));
            }
        }
        // Rows whose window has passed are purged now, all of them, so peer addresses do not
        // outlive their use when traffic stopped before later writes could purge them.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| {
                i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
            });
        connection
            .execute("DELETE FROM hits WHERE expires_ms <= ?1", params![now])
            .map_err(|error| unwritable(&error))?;
        connection
            .execute("DELETE FROM bytes WHERE expires_ms <= ?1", params![now])
            .map_err(|error| unwritable(&error))?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
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

impl LimitStore for SqliteLimits {
    fn hit(
        &self,
        key: &str,
        limit: u64,
        window_ms: i64,
        now_ms: i64,
    ) -> Result<Admission, SharedError> {
        // A poisoned lock means a panic mid-call; the connection itself is still usable, and the
        // transaction it held was rolled back when it was dropped.
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| shared_error(&error))?;
        let since = now_ms.saturating_sub(window_ms);
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let counted: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM hits WHERE key = ?1 AND at_ms > ?2",
                params![key, since],
                |row| row.get(0),
            )
            .map_err(|error| shared_error(&error))?;
        if counted >= limit {
            // The window admits again once `counted - limit + 1` of these rows have left it: the
            // row at offset `counted - limit` in time order is the last of them.
            let holding: Option<i64> = transaction
                .query_row(
                    "SELECT at_ms FROM hits WHERE key = ?1 AND at_ms > ?2
                     ORDER BY at_ms LIMIT 1 OFFSET ?3",
                    params![key, since, counted - limit],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| shared_error(&error))?;
            transaction.commit().map_err(|error| shared_error(&error))?;
            let leaves = holding.unwrap_or(now_ms).saturating_add(window_ms);
            return Ok(Admission::Refused {
                retry_after_ms: leaves.saturating_sub(now_ms).max(1),
            });
        }
        transaction
            .execute(
                "INSERT INTO hits (key, at_ms, expires_ms) VALUES (?1, ?2, ?3)",
                params![key, now_ms, now_ms.saturating_add(window_ms)],
            )
            .map_err(|error| shared_error(&error))?;
        transaction
            .execute(
                "DELETE FROM hits WHERE rowid IN
                     (SELECT rowid FROM hits WHERE expires_ms <= ?1 LIMIT ?2)",
                params![now_ms, PURGE_BATCH],
            )
            .map_err(|error| shared_error(&error))?;
        transaction.commit().map_err(|error| shared_error(&error))?;
        Ok(Admission::Allowed)
    }

    fn bytes_admit(
        &self,
        key: &str,
        limit: u64,
        window_ms: i64,
        now_ms: i64,
    ) -> Result<Admission, SharedError> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let since = now_ms.saturating_sub(window_ms);
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let mut statement = connection
            .prepare_cached(
                "SELECT at_ms, amount FROM bytes WHERE key = ?1 AND at_ms > ?2 ORDER BY at_ms",
            )
            .map_err(|error| shared_error(&error))?;
        let rows: Vec<(i64, i64)> = statement
            .query_map(params![key, since], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| shared_error(&error))?
            .collect::<Result<_, _>>()
            .map_err(|error| shared_error(&error))?;
        let mut total: i64 = rows
            .iter()
            .fold(0, |sum, (_, amount)| sum.saturating_add(*amount));
        if total < limit {
            return Ok(Admission::Allowed);
        }
        // The window admits again once enough of the oldest rows have left it that the rest
        // count fewer than `limit` bytes.
        let mut leaves = now_ms.saturating_add(window_ms);
        for (at, amount) in &rows {
            total = total.saturating_sub(*amount);
            if total < limit {
                leaves = at.saturating_add(window_ms);
                break;
            }
        }
        Ok(Admission::Refused {
            retry_after_ms: leaves.saturating_sub(now_ms).max(1),
        })
    }

    fn bytes_add(
        &self,
        key: &str,
        bytes: u64,
        window_ms: i64,
        now_ms: i64,
    ) -> Result<(), SharedError> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| shared_error(&error))?;
        transaction
            .execute(
                "INSERT INTO bytes (key, at_ms, amount, expires_ms) VALUES (?1, ?2, ?3, ?4)",
                params![
                    key,
                    now_ms,
                    i64::try_from(bytes).unwrap_or(i64::MAX),
                    now_ms.saturating_add(window_ms)
                ],
            )
            .map_err(|error| shared_error(&error))?;
        transaction
            .execute(
                "DELETE FROM bytes WHERE rowid IN
                     (SELECT rowid FROM bytes WHERE expires_ms <= ?1 LIMIT ?2)",
                params![now_ms, PURGE_BATCH],
            )
            .map_err(|error| shared_error(&error))?;
        transaction.commit().map_err(|error| shared_error(&error))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    const MINUTE: i64 = 60_000;

    fn store(dir: &Path) -> SqliteLimits {
        SqliteLimits::open(&dir.join("shared").join("limits.sqlite3"), 1_000).unwrap()
    }

    #[test]
    fn a_key_gets_its_limit_in_any_window_and_no_more() {
        let dir = tempfile::tempdir().unwrap();
        let limits = store(dir.path());
        for at in [0, 10_000, 20_000] {
            assert_eq!(limits.hit("a", 3, MINUTE, at).unwrap(), Admission::Allowed);
        }
        // The fourth within the minute is refused until the first leaves the window.
        assert_eq!(
            limits.hit("a", 3, MINUTE, 30_000).unwrap(),
            Admission::Refused {
                retry_after_ms: 30_000
            }
        );
        // Another key is counted on its own.
        assert_eq!(
            limits.hit("b", 3, MINUTE, 30_000).unwrap(),
            Admission::Allowed
        );
        // At exactly a minute after the first, it has left: one more is admitted, and the
        // sliding window holds the limit across what a fixed window would split.
        assert_eq!(
            limits.hit("a", 3, MINUTE, MINUTE).unwrap(),
            Admission::Allowed
        );
        assert_eq!(
            limits.hit("a", 3, MINUTE, MINUTE + 1).unwrap(),
            Admission::Refused {
                retry_after_ms: 9_999
            }
        );
    }

    #[test]
    fn a_refused_request_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let limits = store(dir.path());
        assert_eq!(limits.hit("a", 1, MINUTE, 0).unwrap(), Admission::Allowed);
        for at in 1..50 {
            assert!(matches!(
                limits.hit("a", 1, MINUTE, at).unwrap(),
                Admission::Refused { .. }
            ));
        }
        let rows: i64 = limits
            .connection
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM hits", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn a_lowered_limit_waits_for_enough_rows_to_leave() {
        let dir = tempfile::tempdir().unwrap();
        let limits = store(dir.path());
        for at in 0..4 {
            assert_eq!(limits.hit("a", 4, MINUTE, at).unwrap(), Admission::Allowed);
        }
        // Four counted under a limit of two: three must leave, so the third oldest decides.
        assert_eq!(
            limits.hit("a", 2, MINUTE, 10).unwrap(),
            Admission::Refused {
                retry_after_ms: MINUTE + 2 - 10
            }
        );
    }

    #[test]
    fn expired_rows_are_purged_by_later_writes() {
        let dir = tempfile::tempdir().unwrap();
        let limits = store(dir.path());
        for at in 0..100 {
            limits.hit(&format!("k{at}"), 1, MINUTE, at).unwrap();
        }
        limits.hit("late", 1, MINUTE, 10 * MINUTE).unwrap();
        let rows: i64 = limits
            .connection
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM hits", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 101 - PURGE_BATCH);
    }

    #[test]
    fn two_handles_share_one_count_and_the_file_is_private() {
        let dir = tempfile::tempdir().unwrap();
        let first = store(dir.path());
        let second = store(dir.path());
        assert_eq!(first.hit("a", 2, MINUTE, 0).unwrap(), Admission::Allowed);
        assert_eq!(second.hit("a", 2, MINUTE, 1).unwrap(), Admission::Allowed);
        assert!(matches!(
            first.hit("a", 2, MINUTE, 2).unwrap(),
            Admission::Refused { .. }
        ));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = dir.path().join("shared");
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
            let mode = std::fs::metadata(path.join("limits.sqlite3"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_reopened_store_narrows_wide_permissions_and_drops_expired_rows() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let shared = dir.path().join("shared");
        let path = shared.join("limits.sqlite3");
        drop(SqliteLimits::open(&path, 50).unwrap());
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let limits = SqliteLimits::open(&path, 50).unwrap();
        // A row from long ago, and one whose window is still open.
        limits.hit("old", 5, MINUTE, 0).unwrap();
        limits.hit("now", 5, MINUTE, i64::MAX / 2).unwrap();
        drop(limits);
        let limits = SqliteLimits::open(&path, 50).unwrap();
        let keys: Vec<String> = {
            let connection = limits.connection.lock().unwrap();
            let mut statement = connection.prepare("SELECT key FROM hits").unwrap();
            statement
                .query_map([], |row| row.get(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert_eq!(keys, ["now"]);
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!((mode(&shared), mode(&path)), (0o700, 0o600));
    }

    #[test]
    fn a_held_store_times_out_as_retryable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shared").join("limits.sqlite3");
        let quick = SqliteLimits::open(&path, 50).unwrap();
        let holder = Connection::open(&path).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert_eq!(
            quick.hit("a", 1, MINUTE, 0).unwrap_err(),
            SharedError::Timeout { store: "limits" }
        );
        holder.execute_batch("ROLLBACK").unwrap();
        assert_eq!(quick.hit("a", 1, MINUTE, 0).unwrap(), Admission::Allowed);
    }

    #[test]
    fn byte_counters_refuse_once_the_window_holds_the_limit_and_admit_as_bytes_leave() {
        let dir = tempfile::tempdir().unwrap();
        let limits = store(dir.path());
        assert_eq!(
            limits.bytes_admit("p", 100, MINUTE, 0).unwrap(),
            Admission::Allowed
        );
        limits.bytes_add("p", 60, MINUTE, 0).unwrap();
        assert_eq!(
            limits.bytes_admit("p", 100, MINUTE, 1).unwrap(),
            Admission::Allowed
        );
        // The call that crosses the limit is not withheld: it was admitted before it ran.
        limits.bytes_add("p", 70, MINUTE, 10_000).unwrap();
        // 130 counted: the 60 must leave before fewer than 100 remain.
        assert_eq!(
            limits.bytes_admit("p", 100, MINUTE, 20_000).unwrap(),
            Admission::Refused {
                retry_after_ms: MINUTE - 20_000
            }
        );
        assert_eq!(
            limits.bytes_admit("q", 100, MINUTE, 20_000).unwrap(),
            Admission::Allowed
        );
        assert_eq!(
            limits.bytes_admit("p", 100, MINUTE, MINUTE).unwrap(),
            Admission::Allowed
        );
        // A second handle (another process) sees the same bytes.
        let other = store(dir.path());
        other.bytes_add("p", 200, MINUTE, MINUTE).unwrap();
        assert!(matches!(
            limits.bytes_admit("p", 100, MINUTE, MINUTE + 1).unwrap(),
            Admission::Refused { .. }
        ));
    }

    #[test]
    fn a_version_1_store_is_upgraded_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shared").join("limits.sqlite3");
        drop(SqliteLimits::open(&path, 50).unwrap());
        {
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch("DROP TABLE bytes; PRAGMA user_version = 1")
                .unwrap();
        }
        let limits = SqliteLimits::open(&path, 50).unwrap();
        limits.bytes_add("p", 1, MINUTE, 0).unwrap();
        let version: i64 = limits
            .connection
            .lock()
            .unwrap()
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn an_unknown_schema_version_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shared").join("limits.sqlite3");
        drop(SqliteLimits::open(&path, 50).unwrap());
        Connection::open(&path)
            .unwrap()
            .execute_batch("PRAGMA user_version = 9")
            .unwrap();
        let error = SqliteLimits::open(&path, 50).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_STATE_UNWRITABLE");
    }
}
