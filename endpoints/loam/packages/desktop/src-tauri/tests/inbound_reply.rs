//! P6-D6's `inbound_reply` (phase 6 specification, 10.8), driven through Tauri's IPC on its mock runtime with the app's
//! own configuration and capability, as P6-D4's origin case is, and an endpoint serving: an id the host never issued,
//! or one already answered, does nothing and answers `false`; the issued one answers `true` and reaches its request;
//! `{ ready: true }` answers whether it was accepted. The desktop suite's own case runs only in CI.
use loam_desktop::inbound::{Deliver, Inbound};
use loam_desktop::models::Models;
use loam_desktop::mounts::Mounts;
use loam_desktop::site::shell_origin;
use loam_desktop::{InboundState, MAIN, handler};
use serde_json::{Value, json};
use std::borrow::Cow;
use std::sync::{Arc, Mutex};
use tauri::WebviewWindowBuilder;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, get_ipc_response, mock_builder};

fn empty() -> tauri::http::Response<Cow<'static, [u8]>> {
    tauri::http::Response::new(Cow::Borrowed(&[][..]))
}

#[test]
fn p6_d6_inbound_reply_answers_false_for_an_id_never_issued_or_already_answered() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let delivered: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let deliver: Deliver = {
        let delivered = delivered.clone();
        Arc::new(move |statement| delivered.lock().unwrap().push(statement))
    };
    // An endpoint on a free port, ready, with one request waiting.
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let endpoint = Inbound::new(port, "t0ken", deliver);
    assert!(endpoint.set_ready());
    let (_stop, stopped) = tokio::sync::watch::channel(false);
    runtime.spawn(loam_desktop::inbound::serve(
        listener,
        endpoint.clone(),
        stopped,
    ));
    let waiting = runtime.spawn(async move {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("http://127.0.0.1:{port}/mcp"))
            .header("Authorization", "Bearer t0ken")
            .body(json!({ "jsonrpc": "2.0", "id": 7, "method": "ping" }).to_string())
            .send()
            .await
            .unwrap()
    });
    // The request reaches the "webview", or the test fails with why, never waits out CI's job.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while delivered.lock().unwrap().is_empty() {
        assert!(
            !waiting.is_finished(),
            "the request ended before it was delivered"
        );
        assert!(
            std::time::Instant::now() < deadline,
            "the request was never delivered"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }

    let app = mock_builder()
        .register_uri_scheme_protocol("loam", |_, _| empty())
        .register_uri_scheme_protocol("loam-sandbox", |_, _| empty())
        .invoke_handler(handler())
        .manage(Arc::new(Mounts::new(Ok(Vec::new()))))
        .manage(Arc::new(Models::new(Ok(Vec::new()))))
        .manage(InboundState::serving(endpoint.clone()))
        .build(tauri::generate_context!("tauri.conf.json", test = true))
        .expect("a mock app");
    let webview = WebviewWindowBuilder::new(&app, MAIN, Default::default())
        .build()
        .expect("the main webview");
    let call = |body: Value| {
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert("Origin", shell_origin().parse().unwrap());
        get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "inbound_reply".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: shell_origin().parse().unwrap(),
                body: InvokeBody::Json(body),
                headers,
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .expect("an answer")
        .deserialize::<Value>()
        .unwrap()
    };
    let answer = json!({ "jsonrpc": "2.0", "id": 7, "result": "real" });
    // Never issued, a call with neither field, and the host's own id: only the last reaches the request.
    assert_eq!(
        call(json!({ "id": 987_654, "message": answer })),
        json!(false)
    );
    assert_eq!(call(json!({})), json!(false));
    assert_eq!(call(json!({ "id": 1, "message": answer })), json!(true));
    // Already answered: nothing.
    assert_eq!(call(json!({ "id": 1, "message": answer })), json!(false));
    // Ready while no page load is under way is accepted.
    assert_eq!(call(json!({ "ready": true })), json!(true));
    let response = runtime.block_on(waiting).unwrap();
    assert_eq!(response.status(), 200);
    let body: Value = serde_json::from_slice(&runtime.block_on(response.bytes()).unwrap()).unwrap();
    assert_eq!(body["result"], "real");
}
