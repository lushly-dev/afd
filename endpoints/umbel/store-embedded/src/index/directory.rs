//! The index's directory on Windows: tantivy's `MmapDirectory`, with every read and replacement
//! of `.managed.json` coordinated across handles and processes (#1463).
//!
//! tantivy records each new segment file in `.managed.json` as soon as the file is opened, which
//! happens while documents are being added, before the commit and outside [`super::MetaGuard`].
//! It replaces the file by renaming a new copy over it, and on Windows that rename fails ("access
//! denied") while another handle has the file open, as opening the index in another process does.
//! So a replacement holds a lock on `.umbel-managed.lock` alone and a read shares it. Each hold
//! lasts one small file operation. It may be taken inside a `.umbel-meta.lock` hold (a commit's
//! last flush, an open), never the other way round, and its holder takes no other lock, so the
//! two cannot form a cycle. Elsewhere the `MmapDirectory` is used as it is.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tantivy::Directory;
use tantivy::directory::error::{DeleteError, LockError, OpenReadError, OpenWriteError};
use tantivy::directory::{
    DirectoryLock, FileHandle, FileSlice, Lock, MmapDirectory, WatchCallback, WatchHandle, WritePtr,
};

use super::lock_file;

/// The file tantivy lists its managed files in.
const MANAGED_FILE: &str = ".managed.json";
/// The file whose lock keeps reading `.managed.json` apart from replacing it. Its leading dot
/// keeps tantivy from managing (and collecting) it.
const MANAGED_GUARD_FILE: &str = ".umbel-managed.lock";

/// An `MmapDirectory` whose `.managed.json` is read and replaced under a cross-process lock.
#[derive(Clone, Debug)]
pub(crate) struct GuardedDirectory {
    inner: MmapDirectory,
    guard: Arc<PathBuf>,
}

impl GuardedDirectory {
    pub(crate) fn new(inner: MmapDirectory, dir: &Path) -> Self {
        Self {
            inner,
            guard: Arc::new(dir.join(MANAGED_GUARD_FILE)),
        }
    }

    /// A hold on the guard when `path` is `.managed.json`, released when dropped.
    fn hold(&self, path: &Path, exclusive: bool) -> io::Result<Option<std::fs::File>> {
        if path != Path::new(MANAGED_FILE) {
            return Ok(None);
        }
        lock_file(&self.guard, exclusive).map(Some)
    }
}

impl Directory for GuardedDirectory {
    fn get_file_handle(&self, path: &Path) -> Result<Arc<dyn FileHandle>, OpenReadError> {
        self.inner.get_file_handle(path)
    }

    fn open_read(&self, path: &Path) -> Result<FileSlice, OpenReadError> {
        self.inner.open_read(path)
    }

    fn delete(&self, path: &Path) -> Result<(), DeleteError> {
        self.inner.delete(path)
    }

    fn exists(&self, path: &Path) -> Result<bool, OpenReadError> {
        self.inner.exists(path)
    }

    fn open_write(&self, path: &Path) -> Result<WritePtr, OpenWriteError> {
        self.inner.open_write(path)
    }

    fn atomic_read(&self, path: &Path) -> Result<Vec<u8>, OpenReadError> {
        let _held = self
            .hold(path, false)
            .map_err(|e| OpenReadError::wrap_io_error(e, path.to_path_buf()))?;
        self.inner.atomic_read(path)
    }

    fn atomic_write(&self, path: &Path, data: &[u8]) -> io::Result<()> {
        let _held = self.hold(path, true)?;
        self.inner.atomic_write(path, data)
    }

    fn sync_directory(&self) -> io::Result<()> {
        self.inner.sync_directory()
    }

    fn acquire_lock(&self, lock: &Lock) -> Result<DirectoryLock, LockError> {
        self.inner.acquire_lock(lock)
    }

    fn watch(&self, watch_callback: WatchCallback) -> tantivy::Result<WatchHandle> {
        self.inner.watch(watch_callback)
    }
}
