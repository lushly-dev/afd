//! The work a running server carries on (the specification's 3.2): sync at
//! once, again after its interval and when asked; a rebuild when asked; and
//! the limits on a call to a server.

#![allow(clippy::expect_used, clippy::unwrap_used)]

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use afd::CommandRegistry;
use axum::body::Body;
use http_body_util::BodyExt;
use loam_mail::cli::{Local, Runner};
use loam_mail::engine::{Engine, Limits};
use loam_mail::forward::Server as Forward;
use loam_mail::home::Home;
use loam_mail::provider::imap::{Credentials, Endpoint, ICLOUD_NAMES, ImapConnector};
use loam_mail::serve::{router, running};
use loam_mail::sync::Options;
use loam_mail::work::Worker;
use serde_json::{Value, json};
use support::imap::{PASSWORD, Server, USER, message};
use tower::ServiceExt;

/// An engine whose provider is the IMAP server at `port`, with one account.
fn engine_at(home: &Home, port: u16, every: Duration, limits: Limits) -> Arc<Engine> {
    let endpoint = Endpoint {
        host: "127.0.0.1".to_string(),
        port,
        tls: false,
    };
    let connector = ImapConnector::new(endpoint, ICLOUD_NAMES, |_| {
        Ok(Credentials {
            user: USER.to_string(),
            password: PASSWORD.to_string(),
        })
    });
    let engine = Engine::new(Some(home.clone()))
        .with_connector(Arc::new(connector))
        .with_limits(limits)
        .with_sync_options(Options {
            backoff: Duration::ZERO,
            every,
            ..Options::default()
        });
    engine
        .with_store(|store| store.add_account("icloud", USER, 0).map(|_| ()))
        .unwrap();
    Arc::new(engine)
}

/// Asks the server `forward` reaches for `mail-status` until `done` holds.
async fn status_until(forward: &Forward, what: &str, done: impl Fn(&Value) -> bool) -> Value {
    let started = Instant::now();
    loop {
        let status = forward.run("mail-status", json!({}), false, None).await;
        let data = status.data.clone().unwrap_or(Value::Null);
        if done(&data) {
            return data;
        }
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "{what}: {status:?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn headers_held(status: &Value) -> u64 {
    status["accounts"][0]["mailboxes"]
        .as_array()
        .map(|mailboxes| {
            mailboxes
                .iter()
                .map(|mailbox| mailbox["headers"].as_u64().unwrap_or(0))
                .sum()
        })
        .unwrap_or(0)
}

/// Starts `loam-mail serve` in this process and waits for its files.
async fn serve(
    engine: &Arc<Engine>,
    home: &Home,
) -> (
    tokio::sync::oneshot::Sender<()>,
    tokio::task::JoinHandle<Result<(), String>>,
    Forward,
) {
    let registry = Arc::new(loam_mail::registry(engine).unwrap());
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(loam_mail::serve::serve(
        Arc::clone(engine),
        registry,
        0,
        async move {
            let _ = stopped.await;
        },
        |_| {},
    ));
    let started = Instant::now();
    while running(home).is_none() {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "no server.json"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    (stop, server, Forward::find(home).unwrap())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_syncs_at_once_and_when_asked_and_rebuilds_when_asked() {
    let imap = Server::start(true, true);
    {
        let mut world = imap.world();
        world.mailbox("INBOX", &[]);
        world.add("INBOX", message(1, "One", None, "first"), &[]);
        world.add("INBOX", message(2, "Two", None, "second"), &[]);
    }
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    // No pass is due again within the test: the second comes only when asked.
    let engine = engine_at(
        &home,
        imap.address.port(),
        Duration::from_secs(3600),
        Limits::default(),
    );
    let (stop, server, forward) = serve(&engine, &home).await;

    // The first pass runs as the server starts.
    let status = status_until(&forward, "the first pass", |status| {
        !status["work"]["sync"]["last"].is_null()
    })
    .await;
    assert_eq!(headers_held(&status), 2, "{status}");
    assert_eq!(
        status["work"]["sync"]["last"]["outcome"]["accounts"][0]["account"],
        json!(1),
        "{status}"
    );
    let first_ended = status["work"]["sync"]["last"]["endedAt"].as_i64().unwrap();
    assert_eq!(
        status["work"]["sync"]["everyAccountDueAt"]
            .as_i64()
            .unwrap(),
        first_ended + 3_600_000
    );

    // New mail, and a pass asked for: the call returns at once, the pass runs
    // in the server.
    imap.world()
        .add("INBOX", message(3, "Three", None, "third"), &[]);
    let asked = forward.run("mail-sync", json!({}), false, None).await;
    assert!(asked.success, "{asked:?}");
    let asked = asked.data.unwrap();
    assert_eq!(asked["work"], json!("sync"));
    assert_eq!(asked["queued"], json!(true));
    let status = status_until(&forward, "the pass asked for", |status| {
        status["work"]["sync"]["last"]["endedAt"].as_i64() > Some(first_ended)
    })
    .await;
    assert_eq!(headers_held(&status), 3, "{status}");

    // An account that is not there is refused at once; `follow` is not for
    // a server.
    let refused = forward
        .run("mail-sync", json!({ "account": 9 }), false, None)
        .await;
    assert_eq!(refused.error.unwrap().code, "ACCOUNT_NOT_FOUND");
    let refused = forward
        .run("mail-sync", json!({ "follow": true }), false, None)
        .await;
    assert_eq!(refused.error.unwrap().code, "INVALID_INPUT");

    // A rebuild, asked for, runs in the server and is reported.
    let asked = forward.run("mail-rebuild", json!({}), false, None).await;
    assert_eq!(asked.data.unwrap()["queued"], json!(true));
    let status = status_until(&forward, "the rebuild", |status| {
        !status["work"]["rebuild"]["last"].is_null()
    })
    .await;
    let rebuilt = &status["work"]["rebuild"]["last"]["outcome"];
    assert_eq!(rebuilt["messages"], json!(3), "{status}");
    assert_eq!(rebuilt["resumed"], json!(false), "{status}");
    // Search works again once it is done.
    let found = forward
        .run("mail-search", json!({ "query": "third" }), false, None)
        .await;
    assert!(found.success, "{found:?}");

    stop.send(()).unwrap();
    server.await.unwrap().unwrap();
    assert!(!engine.work().serving());
    assert_eq!(engine.work().status(), Value::Null);
    // The provider was only read.
    let log = imap.take_log();
    assert!(!log.is_empty());
    for command in log {
        let upper = command.to_ascii_uppercase();
        let verb = upper.split(' ').next().unwrap_or_default();
        let allowed = match verb {
            "CAPABILITY" | "LOGIN" | "ENABLE" | "LIST" | "EXAMINE" | "LOGOUT" => true,
            "UID" => {
                let sub = upper.split(' ').nth(1).unwrap_or_default();
                (sub == "SEARCH" || sub == "FETCH") && !upper.contains("BODY[")
            }
            _ => false,
        };
        assert!(allowed, "the server's work sent `{command}`");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_server_syncs_again_when_its_interval_has_passed() {
    let imap = Server::start(true, true);
    imap.world().mailbox("INBOX", &[]);
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    let engine = engine_at(
        &home,
        imap.address.port(),
        Duration::from_millis(200),
        Limits::default(),
    );
    let (stop, server, forward) = serve(&engine, &home).await;
    status_until(&forward, "the first pass", |status| {
        !status["work"]["sync"]["last"].is_null()
    })
    .await;
    imap.world()
        .add("INBOX", message(1, "Later", None, "later"), &[]);
    // Nothing is asked for: the next pass comes by itself.
    status_until(&forward, "a pass by itself", |status| {
        headers_held(status) == 1
    })
    .await;
    stop.send(()).unwrap();
    server.await.unwrap().unwrap();
}

async fn post(app: &axum::Router, path: &str, token: &str, body: Value) -> Value {
    let mut request = axum::http::Request::post(path)
        .header("host", "127.0.0.1:4321")
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    if path == "/mcp" {
        request = request.header("mcp-protocol-version", "2026-07-28").header(
            "mcp-method",
            body["method"].as_str().unwrap_or_default().to_string(),
        );
        if let Some(name) = body["params"]["name"].as_str() {
            request = request.header("mcp-name", name.to_string());
        }
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::String(text.clone()))
    })
}

/// Makes an agent's token at the terminal in this process and returns it.
async fn agent_token(registry: &CommandRegistry) -> String {
    let local = Local(registry);
    let input = json!({ "name": "claude" });
    let held = local
        .run("mail-token-create", input.clone(), true, None)
        .await;
    let approval = held.error.unwrap().details.unwrap()["approvalToken"]
        .as_str()
        .unwrap()
        .to_string();
    let made = local
        .run("mail-token-create", input, true, Some(approval))
        .await;
    made.data.unwrap()["secret"].as_str().unwrap().to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_call_to_a_server_stops_at_its_limit_on_either_route() {
    let imap = Server::start(true, true);
    {
        let mut world = imap.world();
        world.mailbox("INBOX", &[]);
        // Junk is held as headers: its bodies are fetched when opened.
        world.mailbox("Junk", &[]);
        world.add("Junk", message(1, "Prize", None, "claim it"), &[]);
    }
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    let engine = engine_at(
        &home,
        imap.address.port(),
        Duration::from_secs(3600),
        Limits {
            call: Duration::from_millis(300),
            ..Limits::default()
        },
    );
    let registry: Arc<CommandRegistry> = Arc::new(loam_mail::registry(&engine).unwrap());
    let agent = agent_token(&registry).await;
    let app = router(&registry, Arc::clone(&engine), 4321, "lmail_cli_test").unwrap();
    let worker = Worker::start(&engine);
    let started = Instant::now();
    while engine.work().status()["sync"]["last"].is_null() {
        assert!(
            started.elapsed() < Duration::from_secs(30),
            "the first pass"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let found = Local(&registry)
        .run("mail-search", json!({ "query": "Prize" }), false, None)
        .await;
    let message = found.data.unwrap()["hits"][0]["message"].as_i64().unwrap();
    // From now on the provider takes each connection and never answers.
    imap.world().stall = true;

    // Over MCP: opening the message fetches its body, and is stopped.
    let started = Instant::now();
    let call = json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {
            "name": "afd-call",
            "arguments": { "command": "mail-message-open", "input": { "message": message } },
            "_meta": {
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
            },
        },
    });
    let body = post(&app, "/mcp", &agent, call).await;
    assert!(body.to_string().contains("TIMEOUT"), "{body}");
    assert!(started.elapsed() < Duration::from_secs(10));

    // On the command line's route: adding an account signs in to the
    // provider, and is stopped.
    loam_mail::secrets::Secrets::set(
        engine.secrets().as_ref(),
        &loam_mail::secrets::account_key("icloud", "person@example.com"),
        "app-password",
    )
    .unwrap();
    let input = json!({ "provider": "icloud", "address": "person@example.com" });
    let held = post(
        &app,
        "/cli",
        "lmail_cli_test",
        json!({ "command": "mail-account-add", "input": input, "terminal": true }),
    )
    .await;
    let approval = held["error"]["details"]["approvalToken"]
        .as_str()
        .unwrap_or_else(|| panic!("{held}"))
        .to_string();
    let started = Instant::now();
    let added = post(
        &app,
        "/cli",
        "lmail_cli_test",
        json!({
            "command": "mail-account-add", "input": input, "terminal": true,
            "approval": approval,
        }),
    )
    .await;
    assert_eq!(added["error"]["code"], json!("TIMEOUT"), "{added}");
    assert!(started.elapsed() < Duration::from_secs(10));
    worker.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_rebuild_a_stop_left_is_carried_on_when_a_server_starts() {
    let imap = Server::start(true, true);
    {
        let mut world = imap.world();
        world.mailbox("INBOX", &[]);
        world.add("INBOX", message(1, "One", None, "first"), &[]);
        world.add("INBOX", message(2, "Two", None, "second"), &[]);
    }
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    let engine = engine_at(
        &home,
        imap.address.port(),
        Duration::from_secs(3600),
        Limits::default(),
    );
    // Synced at the command line, then a rebuild begun and stopped at once.
    let registry = loam_mail::registry(&engine).unwrap();
    let synced = Local(&registry)
        .run("mail-sync", json!({}), false, None)
        .await;
    assert!(synced.success, "{synced:?}");
    engine.with_store(|store| store.rebuild_begin()).unwrap();
    imap.world()
        .add("INBOX", message(3, "Three", None, "third"), &[]);

    // The server carries the rebuild on before its first pass, so the mail
    // that pass brings is derived and found.
    let (stop, server, forward) = serve(&engine, &home).await;
    let status = status_until(&forward, "the rebuild and a pass", |status| {
        !status["work"]["rebuild"]["last"].is_null() && !status["work"]["sync"]["last"].is_null()
    })
    .await;
    let rebuild = &status["work"]["rebuild"]["last"];
    assert_eq!(rebuild["outcome"]["resumed"], json!(true), "{status}");
    assert!(
        rebuild["endedAt"].as_i64() <= status["work"]["sync"]["last"]["startedAt"].as_i64(),
        "{status}"
    );
    let found = forward
        .run("mail-search", json!({ "query": "Three" }), false, None)
        .await;
    assert_eq!(found.data.unwrap()["hits"].as_array().unwrap().len(), 1);
    assert!(!engine.with_store(|store| store.rebuilding()).unwrap());
    stop.send(()).unwrap();
    server.await.unwrap().unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_reply_larger_than_a_call_may_return_is_refused_only_on_a_server() {
    let directory = tempfile::tempdir().unwrap();
    let home = Home::at(directory.path().join("data"));
    let engine = Arc::new(Engine::new(Some(home)).with_limits(Limits {
        reply: 600,
        ..Limits::default()
    }));
    let registry = loam_mail::registry(&engine).unwrap();
    let local = Local(&registry);
    for n in 0..10 {
        let input = json!({ "name": format!("agent number {n}") });
        let held = local
            .run("mail-token-create", input.clone(), true, None)
            .await;
        let approval = held.error.unwrap().details.unwrap()["approvalToken"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(
            local
                .run("mail-token-create", input, true, Some(approval))
                .await
                .success
        );
    }
    // At the command line with no server, the reply is whole.
    let listed = local.run("mail-token-list", json!({}), false, None).await;
    assert!(listed.success, "{listed:?}");
    // On a server it is refused, and says why in the engine's words.
    let worker = Worker::start(&engine);
    let listed = local.run("mail-token-list", json!({}), false, None).await;
    let error = listed.error.unwrap();
    assert_eq!(error.code, "REPLY_TOO_LARGE");
    assert!(!error.message.contains("agent number"), "{}", error.message);
    worker.stop().await;
    assert!(
        local
            .run("mail-token-list", json!({}), false, None)
            .await
            .success
    );
}
