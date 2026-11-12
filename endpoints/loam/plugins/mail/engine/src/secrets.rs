//! Where an account's sign-in is kept: the operating system's keychain, never
//! the data directory (the specification's sections 3.1 and 13, M21).
//!
//! A credential never passes through a command. The command line reads it
//! from the terminal and writes it here itself; `mail-account-add` and sync
//! read it from here. This build keeps sign-ins in the macOS keychain, in the
//! user's login keychain under the service `loam-mail`. On other platforms
//! there is no keychain yet, and adding an account says so.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, PoisonError};

/// The keychain's service name for the engine's items.
pub const SERVICE: &str = "loam-mail";

/// Why the keychain refused. The words are the engine's own: never the
/// secret, and never the platform's text, which can quote an item's name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretsError {
    /// This platform has no keychain the engine can use yet.
    Unsupported,
    /// The keychain refused: locked, or access denied.
    Refused,
}

impl fmt::Display for SecretsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(f, "this platform has no keychain the engine can use yet"),
            Self::Refused => write!(f, "the keychain refused"),
        }
    }
}

impl std::error::Error for SecretsError {}

/// The name an account's sign-in is kept under.
#[must_use]
pub fn account_key(provider: &str, address: &str) -> String {
    format!("{provider}:{address}")
}

/// A place to keep secrets by name.
pub trait Secrets: Send + Sync {
    /// The secret kept under `key`, if there is one.
    ///
    /// # Errors
    /// When the keychain cannot be used or refuses.
    fn get(&self, key: &str) -> Result<Option<String>, SecretsError>;

    /// Keeps `secret` under `key`, in place of any there.
    ///
    /// # Errors
    /// When the keychain cannot be used or refuses.
    fn set(&self, key: &str, secret: &str) -> Result<(), SecretsError>;

    /// Removes what is kept under `key`; nothing kept there is not an error.
    ///
    /// # Errors
    /// When the keychain cannot be used or refuses.
    fn delete(&self, key: &str) -> Result<(), SecretsError>;
}

/// The operating system's keychain.
#[derive(Debug, Default, Clone, Copy)]
pub struct Keychain;

#[cfg(target_os = "macos")]
impl Keychain {
    fn entry(key: &str) -> Result<keyring_core::Entry, SecretsError> {
        apple_native_keyring_store::keychain::Cred::build(
            apple_native_keyring_store::keychain::MacKeychainDomain::User,
            SERVICE,
            key,
        )
        .map_err(|_| SecretsError::Refused)
    }
}

#[cfg(target_os = "macos")]
impl Secrets for Keychain {
    fn get(&self, key: &str) -> Result<Option<String>, SecretsError> {
        match Self::entry(key)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => Err(SecretsError::Refused),
        }
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), SecretsError> {
        Self::entry(key)?
            .set_password(secret)
            .map_err(|_| SecretsError::Refused)
    }

    fn delete(&self, key: &str) -> Result<(), SecretsError> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretsError::Refused),
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl Secrets for Keychain {
    fn get(&self, _key: &str) -> Result<Option<String>, SecretsError> {
        Err(SecretsError::Unsupported)
    }

    fn set(&self, _key: &str, _secret: &str) -> Result<(), SecretsError> {
        Err(SecretsError::Unsupported)
    }

    fn delete(&self, _key: &str) -> Result<(), SecretsError> {
        Err(SecretsError::Unsupported)
    }
}

/// Secrets kept in memory, for the tests.
#[derive(Default)]
pub struct InMemory {
    secrets: Mutex<HashMap<String, String>>,
}

impl fmt::Debug for InMemory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Never the secrets.
        f.debug_struct("InMemory").finish_non_exhaustive()
    }
}

impl Secrets for InMemory {
    fn get(&self, key: &str) -> Result<Option<String>, SecretsError> {
        Ok(self
            .secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(key)
            .cloned())
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), SecretsError> {
        self.secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), SecretsError> {
        self.secrets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(key);
        Ok(())
    }
}
