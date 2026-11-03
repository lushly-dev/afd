//! Opening `memory.sqlite3`: the per-connection pragmas, provisioning on the first write, and a
//! small pool of connections (phase 3 section 5.3). A read never creates a file.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use umbel_store::StoreError;

use super::schema::{CREATE_FTS, FTS_SECURE_DELETE, MEMORY_SCHEMA, MEMORY_SCHEMA_VERSION};
use crate::error::{Fail, map_sql};

/// How many idle connections the pool keeps.
const MAX_IDLE: usize = 8;

/// The connections of one `memory.sqlite3`.
pub(crate) struct MemoryPool {
    path: PathBuf,
    space: String,
    timeout: Duration,
    idle: Mutex<Vec<Connection>>,
    provisioned: AtomicBool,
}

impl MemoryPool {
    /// A pool for the database at `path`, serving `space`. Touches no file.
    pub(crate) fn new(path: PathBuf, space: &str, timeout: Duration) -> Self {
        Self {
            path,
            space: space.to_owned(),
            timeout,
            idle: Mutex::new(Vec::new()),
            provisioned: AtomicBool::new(false),
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn timeout(&self) -> Duration {
        self.timeout
    }

    /// Run `work` on a connection to the provisioned database, or answer `NotProvisioned`
    /// without creating anything.
    pub(crate) fn read<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, StoreError> {
        let conn = self.existing()?;
        self.run(conn, work)
    }

    /// Provision the database if it is not yet, then run `work` on a connection to it.
    pub(crate) fn write<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, StoreError> {
        self.provision()?;
        let conn = self.existing()?;
        self.run(conn, work)
    }

    fn run<T>(
        &self,
        mut conn: Connection,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, StoreError> {
        let result = work(&mut conn);
        if result.is_ok()
            && let Ok(mut idle) = self.idle.lock()
            && idle.len() < MAX_IDLE
        {
            idle.push(conn);
        }
        result.map_err(StoreError::from)
    }

    /// A pooled connection, or a new one to the existing file, checked to be provisioned.
    fn existing(&self) -> Result<Connection, StoreError> {
        let pooled = self.idle.lock().ok().and_then(|mut idle| idle.pop());
        if let Some(conn) = pooled {
            return Ok(conn);
        }
        if !self.path.exists() {
            return Err(StoreError::NotProvisioned);
        }
        let conn = match connect(&self.path, self.timeout) {
            Ok(conn) => conn,
            Err(_) if !self.path.exists() => return Err(StoreError::NotProvisioned),
            Err(fail) => return Err(fail.into()),
        };
        if !self.provisioned.load(Ordering::Acquire) {
            check_provisioned(&conn, &self.space).map_err(StoreError::from)?;
            self.provisioned.store(true, Ordering::Release);
        }
        Ok(conn)
    }

    /// Section 5.4's provisioning, without the key file (step 3b): create `memory.sqlite3` with
    /// mode `0600` if it is absent, switch it to WAL, then under `BEGIN IMMEDIATE` create the
    /// schema if it is absent and, unless another process finished first, write the `meta` rows
    /// last. A database with no `store_id` row is not provisioned, and the next write starts
    /// again here.
    fn provision(&self) -> Result<(), StoreError> {
        if self.provisioned.load(Ordering::Acquire) {
            return Ok(());
        }
        let io = |e: std::io::Error| StoreError::Io(format!("{}: {e}", self.path.display()));
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        create_private(&self.path).map_err(io)?;
        let mut conn = connect(&self.path, self.timeout)?;
        initialise(&mut conn, &self.space, self.timeout)?;
        self.provisioned.store(true, Ordering::Release);
        if let Ok(mut idle) = self.idle.lock()
            && idle.len() < MAX_IDLE
        {
            idle.push(conn);
        }
        Ok(())
    }

    /// A connection made as every pooled one is, for reading its settings back.
    pub(crate) fn fresh_connection(&self) -> Result<Connection, StoreError> {
        if !self.path.exists() {
            return Err(StoreError::NotProvisioned);
        }
        connect(&self.path, self.timeout).map_err(StoreError::from)
    }
}

/// Create `path` empty with mode `0600` if it does not exist, never truncating. SQLite gives its
/// WAL and shared-memory files the database's mode.
fn create_private(path: &Path) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map(drop)
}

/// One connection with the memory store's pragmas, set on every connection because
/// `secure_delete` and `synchronous` reset per connection (section 5.3): `synchronous=FULL`,
/// `secure_delete=ON`, the lock timeout and, on macOS, full fsync. Never creates the file.
pub(crate) fn connect(path: &Path, timeout: Duration) -> Result<Connection, Fail> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    conn.busy_timeout(timeout)?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.query_row("PRAGMA secure_delete = ON", [], |r| r.get::<_, i64>(0))?;
    if cfg!(target_os = "macos") {
        conn.pragma_update(None, "fullfsync", "ON")?;
        conn.pragma_update(None, "checkpoint_fullfsync", "ON")?;
    }
    Ok(conn)
}

fn user_version(conn: &Connection) -> Result<u32, Fail> {
    Ok(conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?)
}

/// Refuse a newer schema, answer `NotProvisioned` for a database with no `store_id`, and refuse
/// one that belongs to another space.
fn check_provisioned(conn: &Connection, space: &str) -> Result<(), Fail> {
    let version = user_version(conn)?;
    if version > MEMORY_SCHEMA_VERSION {
        return Err(StoreError::VersionUnsupported {
            found: version,
            supported: MEMORY_SCHEMA_VERSION,
        }
        .into());
    }
    let has_meta: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta')",
        [],
        |r| r.get(0),
    )?;
    if !has_meta {
        return Err(StoreError::NotProvisioned.into());
    }
    let meta = |key: &str| -> Result<Option<String>, Fail> {
        Ok(conn
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    };
    if meta("store_id")?.is_none() {
        return Err(StoreError::NotProvisioned.into());
    }
    match meta("space")? {
        Some(stored) if stored == space => Ok(()),
        Some(stored) => Err(StoreError::invalid(format!(
            "this memory store belongs to space `{stored}`, not `{space}`"
        ))
        .into()),
        None => {
            Err(StoreError::Corrupt("the memory store has no space recorded".to_owned()).into())
        }
    }
}

/// Switch to WAL, then create the schema and the `meta` rows under a write transaction, so two
/// processes provisioning at once end with one `store_id`.
fn initialise(conn: &mut Connection, space: &str, timeout: Duration) -> Result<(), StoreError> {
    let deadline = Instant::now() + timeout;
    loop {
        // `journal_mode` is persistent; switching needs a brief exclusive lock, which another
        // process provisioning at the same moment can hold past the busy handler.
        match conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0)) {
            Ok(_) => break,
            Err(error)
                if matches!(map_sql(&error), StoreError::Busy) && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(error) => return Err(map_sql(&error)),
        }
    }
    create_schema(conn, space).map_err(StoreError::from)?;
    check_provisioned(conn, space).map_err(StoreError::from)
}

fn create_schema(conn: &mut Connection, space: &str) -> Result<(), Fail> {
    {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version = user_version(&tx)?;
        if version > MEMORY_SCHEMA_VERSION {
            return Err(StoreError::VersionUnsupported {
                found: version,
                supported: MEMORY_SCHEMA_VERSION,
            }
            .into());
        }
        let has_meta: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta')",
            [],
            |r| r.get(0),
        )?;
        if !has_meta {
            tx.execute_batch(MEMORY_SCHEMA)?;
            tx.execute(CREATE_FTS, [])?;
            tx.execute(FTS_SECURE_DELETE, [])?;
        }
        let provisioned: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM meta WHERE key = 'store_id')",
            [],
            |r| r.get(0),
        )?;
        if provisioned {
            // Another process finished provisioning first.
            return Ok(());
        }
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('space', ?1)",
            [space],
        )?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('store_traits_version', ?1)",
            [umbel_store::STORE_TRAITS_VERSION.to_string()],
        )?;
        tx.pragma_update(None, "user_version", MEMORY_SCHEMA_VERSION)?;
        // Last, so a database without it is not provisioned (section 5.4, step 5). SQLite's
        // `randomblob` draws from its own generator, which it seeds from the operating system.
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('store_id', lower(hex(randomblob(16))))",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
}
