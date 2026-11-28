//! Trusted setup window (`host-setup`), `loam-host` custom protocol, ephemeral webview profile
//! lifecycle, OS `.loam-plugin` open sanitization, and bundled plugin discovery (phase 5
//! no-terminal amendment, sections 3.1, 3.2 & 7.1; D165).
use crate::notify::literal;
use crate::plugin_manifest;
use crate::plugins::{PendingInstallStore, PluginInstallProposalV1, has_plugin_archive_extension};
use crate::setup_error::{DESKTOP_HOST_SETUP_REFUSED, SetupError};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Notify;

/// The trusted setup webview label (`capabilities/host-setup.json`).
pub const HOST_SETUP: &str = "host-setup";

/// Minimum interval between `setup_open` calls from `main` (§3.2).
pub const SETUP_OPEN_DEBOUNCE: Duration = Duration::from_secs(2);

/// Ephemeral webview profile directory prefix on Windows / Linux (§3.1).
pub const EPHEMERAL_DIR_PREFIX: &str = ".setup-webview-";

/// Strict HTTP Content-Security-Policy emitted by `loam-host` (§3.1).
pub const HOST_SETUP_CSP_HEADER: &str = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// Strict `<meta>` CSP subset present in `host-setup/index.html` (§3.1).
pub const HOST_SETUP_CSP_META: &str = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; frame-src 'none'; object-src 'none'; base-uri 'none'";

const INERT_POLICY: &str = "sandbox; default-src 'none'; frame-ancestors 'none'";

// Compiled-in static assets ONLY — NEVER read from `<app data>/site/` or `frontendDist` (§3.1).
const INDEX_HTML: &[u8] = include_bytes!("../host-setup/index.html");
const SETUP_CSS: &[u8] = include_bytes!("../host-setup/setup.css");
const SETUP_JS: &[u8] = include_bytes!("../host-setup/setup.js");
const FONT_INTER_400: &[u8] = include_bytes!("../../../theme/fonts/inter-latin-400-normal.woff2");
const FONT_INTER_500: &[u8] = include_bytes!("../../../theme/fonts/inter-latin-500-normal.woff2");
const FONT_INTER_600: &[u8] = include_bytes!("../../../theme/fonts/inter-latin-600-normal.woff2");
const FONT_GROTESK_600: &[u8] =
    include_bytes!("../../../theme/fonts/space-grotesk-latin-600-normal.woff2");
const FONT_MONO_400: &[u8] =
    include_bytes!("../../../theme/fonts/ibm-plex-mono-latin-400-normal.woff2");
const FONT_MONO_500: &[u8] =
    include_bytes!("../../../theme/fonts/ibm-plex-mono-latin-500-normal.woff2");

/// The trusted setup window's origin, as Tauri serves `loam-host` on each platform (§3.1).
pub fn host_setup_origin() -> &'static str {
    if cfg!(windows) {
        "http://loam-host.localhost"
    } else {
        "loam-host://localhost"
    }
}

/// Closed two-value section enum for `setup_open` and native menus (§3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SetupSection {
    Models,
    Plugins,
}

impl SetupSection {
    pub fn as_str(self) -> &'static str {
        match self {
            SetupSection::Models => "models",
            SetupSection::Plugins => "plugins",
        }
    }
}

/// Sanitized metadata for a bundled plugin discovered in `<resource dir>/bundled-plugins/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledPluginSummaryV1 {
    pub id: String,
    pub title: String,
    pub version: String,
    pub description: String,
}

/// Discovered bundled plugin entry on disk (kept inside Rust; `path` never leaves Rust).
#[derive(Debug, Clone)]
pub struct BundledPluginEntry {
    pub summary: BundledPluginSummaryV1,
    pub path: PathBuf,
}

/// Shared Tauri managed state for `host-setup`, reload coordination, and `PendingInstall`.
pub struct SetupState {
    pub pending: Arc<PendingInstallStore>,
    pub pending_proposal: Mutex<Option<PluginInstallProposalV1>>,
    pub pending_open_error: Mutex<Option<SetupError>>,
    pub inspect_in_flight: AtomicBool,
    pub host_setup_generation: AtomicU64,
    pub bundled_cache: Mutex<Option<Vec<BundledPluginEntry>>>,
    pub reload_pending: AtomicBool,
    pub main_loading: AtomicBool,
    pub main_page_generation: AtomicU64,
    pub main_reload_in_flight: AtomicBool,
    pub main_load_notify: Arc<Notify>,
    pub last_setup_open: Mutex<Option<Instant>>,
    pub ephemeral_dir: Mutex<Option<PathBuf>>,
    pub bundled_factory: Arc<dyn Fn() -> crate::site::Lookup + Send + Sync>,
    pub startup_failed_closed: Option<&'static str>,
}

impl SetupState {
    pub fn new(
        bundled_factory: Arc<dyn Fn() -> crate::site::Lookup + Send + Sync>,
        startup_failed_closed: Option<&'static str>,
    ) -> Self {
        Self {
            pending: Arc::new(PendingInstallStore::new()),
            pending_proposal: Mutex::new(None),
            pending_open_error: Mutex::new(None),
            inspect_in_flight: AtomicBool::new(false),
            host_setup_generation: AtomicU64::new(0),
            bundled_cache: Mutex::new(None),
            reload_pending: AtomicBool::new(false),
            main_loading: AtomicBool::new(false),
            main_page_generation: AtomicU64::new(0),
            main_reload_in_flight: AtomicBool::new(false),
            main_load_notify: Arc::new(Notify::new()),
            last_setup_open: Mutex::new(None),
            ephemeral_dir: Mutex::new(None),
            bundled_factory,
            startup_failed_closed,
        }
    }

    pub fn host_setup_generation(&self) -> u64 {
        self.host_setup_generation.load(Ordering::SeqCst)
    }

    pub fn bump_host_setup_generation(&self) -> u64 {
        self.host_setup_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Atomically reserves the single inspection slot when neither an active proposal nor another
    /// in-flight inspection is active.
    pub fn try_begin_inspect(&self) -> bool {
        if self.pending.has_active() {
            return false;
        }
        self.inspect_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    pub fn end_inspect(&self) {
        self.inspect_in_flight.store(false, Ordering::SeqCst);
    }

    pub fn set_pending_open_error(&self, err: Option<SetupError>) {
        *self
            .pending_open_error
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = err;
    }

    pub fn take_pending_open_error(&self) -> Option<SetupError> {
        self.pending_open_error
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
    }

    /// Cached discovery of read-only bundled plugins in `<resource dir>/bundled-plugins/`.
    pub fn bundled_plugins(&self, bundled_root: Option<&Path>) -> Vec<BundledPluginEntry> {
        let mut guard = self.bundled_cache.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
        let discovered = bundled_root
            .map(discover_bundled_plugins)
            .unwrap_or_default();
        *guard = Some(discovered.clone());
        discovered
    }

    pub fn set_pending_proposal(&self, proposal: Option<PluginInstallProposalV1>) {
        *self
            .pending_proposal
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = proposal;
    }

    pub fn current_pending_proposal(&self) -> Option<PluginInstallProposalV1> {
        if !self.pending.has_active() {
            self.set_pending_proposal(None);
            return None;
        }
        self.pending_proposal
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Checks and updates the 2-second `setup_open` debounce gate from `main` (§3.2).
    /// Returns `true` when the call is permitted to open/focus `host-setup`, `false` if debounced.
    pub fn try_acquire_open_debounce(&self, now: Instant) -> bool {
        let mut last = self
            .last_setup_open
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if let Some(prev) = *last
            && now.saturating_duration_since(prev) < SETUP_OPEN_DEBOUNCE
        {
            return false;
        }
        *last = Some(now);
        true
    }

    /// Records `main` starting a page load so `setup_apply_reload` can distinguish clean reload
    /// from dirty-tab prompt.
    pub fn note_main_load_started(&self) {
        self.main_loading.store(true, Ordering::SeqCst);
        self.reload_pending.store(false, Ordering::SeqCst);
        self.main_page_generation.fetch_add(1, Ordering::SeqCst);
        self.main_load_notify.notify_waiters();
    }

    pub fn note_main_load_finished(&self) {
        self.main_loading.store(false, Ordering::SeqCst);
    }

    /// Called when `host-setup` closes: drops any uncommitted `PendingInstall` + staging dir and
    /// best-effort removes the ephemeral webview directory on Windows / Linux (§3.1).
    pub fn on_host_setup_closed(&self) {
        self.bump_host_setup_generation();
        self.pending.clear();
        self.set_pending_proposal(None);
        self.set_pending_open_error(None);
        if let Some(dir) = self
            .ephemeral_dir
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}

/// Strictly validates that an IPC call arrived from the `host-setup` webview on `host_setup_origin()`.
pub fn from_host_setup<R: Runtime>(
    webview: &tauri::Webview<R>,
    request: &tauri::ipc::Request<'_>,
) -> Result<(), SetupError> {
    if webview.label() != HOST_SETUP {
        return Err(SetupError::from_code(DESKTOP_HOST_SETUP_REFUSED));
    }
    let origin = request
        .headers()
        .get("Origin")
        .and_then(|value| value.to_str().ok());
    if origin == Some(host_setup_origin()) {
        Ok(())
    } else {
        Err(SetupError::from_code(DESKTOP_HOST_SETUP_REFUSED))
    }
}

/// Navigation guard for `host-setup`: ONLY `host_setup_origin()` on `/` or `/index.html` (§3.1).
pub fn may_navigate_host_setup(url: &tauri::Url) -> bool {
    let here = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
    let origin = url.port().is_none().then_some(here.as_str());
    origin == Some(host_setup_origin()) && matches!(url.path(), "/" | "/index.html")
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(404)
        .header("Content-Security-Policy", INERT_POLICY)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(Cow::Borrowed(&[][..]))
        .expect("404 response")
}

/// Serves `loam-host` requests strictly from compiled-in static bytes — never touches disk (§3.1).
pub fn serve_host_setup(request: &Request<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let method = request.method().as_str();
    if method != "GET" && method != "HEAD" {
        return not_found();
    }
    let (content_type, bytes): (&'static str, &'static [u8]) = match request.uri().path() {
        "/" | "/index.html" => ("text/html; charset=utf-8", INDEX_HTML),
        "/setup.css" => ("text/css; charset=utf-8", SETUP_CSS),
        "/setup.js" => ("text/javascript; charset=utf-8", SETUP_JS),
        "/fonts/inter-latin-400-normal.woff2" => ("font/woff2", FONT_INTER_400),
        "/fonts/inter-latin-500-normal.woff2" => ("font/woff2", FONT_INTER_500),
        "/fonts/inter-latin-600-normal.woff2" => ("font/woff2", FONT_INTER_600),
        "/fonts/space-grotesk-latin-600-normal.woff2" => ("font/woff2", FONT_GROTESK_600),
        "/fonts/ibm-plex-mono-latin-400-normal.woff2" => ("font/woff2", FONT_MONO_400),
        "/fonts/ibm-plex-mono-latin-500-normal.woff2" => ("font/woff2", FONT_MONO_500),
        _ => return not_found(),
    };
    let body = if method == "HEAD" {
        Cow::Borrowed(&[][..])
    } else {
        Cow::Borrowed(bytes)
    };
    Response::builder()
        .status(200)
        .header("Content-Type", content_type)
        .header("Content-Security-Policy", HOST_SETUP_CSP_HEADER)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store")
        .body(body)
        .expect("host-setup response")
}

/// Removes any stale `.setup-webview-*` directories left behind by prior runs (startup & exit; §3.1).
pub fn sweep_setup_webview_dirs(data: &Path) {
    let Ok(entries) = std::fs::read_dir(data) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with(EPHEMERAL_DIR_PREFIX) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn create_ephemeral_webview_dir(data: &Path) -> Option<PathBuf> {
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).ok()?;
    let mut hex = String::with_capacity(32);
    for b in nonce {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{b:02x}");
    }
    let dir = data.join(format!("{EPHEMERAL_DIR_PREFIX}{hex}"));
    crate::connection::ensure_dir_owner_only(&dir).ok()?;
    Some(dir)
}

/// Opens or focuses the single `host-setup` window (§3.1 & §3.2).
/// If `PendingInstall` is active, focuses `host-setup` WITHOUT switching sections or disrupting it.
pub fn open_or_focus_host_setup<R: Runtime>(
    app: &AppHandle<R>,
    section: SetupSection,
) -> tauri::Result<()> {
    let setup_state = app.state::<Arc<SetupState>>();
    if let Some(window) = app.get_webview_window(HOST_SETUP) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if !setup_state.pending.has_active() {
            let script = format!(
                "window.dispatchEvent(new CustomEvent('loam:setup-section',{{detail:{}}}))",
                literal(&json!(section.as_str()))
            );
            let _ = window.eval(script);
        }
        return Ok(());
    }

    let url: tauri::Url = format!("{}/#{}", host_setup_origin(), section.as_str())
        .parse()
        .expect("host-setup URL");
    #[cfg_attr(target_os = "macos", allow(unused_mut))]
    let mut builder = WebviewWindowBuilder::new(app, HOST_SETUP, WebviewUrl::CustomProtocol(url))
        .title("Loam Setup")
        .inner_size(860.0, 680.0)
        .min_inner_size(480.0, 480.0)
        .incognito(true)
        .on_navigation(may_navigate_host_setup);

    // On Windows & Linux, require an ephemeral per-open isolated profile directory (§3.1, fail closed).
    #[cfg(not(target_os = "macos"))]
    let created_ephemeral = {
        let data_dir = app
            .try_state::<crate::DataDirectory>()
            .ok_or_else(|| tauri::Error::Io(std::io::Error::other("missing data directory")))?;
        let dir = create_ephemeral_webview_dir(&data_dir.0).ok_or_else(|| {
            tauri::Error::Io(std::io::Error::other(
                "could not create ephemeral setup profile directory",
            ))
        })?;
        *setup_state
            .ephemeral_dir
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = Some(dir.clone());
        builder = builder.data_directory(dir.clone());
        dir
    };

    setup_state.bump_host_setup_generation();
    let built = builder.build();
    #[cfg(not(target_os = "macos"))]
    if built.is_err() {
        let _ = std::fs::remove_dir_all(&created_ephemeral);
        let mut tracked = setup_state
            .ephemeral_dir
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if tracked.as_ref() == Some(&created_ephemeral) {
            *tracked = None;
        }
    }
    built?;
    Ok(())
}

/// Validates an OS-supplied plugin archive path (launch args, single-instance callback, or macOS
/// `RunEvent::Opened`): resolves relative paths against `cwd`, requires `.loam-plugin` extension
/// and an existing regular file (non-symlink) (§3.2).
pub fn sanitize_plugin_open_path(raw: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    if raw.is_empty() || raw.contains('\0') || raw.starts_with('-') {
        return None;
    }
    let candidate = PathBuf::from(raw);
    let resolved = if candidate.is_absolute() {
        candidate
    } else {
        cwd?.join(candidate)
    };
    if !has_plugin_archive_extension(&resolved) {
        return None;
    }
    let meta = std::fs::symlink_metadata(&resolved).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return None;
    }
    resolved.canonicalize().ok()
}

/// Extracts the first valid `.loam-plugin` file path from argv (skipping argv[0] and subcommands).
pub fn first_plugin_arg(args: &[String], cwd: Option<&Path>) -> Option<PathBuf> {
    let mut iter = args.iter().skip(1).peekable();
    // Skip known CLI subcommands handled before GUI launch.
    if let Some(first) = iter.peek()
        && matches!(
            first.as_str(),
            "mcp" | "plugin" | "engine-run" | "--help" | "-h"
        )
    {
        return None;
    }
    for arg in iter {
        if let Some(path) = sanitize_plugin_open_path(arg, cwd) {
            return Some(path);
        }
    }
    None
}

/// Validates a macOS `RunEvent::Opened` URL: accepts ONLY `file://` URLs pointing to an existing
/// regular `.loam-plugin` file (§3.2).
pub fn sanitize_macos_opened_url(url: &tauri::Url) -> Option<PathBuf> {
    if url.scheme() != "file" {
        return None;
    }
    let path = url.to_file_path().ok()?;
    let raw = path.to_str()?;
    sanitize_plugin_open_path(raw, None)
}

/// Discovers valid read-only bundled plugins inside `<resource dir>/bundled-plugins/` (§3.3).
pub fn discover_bundled_plugins(bundled_root: &Path) -> Vec<BundledPluginEntry> {
    let Ok(entries) = std::fs::read_dir(bundled_root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        let manifest = if meta.is_dir() {
            std::fs::read(path.join("plugin-manifest.json"))
                .ok()
                .and_then(|bytes| plugin_manifest::read(&bytes).map(|(m, _)| m))
        } else if meta.is_file() && has_plugin_archive_extension(&path) {
            read_bundled_archive_manifest(&path)
        } else {
            None
        };
        let Some(manifest) = manifest else {
            continue;
        };
        found.push(BundledPluginEntry {
            summary: BundledPluginSummaryV1 {
                id: manifest.plugin.id,
                title: manifest.plugin.title,
                version: manifest.plugin.version,
                description: manifest.plugin.description,
            },
            path,
        });
    }
    found.sort_by(|a, b| a.summary.id.cmp(&b.summary.id));
    found.dedup_by(|a, b| a.summary.id == b.summary.id);
    found
}

struct TempDirGuard(PathBuf);
impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn read_bundled_archive_manifest(archive_path: &Path) -> Option<plugin_manifest::PluginManifest> {
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).ok()?;
    let mut hex = String::with_capacity(32);
    for b in nonce {
        use std::fmt::Write as _;
        let _ = write!(&mut hex, "{b:02x}");
    }
    let dir = std::env::temp_dir().join(format!("loam-bundled-scan-{hex}"));
    crate::connection::ensure_dir_owner_only(&dir).ok()?;
    let _guard = TempDirGuard(dir.clone());
    let staged = crate::plugin_archive::stage_and_validate_archive(
        archive_path,
        &dir,
        crate::plugin_archive::BundleLimits::default(),
    )
    .ok()?;
    Some(staged.manifest)
}

/// Delivers a JSON event payload safely to `host-setup` via `notify::literal`.
pub fn emit_to_host_setup<R: Runtime>(
    app: &AppHandle<R>,
    event_name: &'static str,
    detail: &serde_json::Value,
) {
    if let Some(window) = app.get_webview_window(HOST_SETUP) {
        let script = format!(
            "window.dispatchEvent(new CustomEvent('{event_name}',{{detail:JSON.parse({})}}))",
            literal(&serde_json::Value::String(detail.to_string()))
        );
        let _ = window.eval(script);
    }
}
