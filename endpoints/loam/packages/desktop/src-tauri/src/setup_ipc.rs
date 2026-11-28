//! Trusted setup IPC commands (`setup_open` on `main`, plus the 13 `setup_*` commands exclusively
//! on `host-setup`; phase 5 no-terminal amendment, sections 3.2, 3.3, 7, 8 & 9.2).
use crate::desktop_state::{self, Mode};
use crate::keychain;
use crate::materialize;
use crate::models::Models;
use crate::mounts::Mounts;
use crate::plugins::{
    self, InstalledPluginSummaryV1, LiveHost, PendingRevocationSummaryV1, PluginHost,
    PluginInstallProposalV1, RotateTokenResult, ServiceAction, ServiceActionResult,
    UninstallResult,
};
use crate::plugins_error::PLUGIN_NOT_FOUND;
use crate::setup_error::{SETUP_INPUT_INVALID, SetupError};
use crate::setup_models::{
    self, ModelHost, ModelLiveHost, ModelProviderSummaryV1, ModelRemoveInput, ModelRemoveResult,
    ModelSaveInput, ModelSaveResult, ModelSetDefaultInput, ModelSetDefaultResult,
};
use crate::setup_window::{
    BundledPluginSummaryV1, SetupSection, SetupState, emit_to_host_setup, from_host_setup,
    open_or_focus_host_setup,
};
use crate::{DataDirectory, InboundState, MAIN, SiteState, from_shell, start_inbound};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::ipc::InvokeBody;
use tauri::{AppHandle, Manager, Runtime, State};

/// Strictly parses `request.body()` into `T` so `#[serde(deny_unknown_fields)]` is enforced on the
/// raw IPC JSON object (Tauri's default command extractor ignores unknown keys).
fn parse_strict_body<T: DeserializeOwned>(
    request: &tauri::ipc::Request<'_>,
) -> Result<T, SetupError> {
    match request.body() {
        InvokeBody::Json(value) => {
            let normalized = if value.is_null() {
                Value::Object(serde_json::Map::new())
            } else {
                value.clone()
            };
            serde_json::from_value::<T>(normalized)
                .map_err(|_| SetupError::from_code(SETUP_INPUT_INVALID))
        }
        InvokeBody::Raw(bytes) => serde_json::from_slice::<T>(bytes)
            .map_err(|_| SetupError::from_code(SETUP_INPUT_INVALID)),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyArgs {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetupOpenArgs {
    section: SetupSection,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PluginPickArgs {
    kind: PickKind,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PickKind {
    File,
    Folder,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InspectBundledArgs {
    id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CancelProposalArgs {
    proposal_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ConfirmProposalArgs {
    proposal_id: String,
    expected_bundle_sha256: String,
    #[serde(default)]
    allow_file_fallback: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PluginIdArgs {
    plugin_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RetryRevocationArgs {
    token_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ServiceActionArgs {
    plugin_id: String,
    action: ServiceActionArg,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ServiceActionArg {
    Start,
    Stop,
    Restart,
    Status,
}

impl From<ServiceActionArg> for ServiceAction {
    fn from(value: ServiceActionArg) -> Self {
        match value {
            ServiceActionArg::Start => ServiceAction::Start,
            ServiceActionArg::Stop => ServiceAction::Stop,
            ServiceActionArg::Restart => ServiceAction::Restart,
            ServiceActionArg::Status => ServiceAction::Status,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSummary {
    id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStateResponse {
    mode: &'static str,
    workspace: WorkspaceSummary,
    platform: &'static str,
    os_service_mechanism: &'static str,
    allows_file_fallback: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    failed_closed_code: Option<&'static str>,
    plugins: Vec<InstalledPluginSummaryV1>,
    pending_revocations: Vec<PendingRevocationSummaryV1>,
    bundled: Vec<BundledPluginSummaryV1>,
    models: Vec<ModelProviderSummaryV1>,
    reload_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending_proposal: Option<PluginInstallProposalV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending_open_error: Option<SetupError>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum PickResponse {
    Cancelled {
        cancelled: bool,
    },
    Picked {
        cancelled: bool,
        proposal: Box<PluginInstallProposalV1>,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalResponse {
    proposal: PluginInstallProposalV1,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmResponse {
    installed: InstalledPluginSummaryV1,
    reload_required: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReloadResponse {
    action: &'static str,
}

fn bundled_plugins_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Some(override_dir) = std::env::var_os("LOAM_BUNDLED_PLUGINS_DIR") {
        return Some(PathBuf::from(override_dir));
    }
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join("bundled-plugins"))
}

fn ensure_inbound_started<R: Runtime>(app: &AppHandle<R>, data: &Path) {
    if let Some(inbound) = app.try_state::<InboundState>() {
        let mut guard = inbound.0.lock().expect("inbound state");
        if guard.is_none() {
            *guard = start_inbound(app, data);
        }
    }
}

fn build_plugin_host<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    data: &'a Path,
    custom_dir: Option<&'a Path>,
    setup: &'a Arc<SetupState>,
    site: &'a SiteState,
    mounts: &'a Arc<Mounts>,
) -> PluginHost<'a> {
    let mut host = PluginHost::new(data, custom_dir, materialize::SHELL_BUILD_ID);
    let app_clone = app.clone();
    let data_owned = data.to_path_buf();
    host.live = Some(LiveHost {
        site,
        mounts,
        bundled_factory: setup.bundled_factory.clone(),
        on_inbound_enabled: Some(Arc::new(move || {
            ensure_inbound_started(&app_clone, &data_owned);
        })),
    });
    host
}

fn build_model_host<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    data: &'a Path,
    custom_dir: Option<&'a Path>,
    setup: &'a Arc<SetupState>,
    site: &'a SiteState,
    models: &'a Arc<Models>,
) -> ModelHost<'a> {
    let mut host = ModelHost::new(data, custom_dir, materialize::SHELL_BUILD_ID);
    let app_clone = app.clone();
    let data_owned = data.to_path_buf();
    host.live = Some(ModelLiveHost {
        site,
        models,
        bundled_factory: setup.bundled_factory.clone(),
        on_inbound_enabled: Some(Arc::new(move || {
            ensure_inbound_started(&app_clone, &data_owned);
        })),
    });
    host
}

/// Opens or focuses `host-setup` from `main` (§3.2): strictly guarded by `from_shell` (bare
/// `DESKTOP_ORIGIN_REFUSED`), `#[serde(deny_unknown_fields)]`, closed `{ section: "models" | "plugins" }`,
/// and debounced to at most once per 2 seconds.
#[tauri::command]
pub async fn setup_open<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<(), String> {
    from_shell(&webview, &request)?;
    let args: SetupOpenArgs = parse_strict_body(&request).map_err(|e| e.code.to_owned())?;
    if !setup.try_acquire_open_debounce(Instant::now()) {
        return Ok(());
    }
    open_or_focus_host_setup(&app, args.section).map_err(|_| materialize::FAILED.to_owned())?;
    Ok(())
}

struct InspectFlightGuard(Arc<SetupState>);
impl Drop for InspectFlightGuard {
    fn drop(&mut self) {
        self.0.end_inspect();
    }
}

/// Handles an OS-level `.loam-plugin` open (launch arg, single-instance callback, or macOS
/// `RunEvent::Opened`) by opening/focusing `host-setup` off the event handler and running Phase 1
/// Inspect bound to the opening window generation (§3.2).
pub fn handle_os_plugin_open<R: Runtime>(app: &AppHandle<R>, path: PathBuf) {
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let setup = app_clone.state::<Arc<SetupState>>().inner().clone();
        if open_or_focus_host_setup(&app_clone, SetupSection::Plugins).is_err() {
            return;
        }
        let window_gen = setup.host_setup_generation();
        if !setup.try_begin_inspect() {
            emit_to_host_setup(&app_clone, "loam:setup-proposal", &json!({ "busy": true }));
            return;
        }
        let _flight = InspectFlightGuard(setup.clone());
        let Some(data_dir) = app_clone.try_state::<DataDirectory>() else {
            return;
        };
        let custom_dir = keychain::custom_data_dir();
        let host = PluginHost::new(
            &data_dir.0,
            custom_dir.as_deref(),
            materialize::SHELL_BUILD_ID,
        );
        match plugins::inspect(&host, &path, &setup.pending) {
            Ok(proposal) => {
                // If `host-setup` closed while staging, cancel immediately so nothing leaks.
                if setup.host_setup_generation() != window_gen
                    || app_clone
                        .get_webview_window(crate::setup_window::HOST_SETUP)
                        .is_none()
                {
                    let _ = plugins::cancel(&proposal.proposal_id, &setup.pending);
                    return;
                }
                setup.set_pending_open_error(None);
                setup.set_pending_proposal(Some(proposal.clone()));
                emit_to_host_setup(
                    &app_clone,
                    "loam:setup-proposal",
                    &json!({ "proposal": proposal }),
                );
            }
            Err(err) => {
                if setup.host_setup_generation() != window_gen
                    || app_clone
                        .get_webview_window(crate::setup_window::HOST_SETUP)
                        .is_none()
                {
                    return;
                }
                let se = SetupError::from(err);
                setup.set_pending_open_error(Some(se.clone()));
                emit_to_host_setup(&app_clone, "loam:setup-proposal", &json!({ "error": se }));
            }
        }
    });
}

/// 1/13: `setup_state_get` (§3.3).
#[tauri::command]
pub async fn setup_state_get<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<SetupStateResponse, SetupError> {
    from_host_setup(&webview, &request)?;
    let _args: EmptyArgs = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let bundled_dir = bundled_plugins_dir(&app);
    let setup_arc = setup.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let mode_res = desktop_state::mode(&data);
        let live_failed_closed = mode_res.as_ref().err().copied();
        let (mode_str, workspace, plugins_list, revocations) = match mode_res {
            Ok(Mode::Cli) => (
                "cli",
                WorkspaceSummary {
                    id: "cli".into(),
                    name: "CLI Deployment".into(),
                },
                Vec::new(),
                Vec::new(),
            ),
            Ok(Mode::Managed(state_opt)) => {
                let ws = state_opt
                    .as_ref()
                    .map(|s| WorkspaceSummary {
                        id: s.workspace.id.clone(),
                        name: s.workspace.name.clone(),
                    })
                    .unwrap_or_else(|| WorkspaceSummary {
                        id: "personal".into(),
                        name: "Personal".into(),
                    });
                let host =
                    PluginHost::new(&data, custom_dir.as_deref(), materialize::SHELL_BUILD_ID);
                let (plugins_list, revocations) =
                    plugins::list_installed(&host).unwrap_or_default();
                ("managed", ws, plugins_list, revocations)
            }
            Err(_) => (
                "managed",
                WorkspaceSummary {
                    id: "personal".into(),
                    name: "Personal".into(),
                },
                Vec::new(),
                Vec::new(),
            ),
        };
        let model_host = ModelHost::new(&data, custom_dir.as_deref(), materialize::SHELL_BUILD_ID);
        let models = setup_models::list_models(&model_host).unwrap_or_default();
        let bundled = setup_arc
            .bundled_plugins(bundled_dir.as_deref())
            .into_iter()
            .map(|e| e.summary)
            .collect();
        Ok(SetupStateResponse {
            mode: mode_str,
            workspace,
            platform: if cfg!(target_os = "macos") {
                "macos"
            } else if cfg!(windows) {
                "windows"
            } else {
                "linux"
            },
            os_service_mechanism: crate::service::active_service_mechanism(),
            allows_file_fallback: cfg!(all(unix, not(target_os = "macos"))),
            failed_closed_code: live_failed_closed.or(setup_arc.startup_failed_closed),
            plugins: plugins_list,
            pending_revocations: revocations,
            bundled,
            models,
            reload_pending: setup_arc.reload_pending.load(Ordering::SeqCst),
            pending_proposal: setup_arc.current_pending_proposal(),
            pending_open_error: setup_arc.take_pending_open_error(),
        })
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

async fn pick_native_path<R: Runtime>(app: &AppHandle<R>, kind: PickKind) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let dispatch = app.run_on_main_thread(move || {
            let dialog = rfd::FileDialog::new();
            let chosen = match kind {
                PickKind::File => dialog
                    .add_filter("Loam Plugin", &["loam-plugin"])
                    .pick_file(),
                PickKind::Folder => dialog.pick_folder(),
            };
            let _ = tx.send(chosen);
        });
        if dispatch.is_err() {
            return None;
        }
        rx.await.ok().flatten()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(move || {
            let dialog = rfd::FileDialog::new();
            match kind {
                PickKind::File => dialog
                    .add_filter("Loam Plugin", &["loam-plugin"])
                    .pick_file(),
                PickKind::Folder => dialog.pick_folder(),
            }
        })
        .await
        .ok()
        .flatten()
    }
}

/// 2/13: `setup_plugin_pick` (§3.3).
#[tauri::command]
pub async fn setup_plugin_pick<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<PickResponse, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: PluginPickArgs = parse_strict_body(&request)?;
    let window_gen = setup.host_setup_generation();
    if !setup.try_begin_inspect() {
        return Err(SetupError::from_code(materialize::FAILED));
    }
    let _flight = InspectFlightGuard(setup.inner().clone());
    let Some(picked) = pick_native_path(&app, args.kind).await else {
        return Ok(PickResponse::Cancelled { cancelled: true });
    };
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    let proposal = tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let host = PluginHost::new(&data, custom_dir.as_deref(), materialize::SHELL_BUILD_ID);
        let proposal = plugins::inspect(&host, &picked, &setup_arc.pending)?;
        if setup_arc.host_setup_generation() != window_gen
            || app_clone
                .get_webview_window(crate::setup_window::HOST_SETUP)
                .is_none()
        {
            let _ = plugins::cancel(&proposal.proposal_id, &setup_arc.pending);
            return Err(SetupError::from_code(
                crate::plugins_error::PLUGIN_PROPOSAL_EXPIRED,
            ));
        }
        setup_arc.set_pending_proposal(Some(proposal.clone()));
        Ok::<_, SetupError>(proposal)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))??;
    Ok(PickResponse::Picked {
        cancelled: false,
        proposal: Box::new(proposal),
    })
}

/// 3/13: `setup_plugin_inspect_bundled` (§3.3).
#[tauri::command]
pub async fn setup_plugin_inspect_bundled<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ProposalResponse, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: InspectBundledArgs = parse_strict_body(&request)?;
    let window_gen = setup.host_setup_generation();
    if !setup.try_begin_inspect() {
        return Err(SetupError::from_code(materialize::FAILED));
    }
    let _flight = InspectFlightGuard(setup.inner().clone());
    let bundled_dir = bundled_plugins_dir(&app);
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    let proposal = tauri::async_runtime::spawn_blocking(move || {
        let entry = setup_arc
            .bundled_plugins(bundled_dir.as_deref())
            .into_iter()
            .find(|e| e.summary.id == args.id)
            .ok_or_else(|| SetupError::from_code(PLUGIN_NOT_FOUND))?;
        let custom_dir = keychain::custom_data_dir();
        let host = PluginHost::new(&data, custom_dir.as_deref(), materialize::SHELL_BUILD_ID);
        let proposal = plugins::inspect(&host, &entry.path, &setup_arc.pending)?;
        if setup_arc.host_setup_generation() != window_gen
            || app_clone
                .get_webview_window(crate::setup_window::HOST_SETUP)
                .is_none()
        {
            let _ = plugins::cancel(&proposal.proposal_id, &setup_arc.pending);
            return Err(SetupError::from_code(
                crate::plugins_error::PLUGIN_PROPOSAL_EXPIRED,
            ));
        }
        setup_arc.set_pending_proposal(Some(proposal.clone()));
        Ok::<_, SetupError>(proposal)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))??;
    Ok(ProposalResponse { proposal })
}

/// 4/13: `setup_plugin_cancel` (§3.3).
#[tauri::command]
pub async fn setup_plugin_cancel<R: Runtime>(
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<Value, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: CancelProposalArgs = parse_strict_body(&request)?;
    let setup_arc = setup.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        plugins::cancel(&args.proposal_id, &setup_arc.pending)?;
        setup_arc.set_pending_proposal(None);
        Ok::<_, SetupError>(())
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))??;
    Ok(json!({ "ok": true }))
}

/// 5/13: `setup_plugin_confirm` (§3.3).
#[tauri::command]
pub async fn setup_plugin_confirm<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ConfirmResponse, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: ConfirmProposalArgs = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    let installed = tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let mounts = app_clone.state::<Arc<Mounts>>();
        let host = build_plugin_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            mounts.inner(),
        );
        let installed = plugins::confirm(
            &host,
            &args.proposal_id,
            &args.expected_bundle_sha256,
            args.allow_file_fallback,
            &setup_arc.pending,
        )?;
        setup_arc.set_pending_proposal(None);
        setup_arc.reload_pending.store(true, Ordering::SeqCst);
        Ok::<_, SetupError>(installed)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))??;
    Ok(ConfirmResponse {
        installed,
        reload_required: true,
    })
}

/// 6/13: `setup_plugin_uninstall` (§3.3).
#[tauri::command]
pub async fn setup_plugin_uninstall<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<UninstallResult, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: PluginIdArgs = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let mounts = app_clone.state::<Arc<Mounts>>();
        let host = build_plugin_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            mounts.inner(),
        );
        let res = plugins::uninstall(&host, &args.plugin_id)?;
        if res.reload_required {
            setup_arc.reload_pending.store(true, Ordering::SeqCst);
        }
        Ok::<_, SetupError>(res)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

/// 7/13: `setup_plugin_retry_revocation` (§3.3).
#[tauri::command]
pub async fn setup_plugin_retry_revocation<R: Runtime>(
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
) -> Result<Value, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: RetryRevocationArgs = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let host = PluginHost::new(&data, custom_dir.as_deref(), materialize::SHELL_BUILD_ID);
        plugins::retry_revocation(&host, &args.token_id)?;
        Ok::<_, SetupError>(json!({ "revoked": true }))
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

/// 8/13: `setup_plugin_rotate_token` (§3.3).
#[tauri::command]
pub async fn setup_plugin_rotate_token<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<RotateTokenResult, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: PluginIdArgs = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let mounts = app_clone.state::<Arc<Mounts>>();
        let host = build_plugin_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            mounts.inner(),
        );
        Ok::<_, SetupError>(plugins::rotate_token(&host, &args.plugin_id)?)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

/// 9/13: `setup_plugin_service_action` (§3.3).
#[tauri::command]
pub async fn setup_plugin_service_action<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ServiceActionResult, SetupError> {
    from_host_setup(&webview, &request)?;
    let args: ServiceActionArgs = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let mounts = app_clone.state::<Arc<Mounts>>();
        let host = build_plugin_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            mounts.inner(),
        );
        Ok::<_, SetupError>(plugins::service_action(
            &host,
            &args.plugin_id,
            args.action.into(),
        )?)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

/// 10/13: `setup_model_save` (§3.3 & §8.1–8.2).
/// Runs blocking state/keychain reads in `spawn_blocking` (Phase 1), async network verification
/// unlocked on Tokio (Phase 2), and `StateLock` + keychain write + materialization in
/// `spawn_blocking` (Phase 3) so Tokio workers never block and `StateLock` is never held across
/// network I/O.
#[tauri::command]
pub async fn setup_model_save<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ModelSaveResult, SetupError> {
    from_host_setup(&webview, &request)?;
    let input: ModelSaveInput = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();

    let prepared = tauri::async_runtime::spawn_blocking({
        let data = data.clone();
        let setup_arc = setup_arc.clone();
        let app_clone = app_clone.clone();
        move || {
            let custom_dir = keychain::custom_data_dir();
            let site = app_clone.state::<SiteState>();
            let models = app_clone.state::<Arc<Models>>();
            let host = build_model_host(
                &app_clone,
                &data,
                custom_dir.as_deref(),
                &setup_arc,
                site.inner(),
                models.inner(),
            );
            setup_models::prepare_model_save(&host, input)
        }
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))??;

    let verify_urls = setup_models::VerifyUrls::default();
    let verified = setup_models::verify_prepared_model(&prepared, &verify_urls).await?;

    let res = tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let models = app_clone.state::<Arc<Models>>();
        let host = build_model_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            models.inner(),
        );
        let res = setup_models::commit_model_save(&host, prepared, verified)?;
        if res.reload_required {
            setup_arc.reload_pending.store(true, Ordering::SeqCst);
        }
        Ok::<_, SetupError>(res)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))??;
    Ok(res)
}

/// 11/13: `setup_model_remove` (§3.3 & §8.1–8.2).
#[tauri::command]
pub async fn setup_model_remove<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ModelRemoveResult, SetupError> {
    from_host_setup(&webview, &request)?;
    let input: ModelRemoveInput = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let models = app_clone.state::<Arc<Models>>();
        let host = build_model_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            models.inner(),
        );
        let res = setup_models::remove_model(&host, &input)?;
        if res.reload_required {
            setup_arc.reload_pending.store(true, Ordering::SeqCst);
        }
        Ok::<_, SetupError>(res)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

/// 12/13: `setup_model_set_default` (§3.3 & §8.1).
#[tauri::command]
pub async fn setup_model_set_default<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    data_dir: State<'_, DataDirectory>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ModelSetDefaultResult, SetupError> {
    from_host_setup(&webview, &request)?;
    let input: ModelSetDefaultInput = parse_strict_body(&request)?;
    let data = data_dir.0.clone();
    let setup_arc = setup.inner().clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let custom_dir = keychain::custom_data_dir();
        let site = app_clone.state::<SiteState>();
        let models = app_clone.state::<Arc<Models>>();
        let host = build_model_host(
            &app_clone,
            &data,
            custom_dir.as_deref(),
            &setup_arc,
            site.inner(),
            models.inner(),
        );
        let res = setup_models::set_default_model(&host, &input)?;
        if res.reload_required {
            setup_arc.reload_pending.store(true, Ordering::SeqCst);
        }
        Ok::<_, SetupError>(res)
    })
    .await
    .map_err(|_| SetupError::from_code(materialize::FAILED))?
}

/// Fixed statement evaluated in `main` for `setup_apply_reload` (§9.2 step 6).
pub fn request_reload_script() -> &'static str {
    "document.querySelector('loam-shell')?.requestReload?.()"
}

struct ReloadFlightGuard(Arc<SetupState>);
impl Drop for ReloadFlightGuard {
    fn drop(&mut self) {
        self.0.main_reload_in_flight.store(false, Ordering::SeqCst);
    }
}

/// 13/13: `setup_apply_reload` (§3.3 & §9.2 step 6).
#[tauri::command]
pub async fn setup_apply_reload<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    setup: State<'_, Arc<SetupState>>,
) -> Result<ApplyReloadResponse, SetupError> {
    from_host_setup(&webview, &request)?;
    let _args: EmptyArgs = parse_strict_body(&request)?;
    let Some(main_window) = app.get_webview_window(MAIN) else {
        return Ok(ApplyReloadResponse { action: "busy" });
    };
    if setup.main_loading.load(Ordering::SeqCst) {
        return Ok(ApplyReloadResponse { action: "busy" });
    }
    if setup
        .main_reload_in_flight
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(ApplyReloadResponse { action: "busy" });
    }
    let _guard = ReloadFlightGuard(setup.inner().clone());
    let before_gen = setup.main_page_generation.load(Ordering::SeqCst);
    let notified = setup.main_load_notify.notified();
    if main_window.eval(request_reload_script()).is_err() {
        return Ok(ApplyReloadResponse { action: "busy" });
    }
    let _ = tokio::time::timeout(Duration::from_millis(2000), notified).await;
    if setup.main_page_generation.load(Ordering::SeqCst) != before_gen {
        setup.reload_pending.store(false, Ordering::SeqCst);
        Ok(ApplyReloadResponse { action: "reloaded" })
    } else {
        let _ = main_window.unminimize();
        let _ = main_window.show();
        let _ = main_window.set_focus();
        Ok(ApplyReloadResponse { action: "prompted" })
    }
}
