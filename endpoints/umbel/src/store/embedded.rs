//! The embedded reference backend as the host opens it.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use umbel_store::StoreError;
use umbel_store_embedded::{SqliteStore, StoreOptions, TantivyIndex};

use super::SpaceStores;
use crate::workspace::{SpaceId, Workspace};

/// The stores of every space of a workspace, opened on first use.
pub(crate) struct Stores {
    workspace: Arc<Workspace>,
    opened: Mutex<BTreeMap<String, Arc<SpaceStores>>>,
}

impl Stores {
    pub(crate) fn new(workspace: Arc<Workspace>) -> Self {
        Self {
            workspace,
            opened: Mutex::new(BTreeMap::new()),
        }
    }

    /// The stores of `space`, opened now when this process has not used them yet.
    ///
    /// # Errors
    /// The backend's: `Busy`, `VersionUnsupported`, `Corrupt` or `Io`.
    pub(crate) fn space(&self, space: &str) -> Result<Arc<SpaceStores>, StoreError> {
        let id = SpaceId::parse(space).map_err(StoreError::invalid)?;
        if !self.workspace.has_space(space) {
            return Err(StoreError::invalid(format!(
                "the space `{space}` is not declared in this workspace"
            )));
        }
        let mut opened = self
            .opened
            .lock()
            .map_err(|_| StoreError::Io("the store table is poisoned".into()))?;
        if let Some(stores) = opened.get(space) {
            return Ok(Arc::clone(stores));
        }
        let dir = self.workspace.layout().space_state_dir(&id);
        let options = StoreOptions {
            lock_timeout_ms: self.workspace.config().store.lock_timeout_ms,
        };
        let sqlite = Arc::new(SqliteStore::open(&dir, space, options)?);
        let tantivy = Arc::new(TantivyIndex::open(&dir, space, options)?);
        let stores = Arc::new(SpaceStores {
            documents: sqlite.clone(),
            graph: sqlite.clone(),
            index: tantivy.clone(),
            sqlite,
            tantivy,
        });
        opened.insert(space.to_owned(), Arc::clone(&stores));
        Ok(stores)
    }
}
