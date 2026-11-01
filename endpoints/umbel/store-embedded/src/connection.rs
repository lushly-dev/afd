//! Opening the database, its pragmas, its schema and a small pool of connections.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use umbel_store::StoreError;

use crate::error::{Fail, map_sql};
use crate::schema::{SCHEMA, SCHEMA_VERSION};

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
}

/// One connection with the backend's pragmas (section 3.2): `synchronous=FULL` (decision traces
/// must survive power loss), `foreign_keys=ON`, a bounded busy timeout and, on macOS, full
/// fsync, because `synchronous=FULL` alone does not flush the drive's cache there.
fn connect(path: &Path, timeout: Duration) -> Result<Connection, Fail> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(timeout)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    if cfg!(target_os = "macos") {
        conn.pragma_update(None, "fullfsync", "ON")?;
        conn.pragma_update(None, "checkpoint_fullfsync", "ON")?;
    }
    Ok(conn)
}

/// Switch to WAL, then create or check the schema under a write transaction, so two processes
/// opening a fresh store at once do not both create it.
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
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('store_traits_version', ?1)",
                [umbel_store::STORE_TRAITS_VERSION.to_string()],
            )?;
            tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
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
