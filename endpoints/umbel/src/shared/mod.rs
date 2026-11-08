//! State shared by every process that serves one workspace behind one URL (phase 5 specification,
//! section 10.2; D126), in `state/shared/`.
//!
//! Each store is behind a trait, so that phase 6 can put a networked backend behind the same
//! calls. Phase 5 step 2a adds the first one, the limit counters the per-IP limit needs
//! ([`limits`]); the nonce, person-decision and task stores arrive with the steps that use them.
//! A wait past `store.lock_timeout_ms` is [`codes::WORKSPACE_SHARED_TIMEOUT`], retryable, and the
//! request it served fails closed.

pub(crate) mod limits;

use std::fs::{self, DirBuilder};
use std::path::Path;

use crate::workspace::WorkspaceError;

/// The codes a shared store's failure carries.
pub(crate) mod codes {
    /// A shared store's lock wait passed `store.lock_timeout_ms` (section 10.5): retryable, and the
    /// request fails closed.
    pub(crate) const WORKSPACE_SHARED_TIMEOUT: &str = "WORKSPACE_SHARED_TIMEOUT";
}

/// Why a shared store could not answer. Either way the request it served fails closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SharedError {
    /// Another process held the store past `store.lock_timeout_ms`.
    Timeout {
        /// The store's name, `details.store` (`limits`).
        store: &'static str,
    },
    /// The store failed otherwise: its file is unreadable, damaged or on a full disk. The message
    /// is for the log only.
    Failed {
        /// The store's name.
        store: &'static str,
        /// What failed, for the log.
        message: String,
    },
}

/// Create `state/shared/` (mode 0700 on Unix) when missing, and narrow it to 0700 when it is
/// wider.
pub(crate) fn ensure_dir(dir: &Path) -> Result<(), WorkspaceError> {
    if !dir.is_dir() {
        let mut builder = DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        builder
            .create(dir)
            .map_err(|error| WorkspaceError::unwritable(dir, error))?;
    }
    restrict(dir, 0o700)
}

/// Create the store file `path` (mode 0600 on Unix) when missing, without truncating one that
/// exists, and narrow it to 0600 when it is wider, so that SQLite's write-ahead log and
/// shared-memory files take the same mode.
pub(crate) fn ensure_private_file(path: &Path) -> Result<(), WorkspaceError> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(false);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options
        .open(path)
        .map(drop)
        .map_err(|error| WorkspaceError::unwritable(path, error))?;
    restrict(path, 0o600)
}

/// Clear every permission bit of `path` outside `mode` (Unix only).
fn restrict(path: &Path, mode: u32) -> Result<(), WorkspaceError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let current = fs::metadata(path)
            .map_err(|error| WorkspaceError::unwritable(path, error))?
            .permissions()
            .mode();
        if current & 0o777 & !mode != 0 {
            fs::set_permissions(path, fs::Permissions::from_mode(current & 0o777 & mode))
                .map_err(|error| WorkspaceError::unwritable(path, error))?;
        }
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}
