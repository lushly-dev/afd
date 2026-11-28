//! No-terminal copilot model & API key setup core (phase 5 no-terminal amendment, sections 8.1,
//! 8.2 & 3.3; P5-S9-5).
//!
//! Shared between `host-setup` IPC commands (`setup_ipc.rs`) and Rust unit tests. Never logs or
//! returns any API key; zeroes key buffers immediately after writing to the OS keychain (or
//! opt-in Linux mode `0600` key file per D166); discards ALL `/models` verification response
//! bodies unread (`2xx`, `4xx`, and `5xx`).
use crate::SiteState;
use crate::connection::{ensure_dir_owner_only, write_owner_only};
use crate::desktop_state::{self, Copilot, DesktopState, Mode, PROVIDERS_MAX, StateLock};
use crate::keychain::{self, KeychainError};
use crate::materialize::{self, Profile};
use crate::models::{
    self, FileRef, KeyRef, KeychainRef, Kind, Models, Provider, endpoint_allowed, identifier,
    key_shaped, model_id,
};
use crate::plugins::KeychainOps;
use crate::plugins_error::{DESKTOP_CLI_MANAGED, DESKTOP_MATERIALIZE_FAILED};
use crate::setup_error::{
    COPILOT_KEY_INVALID, COPILOT_KEY_REBIND_REQUIRED, COPILOT_KEY_TOO_LONG,
    COPILOT_KEYCHAIN_UNAVAILABLE, COPILOT_PROVIDER_MISSING, DEPLOYMENT_COPILOT_INVALID,
    MODEL_REFUSED, MODEL_UNREACHABLE, SetupError,
};
use crate::site;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const VERIFY_TIMEOUT: Duration = Duration::from_secs(15);
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models?limit=1";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const OPENAI_MODELS_URL: &str = "https://api.openai.com/v1/models";

/// Live host handles updated in place after model setup mutations (amendment 8.1 & 9.2).
pub struct ModelLiveHost<'a> {
    pub site: &'a SiteState,
    pub models: &'a Arc<Models>,
    pub bundled_factory: Arc<dyn Fn() -> site::Lookup + Send + Sync>,
    pub on_inbound_enabled: Option<Arc<dyn Fn() + Send + Sync>>,
}

/// Optional URL overrides for Anthropic / OpenAI `/models` checks so unit tests can exercise all
/// verification paths against local mock servers without real network access.
#[derive(Clone, Default)]
pub struct VerifyUrls {
    pub anthropic: Option<String>,
    pub openai: Option<String>,
}

/// Execution context for model setup operations.
pub struct ModelHost<'a> {
    pub data: &'a Path,
    pub custom_data_dir: Option<&'a Path>,
    pub shell_build: &'a str,
    pub keychain: KeychainOps,
    pub verify_urls: VerifyUrls,
    pub live: Option<ModelLiveHost<'a>>,
}

impl<'a> ModelHost<'a> {
    pub fn new(data: &'a Path, custom_data_dir: Option<&'a Path>, shell_build: &'a str) -> Self {
        Self {
            data,
            custom_data_dir,
            shell_build,
            keychain: KeychainOps::default(),
            verify_urls: VerifyUrls::default(),
            live: None,
        }
    }

    pub fn copilot_keychain_service(&self) -> String {
        keychain::copilot_service(self.custom_data_dir)
    }

    pub fn mount_keychain_service(&self) -> String {
        keychain::mount_service(self.custom_data_dir)
    }

    fn refresh_live(&self, frame_src: &str, inbound_now: bool) {
        let Some(live) = &self.live else {
            return;
        };
        let providers = models::read(&self.data.join("models.json"));
        live.models.update_providers(providers);
        let bundled = (live.bundled_factory)();
        if let Ok(site) = site::Site::try_managed(&self.data.join("site"), bundled, frame_src) {
            live.site.swap(site);
        }
        if inbound_now && let Some(hook) = &live.on_inbound_enabled {
            hook();
        }
    }
}

/// Sanitized provider summary returned by `setup_state_get` (never holds any secret value; §8.1).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProviderSummaryV1 {
    pub id: String,
    pub kind: Kind,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    pub default: bool,
    /// `"configured" | "missing" | "file" | "not-required"`
    pub key_status: &'static str,
    /// `"keychain" | "file" | "none"`
    pub key_storage: &'static str,
}

/// Input for `setup_model_save` (§3.3 & §8.1–8.2).
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModelSaveInput {
    pub id: String,
    pub kind: Option<Kind>,
    pub model: Option<String>,
    pub endpoint: Option<String>,
    pub set_default: Option<bool>,
    pub api_key: Option<String>,
    pub skip_verify: Option<bool>,
    pub confirm_rebind_key: Option<bool>,
    pub allow_file_fallback: Option<bool>,
}

impl std::fmt::Debug for ModelSaveInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModelSaveInput")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("model", &self.model)
            .field("endpoint", &self.endpoint)
            .field("set_default", &self.set_default)
            .field("api_key", &self.api_key.as_ref().map(|_| "[REDACTED]"))
            .field("skip_verify", &self.skip_verify)
            .field("confirm_rebind_key", &self.confirm_rebind_key)
            .field("allow_file_fallback", &self.allow_file_fallback)
            .finish()
    }
}

/// Result of `setup_model_save` (§3.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSaveResult {
    pub saved: bool,
    pub checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answered: Option<u16>,
    pub reload_required: bool,
}

/// Input for `setup_model_remove` (§3.3).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModelRemoveInput {
    pub id: String,
    pub delete_key: bool,
}

/// Result of `setup_model_remove` (§3.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRemoveResult {
    pub removed: bool,
    pub reload_required: bool,
}

/// Input for `setup_model_set_default` (§3.3).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ModelSetDefaultInput {
    pub id: String,
}

/// Result of `setup_model_set_default` (§3.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSetDefaultResult {
    pub default: String,
    pub reload_required: bool,
}

/// Overwrites a secret string's backing bytes with zeroes before dropping it.
pub(crate) fn zeroize_string(secret: &mut String) {
    // SAFETY: writing ASCII zeroes preserves UTF-8 validity and only touches `secret`'s buffer.
    let bytes = unsafe { secret.as_bytes_mut() };
    for byte in bytes {
        // SAFETY: `byte` is a valid mutable reference inside `secret`.
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    secret.clear();
}

/// Path for a D166 opt-in Linux keyring-less model key file: `<app data>/keys/<id>.key`.
pub fn model_key_file_path(data: &Path, id: &str) -> PathBuf {
    data.join("keys").join(format!("{id}.key"))
}

fn normalize_endpoint(endpoint: Option<&str>) -> Option<String> {
    endpoint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_end_matches('/').to_owned())
}

fn key_status_for(provider: &Provider, keychain: &KeychainOps) -> (&'static str, &'static str) {
    match &provider.key {
        None => ("not-required", "none"),
        Some(KeyRef::Keychain(entry)) => {
            let status = match (keychain.read)(&entry.keychain, &entry.account) {
                Some(mut found) => {
                    let ok = key_shaped(found.trim_end_matches(['\r', '\n']));
                    zeroize_string(&mut found);
                    if ok { "configured" } else { "missing" }
                }
                None => "missing",
            };
            (status, "keychain")
        }
        Some(KeyRef::File(file)) => {
            let status = match models::resolve_key(&KeyRef::File(file.clone())) {
                Ok(mut found) => {
                    zeroize_string(&mut found);
                    "file"
                }
                Err(_) => "missing",
            };
            (status, "file")
        }
    }
}

/// Lists all configured model providers (sanitized — never returns any API key) in both `managed`
/// and `cli` modes.
pub fn list_models(host: &ModelHost<'_>) -> Result<Vec<ModelProviderSummaryV1>, SetupError> {
    let mode = desktop_state::mode(host.data).map_err(SetupError::from_code)?;
    let (providers, default_id) = match mode {
        Mode::Managed(Some(state)) => match state.copilot {
            Some(copilot) => {
                let def = copilot
                    .default
                    .clone()
                    .or_else(|| copilot.providers.first().map(|p| p.id.clone()));
                (copilot.providers, def)
            }
            None => (Vec::new(), None),
        },
        Mode::Managed(None) => (Vec::new(), None),
        Mode::Cli => {
            let providers =
                models::read(&host.data.join("models.json")).map_err(SetupError::from_code)?;
            let def = providers.first().map(|p| p.id.clone());
            (providers, def)
        }
    };
    Ok(providers
        .into_iter()
        .map(|p| {
            let (key_status, key_storage) = key_status_for(&p, &host.keychain);
            let is_default = default_id.as_deref() == Some(p.id.as_str());
            ModelProviderSummaryV1 {
                id: p.id,
                kind: p.kind,
                model: p.model,
                endpoint: p.endpoint,
                default: is_default,
                key_status,
                key_storage,
            }
        })
        .collect())
}

/// Outcome of the zero-token `/models` verification request (§8.1).
pub struct VerifyOutcome {
    pub checked: bool,
    pub answered: u16,
}

/// Runs the zero-token `GET .../models` verification request with `reqwest` (no redirect, no
/// proxy, 15 s timeout), **discarding ALL response bodies unread** (`2xx`, `4xx`, and `5xx`).
pub async fn verify_models_endpoint(
    kind: Kind,
    endpoint: Option<&str>,
    api_key: Option<&str>,
    verify_urls: &VerifyUrls,
) -> Result<u16, SetupError> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(VERIFY_TIMEOUT)
        .build()
        .map_err(|_| SetupError::from_code(MODEL_UNREACHABLE))?;

    let mut req = match kind {
        Kind::Anthropic => {
            let url = verify_urls
                .anthropic
                .as_deref()
                .unwrap_or(ANTHROPIC_MODELS_URL);
            let key = api_key.ok_or_else(|| SetupError::from_code(COPILOT_KEY_INVALID))?;
            client
                .get(url)
                .header("x-api-key", key)
                .header("anthropic-version", ANTHROPIC_VERSION)
        }
        Kind::Openai => {
            let url = verify_urls.openai.as_deref().unwrap_or(OPENAI_MODELS_URL);
            let key = api_key.ok_or_else(|| SetupError::from_code(COPILOT_KEY_INVALID))?;
            client
                .get(url)
                .header("authorization", format!("Bearer {key}"))
        }
        Kind::OpenaiCompatible => {
            let base = endpoint
                .map(|e| e.trim_end_matches('/'))
                .filter(|e| !e.is_empty())
                .ok_or_else(|| SetupError::from_code(DEPLOYMENT_COPILOT_INVALID))?;
            let url = format!("{base}/models");
            let builder = client.get(url);
            match api_key {
                Some(key) => builder.header("authorization", format!("Bearer {key}")),
                None => builder,
            }
        }
    };
    req = req.header("accept", "application/json");
    let response = req
        .send()
        .await
        .map_err(|_| SetupError::from_code(MODEL_UNREACHABLE))?;
    let status = response.status().as_u16();
    // Explicitly drop `response` WITHOUT reading a single byte of its body (`2xx`, `4xx`, `5xx`).
    drop(response);
    if status == 401 || status == 403 {
        return Err(SetupError::from_code(MODEL_REFUSED));
    }
    Ok(status)
}

async fn run_verify(
    kind: Kind,
    endpoint: Option<&str>,
    api_key: Option<&str>,
    skip_verify: bool,
    verify_urls: &VerifyUrls,
) -> Result<Option<VerifyOutcome>, SetupError> {
    if skip_verify {
        return Ok(None);
    }
    let status = verify_models_endpoint(kind, endpoint, api_key, verify_urls).await?;
    Ok(Some(VerifyOutcome {
        checked: (200..300).contains(&status),
        answered: status,
    }))
}

fn read_existing_key(provider: &Provider, keychain: &KeychainOps) -> Option<String> {
    match provider.key.as_ref()? {
        KeyRef::Keychain(entry) => {
            let mut raw = (keychain.read)(&entry.keychain, &entry.account)?;
            let trimmed = raw.trim_end_matches(['\r', '\n']).to_owned();
            zeroize_string(&mut raw);
            key_shaped(&trimmed).then_some(trimmed)
        }
        KeyRef::File(file) => models::resolve_key(&KeyRef::File(file.clone())).ok(),
    }
}

fn random_hex8() -> Result<String, SetupError> {
    let mut bytes = [0u8; 4];
    getrandom::fill(&mut bytes).map_err(|_| SetupError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
    let mut out = String::with_capacity(8);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    Ok(out)
}

fn versioned_keychain_account(id: &str) -> Result<String, SetupError> {
    let suffix = random_hex8()?;
    let max_prefix = 64 - 1 - suffix.len();
    let prefix = if id.len() > max_prefix {
        &id[..max_prefix]
    } else {
        id
    };
    Ok(format!("{prefix}.{suffix}"))
}

fn versioned_model_key_file_path(data: &Path, id: &str) -> Result<PathBuf, SetupError> {
    let suffix = random_hex8()?;
    Ok(data.join("keys").join(format!("{id}.{suffix}.key")))
}

fn write_model_key_slot(
    host: &ModelHost<'_>,
    account: &str,
    file_path: PathBuf,
    secret: &str,
    allow_file_fallback: bool,
) -> Result<KeyRef, SetupError> {
    if cfg!(windows) && keychain::exceeds_windows_blob_limit(secret) {
        return Err(SetupError::from_code(COPILOT_KEY_TOO_LONG));
    }
    let service = host.copilot_keychain_service();
    match (host.keychain.write)(&service, account, secret) {
        Ok(()) => Ok(KeyRef::Keychain(KeychainRef {
            keychain: service,
            account: account.to_owned(),
        })),
        Err(KeychainError::TooLong) => Err(SetupError::from_code(COPILOT_KEY_TOO_LONG)),
        Err(KeychainError::InvalidName) => Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID)),
        Err(KeychainError::Unavailable) => {
            if allow_file_fallback && host.keychain.allows_file_fallback {
                let keys_dir = host.data.join("keys");
                ensure_dir_owner_only(&keys_dir)
                    .map_err(|_| SetupError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
                let mut payload = format!("{secret}\n");
                let written = write_owner_only(&file_path, payload.as_bytes());
                zeroize_string(&mut payload);
                written.map_err(|_| SetupError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
                Ok(KeyRef::File(FileRef { file: file_path }))
            } else {
                Err(SetupError::from_code(COPILOT_KEYCHAIN_UNAVAILABLE))
            }
        }
    }
}

fn delete_model_key_ref(
    host: &ModelHost<'_>,
    id: &str,
    key_ref: &KeyRef,
) -> Result<(), SetupError> {
    match key_ref {
        KeyRef::Keychain(kc) => (host.keychain.delete)(&kc.keychain, &kc.account)
            .map_err(|_| SetupError::from_code(COPILOT_KEYCHAIN_UNAVAILABLE)),
        KeyRef::File(file) => {
            if !materialize::is_valid_model_key_file(host.data, id, &file.file) {
                return Ok(());
            }
            match std::fs::remove_file(&file.file) {
                Ok(()) => Ok(()),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err(SetupError::from_code(DESKTOP_MATERIALIZE_FAILED)),
            }
        }
    }
}

/// Owned, lock-free plan produced by Phase 1 (`prepare_model_save`) and consumed by Phase 2
/// (`verify_prepared_model`) and Phase 3 (`commit_model_save`). Drops any secret bytes via
/// [`zeroize_string`].
pub struct PreparedModelSave {
    mode: PreparedMode,
    id: String,
    kind: Kind,
    endpoint: Option<String>,
    skip_verify: bool,
    verify_secret: Option<String>,
    new_secret: Option<String>,
    verify_needed: bool,
}

enum PreparedMode {
    Cli {
        keychain: KeychainRef,
    },
    Managed {
        existing: Option<Provider>,
        next_model: String,
        set_default: Option<bool>,
        allow_file_fallback: bool,
        dest_changed: bool,
        adopt_existing_keychain: Option<KeychainRef>,
    },
}

impl Drop for PreparedModelSave {
    fn drop(&mut self) {
        if let Some(mut s) = self.verify_secret.take() {
            zeroize_string(&mut s);
        }
        if let Some(mut s) = self.new_secret.take() {
            zeroize_string(&mut s);
        }
    }
}

/// Phase 1 (runs synchronously inside `spawn_blocking`, without holding `StateLock`): validates
/// inputs, checks mode & rebind rules, and reads any existing key needed for unlocked verification.
pub fn prepare_model_save(
    host: &ModelHost<'_>,
    mut input: ModelSaveInput,
) -> Result<PreparedModelSave, SetupError> {
    let mut new_secret = input.api_key.take().and_then(|mut s| {
        let trimmed = s.trim().to_owned();
        zeroize_string(&mut s);
        (!trimmed.is_empty()).then_some(trimmed)
    });
    let res = prepare_model_save_inner(host, &input, &mut new_secret);
    if res.is_err()
        && let Some(mut s) = new_secret.take()
    {
        zeroize_string(&mut s);
    }
    res
}

fn prepare_model_save_inner(
    host: &ModelHost<'_>,
    input: &ModelSaveInput,
    new_secret: &mut Option<String>,
) -> Result<PreparedModelSave, SetupError> {
    if !identifier(&input.id) {
        return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
    }
    let skip_verify = input.skip_verify.unwrap_or(false);
    let confirm_rebind = input.confirm_rebind_key.unwrap_or(false);
    let allow_file_fallback = input.allow_file_fallback.unwrap_or(false);

    if let Some(key) = new_secret.as_deref() {
        if !key_shaped(key) {
            return Err(SetupError::from_code(COPILOT_KEY_INVALID));
        }
        if cfg!(windows) && keychain::exceeds_windows_blob_limit(key) {
            return Err(SetupError::from_code(COPILOT_KEY_TOO_LONG));
        }
    }

    let mode = desktop_state::mode(host.data).map_err(SetupError::from_code)?;
    if matches!(mode, Mode::Cli) {
        if input.kind.is_some()
            || input.model.is_some()
            || input.endpoint.is_some()
            || input.set_default.is_some()
            || input.confirm_rebind_key.is_some()
            || input.allow_file_fallback.is_some()
        {
            return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
        }
        let providers =
            models::read(&host.data.join("models.json")).map_err(SetupError::from_code)?;
        let Some(provider) = providers.iter().find(|p| p.id == input.id) else {
            return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
        };
        let Some(KeyRef::Keychain(kc)) = &provider.key else {
            return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
        };
        let Some(key) = new_secret.take() else {
            return Err(SetupError::from_code(COPILOT_KEY_INVALID));
        };
        let verify_secret = Some(key.clone());
        return Ok(PreparedModelSave {
            mode: PreparedMode::Cli {
                keychain: kc.clone(),
            },
            id: input.id.clone(),
            kind: provider.kind,
            endpoint: provider.endpoint.clone(),
            skip_verify,
            verify_secret,
            new_secret: Some(key),
            verify_needed: true,
        });
    }

    let state = match mode {
        Mode::Managed(Some(s)) => s,
        Mode::Managed(None) => DesktopState::fresh(),
        Mode::Cli => unreachable!(),
    };
    let existing = state
        .copilot
        .as_ref()
        .and_then(|c| c.providers.iter().find(|p| p.id == input.id))
        .cloned();

    let next_kind = match (input.kind, &existing) {
        (Some(k), _) => k,
        (None, Some(prev)) => prev.kind,
        (None, None) => return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID)),
    };
    let next_model = match (&input.model, &existing) {
        (Some(m), _) => m.trim().to_owned(),
        (None, Some(prev)) => prev.model.clone(),
        (None, None) => return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID)),
    };
    if !model_id(&next_model) {
        return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
    }
    let next_endpoint = match next_kind {
        Kind::Anthropic | Kind::Openai => {
            if input
                .endpoint
                .as_deref()
                .is_some_and(|e| !e.trim().is_empty())
            {
                return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
            }
            None
        }
        Kind::OpenaiCompatible => {
            let candidate = match &input.endpoint {
                Some(_) => normalize_endpoint(input.endpoint.as_deref()),
                None => existing
                    .as_ref()
                    .and_then(|prev| normalize_endpoint(prev.endpoint.as_deref())),
            };
            let Some(ep) = candidate else {
                return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
            };
            if !endpoint_allowed(&ep) {
                return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
            }
            Some(ep)
        }
    };

    if existing.is_none()
        && state
            .copilot
            .as_ref()
            .is_some_and(|c| c.providers.len() >= PROVIDERS_MAX)
    {
        return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
    }

    let prev_endpoint = existing
        .as_ref()
        .and_then(|prev| normalize_endpoint(prev.endpoint.as_deref()));
    let dest_changed = existing
        .as_ref()
        .is_some_and(|prev| prev.kind != next_kind || prev_endpoint != next_endpoint);

    let mut verify_secret: Option<String> = None;
    let mut verify_needed = false;
    let mut adopt_existing_keychain: Option<KeychainRef> = None;

    if let Some(key) = new_secret.as_ref() {
        verify_secret = Some(key.clone());
        verify_needed = true;
    } else if let Some(prev) = &existing {
        if dest_changed && prev.key.is_some() {
            if !confirm_rebind {
                return Err(SetupError::from_code(COPILOT_KEY_REBIND_REQUIRED));
            }
            let stored = read_existing_key(prev, &host.keychain)
                .ok_or_else(|| SetupError::from_code(COPILOT_KEY_INVALID))?;
            verify_secret = Some(stored);
            verify_needed = true;
        } else if prev.key.is_none() && matches!(next_kind, Kind::Anthropic | Kind::Openai) {
            // Switching a keyless openai-compatible provider to Anthropic/OpenAI requires either a
            // newly supplied `apiKey` or a verified pre-existing keychain entry (§8.1).
            if skip_verify {
                return Err(SetupError::from_code(COPILOT_KEY_INVALID));
            }
            let (kc_ref, stored) = read_adoptable_keychain_entry(host, &input.id)?;
            adopt_existing_keychain = Some(kc_ref);
            verify_secret = Some(stored);
            verify_needed = true;
        } else if next_kind == Kind::OpenaiCompatible && prev.key.is_none() {
            verify_needed = true;
        }
    } else {
        match next_kind {
            Kind::Anthropic | Kind::Openai => {
                // Creating a new Anthropic/OpenAI provider without `apiKey` is allowed ONLY if an
                // existing keychain entry exists AND is verified (never with `skipVerify: true`; §8.1).
                if skip_verify {
                    return Err(SetupError::from_code(COPILOT_KEY_INVALID));
                }
                let (kc_ref, stored) = read_adoptable_keychain_entry(host, &input.id)?;
                adopt_existing_keychain = Some(kc_ref);
                verify_secret = Some(stored);
                verify_needed = true;
            }
            Kind::OpenaiCompatible => {
                verify_needed = true;
            }
        }
    }

    Ok(PreparedModelSave {
        mode: PreparedMode::Managed {
            existing,
            next_model,
            set_default: input.set_default,
            allow_file_fallback,
            dest_changed,
            adopt_existing_keychain,
        },
        id: input.id.clone(),
        kind: next_kind,
        endpoint: next_endpoint,
        skip_verify,
        verify_secret,
        new_secret: new_secret.take(),
        verify_needed,
    })
}

fn read_adoptable_keychain_entry(
    host: &ModelHost<'_>,
    id: &str,
) -> Result<(KeychainRef, String), SetupError> {
    let service = host.copilot_keychain_service();
    let mut raw = (host.keychain.read)(&service, id)
        .ok_or_else(|| SetupError::from_code(COPILOT_KEY_INVALID))?;
    let trimmed = raw.trim_end_matches(['\r', '\n']).to_owned();
    zeroize_string(&mut raw);
    if !key_shaped(&trimmed) {
        return Err(SetupError::from_code(COPILOT_KEY_INVALID));
    }
    Ok((
        KeychainRef {
            keychain: service,
            account: id.to_owned(),
        },
        trimmed,
    ))
}

/// Phase 2 (pure async, ZERO locks held): runs the optional zero-token `GET .../models` check.
pub async fn verify_prepared_model(
    prepared: &PreparedModelSave,
    verify_urls: &VerifyUrls,
) -> Result<Option<VerifyOutcome>, SetupError> {
    if !prepared.verify_needed {
        return Ok(None);
    }
    run_verify(
        prepared.kind,
        prepared.endpoint.as_deref(),
        prepared.verify_secret.as_deref(),
        prepared.skip_verify,
        verify_urls,
    )
    .await
}

/// Phase 3 (runs synchronously inside `spawn_blocking`): acquires `StateLock`, re-checks state
/// consistency, writes any replacement key atomically (using a fresh versioned slot/file on
/// destination changes so concurrent `model_send` or crash recovery can NEVER send a new key to
/// the old endpoint), commits `desktop-state.json`, refreshes live `Models`, and cleans up
/// superseded credentials.
pub fn commit_model_save(
    host: &ModelHost<'_>,
    prepared: PreparedModelSave,
    verify_outcome: Option<VerifyOutcome>,
) -> Result<ModelSaveResult, SetupError> {
    match &prepared.mode {
        PreparedMode::Cli { keychain } => {
            // Re-verify CLI mode & unchanged destination before writing keychain.
            let mode = desktop_state::mode(host.data).map_err(SetupError::from_code)?;
            if !matches!(mode, Mode::Cli) {
                return Err(SetupError::from_code(DESKTOP_MATERIALIZE_FAILED));
            }
            let providers =
                models::read(&host.data.join("models.json")).map_err(SetupError::from_code)?;
            let Some(current) = providers.iter().find(|p| p.id == prepared.id) else {
                return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
            };
            if current.kind != prepared.kind
                || current.endpoint != prepared.endpoint
                || current.key != Some(KeyRef::Keychain(keychain.clone()))
            {
                return Err(SetupError::from_code(DESKTOP_MATERIALIZE_FAILED));
            }
            let Some(secret) = prepared.new_secret.as_deref() else {
                return Err(SetupError::from_code(COPILOT_KEY_INVALID));
            };
            match (host.keychain.write)(&keychain.keychain, &keychain.account, secret) {
                Ok(()) => Ok(ModelSaveResult {
                    saved: true,
                    checked: verify_outcome.as_ref().is_some_and(|v| v.checked),
                    answered: verify_outcome.map(|v| v.answered),
                    reload_required: false,
                }),
                Err(KeychainError::TooLong) => Err(SetupError::from_code(COPILOT_KEY_TOO_LONG)),
                Err(KeychainError::InvalidName) => {
                    Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID))
                }
                Err(KeychainError::Unavailable) => {
                    Err(SetupError::from_code(COPILOT_KEYCHAIN_UNAVAILABLE))
                }
            }
        }
        PreparedMode::Managed {
            existing: expected_existing,
            next_model,
            set_default,
            allow_file_fallback,
            dest_changed,
            adopt_existing_keychain,
        } => {
            let _lock = StateLock::acquire(host.data).map_err(SetupError::from_code)?;
            let mut state = match desktop_state::mode(host.data).map_err(SetupError::from_code)? {
                Mode::Managed(Some(s)) => s,
                Mode::Managed(None) => DesktopState::fresh(),
                Mode::Cli => return Err(SetupError::from_code(DESKTOP_CLI_MANAGED)),
            };
            let existing_idx = state
                .copilot
                .as_ref()
                .and_then(|c| c.providers.iter().position(|p| p.id == prepared.id));
            let current_existing = existing_idx.and_then(|idx| {
                state
                    .copilot
                    .as_ref()
                    .and_then(|c| c.providers.get(idx))
                    .cloned()
            });
            // Refuse stale commit if a concurrent writer changed the provider's destination or key ref.
            if &current_existing != expected_existing {
                return Err(SetupError::from_code(DESKTOP_MATERIALIZE_FAILED));
            }
            if current_existing.is_none()
                && state
                    .copilot
                    .as_ref()
                    .is_some_and(|c| c.providers.len() >= PROVIDERS_MAX)
            {
                return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
            }

            let prev_key_ref = current_existing.as_ref().and_then(|p| p.key.clone());
            // When updating an existing slot in place (same destination), snapshot previous secret
            // for rollback if `materialize::commit` fails. When `dest_changed`, write to a FRESH
            // versioned account / key file so old destination & old key stay untouched until commit!
            let mut rollback_prev_secret: Option<(KeyRef, String)> = None;
            let mut created_fresh_slot: Option<KeyRef> = None;

            let next_key_ref = if let Some(new_key) = prepared.new_secret.as_deref() {
                let (account, file_path) = if *dest_changed && prev_key_ref.is_some() {
                    (
                        versioned_keychain_account(&prepared.id)?,
                        versioned_model_key_file_path(host.data, &prepared.id)?,
                    )
                } else {
                    let existing_account = match &prev_key_ref {
                        Some(KeyRef::Keychain(kc)) => kc.account.clone(),
                        _ => prepared.id.clone(),
                    };
                    let existing_file = match &prev_key_ref {
                        Some(KeyRef::File(f))
                            if materialize::is_valid_model_key_file(
                                host.data,
                                &prepared.id,
                                &f.file,
                            ) =>
                        {
                            f.file.clone()
                        }
                        _ => model_key_file_path(host.data, &prepared.id),
                    };
                    (existing_account, existing_file)
                };

                if !*dest_changed
                    && let Some(prev_p) = &current_existing
                    && let Some(prev_ref) = &prev_p.key
                    && let Some(prev_val) = read_existing_key(prev_p, &host.keychain)
                {
                    rollback_prev_secret = Some((prev_ref.clone(), prev_val));
                }

                let written =
                    write_model_key_slot(host, &account, file_path, new_key, *allow_file_fallback)?;
                if prev_key_ref.as_ref() != Some(&written) {
                    created_fresh_slot = Some(written.clone());
                }
                Some(written)
            } else if let Some(kc) = adopt_existing_keychain {
                Some(KeyRef::Keychain(kc.clone()))
            } else {
                prev_key_ref.clone()
            };

            let next_provider = Provider {
                id: prepared.id.clone(),
                kind: prepared.kind,
                model: next_model.clone(),
                endpoint: prepared.endpoint.clone(),
                key: next_key_ref.clone(),
            };

            let prev_default = state.copilot.as_ref().and_then(|c| c.default.clone());
            let copilot = state.copilot.get_or_insert_with(|| Copilot {
                default: Some(prepared.id.clone()),
                providers: Vec::new(),
            });
            if let Some(idx) = existing_idx {
                copilot.providers[idx] = next_provider.clone();
            } else {
                copilot.providers.push(next_provider.clone());
            }
            if *set_default == Some(true) || copilot.default.is_none() {
                copilot.default = Some(prepared.id.clone());
            }
            let default_changed = prev_default != copilot.default;

            // Key-only update on an already-configured provider with unchanged destination, model,
            // default, and key reference needs no reload (models.rs resolves keys on every send).
            let key_only_update = current_existing
                .as_ref()
                .is_some_and(|prev| prev == &next_provider && !default_changed);

            if !key_only_update {
                let mount_kc = host.mount_keychain_service();
                let profile = Profile {
                    sandbox_origin: site::sandbox_origin(),
                    mount_keychain: &mount_kc,
                };
                match materialize::commit(host.data, &state, &profile, host.shell_build) {
                    Ok(built) => {
                        host.refresh_live(&built.frame_src, state.inbound);
                    }
                    Err(code) => {
                        // Roll back any newly written or overwritten key so old state stays intact.
                        if let Some(fresh) = &created_fresh_slot {
                            let _ = delete_model_key_ref(host, &prepared.id, fresh);
                        }
                        if let Some((prev_ref, mut prev_val)) = rollback_prev_secret.take() {
                            if prev_key_ref.as_ref() == next_key_ref.as_ref() {
                                match &prev_ref {
                                    KeyRef::Keychain(kc) => {
                                        let _ = (host.keychain.write)(
                                            &kc.keychain,
                                            &kc.account,
                                            &prev_val,
                                        );
                                    }
                                    KeyRef::File(f) => {
                                        let mut payload = format!("{prev_val}\n");
                                        let _ = write_owner_only(&f.file, payload.as_bytes());
                                        zeroize_string(&mut payload);
                                    }
                                }
                            }
                            zeroize_string(&mut prev_val);
                        }
                        return Err(SetupError::from_code(code));
                    }
                }
            }

            if let Some((_, mut prev_val)) = rollback_prev_secret.take() {
                zeroize_string(&mut prev_val);
            }

            // Clean up any superseded credential slot or old key file (e.g., destination+key switch
            // or migrating Linux file fallback back to the OS keychain).
            if let Some(old_ref) = &prev_key_ref
                && next_key_ref.as_ref() != Some(old_ref)
            {
                let _ = delete_model_key_ref(host, &prepared.id, old_ref);
            }

            Ok(ModelSaveResult {
                saved: true,
                checked: verify_outcome.as_ref().is_some_and(|v| v.checked),
                answered: verify_outcome.map(|v| v.answered),
                reload_required: !key_only_update,
            })
        }
    }
}

/// Convenience async wrapper running Phases 1 -> 2 -> 3 (used directly by unit tests; Tauri IPC
/// runs Phases 1 and 3 inside `spawn_blocking` and Phase 2 unlocked on the async runtime).
pub async fn save_model(
    host: &ModelHost<'_>,
    input: ModelSaveInput,
) -> Result<ModelSaveResult, SetupError> {
    let prepared = prepare_model_save(host, input)?;
    let verified = verify_prepared_model(&prepared, &host.verify_urls).await?;
    commit_model_save(host, prepared, verified)
}

/// Removes a model provider in `managed` mode (optionally deleting its stored key/file), or
/// deletes ONLY the OS keychain entry for a `{ keychain, account }` provider in `cli` mode when
/// `deleteKey == true` (§8.1 & §8.2).
pub fn remove_model(
    host: &ModelHost<'_>,
    input: &ModelRemoveInput,
) -> Result<ModelRemoveResult, SetupError> {
    if !identifier(&input.id) {
        return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
    }
    let initial_mode = desktop_state::mode(host.data).map_err(SetupError::from_code)?;
    if matches!(initial_mode, Mode::Cli) {
        if !input.delete_key {
            return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
        }
        let providers =
            models::read(&host.data.join("models.json")).map_err(SetupError::from_code)?;
        let Some(provider) = providers.iter().find(|p| p.id == input.id) else {
            return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
        };
        let Some(KeyRef::Keychain(kc)) = &provider.key else {
            return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
        };
        (host.keychain.delete)(&kc.keychain, &kc.account)
            .map_err(|_| SetupError::from_code(COPILOT_KEYCHAIN_UNAVAILABLE))?;
        return Ok(ModelRemoveResult {
            removed: true,
            reload_required: false,
        });
    }

    let _lock = StateLock::acquire(host.data).map_err(SetupError::from_code)?;
    let mut state = match desktop_state::mode(host.data).map_err(SetupError::from_code)? {
        Mode::Managed(Some(s)) => s,
        Mode::Managed(None) => return Err(SetupError::from_code(COPILOT_PROVIDER_MISSING)),
        Mode::Cli => return Err(SetupError::from_code(DESKTOP_CLI_MANAGED)),
    };
    let Some(copilot) = state.copilot.as_mut() else {
        return Err(SetupError::from_code(COPILOT_PROVIDER_MISSING));
    };
    let Some(pos) = copilot.providers.iter().position(|p| p.id == input.id) else {
        return Err(SetupError::from_code(COPILOT_PROVIDER_MISSING));
    };
    let removed = copilot.providers.remove(pos);
    if copilot.providers.is_empty() {
        state.copilot = None;
    } else if copilot.default.as_deref() == Some(input.id.as_str()) {
        copilot.default = copilot.providers.first().map(|p| p.id.clone());
    }

    // Delete the stored key BEFORE committing removal so a keychain/filesystem deletion failure
    // leaves the provider visible in `desktop-state.json` with a clean retry path.
    if input.delete_key
        && let Some(key_ref) = &removed.key
    {
        delete_model_key_ref(host, &removed.id, key_ref)?;
    }

    let mount_kc = host.mount_keychain_service();
    let profile = Profile {
        sandbox_origin: site::sandbox_origin(),
        mount_keychain: &mount_kc,
    };
    let built = materialize::commit(host.data, &state, &profile, host.shell_build)
        .map_err(SetupError::from_code)?;
    host.refresh_live(&built.frame_src, state.inbound);

    Ok(ModelRemoveResult {
        removed: true,
        reload_required: true,
    })
}

/// Switches `copilot.default` and re-materializes `deployment.json` (§3.3 & §8.1).
pub fn set_default_model(
    host: &ModelHost<'_>,
    input: &ModelSetDefaultInput,
) -> Result<ModelSetDefaultResult, SetupError> {
    if !identifier(&input.id) {
        return Err(SetupError::from_code(DEPLOYMENT_COPILOT_INVALID));
    }
    let initial_mode = desktop_state::mode(host.data).map_err(SetupError::from_code)?;
    if matches!(initial_mode, Mode::Cli) {
        return Err(SetupError::from_code(DESKTOP_CLI_MANAGED));
    }
    let _lock = StateLock::acquire(host.data).map_err(SetupError::from_code)?;
    let mut state = match desktop_state::mode(host.data).map_err(SetupError::from_code)? {
        Mode::Managed(Some(s)) => s,
        Mode::Managed(None) => return Err(SetupError::from_code(COPILOT_PROVIDER_MISSING)),
        Mode::Cli => return Err(SetupError::from_code(DESKTOP_CLI_MANAGED)),
    };
    let Some(copilot) = state.copilot.as_mut() else {
        return Err(SetupError::from_code(COPILOT_PROVIDER_MISSING));
    };
    if !copilot.providers.iter().any(|p| p.id == input.id) {
        return Err(SetupError::from_code(COPILOT_PROVIDER_MISSING));
    }
    copilot.default = Some(input.id.clone());

    let mount_kc = host.mount_keychain_service();
    let profile = Profile {
        sandbox_origin: site::sandbox_origin(),
        mount_keychain: &mount_kc,
    };
    let built = materialize::commit(host.data, &state, &profile, host.shell_build)
        .map_err(SetupError::from_code)?;
    host.refresh_live(&built.frame_src, state.inbound);

    Ok(ModelSetDefaultResult {
        default: input.id.clone(),
        reload_required: true,
    })
}

#[cfg(test)]
#[path = "setup_models_tests.rs"]
mod tests;
