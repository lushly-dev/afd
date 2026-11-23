//! Signed updates in Rust only (phase 6 specification, 10.6 and P6-D5).
//!
//! The updater is **off** unless the build is given both `LOAM_UPDATER_PUBKEY` and
//! `LOAM_UPDATER_ENDPOINT`. When either is absent or empty, no update check runs and no network
//! request is made. When both are provided, both the feed endpoint and the manifest's artifact
//! download URL must use `https://` — in debug and release builds alike — and
//! `dangerousInsecureTransportProtocol`, `dangerousAcceptInvalidCerts` and
//! `dangerousAcceptInvalidHostnames` are never set. No `updater:*` JavaScript permission is
//! granted in `capabilities/main.json`.
use std::fmt;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Runtime, Url};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

/// Build-time environment variable carrying the base64-encoded minisign public key.
pub const PUBKEY_ENV: &str = "LOAM_UPDATER_PUBKEY";
/// Build-time environment variable carrying the HTTPS update feed URL.
pub const ENDPOINT_ENV: &str = "LOAM_UPDATER_ENDPOINT";

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Validated updater configuration. Only constructed when both key and HTTPS endpoint are present.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdaterConfig {
    pub pubkey: String,
    pub endpoint: Url,
}

/// Refusals and runtime errors from the updater wrapper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdaterError {
    /// The configured endpoint is not a valid URL.
    InvalidEndpoint,
    /// The configured endpoint does not use `https://` or embeds credentials.
    InsecureEndpoint,
    /// The configured public key is empty or contains invalid characters.
    InvalidPubkey,
    /// The remote manifest named a non-`https://` download URL.
    InsecureDownload,
    /// A test CA certificate PEM could not be parsed.
    InvalidCertificate(String),
    /// An error reported by `tauri-plugin-updater`.
    Plugin(String),
}

impl fmt::Display for UpdaterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidEndpoint => write!(f, "updater endpoint is not a valid URL"),
            Self::InsecureEndpoint => {
                write!(
                    f,
                    "updater endpoint must use https with a host and no credentials"
                )
            }
            Self::InvalidPubkey => write!(f, "updater public key is invalid"),
            Self::InsecureDownload => write!(f, "updater download URL must use https"),
            Self::InvalidCertificate(reason) => {
                write!(f, "updater root certificate is invalid: {reason}")
            }
            Self::Plugin(reason) => write!(f, "{reason}"),
        }
    }
}

impl std::error::Error for UpdaterError {}

fn is_https_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
}

impl UpdaterConfig {
    /// Reads the updater configuration embedded at build time via `LOAM_UPDATER_PUBKEY` and
    /// `LOAM_UPDATER_ENDPOINT`. Returns `Ok(None)` when either is unset or empty.
    pub fn from_build_env() -> Result<Option<Self>, UpdaterError> {
        Self::parse(
            option_env!("LOAM_UPDATER_PUBKEY"),
            option_env!("LOAM_UPDATER_ENDPOINT"),
        )
    }

    /// Parses a `(pubkey, endpoint)` pair.
    ///
    /// Returns `Ok(None)` whenever either value is missing or empty, so an app built without a
    /// key (even if an endpoint is set) makes no update request. Refuses any non-`https://`
    /// endpoint even in debug builds.
    pub fn parse(
        pubkey: Option<&str>,
        endpoint: Option<&str>,
    ) -> Result<Option<Self>, UpdaterError> {
        let Some(pubkey) = pubkey.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(None);
        };
        let Some(endpoint) = endpoint.map(str::trim).filter(|value| !value.is_empty()) else {
            return Ok(None);
        };
        if pubkey.bytes().any(|byte| !matches!(byte, 0x21..=0x7e)) {
            return Err(UpdaterError::InvalidPubkey);
        }
        let url = Url::parse(endpoint).map_err(|_| UpdaterError::InvalidEndpoint)?;
        if !is_https_url(&url) {
            return Err(UpdaterError::InsecureEndpoint);
        }
        Ok(Some(Self {
            pubkey: pubkey.to_owned(),
            endpoint: url,
        }))
    }
}

/// Explicit options for an update check or install.
#[derive(Debug, Clone)]
pub struct CheckOptions {
    /// Additional root CA certificate in PEM format (used by P6-D5 with a local test CA; never
    /// disables certificate or hostname verification).
    pub ca_pem: Option<Vec<u8>>,
    /// Override the executable path used to locate the install target (used by P6-D5).
    pub executable_path: Option<PathBuf>,
    /// Override the updater target key (default: the running OS and architecture).
    pub target: Option<String>,
    /// Request timeout for feed check and artifact download.
    pub timeout: Option<Duration>,
    /// Whether the Windows installer should relaunch the app after installing.
    pub restart_after_install: bool,
}

impl Default for CheckOptions {
    fn default() -> Self {
        Self {
            ca_pem: None,
            executable_path: None,
            target: None,
            timeout: Some(DEFAULT_TIMEOUT),
            restart_after_install: true,
        }
    }
}

/// Builds a configured `tauri_plugin_updater::Updater` with HTTPS enforced and no ambient proxy.
pub fn build_updater<R: Runtime>(
    app: &AppHandle<R>,
    config: &UpdaterConfig,
    options: &CheckOptions,
) -> Result<Updater, UpdaterError> {
    if !is_https_url(&config.endpoint) {
        return Err(UpdaterError::InsecureEndpoint);
    }
    let mut builder = app
        .updater_builder()
        .pubkey(config.pubkey.clone())
        .endpoints(vec![config.endpoint.clone()])
        .map_err(|error| UpdaterError::Plugin(error.to_string()))?
        .no_proxy()
        .restart_after_install(options.restart_after_install);
    if let Some(timeout) = options.timeout {
        builder = builder.timeout(timeout);
    }
    if let Some(path) = &options.executable_path {
        builder = builder.executable_path(path);
    }
    if let Some(target) = &options.target {
        builder = builder.target(target);
    }
    let ca_cert = match &options.ca_pem {
        Some(pem) => Some(
            reqwest::Certificate::from_pem(pem)
                .map_err(|error| UpdaterError::InvalidCertificate(error.to_string()))?,
        ),
        None => None,
    };
    builder = builder.configure_client(move |mut client| {
        client = client.redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error("too many redirects");
            }
            if !is_https_url(attempt.url()) {
                return attempt.error("updater redirect URL must use https");
            }
            attempt.follow()
        }));
        if let Some(cert) = &ca_cert {
            client = client.add_root_certificate(cert.clone());
        }
        client
    });
    builder
        .build()
        .map_err(|error| UpdaterError::Plugin(error.to_string()))
}

fn format_error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut out = error.to_string();
    let mut current = error.source();
    while let Some(source) = current {
        out.push_str(": ");
        out.push_str(&source.to_string());
        current = source.source();
    }
    out
}

/// Checks the configured HTTPS feed for an update, refusing any manifest whose artifact download
/// URL is not `https://`.
pub async fn check<R: Runtime>(
    app: &AppHandle<R>,
    config: &UpdaterConfig,
    options: &CheckOptions,
) -> Result<Option<Update>, UpdaterError> {
    let updater = build_updater(app, config, options)?;
    let update = updater
        .check()
        .await
        .map_err(|error| UpdaterError::Plugin(format_error_chain(&error)))?;
    if let Some(ref found) = update
        && !is_https_url(&found.download_url)
    {
        return Err(UpdaterError::InsecureDownload);
    }
    Ok(update)
}

/// Checks the feed, downloads and cryptographically verifies the signed artifact, and installs it.
/// Returns `Ok(Some(version))` when an update was installed, or `Ok(None)` when up to date.
///
/// Note: on Windows, `Update::install` launches the signed installer and exits the process with
/// status `0`, so this call does not return on a successful Windows install.
pub async fn download_and_install<R: Runtime>(
    app: &AppHandle<R>,
    config: &UpdaterConfig,
    options: &CheckOptions,
) -> Result<Option<String>, UpdaterError> {
    let Some(update) = check(app, config, options).await? else {
        return Ok(None);
    };
    let version = update.version.clone();
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| UpdaterError::Plugin(format_error_chain(&error)))?;
    update
        .install(&bytes)
        .map_err(|error| UpdaterError::Plugin(format_error_chain(&error)))?;
    Ok(Some(version))
}

/// Outcome of the Rust-only startup updater path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupOutcome {
    /// Disabled because `LOAM_UPDATER_PUBKEY` or `LOAM_UPDATER_ENDPOINT` is absent or empty.
    Disabled,
    /// Configured feed reported no newer version.
    UpToDate,
    /// A signed update over HTTPS was downloaded, verified and installed.
    Installed(String),
}

/// Runs the production startup update flow for the supplied `(pubkey, endpoint)` pair:
/// returns `Ok(StartupOutcome::Disabled)` with zero network requests when either is absent or
/// empty, or downloads, verifies and installs any available signed HTTPS update.
pub async fn run_startup<R: Runtime>(
    app: &AppHandle<R>,
    pubkey: Option<&str>,
    endpoint: Option<&str>,
    options: &CheckOptions,
) -> Result<StartupOutcome, UpdaterError> {
    let Some(config) = UpdaterConfig::parse(pubkey, endpoint)? else {
        return Ok(StartupOutcome::Disabled);
    };
    match download_and_install(app, &config, options).await? {
        Some(version) => Ok(StartupOutcome::Installed(version)),
        None => Ok(StartupOutcome::UpToDate),
    }
}

/// Starts the background Rust-only updater using the build-time `LOAM_UPDATER_PUBKEY` and
/// `LOAM_UPDATER_ENDPOINT` settings. Does nothing — and makes no network request — when either
/// setting is absent or empty.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match run_startup(
            &handle,
            option_env!("LOAM_UPDATER_PUBKEY"),
            option_env!("LOAM_UPDATER_ENDPOINT"),
            &CheckOptions::default(),
        )
        .await
        {
            Ok(StartupOutcome::Disabled | StartupOutcome::UpToDate) => {}
            Ok(StartupOutcome::Installed(version)) => {
                eprintln!("loam-desktop: installed signed update {version}");
            }
            Err(error) => {
                eprintln!("loam-desktop: update failed ({error})");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn off_when_key_or_endpoint_is_absent_or_empty() {
        assert_eq!(UpdaterConfig::parse(None, None), Ok(None));
        assert_eq!(
            UpdaterConfig::parse(None, Some("https://updates.example.com/latest.json")),
            Ok(None)
        );
        assert_eq!(
            UpdaterConfig::parse(Some("   "), Some("https://updates.example.com/latest.json")),
            Ok(None)
        );
        assert_eq!(UpdaterConfig::parse(Some("dW50cnVzdGVk"), None), Ok(None));
        assert_eq!(
            UpdaterConfig::parse(Some("dW50cnVzdGVk"), Some("")),
            Ok(None)
        );
    }

    #[test]
    fn refuses_non_https_or_credentialed_endpoints_even_in_debug() {
        for bad in [
            "http://127.0.0.1:8443/latest.json",
            "http://updates.example.com/latest.json",
            "ftp://updates.example.com/latest.json",
            "file:///tmp/latest.json",
            "https://user:pass@updates.example.com/latest.json",
            "https://user@updates.example.com/latest.json",
        ] {
            assert_eq!(
                UpdaterConfig::parse(Some("dW50cnVzdGVk"), Some(bad)),
                Err(UpdaterError::InsecureEndpoint),
                "{bad}"
            );
        }
        assert_eq!(
            UpdaterConfig::parse(Some("dW50cnVzdGVk"), Some("not a url")),
            Err(UpdaterError::InvalidEndpoint)
        );
        assert_eq!(
            UpdaterConfig::parse(
                Some("bad\nkey"),
                Some("https://updates.example.com/latest.json")
            ),
            Err(UpdaterError::InvalidPubkey)
        );
    }

    #[test]
    fn accepts_https_endpoint_with_key() {
        let parsed = UpdaterConfig::parse(
            Some("  dW50cnVzdGVk  "),
            Some("  https://127.0.0.1:8443/latest.json  "),
        )
        .unwrap()
        .expect("enabled config");
        assert_eq!(parsed.pubkey, "dW50cnVzdGVk");
        assert_eq!(
            parsed.endpoint.as_str(),
            "https://127.0.0.1:8443/latest.json"
        );
    }

    #[test]
    fn tauri_config_never_sets_insecure_updater_flags() {
        let raw = include_str!("../tauri.conf.json");
        for forbidden in [
            "dangerousInsecureTransportProtocol",
            "dangerous-insecure-transport-protocol",
            "dangerousAcceptInvalidCerts",
            "dangerous-accept-invalid-certs",
            "dangerousAcceptInvalidHostnames",
            "dangerous-accept-invalid-hostnames",
        ] {
            assert!(
                !raw.contains(forbidden),
                "tauri.conf.json must never set {forbidden}"
            );
        }
        let parsed: serde_json::Value = serde_json::from_str(raw).expect("valid tauri.conf.json");
        let updater = &parsed["plugins"]["updater"];
        assert_eq!(updater["pubkey"], "");
        assert_eq!(updater["endpoints"], serde_json::json!([]));
        assert_eq!(updater["requireSignedVersion"], true);
    }
}
