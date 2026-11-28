//! P6-D4's origin case (phase 6 specification, 10.2 as amended by the coordinator on 2026-11-16): an `invoke`
//! that reaches a command from anywhere but the shell is refused by the command's own origin check. It runs
//! through Tauri's IPC on its mock runtime, with the app's own configuration and capability and its two schemes
//! registered, so Tauri's ACL decides as it does in the app: it lets the sandbox's origin through, as a local
//! one, and only the check refuses it. Phase 5's step 2 adds `model_send` and `model_cancel` (its 4.2 and
//! P5-A3: "from the sandbox proxy and a view it is refused"), and step 11b `inbound_reply` (10.8 and P6-D6: "from the
//! proxy frame or a view is refused").
use loam_desktop::models::{Models, PROVIDER_UNKNOWN};
use loam_desktop::mounts::{INSTANCE_UNKNOWN, Mounts};
use loam_desktop::setup_window::{SetupState, host_setup_origin};
use loam_desktop::site::{self, sandbox_origin, shell_origin};
use loam_desktop::{DataDirectory, InboundState, MAIN, ORIGIN_REFUSED, SiteState, handler};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::sync::Arc;
use tauri::WebviewWindowBuilder;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};

fn empty() -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::new(Cow::Borrowed(&[][..]))
}

#[test]
fn p6_d4_an_invoke_from_a_frame_is_refused_by_the_origin_check_itself() {
    let data = tempfile::tempdir().expect("temp data dir");
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
        .expect("a mock app");
    let webview = WebviewWindowBuilder::new(&app, MAIN, Default::default())
        .build()
        .expect("the main webview");
    // As Tauri's fetch delivers a request: its URL from the frame's origin, and the browser's `Origin` header.
    let call = |command: &str, url: &str, origin: Option<&str>, body: Value| {
        let mut headers = tauri::http::HeaderMap::new();
        if let Some(origin) = origin {
            headers.insert("Origin", origin.parse().expect("a header value"));
        }
        get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: url.parse().expect("a URL"),
                body: InvokeBody::Json(body),
                headers,
                invoke_key: INVOKE_KEY.into(),
            },
        )
    };
    let commands = [
        ("mount_open", json!({ "instance": "missing" })),
        ("mount_send", json!({ "handle": 1, "message": {} })),
        ("mount_close", json!({ "handle": 1 })),
        (
            "model_send",
            json!({ "provider": "claude", "body": { "max_tokens": 1, "messages": [] }, "stream": 1 }),
        ),
        ("model_cancel", json!({ "stream": 1 })),
        (
            "inbound_reply",
            json!({ "id": 1, "message": { "jsonrpc": "2.0", "id": 1, "result": {} } }),
        ),
        ("inbound_reply", json!({ "ready": true })),
        ("setup_open", json!({ "section": "models" })),
    ];

    // The shell passes the ACL and the check, and the command answers.
    let shell = call(
        "mount_open",
        shell_origin(),
        Some(shell_origin()),
        json!({ "instance": "missing" }),
    );
    assert_eq!(shell.unwrap_err(), json!(INSTANCE_UNKNOWN));
    let model = call(
        "model_send",
        shell_origin(),
        Some(shell_origin()),
        json!({ "provider": "claude", "body": { "max_tokens": 1, "messages": [] }, "stream": 1 }),
    );
    assert_eq!(model.unwrap_err(), json!(PROVIDER_UNKNOWN));
    assert!(
        call(
            "model_cancel",
            shell_origin(),
            Some(shell_origin()),
            json!({ "stream": 1 })
        )
        .is_ok()
    );

    // `inbound_reply` from the shell passes, and with no endpoint serving does nothing and answers `true`, so a page
    // on a desktop with the endpoint off stops asking at once (10.8).
    for body in [
        json!({ "ready": true }),
        json!({ "id": 1, "message": { "jsonrpc": "2.0", "id": 1, "result": {} } }),
    ] {
        assert_eq!(
            call("inbound_reply", shell_origin(), Some(shell_origin()), body)
                .unwrap()
                .deserialize::<Value>()
                .unwrap(),
            json!(true)
        );
    }

    // The sandbox proxy frame: a local origin to Tauri, so its ACL admits the call, and the check refuses it.
    for (command, body) in &commands {
        assert_eq!(
            call(
                command,
                sandbox_origin(),
                Some(sandbox_origin()),
                body.clone()
            )
            .unwrap_err(),
            json!(ORIGIN_REFUSED),
            "{command} from the sandbox"
        );
    }

    // The opaque view frame's `null`, a missing `Origin`, and another site's header on the shell's URL: each
    // refused by the check.
    for origin in [Some("null"), None, Some("https://example.com")] {
        for (command, body) in &commands {
            assert_eq!(
                call(command, shell_origin(), origin, body.clone()).unwrap_err(),
                json!(ORIGIN_REFUSED),
                "{command} with Origin {origin:?}"
            );
        }
    }

    // `tauri-plugin-updater` is registered for Rust-only updates (10.6), with zero JavaScript permissions in
    // `capabilities/main.json`: even the main webview with the shell's origin is refused every updater command.
    for command in [
        "plugin:updater|check",
        "plugin:updater|download",
        "plugin:updater|install",
        "plugin:updater|download_and_install",
    ] {
        let err = call(command, shell_origin(), Some(shell_origin()), json!({})).unwrap_err();
        let text = err.to_string().to_ascii_lowercase();
        assert!(
            text.contains("not allowed") || text.contains("denied"),
            "expected ACL refusal for {command}, got: {text}"
        );
    }

    // `setup_open` rejects `host_setup_origin()`, unknown fields, and invalid sections from `main`.
    assert_eq!(
        call(
            "setup_open",
            host_setup_origin(),
            Some(host_setup_origin()),
            json!({ "section": "models" })
        )
        .unwrap_err(),
        json!(ORIGIN_REFUSED)
    );
    assert_eq!(
        call(
            "setup_open",
            shell_origin(),
            Some(shell_origin()),
            json!({ "section": "models", "path": "/etc/passwd" })
        )
        .unwrap_err(),
        json!("DESKTOP_SETUP_INPUT_INVALID")
    );
}
