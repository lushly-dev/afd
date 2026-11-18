//! Loam's desktop host (phase 6 specification, section 10): the same `web` build in Tauri 2's webview, as a
//! personal shell. The Rust side serves the site over two custom protocols, keeps one window, builds the
//! menus, and carries mounted instances' messages over three commands and the copilot's model requests over two
//! more (phase 5 specification, 4.2), the only IPC the webview is granted.
pub mod models;
pub mod mounts;
pub mod notify;
pub mod site;

use models::{Emit, Models};
use mounts::{Mounts, Notify};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, Runtime, State, WebviewUrl, WebviewWindowBuilder};

/// The one webview the capability file names.
pub const MAIN: &str = "main";

/// Tests and a deployer's second profile point the app at another data directory; nothing in the webview
/// can set it.
const DATA_DIRECTORY: &str = "LOAM_DESKTOP_DATA_DIR";

struct SiteState(site::Site);

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
/// script and its invoke key; on WebKitGTK a frame can post to wry's `ipc` handler, which gives the message the
/// top-level URL, but Tauri gives its script and key to the main frame alone, so the key check drops it. Each
/// engine so has one barrier: on WebView2 a frame can read the key from its own IPC fetch's headers. A missing
/// `Origin` is refused; the shell's fetch is allowed by its policy, so it does not fall back, but after a
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

/// The five commands, and no other (10.4, and phase 5's 4.2): what the app registers, and what P6-D4's IPC test
/// drives.
pub fn handler<R: Runtime>() -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        mount_open,
        mount_send,
        mount_close,
        model_send,
        model_cancel
    ]
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

/// `model_send` (phase 5 specification, 4.2): a provider id from `models.json` and a body the kind's allow-list
/// admits; the Rust host builds the request, and the answer arrives as `loam:model` events. A stream id at once.
#[tauri::command]
async fn model_send<R: Runtime>(
    app: AppHandle<R>,
    webview: tauri::Webview<R>,
    request: tauri::ipc::Request<'_>,
    models: State<'_, Arc<Models>>,
    provider: String,
    body: Value,
) -> Result<u64, String> {
    from_shell(&webview, &request)?;
    models
        .send(&provider, body, emitter(app))
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

/// "Command palette" answers as Mod+K does: a key event the shell's keyboard handler turns into
/// `palette-open`. Fixed text, with nothing formatted into it.
fn palette_script() -> &'static str {
    if cfg!(target_os = "macos") {
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',metaKey:true,bubbles:true,cancelable:true}))"
    } else {
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true,cancelable:true}))"
    }
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

// The `return` ends the macOS branch before the other platforms' tail, which only clippy on macOS sees.
#[cfg_attr(target_os = "macos", allow(clippy::needless_return))]
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
        return Menu::with_items(app, &[&loam, &edit]);
    }
    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&loam])
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
        .register_uri_scheme_protocol("loam", |context, request| {
            let state = context.app_handle().state::<SiteState>();
            site::serve(&state.0, false, &request)
        })
        .register_uri_scheme_protocol("loam-sandbox", |context, request| {
            let state = context.app_handle().state::<SiteState>();
            site::serve(&state.0, true, &request)
        })
        .invoke_handler(handler())
        .setup(|app| {
            let handle = app.handle().clone();
            let data = data_directory(&handle);
            let bundled = handle.clone();
            app.manage(SiteState(site::Site::choose(
                &data.join("site"),
                Box::new(move |path| {
                    let key = format!("/{path}");
                    bundled
                        .asset_resolver()
                        .iter()
                        .find(|(name, _)| *name == key)
                        .map(|(_, bytes)| bytes.to_vec())
                }),
            )));
            // Read once: nothing in the webview can write it, and no command reaches it (10.3).
            let entries = mounts::read(&data.join("mounts.json"));
            if let Err(code) = &entries {
                eprintln!("loam-desktop: mounts.json refused ({code}); no instance is mounted");
            }
            app.manage(Arc::new(Mounts::new(entries)));
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
                // A reload or a navigation leaves the page that asked for each model stream: none outlives it (phase 5's
                // 4.2), so no late event of one reaches the next page.
                .on_page_load(|window, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started {
                        let models = window.state::<Arc<Models>>().inner().clone();
                        tauri::async_runtime::spawn(async move { models.cancel_all().await });
                    }
                })
                .build()?;
            Ok(())
        })
        .build(context)
        .expect("Loam's desktop host");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
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

    #[test]
    fn the_capability_file_grants_the_five_commands_to_the_main_webview_only() {
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
                "allow-model-cancel"
            ])
        );
    }
}
