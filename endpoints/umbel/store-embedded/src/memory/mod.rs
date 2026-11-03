//! The embedded memory store (phase 3 section 5.3): `state/spaces/<space>/store/memory.sqlite3`,
//! beside `store.sqlite3` and a separate database, so memory writes do not move the document head,
//! do not share a write lock with indexing, and can be erased and checkpointed on their own.
//!
//! WAL, `synchronous=FULL`, `secure_delete=ON`, the lock timeout and, on macOS, full fsync, set
//! on every connection; the file is created with mode `0600`; the lexical lane is an ordinary
//! FTS5 table with `secure-delete` set. Only a write creates the file: every read of a store not
//! yet provisioned answers `NotProvisioned` and creates nothing.
//!
//! **Step 3a.** The `sealed` columns go through [`seal`], which stores them unsealed until step
//! 3b drops in per-record keys and the key file. Until then `key_status` reports a key file that
//! is present and matches with nothing destroyed, orphaned or absent, which is what an unsealed
//! store means; `backup` refuses, since a copy would hold the text in clear; and a forget whose
//! checkpoint is busy answers `wal: Pending` with no marker for a later writer to retry.

mod change;
mod erase;
mod filters;
mod pool;
mod read;
mod rows;
mod schema;
mod seal;
mod write;

use std::path::{Path, PathBuf};
use std::time::Duration;

use umbel_store::memory::{
    BackupReceipt, Confirm, ForgetReceipt, Invalidate, KeyFileState, KeyStatus, LeftOut,
    MemoryChange, MemoryCounts, MemoryList, MemoryPage, MemoryReceipt, MemoryUsage,
    MemoryVersionMeta, RecallPage, RecallQuery, ReindexReceipt, Sweep, SweepReceipt,
};
use umbel_store::{
    AsOf, MemoryBatch, MemoryClass, MemoryRecord, MemoryStore, Millis, PushFilter, ReadFlags,
    ReaderFilter, Rev, ScopeQuery, StoreError,
};

use crate::StoreOptions;

pub use schema::MEMORY_SCHEMA_VERSION;

/// The memory database's file name under a space's `store/` directory.
pub const MEMORY_FILE: &str = "memory.sqlite3";

/// What `PRAGMA`s and files say about the memory database, read on a new connection made as
/// every connection of the store is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryInfo {
    /// `PRAGMA user_version`, the memory schema version.
    pub schema_version: u32,
    /// `PRAGMA journal_mode`; `wal`.
    pub journal_mode: String,
    /// Whether `synchronous` is `FULL`.
    pub synchronous_full: bool,
    /// Whether `secure_delete` is on.
    pub secure_delete: bool,
    /// Whether `fullfsync` is on (macOS only).
    pub full_fsync: bool,
    /// The connection's busy timeout, in milliseconds.
    pub busy_timeout_ms: u64,
    /// Whether FTS5's `secure-delete` is set on `records_fts`.
    pub fts_secure_delete: bool,
    /// The store's id, 128 random bits in hex.
    pub store_id: String,
    /// The database file's size in bytes.
    pub database_bytes: u64,
    /// The write-ahead log's size in bytes.
    pub wal_bytes: u64,
}

/// One space's memory store: implements [`MemoryStore`].
pub struct SqliteMemoryStore {
    space: String,
    pool: pool::MemoryPool,
}

impl SqliteMemoryStore {
    /// The memory store of `space` under `space_dir` (`state/spaces/<space>`), at
    /// `store/memory.sqlite3`. Opens nothing and creates nothing: the first write provisions.
    ///
    /// # Errors
    /// `Invalid` for a malformed space id.
    pub fn open(space_dir: &Path, space: &str, options: StoreOptions) -> Result<Self, StoreError> {
        if !umbel_store::is_slug(space) {
            return Err(StoreError::invalid(
                "a space id must match ^[a-z][a-z0-9-]{0,62}$",
            ));
        }
        let path = space_dir.join(crate::STORE_DIR).join(MEMORY_FILE);
        Ok(Self {
            space: space.to_owned(),
            pool: pool::MemoryPool::new(
                path,
                space,
                Duration::from_millis(options.lock_timeout_ms),
            ),
        })
    }

    /// The space this store serves.
    #[must_use]
    pub fn space(&self) -> &str {
        &self.space
    }

    /// The database file, which exists once the store is provisioned.
    #[must_use]
    pub fn database_path(&self) -> PathBuf {
        self.pool.path().to_owned()
    }

    /// The database's settings, read back on a **new** connection (the pragmas reset per
    /// connection, so each is set on every one), and its sizes.
    ///
    /// # Errors
    /// `NotProvisioned` before the first write; `Busy` or `Io` if it cannot be queried.
    pub fn info(&self) -> Result<MemoryInfo, StoreError> {
        // A read first, so an unprovisioned store answers as every read does.
        self.pool.read(|_| Ok(()))?;
        let conn = self.pool.fresh_connection()?;
        let path = self.database_path();
        let size = |p: &Path| std::fs::metadata(p).map_or(0, |m| m.len());
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        let read = || -> Result<MemoryInfo, crate::error::Fail> {
            let int = |pragma: &str| -> Result<i64, crate::error::Fail> {
                Ok(conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get::<_, i64>(0))?)
            };
            let fts: Option<i64> = rusqlite::OptionalExtension::optional(conn.query_row(
                "SELECT v FROM records_fts_config WHERE k = 'secure-delete'",
                [],
                |r| r.get(0),
            ))?;
            Ok(MemoryInfo {
                schema_version: u32::try_from(int("user_version")?).unwrap_or(0),
                journal_mode: conn.query_row("PRAGMA journal_mode", [], |r| r.get(0))?,
                synchronous_full: int("synchronous")? == 2,
                secure_delete: int("secure_delete")? == 1,
                full_fsync: int("fullfsync")? == 1,
                busy_timeout_ms: u64::try_from(int("busy_timeout")?).unwrap_or(0),
                fts_secure_delete: fts == Some(1),
                store_id: conn.query_row(
                    "SELECT value FROM meta WHERE key = 'store_id'",
                    [],
                    |r| r.get(0),
                )?,
                database_bytes: size(&path),
                wal_bytes: size(&wal),
            })
        };
        read().map_err(StoreError::from)
    }
}

impl MemoryStore for SqliteMemoryStore {
    fn write(&self, batch: MemoryBatch) -> Result<MemoryReceipt, StoreError> {
        self.do_write(batch)
    }

    fn invalidate(
        &self,
        req: Invalidate,
        reader: &ReaderFilter,
    ) -> Result<MemoryVersionMeta, StoreError> {
        self.do_invalidate(req, reader)
    }

    fn confirm(
        &self,
        req: Confirm,
        reader: &ReaderFilter,
    ) -> Result<MemoryVersionMeta, StoreError> {
        self.do_confirm(req, reader)
    }

    fn get(
        &self,
        id: &str,
        as_of: AsOf,
        flags: ReadFlags,
        reader: &ReaderFilter,
    ) -> Result<Option<MemoryRecord>, StoreError> {
        self.read_get(id, as_of, flags, reader)
    }

    fn history(&self, id: &str, reader: &ReaderFilter) -> Result<Vec<MemoryRecord>, StoreError> {
        self.read_history(id, reader)
    }

    fn list(&self, query: &MemoryList, reader: &ReaderFilter) -> Result<MemoryPage, StoreError> {
        self.read_list(query, reader)
    }

    fn recall(&self, query: &RecallQuery, reader: &ReaderFilter) -> Result<RecallPage, StoreError> {
        self.read_recall(query, reader)
    }

    fn left_out(
        &self,
        scope: &ScopeQuery,
        classes: &[MemoryClass],
        push: &PushFilter,
        as_of: AsOf,
        now: Millis,
        reader: &ReaderFilter,
    ) -> Result<LeftOut, StoreError> {
        self.read_left_out(scope, classes, push, as_of, now, reader)
    }

    fn forget(&self, req: umbel_store::memory::Forget) -> Result<ForgetReceipt, StoreError> {
        self.do_forget(req)
    }

    fn sweep(&self, req: Sweep) -> Result<SweepReceipt, StoreError> {
        self.do_sweep(req)
    }

    fn reindex(&self, remove_orphans: bool) -> Result<ReindexReceipt, StoreError> {
        self.do_reindex(remove_orphans)
    }

    /// Refused in step 3a: the stripped copy of section 5.4 holds sealed blobs and no index, and
    /// until step 3b seals them a copy would hold every record's text in clear.
    fn backup(&self, _dest: &Path) -> Result<BackupReceipt, StoreError> {
        self.pool.read(|_| Ok(()))?;
        Err(StoreError::invalid(
            "memory backup needs sealed records (phase 3 step 3b); nothing was copied",
        ))
    }

    /// Step 3a: no record is sealed and there is no key file, so every row opens. The answer is
    /// that of a key file that is present and matches, with no marker, orphan or absent entry.
    fn key_status(&self) -> Result<KeyStatus, StoreError> {
        self.pool.read(|_| Ok(()))?;
        Ok(KeyStatus {
            file: KeyFileState::Present,
            unsettled: 0,
            destroyed: 0,
            orphans: 0,
            absent: 0,
        })
    }

    fn changes(
        &self,
        after: Rev,
        limit: u32,
        reader: &ReaderFilter,
        trace: Option<&str>,
    ) -> Result<Vec<MemoryChange>, StoreError> {
        self.read_changes(after, limit, reader, trace)
    }

    fn head(&self) -> Result<Rev, StoreError> {
        self.read_head()
    }

    fn usage(
        &self,
        owner: &str,
        agent: Option<&str>,
        since: Millis,
    ) -> Result<MemoryUsage, StoreError> {
        self.read_usage(owner, agent, since)
    }

    fn counts(
        &self,
        now: Millis,
        expiring_within_ms: Millis,
        reader: &ReaderFilter,
    ) -> Result<MemoryCounts, StoreError> {
        self.read_counts(now, expiring_within_ms, reader)
    }

    fn checkpoint(&self) -> Result<(), StoreError> {
        self.do_checkpoint()
    }
}
