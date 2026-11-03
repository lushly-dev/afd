//! Opening `memory.sqlite3` and its key file: the per-connection pragmas, provisioning on the first
//! write, the rebuild of a restored copy on open, the machine-backup exclusion on a writer's open,
//! and a small pool of connections (phase 3 sections 5.3 and 5.4). A read never creates a file.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use umbel_store::StoreError;

use super::exclusion;
use super::keys::{self, KeyFile};
use super::schema::{
    CREATE_FTS, DERIVED_SCHEMA, FTS_SECURE_DELETE, MEMORY_SCHEMA, MEMORY_SCHEMA_VERSION,
};
use super::seal::random;
use crate::error::{Fail, map_sql};

/// How many idle connections the pool keeps.
const MAX_IDLE: usize = 8;

/// The connections of one `memory.sqlite3`, and its key file.
pub(crate) struct MemoryPool {
    path: PathBuf,
    space: String,
    timeout: Duration,
    idle: Mutex<Vec<Connection>>,
    /// The open's checks are done: provisioned, the version served, the index present.
    opened: AtomicBool,
    /// The store id, read at the open.
    store_id: OnceLock<String>,
    keys: KeyFile,
    /// `store.exclude_memory_from_machine_backup`.
    exclude: bool,
    /// A writer's open has set or removed the exclusion.
    marked: AtomicBool,
}

impl MemoryPool {
    /// A pool for the database at `path`, serving `space`. Touches no file.
    pub(crate) fn new(path: PathBuf, space: &str, timeout: Duration) -> Self {
        let keys = path.with_file_name(keys::KEYS_FILE);
        Self {
            path,
            space: space.to_owned(),
            timeout,
            idle: Mutex::new(Vec::new()),
            opened: AtomicBool::new(false),
            store_id: OnceLock::new(),
            keys: KeyFile::new(keys, timeout),
            exclude: true,
            marked: AtomicBool::new(false),
        }
    }

    pub(crate) fn set_exclude(&mut self, exclude: bool) {
        self.exclude = exclude;
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn key_file(&self) -> &KeyFile {
        &self.keys
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

    /// Provision the database and its key file if they are not yet, then run `work` on a
    /// connection to it.
    pub(crate) fn write<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, StoreError> {
        self.provision()?;
        let conn = self.existing()?;
        self.mark_once();
        self.run(conn, work)
    }

    /// Run `work` on a connection to the key file of this store.
    ///
    /// # Errors
    /// `KeysMissing`, `KeysMismatch`, or what `work` answers.
    pub(crate) fn keys<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, Fail>,
    ) -> Result<T, Fail> {
        let store_id = self.store_id.get().ok_or(StoreError::NotProvisioned)?;
        self.keys.with(store_id, work)
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

    /// A pooled connection, or a new one to the existing file. The first one checks that the
    /// store is provisioned at a served version, and rebuilds a restored copy's index.
    fn existing(&self) -> Result<Connection, StoreError> {
        let pooled = self.idle.lock().ok().and_then(|mut idle| idle.pop());
        if let Some(mut conn) = pooled {
            if !self.opened.load(Ordering::Acquire) {
                self.open_checks(&mut conn)?;
            }
            return Ok(conn);
        }
        // The key file first and the database second (section 5.4): the database is always
        // created first, so a key file with no database is never a first write in progress.
        let keys_exist = self.keys.exists();
        let missing = || {
            if keys_exist {
                StoreError::KeysMismatch
            } else {
                StoreError::NotProvisioned
            }
        };
        if !self.path.exists() {
            return Err(missing());
        }
        let mut conn = match connect(&self.path, self.timeout) {
            Ok(conn) => conn,
            Err(_) if !self.path.exists() => return Err(missing()),
            Err(fail) => return Err(fail.into()),
        };
        if !self.opened.load(Ordering::Acquire) {
            self.open_checks(&mut conn)?;
        }
        Ok(conn)
    }

    /// The first open's checks: provisioned at a served version, the store id read, and a
    /// restored copy's index rebuilt.
    fn open_checks(&self, conn: &mut Connection) -> Result<(), StoreError> {
        let store_id = check_provisioned(conn, &self.space).map_err(StoreError::from)?;
        let _ = self.store_id.set(store_id);
        self.rebuild_if_restored(conn)?;
        self.opened.store(true, Ordering::Release);
        Ok(())
    }

    /// The rebuild on open (section 5.4): a provisioned database with no `records_fts` is a
    /// restored `store-backup` copy. With its key file present and matching, rebuild it in one
    /// transaction, the only time a read path writes or waits on the write lock.
    fn rebuild_if_restored(&self, conn: &mut Connection) -> Result<(), StoreError> {
        if has_index(conn).map_err(StoreError::from)? {
            return Ok(());
        }
        self.keys(|kc| super::erase::rebuild(conn, &self.space, kc))
            .map_err(StoreError::from)?;
        let _ = super::erase::truncate(conn, false, self.timeout);
        Ok(())
    }

    /// Section 5.4's provisioning: create `memory.sqlite3` with mode `0600` if it is absent and
    /// switch it to WAL; then under `BEGIN IMMEDIATE` create the schema if it is absent and,
    /// unless another process finished first, adopt or create the key file and write the `meta`
    /// rows, the store id last. A database with no store id is not provisioned, and the next
    /// write starts again here.
    fn provision(&self) -> Result<(), StoreError> {
        if self.opened.load(Ordering::Acquire) {
            return Ok(());
        }
        if self.keys.exists() && !self.path.exists() {
            // A key file with no database: never adopted, and nothing is created.
            return Err(StoreError::KeysMismatch);
        }
        let io = |e: std::io::Error| StoreError::Io(format!("{}: {e}", self.path.display()));
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(io)?;
        }
        let created = !self.path.exists();
        create_private(&self.path).map_err(io)?;
        if created {
            // Step 1: marked before anything is written to it. Best effort; the doctor reports a
            // file left unmarked.
            let _ = exclusion::apply(&self.path, self.exclude);
        }
        let mut conn = connect(&self.path, self.timeout)?;
        initialise(&mut conn, self.timeout)?;
        create_schema(
            &mut conn,
            &self.space,
            &self.keys,
            self.exclude,
            self.timeout,
        )
        .map_err(StoreError::from)?;
        if let Ok(mut idle) = self.idle.lock()
            && idle.len() < MAX_IDLE
        {
            idle.push(conn);
        }
        Ok(())
    }

    /// A writer's open (section 5.4, D87): set the exclusion on the database, its WAL and
    /// shared-memory files and the key file where it is missing, or remove it when the setting
    /// is off. Once per pool; best effort.
    fn mark_once(&self) {
        if self.marked.swap(true, Ordering::AcqRel) {
            return;
        }
        for path in self.files() {
            let _ = exclusion::apply(&path, self.exclude);
        }
    }

    /// `memory.sqlite3`, its WAL and shared-memory files, and `memory.keys`.
    pub(crate) fn files(&self) -> [PathBuf; 4] {
        let with = |suffix: &str| PathBuf::from(format!("{}{suffix}", self.path.display()));
        [
            self.path.clone(),
            with("-wal"),
            with("-shm"),
            self.keys.path().to_owned(),
        ]
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
/// WAL, shared-memory and journal files the database's mode.
pub(crate) fn create_private(path: &Path) -> std::io::Result<()> {
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

/// Whether `records_fts` exists.
pub(crate) fn has_index(conn: &Connection) -> Result<bool, Fail> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'records_fts')",
        [],
        |r| r.get(0),
    )?)
}

/// Refuse a newer schema, answer `NotProvisioned` for a database with no `store_id`, and refuse
/// one that belongs to another space. Returns the store id.
fn check_provisioned(conn: &Connection, space: &str) -> Result<String, Fail> {
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
    let Some(store_id) = meta("store_id")? else {
        return Err(StoreError::NotProvisioned.into());
    };
    match meta("space")? {
        Some(stored) if stored == space => Ok(store_id),
        Some(stored) => Err(StoreError::invalid(format!(
            "this memory store belongs to space `{stored}`, not `{space}`"
        ))
        .into()),
        None => {
            Err(StoreError::Corrupt("the memory store has no space recorded".to_owned()).into())
        }
    }
}

/// Switch to WAL. `journal_mode` is persistent; switching needs a brief exclusive lock, which
/// another process provisioning at the same moment can hold past the busy handler.
fn initialise(conn: &mut Connection, timeout: Duration) -> Result<(), StoreError> {
    let deadline = Instant::now() + timeout;
    loop {
        match conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0)) {
            Ok(_) => return Ok(()),
            Err(error)
                if matches!(map_sql(&error), StoreError::Busy) && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(error) => return Err(map_sql(&error)),
        }
    }
}

/// Steps 2 to 5 of provisioning, under one `BEGIN IMMEDIATE`, so two processes provisioning at
/// once end with one store id and one key file.
fn create_schema(
    conn: &mut Connection,
    space: &str,
    key_file: &KeyFile,
    exclude: bool,
    timeout: Duration,
) -> Result<(), Fail> {
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
        tx.execute_batch(DERIVED_SCHEMA)?;
        tx.execute(CREATE_FTS, [])?;
        tx.execute(FTS_SECURE_DELETE, [])?;
    }
    let provisioned: bool = tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM meta WHERE key = 'store_id')",
        [],
        |r| r.get(0),
    )?;
    if provisioned {
        // Another process finished provisioning first, or this database was provisioned before.
        return Ok(());
    }
    // Step 3: adopt the key file a process left before its step 5, or create one for a new
    // store id, 128 bits from the operating system.
    let store_id = if key_file.exists() {
        keys::identity_of(key_file.path(), timeout)?
    } else {
        let mut bits = [0_u8; 16];
        random(&mut bits)?;
        let store_id: String = bits.iter().map(|b| format!("{b:02x}")).collect();
        keys::create(key_file.path(), &store_id, exclude)?;
        store_id
    };
    // Step 4, then the commit of step 5, last: a database without a store id is not
    // provisioned.
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('space', ?1)",
        [space],
    )?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('store_traits_version', ?1)",
        [umbel_store::STORE_TRAITS_VERSION.to_string()],
    )?;
    tx.pragma_update(None, "user_version", MEMORY_SCHEMA_VERSION)?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('store_id', ?1)",
        [store_id],
    )?;
    tx.commit()?;
    Ok(())
}
