//! Umbel's embedded reference store backend (phase 2 specification, section 3.2): SQLite in WAL
//! mode, bundled, for documents, plugin records, the change log and the structural graph. Several
//! processes may open one space's store at once; writers take turns under `BEGIN IMMEDIATE` and
//! wait at most `store.lock_timeout_ms`. The tantivy index joins this crate in step 3.

mod connection;
mod documents;
mod error;
mod graph;
mod schema;
mod sql;

use std::path::{Path, PathBuf};

use umbel_store::StoreError;

pub use connection::StoreOptions;

/// The file and directory names under a space's state directory (section 3.2).
const STORE_DIR: &str = "store";
const DATABASE_FILE: &str = "store.sqlite3";

/// What `PRAGMA`s and files say about an open store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoreInfo {
    /// `PRAGMA user_version`, the schema version.
    pub schema_version: u32,
    /// `PRAGMA journal_mode`; `wal` for this backend.
    pub journal_mode: String,
    /// Whether `synchronous` is `FULL` on a pooled connection.
    pub synchronous_full: bool,
    /// Whether foreign keys are enforced on a pooled connection.
    pub foreign_keys: bool,
    /// The connection's busy timeout, in milliseconds.
    pub busy_timeout_ms: u64,
    /// `PRAGMA wal_autocheckpoint`, in pages; SQLite's default is 1000.
    pub wal_autocheckpoint: u64,
    /// Whether `fullfsync` is on (macOS only; the drive's cache is flushed).
    pub full_fsync: bool,
    /// The database file's size in bytes.
    pub database_bytes: u64,
    /// The write-ahead log's size in bytes.
    pub wal_bytes: u64,
}

/// One space's SQLite store: implements [`umbel_store::DocumentStore`] and
/// [`umbel_store::GraphStore`].
pub struct SqliteStore {
    space: String,
    pool: connection::Pool,
}

impl SqliteStore {
    /// Open (creating when new) the store of `space` under `space_dir`
    /// (`state/spaces/<space>`): `store/store.sqlite3` in WAL mode, the schema, the version check.
    ///
    /// # Errors
    /// `VersionUnsupported` when the file is a newer schema, `Invalid` when it belongs to another
    /// space, `Busy` when a lock wait ran past the timeout, `Corrupt` or `Io` otherwise.
    pub fn open(space_dir: &Path, space: &str, options: StoreOptions) -> Result<Self, StoreError> {
        if !umbel_store::is_slug(space) {
            return Err(StoreError::invalid(
                "a space id must match ^[a-z][a-z0-9-]{0,62}$",
            ));
        }
        let dir = space_dir.join(STORE_DIR);
        std::fs::create_dir_all(&dir)
            .map_err(|e| StoreError::Io(format!("{}: {e}", dir.display())))?;
        let pool = connection::Pool::open(dir.join(DATABASE_FILE), space, options)?;
        Ok(Self {
            space: space.to_owned(),
            pool,
        })
    }

    /// The space this store serves.
    #[must_use]
    pub fn space(&self) -> &str {
        &self.space
    }

    /// The database file.
    #[must_use]
    pub fn database_path(&self) -> PathBuf {
        self.pool.path().to_owned()
    }

    /// The database's settings and sizes, as `store-show` and `store-check` report them.
    ///
    /// # Errors
    /// `Busy` or `Io` if the database cannot be queried.
    pub fn info(&self) -> Result<StoreInfo, StoreError> {
        let path = self.database_path();
        let size = |p: &Path| std::fs::metadata(p).map_or(0, |m| m.len());
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        self.pool.with(|conn| {
            let int = |pragma: &str| -> Result<i64, crate::error::Fail> {
                Ok(conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get::<_, i64>(0))?)
            };
            Ok(StoreInfo {
                schema_version: u32::try_from(int("user_version")?).unwrap_or(0),
                journal_mode: conn
                    .query_row("PRAGMA journal_mode", [], |r| r.get::<_, String>(0))?,
                synchronous_full: int("synchronous")? == 2,
                foreign_keys: int("foreign_keys")? == 1,
                busy_timeout_ms: u64::try_from(int("busy_timeout")?).unwrap_or(0),
                wal_autocheckpoint: u64::try_from(int("wal_autocheckpoint")?).unwrap_or(0),
                full_fsync: int("fullfsync")? == 1,
                database_bytes: size(&path),
                wal_bytes: size(&wal),
            })
        })
    }

    pub(crate) fn pool(&self) -> &connection::Pool {
        &self.pool
    }
}
