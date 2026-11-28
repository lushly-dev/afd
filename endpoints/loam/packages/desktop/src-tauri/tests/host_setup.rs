//! P5-S9-1 & P5-S9-7 integration tests for `host-setup` trust boundary, cross-window isolation,
//! `loam-host` protocol & CSP, OS `.loam-plugin` sanitization, bundled plugin discovery, strict
//! `deny_unknown_fields`, and side-by-side multi-plugin coexistence.
use loam_desktop::models::Models;
use loam_desktop::mounts::Mounts;
use loam_desktop::plugins::{
    PendingInstallStore, PluginHost, confirm, inspect, list_installed, uninstall,
};
use loam_desktop::setup_error::{DESKTOP_HOST_SETUP_REFUSED, SETUP_INPUT_INVALID};
use loam_desktop::setup_window::{
    EPHEMERAL_DIR_PREFIX, HOST_SETUP, HOST_SETUP_CSP_HEADER, HOST_SETUP_CSP_META,
    SETUP_OPEN_DEBOUNCE, SetupState, discover_bundled_plugins, first_plugin_arg, host_setup_origin,
    may_navigate_host_setup, sanitize_macos_opened_url, sanitize_plugin_open_path,
    serve_host_setup, sweep_setup_webview_dirs,
};
use loam_desktop::site::{self, sandbox_origin, shell_origin};
use loam_desktop::{DataDirectory, InboundState, MAIN, SiteState, handler};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};
use tauri::{Manager, WebviewWindowBuilder};

fn empty() -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::new(Cow::Borrowed(&[][..]))
}

const HOST_SETUP_COMMANDS: &[(&str, &str)] = &[
    ("setup_state_get", "{}"),
    ("setup_plugin_pick", r#"{"kind":"file"}"#),
    ("setup_plugin_inspect_bundled", r#"{"id":"mail"}"#),
    ("setup_plugin_cancel", r#"{"proposalId":"abc"}"#),
    (
        "setup_plugin_confirm",
        r#"{"proposalId":"abc","expectedBundleSha256":"0000"}"#,
    ),
    ("setup_plugin_uninstall", r#"{"pluginId":"mail"}"#),
    ("setup_plugin_retry_revocation", r#"{"tokenId":"tok_1"}"#),
    ("setup_plugin_rotate_token", r#"{"pluginId":"mail"}"#),
    (
        "setup_plugin_service_action",
        r#"{"pluginId":"mail","action":"status"}"#,
    ),
    ("setup_model_save", r#"{"id":"claude"}"#),
    ("setup_model_remove", r#"{"id":"claude","deleteKey":false}"#),
    ("setup_model_set_default", r#"{"id":"claude"}"#),
    ("setup_apply_reload", "{}"),
];

const MAIN_ONLY_COMMANDS: &[(&str, &str)] = &[
    ("mount_open", r#"{"instance":"missing"}"#),
    ("mount_send", r#"{"handle":1,"message":{}}"#),
    ("mount_close", r#"{"handle":1}"#),
    (
        "model_send",
        r#"{"provider":"claude","body":{"max_tokens":1,"messages":[]},"stream":1}"#,
    ),
    ("model_cancel", r#"{"stream":1}"#),
    ("inbound_reply", r#"{"ready":true}"#),
    ("setup_open", r#"{"section":"models"}"#),
];

fn invoke_on(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    url: &str,
    origin: Option<&str>,
    body: Value,
) -> Result<tauri::ipc::InvokeResponseBody, Value> {
    let mut headers = tauri::http::HeaderMap::new();
    if let Some(origin) = origin {
        headers.insert("Origin", origin.parse().expect("valid header"));
    }
    get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: url.parse().expect("valid URL"),
            body: InvokeBody::Json(body),
            headers,
            invoke_key: INVOKE_KEY.into(),
        },
    )
}

#[test]
fn p5_s9_1_cross_window_acl_origin_gate_and_deny_unknown_fields() {
    let data = tempfile::tempdir().unwrap();
    let bundled_factory: Arc<dyn Fn() -> site::Lookup + Send + Sync> =
        Arc::new(|| Box::new(|_| None));
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_uri_scheme_protocol("loam", |_, _| empty())
        .register_uri_scheme_protocol("loam-sandbox", |_, _| empty())
        .register_uri_scheme_protocol("loam-host", |_, _| empty())
        .invoke_handler(handler())
        .manage(SiteState::new(site::Site::Bundled(Box::new(|_| None))))
        .manage(Arc::new(Mounts::new(Ok(Vec::new()))))
        .manage(Arc::new(Models::new(Ok(Vec::new()))))
        .manage(InboundState::default())
        .manage(DataDirectory(data.path().to_path_buf()))
        .manage(Arc::new(SetupState::new(bundled_factory, None)))
        .build(tauri::generate_context!("tauri.conf.json", test = true))
        .expect("mock app");

    let main_wv = WebviewWindowBuilder::new(&app, MAIN, Default::default())
        .build()
        .unwrap();
    let setup_wv = WebviewWindowBuilder::new(&app, HOST_SETUP, Default::default())
        .build()
        .unwrap();

    // 1. `main` is refused ALL 13 `setup_*` commands by Tauri ACL.
    for (cmd, body_str) in HOST_SETUP_COMMANDS {
        let body: Value = serde_json::from_str(body_str).unwrap();
        let err = invoke_on(&main_wv, cmd, shell_origin(), Some(shell_origin()), body).unwrap_err();
        let text = err.to_string().to_ascii_lowercase();
        assert!(
            text.contains("not allowed") || text.contains("denied"),
            "expected ACL refusal for main -> {cmd}, got: {text}"
        );
    }

    // 2. `host-setup` is refused ALL 7 `main` commands (including `setup_open`) and plugin commands.
    for (cmd, body_str) in MAIN_ONLY_COMMANDS {
        let body: Value = serde_json::from_str(body_str).unwrap();
        let err = invoke_on(
            &setup_wv,
            cmd,
            host_setup_origin(),
            Some(host_setup_origin()),
            body,
        )
        .unwrap_err();
        let text = err.to_string().to_ascii_lowercase();
        assert!(
            text.contains("not allowed") || text.contains("denied"),
            "expected ACL refusal for host-setup -> {cmd}, got: {text}"
        );
    }
    for cmd in [
        "plugin:updater|check",
        "plugin:event|listen",
        "plugin:window|close",
    ] {
        let err = invoke_on(
            &setup_wv,
            cmd,
            host_setup_origin(),
            Some(host_setup_origin()),
            json!({}),
        )
        .unwrap_err();
        let text = err.to_string().to_ascii_lowercase();
        assert!(text.contains("not allowed") || text.contains("denied"));
    }

    // 3. `host-setup` commands called with wrong/missing Origin return structured DESKTOP_HOST_SETUP_REFUSED.
    for bad_origin in [
        Some(shell_origin()),
        Some(sandbox_origin()),
        Some("null"),
        Some("https://example.com"),
        None,
    ] {
        let err = invoke_on(
            &setup_wv,
            "setup_state_get",
            host_setup_origin(),
            bad_origin,
            json!({}),
        )
        .unwrap_err();
        assert_eq!(err["code"], json!(DESKTOP_HOST_SETUP_REFUSED));
        assert!(err["suggestion"].is_string());
    }

    // 4. Legitimate `setup_state_get` from `host-setup` succeeds with sanitized payload.
    let state_val = invoke_on(
        &setup_wv,
        "setup_state_get",
        host_setup_origin(),
        Some(host_setup_origin()),
        json!({}),
    )
    .unwrap()
    .deserialize::<Value>()
    .unwrap();
    assert_eq!(state_val["mode"], json!("managed"));
    assert_eq!(state_val["plugins"], json!([]));
    assert_eq!(state_val["models"], json!([]));
    assert_eq!(state_val["reloadPending"], json!(false));

    // 5. Unknown fields are strictly refused on `setup_*` commands (`#[serde(deny_unknown_fields)]`).
    for (cmd, body_str) in HOST_SETUP_COMMANDS {
        let mut body: Value = serde_json::from_str(body_str).unwrap();
        body.as_object_mut()
            .unwrap()
            .insert("unexpectedExtraField".into(), json!(true));
        let err = invoke_on(
            &setup_wv,
            cmd,
            host_setup_origin(),
            Some(host_setup_origin()),
            body,
        )
        .unwrap_err();
        assert_eq!(
            err["code"],
            json!(SETUP_INPUT_INVALID),
            "expected deny_unknown_fields for {cmd}, got: {err}"
        );
    }

    // 6. `setup_apply_reload` returns `busy` when `main` is loading.
    let setup_state = app.state::<Arc<SetupState>>();
    setup_state.note_main_load_started();
    let reload_busy = invoke_on(
        &setup_wv,
        "setup_apply_reload",
        host_setup_origin(),
        Some(host_setup_origin()),
        json!({}),
    )
    .unwrap()
    .deserialize::<Value>()
    .unwrap();
    assert_eq!(reload_busy["action"], json!("busy"));
    setup_state.note_main_load_finished();
}

#[test]
fn p5_s9_1_loam_host_protocol_serves_only_compiled_in_assets_with_strict_csp() {
    let get = |path: &str| {
        let req = tauri::http::Request::builder()
            .uri(format!("loam-host://localhost{path}"))
            .body(Vec::new())
            .unwrap();
        serve_host_setup(&req)
    };

    // Index page carries exact HTTP CSP and meta CSP, and loads zero external assets.
    let idx = get("/");
    assert_eq!(idx.status(), 200);
    assert_eq!(
        idx.headers()["content-security-policy"],
        HOST_SETUP_CSP_HEADER
    );
    assert_eq!(idx.headers()["x-content-type-options"], "nosniff");
    assert_eq!(idx.headers()["cache-control"], "no-store");
    let html = std::str::from_utf8(idx.body()).unwrap();
    assert!(html.contains(HOST_SETUP_CSP_META));
    let html_lower = html.to_ascii_lowercase();
    assert!(
        !html_lower.contains("src=\"http")
            && !html_lower.contains("href=\"http")
            && !html_lower.contains("src='http")
            && !html_lower.contains("href='http"),
        "unexpected external resource reference in host-setup HTML"
    );
    let css_resp = get("/setup.css");
    let css = std::str::from_utf8(css_resp.body()).unwrap();
    assert!(
        !css.contains("http://") && !css.contains("https://"),
        "unexpected external URL in setup.css"
    );

    for asset in [
        "/index.html",
        "/setup.css",
        "/setup.js",
        "/fonts/inter-latin-400-normal.woff2",
        "/fonts/inter-latin-500-normal.woff2",
        "/fonts/inter-latin-600-normal.woff2",
        "/fonts/space-grotesk-latin-600-normal.woff2",
        "/fonts/ibm-plex-mono-latin-400-normal.woff2",
        "/fonts/ibm-plex-mono-latin-500-normal.woff2",
    ] {
        let resp = get(asset);
        assert_eq!(resp.status(), 200, "missing asset {asset}");
        assert!(!resp.body().is_empty(), "empty asset {asset}");
    }

    // Never serves site/deployment/mounts/traversal paths or POST requests.
    for blocked in [
        "/deployment.json",
        "/mounts.json",
        "/../mounts.json",
        "/apps/mail/app-manifest.json",
        "/fonts/../setup.js",
    ] {
        assert_eq!(get(blocked).status(), 404, "should 404: {blocked}");
    }
    let post_req = tauri::http::Request::builder()
        .method("POST")
        .uri("loam-host://localhost/")
        .body(Vec::new())
        .unwrap();
    assert_eq!(serve_host_setup(&post_req).status(), 404);

    // Navigation guard strictly admits `host_setup_origin()` on `/` or `/index.html`.
    assert!(may_navigate_host_setup(
        &format!("{}/#models", host_setup_origin()).parse().unwrap()
    ));
    assert!(may_navigate_host_setup(
        &format!("{}/index.html", host_setup_origin())
            .parse()
            .unwrap()
    ));
    for bad_url in [
        format!("{}/", shell_origin()),
        format!("{}/sandbox/proxy.html", sandbox_origin()),
        format!("{}/other", host_setup_origin()),
        "https://example.com/".to_owned(),
        "file:///etc/passwd".to_owned(),
        "about:srcdoc".to_owned(),
    ] {
        assert!(
            !may_navigate_host_setup(&bad_url.parse().unwrap()),
            "should block {bad_url}"
        );
    }
}

#[test]
fn p5_s9_1_debounce_ephemeral_sweep_os_plugin_sanitization_and_bundled_discovery() {
    let bundled_factory: Arc<dyn Fn() -> site::Lookup + Send + Sync> =
        Arc::new(|| Box::new(|_| None));
    let state = SetupState::new(bundled_factory, None);
    let t0 = Instant::now();
    assert!(state.try_acquire_open_debounce(t0));
    assert!(!state.try_acquire_open_debounce(t0 + std::time::Duration::from_millis(500)));
    assert!(state.try_acquire_open_debounce(t0 + SETUP_OPEN_DEBOUNCE));

    // Ephemeral webview dir sweep removes `.setup-webview-*` and leaves `webview/` & `site/`.
    let data = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(data.path().join(format!("{EPHEMERAL_DIR_PREFIX}abc"))).unwrap();
    std::fs::create_dir_all(data.path().join("webview")).unwrap();
    std::fs::create_dir_all(data.path().join("site")).unwrap();
    sweep_setup_webview_dirs(data.path());
    assert!(
        !data
            .path()
            .join(format!("{EPHEMERAL_DIR_PREFIX}abc"))
            .exists()
    );
    assert!(data.path().join("webview").is_dir());
    assert!(data.path().join("site").is_dir());

    // OS `.loam-plugin` path sanitization (including mixed-case extensions & `engine-run` skip).
    let valid_file = data.path().join("sample.loam-plugin");
    std::fs::write(&valid_file, b"placeholder").unwrap();
    let upper_file = data.path().join("UPPER.LOAM-PLUGIN");
    std::fs::write(&upper_file, b"placeholder").unwrap();
    let other_file = data.path().join("notes.txt");
    std::fs::write(&other_file, b"text").unwrap();
    assert!(sanitize_plugin_open_path("sample.loam-plugin", Some(data.path())).is_some());
    assert!(sanitize_plugin_open_path("UPPER.LOAM-PLUGIN", Some(data.path())).is_some());
    assert!(sanitize_plugin_open_path("notes.txt", Some(data.path())).is_none());
    assert!(sanitize_plugin_open_path("--flag.loam-plugin", Some(data.path())).is_none());
    assert!(sanitize_plugin_open_path("missing.loam-plugin", Some(data.path())).is_none());
    assert!(
        first_plugin_arg(
            &[
                "loam-desktop".into(),
                "plugin".into(),
                valid_file.to_string_lossy().into_owned()
            ],
            Some(data.path())
        )
        .is_none()
    );
    assert!(
        first_plugin_arg(
            &[
                "loam-desktop".into(),
                "engine-run".into(),
                valid_file.to_string_lossy().into_owned()
            ],
            Some(data.path())
        )
        .is_none()
    );
    assert!(
        first_plugin_arg(
            &[
                "loam-desktop".into(),
                upper_file.to_string_lossy().into_owned()
            ],
            Some(data.path())
        )
        .is_some()
    );
    let file_url = tauri::Url::from_file_path(&valid_file).unwrap();
    assert!(sanitize_macos_opened_url(&file_url).is_some());
    assert!(
        sanitize_macos_opened_url(&"https://example.com/a.loam-plugin".parse().unwrap()).is_none()
    );

    // Bundled plugin discovery ignores non-manifests and finds valid packed plugin dirs.
    let bundled_root = data.path().join("bundled-plugins");
    write_pure_app_bundle(
        &bundled_root.join("notes"),
        "notes",
        "Notes",
        "1.0.0",
        "notesapp",
    );
    let discovered = discover_bundled_plugins(&bundled_root);
    assert_eq!(discovered.len(), 1);
    assert_eq!(discovered[0].summary.id, "notes");
    assert_eq!(discovered[0].summary.version, "1.0.0");
}

fn write_pure_app_bundle(dir: &Path, plugin_id: &str, title: &str, version: &str, app_id: &str) {
    let app_dir = dir.join("apps").join(app_id).join("dist");
    std::fs::create_dir_all(&app_dir).unwrap();
    std::fs::write(
        app_dir.join("view.js"),
        format!("export const v = '{version}';"),
    )
    .unwrap();
    std::fs::write(
        dir.join("plugin-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "plugin_manifest_version": 1,
            "plugin": {
                "id": plugin_id,
                "title": title,
                "version": version,
                "description": format!("{title} workspace app.")
            },
            "apps": [{
                "id": app_id,
                "path": format!("apps/{app_id}")
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    std::fs::write(
        dir.join("apps").join(app_id).join("app-manifest.json"),
        serde_json::to_vec_pretty(&json!({
            "manifest_version": 1,
            "protocol": 1,
            "plugin": {
                "title": title,
                "version": version,
                "description": format!("{title} workspace app."),
                "id": app_id,
                "kind": "view",
                "domains": [app_id]
            },
            "view": {
                "entry": "dist/view.js"
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn p5_s9_7_multiple_plugins_coexist_upgrade_and_uninstall_independently() {
    let data = tempfile::tempdir().unwrap();
    let src = tempfile::tempdir().unwrap();
    let host = PluginHost::new(data.path(), Some(data.path()), "build-s9-7");
    let store = PendingInstallStore::new();

    // Install two independent pure-app plugins side by side, upgrade one, uninstall the other.
    let alpha_v1 = src.path().join("alpha-v1");
    write_pure_app_bundle(&alpha_v1, "alpha", "Alpha Board", "1.0.0", "alpha");
    let beta_v1 = src.path().join("beta-v1");
    write_pure_app_bundle(&beta_v1, "beta", "Beta Notes", "1.0.0", "beta");

    let p_a = inspect(&host, &alpha_v1, &store).unwrap();
    assert_eq!(p_a.kind, "install");
    confirm(&host, &p_a.proposal_id, &p_a.bundle_sha256, false, &store).unwrap();

    let p_b = inspect(&host, &beta_v1, &store).unwrap();
    assert_eq!(p_b.kind, "install");
    confirm(&host, &p_b.proposal_id, &p_b.bundle_sha256, false, &store).unwrap();

    let (installed, revs) = list_installed(&host).unwrap();
    assert_eq!(installed.len(), 2);
    assert!(revs.is_empty());

    // Upgrade `alpha` to 2.0.0 without disturbing `beta`.
    let alpha_v2 = src.path().join("alpha-v2");
    write_pure_app_bundle(&alpha_v2, "alpha", "Alpha Board", "2.0.0", "alpha");
    let p_a2 = inspect(&host, &alpha_v2, &store).unwrap();
    assert_eq!(p_a2.kind, "upgrade");
    assert_eq!(p_a2.previous.as_ref().unwrap().version, "1.0.0");
    confirm(&host, &p_a2.proposal_id, &p_a2.bundle_sha256, false, &store).unwrap();

    // Uninstall `beta` and verify `alpha` remains intact in `deployment.json`.
    let removed = uninstall(&host, "beta").unwrap();
    assert!(removed.uninstalled && removed.data_preserved && removed.reload_required);
    let (remaining, _) = list_installed(&host).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "alpha");
    assert_eq!(remaining[0].version, "2.0.0");
    let deployment = std::fs::read_to_string(data.path().join("site/deployment.json")).unwrap();
    assert!(deployment.contains("\"instance\": \"alpha\""));
    assert!(!deployment.contains("\"instance\": \"beta\""));
}
