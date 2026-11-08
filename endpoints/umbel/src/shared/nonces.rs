//! The shared nonce store (phase 5 specification, section 10.2; D126):
//! `state/shared/nonces.sqlite3`, where every process behind one URL spends a single-use value
//! exactly once.
//!
//! What spends here, each under its own key prefix so no two uses collide:
//!
//! - AFD's approval middleware (`afd:`): an approval token's nonce, as AFD draws it, and relay
//!   evidence's `relay:<decisionId>` (step 0d), through [`SharedApprovalNonces`], in hosted modes;
//! - the gateway's assertion `jti`s (`gateway:<jti>`, phase 5 step 4) and the person page's spent
//!   decisions (`person:<id>`, step 5), through [`NonceStore`] directly.
//!
//! `consume` is `INSERT ... ON CONFLICT DO NOTHING` and succeeds only when that inserted a row
//! (`changes() == 1`), in one `BEGIN IMMEDIATE` transaction, so of any number of concurrent
//! spends of one key, in any processes sharing the file, exactly one succeeds. A row holds the key
//! and two times, never content or an identity. A row is kept until its expiry, at least until
//! the spend, and at most [`MAX_KEEP_MS`] ahead; a spent key stays spent while its row exists, and
//! every write purges at most 64 rows whose expiry has passed. The file is WAL, mode 0600 in a
//! 0700 `state/shared/`, `secure_delete` on, schema `user_version` 1.
//!
//! The store is opened on first use, so a workspace that never spends a value never creates it.
//! Any failure, a lock wait past `store.lock_timeout_ms` included, fails closed: the value is not
//! spent and the call that presented it is refused, with `WORKSPACE_SHARED_TIMEOUT` (retryable,
//! `details.store`) or `INTERNAL_ERROR` (retryable) rather than as a spent value
//! ([`spend_failures`]).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, TransactionBehavior, params};

use super::SharedError;
use crate::workspace::WorkspaceError;

/// The store's name in errors and logs (`details.store`).
const STORE: &str = "nonces";
/// The schema version this host writes (`PRAGMA user_version`).
const SCHEMA_VERSION: i64 = 1;
/// The most expired rows one write purges.
const PURGE_BATCH: i64 = 64;
/// The longest a spent key is kept: 31 days. AFD's approval tokens and relay decisions live at
/// most 24 hours; a longer expiry asked for is cut to this, so no caller can grow the store
/// without bound.
pub(crate) const MAX_KEEP_MS: i64 = 31 * 24 * 3_600_000;
/// The longest key: a nonce or an id, never content.
pub(crate) const MAX_KEY_BYTES: usize = 512;

/// The shared nonce store (section 10.2). A networked backend for several machines implements
/// the same trait (phase 6).
pub(crate) trait NonceStore: Send + Sync {
    /// Spend `key` at `now_ms`, keeping it until `expires_ms`. `Ok(true)` for the one spend that
    /// recorded it; `Ok(false)` when it was already spent (or is empty, or longer than
    /// [`MAX_KEY_BYTES`]).
    ///
    /// # Errors
    /// [`SharedError::Timeout`] when another process held the store past the lock timeout,
    /// [`SharedError::Failed`] when it cannot be opened, read or written. The caller fails closed.
    fn consume(&self, key: &str, expires_ms: i64, now_ms: i64) -> Result<bool, SharedError>;
}

/// The SQLite nonce store: `state/shared/nonces.sqlite3`, opened on first use.
pub(crate) struct SqliteNonces {
    path: PathBuf,
    lock_timeout_ms: u64,
    connection: Mutex<Option<Connection>>,
}

impl std::fmt::Debug for SqliteNonces {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteNonces").finish_non_exhaustive()
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

impl SqliteNonces {
    /// The store at `path`, waiting up to `lock_timeout_ms` for another process's write. Nothing
    /// is opened until the first spend.
    pub(crate) fn new(path: &Path, lock_timeout_ms: u64) -> Self {
        Self {
            path: path.to_path_buf(),
            lock_timeout_ms,
            connection: Mutex::new(None),
        }
    }

    /// Open the store, waiting up to the lock timeout while other processes opening it at the
    /// same moment hold it (switching to WAL takes a lock SQLite's busy handler does not always
    /// wait for): then [`SharedError::Timeout`]; any other failure at once.
    fn open_patiently(&self) -> Result<Connection, SharedError> {
        let deadline =
            std::time::Instant::now() + Duration::from_millis(self.lock_timeout_ms.max(1));
        loop {
            match self.open() {
                Ok(connection) => return Ok(connection),
                Err(error) => {
                    let busy = {
                        let text = error.to_string();
                        text.contains("database is locked") || text.contains("database is busy")
                    };
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
            super::ensure_dir(dir)?;
        }
        super::ensure_private_file(path)?;
        let connection = Connection::open(path).map_err(|error| unwritable(&error))?;
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
                "PRAGMA synchronous = NORMAL;
                 PRAGMA secure_delete = ON;
                 BEGIN IMMEDIATE;
                 CREATE TABLE IF NOT EXISTS spent (
                     key TEXT PRIMARY KEY NOT NULL,
                     at_ms INTEGER NOT NULL,
                     expires_ms INTEGER NOT NULL
                 ) WITHOUT ROWID;
                 CREATE INDEX IF NOT EXISTS spent_expires ON spent (expires_ms);
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

impl NonceStore for SqliteNonces {
    fn consume(&self, key: &str, expires_ms: i64, now_ms: i64) -> Result<bool, SharedError> {
        if key.is_empty() || key.len() > MAX_KEY_BYTES {
            return Ok(false);
        }
        // A poisoned lock means a panic mid-call; the transaction it held was rolled back when it
        // was dropped.
        let mut guard = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if guard.is_none() {
            *guard = Some(self.open_patiently()?);
        }
        let Some(connection) = guard.as_mut() else {
            return Err(failed(&"the store is not open"));
        };
        let keep = expires_ms.clamp(now_ms, now_ms.saturating_add(MAX_KEEP_MS));
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| shared_error(&error))?;
        let inserted = transaction
            .execute(
                "INSERT INTO spent (key, at_ms, expires_ms) VALUES (?1, ?2, ?3)
                 ON CONFLICT (key) DO NOTHING",
                params![key, now_ms, keep],
            )
            .map_err(|error| shared_error(&error))?;
        transaction
            .execute(
                "DELETE FROM spent WHERE key IN
                     (SELECT key FROM spent WHERE expires_ms < ?1 LIMIT ?2)",
                params![now_ms, PURGE_BATCH],
            )
            .map_err(|error| shared_error(&error))?;
        transaction.commit().map_err(|error| shared_error(&error))?;
        Ok(inserted == 1)
    }
}

/// The system clock in epoch milliseconds: the store's own clock, never a host's injected one, so
/// a frozen replay clock cannot keep a spent value from expiring or an expired one alive.
pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

tokio::task_local! {
    /// The shared store's failure in the call [`spend_failures`] wraps, if a spend failed.
    static SPEND_FAILURE: std::cell::RefCell<Option<SharedError>>;
}

/// The middleware just outside AFD's approval middleware (hosted modes): when a spend in the
/// shared store failed during the call, AFD refused the approval as if the value were spent; the
/// answer becomes the store's own, `WORKSPACE_SHARED_TIMEOUT` (retryable, `details.store`) for a
/// lock wait past `store.lock_timeout_ms`, `INTERNAL_ERROR` (retryable) otherwise, so a client
/// retries rather than asking for a new approval. Nothing ran either way.
pub(crate) fn spend_failures() -> afd::CommandMiddleware {
    std::sync::Arc::new(
        move |_name: String,
              _input: serde_json::Value,
              _context: afd::CommandContext,
              next: afd::MiddlewareNext|
              -> afd::BoxFuture<'static, afd::CommandResult<serde_json::Value>> {
            Box::pin(
                SPEND_FAILURE.scope(std::cell::RefCell::new(None), async move {
                    let result = next().await;
                    let failed = SPEND_FAILURE.with(|cell| cell.borrow_mut().take());
                    match failed {
                        Some(SharedError::Timeout { store }) if !result.success => {
                            afd::failure(super::read_limit::shared_timeout(store))
                        }
                        Some(SharedError::Failed { .. }) if !result.success => {
                            afd::failure(super::read_limit::store_failed())
                        }
                        _ => result,
                    }
                }),
            )
        },
    )
}

/// AFD's [`ApprovalNonceStore`](afd::ApprovalNonceStore) over the shared store, so that an
/// approval nonce and relay evidence (`relay:<decisionId>`) are spent once across every process
/// behind one URL (section 10.2), under the key prefix `afd:`. A store failure spends nothing,
/// refuses the approval, and is reported by [`spend_failures`].
pub(crate) struct SharedApprovalNonces {
    store: std::sync::Arc<dyn NonceStore>,
}

impl SharedApprovalNonces {
    pub(crate) fn new(store: std::sync::Arc<dyn NonceStore>) -> Self {
        Self { store }
    }
}

#[async_trait::async_trait]
impl afd::ApprovalNonceStore for SharedApprovalNonces {
    async fn consume(&self, nonce: &str, expires_at: i64) -> bool {
        let store = std::sync::Arc::clone(&self.store);
        let key = format!("afd:{nonce}");
        let spent =
            tokio::task::spawn_blocking(move || store.consume(&key, expires_at, now_ms())).await;
        let failure = match spent {
            Ok(Ok(spent)) => return spent,
            Ok(Err(error)) => {
                match &error {
                    SharedError::Timeout { store } => {
                        tracing::warn!(target: "umbel::shared", store, "a shared store was held past store.lock_timeout_ms; the approval is refused");
                    }
                    SharedError::Failed { store, message } => {
                        tracing::error!(target: "umbel::shared", store, %message, "a shared store failed; the approval is refused");
                    }
                }
                error
            }
            Err(error) => {
                tracing::error!(target: "umbel::shared", %error, "spending an approval nonce did not finish; the approval is refused");
                SharedError::Failed {
                    store: STORE,
                    message: error.to_string(),
                }
            }
        };
        let _ = SPEND_FAILURE.try_with(|cell| *cell.borrow_mut() = Some(failure));
        false
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use std::sync::{Arc, Barrier};

    fn store(dir: &Path) -> SqliteNonces {
        SqliteNonces::new(&dir.join("shared").join("nonces.sqlite3"), 1_000)
    }

    #[test]
    fn a_key_is_spent_once_and_stays_spent_until_its_row_expires() {
        let dir = tempfile::tempdir().unwrap();
        let nonces = store(dir.path());
        assert!(!dir.path().join("shared").exists(), "opened on first use");
        assert!(nonces.consume("a", 1_000, 0).unwrap());
        assert!(!nonces.consume("a", 1_000, 1).unwrap());
        // Past its expiry, the row is still there until a write purges it: still spent.
        assert!(!nonces.consume("a", 5_000, 2_000).unwrap());
        assert!(nonces.consume("relay:a", 1_000, 0).unwrap());
        // Empty and oversized keys are never spent.
        assert!(!nonces.consume("", 1_000, 0).unwrap());
        assert!(
            !nonces
                .consume(&"k".repeat(MAX_KEY_BYTES + 1), 1_000, 0)
                .unwrap()
        );
    }

    #[test]
    fn expiry_is_kept_between_the_spend_and_the_longest_keep() {
        let dir = tempfile::tempdir().unwrap();
        let nonces = store(dir.path());
        assert!(nonces.consume("past", -5, 100).unwrap());
        assert!(nonces.consume("far", i64::MAX, 100).unwrap());
        let connection = nonces.connection.lock().unwrap();
        let expiry = |key: &str| -> i64 {
            connection
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT expires_ms FROM spent WHERE key = ?1",
                    params![key],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(expiry("past"), 100);
        assert_eq!(expiry("far"), 100 + MAX_KEEP_MS);
    }

    #[test]
    fn concurrent_spends_across_handles_admit_exactly_one() {
        let dir = tempfile::tempdir().unwrap();
        let handles: Vec<Arc<SqliteNonces>> = (0..4).map(|_| Arc::new(store(dir.path()))).collect();
        let barrier = Arc::new(Barrier::new(16));
        let threads: Vec<_> = (0..16)
            .map(|n| {
                let nonces = Arc::clone(&handles[n % 4]);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    nonces.consume("contested", 60_000, 0).unwrap()
                })
            })
            .collect();
        let spent = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .filter(|spent| *spent)
            .count();
        assert_eq!(spent, 1);
    }

    #[test]
    fn writes_purge_expired_rows_and_the_file_is_private() {
        let dir = tempfile::tempdir().unwrap();
        let nonces = store(dir.path());
        for n in 0..100 {
            nonces.consume(&format!("k{n}"), 10, 0).unwrap();
        }
        nonces.consume("late", 10_000, 1_000).unwrap();
        let rows: i64 = nonces
            .connection
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM spent", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 101 - PURGE_BATCH);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let shared = dir.path().join("shared");
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&shared), 0o700);
            assert_eq!(mode(&shared.join("nonces.sqlite3")), 0o600);
        }
    }

    #[test]
    fn a_held_store_times_out_and_spends_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shared").join("nonces.sqlite3");
        let quick = SqliteNonces::new(&path, 50);
        assert!(quick.consume("warm", 1_000, 0).unwrap());
        let holder = Connection::open(&path).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        assert_eq!(
            quick.consume("a", 1_000, 0).unwrap_err(),
            SharedError::Timeout { store: "nonces" }
        );
        holder.execute_batch("ROLLBACK").unwrap();
        assert!(quick.consume("a", 1_000, 0).unwrap());
    }

    #[tokio::test]
    async fn the_approval_adapter_fails_closed() {
        struct Broken;
        impl NonceStore for Broken {
            fn consume(&self, _: &str, _: i64, _: i64) -> Result<bool, SharedError> {
                Err(SharedError::Failed {
                    store: STORE,
                    message: "broken".into(),
                })
            }
        }
        let adapter = SharedApprovalNonces::new(Arc::new(Broken));
        assert!(!afd::ApprovalNonceStore::consume(&adapter, "n", i64::MAX).await);
        let dir = tempfile::tempdir().unwrap();
        let adapter = SharedApprovalNonces::new(Arc::new(store(dir.path())));
        let expires = now_ms() + 60_000;
        assert!(afd::ApprovalNonceStore::consume(&adapter, "n", expires).await);
        assert!(!afd::ApprovalNonceStore::consume(&adapter, "n", expires).await);
    }
}
