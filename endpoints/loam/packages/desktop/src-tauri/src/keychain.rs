//! OS keychain storage for desktop credentials (phase 5 specification, 4.2; no-terminal amendment, 5.3).
//!
//! Each platform reads, writes, and deletes generic passwords with zero shell invocation:
//! - Windows: native Win32 `CredReadW`, `CredWriteW`, and `CredDeleteW` (`windows-sys`), target
//!   `<service>/<account>`, UTF-16LE blob (`CRED_PERSIST_LOCAL_MACHINE`), pre-checking Windows'
//!   2,560-byte `CREDENTIALW.CredentialBlobSize` limit.
//! - macOS: native `Security.framework` ordered Keychain search-list lookup first
//!   (`find_generic_password(None, ...)`), falling back to `apple-native-keyring-store`
//!   (`MacKeychainDomain::User`) only on `errSecItemNotFound` (`NoEntry`); writes update the
//!   winning search-list entry in place (or write to `MacKeychainDomain::User` when absent) and
//!   deletes clear matching entries across the search list and user domain so reads, writes, and
//!   deletes always agree.
//! - Linux and other Unixes: Secret Service via `secret-tool` (`lookup`, `store` with secret on
//!   stdin only, `clear`).
//!
//! Every entrypoint validates `models::keychain_name` on both `service` and `account` before
//! touching OS APIs. Non-default profiles (`LOAM_DESKTOP_DATA_DIR` set) append `-<profile8>`
//! (the first 8 lowercase hex characters of `SHA-256(canonical_data_dir)`) to service names.

use crate::models::keychain_name;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Default profile keychain service for copilot model API keys (5.3).
pub(crate) const COPILOT_SERVICE: &str = "loam-copilot";
/// Default profile keychain service for plugin mount bearer tokens (5.3; shared with `materialize`).
pub(crate) const MOUNT_SERVICE: &str = crate::materialize::MOUNT_KEYCHAIN;

/// Windows Credential Manager `CRED_MAX_CREDENTIAL_BLOB_SIZE` in bytes (1,280 UTF-16 code units).
#[allow(dead_code)]
pub(crate) const WINDOWS_CREDENTIAL_BLOB_MAX: usize = 2560;

/// Amendment section 11 error codes for keychain writes.
pub(crate) const COPILOT_KEY_TOO_LONG: &str = "COPILOT_KEY_TOO_LONG";
pub(crate) const PLUGIN_KEY_TOO_LONG: &str = "PLUGIN_KEY_TOO_LONG";
pub(crate) const COPILOT_KEYCHAIN_UNAVAILABLE: &str = "COPILOT_KEYCHAIN_UNAVAILABLE";
pub(crate) const PLUGIN_KEYCHAIN_UNAVAILABLE: &str = "PLUGIN_KEYCHAIN_UNAVAILABLE";

/// Typed failure from [`write`] or [`delete`]. Never contains the secret or raw platform text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum KeychainError {
    /// `service` or `account` failed [`crate::models::keychain_name`].
    InvalidName,
    /// On Windows, the secret's UTF-16LE encoding exceeds [`WINDOWS_CREDENTIAL_BLOB_MAX`] (2,560 bytes).
    TooLong,
    /// The OS keychain/keyring backend is unavailable, locked, or refused the operation.
    Unavailable,
}

impl KeychainError {
    /// Maps this error to its amendment section 11 code for copilot model key setup.
    #[allow(dead_code)]
    pub(crate) fn copilot_code(self) -> &'static str {
        match self {
            Self::TooLong => COPILOT_KEY_TOO_LONG,
            Self::InvalidName | Self::Unavailable => COPILOT_KEYCHAIN_UNAVAILABLE,
        }
    }

    /// Maps this error to its amendment section 11 code for plugin bearer token pairing.
    #[allow(dead_code)]
    pub(crate) fn plugin_code(self) -> &'static str {
        match self {
            Self::TooLong => PLUGIN_KEY_TOO_LONG,
            Self::InvalidName | Self::Unavailable => PLUGIN_KEYCHAIN_UNAVAILABLE,
        }
    }
}

fn validate_names(service: &str, account: &str) -> Result<(), KeychainError> {
    if keychain_name(service) && keychain_name(account) {
        Ok(())
    } else {
        Err(KeychainError::InvalidName)
    }
}

/// Byte length of `secret` encoded as UTF-16 (Windows Credential Manager's `CredentialBlobSize`).
#[allow(dead_code)]
pub(crate) fn utf16_byte_len(secret: &str) -> usize {
    secret
        .encode_utf16()
        .count()
        .saturating_mul(std::mem::size_of::<u16>())
}

/// Whether `secret` exceeds Windows' 2,560-byte `CREDENTIALW.CredentialBlobSize` limit.
#[allow(dead_code)]
pub(crate) fn exceeds_windows_blob_limit(secret: &str) -> bool {
    utf16_byte_len(secret) > WINDOWS_CREDENTIAL_BLOB_MAX
}

/// Canonicalizes `path` even when its leaf directory does not yet exist: relative paths are
/// anchored to `cwd` first, then the deepest existing ancestor is canonicalized and remaining
/// components are re-appended, so the profile suffix is stable before and after directory creation.
fn canonical_data_dir_from(cwd: Option<&Path>, path: &Path) -> PathBuf {
    let resolved = if path.is_relative() {
        match cwd {
            Some(base) => base.join(path),
            None => path.to_path_buf(),
        }
    } else {
        path.to_path_buf()
    };
    if let Ok(canonical) = std::fs::canonicalize(&resolved) {
        return canonical;
    }
    let mut tail = Vec::new();
    let mut cursor = resolved.as_path();
    while let Some(name) = cursor.file_name() {
        tail.push(name.to_os_string());
        match cursor.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                if let Ok(mut canonical) = std::fs::canonicalize(parent) {
                    for part in tail.into_iter().rev() {
                        canonical.push(part);
                    }
                    return canonical;
                }
                cursor = parent;
            }
            _ => break,
        }
    }
    resolved
}

fn canonical_data_dir(path: &Path) -> PathBuf {
    let cwd = std::env::current_dir().ok();
    canonical_data_dir_from(cwd.as_deref(), path)
}

/// First 8 lowercase hex characters of `SHA-256(canonical_data_dir)` (amendment 5.3).
pub(crate) fn profile_suffix(data_dir: &Path) -> String {
    let canonical = canonical_data_dir(data_dir);
    let digest = Sha256::digest(canonical.as_os_str().as_encoded_bytes());
    let mut out = String::with_capacity(8);
    for byte in &digest[..4] {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

/// Appends `-<profile8>` to `base` when `custom_data_dir` is set (non-default profile, 5.3).
pub(crate) fn scoped_service(base: &str, custom_data_dir: Option<&Path>) -> String {
    match custom_data_dir {
        Some(dir) => format!("{base}-{}", profile_suffix(dir)),
        None => base.to_owned(),
    }
}

/// The copilot keychain service for this profile (`loam-copilot` or `loam-copilot-<profile8>`).
#[allow(dead_code)]
pub(crate) fn copilot_service(custom_data_dir: Option<&Path>) -> String {
    scoped_service(COPILOT_SERVICE, custom_data_dir)
}

/// The plugin mount keychain service for this profile (`loam-plugin-mount` or `loam-plugin-mount-<profile8>`).
#[allow(dead_code)]
pub(crate) fn mount_service(custom_data_dir: Option<&Path>) -> String {
    scoped_service(MOUNT_SERVICE, custom_data_dir)
}

/// The non-default profile data directory from `LOAM_DESKTOP_DATA_DIR`, matching `lib.rs` and
/// `connection::data_directory` (any set value selects a non-default profile; unset is default).
#[allow(dead_code)]
pub(crate) fn custom_data_dir() -> Option<PathBuf> {
    std::env::var_os(crate::DATA_DIRECTORY).map(PathBuf::from)
}

#[cfg(windows)]
fn zeroize_bytes(bytes: &mut [u8]) {
    for byte in bytes {
        // SAFETY: `byte` is a valid mutable reference inside `bytes`.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
}

/// Windows: the generic credential `<service>/<account>`, as `loam copilot key set` and [`write`]
/// store it with `CredWriteW`, its blob UTF-16LE as Windows stores a typed password.
#[cfg(windows)]
pub(crate) fn read(service: &str, account: &str) -> Option<String> {
    use windows_sys::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
    };
    validate_names(service, account).ok()?;
    let target: Vec<u16> = format!("{service}/{account}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut credential: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `target` is a NUL-terminated UTF-16 string that outlives the call, and `credential` is written by
    // the call only when it succeeds.
    let found = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
    if found == 0 || credential.is_null() {
        return None;
    }
    // SAFETY: on success `credential` points at a CREDENTIALW whose blob holds `CredentialBlobSize` bytes; both
    // live until `CredFree`, which is called once, after the copy.
    let mut bytes = unsafe {
        let held = &*credential;
        let size = held.CredentialBlobSize as usize;
        let bytes = if held.CredentialBlob.is_null() || size > 2 * 4096 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(held.CredentialBlob, size).to_vec()
        };
        CredFree(credential.cast());
        bytes
    };
    if bytes.len() % 2 != 0 {
        zeroize_bytes(&mut bytes);
        return None;
    }
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    zeroize_bytes(&mut bytes);
    String::from_utf16(&units).ok()
}

/// Windows: stores `<service>/<account>` via native Win32 `CredWriteW` (zero PowerShell),
/// pre-checking the 2,560-byte UTF-16LE `CREDENTIALW.CredentialBlobSize` limit.
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) fn write(service: &str, account: &str, secret: &str) -> Result<(), KeychainError> {
    use windows_sys::Win32::Security::Credentials::{
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredWriteW,
    };
    validate_names(service, account)?;
    if exceeds_windows_blob_limit(secret) {
        return Err(KeychainError::TooLong);
    }
    let mut blob: Vec<u8> = secret.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let blob_size = u32::try_from(blob.len()).map_err(|_| KeychainError::TooLong)?;
    let mut target: Vec<u16> = format!("{service}/{account}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut user: Vec<u16> = account.encode_utf16().chain(std::iter::once(0)).collect();
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        UserName: user.as_mut_ptr(),
        CredentialBlobSize: blob_size,
        CredentialBlob: if blob.is_empty() {
            std::ptr::null_mut()
        } else {
            blob.as_mut_ptr()
        },
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..Default::default()
    };
    // SAFETY: `target` and `user` are NUL-terminated UTF-16 strings and `blob` holds `blob_size`
    // bytes; all three outlive the synchronous `CredWriteW` call.
    let written = unsafe { CredWriteW(&credential, 0) };
    zeroize_bytes(&mut blob);
    if written != 0 {
        Ok(())
    } else {
        Err(KeychainError::Unavailable)
    }
}

/// Windows: deletes `<service>/<account>` via native Win32 `CredDeleteW` (idempotent on `ERROR_NOT_FOUND`).
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) fn delete(service: &str, account: &str) -> Result<(), KeychainError> {
    use windows_sys::Win32::Foundation::{ERROR_NOT_FOUND, GetLastError};
    use windows_sys::Win32::Security::Credentials::{CRED_TYPE_GENERIC, CredDeleteW};
    validate_names(service, account)?;
    let target: Vec<u16> = format!("{service}/{account}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // SAFETY: `target` is a NUL-terminated UTF-16 string that outlives `CredDeleteW`.
    if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } != 0 {
        return Ok(());
    }
    // SAFETY: `GetLastError` reads this thread's last Win32 error set by `CredDeleteW`.
    if unsafe { GetLastError() } == ERROR_NOT_FOUND {
        Ok(())
    } else {
        Err(KeychainError::Unavailable)
    }
}

/// Maximum number of duplicate entries across distinct macOS keychains that [`delete`] will clear
/// in one call before failing closed (guards against non-deletable/read-only keychain loops).
#[cfg(target_os = "macos")]
const MACOS_DELETE_PASSES_MAX: usize = 16;

/// macOS: the generic password for the service and account via Security.framework rather than spawning
/// `/usr/bin/security`. Searches the user's ordered Keychain search list first (`find_generic_password(None, ...)`),
/// matching `security find-generic-password` so CLI verification and desktop reads resolve the exact same
/// credential even when duplicate entries exist across keychains. Falls back to `apple-native-keyring-store`
/// (`MacKeychainDomain::User`) only on `errSecItemNotFound` (`NoEntry`) in case the user's default login
/// keychain is absent from their search list, without re-prompting on locked/denied errors.
#[cfg(target_os = "macos")]
pub(crate) fn read(service: &str, account: &str) -> Option<String> {
    validate_names(service, account).ok()?;
    read_with(
        || find_password_in(None, service, account),
        || {
            apple_native_keyring_store::keychain::Cred::build(
                apple_native_keyring_store::keychain::MacKeychainDomain::User,
                service,
                account,
            )
            .ok()?
            .get_password()
            .ok()
        },
    )
}

#[cfg(target_os = "macos")]
fn find_password_in(
    keychains: Option<&[security_framework::os::macos::keychain::SecKeychain]>,
    service: &str,
    account: &str,
) -> keyring_core::Result<String> {
    security_framework::os::macos::passwords::find_generic_password(keychains, service, account)
        .map_err(apple_native_keyring_store::keychain::decode_error)
        .and_then(|(bytes, _)| {
            String::from_utf8(bytes.as_ref().to_vec())
                .map_err(|_| keyring_core::Error::BadEncoding(bytes.as_ref().to_vec()))
        })
}

#[cfg(target_os = "macos")]
fn read_with(
    search_list: impl FnOnce() -> keyring_core::Result<String>,
    default_keychain: impl FnOnce() -> Option<String>,
) -> Option<String> {
    match search_list() {
        Ok(secret) => Some(secret),
        Err(keyring_core::Error::NoEntry) => default_keychain(),
        Err(_) => None,
    }
}

/// Writes `secret` consistently with [`read`]: if an entry already exists in the ordered search
/// list, updates that winning item in place so a subsequent [`read`] never returns a stale shadow;
/// otherwise writes to `default_write` (the user's default login keychain).
#[cfg(target_os = "macos")]
fn write_in(
    search_list: Option<&[security_framework::os::macos::keychain::SecKeychain]>,
    default_write: impl FnOnce() -> Result<(), KeychainError>,
    service: &str,
    account: &str,
    secret: &str,
) -> Result<(), KeychainError> {
    match security_framework::os::macos::passwords::find_generic_password(
        search_list,
        service,
        account,
    )
    .map_err(apple_native_keyring_store::keychain::decode_error)
    {
        Ok((_, mut item)) => item
            .set_password(secret.as_bytes())
            .map_err(|_| KeychainError::Unavailable),
        Err(keyring_core::Error::NoEntry) => default_write(),
        Err(_) => Err(KeychainError::Unavailable),
    }
}

/// Deletes every matching entry visible in `search_list` and in `default_delete` so a subsequent
/// [`read`] cannot return a shadowed entry from another keychain in the search list.
#[cfg(target_os = "macos")]
fn delete_in(
    search_list: Option<&[security_framework::os::macos::keychain::SecKeychain]>,
    default_delete: impl FnOnce() -> Result<(), KeychainError>,
    service: &str,
    account: &str,
) -> Result<(), KeychainError> {
    for _ in 0..MACOS_DELETE_PASSES_MAX {
        match security_framework::os::macos::passwords::find_generic_password(
            search_list,
            service,
            account,
        )
        .map_err(apple_native_keyring_store::keychain::decode_error)
        {
            Ok((_, item)) => item.delete(),
            Err(keyring_core::Error::NoEntry) => {
                return default_delete();
            }
            Err(_) => return Err(KeychainError::Unavailable),
        }
    }
    // Check whether the final deletion cleared the search list; if an item still remains (e.g.
    // read-only keychain), fail closed rather than claiming deletion succeeded.
    match security_framework::os::macos::passwords::find_generic_password(
        search_list,
        service,
        account,
    )
    .map_err(apple_native_keyring_store::keychain::decode_error)
    {
        Err(keyring_core::Error::NoEntry) => default_delete(),
        _ => Err(KeychainError::Unavailable),
    }
}

/// macOS: writes or updates the generic password natively via `Security.framework` and
/// `apple-native-keyring-store` (`MacKeychainDomain::User`), never spawning `/usr/bin/security`.
#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub(crate) fn write(service: &str, account: &str, secret: &str) -> Result<(), KeychainError> {
    validate_names(service, account)?;
    write_in(
        None,
        || {
            let entry = apple_native_keyring_store::keychain::Cred::build(
                apple_native_keyring_store::keychain::MacKeychainDomain::User,
                service,
                account,
            )
            .map_err(|_| KeychainError::Unavailable)?;
            entry
                .set_password(secret)
                .map_err(|_| KeychainError::Unavailable)
        },
        service,
        account,
        secret,
    )
}

/// macOS: deletes the generic password across the user's ordered search list and login keychain
/// natively via `Security.framework` / `apple-native-keyring-store` (idempotent on `NoEntry`).
#[cfg(target_os = "macos")]
#[allow(dead_code)]
pub(crate) fn delete(service: &str, account: &str) -> Result<(), KeychainError> {
    validate_names(service, account)?;
    delete_in(
        None,
        || {
            let entry = apple_native_keyring_store::keychain::Cred::build(
                apple_native_keyring_store::keychain::MacKeychainDomain::User,
                service,
                account,
            )
            .map_err(|_| KeychainError::Unavailable)?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(_) => Err(KeychainError::Unavailable),
            }
        },
        service,
        account,
    )
}

/// Linux and the other Unixes: the Secret Service item with the service and account, from `secret-tool`.
#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn read(service: &str, account: &str) -> Option<String> {
    read_via("secret-tool", service, account)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn read_via(program: &str, service: &str, account: &str) -> Option<String> {
    validate_names(service, account).ok()?;
    let output = std::process::Command::new(program)
        .args(["lookup", "service", service, "account", account])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8(output.stdout).ok())
        .flatten()
}

/// Linux and the other Unixes: stores the Secret Service item via `secret-tool store`, piping the
/// secret on stdin only (never on argv or environment).
#[cfg(all(unix, not(target_os = "macos")))]
#[allow(dead_code)]
pub(crate) fn write(service: &str, account: &str, secret: &str) -> Result<(), KeychainError> {
    write_via("secret-tool", service, account, secret)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn write_via(
    program: &str,
    service: &str,
    account: &str,
    secret: &str,
) -> Result<(), KeychainError> {
    use std::io::Write as _;
    validate_names(service, account)?;
    let label = format!("Loam credential {service}/{account}");
    let mut child = std::process::Command::new(program)
        .args([
            "store", "--label", &label, "service", service, "account", account,
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| KeychainError::Unavailable)?;
    let write_result = match child.stdin.take() {
        Some(mut stdin) => stdin
            .write_all(secret.as_bytes())
            .and_then(|()| stdin.flush()),
        None => Err(std::io::Error::other("missing stdin pipe")),
    };
    let status = child.wait().map_err(|_| KeychainError::Unavailable)?;
    if write_result.is_ok() && status.success() {
        Ok(())
    } else {
        Err(KeychainError::Unavailable)
    }
}

/// Linux and the other Unixes: removes the Secret Service item via `secret-tool clear` (idempotent).
#[cfg(all(unix, not(target_os = "macos")))]
#[allow(dead_code)]
pub(crate) fn delete(service: &str, account: &str) -> Result<(), KeychainError> {
    delete_via("secret-tool", service, account)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn delete_via(program: &str, service: &str, account: &str) -> Result<(), KeychainError> {
    validate_names(service, account)?;
    let output = std::process::Command::new(program)
        .args(["clear", "service", service, "account", account])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|_| KeychainError::Unavailable)?;
    if output.status.success() {
        return Ok(());
    }
    // GNOME `libsecret`'s `secret-tool clear` exits 1 with empty stderr when no matching item
    // existed, and prints an error to stderr with exit 1 when Secret Service is unavailable or
    // locked (`tool/secret-tool.c`).
    if output.status.code() == Some(1) && output.stderr.is_empty() {
        Ok(())
    } else {
        Err(KeychainError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct CleanupGuard {
        service: String,
        account: String,
    }

    impl Drop for CleanupGuard {
        fn drop(&mut self) {
            let _ = delete(&self.service, &self.account);
        }
    }

    fn unique_test_slot() -> (String, String) {
        let mut rand = [0u8; 8];
        getrandom::fill(&mut rand).expect("OS random source");
        let suffix: String = rand.iter().map(|b| format!("{b:02x}")).collect();
        (
            format!("loam-test-kc-{suffix}"),
            format!("acct-{}", std::process::id()),
        )
    }

    #[test]
    fn p5_s9_3_invalid_service_and_account_names_are_refused_before_os_apis() {
        let invalid = [
            "",
            "-leading-dash",
            ".leading-dot",
            "_leading-under",
            "has space",
            "has/slash",
            "has\\backslash",
            "has\"quote",
            "has\nnewline",
            "has\0nul",
        ];
        let too_long = "a".repeat(65);
        for bad in invalid
            .into_iter()
            .chain(std::iter::once(too_long.as_str()))
        {
            assert_eq!(read(bad, "valid"), None, "read service {bad:?}");
            assert_eq!(read("valid", bad), None, "read account {bad:?}");
            assert_eq!(
                write(bad, "valid", "sk-secret-01234567"),
                Err(KeychainError::InvalidName),
                "write service {bad:?}"
            );
            assert_eq!(
                write("valid", bad, "sk-secret-01234567"),
                Err(KeychainError::InvalidName),
                "write account {bad:?}"
            );
            assert_eq!(
                delete(bad, "valid"),
                Err(KeychainError::InvalidName),
                "delete service {bad:?}"
            );
            assert_eq!(
                delete("valid", bad),
                Err(KeychainError::InvalidName),
                "delete account {bad:?}"
            );
        }
        // Boundary: 64-character valid names pass validation.
        assert!(validate_names(&"a".repeat(64), &"b0._-".repeat(12)).is_ok());
    }

    #[test]
    fn p5_s9_3_windows_utf16_blob_limit_is_enforced_at_2560_bytes() {
        let at_limit = "a".repeat(1280);
        let over_limit = "a".repeat(1281);
        assert_eq!(utf16_byte_len(&at_limit), WINDOWS_CREDENTIAL_BLOB_MAX);
        assert!(!exceeds_windows_blob_limit(&at_limit));
        assert_eq!(utf16_byte_len(&over_limit), WINDOWS_CREDENTIAL_BLOB_MAX + 2);
        assert!(exceeds_windows_blob_limit(&over_limit));

        // Non-BMP characters take 2 UTF-16 code units (4 bytes) each.
        let emoji_at_limit = "\u{1F511}".repeat(640);
        let emoji_over_limit = "\u{1F511}".repeat(641);
        assert_eq!(utf16_byte_len(&emoji_at_limit), WINDOWS_CREDENTIAL_BLOB_MAX);
        assert!(!exceeds_windows_blob_limit(&emoji_at_limit));
        assert_eq!(
            utf16_byte_len(&emoji_over_limit),
            WINDOWS_CREDENTIAL_BLOB_MAX + 4
        );
        assert!(exceeds_windows_blob_limit(&emoji_over_limit));

        // Error-code mapping matches amendment section 11.
        assert_eq!(KeychainError::TooLong.copilot_code(), COPILOT_KEY_TOO_LONG);
        assert_eq!(KeychainError::TooLong.plugin_code(), PLUGIN_KEY_TOO_LONG);
        assert_eq!(
            KeychainError::Unavailable.copilot_code(),
            COPILOT_KEYCHAIN_UNAVAILABLE
        );
        assert_eq!(
            KeychainError::Unavailable.plugin_code(),
            PLUGIN_KEYCHAIN_UNAVAILABLE
        );

        #[cfg(windows)]
        {
            let (service, account) = unique_test_slot();
            assert_eq!(
                write(&service, &account, &over_limit),
                Err(KeychainError::TooLong)
            );
            assert_eq!(read(&service, &account), None);
        }
    }

    #[test]
    fn p5_s9_4_profile_scoped_services_follow_default_and_profile8_rules() {
        assert_eq!(copilot_service(None), "loam-copilot");
        assert_eq!(mount_service(None), "loam-plugin-mount");
        assert_eq!(MOUNT_SERVICE, crate::materialize::MOUNT_KEYCHAIN);

        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        let suffix_a = profile_suffix(dir_a.path());
        let suffix_b = profile_suffix(dir_b.path());
        assert_eq!(suffix_a.len(), 8);
        assert!(
            suffix_a
                .bytes()
                .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        );
        assert_ne!(suffix_a, suffix_b);

        // Matches SHA-256(canonical_data_dir)[..4] in lowercase hex.
        let canonical = std::fs::canonicalize(dir_a.path()).unwrap();
        let digest = Sha256::digest(canonical.as_os_str().as_encoded_bytes());
        let expected: String = digest[..4].iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(suffix_a, expected);

        // A not-yet-created child directory under `dir_a` hashes identically before and after creation.
        let future = dir_a.path().join("profile-child");
        let before = profile_suffix(&future);
        std::fs::create_dir(&future).unwrap();
        let after = profile_suffix(&future);
        assert_eq!(before, after);

        // A single-component relative path also resolves identically before and after creation.
        let rel_before = canonical_data_dir_from(Some(dir_b.path()), Path::new("rel-profile"));
        std::fs::create_dir(dir_b.path().join("rel-profile")).unwrap();
        let rel_after = canonical_data_dir_from(Some(dir_b.path()), Path::new("rel-profile"));
        assert_eq!(rel_before, rel_after);
        assert!(rel_before.is_absolute());

        let scoped_copilot = copilot_service(Some(dir_a.path()));
        let scoped_mount = mount_service(Some(dir_a.path()));
        assert_eq!(scoped_copilot, format!("loam-copilot-{suffix_a}"));
        assert_eq!(scoped_mount, format!("loam-plugin-mount-{suffix_a}"));
        assert!(keychain_name(&scoped_copilot));
        assert!(keychain_name(&scoped_mount));
    }

    #[test]
    fn p5_s9_3_live_keychain_write_read_update_delete_round_trip() {
        let (service, account) = unique_test_slot();
        let _cleanup = CleanupGuard {
            service: service.clone(),
            account: account.clone(),
        };

        assert_eq!(read(&service, &account), None);
        let initial = "sk-loam-roundtrip-initial-01234567";
        let updated = "sk-loam-roundtrip-updated-89abcdef";

        match write(&service, &account, initial) {
            Ok(()) => {}
            #[cfg(all(unix, not(target_os = "macos")))]
            Err(KeychainError::Unavailable) => {
                // Headless Linux runners have no unlocked Secret Service daemon; the fake-helper
                // test below exercises `secret-tool`'s stdin/argv/clear contract on every Linux run.
                eprintln!("skipping live Secret Service round-trip: no unlocked Secret Service");
                return;
            }
            Err(other) => panic!("live keychain write failed unexpectedly: {other:?}"),
        }

        assert_eq!(read(&service, &account).as_deref(), Some(initial));
        write(&service, &account, updated).expect("update existing keychain entry");
        assert_eq!(read(&service, &account).as_deref(), Some(updated));
        delete(&service, &account).expect("delete keychain entry");
        assert_eq!(read(&service, &account), None);
        // Deleting an absent entry is idempotent.
        delete(&service, &account).expect("idempotent delete of absent entry");
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn p5_s9_3_linux_secret_tool_pipes_secret_on_stdin_never_argv() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store_file = dir.path().join("stored.txt");
        let argv_file = dir.path().join("argv.txt");
        let fail_flag = dir.path().join("fail.flag");
        let script = dir.path().join("fake-secret-tool");
        // Models GNOME `libsecret`'s `tool/secret-tool.c` exit and stderr behavior:
        // - `clear` exits 0 when removing an item, 1 with empty stderr when absent, and 1 with
        //   non-empty stderr when Secret Service is unavailable/locked.
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\n\
                 printf '%s\\n' \"$@\" >> \"{}\"\n\
                 if [ -f \"{}\" ]; then\n\
                   echo \"secret-tool: Cannot autolaunch D-Bus without X11\" >&2\n\
                   exit 1\n\
                 fi\n\
                 case \"$1\" in\n\
                   store)\n\
                     cat > \"{}\"\n\
                     exit 0\n\
                     ;;\n\
                   lookup)\n\
                     if [ -f \"{}\" ]; then cat \"{}\"; exit 0; else exit 1; fi\n\
                     ;;\n\
                   clear)\n\
                     if [ -f \"{}\" ]; then rm -f \"{}\"; exit 0; else exit 1; fi\n\
                     ;;\n\
                   *) exit 2 ;;\n\
                 esac\n",
                argv_file.display(),
                fail_flag.display(),
                store_file.display(),
                store_file.display(),
                store_file.display(),
                store_file.display(),
                store_file.display(),
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let prog = script.to_str().unwrap();

        let secret = "sk-linux-stdin-only-01234567";
        assert_eq!(read_via(prog, "loam-plugin-mount", "mail.tok_1"), None);
        write_via(prog, "loam-plugin-mount", "mail.tok_1", secret).unwrap();
        assert_eq!(
            read_via(prog, "loam-plugin-mount", "mail.tok_1").as_deref(),
            Some(secret)
        );
        // Confirm the secret never appeared in argv.
        let argv = std::fs::read_to_string(&argv_file).unwrap();
        assert!(!argv.contains(secret), "secret leaked into argv: {argv}");
        assert!(argv.contains("store") && argv.contains("mail.tok_1"));

        // First delete removes the item (exit 0); second delete sees exit 1 + empty stderr and stays idempotent.
        delete_via(prog, "loam-plugin-mount", "mail.tok_1").unwrap();
        assert_eq!(read_via(prog, "loam-plugin-mount", "mail.tok_1"), None);
        delete_via(prog, "loam-plugin-mount", "mail.tok_1").unwrap();

        // Unavailable / locked Secret Service (exit 1 with stderr) fails closed on both write and delete.
        std::fs::write(&fail_flag, b"1").unwrap();
        assert_eq!(
            write_via(prog, "loam-plugin-mount", "mail.tok_1", secret),
            Err(KeychainError::Unavailable)
        );
        assert_eq!(
            delete_via(prog, "loam-plugin-mount", "mail.tok_1"),
            Err(KeychainError::Unavailable)
        );
        std::fs::remove_file(&fail_flag).unwrap();

        // Missing program fails closed as Unavailable.
        assert_eq!(
            write_via(
                dir.path().join("no-such-binary").to_str().unwrap(),
                "loam-plugin-mount",
                "mail.tok_1",
                secret
            ),
            Err(KeychainError::Unavailable)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn p5_a3_a_missing_macos_keychain_entry_is_absent() {
        assert_eq!(
            read(
                "loam-copilot-absent-test-service",
                "absent-account-00000000"
            ),
            None
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn p5_a3_macos_keychain_uses_search_list_first_and_falls_back_only_on_no_entry() {
        let mut fallback_calls = 0usize;
        assert_eq!(
            read_with(
                || Ok("sk-search-list-01234567".into()),
                || {
                    fallback_calls += 1;
                    Some("sk-default-01234567".into())
                }
            ),
            Some("sk-search-list-01234567".into())
        );
        assert_eq!(fallback_calls, 0);

        // `NoEntry` from the search list falls back to the user's default login keychain.
        assert_eq!(
            read_with(
                || Err(keyring_core::Error::NoEntry),
                || {
                    fallback_calls += 1;
                    Some("sk-default-01234567".into())
                }
            ),
            Some("sk-default-01234567".into())
        );
        assert_eq!(fallback_calls, 1);

        // Non-`NoEntry` errors (locked/denied) fail closed without calling the fallback.
        assert_eq!(
            read_with(
                || Err(keyring_core::Error::NoStorageAccess(Box::new(
                    std::io::Error::other("locked")
                ))),
                || {
                    fallback_calls += 1;
                    Some("sk-default-01234567".into())
                }
            ),
            None
        );
        assert_eq!(fallback_calls, 1);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn p5_a3_macos_cli_written_entry_follows_ordered_search_list_via_security_framework() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let make_keychain = |name: &str, secret: &str| {
            let kc_path = dir.path().join(name);
            let kc_str = kc_path.to_str().unwrap();
            let status = std::process::Command::new("/usr/bin/security")
                .args(["create-keychain", "-p", "loam-test-pass", kc_str])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "create-keychain failed");
            let unlock = std::process::Command::new("/usr/bin/security")
                .args(["unlock-keychain", "-p", "loam-test-pass", kc_str])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap();
            assert!(unlock.success(), "unlock-keychain failed");

            // Write via `security -i` matching `copilot-key.ts` (with `-A` only in this isolated temp
            // keychain so automated test runs never pop an interactive Keychain Access prompt).
            let mut child = std::process::Command::new("/usr/bin/security")
                .args(["-i"])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            writeln!(
                child.stdin.as_mut().unwrap(),
                "add-generic-password -A -U -s \"loam-copilot-test\" -a \"claude\" -l \"Loam copilot key\" -w \"{secret}\" \"{kc_str}\""
            )
            .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success() && output.stderr.is_empty(),
                "security -i failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            security_framework::os::macos::keychain::SecKeychain::open(&kc_path).unwrap()
        };

        let first_secret = "sk-ant-first-search-list-entry-01234567";
        let second_secret = "sk-ant-second-default-entry-89abcdef";
        let first_kc = make_keychain("first.keychain-db", first_secret);
        let second_kc = make_keychain("second.keychain-db", second_secret);
        let ordered = [first_kc.clone(), second_kc.clone()];

        // Ordered search list returns the first keychain's entry, matching `security find-generic-password`.
        assert_eq!(
            find_password_in(Some(&ordered), "loam-copilot-test", "claude").unwrap(),
            first_secret
        );

        // Reversing the search list order returns the other keychain's entry first.
        let reversed = [second_kc.clone(), first_kc.clone()];
        assert_eq!(
            find_password_in(Some(&reversed), "loam-copilot-test", "claude").unwrap(),
            second_secret
        );

        // `write_in` updates the winning search-list entry so a subsequent read never sees a stale shadow.
        let updated = "sk-ant-updated-in-place-fedcba98";
        write_in(
            Some(&ordered),
            || {
                second_kc
                    .set_generic_password("loam-copilot-test", "claude", updated.as_bytes())
                    .map_err(|_| KeychainError::Unavailable)
            },
            "loam-copilot-test",
            "claude",
            updated,
        )
        .unwrap();
        assert_eq!(
            find_password_in(Some(&ordered), "loam-copilot-test", "claude").unwrap(),
            updated
        );

        // `delete_in` clears matching entries across the entire search list (both `first_kc` and
        // `second_kc`) so a subsequent read returns `NoEntry`, and a repeat delete is idempotent.
        delete_in(Some(&ordered), || Ok(()), "loam-copilot-test", "claude").unwrap();
        assert!(matches!(
            find_password_in(Some(&ordered), "loam-copilot-test", "claude"),
            Err(keyring_core::Error::NoEntry)
        ));
        delete_in(Some(&ordered), || Ok(()), "loam-copilot-test", "claude").unwrap();
    }
}
