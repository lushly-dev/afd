//! The embedded reference backend as the host opens it.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use umbel_store::StoreError;
use umbel_store_embedded::{SqliteMemoryStore, SqliteStore, StoreOptions, TantivyIndex};

use super::SpaceStores;
use crate::workspace::{SpaceId, Workspace};

/// The stores of every space of a workspace, opened on first use.
pub(crate) struct Stores {
    workspace: Arc<Workspace>,
    opened: Mutex<BTreeMap<String, Arc<SpaceStores>>>,
    memories: Mutex<BTreeMap<String, Arc<SqliteMemoryStore>>>,
}

impl Stores {
    pub(crate) fn new(workspace: Arc<Workspace>) -> Self {
        Self {
            workspace,
            opened: Mutex::new(BTreeMap::new()),
            memories: Mutex::new(BTreeMap::new()),
        }
    }

    fn checked(&self, space: &str) -> Result<SpaceId, StoreError> {
        let id = SpaceId::parse(space).map_err(StoreError::invalid)?;
        if !self.workspace.has_space(space) {
            return Err(StoreError::invalid(format!(
                "the space `{space}` is not declared in this workspace"
            )));
        }
        Ok(id)
    }

    fn options(&self) -> StoreOptions {
        StoreOptions {
            lock_timeout_ms: self.workspace.config().store.lock_timeout_ms,
        }
    }

    /// The memory store of `space` alone (phase 3 section 5.3). Opening it creates nothing: only
    /// a memory write provisions its files, and neither the document store nor the index is
    /// opened, so a memory read leaves the disk as it was.
    ///
    /// # Errors
    /// `Invalid` for an undeclared space.
    pub(crate) fn memory(&self, space: &str) -> Result<Arc<SqliteMemoryStore>, StoreError> {
        let id = self.checked(space)?;
        let mut memories = self
            .memories
            .lock()
            .map_err(|_| StoreError::Io("the memory store table is poisoned".into()))?;
        if let Some(memory) = memories.get(space) {
            return Ok(Arc::clone(memory));
        }
        let dir = self.workspace.layout().space_state_dir(&id);
        let memory = Arc::new(
            SqliteMemoryStore::open(&dir, space, self.options())?.with_machine_backup_exclusion(
                self.workspace
                    .config()
                    .store
                    .exclude_memory_from_machine_backup,
            ),
        );
        memories.insert(space.to_owned(), Arc::clone(&memory));
        Ok(memory)
    }

    /// The stores of `space`, opened now when this process has not used them yet.
    ///
    /// # Errors
    /// The backend's: `Busy`, `VersionUnsupported`, `Corrupt` or `Io`.
    pub(crate) fn space(&self, space: &str) -> Result<Arc<SpaceStores>, StoreError> {
        let id = self.checked(space)?;
        let mut opened = self
            .opened
            .lock()
            .map_err(|_| StoreError::Io("the store table is poisoned".into()))?;
        if let Some(stores) = opened.get(space) {
            return Ok(Arc::clone(stores));
        }
        let dir = self.workspace.layout().space_state_dir(&id);
        let options = self.options();
        let sqlite = Arc::new(SqliteStore::open(&dir, space, options)?);
        let tantivy = Arc::new(TantivyIndex::open(&dir, space, options)?);
        let memory = self.memory(space)?;
        let stores = Arc::new(SpaceStores {
            documents: sqlite.clone(),
            graph: sqlite.clone(),
            index: tantivy.clone(),
            sqlite,
            tantivy,
            sqlite_memory: memory,
        });
        opened.insert(space.to_owned(), Arc::clone(&stores));
        Ok(stores)
    }
}
