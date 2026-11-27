//! Typed errors for plugin bundle inspection, installation, pairing, service registration, and
//! token lifecycle (phase 5 no-terminal amendment, section 11).
//!
//! Every error carries a fixed section 11 `code` and a Loam-authored `suggestion` that NEVER
//! includes a secret, bearer token, `proofKey`, raw engine output, or untrusted plugin string.
use serde::Serialize;
use std::fmt;

pub const DESKTOP_STATE_PERMISSIONS: &str = crate::desktop_state::PERMISSIONS;
pub const DESKTOP_STATE_INVALID: &str = crate::desktop_state::INVALID;
pub const DESKTOP_MATERIALIZE_FAILED: &str = crate::materialize::FAILED;
pub const DESKTOP_CLI_MANAGED: &str = "DESKTOP_CLI_MANAGED";
pub const PLUGIN_MANIFEST_MISSING: &str = "PLUGIN_MANIFEST_MISSING";
pub const PLUGIN_MANIFEST_INVALID: &str = "PLUGIN_MANIFEST_INVALID";
pub const PLUGIN_PATH_ESCAPE: &str = "PLUGIN_PATH_ESCAPE";
pub const PLUGIN_BUNDLE_TOO_LARGE: &str = "PLUGIN_BUNDLE_TOO_LARGE";
pub const PLUGIN_TARGET_UNSUPPORTED: &str = "PLUGIN_TARGET_UNSUPPORTED";
pub const PLUGIN_HASH_MISMATCH: &str = "PLUGIN_HASH_MISMATCH";
pub const PLUGIN_ALREADY_INSTALLED: &str = "PLUGIN_ALREADY_INSTALLED";
pub const PLUGIN_CONFLICT: &str = "PLUGIN_CONFLICT";
pub const PLUGIN_PROPOSAL_EXPIRED: &str = "PLUGIN_PROPOSAL_EXPIRED";
pub const PLUGIN_ENGINE_TEST_BUILD: &str = "PLUGIN_ENGINE_TEST_BUILD";
pub const PLUGIN_PAIR_FAILED: &str = "PLUGIN_PAIR_FAILED";
pub const PLUGIN_KEY_TOO_LONG: &str = "PLUGIN_KEY_TOO_LONG";
pub const PLUGIN_KEYCHAIN_UNAVAILABLE: &str = "PLUGIN_KEYCHAIN_UNAVAILABLE";
pub const PLUGIN_PORT_CONFLICT: &str = "PLUGIN_PORT_CONFLICT";
pub const PLUGIN_SERVICE_FAILED: &str = "PLUGIN_SERVICE_FAILED";
pub const PLUGIN_HEALTH_TIMEOUT: &str = "PLUGIN_HEALTH_TIMEOUT";
pub const PLUGIN_NOT_FOUND: &str = "PLUGIN_NOT_FOUND";
pub const DEPLOYMENT_PREVIEW_REQUIRED: &str = "DEPLOYMENT_PREVIEW_REQUIRED";
pub const DEPLOYMENT_PREVIEW_INVALID: &str = "DEPLOYMENT_PREVIEW_INVALID";

/// Structured error returned by the shared plugin lifecycle core (`host-setup` IPC and
/// `loam-desktop plugin` CLI). `code` and `suggestion` are always fixed Loam strings from
/// amendment section 11.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginError {
    pub code: &'static str,
    pub suggestion: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

impl PluginError {
    pub fn from_code(code: &'static str) -> Self {
        Self {
            code,
            suggestion: suggestion_for(code),
            key: None,
            reason: None,
        }
    }

    pub fn with_key(code: &'static str, key: impl Into<String>) -> Self {
        Self {
            code,
            suggestion: suggestion_for(code),
            key: Some(key.into()),
            reason: None,
        }
    }

    pub fn with_key_reason(
        code: &'static str,
        key: impl Into<String>,
        reason: &'static str,
    ) -> Self {
        Self {
            code,
            suggestion: suggestion_for(code),
            key: Some(key.into()),
            reason: Some(reason),
        }
    }
}

fn sanitize_display_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for ch in key.chars() {
        if ch.is_control() || matches!(ch, '\u{2028}' | '\u{2029}') || ch == '\u{007f}' {
            for esc in ch.escape_default() {
                out.push(esc);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code)?;
        if let Some(key) = &self.key {
            write!(f, " ({})", sanitize_display_key(key))?;
        }
        if let Some(reason) = self.reason {
            write!(f, " [{reason}]")?;
        }
        write!(f, ": {}", self.suggestion)
    }
}

impl std::error::Error for PluginError {}

/// Exact section 11 suggestions in Loam's own fixed words.
pub fn suggestion_for(code: &'static str) -> &'static str {
    match code {
        DESKTOP_STATE_PERMISSIONS => {
            "Restrict desktop-state.json and plugin launch files to your user account"
        }
        DESKTOP_STATE_INVALID => {
            "Reinstall the plugin from Loam → Plugins…; if this persists, Loam's data folder has been changed outside Loam"
        }
        DESKTOP_MATERIALIZE_FAILED => {
            "Check the space and permissions in Loam's data folder, then retry; the change is not committed, and the desktop starts from the last one that was"
        }
        DESKTOP_CLI_MANAGED => {
            "This desktop is managed by `loam deployment write`; update `loam.deployment.toml` or clear `<app data>/site` to use in-app plugin management"
        }
        PLUGIN_MANIFEST_MISSING => {
            "Give the plugin's source, which holds `loam-plugin.toml`, or a bundle `loam plugin pack` wrote, which holds `plugin-manifest.json`"
        }
        PLUGIN_MANIFEST_INVALID => {
            "Fix the listed field in `loam-plugin.toml` and repack with `loam plugin pack`"
        }
        PLUGIN_PATH_ESCAPE => {
            "Remove symbolic links, duplicate or colliding paths, and paths outside the plugin root, then repack"
        }
        PLUGIN_BUNDLE_TOO_LARGE => "Keep the plugin bundle under 256 MiB and 2,000 files",
        PLUGIN_TARGET_UNSUPPORTED => {
            "This plugin does not include an engine binary for your operating system and architecture"
        }
        PLUGIN_HASH_MISMATCH => {
            "The plugin bundle or engine binary does not match its SHA-256 digest; download the bundle again"
        }
        PLUGIN_ALREADY_INSTALLED => "This exact version of the plugin is already installed",
        PLUGIN_CONFLICT => "Uninstall the conflicting plugin before installing this one",
        PLUGIN_PROPOSAL_EXPIRED => "Inspect the plugin bundle again to review and confirm",
        PLUGIN_ENGINE_TEST_BUILD => {
            "This engine was built with `test-doubles`; install a release build instead"
        }
        PLUGIN_PAIR_FAILED => "Check the engine log and retry installation",
        PLUGIN_KEY_TOO_LONG => {
            "Shorten or regenerate the plugin bearer token within Windows Credential Manager's 1,280-character limit"
        }
        PLUGIN_KEYCHAIN_UNAVAILABLE => {
            "Unlock or install a Secret Service keyring (`gnome-keyring` / `kwallet` + `secret-tool`), or explicitly choose the owner-only file fallback"
        }
        PLUGIN_PORT_CONFLICT => {
            "Another program is using the plugin's loopback port; retry to allocate a free port or restart the plugin service"
        }
        PLUGIN_SERVICE_FAILED => {
            "Check the plugin log, OS startup permissions, and install path length, then retry"
        }
        PLUGIN_HEALTH_TIMEOUT => {
            "The engine did not answer with a valid MCP result on its loopback port within 10 s; check its log and retry"
        }
        PLUGIN_NOT_FOUND => "Check the list of installed plugins",
        DEPLOYMENT_PREVIEW_REQUIRED => {
            "Give each command the engine holds for shell approval a preview, or set `approvals = \"none\"`"
        }
        DEPLOYMENT_PREVIEW_INVALID => {
            "Fix `engine.mount.commands` previews so each previews another command of the same mount when `approvals = \"shell\"`"
        }
        _ => "Check Loam's configuration and retry",
    }
}
