//! Structured error contract for `host-setup` IPC commands (phase 5 no-terminal amendment,
//! sections 3.3 & 11).
//!
//! Every `host-setup` error carries a fixed section 11 `code` and a Loam-authored `suggestion`.
//! It NEVER includes a secret, API key, bearer token, `proofKey`, raw engine output, or untrusted
//! plugin text.
use crate::plugins_error::{self, PluginError};
use serde::Serialize;

pub const DESKTOP_HOST_SETUP_REFUSED: &str = "DESKTOP_HOST_SETUP_REFUSED";
pub const COPILOT_KEY_TOO_LONG: &str = crate::keychain::COPILOT_KEY_TOO_LONG;
pub const COPILOT_KEY_REBIND_REQUIRED: &str = "COPILOT_KEY_REBIND_REQUIRED";
pub const COPILOT_KEYCHAIN_UNAVAILABLE: &str = crate::keychain::COPILOT_KEYCHAIN_UNAVAILABLE;
pub const COPILOT_KEY_INVALID: &str = "COPILOT_KEY_INVALID";
pub const COPILOT_PROVIDER_MISSING: &str = "COPILOT_PROVIDER_MISSING";
pub const DEPLOYMENT_COPILOT_INVALID: &str = "DEPLOYMENT_COPILOT_INVALID";
pub const MODEL_REFUSED: &str = crate::models::REFUSED;
pub const MODEL_UNREACHABLE: &str = crate::models::UNREACHABLE;
pub const DESKTOP_MODELS_PERMISSIONS: &str = crate::models::PERMISSIONS;
pub const DESKTOP_MODELS_INVALID: &str = crate::models::MODELS_INVALID;
pub const SETUP_INPUT_INVALID: &str = "DESKTOP_SETUP_INPUT_INVALID";

/// Structured error serialized back to `host-setup` webview on IPC failure (§3.3 & §11).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupError {
    pub code: &'static str,
    pub suggestion: &'static str,
}

impl SetupError {
    pub fn from_code(code: &'static str) -> Self {
        Self {
            code,
            suggestion: suggestion_for(code),
        }
    }
}

impl From<PluginError> for SetupError {
    fn from(err: PluginError) -> Self {
        // Strip `key` and `reason` so untrusted plugin identifiers never leak into `SetupError`.
        Self {
            code: err.code,
            suggestion: suggestion_for(err.code),
        }
    }
}

/// Exact section 11 suggestions in Loam's own fixed words.
pub fn suggestion_for(code: &'static str) -> &'static str {
    match code {
        DESKTOP_HOST_SETUP_REFUSED => {
            "None: only Loam's trusted setup window may call setup commands"
        }
        COPILOT_KEY_TOO_LONG => {
            "Use an API key of at most 1,280 characters on Windows, or store it in an owner-only file"
        }
        COPILOT_KEY_REBIND_REQUIRED => {
            "Enter an API key for the new provider destination or confirm rebinding the stored key"
        }
        COPILOT_KEYCHAIN_UNAVAILABLE => {
            "Unlock or install a Secret Service keyring (`gnome-keyring` / `kwallet` + `secret-tool`), or explicitly choose the owner-only file fallback"
        }
        COPILOT_KEY_INVALID => {
            "Enter an API key of 8 to 4,096 printable ASCII characters with no spaces, quotes, or backslashes"
        }
        COPILOT_PROVIDER_MISSING => {
            "Open Loam → Copilot Models… (or click Configure model…) to add a model provider."
        }
        DEPLOYMENT_COPILOT_INVALID => {
            "Check the provider id, model id, endpoint URL, and 16-provider limit, then retry"
        }
        MODEL_REFUSED => {
            "The provider refused this API key (401/403); check the key in the provider's console and retry"
        }
        MODEL_UNREACHABLE => {
            "Could not reach the provider's /models endpoint; check your network or save offline with skipVerify"
        }
        DESKTOP_MODELS_PERMISSIONS => "Restrict models.json and key files to your user account",
        DESKTOP_MODELS_INVALID => {
            "Check models.json or reconfigure providers from Loam → Copilot Models…"
        }
        SETUP_INPUT_INVALID => "Check the setup form fields and retry",
        other => plugins_error::suggestion_for(other),
    }
}
