//! Loam's desktop host (phase 6 specification, section 10): the same `web` build in Tauri 2's webview, as a
//! personal shell. The Rust side serves the site over two custom protocols, keeps one window, builds the
//! menus, and carries mounted instances' messages over three commands, the copilot's model requests over two more
//! (phase 5 specification, 4.2), and the kernel's answers to the inbound endpoint over a sixth (10.8), the only IPC
//! the webview is granted. `loam-desktop mcp` is the stdio bridge to that endpoint (`bridge`).
pub mod bridge;
pub mod connection;
pub mod desktop_state;
pub mod engine_run;
pub mod era;
pub mod inbound;
pub mod js_json;
pub mod keychain;
pub mod logging;
pub mod materialize;
pub mod models;
pub mod mounts;
pub mod notify;
pub mod plugin_archive;
pub mod plugin_manifest;
pub mod plugin_schema;
pub mod plugin_validate;
pub mod plugins;
pub mod plugins_cli;
pub mod plugins_engine;
pub mod plugins_error;
pub mod plugins_ops;
pub mod service;
pub mod site;
pub mod updater;

use models::{Emit, Models};
use mounts::{Mounts, Notify};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{
    AppHandle, Manager, RunEvent, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// The one webview the capability file names.
pub const MAIN: &str = "main";

/// Tests and a deployer's second profile point the app at another data directory; nothing in the webview
/// can set it.
pub(crate) const DATA_DIRECTORY: &str = "LOAM_DESKTOP_DATA_DIR";

/// The served site behind an `RwLock` so managed-mode updates swap `Site` (including `frame-src`)
/// without restarting the host or re-registering protocols (phase 5 no-terminal amendment, 9.2).
pub struct SiteState(std::sync::RwLock<Arc<site::Site>>);

impl SiteState {
    pub fn new(site: site::Site) -> Self {
        Self(std::sync::RwLock::new(Arc::new(site)))
    }

    pub fn current(&self) -> Arc<site::Site> {
        self.0
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn swap(&self, site: site::Site) {
        *self
            .0
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Arc::new(site);
    }
}

/// Mode resolved at startup (phase 5 no-terminal amendment, 9.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupMode {
    /// Host-managed deployment: signed shell from `EmbeddedAssets`, `deployment.json` + `apps/*`
    /// from `<app data>/site/` (or fresh empty bundled shell before the first commit).
    Managed,
    /// Developer-managed deployment (`loam deployment write --host desktop`): `<app data>/site/`,
    /// `mounts.json`, and `models.json` served untouched.
    Cli,
    /// Managed mode failed closed (`DESKTOP_STATE_PERMISSIONS`, `DESKTOP_STATE_INVALID`, or
    /// `DESKTOP_MATERIALIZE_FAILED`): no plugins, mounts, models, or inbound endpoint served.
    FailedClosed(&'static str),
}

/// Prepared startup state before opening the `main` window.
pub struct StartupResult {
    pub mode: StartupMode,
    pub site: site::Site,
    pub mounts: Result<Vec<mounts::Access>, &'static str>,
    pub models: Result<Vec<models::Provider>, &'static str>,
    pub inbound: bool,
    /// True when managed-mode startup reconciled one or more generated artifacts against
    /// committed `desktop-state.json`.
    pub reconciled: bool,
}

fn cli_startup(data: &std::path::Path, bundled: site::Lookup) -> StartupResult {
    let site = site::Site::choose(&data.join("site"), bundled);
    let deployed = mounts::read_deployed(&data.join("mounts.json"));
    if let Err(code) = &deployed {
        eprintln!("loam-desktop: mounts.json refused ({code}); no instance is mounted");
    }
    let inbound = deployed.as_ref().is_ok_and(|deployed| deployed.inbound);
    let providers = models::read(&data.join("models.json"));
    if let Err(code) = &providers {
        eprintln!("loam-desktop: models.json refused ({code}); no model provider is configured");
    }
    StartupResult {
        mode: StartupMode::Cli,
        site,
        mounts: deployed.map(|deployed| deployed.mounts),
        models: providers,
        inbound,
        reconciled: false,
    }
}

fn fail_closed_startup(code: &'static str, bundled: site::Lookup) -> StartupResult {
    eprintln!(
        "loam-desktop: desktop-state startup refused ({code}); failing closed with no plugins or providers"
    );
    StartupResult {
        mode: StartupMode::FailedClosed(code),
        site: site::Site::Bundled(bundled),
        mounts: Err(code),
        models: Err(code),
        inbound: false,
        reconciled: false,
    }
}

/// Resolves `managed` vs `cli` mode at startup, acquires `<app data>/desktop-state.lock` around
/// managed-mode orphan sweeping and reconciliation against committed `desktop-state.json`, and
/// fails closed on permission or validation errors before `main` opens (amendment 9.1 & 9.2).
pub fn startup_prepare(
    data: &std::path::Path,
    profile: &materialize::Profile,
    shell_build: &str,
    bundled: site::Lookup,
) -> StartupResult {
    // Fast pre-check for `cli` mode so developer deployments are left completely untouched
    // (no `desktop-state.lock` created and no files swept). Uses `symlink_metadata` so a dangling
    // symlink at `desktop-state.json` is NOT treated as absent and fails closed below.
    let state_path = data.join(desktop_state::FILE);
    let state_absent = matches!(
        std::fs::symlink_metadata(&state_path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    );
    if state_absent && data.join("site").join("index.html").is_file() {
        return cli_startup(data, bundled);
    }

    // Refuse a non-owner-only `desktop-state.json` immediately before touching disk (even if `data`
    // is read-only).
    if matches!(desktop_state::read(data), Err(desktop_state::PERMISSIONS)) {
        return fail_closed_startup(desktop_state::PERMISSIONS, bundled);
    }

    let _lock = match desktop_state::StateLock::acquire(data) {
        Ok(lock) => lock,
        Err(code) => return fail_closed_startup(code, bundled),
    };

    match desktop_state::mode(data) {
        Ok(desktop_state::Mode::Cli) => {
            drop(_lock);
            cli_startup(data, bundled)
        }
        Err(code) => fail_closed_startup(code, bundled),
        Ok(desktop_state::Mode::Managed(None)) => {
            if let Err(code) = desktop_state::sweep_orphans(data) {
                return fail_closed_startup(code, bundled);
            }
            StartupResult {
                mode: StartupMode::Managed,
                site: site::Site::Bundled(bundled),
                mounts: Ok(Vec::new()),
                models: Ok(Vec::new()),
                inbound: false,
                reconciled: false,
            }
        }
        Ok(desktop_state::Mode::Managed(Some(mut state))) => {
            if let Err(code) = desktop_state::sweep_orphans(data) {
                return fail_closed_startup(code, bundled);
            }
            // Retry any pending token revocations automatically on startup (amendment 7.4)
            // and rotate plugin stderr logs / refresh Windows HKCU Run paths (6.1 & 6.2).
            let custom_dir = keychain::custom_data_dir();
            if !state.pending_revocations.is_empty() {
                plugins::retry_pending_revocations_under_lock(data, &mut state);
            }
            service::reconcile_startup_services(data, &state, custom_dir.as_deref());
            let (built, reconciled) =
                match materialize::reconcile(data, &state, profile, shell_build) {
                    Ok(outcome) => outcome,
                    Err(code) => return fail_closed_startup(code, bundled),
                };
            let site = match site::Site::try_managed(&data.join("site"), bundled, built.frame_src) {
                Ok(site) => site,
                Err(bundled) => return fail_closed_startup(materialize::FAILED, bundled),
            };
            let deployed = mounts::read_deployed(&data.join("mounts.json"));
            if let Err(code) = &deployed {
                eprintln!("loam-desktop: mounts.json refused ({code}); no instance is mounted");
            }
            let inbound = deployed.as_ref().is_ok_and(|deployed| deployed.inbound);
            let providers = models::read(&data.join("models.json"));
            if let Err(code) = &providers {
                eprintln!(
                    "loam-desktop: models.json refused ({code}); no model provider is configured"
                );
            }
            StartupResult {
                mode: StartupMode::Managed,
                site,
                mounts: deployed.map(|deployed| deployed.mounts),
                models: providers,
                inbound,
                reconciled,
            }
        }
    }
}

fn data_directory<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    std::env::var_os(DATA_DIRECTORY)
        .map(PathBuf::from)
        .or_else(|| app.path().app_data_dir().ok())
        .expect("an app data directory")
}

/// A command's refusal of a caller that is not the shell (phase 6 specification, 10.2, as amended by the
/// coordinator on 2026-11-16): a bare code, as every refusal over IPC is.
pub const ORIGIN_REFUSED: &str = "DESKTOP_ORIGIN_REFUSED";

/// Who may call: the main webview, by its label, as the capability file says; and, as extra defence, only a
/// request whose `Origin` is the shell's. Tauri counts every registered custom scheme as a local origin, the
/// sandbox's included, and on WebView2 its IPC script is in every frame, so neither the capability nor the
/// label tells the proxy frame from the shell. On the IPC fetch the browser sets `Origin`, which a page cannot
/// forge, and Tauri's own ACL reads the same header. On Tauri's message fallback the headers are the caller's,
/// so there this check proves nothing. That path is guarded per engine, as P6-D4 measures with a forged
/// `Origin`: on WebView2 wry hears only the top-level document's messages, though every frame has Tauri's IPC
/// script and its invoke key; on WebKitGTK and macOS WKWebView a frame can post to wry's `ipc` handler, but Tauri
/// gives its script and key to the main frame alone, so the key check drops it. Each engine so has one barrier:
/// on WebView2 a frame can read the key from its own IPC fetch's headers. A missing `Origin` is refused; the shell's fetch is allowed by its policy, so it does not fall back, but after a
/// failed fetch Tauri keeps using the fallback for the page's life, and the shell's calls are refused until a
/// reload.
fn from_shell<R: Runtime>(
    webview: &tauri::Webview<R>,
    request: &tauri::ipc::Request<'_>,
) -> Result<(), String> {
    if webview.label() != MAIN {
        return Err(mounts::UNREACHABLE.into());
    }
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|value| value.to_str().ok());
    if origin == Some(site::shell_origin()) {
        Ok(())
    } else {
        Err(ORIGIN_REFUSED.into())
    }
}

/// Where a server's notification goes: one fixed statement in the main webview (`notify`).
fn notifier<R: Runtime>(app: AppHandle<R>) -> Notify {
    Arc::new(
        move |handle, message: Value| match notify::script(handle, &message) {
            Some(script) => {
                if let Some(window) = app.get_webview_window(MAIN) {
                    let _ = window.eval(script);
                }
            }
            // The message's words stay out of the log: a server chose them.
            None => eprintln!(
                "loam-desktop: dropped a notification from mount handle {handle}: over 1 MiB"
            ),
        },
    )
}

/// Where a model stream's events go: one fixed statement per event in the main webview (`models::event_script`).
fn emitter<R: Runtime>(app: AppHandle<R>) -> Emit {
    Arc::new(move |detail: Value| {
        if let Some(window) = app.get_webview_window(MAIN) {
            let _ = window.eval(models::event_script(&detail));
        }
    })
}

/// The six commands, and no other (10.4, phase 5's 4.2 and 10.8): what the app registers, and what P6-D4's IPC test
/// drives.
pub fn handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        mount_open,
        mount_send,
        mount_close,
        model_send,
        model_cancel,
        inbound_reply
    ]
}

/// The inbound endpoint while it serves (10.8): its state, and the switch that stops its listener. `None` when the
/// deployer turned it off, `mounts.json` was missing or refused, or `inbound.json` could not be made owner-only.
#[derive(Default)]
pub struct InboundState(
    std::sync::Mutex<Option<(Arc<inbound::Inbound>, tokio::sync::watch::Sender<bool>)>>,
);

impl InboundState {
    /// A state serving `endpoint`, as the app's start makes one: for the IPC tests on Tauri's mock runtime.
    #[doc(hidden)]
    pub fn serving(endpoint: Arc<inbound::Inbound>) -> Self {
        let (stop, _) = tokio::sync::watch::channel(false);
        Self(std::sync::Mutex::new(Some((endpoint, stop))))
    }

    fn get(&self) -> Option<Arc<inbound::Inbound>> {
        self.0
            .lock()
            .expect("inbound state")
            .as_ref()
            .map(|(inbound, _)| inbound.clone())
    }

    /// Stops the listener and deletes `inbound.json`: the window closed, or the app is exiting.
    fn stop(&self, data: &std::path::Path) {
        if let Some((_, stop)) = self.0.lock().expect("inbound state").take() {
            let _ = stop.send(true);
            connection::remove(data);
        }
    }
}

/// The data directory, for the exit's clean-up.
struct DataDirectory(PathBuf);

/// Binds `127.0.0.1` on a free port, writes `inbound.json` owner-only with a new token, and serves until stopped. Any
/// failure serves nothing and says why without the token.
fn start_inbound<R: Runtime>(
    app: &AppHandle<R>,
    data: &std::path::Path,
) -> Option<(Arc<inbound::Inbound>, tokio::sync::watch::Sender<bool>)> {
    let listener = match std::net::TcpListener::bind(("127.0.0.1", 0)).and_then(|listener| {
        listener.set_nonblocking(true)?;
        Ok(listener)
    }) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "loam-desktop: the inbound endpoint could not listen ({error}); nothing is served inbound"
            );
            return None;
        }
    };
    let port = listener.local_addr().ok()?.port();
    let token = inbound::token();
    if let Err(code) = connection::write(data, &connection::Connection::new(port, token.clone())) {
        eprintln!(
            "loam-desktop: inbound.json could not be made owner-only ({code}); nothing is served inbound"
        );
        return None;
    }
    let handle = app.clone();
    let deliver: inbound::Deliver = Arc::new(move |statement| {
        if let Some(window) = handle.get_webview_window(MAIN) {
            let _ = window.eval(statement);
        }
    });
    let endpoint = inbound::Inbound::new(port, &token, deliver);
    let (stop, stopped) = tokio::sync::watch::channel(false);
    let serving = endpoint.clone();
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => inbound::serve(listener, serving, stopped).await,
            Err(_) => eprintln!(
                "loam-desktop: the inbound endpoint could not listen; nothing is served inbound"
            ),
        }
    });
    Some((endpoint, stop))
}

#[tauri::command]
async fn mount_open<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    mounts: State<'_, Arc<Mounts>>,
    instance: String,
) -> Result<u64, String> {
    from_shell(&webview, &request)?;
    mounts
        .open(&instance, notifier(app))
        .await
        .map_err(String::from)
}

#[tauri::command]
async fn mount_send<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    mounts: State<'_, Arc<Mounts>>,
    handle: u64,
    message: Value,
) -> Result<Value, String> {
    from_shell(&webview, &request)?;
    mounts
        .send(handle, message, notifier(app))
        .await
        .map_err(String::from)
}

#[tauri::command]
async fn mount_close<R: Runtime>(
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    mounts: State<'_, Arc<Mounts>>,
    handle: u64,
) -> Result<(), String> {
    from_shell(&webview, &request)?;
    mounts.close(handle).await.map_err(String::from)
}

/// `model_send` (phase 5 specification, 4.2): a provider id from `models.json`, a body the kind's allow-list
/// admits, and the stream id the page listens on; the Rust host builds the request, and the answer arrives as
/// `loam:model` events. The id back at once.
#[tauri::command]
async fn model_send<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    models: State<'_, Arc<Models>>,
    provider: String,
    body: Value,
    stream: u64,
) -> Result<u64, String> {
    from_shell(&webview, &request)?;
    models
        .send(&provider, body, stream, emitter(app))
        .await
        .map_err(String::from)
}

/// `model_cancel`: the stream's request is dropped.
#[tauri::command]
async fn model_cancel<R: Runtime>(
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    models: State<'_, Arc<Models>>,
    stream: u64,
) -> Result<(), String> {
    from_shell(&webview, &request)?;
    models.cancel(stream).await;
    Ok(())
}

/// `inbound_reply` (10.8): the kernel's answer to a request the Rust host issued, `{ id, message }`, or `{ ready: true }`
/// once stage B has loaded, answered `false` when it is refused (a page load under way), so the page asks again. An
/// answer is `true` only when it reached a request still waiting: an id the host did not issue, or one already
/// answered, does nothing and answers `false`. With no endpoint, `true`: there is nothing to wait for.
#[tauri::command]
async fn inbound_reply<R: Runtime>(
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    inbound: State<'_, InboundState>,
    id: Option<u64>,
    message: Option<Value>,
    ready: Option<bool>,
) -> Result<bool, String> {
    from_shell(&webview, &request)?;
    // With no endpoint there is nothing to be ready for: `true`, so the page stops asking.
    let Some(endpoint) = inbound.get() else {
        return Ok(true);
    };
    if ready == Some(true) {
        // `false` while a page load is under way: the page asks again (10.8).
        return Ok(endpoint.set_ready());
    }
    // `true` only when the answer reached a request still waiting: an id the host did not issue, one already
    // answered, or a call with neither field does nothing and says so (10.8).
    Ok(match (id, message) {
        (Some(id), Some(message)) => endpoint.reply(id, &message),
        _ => false,
    })
}

/// "Command palette" answers as Mod+K does, through the shell's own `openPalette`, which calls `palette-open`. A
/// script-made key would not do: the shell turns only a person's own key presses into calls (phase 4 specification,
/// 8.3, step 7's R6). Fixed text, with nothing formatted into it.
fn palette_script() -> &'static str {
    "document.querySelector('loam-shell')?.openPalette()"
}

/// "Reload". On WebView2 the address follows the shell's state, so a reload restores it. On a `loam:` document
/// the address cannot follow (WebKit rewrites no path there) and may hold a route a link loaded long ago, so the
/// shell reloads at its root and restores from what it stored. Fixed text.
fn reload_script() -> &'static str {
    if cfg!(windows) {
        "location.reload()"
    } else {
        "location.replace('loam://localhost/')"
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let palette = MenuItem::with_id(app, "palette", "Command palette", true, Some("CmdOrCtrl+K"))?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, Some("CmdOrCtrl+Q"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    let loam = Submenu::with_items(app, "Loam", true, &[&palette, &reload, &separator, &quit])?;
    #[cfg(target_os = "macos")]
    {
        let edit = Submenu::with_items(
            app,
            "Edit",
            true,
            &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ],
        )?;
        Menu::with_items(app, &[&loam, &edit])
    }
    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&loam])
}

/// D34's scoped-registry polyfill, run before any of the page's scripts (D174, #2793), so it is in place before the
/// chrome and Violet define their elements. Only in the top frame, where the webview has no scoped custom element
/// registries (WebKitGTK 2.52); WebView2 and WKWebView skip it. WebKitGTK and WKWebView add it to the main frame
/// alone, but WebView2 adds it to every frame, so the script itself returns in a frame (the sandbox's and a view's).
/// It sets the flag the chrome's `support-floor.ts` and `loam-mount` read; once it runs, fast-element's
/// `supportsScopedRegistries()` answers true, so `ensureScopedRegistrySupport()` loads nothing more.
const SCOPED_REGISTRY_POLYFILL: &str =
    include_str!(concat!(env!("OUT_DIR"), "/scoped-registry-polyfill.js"));

fn scoped_registry_script() -> String {
    // An install-less build has no polyfill: then nothing runs, and nothing claims it did.
    if SCOPED_REGISTRY_POLYFILL.is_empty() {
        return String::new();
    }
    format!(
        "(() => {{ if (window !== window.top) return; try {{ const registry = new CustomElementRegistry(); \
         const root = document.createElement('div').attachShadow({{ mode: 'open', customElementRegistry: registry }}); \
         if (root.customElementRegistry === registry) return; }} catch {{}} \
         {SCOPED_REGISTRY_POLYFILL}\n; globalThis.__scopedRegistryPolyfillApplied = true; }})();"
    )
}

/// What may load in the main window: the shell's own origin. WebView2 asks only of the main frame; WebKitGTK
/// asks of every frame too, so there the sandbox's origin and a view's `srcdoc` document are admitted as well,
/// which only the shell's own code could load at the top (a frame has no `allow-top-navigation`).
fn may_navigate(url: &tauri::Url) -> bool {
    let here = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
    let origin = url.port().is_none().then_some(here.as_str());
    if origin == Some(site::shell_origin()) {
        return true;
    }
    cfg!(not(windows))
        && (origin == Some(site::sandbox_origin())
            || matches!(url.as_str(), "about:srcdoc" | "about:blank"))
}

/// Shares a Tauri [`tauri::Assets`] provider between the Tauri context and `site::Site` so
/// `Site::Bundled` and `Site::Managed` resolve exact keys via [`tauri::Assets::get`], which
/// decompresses Brotli-encoded `EmbeddedAssets` and never falls back to `index.html`.
struct SharedAssets<R: Runtime>(Arc<dyn tauri::Assets<R>>);

impl<R: Runtime> tauri::Assets<R> for SharedAssets<R> {
    fn setup(&self, app: &tauri::App<R>) {
        self.0.setup(app);
    }

    fn get(&self, key: &tauri::utils::assets::AssetKey) -> Option<std::borrow::Cow<'_, [u8]>> {
        self.0.get(key)
    }

    fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> {
        self.0.iter()
    }

    fn csp_hashes(
        &self,
        html_path: &tauri::utils::assets::AssetKey,
    ) -> Box<dyn Iterator<Item = tauri::utils::assets::CspHash<'_>> + '_> {
        self.0.csp_hashes(html_path)
    }
}

struct EmptyAssets;

impl<R: Runtime> tauri::Assets<R> for EmptyAssets {
    fn get(&self, _key: &tauri::utils::assets::AssetKey) -> Option<std::borrow::Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(
        &self,
        _html_path: &tauri::utils::assets::AssetKey,
    ) -> Box<dyn Iterator<Item = tauri::utils::assets::CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

/// Extracts a shared [`tauri::Assets`] handle from `context` while keeping the exact same assets
/// installed on `context`.
pub fn share_context_assets<R: Runtime>(
    context: &mut tauri::Context<R>,
) -> Arc<dyn tauri::Assets<R>> {
    let original = context.set_assets(Box::new(EmptyAssets));
    let shared: Arc<dyn tauri::Assets<R>> = Arc::from(original);
    context.set_assets(Box::new(SharedAssets(shared.clone())));
    shared
}

/// Builds a [`site::Lookup`] backed by exact-key [`tauri::Assets::get`], decompressing embedded
/// assets (Brotli) without SPA fallback.
pub fn bundled_lookup<R: Runtime>(assets: Arc<dyn tauri::Assets<R>>) -> site::Lookup {
    Box::new(move |path| {
        let key = tauri::utils::assets::AssetKey::from(path);
        assets.get(&key).map(|bytes| bytes.into_owned())
    })
}

pub fn run() {
    logging::init();
    let mut context = tauri::generate_context!();
    let embedded_assets = share_context_assets(&mut context);
    let app = tauri::Builder::default()
        // First, so a second launch exits before it opens anything, and the first window comes forward.
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                if let Some(window) = app.get_webview_window(MAIN) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            },
        ))
        // Rust-only signed updates (10.6): no `updater:*` permission is granted to the webview, and
        // `updater::start` stays off unless both `LOAM_UPDATER_PUBKEY` and `LOAM_UPDATER_ENDPOINT`
        // were set at build time.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Async protocol handlers move `canonicalize` + disk reads off the UI thread so WebView2's parallel
        // module fetches (and Windows real-time file scans) execute concurrently (#1396).
        .register_asynchronous_uri_scheme_protocol("loam", |context, request, responder| {
            let site = context.app_handle().state::<SiteState>().current();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(site::serve(&site, false, &request));
            });
        })
        .register_asynchronous_uri_scheme_protocol("loam-sandbox", |context, request, responder| {
            let site = context.app_handle().state::<SiteState>().current();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(site::serve(&site, true, &request));
            });
        })
        .invoke_handler(handler())
        .setup(move |app| {
            let handle = app.handle().clone();
            let data = data_directory(&handle);
            let bundled = bundled_lookup(embedded_assets);
            let custom_dir = keychain::custom_data_dir();
            let mount_keychain = keychain::mount_service(custom_dir.as_deref());
            let profile = materialize::Profile {
                sandbox_origin: site::sandbox_origin(),
                mount_keychain: &mount_keychain,
            };
            let startup = startup_prepare(&data, &profile, materialize::SHELL_BUILD_ID, bundled);
            app.manage(SiteState::new(startup.site));
            let inbound_on = startup.inbound;
            app.manage(Arc::new(Mounts::new(startup.mounts)));
            app.manage(InboundState::default());
            app.manage(DataDirectory(data.clone()));
            app.manage(Arc::new(Models::new(startup.models)));
            app.set_menu(menu(&handle)?)?;
            app.on_menu_event(|app, event| {
                let Some(window) = app.get_webview_window(MAIN) else {
                    return;
                };
                match event.id().as_ref() {
                    "palette" => {
                        let _ = window.eval(palette_script());
                    }
                    "reload" => {
                        let _ = window.eval(reload_script());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                }
            });
            // `SIGTERM` (a logout, a shutdown, a test) exits as "Quit" does, so `inbound.json` is deleted and every child
            // stopped (10.8, 10.4), rather than the process ending with them behind it.
            #[cfg(unix)]
            {
                let quitting = handle.clone();
                tauri::async_runtime::spawn(async move {
                    use tokio::signal::unix::{SignalKind, signal};
                    if let Ok(mut terminate) = signal(SignalKind::terminate()) {
                        terminate.recv().await;
                        quitting.exit(0);
                    }
                });
            }
            // The listener starts with the window and stops when it closes (10.8); it answers `503` until the page
            // says it is ready, so starting it first loses no `ready`.
            if inbound_on {
                *app.state::<InboundState>().0.lock().expect("inbound state") =
                    start_inbound(&handle, &data);
            }
            updater::start(&handle);
            let url = format!("{}/", site::shell_origin())
                .parse()
                .expect("the shell's origin");
            WebviewWindowBuilder::new(app, MAIN, WebviewUrl::CustomProtocol(url))
                .title("Loam")
                .inner_size(1280.0, 800.0)
                .min_inner_size(360.0, 480.0)
                // IndexedDB and the rest of the webview's profile live beside the site, per data directory.
                .data_directory(data.join("webview"))
                .on_navigation(may_navigate)
                .initialization_script(scoped_registry_script())
                // A reload or a navigation leaves the page that asked for each model stream: none outlives it (phase 5's
                // 4.2), so no late event of one reaches the next page.
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        let models = window.state::<Arc<Models>>().inner().clone();
                        models.leave_page();
                        tauri::async_runtime::spawn(async move { models.cancel_all().await });
                        // Not ready until the new page says so, and every waiting request answered `503` (10.8).
                        if let Some(endpoint) = window.state::<InboundState>().get() {
                            endpoint.page_started();
                        }
                    } else if let Some(endpoint) = window.state::<InboundState>().get() {
                        endpoint.page_finished();
                    }
                })
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == MAIN && matches!(event, WindowEvent::Destroyed) {
                let app = window.app_handle();
                if let (Some(inbound), Some(data)) = (
                    app.try_state::<InboundState>(),
                    app.try_state::<DataDirectory>(),
                ) {
                    inbound.stop(&data.0);
                }
            }
        })
        .build(context)
        .expect("Loam's desktop host");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let (Some(inbound), Some(data)) = (
                app.try_state::<InboundState>(),
                app.try_state::<DataDirectory>(),
            ) {
                inbound.stop(&data.0);
            }
            let mounts = app.state::<Arc<Mounts>>().inner().clone();
            let models = app.state::<Arc<Models>>().inner().clone();
            tauri::async_runtime::block_on(async {
                models.cancel_all().await;
                mounts.close_all().await;
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_shell_and_its_frames_load_in_the_main_window() {
        let shell: tauri::Url = format!("{}/personal", site::shell_origin())
            .parse()
            .unwrap();
        assert!(may_navigate(&shell));
        for other in [
            "https://example.com",
            "http://loam.localhost:8080",
            "tauri://localhost",
            "file:///etc/passwd",
        ] {
            let url: tauri::Url = format!("{other}/").parse().unwrap();
            assert!(!may_navigate(&url), "{other}");
        }
        let sandbox: tauri::Url = format!("{}/sandbox/proxy.html", site::sandbox_origin())
            .parse()
            .unwrap();
        let srcdoc: tauri::Url = "about:srcdoc".parse().unwrap();
        // WebKitGTK asks of frames as well; WebView2 of the main frame alone.
        assert_eq!(may_navigate(&sandbox), cfg!(not(windows)));
        assert_eq!(may_navigate(&srcdoc), cfg!(not(windows)));
    }

    /// #2793: the polyfill runs only where the webview has no scoped registries, and says so once it has.
    #[test]
    fn the_polyfill_runs_first_and_only_without_scoped_registries() {
        let script = scoped_registry_script();
        if SCOPED_REGISTRY_POLYFILL.is_empty() {
            assert!(
                script.is_empty(),
                "nothing runs, or claims to, without the polyfill"
            );
            return;
        }
        // WebView2 runs an initialization script in every frame; this one returns in all but the top.
        assert!(script.starts_with(
            "(() => { if (window !== window.top) return; try { const registry = new CustomElementRegistry();"
        ));
        assert!(script.contains("if (root.customElementRegistry === registry) return; } catch {}"));
        assert!(script.contains(SCOPED_REGISTRY_POLYFILL));
        assert!(script.ends_with("globalThis.__scopedRegistryPolyfillApplied = true; })();"));
    }

    #[test]
    fn the_capability_file_grants_the_six_commands_to_the_main_webview_only() {
        let file: Value = serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        assert_eq!(file["local"], true);
        assert_eq!(file["webviews"], serde_json::json!([MAIN]));
        assert!(
            file.get("windows").is_none()
                && file.get("remote").is_none()
                && file.get("platforms").is_none()
        );
        assert_eq!(
            file["permissions"],
            serde_json::json!([
                "allow-mount-open",
                "allow-mount-send",
                "allow-mount-close",
                "allow-model-send",
                "allow-model-cancel",
                "allow-inbound-reply"
            ])
        );
    }

    const SIGNED_PAGE: &str = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'\"><title>Loam Signed</title>";

    fn test_bundled() -> site::Lookup {
        Box::new(|path| match path {
            "index.html" => Some(SIGNED_PAGE.as_bytes().to_vec()),
            "assets/app.js" => Some(b"console.log('signed');".to_vec()),
            "sandbox/proxy.html" => Some(b"<p>signed-proxy</p>".to_vec()),
            "deployment.json" => Some(b"{\"from\":\"bundled\"}".to_vec()),
            _ => None,
        })
    }

    fn get_site(
        site: &site::Site,
        sandbox: bool,
        path: &str,
        accept: &str,
    ) -> tauri::http::Response<std::borrow::Cow<'static, [u8]>> {
        let req = tauri::http::Request::builder()
            .uri(format!("loam://localhost{path}"))
            .header("accept", accept)
            .body(Vec::new())
            .unwrap();
        site::serve(site, sandbox, &req)
    }

    fn install_view_plugin(data: &std::path::Path) -> desktop_state::DesktopState {
        let bundle_sha = "1".repeat(64);
        let root = data.join("plugins/board").join(&bundle_sha);
        std::fs::create_dir_all(root.join("apps/board/dist")).unwrap();
        std::fs::write(
            root.join("plugin-manifest.json"),
            br#"{"plugin_manifest_version":1,"plugin":{"id":"board","title":"Board","version":"1.0.0","description":"Board."},"apps":[{"id":"board","path":"apps/board"}]}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("apps/board/app-manifest.json"),
            br#"{"manifest_version":1,"protocol":1,"plugin":{"title":"Board","version":"1.0.0","description":"Board.","id":"board","kind":"view","domains":["board"]},"view":{}}"#,
        )
        .unwrap();
        std::fs::write(root.join("apps/board/dist/view.js"), b"export const v = 1;").unwrap();
        let mut state = desktop_state::DesktopState::fresh();
        state.plugins.push(desktop_state::InstalledPlugin {
            id: "board".into(),
            bundle_sha256: bundle_sha,
            engine: None,
        });
        state
    }

    #[test]
    fn p5_s9_6_shell_build_id_is_a_compile_time_sha256_digest() {
        let digest = materialize::SHELL_BUILD_ID
            .strip_prefix("sha256-")
            .expect("sha256- prefix");
        assert!(
            desktop_state::hex64(digest),
            "{}",
            materialize::SHELL_BUILD_ID
        );
    }

    #[test]
    fn p5_s9_6_cli_mode_serves_site_index_untouched_without_creating_state_lock() {
        let data = tempfile::tempdir().unwrap();
        let site_dir = data.path().join("site");
        std::fs::create_dir_all(&site_dir).unwrap();
        let cli_html = "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'\"><title>CLI Dev Site</title>";
        std::fs::write(site_dir.join("index.html"), cli_html).unwrap();
        // Even an orphaned `.staging` directory is left untouched in `cli` mode.
        std::fs::create_dir_all(data.path().join(".staging")).unwrap();

        let profile = materialize::Profile::default_profile();
        let startup = startup_prepare(
            data.path(),
            &profile,
            materialize::SHELL_BUILD_ID,
            test_bundled(),
        );
        assert_eq!(startup.mode, StartupMode::Cli);
        assert!(!startup.reconciled);
        assert!(!data.path().join(desktop_state::LOCK_FILE).exists());
        assert!(data.path().join(".staging").exists());

        let resp = get_site(&startup.site, false, "/", "text/html");
        assert_eq!(resp.status(), 200);
        assert_eq!(resp.body().as_ref(), cli_html.as_bytes());
    }

    #[test]
    fn p5_s9_6_fresh_managed_install_sweeps_orphans_and_serves_bundled_shell() {
        let data = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(data.path().join("plugins/.staging/stale")).unwrap();
        std::fs::create_dir_all(data.path().join("plugins/mail")).unwrap();
        std::fs::write(data.path().join("plugins/mail/launch.pending.json"), b"{}").unwrap();

        let profile = materialize::Profile::default_profile();
        let startup = startup_prepare(
            data.path(),
            &profile,
            materialize::SHELL_BUILD_ID,
            test_bundled(),
        );
        assert_eq!(startup.mode, StartupMode::Managed);
        assert!(!startup.reconciled);
        assert!(!startup.inbound);
        assert!(startup.mounts.as_ref().unwrap().is_empty());
        assert!(startup.models.as_ref().unwrap().is_empty());
        assert!(data.path().join(desktop_state::LOCK_FILE).is_file());
        assert!(!data.path().join("plugins/.staging").exists());
        assert!(
            !data
                .path()
                .join("plugins/mail/launch.pending.json")
                .exists()
        );

        let resp = get_site(&startup.site, false, "/", "text/html");
        assert_eq!(resp.status(), 200);
        assert_eq!(resp.body().as_ref(), SIGNED_PAGE.as_bytes());
    }

    #[cfg(unix)]
    #[test]
    fn p5_s9_6_non_owner_only_desktop_state_fails_closed_with_desktop_state_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let data = tempfile::tempdir().unwrap();
        let state = install_view_plugin(data.path());
        let profile = materialize::Profile::default_profile();
        materialize::commit(data.path(), &state, &profile, "build-1").unwrap();

        // Loosen permissions on `desktop-state.json` to 0644.
        let state_file = data.path().join(desktop_state::FILE);
        std::fs::set_permissions(&state_file, std::fs::Permissions::from_mode(0o644)).unwrap();

        let startup = startup_prepare(data.path(), &profile, "build-1", test_bundled());
        assert_eq!(
            startup.mode,
            StartupMode::FailedClosed(desktop_state::PERMISSIONS)
        );
        assert_eq!(startup.mounts.err(), Some(desktop_state::PERMISSIONS));
        assert_eq!(startup.models.err(), Some(desktop_state::PERMISSIONS));
        assert!(!startup.inbound);
        // Must serve bundled shell only, NOT the disk deployment.json.
        let deploy = get_site(&startup.site, false, "/deployment.json", "application/json");
        assert_eq!(deploy.body().as_ref(), b"{\"from\":\"bundled\"}");
    }

    #[test]
    fn p5_s9_6_managed_startup_reconciles_sweeps_orphans_and_ignores_planted_shell_files() {
        let data = tempfile::tempdir().unwrap();
        let state = install_view_plugin(data.path());
        let profile = materialize::Profile::default_profile();
        materialize::commit(data.path(), &state, &profile, "build-old").unwrap();

        // Plant orphans and tampered shell files, and remove `mounts.json` to force reconciliation.
        std::fs::create_dir_all(data.path().join("plugins/.staging/orphan")).unwrap();
        std::fs::write(data.path().join("plugins/board/launch.pending.json"), b"{}").unwrap();
        std::fs::remove_file(data.path().join("mounts.json")).unwrap();
        std::fs::write(data.path().join("site/index.html"), b"PLANTED-BEFORE-BOOT").unwrap();

        let startup = startup_prepare(
            data.path(),
            &profile,
            materialize::SHELL_BUILD_ID,
            test_bundled(),
        );
        assert_eq!(startup.mode, StartupMode::Managed);
        assert!(startup.reconciled);
        assert!(startup.inbound);
        assert!(!data.path().join("plugins/.staging").exists());
        assert!(
            !data
                .path()
                .join("plugins/board/launch.pending.json")
                .exists()
        );
        assert_eq!(
            std::fs::read_to_string(data.path().join("site/.loam-shell-build")).unwrap(),
            format!("{}\n", materialize::SHELL_BUILD_ID)
        );

        // Even if shell files are planted on disk AFTER startup, `Site::Managed` ignores them
        // while serving `deployment.json` and `apps/*` from disk and rewriting `frame-src` in memory.
        std::fs::create_dir_all(data.path().join("site/assets")).unwrap();
        std::fs::write(data.path().join("site/index.html"), b"PLANTED-AFTER-BOOT").unwrap();
        std::fs::write(data.path().join("site/assets/app.js"), b"planted();").unwrap();

        let index = get_site(&startup.site, false, "/", "text/html");
        assert_eq!(index.status(), 200);
        let html = std::str::from_utf8(index.body()).unwrap();
        assert!(html.contains("<title>Loam Signed</title>"));
        assert!(html.contains(&format!("frame-src {};", site::sandbox_origin())));
        assert_eq!(
            index.headers()["content-security-policy"],
            format!(
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src {}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
                site::sandbox_origin()
            )
        );
        let asset = get_site(&startup.site, false, "/assets/app.js", "*/*");
        assert_eq!(asset.body().as_ref(), b"console.log('signed');");
        let deploy = get_site(&startup.site, false, "/deployment.json", "application/json");
        assert!(String::from_utf8_lossy(deploy.body()).contains("\"instance\": \"board\""));
        let app_file = get_site(&startup.site, false, "/apps/board/dist/view.js", "*/*");
        assert_eq!(app_file.body().as_ref(), b"export const v = 1;");

        // `SiteState` supports in-place swapping without restarting the host.
        let site_state = SiteState::new(startup.site);
        site_state.swap(site::Site::Bundled(test_bundled()));
        let swapped = get_site(&site_state.current(), false, "/", "text/html");
        assert_eq!(swapped.body().as_ref(), SIGNED_PAGE.as_bytes());
    }

    #[test]
    fn p5_s9_6_generated_context_bundled_lookup_decompresses_html_and_returns_404_for_missing() {
        let mut context: tauri::Context<tauri::test::MockRuntime> =
            tauri::generate_context!("tauri.conf.json", test = true);
        let shared = share_context_assets(&mut context);

        // `Site::Bundled` backed by the real generated `EmbeddedAssets` serves decompressed UTF-8 HTML
        // and returns 404 for absent assets (no SPA fallback to `index.html`).
        let bundled_site = site::Site::Bundled(bundled_lookup(shared.clone()));
        let index = get_site(&bundled_site, false, "/", "text/html");
        assert_eq!(index.status(), 200);
        let html = std::str::from_utf8(index.body()).expect("decompressed UTF-8 HTML");
        assert!(html.to_ascii_lowercase().contains("<!doctype html>"));
        assert_eq!(
            get_site(&bundled_site, false, "/assets/does-not-exist.js", "*/*").status(),
            404
        );

        // `Site::Managed` backed by the same `EmbeddedAssets` also decodes and serves `/` cleanly.
        let data = tempfile::tempdir().unwrap();
        let site_dir = data.path().join("site");
        std::fs::create_dir_all(&site_dir).unwrap();
        std::fs::write(site_dir.join("deployment.json"), b"{\"from\":\"disk\"}").unwrap();
        let managed_site =
            site::Site::managed(&site_dir, bundled_lookup(shared), "'none'").unwrap();
        let managed_index = get_site(&managed_site, false, "/", "text/html");
        assert_eq!(managed_index.status(), 200);
        let managed_html = std::str::from_utf8(managed_index.body()).expect("managed UTF-8 HTML");
        assert!(
            managed_html
                .to_ascii_lowercase()
                .contains("<!doctype html>")
        );
        assert_eq!(
            get_site(&managed_site, false, "/deployment.json", "application/json")
                .body()
                .as_ref(),
            b"{\"from\":\"disk\"}"
        );
    }

    #[test]
    fn p5_s9_6_invalid_desktop_state_and_dangling_symlink_fail_closed() {
        // Corrupt JSON fails closed with `DESKTOP_STATE_INVALID`.
        let data = tempfile::tempdir().unwrap();
        connection::write_owner_only(&data.path().join(desktop_state::FILE), b"{not-json").unwrap();
        let profile = materialize::Profile::default_profile();
        let startup = startup_prepare(data.path(), &profile, "build-1", test_bundled());
        assert_eq!(
            startup.mode,
            StartupMode::FailedClosed(desktop_state::INVALID)
        );
        assert_eq!(startup.mounts.err(), Some(desktop_state::INVALID));
        assert_eq!(startup.models.err(), Some(desktop_state::INVALID));
        assert!(!startup.inbound);

        // Valid state referencing a missing plugin bundle fails closed with `DESKTOP_STATE_INVALID`.
        let data2 = tempfile::tempdir().unwrap();
        let mut missing_bundle = desktop_state::DesktopState::fresh();
        missing_bundle.plugins.push(desktop_state::InstalledPlugin {
            id: "ghost".into(),
            bundle_sha256: "a".repeat(64),
            engine: None,
        });
        connection::write_owner_only(
            &data2.path().join(desktop_state::FILE),
            &desktop_state::bytes(&missing_bundle),
        )
        .unwrap();
        let startup2 = startup_prepare(data2.path(), &profile, "build-1", test_bundled());
        assert_eq!(
            startup2.mode,
            StartupMode::FailedClosed(desktop_state::INVALID)
        );
        assert!(!startup2.inbound);

        // Dangling symlink at `desktop-state.json` (even beside a `site/index.html`) fails closed
        // with `DESKTOP_STATE_PERMISSIONS` rather than falling into `cli` mode.
        #[cfg(unix)]
        {
            let data3 = tempfile::tempdir().unwrap();
            std::fs::create_dir_all(data3.path().join("site")).unwrap();
            std::fs::write(data3.path().join("site/index.html"), SIGNED_PAGE).unwrap();
            std::os::unix::fs::symlink(
                data3.path().join("nonexistent-target.json"),
                data3.path().join(desktop_state::FILE),
            )
            .unwrap();
            let startup3 = startup_prepare(data3.path(), &profile, "build-1", test_bundled());
            assert_eq!(
                startup3.mode,
                StartupMode::FailedClosed(desktop_state::PERMISSIONS)
            );
            assert_eq!(startup3.mounts.err(), Some(desktop_state::PERMISSIONS));
            assert!(!startup3.inbound);
        }
    }

    #[test]
    fn p5_s9_6_non_default_profile_reconciles_scoped_mount_keychain_service() {
        let data = tempfile::tempdir().unwrap();
        let bundle_sha = "3".repeat(64);
        let root = data.path().join("plugins/mail").join(&bundle_sha);
        std::fs::create_dir_all(root.join("apps/mail")).unwrap();
        std::fs::create_dir_all(root.join("engines/linux-x64")).unwrap();
        std::fs::write(root.join("engines/linux-x64/mail-engine"), b"\x7fELF").unwrap();
        std::fs::write(
            root.join("plugin-manifest.json"),
            format!(
                r#"{{"plugin_manifest_version":1,"plugin":{{"id":"mail","title":"Mail","version":"1.0.0","description":"Mail."}},"apps":[{{"id":"mail","path":"apps/mail"}}],"engine":{{"id":"mail-engine","kind":"http-service","mount_app":"mail","service_mode":"login","artifacts":{{"linux-x64":{{"path":"engines/linux-x64/mail-engine","sha256":"{}"}}}},"auth":{{"mode":"agent"}},"mount":{{"audience":"person"}}}}}}"#,
                "0".repeat(64)
            ),
        )
        .unwrap();
        std::fs::write(
            root.join("apps/mail/app-manifest.json"),
            br#"{"manifest_version":1,"protocol":1,"plugin":{"title":"Mail","version":"1.0.0","description":"Mail.","id":"mail","kind":"mounted","domains":["mail"]},"mount":{"transport":"http","prefix":"mail"}}"#,
        )
        .unwrap();

        let mut state = desktop_state::DesktopState::fresh();
        state.plugins.push(desktop_state::InstalledPlugin {
            id: "mail".into(),
            bundle_sha256: bundle_sha,
            engine: Some(desktop_state::EngineState {
                port: 17405,
                token_id: Some("tok_p1".into()),
                proof_key: Some("c".repeat(64)),
                file_fallback: false,
            }),
        });
        connection::write_owner_only(
            &data.path().join(desktop_state::FILE),
            &desktop_state::bytes(&state),
        )
        .unwrap();

        let scoped_service = keychain::mount_service(Some(data.path()));
        assert!(scoped_service.starts_with("loam-plugin-mount-"));
        let profile = materialize::Profile {
            sandbox_origin: site::sandbox_origin(),
            mount_keychain: &scoped_service,
        };
        let startup = startup_prepare(
            data.path(),
            &profile,
            materialize::SHELL_BUILD_ID,
            test_bundled(),
        );
        assert_eq!(startup.mode, StartupMode::Managed);
        assert!(startup.reconciled);
        let mounts_text = std::fs::read_to_string(data.path().join("mounts.json")).unwrap();
        assert!(mounts_text.contains(&format!("\"keychain\": \"{scoped_service}\"")));
        assert!(mounts_text.contains("\"account\": \"mail.tok_p1\""));
    }

    #[cfg(unix)]
    #[test]
    fn p5_s9_6_sweep_failure_fails_closed_before_opening_main() {
        use std::os::unix::fs::PermissionsExt;
        // Skip only if running as root (root bypasses directory write permission checks).
        // SAFETY: `geteuid` has no preconditions and cannot fail.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let data = tempfile::tempdir().unwrap();
        let locked_dir = data.path().join("plugins/mail");
        std::fs::create_dir_all(&locked_dir).unwrap();
        std::fs::write(locked_dir.join("launch.pending.json"), b"{}").unwrap();
        // Make `plugins/mail` read+execute only so unlinking `launch.pending.json` fails with EACCES.
        std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let profile = materialize::Profile::default_profile();
        let startup = startup_prepare(
            data.path(),
            &profile,
            materialize::SHELL_BUILD_ID,
            test_bundled(),
        );
        // Restore permissions before asserting so TempDir cleanup always succeeds.
        std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(startup.mode, StartupMode::FailedClosed(materialize::FAILED));
        assert_eq!(startup.mounts.err(), Some(materialize::FAILED));
        assert_eq!(startup.models.err(), Some(materialize::FAILED));
        assert!(!startup.inbound);
    }
}
