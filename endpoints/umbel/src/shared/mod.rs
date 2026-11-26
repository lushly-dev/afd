//! State shared by every process that serves one workspace behind one URL (phase 5 specification,
//! section 10.2; D126), in `state/shared/`.
//!
//! Each store is behind a trait, so that phase 6 can put a networked backend behind the same
//! calls. Phase 5 step 2a adds the limit counters the per-IP limit needs ([`limits`]); step 3
//! adds their byte counters for the read limit ([`read_limit`]) and the nonce store
//! ([`nonces`]: approval nonces and relay evidence now, gateway `jti`s in step 4 and spent person
//! decisions in step 5), person decisions (`person.sqlite3`, step 5, [`person`]) and tasks
//! (`tasks.sqlite3`, step 8, [`tasks`]: AFD's own `TaskStore` trait), and usage events
//! (`state/usage/usage.sqlite3`, step 9, [`usage`]; D122 keeps them in `state/usage/`). A wait past
//! `store.lock_timeout_ms` is [`codes::WORKSPACE_SHARED_TIMEOUT`], retryable, and the request it
//! served fails closed (a task store's, as AFD's `TaskStoreError::Unavailable`).

pub(crate) mod limits;
pub(crate) mod nonces;
pub(crate) mod person;
mod person_migration;
pub(crate) mod read_limit;
pub(crate) mod tasks;
pub(crate) mod usage;

use std::fs::{self, DirBuilder};
use std::path::Path;

use crate::positions::hmac_sha256;
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

/// `<label>:` and the lowercase hex HMAC-SHA256 under `key` of `parts`, each prefixed by its
/// length: a limit counter's name, which identifies one caller to every process holding the
/// workspace's key and to nothing else, so the shared store holds no identifier a dictionary
/// could recover.
pub(crate) fn keyed_name(label: &str, key: &[u8], parts: &[&str]) -> String {
    let mut message = Vec::new();
    for part in parts {
        message.extend_from_slice(&(part.len() as u64).to_be_bytes());
        message.extend_from_slice(part.as_bytes());
    }
    let hex: String = hmac_sha256(key, &message)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{label}:{hex}")
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

/// Copy the shared store at `path`, at schema version `from`, beside it before it is migrated
/// (D214), as the embedded backend's `umbel_store_embedded::copy_before_migration` does for a
/// space's store: to `<file>.v<from>.pre-migration`, or the next free `<file>.v<from>.<n>.pre-migration`
/// (no copy is reused or replaced), mode 0600, with `VACUUM INTO` on a connection of its own
/// into `<copy>.partial`, synced, then linked into place, so a copy exists only whole. Call it
/// while the migrating connection holds the write lock and has written nothing. When it fails the
/// caller must not migrate. This crate builds the shared stores without the embedded backend, so
/// it keeps its own copy of these lines; `tests/it/lane_schema.rs` and this module's tests hold
/// both to the same names.
pub(crate) fn copy_before_migration(path: &Path, from: i64) -> rusqlite::Result<()> {
    let refused = |error: std::io::Error| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
            error.kind(),
            format!("the copy before migrating {}: {error}", path.display()),
        )))
    };
    let named = |n: u32| {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(if n == 1 {
            format!(".v{from}.pre-migration")
        } else {
            format!(".v{from}.{n}.pre-migration")
        });
        path.with_file_name(name)
    };
    let copy = (1..=1000)
        .map(named)
        .find(|candidate| !candidate.exists())
        .ok_or_else(|| refused(std::io::Error::other("a thousand copies are already there")))?;
    let mut partial = copy.as_os_str().to_os_string();
    partial.push(".partial");
    let partial = std::path::PathBuf::from(partial);
    match fs::remove_file(&partial) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(refused(error)),
        _ => {}
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(&partial).map(drop).map_err(refused)?;
    let copied = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .and_then(|conn| {
        conn.execute("VACUUM INTO ?1", [partial.to_string_lossy().as_ref()])
            .map(drop)
    })
    .and_then(|()| {
        fs::File::open(&partial)
            .and_then(|file| file.sync_all())
            .and_then(|()| fs::hard_link(&partial, &copy))
            .map_err(refused)
    });
    let _ = fs::remove_file(&partial);
    copied
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

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn hmac_follows_rfc_4231() {
        assert_eq!(
            hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        // Test case 6: a key longer than the block.
        assert_eq!(
            hex(&hmac_sha256(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            )),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn keyed_names_depend_on_the_key_and_on_how_the_parts_split() {
        let one = keyed_name("t", b"k", &["ab", "c"]);
        assert_eq!(one, keyed_name("t", b"k", &["ab", "c"]));
        assert_ne!(one, keyed_name("t", b"j", &["ab", "c"]));
        assert_ne!(one, keyed_name("t", b"k", &["a", "bc"]));
        assert!(one.starts_with("t:") && one.len() == 2 + 64);
    }
}
