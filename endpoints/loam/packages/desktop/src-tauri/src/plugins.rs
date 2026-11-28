//! Transactional plugin lifecycle core: staged-only inspect (Phase 1), consent proposal state,
//! transactional install & upgrade with full rollback (Phase 3), uninstall with retryable
//! `pendingRevocations`, safe token rotation, and service actions (phase 5 no-terminal amendment,
//! sections 7.1–7.4 & 10; P5-S9-2, P5-S9-3, P5-S9-4).
//!
//! Shared directly between `loam-desktop plugin` CLI (`plugins_cli.rs`) and `host-setup` IPC
//! commands (step 9d).
use crate::SiteState;
use crate::connection::{ensure_dir_owner_only, write_owner_only};
use crate::desktop_state::{
    self, DesktopState, EngineState, InstalledPlugin, Mode, PendingRevocation, StateLock,
};
use crate::keychain::{self, KeychainError};
use crate::materialize::{self, Profile};
use crate::mounts::Mounts;
use crate::plugin_archive::{
    BundleLimits, PLUGIN_ARCHIVE_EXTENSION, StagedBundle, stage_and_validate_archive,
    stage_and_validate_directory,
};
use crate::plugin_manifest::{Approvals, AuthMode, Labels, PluginManifest, Target};
use crate::plugins_engine::{
    HEALTH_POLL_TIMEOUT, ProbeOutcome, allocate_port, check_version, pair_engine,
    poll_engine_health_blocking, probe_error, unpair_engine,
};
use crate::plugins_error::{
    DESKTOP_CLI_MANAGED, DESKTOP_MATERIALIZE_FAILED, DESKTOP_STATE_INVALID,
    PLUGIN_ALREADY_INSTALLED, PLUGIN_CONFLICT, PLUGIN_HASH_MISMATCH, PLUGIN_KEY_TOO_LONG,
    PLUGIN_KEYCHAIN_UNAVAILABLE, PLUGIN_PAIR_FAILED, PLUGIN_PROPOSAL_EXPIRED,
    PLUGIN_TARGET_UNSUPPORTED, PluginError,
};
pub(crate) use crate::plugins_ops::retry_pending_revocations_under_lock;
pub use crate::plugins_ops::{
    list_installed, retry_revocation, rotate_token, service_action, uninstall,
};
use crate::service::{self, ServiceSpec};
use crate::site;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Pending proposal lifetime in Rust memory (amendment 7.1, step 6).
const PROPOSAL_TTL: Duration = Duration::from_secs(10 * 60);

pub type KeychainReadFn = Arc<dyn Fn(&str, &str) -> Option<String> + Send + Sync>;
pub type KeychainWriteFn = Arc<dyn Fn(&str, &str, &str) -> Result<(), KeychainError> + Send + Sync>;
pub type KeychainDeleteFn = Arc<dyn Fn(&str, &str) -> Result<(), KeychainError> + Send + Sync>;

/// Abstraction over OS keychain read/write/delete so unit tests can exercise all error paths
/// (Windows 2,560-byte cap, Linux Secret Service unavailable + D166 file fallback, rotation,
/// rollback) without mutating the host machine's real keychain.
#[derive(Clone)]
pub struct KeychainOps {
    pub read: KeychainReadFn,
    pub write: KeychainWriteFn,
    pub delete: KeychainDeleteFn,
    /// Whether this platform allows D166 Linux keyring-less `mounts.json` fallback when `write`
    /// returns `KeychainError::Unavailable`.
    pub allows_file_fallback: bool,
}

impl Default for KeychainOps {
    fn default() -> Self {
        Self {
            read: Arc::new(keychain::read),
            write: Arc::new(keychain::write),
            delete: Arc::new(keychain::delete),
            allows_file_fallback: cfg!(all(unix, not(target_os = "macos"))),
        }
    }
}

/// Optional live host handles updated in place on commit/uninstall/rotation (amendment 9.2).
pub struct LiveHost<'a> {
    pub site: &'a SiteState,
    pub mounts: &'a Arc<Mounts>,
    pub bundled_factory: Arc<dyn Fn() -> site::Lookup + Send + Sync>,
    /// Optional hook invoked when a committed deployment enables desktop inbound (`inbound: true`),
    /// allowing a running host that started fresh (`inbound: false`) to start `InboundState`.
    pub on_inbound_enabled: Option<Arc<dyn Fn() + Send + Sync>>,
}

/// Shared execution context for plugin lifecycle operations.
pub struct PluginHost<'a> {
    pub data: &'a Path,
    pub custom_data_dir: Option<&'a Path>,
    pub shell_build: &'a str,
    pub keychain: KeychainOps,
    pub supervisor_exe: Option<&'a Path>,
    pub health_timeout: Duration,
    pub live: Option<LiveHost<'a>>,
}

impl<'a> PluginHost<'a> {
    pub fn new(data: &'a Path, custom_data_dir: Option<&'a Path>, shell_build: &'a str) -> Self {
        Self {
            data,
            custom_data_dir,
            shell_build,
            keychain: KeychainOps::default(),
            supervisor_exe: None,
            health_timeout: HEALTH_POLL_TIMEOUT,
            live: None,
        }
    }

    pub(crate) fn mount_keychain_service(&self) -> String {
        keychain::mount_service(self.custom_data_dir)
    }

    pub(crate) fn refresh_live(&self, frame_src: &str) {
        let Some(live) = &self.live else {
            return;
        };
        let deployed = crate::mounts::read_deployed(&self.data.join("mounts.json"));
        let inbound_now = deployed.as_ref().is_ok_and(|d| d.inbound);
        live.mounts.update_entries(deployed.map(|d| d.mounts));
        let bundled = (live.bundled_factory)();
        if let Ok(site) = site::Site::try_managed(&self.data.join("site"), bundled, frame_src) {
            live.site.swap(site);
        }
        if inbound_now && let Some(hook) = &live.on_inbound_enabled {
            hook();
        }
    }

    pub(crate) fn close_live_instance(&self, instance: &str) {
        let Some(live) = &self.live else {
            return;
        };
        let mounts = live.mounts.clone();
        let inst = instance.to_owned();
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                let _ = std::thread::spawn(move || handle.block_on(mounts.close_instance(&inst)))
                    .join();
            }
            Err(_) => {
                if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    rt.block_on(mounts.close_instance(&inst));
                }
            }
        }
    }
}

/// Sanitized app summary shown on consent screens and CLI output.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalAppSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub grants: Vec<String>,
    pub is_native: bool,
}

/// Sanitized engine command preview entry shown on consent screens.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalPreviewSummary {
    pub command: String,
    pub preview_command: String,
    pub input: Vec<String>,
}

/// Sanitized engine summary shown on consent screens and CLI output.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalEngineSummary {
    pub id: String,
    pub target: String,
    pub artifact_path: String,
    pub artifact_name: String,
    pub engine_sha256: String,
    pub mount_app: String,
    pub auth_mode: String,
    pub labels: String,
    pub approvals: String,
    pub previews: Vec<ProposalPreviewSummary>,
    pub exposed_commands: Vec<String>,
}

/// Previous version details when `kind == "upgrade"`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalPrevious {
    pub version: String,
    pub bundle_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_sha256: Option<String>,
}

/// Sanitized install/upgrade proposal returned by Phase 1 Inspect (amendment 7.1 & 7.2).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallProposalV1 {
    pub proposal_id: String,
    pub kind: &'static str,
    pub plugin_id: String,
    pub title: String,
    pub version: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub bundle_sha256: String,
    pub apps: Vec<ProposalAppSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<ProposalEngineSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous: Option<ProposalPrevious>,
}

/// Sanitized summary of an installed plugin (never contains any secret or `proofKey`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginSummaryV1 {
    pub id: String,
    pub title: String,
    pub version: String,
    pub bundle_sha256: String,
    pub apps: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    pub has_engine: bool,
}

/// Sanitized summary of a retryable pending revocation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRevocationSummaryV1 {
    pub plugin_id: String,
    pub token_id: String,
    pub failed_at: String,
}

/// Result of `uninstall`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallResult {
    pub uninstalled: bool,
    pub data_preserved: bool,
    pub token_revoked: bool,
    pub reload_required: bool,
}

/// Result of `rotate_token`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateTokenResult {
    pub rotated: bool,
    pub token_id: String,
    pub reload_required: bool,
}

/// Fixed actions allowed on a plugin's login service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceAction {
    Start,
    Stop,
    Restart,
    Status,
}

/// Result of `service_action`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceActionResult {
    pub state: &'static str,
    pub port: u16,
}

/// In-memory staged proposal awaiting explicit confirmation (at most one active; §7.1 step 6).
struct PendingInstall {
    proposal_id: String,
    staging_dir: PathBuf,
    manifest: PluginManifest,
    bundle_sha256: String,
    engine_target: Option<Target>,
    domains: HashSet<String>,
    expires_at: Instant,
}

/// Thread-safe single-slot store for the active [`PendingInstall`].
#[derive(Default)]
pub struct PendingInstallStore(Mutex<Option<PendingInstall>>);

impl PendingInstallStore {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }

    pub fn has_active(&self) -> bool {
        let guard = self.0.lock().expect("pending install lock");
        guard
            .as_ref()
            .is_some_and(|p| Instant::now() < p.expires_at)
    }

    fn replace(&self, next: PendingInstall) {
        let mut guard = self.0.lock().expect("pending install lock");
        if let Some(prev) = guard.replace(next) {
            let _ = std::fs::remove_dir_all(&prev.staging_dir);
        }
    }

    pub fn clear(&self) {
        let mut guard = self.0.lock().expect("pending install lock");
        if let Some(prev) = guard.take() {
            let _ = std::fs::remove_dir_all(&prev.staging_dir);
        }
    }

    fn take(&self) -> Option<PendingInstall> {
        self.0.lock().expect("pending install lock").take()
    }

    fn restore(&self, pending: PendingInstall) {
        let mut guard = self.0.lock().expect("pending install lock");
        if guard.is_none() {
            *guard = Some(pending);
        } else {
            let _ = std::fs::remove_dir_all(&pending.staging_dir);
        }
    }
}

/// Shared archive-extension predicate used by both OS file-open sanitization and `plugins::inspect`.
pub(crate) fn has_plugin_archive_extension(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    name.to_ascii_lowercase()
        .ends_with(PLUGIN_ARCHIVE_EXTENSION)
}

fn new_proposal_id() -> Result<String, PluginError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| PluginError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
    let mut out = String::with_capacity(32);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    Ok(out)
}

pub(crate) fn utc_timestamp_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    format!("unix:{secs}")
}

pub(crate) fn read_managed_state(data: &Path) -> Result<DesktopState, PluginError> {
    match desktop_state::mode(data) {
        Ok(Mode::Managed(Some(state))) => Ok(state),
        Ok(Mode::Managed(None)) => Ok(DesktopState::fresh()),
        Ok(Mode::Cli) => Err(PluginError::from_code(DESKTOP_CLI_MANAGED)),
        Err(code) => Err(PluginError::from_code(code)),
    }
}

pub(crate) fn installed_plugin_manifest(
    data: &Path,
    plugin: &InstalledPlugin,
) -> Result<(PluginManifest, HashSet<String>, HashSet<String>), PluginError> {
    let root = data
        .join("plugins")
        .join(&plugin.id)
        .join(&plugin.bundle_sha256);
    let bytes = std::fs::read(root.join("plugin-manifest.json"))
        .map_err(|_| PluginError::from_code(DESKTOP_STATE_INVALID))?;
    let (manifest, _) = crate::plugin_manifest::read(&bytes)
        .ok_or_else(|| PluginError::from_code(DESKTOP_STATE_INVALID))?;
    let mut app_ids = HashSet::new();
    let mut domains = HashSet::new();
    for app in &manifest.apps {
        app_ids.insert(app.id.clone());
        let app_bytes = std::fs::read(root.join(&app.path).join("app-manifest.json"))
            .map_err(|_| PluginError::from_code(DESKTOP_STATE_INVALID))?;
        if let Ok(summary) = crate::plugin_validate::parse_packed_app_manifest(&app_bytes) {
            if summary.kind == "mounted" {
                if let Some(p) = summary.mount_prefix {
                    domains.insert(p);
                }
            } else {
                domains.insert(summary.id);
            }
        }
    }
    Ok((manifest, app_ids, domains))
}

fn check_state_conflicts(
    data: &Path,
    state: &DesktopState,
    staged: &StagedBundle,
) -> Result<Option<ProposalPrevious>, PluginError> {
    let mut previous = None;
    let new_app_ids: HashSet<&str> = staged.manifest.apps.iter().map(|a| a.id.as_str()).collect();
    let mut new_domains: HashSet<&str> = HashSet::new();
    for app in &staged.manifest.apps {
        if let Some(summary) = staged.apps.get(&app.id) {
            if summary.kind == "mounted" {
                if let Some(p) = summary.mount_prefix.as_deref() {
                    new_domains.insert(p);
                }
            } else {
                new_domains.insert(summary.id.as_str());
            }
        }
    }

    for existing in &state.plugins {
        if existing.id == staged.manifest.plugin.id {
            if existing.bundle_sha256 == staged.bundle_sha256 {
                return Err(PluginError::from_code(PLUGIN_ALREADY_INSTALLED));
            }
            let (prev_manifest, _, _) = installed_plugin_manifest(data, existing)?;
            let prev_engine_sha = prev_manifest.engine.as_ref().and_then(|e| {
                Target::current().and_then(|t| e.artifacts.get(&t).map(|a| a.sha256.clone()))
            });
            previous = Some(ProposalPrevious {
                version: prev_manifest.plugin.version,
                bundle_sha256: existing.bundle_sha256.clone(),
                engine_sha256: prev_engine_sha,
            });
            continue;
        }
        let (_, other_ids, other_domains) = installed_plugin_manifest(data, existing)?;
        if other_ids.iter().any(|id| new_app_ids.contains(id.as_str()))
            || other_domains
                .iter()
                .any(|d| new_domains.contains(d.as_str()))
        {
            return Err(PluginError::from_code(PLUGIN_CONFLICT));
        }
    }
    Ok(previous)
}

/// Phase 1 Inspect (strictly read-only, zero plugin code execution, staged-only validation; §7.1).
pub fn inspect(
    host: &PluginHost<'_>,
    source: &Path,
    store: &PendingInstallStore,
) -> Result<PluginInstallProposalV1, PluginError> {
    let state = read_managed_state(host.data)?;
    let proposal_id = new_proposal_id()?;
    let staging_parent = host.data.join("plugins").join(".staging");
    ensure_dir_owner_only(&staging_parent)
        .map_err(|_| PluginError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
    let staging_dir = staging_parent.join(&proposal_id);

    let cleanup = |dir: &Path| {
        let _ = std::fs::remove_dir_all(dir);
    };

    let is_archive = has_plugin_archive_extension(source)
        && std::fs::symlink_metadata(source).is_ok_and(|m| m.is_file());

    let staged_res = if is_archive {
        stage_and_validate_archive(source, &staging_dir, BundleLimits::default())
    } else {
        stage_and_validate_directory(source, &staging_dir, BundleLimits::default())
    };
    let staged = match staged_res {
        Ok(s) => s,
        Err(refusals) => {
            cleanup(&staging_dir);
            let first = refusals.into_iter().next();
            return Err(match first {
                Some(r) => PluginError::with_key_reason(r.code, r.key, r.reason),
                None => PluginError::from_code(crate::plugins_error::PLUGIN_MANIFEST_INVALID),
            });
        }
    };

    // Resolve current OS/arch target and verify engine artifact SHA-256 on staged bytes.
    let (engine_target, engine_summary) = match &staged.manifest.engine {
        None => (None, None),
        Some(engine) => {
            let Some(target) = Target::current() else {
                cleanup(&staging_dir);
                return Err(PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED));
            };
            let Some(artifact) = engine.artifacts.get(&target) else {
                cleanup(&staging_dir);
                return Err(PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED));
            };
            let Some(computed) = staged.engine_digests.get(&target) else {
                cleanup(&staging_dir);
                return Err(PluginError::from_code(PLUGIN_HASH_MISMATCH));
            };
            if computed != &artifact.sha256 {
                cleanup(&staging_dir);
                return Err(PluginError::from_code(PLUGIN_HASH_MISMATCH));
            }
            let mount = engine.mount.as_ref();
            let labels = mount
                .and_then(|m| m.labels)
                .unwrap_or(Labels::Whole)
                .as_str()
                .to_owned();
            let approvals = mount
                .and_then(|m| m.approvals)
                .unwrap_or(Approvals::None)
                .as_str()
                .to_owned();
            let mut previews = Vec::new();
            let mut exposed_commands = Vec::new();
            if let Some(cmds) = mount.and_then(|m| m.commands.as_ref()) {
                for (name, ov) in cmds {
                    if let Some(p) = &ov.preview {
                        previews.push(ProposalPreviewSummary {
                            command: name.clone(),
                            preview_command: p.command.clone(),
                            input: p.input.clone(),
                        });
                    }
                    if ov.expose.as_ref().is_some_and(|e| {
                        e.agent == Some(true) || e.apps == Some(true) || e.palette == Some(true)
                    }) {
                        exposed_commands.push(name.clone());
                    }
                }
            }
            let artifact_name = artifact
                .path
                .rsplit('/')
                .next()
                .unwrap_or(&artifact.path)
                .to_owned();
            let summary = ProposalEngineSummary {
                id: engine.id.clone(),
                target: target.as_str().to_owned(),
                artifact_path: artifact.path.clone(),
                artifact_name,
                engine_sha256: computed.clone(),
                mount_app: engine.mount_app.clone(),
                auth_mode: engine.auth.mode.as_str().to_owned(),
                labels,
                approvals,
                previews,
                exposed_commands,
            };
            (Some(target), Some(summary))
        }
    };

    let previous = match check_state_conflicts(host.data, &state, &staged) {
        Ok(prev) => prev,
        Err(err) => {
            cleanup(&staging_dir);
            return Err(err);
        }
    };

    let mut domains = HashSet::new();
    for app in &staged.manifest.apps {
        if let Some(s) = staged.apps.get(&app.id) {
            if s.kind == "mounted" {
                if let Some(p) = &s.mount_prefix {
                    domains.insert(p.clone());
                }
            } else {
                domains.insert(s.id.clone());
            }
        }
    }

    let apps: Vec<ProposalAppSummary> = staged
        .manifest
        .apps
        .iter()
        .filter_map(|entry| {
            let s = staged.apps.get(&entry.id)?;
            Some(ProposalAppSummary {
                id: entry.id.clone(),
                title: s.title.clone(),
                kind: s.kind.clone(),
                grants: s.grants.clone(),
                is_native: s.kind == "native",
            })
        })
        .collect();

    let proposal = PluginInstallProposalV1 {
        proposal_id: proposal_id.clone(),
        kind: if previous.is_some() {
            "upgrade"
        } else {
            "install"
        },
        plugin_id: staged.manifest.plugin.id.clone(),
        title: staged.manifest.plugin.title.clone(),
        version: staged.manifest.plugin.version.clone(),
        description: staged.manifest.plugin.description.clone(),
        license: staged.manifest.plugin.license.clone(),
        homepage: staged.manifest.plugin.homepage.clone(),
        bundle_sha256: staged.bundle_sha256.clone(),
        apps,
        engine: engine_summary,
        previous,
    };

    store.replace(PendingInstall {
        proposal_id,
        staging_dir,
        manifest: staged.manifest,
        bundle_sha256: staged.bundle_sha256,
        engine_target,
        domains,
        expires_at: Instant::now() + PROPOSAL_TTL,
    });

    Ok(proposal)
}

/// Cancels an active proposal and immediately deletes its staging directory (§3.3 & §7.1).
pub fn cancel(proposal_id: &str, store: &PendingInstallStore) -> Result<(), PluginError> {
    if let Some(pending) = store.take() {
        let _ = std::fs::remove_dir_all(&pending.staging_dir);
        if pending.proposal_id != proposal_id {
            return Err(PluginError::from_code(PLUGIN_PROPOSAL_EXPIRED));
        }
    }
    Ok(())
}

fn set_executable_if_unix(path: &Path) -> Result<(), PluginError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| PluginError::from_code(DESKTOP_MATERIALIZE_FAILED))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub(crate) fn resolve_binary_path(
    bundle_root: &Path,
    manifest: &PluginManifest,
    target: Target,
) -> Option<PathBuf> {
    let artifact = manifest.engine.as_ref()?.artifacts.get(&target)?;
    let mut p = bundle_root.to_path_buf();
    for seg in artifact.path.split('/') {
        p.push(seg);
    }
    Some(p)
}

/// Phase 3 Transactional Commit: installs or upgrades the staged proposal with full rollback on
/// any failure prior to committing `desktop-state.json` (amendment 7.3).
pub fn confirm(
    host: &PluginHost<'_>,
    proposal_id: &str,
    expected_bundle_sha256: &str,
    allow_file_fallback: bool,
    store: &PendingInstallStore,
) -> Result<InstalledPluginSummaryV1, PluginError> {
    let _lock = StateLock::acquire(host.data).map_err(PluginError::from_code)?;
    let Some(pending) = store.take() else {
        return Err(PluginError::from_code(PLUGIN_PROPOSAL_EXPIRED));
    };
    if pending.proposal_id != proposal_id || Instant::now() >= pending.expires_at {
        let _ = std::fs::remove_dir_all(&pending.staging_dir);
        return Err(PluginError::from_code(PLUGIN_PROPOSAL_EXPIRED));
    }
    if pending.bundle_sha256 != expected_bundle_sha256 {
        let _ = std::fs::remove_dir_all(&pending.staging_dir);
        return Err(PluginError::from_code(PLUGIN_HASH_MISMATCH));
    }

    let state = match read_managed_state(host.data) {
        Ok(s) => s,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&pending.staging_dir);
            return Err(err);
        }
    };

    // Re-check conflicts under `desktop-state.lock` to close any GUI/CLI race since Inspect.
    let prev_record = state
        .plugins
        .iter()
        .find(|p| p.id == pending.manifest.plugin.id)
        .cloned();
    if let Some(prev) = &prev_record
        && prev.bundle_sha256 == pending.bundle_sha256
    {
        let _ = std::fs::remove_dir_all(&pending.staging_dir);
        return Err(PluginError::from_code(PLUGIN_ALREADY_INSTALLED));
    }
    let new_app_ids: HashSet<&str> = pending
        .manifest
        .apps
        .iter()
        .map(|a| a.id.as_str())
        .collect();
    for other in &state.plugins {
        if other.id == pending.manifest.plugin.id {
            continue;
        }
        if let Ok((_, other_ids, other_domains)) = installed_plugin_manifest(host.data, other)
            && (other_ids.iter().any(|id| new_app_ids.contains(id.as_str()))
                || other_domains.iter().any(|d| pending.domains.contains(d)))
        {
            let _ = std::fs::remove_dir_all(&pending.staging_dir);
            return Err(PluginError::from_code(PLUGIN_CONFLICT));
        }
    }

    let plugin_id_str = pending.manifest.plugin.id.clone();
    let plugin_parent = host.data.join("plugins").join(&plugin_id_str);
    if ensure_dir_owner_only(&plugin_parent).is_err() {
        let _ = std::fs::remove_dir_all(&pending.staging_dir);
        return Err(PluginError::from_code(DESKTOP_MATERIALIZE_FAILED));
    }
    let target_bundle_dir = plugin_parent.join(&pending.bundle_sha256);
    if target_bundle_dir.exists() {
        let _ = std::fs::remove_dir_all(&target_bundle_dir);
    }
    if std::fs::rename(&pending.staging_dir, &target_bundle_dir).is_err() {
        let _ = std::fs::remove_dir_all(&pending.staging_dir);
        return Err(PluginError::from_code(DESKTOP_MATERIALIZE_FAILED));
    }

    let kc_service = host.mount_keychain_service();
    let profile = Profile {
        sandbox_origin: site::sandbox_origin(),
        mount_keychain: &kc_service,
    };

    // Pure-app branch (no `[engine]`): skip steps 3–8 and commit directly (§7.3 step 2).
    let Some(engine_spec) = pending.manifest.engine.as_ref() else {
        // If upgrading from an engine-backed plugin to a pure-app plugin, stop/unregister old service.
        let mut next_state = state.clone();
        next_state.plugins.retain(|p| p.id != plugin_id_str);
        next_state.plugins.push(InstalledPlugin {
            id: plugin_id_str.clone(),
            bundle_sha256: pending.bundle_sha256.clone(),
            engine: None,
        });
        let built = match materialize::commit(host.data, &next_state, &profile, host.shell_build) {
            Ok(b) => b,
            Err(code) => {
                let _ = std::fs::remove_dir_all(&target_bundle_dir);
                let _ = materialize::reconcile(host.data, &state, &profile, host.shell_build);
                return Err(PluginError::from_code(code));
            }
        };
        if let Some(prev) = &prev_record {
            let old_dir = plugin_parent.join(&prev.bundle_sha256);
            if let Some(prev_eng) = &prev.engine {
                let prev_manifest = installed_plugin_manifest(host.data, prev)
                    .ok()
                    .map(|(m, _, _)| m);
                if let Some(mount_app) = prev_manifest
                    .as_ref()
                    .and_then(|m| m.engine.as_ref().map(|e| e.mount_app.as_str()))
                {
                    host.close_live_instance(mount_app);
                    if !prev_eng.file_fallback
                        && let Some(old_tid) = &prev_eng.token_id
                    {
                        let _ =
                            (host.keychain.delete)(&kc_service, &format!("{mount_app}.{old_tid}"));
                    }
                }
                let _ =
                    service::unregister_service(host.data, host.custom_data_dir, &plugin_id_str);
                if let Some(old_tid) = &prev_eng.token_id
                    && let Some(prev_bin) = prev_manifest.as_ref().and_then(|m| {
                        Target::current().and_then(|t| resolve_binary_path(&old_dir, m, t))
                    })
                    && unpair_engine(&prev_bin, old_tid).is_err()
                {
                    next_state.pending_revocations.push(PendingRevocation {
                        plugin_id: plugin_id_str.clone(),
                        token_id: old_tid.clone(),
                        binary_path: prev_bin,
                        failed_at: utc_timestamp_now(),
                    });
                    let _ = write_owner_only(
                        &host.data.join(desktop_state::FILE),
                        &desktop_state::bytes(&next_state),
                    );
                }
            }
            let referenced = next_state
                .pending_revocations
                .iter()
                .any(|r| r.binary_path.starts_with(&old_dir));
            if !referenced {
                let _ = std::fs::remove_dir_all(&old_dir);
            }
        }
        host.refresh_live(&built.frame_src);
        return Ok(InstalledPluginSummaryV1 {
            id: plugin_id_str,
            title: pending.manifest.plugin.title,
            version: pending.manifest.plugin.version,
            bundle_sha256: pending.bundle_sha256,
            apps: pending.manifest.apps.iter().map(|a| a.id.clone()).collect(),
            engine_port: None,
            token_id: None,
            has_engine: false,
        });
    };

    let had_state_file = host.data.join(desktop_state::FILE).exists();
    let target = pending
        .engine_target
        .ok_or_else(|| PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED))?;
    let binary_path = resolve_binary_path(&target_bundle_dir, &pending.manifest, target)
        .ok_or_else(|| PluginError::from_code(PLUGIN_TARGET_UNSUPPORTED))?;
    if let Err(err) = set_executable_if_unix(&binary_path) {
        let _ = std::fs::remove_dir_all(&target_bundle_dir);
        return Err(err);
    }

    // Track rollback artifacts created during steps 3–9.
    struct RollbackState<'h> {
        host: &'h PluginHost<'h>,
        plugin_id: String,
        mount_app: String,
        new_bundle_dir: PathBuf,
        binary_path: PathBuf,
        kc_service: String,
        new_token_id: Option<String>,
        wrote_keychain_slot: bool,
        wrote_fallback_key: bool,
        pending_service_started: bool,
        promoted_service: bool,
        committed_new_state: bool,
        had_state_file: bool,
        stopped_previous: Option<(PluginManifest, InstalledPlugin, PathBuf)>,
        committed_state: DesktopState,
        restore_staging_dir: Option<PathBuf>,
    }

    impl RollbackState<'_> {
        fn rollback(self) {
            if self.promoted_service {
                let _ = service::unregister_service(
                    self.host.data,
                    self.host.custom_data_dir,
                    &self.plugin_id,
                );
            }
            if self.pending_service_started {
                let _ = service::rollback_pending(
                    self.host.data,
                    self.host.custom_data_dir,
                    &self.plugin_id,
                );
            }
            if let Some(tok) = &self.new_token_id {
                let _ = unpair_engine(&self.binary_path, tok);
                if self.wrote_keychain_slot {
                    let account = format!("{}.{tok}", self.mount_app);
                    let _ = (self.host.keychain.delete)(&self.kc_service, &account);
                }
                if self.wrote_fallback_key {
                    materialize::delete_mount_fallback_key(self.host.data, &self.mount_app, tok);
                }
            }
            let referenced_by_pending = self
                .committed_state
                .pending_revocations
                .iter()
                .any(|r| r.binary_path.starts_with(&self.new_bundle_dir));
            if let Some(restore_dir) = self.restore_staging_dir {
                if let Some(parent) = restore_dir.parent() {
                    let _ = ensure_dir_owner_only(parent);
                }
                if std::fs::rename(&self.new_bundle_dir, &restore_dir).is_err()
                    && !referenced_by_pending
                {
                    let _ = std::fs::remove_dir_all(&self.new_bundle_dir);
                }
            } else if !referenced_by_pending {
                let _ = std::fs::remove_dir_all(&self.new_bundle_dir);
            }
            let profile = Profile {
                sandbox_origin: site::sandbox_origin(),
                mount_keychain: &self.kc_service,
            };
            if self.had_state_file {
                if self.committed_new_state {
                    let _ = materialize::commit(
                        self.host.data,
                        &self.committed_state,
                        &profile,
                        self.host.shell_build,
                    );
                } else {
                    let _ = materialize::reconcile(
                        self.host.data,
                        &self.committed_state,
                        &profile,
                        self.host.shell_build,
                    );
                }
            } else if self.committed_new_state {
                let _ = std::fs::remove_file(self.host.data.join(desktop_state::FILE));
                let _ = std::fs::remove_file(self.host.data.join("mounts.json"));
                let _ = std::fs::remove_file(self.host.data.join("models.json"));
                let _ = std::fs::remove_dir_all(self.host.data.join("site"));
            }
            if let Some((prev_manifest, prev_plugin, prev_binary)) = self.stopped_previous
                && let Some(prev_eng) = &prev_plugin.engine
            {
                let prev_spec = ServiceSpec {
                    data: self.host.data,
                    custom_data_dir: self.host.custom_data_dir,
                    plugin_id: &self.plugin_id,
                    title: &prev_manifest.plugin.title,
                    bundle_sha256: &prev_plugin.bundle_sha256,
                    binary_path: &prev_binary,
                    port: prev_eng.port,
                    supervisor_exe: self.host.supervisor_exe,
                };
                let _ = service::register_and_start(&prev_spec);
            }
        }
    }

    let mut rb = RollbackState {
        host,
        plugin_id: plugin_id_str.clone(),
        mount_app: engine_spec.mount_app.clone(),
        new_bundle_dir: target_bundle_dir.clone(),
        binary_path: binary_path.clone(),
        kc_service: kc_service.clone(),
        new_token_id: None,
        wrote_keychain_slot: false,
        wrote_fallback_key: false,
        pending_service_started: false,
        promoted_service: false,
        committed_new_state: false,
        had_state_file,
        stopped_previous: None,
        committed_state: state.clone(),
        restore_staging_dir: None,
    };

    // Step 3: post-consent `--version` build check (refuse `test-doubles`).
    if let Err(err) = check_version(&binary_path) {
        rb.rollback();
        return Err(err);
    }

    // Step 4: on upgrade, close live handles & stop previous service (keeping launch.json + old keychain slot).
    let prev_info = prev_record.as_ref().and_then(|prev| {
        let (pm, _, _) = installed_plugin_manifest(host.data, prev).ok()?;
        let prev_bin = resolve_binary_path(&plugin_parent.join(&prev.bundle_sha256), &pm, target)?;
        Some((pm, prev.clone(), prev_bin))
    });
    if let Some((ref prev_manifest, ref prev_plugin, _)) = prev_info {
        if let Some(prev_eng) = &prev_manifest.engine {
            host.close_live_instance(&prev_eng.mount_app);
        }
        if prev_plugin.engine.is_some() {
            let _ = service::stop_service(host.data, host.custom_data_dir, &plugin_id_str);
            rb.stopped_previous = prev_info.clone();
        }
    }

    // Step 5: choose non-ephemeral loopback port in `17400..=17999`.
    let preferred_port = prev_record
        .as_ref()
        .and_then(|p| p.engine.as_ref().map(|e| e.port));
    let port = match allocate_port(&state, preferred_port) {
        Ok(p) => p,
        Err(err) => {
            rb.rollback();
            return Err(err);
        }
    };

    // Collect active/pending token IDs so a buggy engine returning a colliding ID can never
    // trigger an accidental `unpair` of an active or pending credential.
    let mut disallowed_token_ids: HashSet<String> = state
        .pending_revocations
        .iter()
        .map(|r| r.token_id.clone())
        .collect();
    if let Some((_, prev_plugin, _)) = &prev_info
        && let Some(tid) = prev_plugin
            .engine
            .as_ref()
            .and_then(|e| e.token_id.as_ref())
    {
        disallowed_token_ids.insert(tid.clone());
    }
    let prev_proof_key = prev_info
        .as_ref()
        .and_then(|(_, p, _)| p.engine.as_ref().and_then(|e| e.proof_key.clone()));

    // Step 6: provision bearer token & proofKey into per-token slot `<instance>.<tokenId>`.
    let mut final_token_id: Option<String> = None;
    let mut final_proof_key: Option<String> = None;
    let mut final_bearer: Option<String> = None;
    let mut used_file_fallback = false;
    let mut replaced_old_token: Option<(String, String, bool)> = None;

    if engine_spec.auth.mode != AuthMode::None {
        // Can we reuse the existing credential on upgrade?
        let reusable = prev_info.as_ref().and_then(|(pm, prev_plugin, _)| {
            let prev_eng_manifest = pm.engine.as_ref()?;
            let prev_eng_state = prev_plugin.engine.as_ref()?;
            if prev_eng_manifest.auth.mode != engine_spec.auth.mode
                || prev_eng_manifest.mount_app != engine_spec.mount_app
            {
                return None;
            }
            let tid = prev_eng_state.token_id.as_ref()?;
            let pk = prev_eng_state.proof_key.as_ref()?;
            let bearer = if prev_eng_state.file_fallback {
                materialize::read_mount_fallback_key(host.data, &engine_spec.mount_app, tid)
                    .or_else(|| read_mounts_bearer(host.data, &engine_spec.mount_app))?
            } else {
                let account = format!("{}.{tid}", engine_spec.mount_app);
                (host.keychain.read)(&kc_service, &account)?
            };
            Some((
                tid.clone(),
                pk.clone(),
                bearer,
                prev_eng_state.file_fallback,
            ))
        });

        if let Some((tid, pk, bearer, was_fallback)) = reusable {
            final_token_id = Some(tid);
            final_proof_key = Some(pk);
            final_bearer = Some(bearer);
            used_file_fallback = was_fallback;
        } else {
            if let Some((pm, prev_plugin, _)) = &prev_info
                && let (Some(pem), Some(pes)) = (&pm.engine, &prev_plugin.engine)
                && let Some(old_tid) = &pes.token_id
            {
                replaced_old_token =
                    Some((pem.mount_app.clone(), old_tid.clone(), pes.file_fallback));
            }
            match pair_and_store(
                host,
                &binary_path,
                engine_spec.auth.mode,
                &engine_spec.mount_app,
                &kc_service,
                allow_file_fallback,
                &disallowed_token_ids,
                prev_proof_key.as_deref(),
            ) {
                Ok(paired) => {
                    rb.new_token_id = Some(paired.token_id.clone());
                    rb.wrote_keychain_slot = !paired.file_fallback;
                    rb.wrote_fallback_key = paired.file_fallback;
                    final_token_id = Some(paired.token_id);
                    final_proof_key = Some(paired.proof_key);
                    final_bearer = Some(paired.token);
                    used_file_fallback = paired.file_fallback;
                }
                Err(err) => {
                    // D166 Linux keyring-less recovery: preserve the staged proposal so the user can
                    // explicitly opt into owner-only file fallback (0600) with the same `proposalId`.
                    let can_retry_fallback = err.code == PLUGIN_KEYCHAIN_UNAVAILABLE
                        && !allow_file_fallback
                        && host.keychain.allows_file_fallback;
                    if can_retry_fallback {
                        rb.restore_staging_dir = Some(pending.staging_dir.clone());
                    }
                    rb.rollback();
                    if can_retry_fallback && pending.staging_dir.is_dir() {
                        store.restore(pending);
                    }
                    return Err(err);
                }
            }
        }
    } else if let Some((pm, prev_plugin, _)) = &prev_info
        && let (Some(pem), Some(pes)) = (&pm.engine, &prev_plugin.engine)
        && let Some(old_tid) = &pes.token_id
    {
        replaced_old_token = Some((pem.mount_app.clone(), old_tid.clone(), pes.file_fallback));
    }

    // Step 7: start pending service (arm rollback BEFORE writing descriptors so partial failure cleans up).
    let svc_spec = ServiceSpec {
        data: host.data,
        custom_data_dir: host.custom_data_dir,
        plugin_id: &plugin_id_str,
        title: &pending.manifest.plugin.title,
        bundle_sha256: &pending.bundle_sha256,
        binary_path: &binary_path,
        port,
        supervisor_exe: host.supervisor_exe,
    };
    rb.pending_service_started = true;
    if let Err(err) = service::start_pending(&svc_spec) {
        rb.rollback();
        return Err(err);
    }

    // Step 8: pre-bearer `/health` proof + authenticated MCP `initialize` probe (10 s).
    let mut probe = poll_engine_health_blocking(
        port,
        final_proof_key.as_deref(),
        final_bearer.as_deref(),
        host.health_timeout,
    );
    // On upgrade with reused token, if the engine returns `401`, pair once into a fresh slot (§7.3 step 6).
    if probe == ProbeOutcome::Unauthorized
        && rb.new_token_id.is_none()
        && engine_spec.auth.mode != AuthMode::None
    {
        if let Some(old_tid) = final_token_id.clone() {
            replaced_old_token = Some((engine_spec.mount_app.clone(), old_tid, used_file_fallback));
        }
        match pair_and_store(
            host,
            &binary_path,
            engine_spec.auth.mode,
            &engine_spec.mount_app,
            &kc_service,
            allow_file_fallback,
            &disallowed_token_ids,
            prev_proof_key.as_deref(),
        ) {
            Ok(paired) => {
                rb.new_token_id = Some(paired.token_id.clone());
                rb.wrote_keychain_slot = !paired.file_fallback;
                rb.wrote_fallback_key = paired.file_fallback;
                final_token_id = Some(paired.token_id);
                final_proof_key = Some(paired.proof_key);
                final_bearer = Some(paired.token);
                used_file_fallback = paired.file_fallback;
                probe = poll_engine_health_blocking(
                    port,
                    final_proof_key.as_deref(),
                    final_bearer.as_deref(),
                    host.health_timeout,
                );
            }
            Err(err) => {
                let can_retry_fallback = err.code == PLUGIN_KEYCHAIN_UNAVAILABLE
                    && !allow_file_fallback
                    && host.keychain.allows_file_fallback;
                if can_retry_fallback {
                    rb.restore_staging_dir = Some(pending.staging_dir.clone());
                }
                rb.rollback();
                if can_retry_fallback && pending.staging_dir.is_dir() {
                    store.restore(pending);
                }
                return Err(err);
            }
        }
    }
    if probe != ProbeOutcome::Ok {
        rb.rollback();
        return Err(probe_error(probe));
    }

    // Step 9: atomic commit & publication (`desktop-state.json` is the single durable commit point).
    // Repoint any existing `pendingRevocations` referencing `old_dir` BEFORE commit so `old_dir`
    // is never deleted while `desktop-state.json` still points inside it.
    let mut next_state = state.clone();
    if let Some(prev) = &prev_record {
        let old_dir = plugin_parent.join(&prev.bundle_sha256);
        for rev in &mut next_state.pending_revocations {
            if rev.plugin_id == plugin_id_str && rev.binary_path.starts_with(&old_dir) {
                rev.binary_path = binary_path.clone();
            }
        }
    }
    next_state.plugins.retain(|p| p.id != plugin_id_str);
    next_state.plugins.push(InstalledPlugin {
        id: plugin_id_str.clone(),
        bundle_sha256: pending.bundle_sha256.clone(),
        engine: Some(EngineState {
            port,
            token_id: final_token_id.clone(),
            proof_key: final_proof_key.clone(),
            file_fallback: used_file_fallback,
        }),
    });
    let mut fallback_overrides = HashMap::new();
    if used_file_fallback && let Some(bearer) = &final_bearer {
        fallback_overrides.insert(engine_spec.mount_app.clone(), bearer.clone());
    }
    let built = match materialize::commit_with_fallbacks(
        host.data,
        &next_state,
        &profile,
        host.shell_build,
        &fallback_overrides,
    ) {
        Ok(b) => b,
        Err(code) => {
            rb.rollback();
            return Err(PluginError::from_code(code));
        }
    };
    rb.committed_new_state = true;

    // Promote pending service and verify the permanent supervisor passes proof + MCP before
    // returning success or deleting the previous bundle directory. Arm `promoted_service` BEFORE
    // calling `promote_pending` so a partial promotion (e.g. Run key written before spawn fails)
    // is cleanly unregistered on rollback.
    rb.promoted_service = true;
    let promoted_restart = match service::promote_pending(&svc_spec) {
        Ok(restarted) => restarted,
        Err(err) => {
            rb.rollback();
            return Err(err);
        }
    };
    if promoted_restart {
        let perm_probe = poll_engine_health_blocking(
            port,
            final_proof_key.as_deref(),
            final_bearer.as_deref(),
            host.health_timeout,
        );
        if perm_probe != ProbeOutcome::Ok {
            rb.rollback();
            return Err(probe_error(perm_probe));
        }
    }
    host.refresh_live(&built.frame_src);

    // Step 10: post-commit cleanup (upgrade only).
    if let Some(prev) = &prev_record {
        let old_dir = plugin_parent.join(&prev.bundle_sha256);
        let still_referenced = next_state
            .pending_revocations
            .iter()
            .any(|r| r.binary_path.starts_with(&old_dir));
        if !still_referenced {
            let _ = std::fs::remove_dir_all(&old_dir);
        }
    }
    if let Some((old_mount_app, old_tid, was_fallback)) = replaced_old_token {
        if was_fallback {
            materialize::delete_mount_fallback_key(host.data, &old_mount_app, &old_tid);
        } else {
            let _ = (host.keychain.delete)(&kc_service, &format!("{old_mount_app}.{old_tid}"));
        }
        if unpair_engine(&binary_path, &old_tid).is_err() {
            next_state.pending_revocations.push(PendingRevocation {
                plugin_id: plugin_id_str.clone(),
                token_id: old_tid,
                binary_path: binary_path.clone(),
                failed_at: utc_timestamp_now(),
            });
            let _ = write_owner_only(
                &host.data.join(desktop_state::FILE),
                &desktop_state::bytes(&next_state),
            );
        }
    }

    Ok(InstalledPluginSummaryV1 {
        id: plugin_id_str,
        title: pending.manifest.plugin.title,
        version: pending.manifest.plugin.version,
        bundle_sha256: pending.bundle_sha256,
        apps: pending.manifest.apps.iter().map(|a| a.id.clone()).collect(),
        engine_port: Some(port),
        token_id: final_token_id,
        has_engine: true,
    })
}

struct StoredPair {
    token: String,
    token_id: String,
    proof_key: String,
    file_fallback: bool,
}

#[allow(clippy::too_many_arguments)]
fn pair_and_store(
    host: &PluginHost<'_>,
    binary_path: &Path,
    auth_mode: AuthMode,
    mount_app: &str,
    kc_service: &str,
    allow_file_fallback: bool,
    disallowed_token_ids: &HashSet<String>,
    expected_proof_key: Option<&str>,
) -> Result<StoredPair, PluginError> {
    let paired = pair_engine(binary_path, auth_mode)?;
    if disallowed_token_ids.contains(&paired.token_id) {
        // Never call `unpair_engine` on an active or pending token ID!
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    if let Some(expected_pk) = expected_proof_key
        && paired.proof_key != expected_pk
    {
        let _ = unpair_engine(binary_path, &paired.token_id);
        return Err(PluginError::from_code(PLUGIN_PAIR_FAILED));
    }
    if cfg!(windows) && keychain::exceeds_windows_blob_limit(&paired.token) {
        let _ = unpair_engine(binary_path, &paired.token_id);
        return Err(PluginError::from_code(PLUGIN_KEY_TOO_LONG));
    }
    let account = format!("{mount_app}.{}", paired.token_id);
    match (host.keychain.write)(kc_service, &account, &paired.token) {
        Ok(()) => Ok(StoredPair {
            token: paired.token,
            token_id: paired.token_id,
            proof_key: paired.proof_key,
            file_fallback: false,
        }),
        Err(KeychainError::TooLong) => {
            let _ = unpair_engine(binary_path, &paired.token_id);
            Err(PluginError::from_code(PLUGIN_KEY_TOO_LONG))
        }
        Err(KeychainError::Unavailable)
            if allow_file_fallback && host.keychain.allows_file_fallback =>
        {
            if materialize::write_mount_fallback_key(
                host.data,
                mount_app,
                &paired.token_id,
                &paired.token,
            )
            .is_err()
            {
                let _ = unpair_engine(binary_path, &paired.token_id);
                return Err(PluginError::from_code(DESKTOP_MATERIALIZE_FAILED));
            }
            Ok(StoredPair {
                token: paired.token,
                token_id: paired.token_id,
                proof_key: paired.proof_key,
                file_fallback: true,
            })
        }
        Err(_) => {
            let _ = unpair_engine(binary_path, &paired.token_id);
            Err(PluginError::from_code(PLUGIN_KEYCHAIN_UNAVAILABLE))
        }
    }
}

pub(crate) fn read_mounts_bearer(data: &Path, instance: &str) -> Option<String> {
    let bytes = crate::mounts::read_owner_only(&data.join("mounts.json"), 1024 * 1024).ok()?;
    let val: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    val.get("mounts")?.as_array()?.iter().find_map(|entry| {
        if entry.get("instance")?.as_str()? == instance {
            entry.get("bearer")?.as_str().map(str::to_owned)
        } else {
            None
        }
    })
}
