//! P6-D4's origin case (phase 6 specification, 10.2 as amended by the coordinator on 2026-11-16): an `invoke`
//! that reaches a command from anywhere but the shell is refused by the command's own origin check. It runs
//! through Tauri's IPC on its mock runtime, with the app's own configuration and capability and its two schemes
//! registered, so Tauri's ACL decides as it does in the app: it lets the sandbox's origin through, as a local
//! one, and only the check refuses it.
use loam_desktop::mounts::{INSTANCE_UNKNOWN, Mounts};
use loam_desktop::site::{sandbox_origin, shell_origin};
use loam_desktop::{MAIN, ORIGIN_REFUSED, handler};
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
    let app = mock_builder()
        .register_uri_scheme_protocol("loam", |_, _| empty())
        .register_uri_scheme_protocol("loam-sandbox", |_, _| empty())
        .invoke_handler(handler())
        .manage(Arc::new(Mounts::new(Ok(Vec::new()))))
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
    ];

    // The shell passes the ACL and the check, and the command answers.
    let shell = call(
        "mount_open",
        shell_origin(),
        Some(shell_origin()),
        json!({ "instance": "missing" }),
    );
    assert_eq!(shell.unwrap_err(), json!(INSTANCE_UNKNOWN));

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
}
