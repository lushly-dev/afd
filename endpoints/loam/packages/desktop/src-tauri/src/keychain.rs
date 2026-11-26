//! OS keychain lookup for desktop credentials (phase 5 specification, 4.2).
//!
//! Each platform reads generic passwords with zero shell invocation:
//! - Windows: Win32 `CredReadW` (`windows-sys`), target `<service>/<account>`, UTF-16 blob.
//! - macOS: native `Security.framework` ordered Keychain search-list lookup first
//!   (`find_generic_password(None, ...)`), falling back to `apple-native-keyring-store`
//!   (`MacKeychainDomain::User`) only on `errSecItemNotFound` (`NoEntry`).
//! - Linux and other Unixes: Secret Service via `secret-tool lookup`.

/// Windows: the generic credential `<service>/<account>`, as `loam copilot key set` writes it with `CredWriteW`,
/// its blob UTF-16 as Windows stores a typed password.
#[cfg(windows)]
pub(crate) fn read(service: &str, account: &str) -> Option<String> {
    use windows_sys::Win32::Security::Credentials::{
        CRED_TYPE_GENERIC, CREDENTIALW, CredFree, CredReadW,
    };
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
    let bytes = unsafe {
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
        return None;
    }
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    String::from_utf16(&units).ok()
}

/// macOS: the generic password for the service and account via Security.framework rather than spawning
/// `/usr/bin/security`. Searches the user's ordered Keychain search list first (`find_generic_password(None, ...)`),
/// matching `security find-generic-password` so CLI verification and desktop reads resolve the exact same
/// credential even when duplicate entries exist across keychains. Falls back to `apple-native-keyring-store`
/// (`MacKeychainDomain::User`) only on `errSecItemNotFound` (`NoEntry`) in case the user's default login
/// keychain is absent from their search list, without re-prompting on locked/denied errors.
#[cfg(target_os = "macos")]
pub(crate) fn read(service: &str, account: &str) -> Option<String> {
    read_with(
        || {
            security_framework::os::macos::passwords::find_generic_password(None, service, account)
                .map_err(apple_native_keyring_store::keychain::decode_error)
                .and_then(|(bytes, _)| {
                    String::from_utf8(bytes.as_ref().to_vec())
                        .map_err(|_| keyring_core::Error::BadEncoding(bytes.as_ref().to_vec()))
                })
        },
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

/// Linux and the other Unixes: the Secret Service item with the service and account, from `secret-tool`.
#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn read(service: &str, account: &str) -> Option<String> {
    let output = std::process::Command::new("secret-tool")
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

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

        // Ordered search list returns the first keychain's entry, matching `security find-generic-password`.
        let (bytes, _) = security_framework::os::macos::passwords::find_generic_password(
            Some(&[first_kc.clone(), second_kc.clone()]),
            "loam-copilot-test",
            "claude",
        )
        .unwrap();
        assert_eq!(std::str::from_utf8(bytes.as_ref()).unwrap(), first_secret);

        // Reversing the search list order returns the other keychain's entry first.
        let (reversed, _) = security_framework::os::macos::passwords::find_generic_password(
            Some(&[second_kc, first_kc]),
            "loam-copilot-test",
            "claude",
        )
        .unwrap();
        assert_eq!(
            std::str::from_utf8(reversed.as_ref()).unwrap(),
            second_secret
        );
    }
}
