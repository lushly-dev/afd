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
            return Err(StoreError::invalid("a space id must match ^[a-z][a-z0-9-]{0,62}$"));
        }
        let dir = space_dir.join(STORE_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| StoreError::Io(format!("{}: {e}", dir.display())))?;
        let pool = connection::Pool::open(dir.join(DATABASE_FILE), space, options)?;
        Ok(Self { space: space.to_owned(), pool })
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

    pub(crate) fn pool(&self) -> &connection::Pool {
        &self.pool
    }
}
