//! Loam's desktop host (phase 6 specification, section 10): the same `web` build in Tauri 2's webview, as a
//! personal shell. The Rust side serves the site over two custom protocols, keeps one window, builds the
//! menus, and carries mounted instances' messages over three commands, the copilot's model requests over two more
//! (phase 5 specification, 4.2), and the kernel's answers to the inbound endpoint over a sixth (10.8), the only IPC
//! the webview is granted. `loam-desktop mcp` is the stdio bridge to that endpoint (`bridge`).
pub mod bridge;
pub mod connection;
pub mod era;
pub mod inbound;
pub(crate) mod keychain;
pub mod logging;
pub mod models;
pub mod mounts;
pub mod notify;
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

struct SiteState(Arc<site::Site>);

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

pub fn run() {
    logging::init();
    let context = tauri::generate_context!();
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
            let site = context.app_handle().state::<SiteState>().0.clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(site::serve(&site, false, &request));
            });
        })
        .register_asynchronous_uri_scheme_protocol("loam-sandbox", |context, request, responder| {
            let site = context.app_handle().state::<SiteState>().0.clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(site::serve(&site, true, &request));
            });
        })
        .invoke_handler(handler())
        .setup(|app| {
            let handle = app.handle().clone();
            let data = data_directory(&handle);
            let bundled = handle.clone();
            app.manage(SiteState(Arc::new(site::Site::choose(
                &data.join("site"),
                Box::new(move |path| {
                    let key = format!("/{path}");
                    bundled
                        .asset_resolver()
                        .iter()
                        .find(|(name, _)| *name == key)
                        .map(|(_, bytes)| bytes.to_vec())
                }),
            ))));
            // Read once: nothing in the webview can write it, and no command reaches it (10.3). The inbound switch is
            // in it too (10.8), so a file missing or refused serves nothing inbound.
            let deployed = mounts::read_deployed(&data.join("mounts.json"));
            if let Err(code) = &deployed {
                eprintln!("loam-desktop: mounts.json refused ({code}); no instance is mounted");
            }
            let inbound_on = deployed.as_ref().is_ok_and(|deployed| deployed.inbound);
            app.manage(Arc::new(Mounts::new(
                deployed.map(|deployed| deployed.mounts),
            )));
            app.manage(InboundState::default());
            app.manage(DataDirectory(data.clone()));
            // The copilot's providers (phase 5 specification, 4.2): read once, beside `mounts.json`, under its rule.
            let providers = models::read(&data.join("models.json"));
            if let Err(code) = &providers {
                eprintln!(
                    "loam-desktop: models.json refused ({code}); no model provider is configured"
                );
            }
            app.manage(Arc::new(Models::new(providers)));
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
}
