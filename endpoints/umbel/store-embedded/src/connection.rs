//! Opening the database, its pragmas, its schema and a small pool of connections.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use umbel_store::StoreError;

use crate::error::{Fail, map_sql};
use crate::schema::{
    HELD_SCHEMA, LANE_SCHEMA, POSTINGS_BACKFILL, POSTINGS_SCHEMA, SCHEMA, SCHEMA_VERSION,
};

/// How many idle connections the pool keeps.
const MAX_IDLE: usize = 8;

/// Backend settings from `[store]` in `umbel.toml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreOptions {
    /// How long a lock wait may last before the call answers `Busy`
    /// (`store.lock_timeout_ms`, default 5000).
    pub lock_timeout_ms: u64,
}

impl Default for StoreOptions {
    fn default() -> Self {
        Self {
            lock_timeout_ms: 5000,
        }
    }
}

/// The connections of one database file. Every connection has the same pragmas; reads use one
/// statement or one short transaction and never wait on a writer (WAL), writes use
/// `BEGIN IMMEDIATE` and wait at most the lock timeout.
pub(crate) struct Pool {
    path: PathBuf,
    timeout: Duration,
    idle: Mutex<Vec<Connection>>,
}

impl Pool {
    /// Open (creating when new) the database at `path` for `space`: WAL, the schema, the version
    /// check. Several processes may do this at once.
    pub(crate) fn open(
        path: PathBuf,
        space: &str,
        options: StoreOptions,
    ) -> Result<Self, StoreError> {
        let timeout = Duration::from_millis(options.lock_timeout_ms);
        let mut conn = connect(&path, timeout).map_err(StoreError::from)?;
        initialise(&mut conn, space, timeout).map_err(StoreError::from)?;
        Ok(Self {
            path,
            timeout,
            idle: Mutex::new(vec![conn]),
        })
    }

    /// Run `work` on a pooled connection.
    pub(crate) fn with<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, StoreError> {
        let pooled = self.idle.lock().ok().and_then(|mut idle| idle.pop());
        let mut conn = match pooled {
            Some(conn) => conn,
            None => connect(&self.path, self.timeout).map_err(StoreError::from)?,
        };
        let result = work(&mut conn);
        if result.is_ok()
            && let Ok(mut idle) = self.idle.lock()
            && idle.len() < MAX_IDLE
        {
            idle.push(conn);
        }
        result.map_err(StoreError::from)
    }

    /// The database file.
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// `store.lock_timeout_ms`.
    pub(crate) fn timeout(&self) -> Duration {
        self.timeout
    }
}

/// `wal_checkpoint(TRUNCATE)` on `conn`, outside any transaction. With `wait` it waits for
/// readers and writers as long as the lock timeout allows; without it, not at all. Answers
/// whether the write-ahead log is now empty: `false` when a reader holds it or a lock was busy.
pub(crate) fn truncate_wal(conn: &Connection, wait: bool, timeout: Duration) -> Result<bool, Fail> {
    if !wait {
        conn.busy_timeout(Duration::ZERO)?;
    }
    let result = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
        row.get::<_, i64>(0)
    });
    if !wait {
        conn.busy_timeout(timeout)?;
    }
    match result {
        Ok(busy) => Ok(busy == 0),
        Err(error) if matches!(map_sql(&error), StoreError::Busy) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

/// One connection with the backend's pragmas (section 3.2): `synchronous=FULL` (decision traces
/// must survive power loss), `foreign_keys=ON`, `secure_delete=ON` (phase 4 section 9.1: a
/// replaced or deleted row's bytes are overwritten, as the memory store's and the key file's
/// are, so a redacted proposal leaves no copy in a freed page), a bounded busy timeout and, on
/// macOS, full fsync, because `synchronous=FULL` alone does not flush the drive's cache there.
fn connect(path: &Path, timeout: Duration) -> Result<Connection, Fail> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(timeout)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // `PRAGMA secure_delete = ON` answers the new value as a row, which `pragma_update` refuses.
    conn.query_row("PRAGMA secure_delete = ON", [], |row| row.get::<_, i64>(0))?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    if cfg!(target_os = "macos") {
        conn.pragma_update(None, "fullfsync", "ON")?;
        conn.pragma_update(None, "checkpoint_fullfsync", "ON")?;
    }
    Ok(conn)
}

/// Switch to WAL, then create, migrate or check the schema under a write transaction, so two
/// processes opening a fresh store, or one at an earlier version, at once do not both write it.
fn initialise(conn: &mut Connection, space: &str, timeout: Duration) -> Result<(), Fail> {
    let deadline = Instant::now() + timeout;
    loop {
        // `journal_mode` is persistent; switching needs a brief exclusive lock, which another
        // process opening at the same moment can hold past the busy handler.
        match conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0)) {
            Ok(_) => break,
            Err(error)
                if matches!(map_sql(&error), StoreError::Busy) && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(error) => return Err(error.into()),
        }
    }
    let version = user_version(conn)?;
    if version > SCHEMA_VERSION {
        return Err(StoreError::VersionUnsupported {
            found: version,
            supported: SCHEMA_VERSION,
        }
        .into());
    }
    if version < SCHEMA_VERSION {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version = user_version(&tx)?;
        if version > SCHEMA_VERSION {
            return Err(StoreError::VersionUnsupported {
                found: version,
                supported: SCHEMA_VERSION,
            }
            .into());
        }
        if version == 0 {
            tx.execute_batch(SCHEMA)?;
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('space', ?1)",
                [space],
            )?;
        }
        if version < 2 {
            // Schema version 2 (records host specification, section 5.1): the record lane's
            // tables, in the opening transaction of a new store and of a store at version 1,
            // whose own tables and rows are left as they are. The traits version is set, not
            // inserted: a version 1 store already records the one it was created under.
            tx.execute_batch(LANE_SCHEMA)?;
            for (key, value) in [
                (
                    "store_traits_version",
                    umbel_store::STORE_TRAITS_VERSION.to_string(),
                ),
                (
                    "lane_normalisation",
                    umbel_store::lane::NORMALISATION_VERSION.to_string(),
                ),
            ] {
                tx.execute(
                    "INSERT INTO meta (key, value) VALUES (?1, ?2)
                     ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    [key, value.as_str()],
                )?;
            }
        }
        if version < 3 {
            // Schema version 3: which documents the host held to their files. A store at
            // version 1 or 2 gains the table empty: none of its documents was held, so none
            // is the person's own by collection until the host holds it
            // (`store-documents-hold`, or the next put of an own collection's document).
            tx.execute_batch(HELD_SCHEMA)?;
        }
        if version < 4 {
            // Schema version 4: each declared kind's count of postings, which a match compares
            // with its bound (records host specification, section 8.2). A store at version 2 or
            // 3 has it counted here, once, from its lane; a new store has no kind to count.
            tx.execute_batch(POSTINGS_SCHEMA)?;
            tx.execute_batch(POSTINGS_BACKFILL)?;
        }
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        tx.commit()?;
    }
    let stored: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'space'", [], |row| {
            row.get(0)
        })
        .optional()?;
    match stored {
        Some(stored) if stored == space => Ok(()),
        Some(stored) => Err(StoreError::invalid(format!(
            "this store belongs to space `{stored}`, not `{space}`"
        ))
        .into()),
        None => Err(StoreError::Corrupt("the store has no space recorded".to_owned()).into()),
    }
}

fn user_version(conn: &Connection) -> Result<u32, Fail> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?)
}
