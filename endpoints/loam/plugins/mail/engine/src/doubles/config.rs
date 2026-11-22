//! File-backed sign-ins (`LOAM_MAIL_TEST_SECRETS`) and loopback endpoint
//! overrides (`LOAM_MAIL_TEST_ENDPOINTS`) for `test-doubles` builds
//! (plugin.spec.md, section 12.4).
//!
//! Security boundary:
//! - Both environment variables must be set together, or neither. Setting only
//!   one refuses to start, so a real keychain password is never sent in clear
//!   to a loopback port, and a test password is never sent to a real provider.
//! - Every host in the endpoints file must be an IP literal in `127.0.0.0/8` or
//!   `::1`. Hostnames (including `localhost`) and any non-loopback IP address
//!   are refused at start.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fmt;
use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::home::{create_private_dir, private_file};
use crate::provider::http::{UnsubscribeOutcome, UnsubscribePoster};
use crate::secrets::{Secrets, SecretsError};
use crate::tokens::random_hex;

/// Environment variable naming the file-backed test secrets store.
pub const TEST_SECRETS_VAR: &str = "LOAM_MAIL_TEST_SECRETS";

/// Environment variable naming the loopback test endpoints JSON file.
pub const TEST_ENDPOINTS_VAR: &str = "LOAM_MAIL_TEST_ENDPOINTS";

/// One loopback TCP endpoint (`host` IP literal + non-zero `port`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointAddr {
    /// Loopback IP literal (`127.0.0.0/8` or `::1`).
    pub host: String,
    /// Non-zero TCP port.
    pub port: u16,
}

impl EndpointAddr {
    /// Builds a validated loopback address.
    ///
    /// # Errors
    /// When `host` is not a loopback IP literal (`127.0.0.0/8` or `::1`) or
    /// `port` is 0.
    pub fn validated(&self, label: &str) -> Result<SocketAddr, String> {
        let ip = parse_loopback_ip(&self.host)
            .map_err(|reason| format!("{label} endpoint host `{}` refused: {reason}", self.host))?;
        if self.port == 0 {
            return Err(format!("{label} endpoint port must be non-zero"));
        }
        Ok(SocketAddr::new(ip, self.port))
    }
}

/// Parses `host` strictly as a loopback IP literal (`127.0.0.0/8` or `::1`).
/// Refuses hostnames (including `localhost`), brackets, ports, IPv4-mapped
/// IPv6, and any non-loopback address.
///
/// # Errors
/// Returns a human-readable explanation of why `host` was refused.
pub fn parse_loopback_ip(host: &str) -> Result<IpAddr, String> {
    let ip: IpAddr = host.parse().map_err(|_| {
        "must be an IP literal in 127.0.0.0/8 or ::1 (hostnames such as localhost are refused)"
            .to_string()
    })?;
    let is_loopback = match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback(),
    };
    if !is_loopback {
        return Err("must be in 127.0.0.0/8 or ::1".to_string());
    }
    Ok(ip)
}

/// Endpoints read from `LOAM_MAIL_TEST_ENDPOINTS`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestEndpoints {
    /// Scripted IMAP server on loopback (plain TCP).
    pub imap: EndpointAddr,
    /// Optional scripted SMTP server on loopback (plain TCP).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smtp: Option<EndpointAddr>,
    /// Optional scripted HTTP one-click unsubscribe target on loopback (plain TCP).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http: Option<EndpointAddr>,
}

/// Validated socket addresses from [`TestEndpoints`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedEndpoints {
    /// Loopback socket address for IMAP.
    pub imap: SocketAddr,
    /// Optional loopback socket address for SMTP.
    pub smtp: Option<SocketAddr>,
    /// Optional loopback socket address for one-click HTTP unsubscribe.
    pub http: Option<SocketAddr>,
}

impl TestEndpoints {
    /// Reads and validates a `LOAM_MAIL_TEST_ENDPOINTS` JSON file.
    ///
    /// # Errors
    /// When the file cannot be read, is not valid JSON, or any endpoint host
    /// is not a loopback IP literal (`127.0.0.0/8` or `::1`) or has port 0.
    pub fn load(path: &Path) -> Result<ValidatedEndpoints, String> {
        let text = std::fs::read_to_string(path).map_err(|error| {
            format!(
                "could not read {TEST_ENDPOINTS_VAR} at `{}`: {error}",
                path.display()
            )
        })?;
        let parsed: Self = serde_json::from_str(&text).map_err(|error| {
            format!(
                "{TEST_ENDPOINTS_VAR} at `{}` is not valid JSON: {error}",
                path.display()
            )
        })?;
        parsed.validate()
    }

    /// Validates every endpoint in this structure.
    ///
    /// # Errors
    /// When any endpoint is not a loopback IP literal with a non-zero port.
    pub fn validate(&self) -> Result<ValidatedEndpoints, String> {
        let imap = self.imap.validated("imap")?;
        let smtp = match &self.smtp {
            Some(addr) => Some(addr.validated("smtp")?),
            None => None,
        };
        let http = match &self.http {
            Some(addr) => Some(addr.validated("http")?),
            None => None,
        };
        Ok(ValidatedEndpoints { imap, smtp, http })
    }
}

/// File-backed [`Secrets`] store for `LOAM_MAIL_TEST_SECRETS`.
///
/// Stores a JSON object mapping `<provider>:<address>` to secret strings.
/// Created with owner-only permissions on Unix (`0600`).
pub struct FileSecrets {
    path: PathBuf,
    guard: Mutex<()>,
}

impl fmt::Debug for FileSecrets {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FileSecrets")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl FileSecrets {
    /// Creates a file-backed secrets store at `path`. The file need not exist
    /// until the first [`Secrets::set`].
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            guard: Mutex::new(()),
        }
    }

    /// The path to the backing file.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn read_map(&self) -> Result<BTreeMap<String, String>, SecretsError> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => {
                if text.trim().is_empty() {
                    return Ok(BTreeMap::new());
                }
                serde_json::from_str(&text).map_err(|_| SecretsError::Refused)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(_) => Err(SecretsError::Refused),
        }
    }

    fn lock_store(&self) -> Result<std::fs::File, SecretsError> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            create_private_dir(parent).map_err(|_| SecretsError::Refused)?;
        }
        let mut lock_os = self.path.as_os_str().to_os_string();
        lock_os.push(".lock");
        let lock_path = PathBuf::from(lock_os);
        let lock = private_file()
            .create(true)
            .open(&lock_path)
            .map_err(|_| SecretsError::Refused)?;
        lock.lock().map_err(|_| SecretsError::Refused)?;
        Ok(lock)
    }

    fn unique_temp_path(&self) -> Result<PathBuf, SecretsError> {
        let nonce = random_hex(8).map_err(|_| SecretsError::Refused)?;
        let base = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("secrets");
        let name = format!(".{base}.{}.{nonce}.tmp", std::process::id());
        Ok(match self.path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.join(name),
            _ => PathBuf::from(name),
        })
    }

    fn write_map(&self, map: &BTreeMap<String, String>) -> Result<(), SecretsError> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            create_private_dir(parent).map_err(|_| SecretsError::Refused)?;
        }
        let body = serde_json::to_string_pretty(map).map_err(|_| SecretsError::Refused)?;
        let temp = self.unique_temp_path()?;
        let write_result = (|| -> std::io::Result<()> {
            let mut file = private_file().create_new(true).open(&temp)?;
            file.write_all(body.as_bytes())?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temp, &self.path)?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = std::fs::remove_file(&temp);
            return Err(SecretsError::Refused);
        }
        Ok(())
    }
}

impl Secrets for FileSecrets {
    fn get(&self, key: &str) -> Result<Option<String>, SecretsError> {
        let _guard = self.guard.lock().unwrap_or_else(PoisonError::into_inner);
        let _file_lock = match std::fs::metadata(&self.path) {
            Ok(_) => Some(self.lock_store()?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(SecretsError::Refused),
        };
        Ok(self.read_map()?.get(key).cloned())
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), SecretsError> {
        let _guard = self.guard.lock().unwrap_or_else(PoisonError::into_inner);
        let _file_lock = self.lock_store()?;
        let mut map = self.read_map()?;
        map.insert(key.to_string(), secret.to_string());
        self.write_map(&map)
    }

    fn delete(&self, key: &str) -> Result<(), SecretsError> {
        let _guard = self.guard.lock().unwrap_or_else(PoisonError::into_inner);
        let _file_lock = self.lock_store()?;
        let mut map = self.read_map()?;
        if map.remove(key).is_some() {
            self.write_map(&map)?;
        }
        Ok(())
    }
}

/// An [`UnsubscribePoster`] used when `LOAM_MAIL_TEST_ENDPOINTS` omits `http`:
/// refuses to post rather than falling back to a real internet HTTPS request.
#[derive(Debug, Default)]
pub struct RefusingPoster;

#[async_trait]
impl UnsubscribePoster for RefusingPoster {
    async fn post_one_click(&self, _url: &str) -> UnsubscribeOutcome {
        UnsubscribeOutcome::Failed(
            "no `http` test endpoint is configured in LOAM_MAIL_TEST_ENDPOINTS",
        )
    }
}

/// Active test-double wiring loaded from `LOAM_MAIL_TEST_SECRETS` and
/// `LOAM_MAIL_TEST_ENDPOINTS`.
#[derive(Debug)]
pub struct TestDoubleConfig {
    /// File-backed sign-in store.
    pub secrets: FileSecrets,
    /// Validated loopback endpoints.
    pub endpoints: ValidatedEndpoints,
}

impl TestDoubleConfig {
    /// Reads `LOAM_MAIL_TEST_SECRETS` and `LOAM_MAIL_TEST_ENDPOINTS` via
    /// `variable` (`std::env::var_os` in production):
    /// - Neither set -> `Ok(None)` (use real keychain and providers).
    /// - Exactly one set (even if empty or non-Unicode) -> `Err(...)` (refuse to start).
    /// - Either set to an empty value -> `Err(...)` (never fall back to real providers).
    /// - Both set to non-empty paths -> validates endpoints and returns `Ok(Some(config))`.
    ///
    /// # Errors
    /// When only one variable is set, either value is empty, or the endpoints
    /// file is invalid or names anything other than a loopback IP literal.
    pub fn from_env(variable: impl Fn(&str) -> Option<OsString>) -> Result<Option<Self>, String> {
        let secrets = variable(TEST_SECRETS_VAR);
        let endpoints = variable(TEST_ENDPOINTS_VAR);
        match (secrets, endpoints) {
            (None, None) => Ok(None),
            (Some(_), None) => Err(format!(
                "{TEST_SECRETS_VAR} is set without {TEST_ENDPOINTS_VAR}: set both or neither so test credentials are never sent to a real provider"
            )),
            (None, Some(_)) => Err(format!(
                "{TEST_ENDPOINTS_VAR} is set without {TEST_SECRETS_VAR}: set both or neither so keychain credentials are never sent in clear to a loopback port"
            )),
            (Some(secrets_path), Some(endpoints_path)) => {
                if secrets_path.is_empty() {
                    return Err(format!("{TEST_SECRETS_VAR} must not be empty"));
                }
                if endpoints_path.is_empty() {
                    return Err(format!("{TEST_ENDPOINTS_VAR} must not be empty"));
                }
                let endpoints_buf = PathBuf::from(endpoints_path);
                let endpoints = TestEndpoints::load(&endpoints_buf)?;
                Ok(Some(Self {
                    secrets: FileSecrets::new(PathBuf::from(secrets_path)),
                    endpoints,
                }))
            }
        }
    }

    /// Canonical transport tag written to `server.json` and compared before
    /// CLI forwarding so calls never cross real and test-double transports or
    /// mismatched test endpoints.
    #[must_use]
    pub fn transport_tag(&self) -> String {
        let smtp = self
            .endpoints
            .smtp
            .map_or_else(|| "none".to_string(), |a| a.to_string());
        let http = self
            .endpoints
            .http
            .map_or_else(|| "none".to_string(), |a| a.to_string());
        let secrets_path = self.secrets.path();
        let secrets = std::fs::canonicalize(secrets_path).unwrap_or_else(|_| {
            match (secrets_path.parent(), secrets_path.file_name()) {
                (Some(parent), Some(name)) if !parent.as_os_str().is_empty() => {
                    std::fs::canonicalize(parent)
                        .map_or_else(|_| secrets_path.to_path_buf(), |canon| canon.join(name))
                }
                _ => secrets_path.to_path_buf(),
            }
        });
        format!(
            "test-doubles:imap={};smtp={smtp};http={http};secrets={}",
            self.endpoints.imap,
            secrets.display()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_ip_literal_validation_is_strict() {
        for ok in ["127.0.0.1", "127.0.0.2", "127.255.255.254", "::1"] {
            assert!(parse_loopback_ip(ok).is_ok(), "{ok} should be accepted");
        }
        for bad in [
            "",
            "localhost",
            "imap.mail.me.com",
            "127.0.0.1:993",
            "[::1]",
            "0.0.0.0",
            "10.0.0.1",
            "192.168.1.1",
            "8.8.8.8",
            "::",
            "::ffff:127.0.0.1",
            "fe80::1",
        ] {
            assert!(parse_loopback_ip(bad).is_err(), "{bad} must be refused");
        }
    }

    #[test]
    fn port_zero_is_refused() {
        let addr = EndpointAddr {
            host: "127.0.0.1".to_string(),
            port: 0,
        };
        assert!(addr.validated("imap").is_err());
    }

    #[test]
    fn both_or_neither_and_empty_env_vars_enforced() {
        assert!(TestDoubleConfig::from_env(|_| None).unwrap().is_none());
        // Single variable (even empty) must be refused, never silently fall back to real providers.
        for empty_or_set in ["", "/tmp/s.json"] {
            assert!(
                TestDoubleConfig::from_env(|name| {
                    (name == TEST_SECRETS_VAR).then(|| OsString::from(empty_or_set))
                })
                .is_err(),
                "secrets={empty_or_set:?} alone must fail"
            );
            assert!(
                TestDoubleConfig::from_env(|name| {
                    (name == TEST_ENDPOINTS_VAR).then(|| OsString::from(empty_or_set))
                })
                .is_err(),
                "endpoints={empty_or_set:?} alone must fail"
            );
        }
        // Both present but one empty must also fail.
        assert!(
            TestDoubleConfig::from_env(|name| match name {
                TEST_SECRETS_VAR => Some(OsString::from("")),
                TEST_ENDPOINTS_VAR => Some(OsString::from("/tmp/e.json")),
                _ => None,
            })
            .is_err()
        );
        assert!(
            TestDoubleConfig::from_env(|name| match name {
                TEST_SECRETS_VAR => Some(OsString::from("/tmp/s.json")),
                TEST_ENDPOINTS_VAR => Some(OsString::from("")),
                _ => None,
            })
            .is_err()
        );
    }

    #[test]
    fn file_secrets_does_not_clobber_partial_named_store_or_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let store_path = dir.path().join("creds.partial");
        let sibling = dir.path().join("other.partial");
        std::fs::write(&sibling, "keep-me").unwrap();
        let secrets = FileSecrets::new(&store_path);
        secrets.set("icloud:a@example.com", "pw1").unwrap();
        secrets.set("icloud:b@example.com", "pw2").unwrap();
        assert_eq!(
            secrets.get("icloud:a@example.com").unwrap(),
            Some("pw1".to_string())
        );
        assert_eq!(
            secrets.get("icloud:b@example.com").unwrap(),
            Some("pw2".to_string())
        );
        assert_eq!(std::fs::read_to_string(&sibling).unwrap(), "keep-me");
    }

    #[tokio::test]
    async fn refusing_poster_always_fails_without_network() {
        let outcome = RefusingPoster
            .post_one_click("https://lists.example.com/u/1")
            .await;
        assert!(matches!(outcome, UnsubscribeOutcome::Failed(_)));
    }
}
