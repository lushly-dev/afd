//! Race-safe key files (specification section 2).
//!
//! Several processes may open a new workspace at once. A key is written to a temporary file in
//! the same directory (mode 0600 on Unix) and then hard-linked to its final name, which fails
//! with `AlreadyExists` exactly as `create_new` does when another process won. A reader never
//! sees a partly written key, and every process ends with the winner's bytes.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

use super::error::WorkspaceError;

/// The size of the approval and confirmation keys, and the minimum a key file may hold.
pub const KEY_BYTES: usize = 32;
/// The length of `http.token`: 32 random bytes as lowercase hex.
pub const TOKEN_CHARS: usize = 64;

/// Read the key at `path`, creating it first when missing.
pub(crate) fn ensure_key(path: &Path) -> Result<Vec<u8>, WorkspaceError> {
    if !path.exists() {
        let mut bytes = [0u8; KEY_BYTES];
        random(&mut bytes, path)?;
        create_once(path, &bytes)?;
    }
    read_key(path)
}

/// Read `http.token`, creating it first when missing.
pub(crate) fn ensure_token(path: &Path) -> Result<String, WorkspaceError> {
    if !path.exists() {
        let mut bytes = [0u8; KEY_BYTES];
        random(&mut bytes, path)?;
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        create_once(path, token.as_bytes())?;
    }
    read_token(path)
}

/// Read a key file and check its length.
pub(crate) fn read_key(path: &Path) -> Result<Vec<u8>, WorkspaceError> {
    let bytes = fs::read(path).map_err(|error| WorkspaceError::unwritable(path, error))?;
    if bytes.len() < KEY_BYTES {
        return Err(WorkspaceError::key_invalid(
            path,
            format!(
                "it holds {} bytes; a key needs at least {KEY_BYTES}",
                bytes.len()
            ),
        ));
    }
    Ok(bytes)
}

/// Read `http.token` and check its shape.
pub(crate) fn read_token(path: &Path) -> Result<String, WorkspaceError> {
    let bytes = fs::read(path).map_err(|error| WorkspaceError::unwritable(path, error))?;
    let well_formed = bytes.len() == TOKEN_CHARS
        && bytes
            .iter()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'));
    if !well_formed {
        return Err(WorkspaceError::key_invalid(
            path,
            format!("a token is {TOKEN_CHARS} lowercase hex characters"),
        ));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn random(bytes: &mut [u8], path: &Path) -> Result<(), WorkspaceError> {
    getrandom::fill(bytes)
        .map_err(|error| WorkspaceError::unwritable(path, format!("no random bytes: {error}")))
}

/// Write `content` to `path` unless the file already exists; either way `path` exists after.
fn create_once(path: &Path, content: &[u8]) -> Result<(), WorkspaceError> {
    let unwritable = |error: std::io::Error| WorkspaceError::unwritable(path, error);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let mut suffix = [0u8; 8];
    random(&mut suffix, path)?;
    let suffix: String = suffix.iter().map(|byte| format!("{byte:02x}")).collect();
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let temporary = dir.join(format!(".{name}.{}.{suffix}.tmp", std::process::id()));

    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&temporary).map_err(unwritable)?;
    let written = file.write_all(content).and_then(|()| file.sync_all());
    drop(file);
    let linked = written.and_then(|()| fs::hard_link(&temporary, path));
    // Best effort: a leftover temporary file holds key bytes only until the next open.
    let _ = fs::remove_file(&temporary);
    match linked {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(unwritable(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_created_once_and_read_after() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.key");
        let first = ensure_key(&path).unwrap();
        assert_eq!(first.len(), KEY_BYTES);
        assert_eq!(ensure_key(&path).unwrap(), first);
        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temporary file stays behind");
    }

    #[test]
    fn a_short_key_is_invalid_and_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.key");
        fs::write(&path, [0u8; 16]).unwrap();
        let error = ensure_key(&path).unwrap_err();
        assert_eq!(error.code(), "WORKSPACE_KEY_INVALID");
        assert!(error.message().contains("a.key"));
        assert_eq!(fs::read(&path).unwrap().len(), 16);
    }

    #[test]
    fn a_token_is_64_lowercase_hex_characters() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("http.token");
        let token = ensure_token(&path).unwrap();
        assert_eq!(token.len(), TOKEN_CHARS);
        fs::write(&path, "ABC").unwrap();
        assert_eq!(
            ensure_token(&path).unwrap_err().code(),
            "WORKSPACE_KEY_INVALID"
        );
    }
}
