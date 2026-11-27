//! The desktop's `http` lane carrying a person's approval (phase 5 specification, 7.2; #2137), against a small HTTP
//! server in this process standing in for an MCP 2026-07-28 server:
//!
//! 1. `the_http_lane_sends_the_eras_headers_with_no_session_and_the_body_unchanged`: a request the page opened on the
//!    era carries `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`, derived from its own body, and no
//!    `Mcp-Session-Id`; the approval key in its `_meta` reaches the server untouched; a 2025 message keeps its session
//!    and gets none of the era's headers.
//! 2. `no_approval_token_or_bearer_reaches_a_log`: in a child process with `logging::init()`, as the app starts, the
//!    retry carrying a token and the server's held answer carrying another both pass through `mount_send` on Tauri's
//!    IPC, and neither token, nor the bearer, appears on stdout or stderr. `get_ipc_response` enters `on_message`
//!    directly, skipping the protocol handler whose TRACE spans record every body (`ipc/protocol.rs`): those spans are
//!    `logging.rs`'s unit's, and the desktop suite's `http` case reads the app's stderr through the real handler.
use loam_desktop::models::Models;
use loam_desktop::mounts::{Access, Mounts, Notify, RESULT_INVALID};
use loam_desktop::site::shell_origin;
use loam_desktop::{InboundState, MAIN, handler};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::WebviewWindowBuilder;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};

const CHILD_ENV: &str = "LOAM_TEST_HTTP_APPROVALS_CHILD";
const URL_ENV: &str = "LOAM_TEST_HTTP_APPROVALS_URL";
/// What the shell presents on the retry, and what the server issues on the held answer: AFD's tokens begin `afdap1.`.
const SHELL_TOKEN: &str = "afdap1.shell-presents-c0ffee-2137";
const SERVER_TOKEN: &str = "afdap1.server-issues-5eed-2137";
const BEARER: &str = "loam-http-approvals-bearer-7a1b";
const MODERN: &str = "2026-07-28";

/// One request the server read: its headers, by lower-case name, and its body.
struct Seen {
    headers: HashMap<String, String>,
    body: Value,
}

/// A server on loopback answering each POST as an MCP server would, recording what it read.
fn serve() -> (String, Arc<Mutex<Vec<Seen>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let record = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut headers = HashMap::new();
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    break;
                }
                let (name, value) = trimmed.split_once(':').unwrap();
                headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
            }
            let length: usize = headers
                .get("content-length")
                .map_or(0, |value| value.parse().unwrap());
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let (answer, session) = answer(&body);
            record.lock().unwrap().push(Seen { headers, body });
            let text = answer.to_string();
            let session = session
                .map(|id| format!("Mcp-Session-Id: {id}\r\n"))
                .unwrap_or_default();
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{session}Content-Length: {}\r\nConnection: close\r\n\r\n{text}",
                text.len()
            );
        }
    });
    (url, seen)
}

/// The server's answer to one message, and the session an `initialize` opens.
fn answer(body: &Value) -> (Value, Option<&'static str>) {
    let id = body["id"].clone();
    match body["method"].as_str() {
        Some("initialize") => (
            json!({ "jsonrpc": "2.0", "id": id, "result": { "protocolVersion": "2025-06-18" } }),
            Some("session-2025"),
        ),
        Some("server/discover") => (
            json!({ "jsonrpc": "2.0", "id": id, "result": { "supportedVersions": [MODERN] } }),
            None,
        ),
        Some("tools/call") if body["params"]["_meta"]["dev.afd/approval"].is_null() => {
            let held = json!({
                "success": false,
                "error": { "code": "APPROVAL_REQUIRED", "message": "Held", "details": { "approvalToken": SERVER_TOKEN } },
            });
            (
                json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [{ "type": "text", "text": held.to_string() }], "structuredContent": held } }),
                None,
            )
        }
        _ => (
            json!({ "jsonrpc": "2.0", "id": id, "result": { "content": [], "structuredContent": { "success": true, "data": { "sent": "snt_1" } } } }),
            None,
        ),
    }
}

/// A message as the page builds it on the era: its keys on `_meta`, beside the kernel's.
fn modern(id: u64, method: &str, params: Value, extra: Value) -> Value {
    let mut params = params;
    let mut meta = json!({
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { "name": "loam", "version": "1" },
        "dev.loam/scope": { "workspace": "personal" },
    });
    for (key, value) in extra.as_object().unwrap() {
        meta[key] = value.clone();
    }
    params["_meta"] = meta;
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn entry(url: &str) -> Access {
    serde_json::from_value(json!({ "instance": "mail", "url": url, "bearer": BEARER })).unwrap()
}

#[tokio::test]
async fn the_http_lane_sends_the_eras_headers_with_no_session_and_the_body_unchanged() {
    let (url, seen) = serve();
    let mounts = Mounts::new(Ok(vec![entry(&url)]));
    let notify: Notify = Arc::new(|_, _| {});
    let handle = mounts.open("mail", notify.clone()).await.unwrap();

    // The 2025 handshake first, as a server that does not speak the era is opened: it opens a session.
    let initialize = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } });
    mounts
        .send(handle, initialize, notify.clone())
        .await
        .unwrap();
    let discover = modern(2, "server/discover", json!({}), json!({}));
    let answered = mounts.send(handle, discover, notify.clone()).await.unwrap();
    assert_eq!(answered["result"]["supportedVersions"], json!([MODERN]));
    let retry = modern(
        3,
        "tools/call",
        json!({ "name": "mail-draft-send", "arguments": { "draft": "drf_1" } }),
        json!({ "dev.afd/approval": SHELL_TOKEN }),
    );
    let sent = mounts
        .send(handle, retry.clone(), notify.clone())
        .await
        .unwrap();
    assert_eq!(sent["result"]["structuredContent"]["success"], json!(true));
    let named = modern(
        4,
        "tools/call",
        json!({ "name": "café", "arguments": {} }),
        json!({}),
    );
    mounts.send(handle, named, notify.clone()).await.unwrap();
    let legacy = json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/list", "params": {} });
    mounts.send(handle, legacy, notify.clone()).await.unwrap();

    let seen = seen.lock().unwrap();
    let header = |index: usize, name: &str| seen[index].headers.get(name).cloned();
    // Every request carries the bearer, on either era.
    for index in 0..5 {
        assert_eq!(
            header(index, "authorization"),
            Some(format!("Bearer {BEARER}"))
        );
    }
    assert_eq!(header(0, "mcp-protocol-version"), None);
    // The era's requests: its headers from their own bodies, and no session.
    assert_eq!(header(1, "mcp-protocol-version").as_deref(), Some(MODERN));
    assert_eq!(header(1, "mcp-method").as_deref(), Some("server/discover"));
    assert_eq!(header(1, "mcp-name"), None);
    assert_eq!(header(1, "mcp-session-id"), None);
    assert_eq!(header(2, "mcp-protocol-version").as_deref(), Some(MODERN));
    assert_eq!(header(2, "mcp-method").as_deref(), Some("tools/call"));
    assert_eq!(header(2, "mcp-name").as_deref(), Some("mail-draft-send"));
    assert_eq!(header(2, "mcp-session-id"), None);
    // The body as the page sent it: the approval key reaches the server in `_meta`, untouched, and in no header.
    assert_eq!(seen[2].body, retry);
    assert!(
        seen[2]
            .headers
            .values()
            .all(|value| !value.contains(SHELL_TOKEN))
    );
    assert_eq!(
        header(3, "mcp-name").as_deref(),
        Some("=?base64?Y2Fmw6k=?=")
    );
    // A 2025 message keeps the session `initialize` opened, and gets none of the era's headers.
    assert_eq!(header(4, "mcp-session-id").as_deref(), Some("session-2025"));
    assert_eq!(header(4, "mcp-protocol-version"), None);
    assert_eq!(header(4, "mcp-method"), None);
}

#[tokio::test]
async fn a_request_naming_another_version_is_refused_before_it_is_sent() {
    let (url, seen) = serve();
    let mounts = Mounts::new(Ok(vec![entry(&url)]));
    let notify: Notify = Arc::new(|_, _| {});
    let handle = mounts.open("mail", notify.clone()).await.unwrap();
    let mut forged = modern(1, "tools/list", json!({}), json!({}));
    forged["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"] =
        json!("2026-07-28\r\nX-Injected: 1");
    assert_eq!(
        mounts.send(handle, forged, notify).await.err(),
        Some(RESULT_INVALID)
    );
    assert!(seen.lock().unwrap().is_empty());
}

fn empty() -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::new(Cow::Borrowed(&[][..]))
}

/// The child: the app's own logging and IPC, `mount_open` and two `mount_send`s, the held call and its retry.
fn run_child(url: &str) {
    loam_desktop::logging::init();
    let app = mock_builder()
        .register_uri_scheme_protocol("loam", |_, _| empty())
        .register_uri_scheme_protocol("loam-sandbox", |_, _| empty())
        .invoke_handler(handler())
        .manage(Arc::new(Mounts::new(Ok(vec![entry(url)]))))
        .manage(Arc::new(Models::new(Ok(Vec::new()))))
        .manage(InboundState::default())
        .build(tauri::generate_context!("tauri.conf.json", test = true))
        .expect("a mock app");
    let webview = WebviewWindowBuilder::new(&app, MAIN, Default::default())
        .build()
        .expect("the main webview");
    let call = |command: &str, body: Value| {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("Origin", shell_origin().parse().expect("a header value"));
        get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: shell_origin().parse().expect("a URL"),
                body: InvokeBody::Json(body),
                headers,
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .expect("an answer")
        .deserialize::<Value>()
        .expect("JSON")
    };
    let handle = call("mount_open", json!({ "instance": "mail" }));
    let input = json!({ "name": "mail-draft-send", "arguments": { "draft": "drf_1" } });
    let held = call(
        "mount_send",
        json!({ "handle": handle, "message": modern(1, "tools/call", input.clone(), json!({})) }),
    );
    // The host carries the server's answer to the page whole: the kernel strips the token (7.2), not the transport.
    assert!(held.to_string().contains(SERVER_TOKEN));
    let retried = call(
        "mount_send",
        json!({ "handle": handle, "message": modern(2, "tools/call", input, json!({ "dev.afd/approval": SHELL_TOKEN })) }),
    );
    assert_eq!(
        retried["result"]["structuredContent"]["success"],
        json!(true)
    );
    // Anything a crate might log at any level, as the host's own lines would be: the subscriber drops every one.
    tracing::trace!(target: "tauri::ipc", body = %held, "ipc::request::response");
    tracing::error!(target: "loam_desktop::mounts", "carried {SERVER_TOKEN} with {BEARER}");
    tracing::error!(target: "tauri::webview", "carried {SHELL_TOKEN}");
}

#[test]
fn no_approval_token_or_bearer_reaches_a_log() {
    if std::env::var_os(CHILD_ENV).is_some() {
        run_child(&std::env::var(URL_ENV).expect("the server's URL"));
        return;
    }
    let (url, seen) = serve();
    let output = Command::new(std::env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "no_approval_token_or_bearer_reaches_a_log",
            "--nocapture",
        ])
        .env(CHILD_ENV, "1")
        .env(URL_ENV, &url)
        .output()
        .expect("spawn child test");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "child failed: stdout={stdout} stderr={stderr}"
    );
    // The retry reached the server with the shell's token, so it did cross the host.
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    assert_eq!(
        seen[1].body["params"]["_meta"]["dev.afd/approval"],
        json!(SHELL_TOKEN)
    );
    // A failure names the secret by its label and the stream it reached, never the secret or the stream's text.
    for (label, secret) in [
        ("the shell's token", SHELL_TOKEN),
        ("the server's token", SERVER_TOKEN),
        ("an approval token's prefix", "afdap1."),
        ("the bearer", BEARER),
    ] {
        assert!(!stdout.contains(secret), "{label} reached stdout");
        assert!(!stderr.contains(secret), "{label} reached stderr");
    }
}
