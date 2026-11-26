//! What `store-backup`, `store-restore`, `workspace-backup` and `workspace-restore` share (D214):
//! where a backup may be read from, the digest of a file, and the restore's way of putting files
//! in place, verified and staged, without overwriting anything.

use crate::store::{codes, command_error};
use crate::workspace::Workspace;
use afd::CommandError;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use umbel_store::StoreError;

pub(super) fn refusal(code: &str, message: String, suggestion: &str) -> CommandError {
    CommandError::new(code, message)
        .with_suggestion(suggestion)
        .with_retryable(false)
}

pub(super) fn io_error(what: &Path, error: impl std::fmt::Display) -> CommandError {
    command_error(&StoreError::Io(format!("{}: {error}", what.display())))
}

/// The `sha256:<hex>` digest of `bytes`.
#[cfg(test)]
fn sha256(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hex(digest: &[u8]) -> String {
    let mut text = String::from("sha256:");
    for byte in digest {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

/// Read `from` in blocks, hashing each and handing it to `sink`: a store is never held in memory
/// whole. Answers the digest and the size.
fn stream(
    from: &Path,
    mut sink: impl FnMut(&[u8]) -> std::io::Result<()>,
) -> std::io::Result<(String, u64)> {
    use std::io::Read;
    let mut file = fs::File::open(from)?;
    let mut hasher = Sha256::new();
    let mut block = vec![0u8; 1 << 20];
    let mut size = 0u64;
    loop {
        let read = file.read(&mut block)?;
        if read == 0 {
            break;
        }
        hasher.update(&block[..read]);
        sink(&block[..read])?;
        size += read as u64;
    }
    Ok((hex(&hasher.finalize()), size))
}

/// The digest and size of the file at `path`.
pub(super) fn digest(path: &Path) -> Result<(String, u64), CommandError> {
    stream(path, |_| Ok(())).map_err(|e| io_error(path, e))
}

/// A backup directory to read: relative to the workspace (or absolute inside it), without `..`,
/// an existing directory inside the workspace and outside `state/` once resolved.
pub(super) fn backup_source(workspace: &Workspace, path: &str) -> Result<PathBuf, CommandError> {
    let invalid = |why: &str| {
        refusal(
            afd::error_codes::VALIDATION_ERROR,
            format!("path `{path}` {why}"),
            "Name the directory a backup wrote, inside the workspace, such as backups/2026-11-01.",
        )
    };
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err(invalid("is empty or holds a control character"));
    }
    let given = Path::new(path);
    if given
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(invalid("must not hold a `..` segment"));
    }
    let root = workspace.root().canonicalize().map_err(|e| {
        invalid(&format!(
            "cannot be resolved: the workspace is unreadable ({e})"
        ))
    })?;
    let target = if given.is_absolute() {
        given.to_path_buf()
    } else {
        root.join(given)
    };
    let resolved = target
        .canonicalize()
        .map_err(|_| invalid("is not a directory that exists"))?;
    if !resolved.is_dir() {
        return Err(invalid("is not a directory"));
    }
    if !resolved.starts_with(&root) || resolved.starts_with(root.join("state")) {
        return Err(invalid("must be inside the workspace and outside state/"));
    }
    Ok(resolved)
}

/// A relative path a manifest names: plain components only, so it stays under the directory it
/// is joined to.
pub(super) fn plain_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// One file to restore: where it is in the backup, where it goes, and what the manifest says of
/// its bytes.
pub(super) struct Planned {
    /// The manifest's name of the file, for messages.
    pub(super) name: String,
    pub(super) from: PathBuf,
    pub(super) to: PathBuf,
    pub(super) bytes: u64,
    pub(super) sha256: String,
}

/// A manifest's `files` entry: `path`, `bytes` and `sha256`.
pub(super) fn manifest_file(entry: &serde_json::Value) -> Option<(&str, u64, &str)> {
    Some((
        entry.get("path")?.as_str()?,
        entry.get("bytes")?.as_u64()?,
        entry.get("sha256")?.as_str()?,
    ))
}

pub(super) fn damaged(name: &str, why: &str) -> CommandError {
    refusal(
        codes::STORE_BACKUP_DAMAGED,
        format!("the backup's `{name}` {why}"),
        "Restore from another backup; this one is not what its manifest says.",
    )
}

/// Put every planned file in place, in order (D214). A target that exists is refused before
/// anything is written. Each file is read, checked against its size and digest, and written,
/// mode 0600 and synced, into `staging` (a new directory on the targets' file system); then each
/// is linked to its target, which fails rather than replace a file that appeared meanwhile, so a
/// process that opens a target sees it whole or not at all. On any failure the links made are
/// removed; the staging directory is removed either way. Answers the bytes restored.
pub(super) fn place(
    planned: &[Planned],
    backup: &Path,
    state: &Path,
    staging: &Path,
) -> Result<u64, CommandError> {
    // Every source resolves inside the backup and every target's directory inside `state/`: no
    // link in a path takes a read or a write anywhere else.
    let inside = |path: &Path, root: &Path| {
        path.canonicalize()
            .ok()
            .zip(root.canonicalize().ok())
            .is_some_and(|(path, root)| path.starts_with(root))
    };
    if let Some(file) = planned.iter().find(|file| !inside(&file.from, backup)) {
        return Err(damaged(&file.name, "is not a file inside the backup"));
    }
    if let Some(present) = planned.iter().find(|file| file.to.exists()) {
        return Err(refusal(
            codes::STORE_RESTORE_NOT_EMPTY,
            format!("{} already exists", present.to.display()),
            "A restore writes only where nothing is: stop the processes serving this workspace, then move the damaged files aside, with their -wal and -journal files (keep memory.keys where it is).",
        ));
    }
    // SQLite replays a write-ahead log or rollback journal it finds beside a database, whichever
    // database it came from: one left beside a restored file would be applied over it.
    if let Some(stale) = planned
        .iter()
        .filter(|file| file.to.extension().is_some_and(|ext| ext == "sqlite3"))
        .flat_map(|file| {
            ["-wal", "-journal"].map(|suffix| {
                let mut name = file.to.as_os_str().to_os_string();
                name.push(suffix);
                PathBuf::from(name)
            })
        })
        .find(|path| path.exists())
    {
        return Err(refusal(
            codes::STORE_RESTORE_NOT_EMPTY,
            format!(
                "{} is left from the database that was there",
                stale.display()
            ),
            "Stop the processes serving this workspace, then move that file aside with its database; SQLite would apply it over the restored one.",
        ));
    }
    if let Some(parent) = staging.parent() {
        fs::create_dir_all(parent).map_err(|e| io_error(parent, e))?;
    }
    fs::create_dir(staging).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            refusal(
                codes::STORE_RESTORE_NOT_EMPTY,
                format!("{} exists: a restore is running or was interrupted", staging.display()),
                "Wait for the other restore, or remove that directory if none is running, then retry.",
            )
        } else {
            io_error(staging, e)
        }
    })?;
    let outcome = stage_and_link(planned, state, staging);
    let _ = fs::remove_dir_all(staging);
    outcome
}

fn stage_and_link(planned: &[Planned], state: &Path, staging: &Path) -> Result<u64, CommandError> {
    let mut staged = Vec::with_capacity(planned.len());
    let mut total = 0;
    for (n, file) in planned.iter().enumerate() {
        // A regular file of the size the manifest gives, never a link, a device or a pipe.
        let meta =
            fs::symlink_metadata(&file.from).map_err(|_| damaged(&file.name, "cannot be read"))?;
        if !meta.file_type().is_file() {
            return Err(damaged(&file.name, "is not a regular file"));
        }
        if meta.len() != file.bytes {
            return Err(damaged(&file.name, "is not the size its manifest gives"));
        }
        let path = staging.join(n.to_string());
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut out = options.open(&path).map_err(|e| io_error(&path, e))?;
        let mut written = Ok(());
        let read = stream(&file.from, |block| {
            if written.is_ok() {
                written = out.write_all(block);
            }
            Ok(())
        });
        let (sha, size) = read.map_err(|_| damaged(&file.name, "cannot be read"))?;
        written.map_err(|e| io_error(&path, e))?;
        if size != file.bytes {
            return Err(damaged(&file.name, "is not the size its manifest gives"));
        }
        if sha != file.sha256 {
            return Err(damaged(&file.name, "does not match its digest"));
        }
        out.sync_all().map_err(|e| io_error(&path, e))?;
        total += file.bytes;
        staged.push(path);
    }
    let mut linked: Vec<&Path> = Vec::with_capacity(planned.len());
    for (file, path) in planned.iter().zip(&staged) {
        let parent = file.to.parent().unwrap_or(state);
        let made = fs::create_dir_all(parent).and_then(|()| {
            let resolved = parent.canonicalize()?;
            if resolved.starts_with(state.canonicalize()?) {
                fs::hard_link(path, &file.to)
            } else {
                Err(std::io::Error::other(
                    "its directory resolves outside state/",
                ))
            }
        });
        if let Err(error) = made {
            for done in linked {
                let _ = fs::remove_file(done);
            }
            return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                refusal(
                    codes::STORE_RESTORE_NOT_EMPTY,
                    format!("{} appeared during the restore", file.to.display()),
                    "Stop the processes serving this workspace, move the new files aside, and retry.",
                )
            } else {
                io_error(&file.to, error)
            });
        }
        linked.push(&file.to);
    }
    // The new directory entries survive a power loss once the restore has said it is done.
    #[cfg(unix)]
    {
        let mut dirs: Vec<&Path> = planned.iter().filter_map(|file| file.to.parent()).collect();
        dirs.sort();
        dirs.dedup();
        for dir in dirs {
            fs::File::open(dir)
                .and_then(|handle| handle.sync_all())
                .map_err(|e| io_error(dir, e))?;
        }
    }
    Ok(total)
}

/// Remove what a restore put in place, and the write-ahead log and shared memory SQLite made
/// beside a restored database when it was opened, so the restore can be retried.
pub(super) fn undo(planned: &[Planned]) {
    for file in planned {
        let _ = fs::remove_file(&file.to);
        if file.to.extension().is_some_and(|ext| ext == "sqlite3") {
            for suffix in ["-wal", "-shm"] {
                let mut name = file.to.as_os_str().to_os_string();
                name.push(suffix);
                let _ = fs::remove_file(PathBuf::from(name));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_manifest_path_stays_under_its_directory() {
        for good in [
            "store.sqlite3",
            "index/v2/meta.json",
            "state/spaces/main/events.jsonl",
        ] {
            assert!(plain_relative(good), "{good}");
        }
        for bad in ["", "../x", "/etc/passwd", "a/../b", "./a", "a\\b"] {
            assert!(!plain_relative(bad), "{bad}");
        }
    }

    #[test]
    fn a_damaged_file_puts_nothing_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let backup = dir.path().join("backup");
        fs::create_dir(&backup).unwrap();
        fs::write(backup.join("a"), b"alpha").unwrap();
        fs::write(backup.join("b"), b"bravo").unwrap();
        let plan = |name: &str, sha: String| Planned {
            name: name.to_owned(),
            from: backup.join(name),
            to: dir.path().join("live").join(name),
            bytes: 5,
            sha256: sha,
        };
        let planned = [plan("a", sha256(b"alpha")), plan("b", sha256(b"other"))];
        let staging = dir.path().join("live/.staging");
        let live = dir.path().join("live");
        let error = place(&planned, &backup, &live, &staging).unwrap_err();
        assert_eq!(error.code, codes::STORE_BACKUP_DAMAGED);
        assert!(!dir.path().join("live/a").exists());
        assert!(!staging.exists());
        // Verified, both are linked in place, private, and the staging directory is gone.
        let planned = [plan("a", sha256(b"alpha")), plan("b", sha256(b"bravo"))];
        assert_eq!(place(&planned, &backup, &live, &staging).unwrap(), 10);
        assert_eq!(fs::read(dir.path().join("live/b")).unwrap(), b"bravo");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join("live/a"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(!staging.exists());
        // A second restore over them is refused before anything is read.
        let error = place(&planned, &backup, &live, &staging).unwrap_err();
        assert_eq!(error.code, codes::STORE_RESTORE_NOT_EMPTY);
    }
}
