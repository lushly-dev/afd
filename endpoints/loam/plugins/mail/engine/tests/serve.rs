//! The running server (the specification's 3.2 to 3.4): the layer in front
//! of every route, the two routes, the tokens, the journal, and the command
//! line forwarding to a server.

#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::sync::Arc;

use afd::{CommandRegistry, CommandResult};
use axum::body::Body;
use http_body_util::BodyExt;
use loam_mail::cli::{Caller, EXIT_OK, Local, Runner, command_line_context, run_on};
use loam_mail::engine::Engine;
use loam_mail::home::Home;
use loam_mail::serve::{ServerEntry, cli_token_file, router, running, server_file};
use serde_json::{Value, json};
use tower::ServiceExt;

const PORT: u16 = 4321;
const CLI_TOKEN: &str = "lmail_cli_test";

struct Setup {
    _dir: tempfile::TempDir,
    home: Home,
    engine: Arc<Engine>,
    registry: Arc<CommandRegistry>,
}

fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home.clone())));
    let registry = Arc::new(loam_mail::registry(&engine).unwrap());
    engine.open_store().unwrap();
    Setup {
        _dir: dir,
        home,
        engine,
        registry,
    }
}

/// Runs a person's command at the terminal in this process, saying yes.
async fn approved(registry: &CommandRegistry, name: &str, input: Value) -> CommandResult<Value> {
    let local = Local(registry);
    let held = local.run(name, input.clone(), true, None).await;
    let token = held
        .error
        .as_ref()
        .and_then(|error| error.details.as_ref())
        .and_then(|details| details.get("approvalToken"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| panic!("{name} was not held: {held:?}"));
    local.run(name, input, true, Some(token)).await
}

/// Makes an agent's token and returns `(id, secret)`.
async fn agent_token(setup: &Setup, name: &str) -> (String, String) {
    let made = approved(
        &setup.registry,
        "mail-token-create",
        json!({ "name": name }),
    )
    .await;
    assert!(made.success, "{made:?}");
    let data = made.data.unwrap();
    (
        data["token"].as_str().unwrap().to_string(),
        data["secret"].as_str().unwrap().to_string(),
    )
}

fn app(setup: &Setup) -> axum::Router {
    router(&setup.registry, Arc::clone(&setup.engine), PORT, CLI_TOKEN).unwrap()
}

const META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

fn mcp_body(method: &str, params: Value) -> Value {
    let mut params = params;
    params["_meta"] = serde_json::from_str(META).unwrap();
    json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params })
}

/// What a request carries, beside its path and body.
#[derive(Clone, Copy)]
struct Sent<'a> {
    host: &'a str,
    origin: Option<&'a str>,
    token: Option<&'a str>,
}

const GOOD_HOST: &str = "127.0.0.1:4321";

fn sent(token: Option<&str>) -> Sent<'_> {
    Sent {
        host: GOOD_HOST,
        origin: None,
        token,
    }
}

async fn request(app: &axum::Router, path: &str, sent: Sent<'_>, body: Value) -> (u16, Value) {
    let mut builder = axum::http::Request::post(path)
        .header("host", sent.host)
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    if path == "/mcp" {
        let method = body["method"].as_str().unwrap_or_default().to_string();
        builder = builder
            .header("mcp-protocol-version", "2026-07-28")
            .header("mcp-method", method);
        if let Some(name) = body["params"]["name"].as_str() {
            builder = builder.header("mcp-name", name.to_string());
        }
    }
    if let Some(origin) = sent.origin {
        builder = builder.header("origin", origin);
    }
    if let Some(token) = sent.token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let request = builder.body(Body::from(body.to_string())).unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let json = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::String(text.clone()))
    });
    (status, json)
}

fn cli_call(command: &str, input: Value) -> Value {
    json!({ "command": command, "input": input, "terminal": false })
}

#[tokio::test]
async fn the_layer_refuses_before_either_route_reads_anything() {
    let setup = setup();
    let (_, agent) = agent_token(&setup, "claude").await;
    let app = app(&setup);
    let list = mcp_body("tools/list", json!({}));
    let call = cli_call("mail-account-list", json!({}));
    let cases: Vec<(&str, Sent<'_>, u16)> = vec![
        ("no token", sent(None), 401),
        ("a wrong token", sent(Some("lmail_agent_wrong")), 401),
        (
            "a wrong Host",
            Sent {
                host: "evil.example:4321",
                ..sent(Some(&agent))
            },
            403,
        ),
        (
            "the right host on another port",
            Sent {
                host: "127.0.0.1:80",
                ..sent(Some(&agent))
            },
            403,
        ),
        (
            "a browser Origin",
            Sent {
                origin: Some("http://127.0.0.1:4321"),
                ..sent(Some(&agent))
            },
            403,
        ),
    ];
    for (what, sent, status) in &cases {
        let (got, _) = request(&app, "/mcp", *sent, list.clone()).await;
        assert_eq!(got, *status, "/mcp tools/list with {what}");
        let cli_sent = Sent {
            token: sent
                .token
                .map(|token| if token == agent { CLI_TOKEN } else { token }),
            ..*sent
        };
        let (got, _) = request(&app, "/cli", cli_sent, call.clone()).await;
        assert_eq!(got, *status, "/cli with {what}");
    }
    // Each token on the other's route.
    let (got, _) = request(&app, "/mcp", sent(Some(CLI_TOKEN)), list.clone()).await;
    assert_eq!(got, 403, "the command line's token on /mcp");
    let (got, _) = request(&app, "/cli", sent(Some(&agent)), call.clone()).await;
    assert_eq!(got, 403, "an agent's token on /cli");
    // And each on its own.
    let (got, body) = request(&app, "/mcp", sent(Some(&agent)), list).await;
    assert_eq!(got, 200, "{body}");
    let (got, body) = request(&app, "/cli", sent(Some(CLI_TOKEN)), call).await;
    assert_eq!(got, 200, "{body}");
    assert_eq!(body["success"], json!(true), "{body}");
    // localhost is the other name allowed.
    let localhost = Sent {
        host: "localhost:4321",
        ..sent(Some(CLI_TOKEN))
    };
    let (got, _) = request(
        &app,
        "/cli",
        localhost,
        cli_call("mail-account-list", json!({})),
    )
    .await;
    assert_eq!(got, 200);
}

#[tokio::test]
async fn a_persons_command_is_neither_listed_nor_callable_over_mcp() {
    let setup = setup();
    let (id, agent) = agent_token(&setup, "claude").await;
    let app = app(&setup);
    let (_, listed) = request(
        &app,
        "/mcp",
        sent(Some(&agent)),
        mcp_body("tools/list", json!({})),
    )
    .await;
    let listed = listed.to_string();
    for person in [
        "mail-account-add",
        "mail-token-create",
        "mail-token-list",
        "mail-token-revoke",
        "mail-rebuild",
    ] {
        assert!(!listed.contains(person), "{person} is listed: {listed}");
    }
    assert!(listed.contains("afd-call"), "{listed}");
    for person in ["mail-token-create", "mail-account-add", "mail-token-revoke"] {
        let call = mcp_body(
            "tools/call",
            json!({ "name": "afd-call", "arguments": { "command": person, "input": { "name": "x", "token": id } } }),
        );
        let (status, body) = request(&app, "/mcp", sent(Some(&agent)), call).await;
        assert_eq!(status, 200, "{body}");
        let text = body.to_string();
        assert!(text.contains("COMMAND_NOT_FOUND"), "{person}: {text}");
    }
    // Nor by its own name, nor as a step of a batch.
    let direct = mcp_body(
        "tools/call",
        json!({ "name": "mail-token-create", "arguments": { "name": "direct" } }),
    );
    let (_, body) = request(&app, "/mcp", sent(Some(&agent)), direct).await;
    assert!(!body.to_string().contains("lmail_agent_"), "{body}");
    let batch = mcp_body(
        "tools/call",
        json!({ "name": "afd-batch", "arguments": { "commands": [
            { "command": "mail-token-create", "input": { "name": "batched" } },
        ] } }),
    );
    let (_, body) = request(&app, "/mcp", sent(Some(&agent)), batch).await;
    let text = body.to_string();
    // The server runs no batch at all: one command per call.
    assert!(text.contains("ONE_COMMAND_PER_CALL"), "{text}");
    assert!(!text.contains("lmail_agent_"), "{text}");
    let tokens = Local(&setup.registry)
        .run("mail-token-list", json!({}), false, None)
        .await;
    assert_eq!(
        tokens.data.unwrap()["tokens"].as_array().unwrap().len(),
        1,
        "no token was made over MCP"
    );
    // A command for agents runs, as the agent its token names.
    let call = mcp_body(
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "mail-account-list", "input": {} } }),
    );
    let (status, body) = request(&app, "/mcp", sent(Some(&agent)), call).await;
    assert_eq!(status, 200);
    let text = body.to_string();
    assert!(
        text.contains("\\\"accounts\\\"") || text.contains("\"accounts\""),
        "{text}"
    );
    assert!(!text.contains("isError\":true"), "{text}");
    // The journal names the agent by its token's id.
    let call = mcp_body(
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "mail-sync", "input": {} } }),
    );
    let (status, _) = request(&app, "/mcp", sent(Some(&agent)), call).await;
    assert_eq!(status, 200);
    let journal = std::fs::read_to_string(loam_mail::journal::path(&setup.home)).unwrap();
    let synced: Vec<Value> = journal
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|entry| entry["command"] == json!("mail-sync"))
        .collect();
    assert_eq!(synced.len(), 1, "{journal}");
    assert_eq!(synced[0]["actor"]["kind"], json!("agent"), "{journal}");
    assert_eq!(synced[0]["actor"]["id"], json!(id), "{journal}");
}

#[tokio::test]
async fn a_repeated_host_or_authorization_is_refused() {
    let setup = setup();
    let (_, agent) = agent_token(&setup, "claude").await;
    let app = app(&setup);
    let list = mcp_body("tools/list", json!({}));
    for (path, token) in [("/mcp", agent.as_str()), ("/cli", CLI_TOKEN)] {
        let bearer = format!("Bearer {token}");
        let twice = |header: &str| {
            let mut builder = axum::http::Request::post(path)
                .header("content-type", "application/json")
                .header("accept", "application/json, text/event-stream")
                .header("mcp-protocol-version", "2026-07-28")
                .header("mcp-method", "tools/list");
            builder = if header == "host" {
                builder
                    .header("host", GOOD_HOST)
                    .header("host", GOOD_HOST)
                    .header("authorization", &bearer)
            } else {
                builder
                    .header("host", GOOD_HOST)
                    .header("authorization", &bearer)
                    .header("authorization", &bearer)
            };
            builder.body(Body::from(list.to_string())).unwrap()
        };
        let response = app.clone().oneshot(twice("host")).await.unwrap();
        assert_eq!(response.status(), 403, "{path}: two Hosts");
        let response = app.clone().oneshot(twice("authorization")).await.unwrap();
        assert_eq!(response.status(), 401, "{path}: two Authorizations");
    }
}

#[tokio::test]
async fn only_the_process_that_owns_the_store_writes_the_journal() {
    let setup = setup();
    let _ = agent_token(&setup, "claude").await;
    let before = std::fs::read_to_string(loam_mail::journal::path(&setup.home)).unwrap();
    assert!(!before.is_empty());
    // Another process on the same data directory: its call is refused, and
    // it writes nothing, so the owner's entries keep their order.
    let other = Arc::new(Engine::new(Some(setup.home.clone())));
    let registry = loam_mail::registry(&other).unwrap();
    for (name, input) in [
        ("mail-sync", json!({})),
        ("mail-token-create", json!({ "name": "other" })),
    ] {
        let refused = Local(&registry).run(name, input, true, None).await;
        assert!(!refused.success, "{name}");
    }
    assert!(!other.owns_store());
    let after = std::fs::read_to_string(loam_mail::journal::path(&setup.home)).unwrap();
    assert_eq!(before, after);
    // The owner's next entry follows its last.
    let _ = agent_token(&setup, "again").await;
    let seqs: Vec<u64> = std::fs::read_to_string(loam_mail::journal::path(&setup.home))
        .unwrap()
        .lines()
        .map(|line| {
            serde_json::from_str::<Value>(line).unwrap()["seq"]
                .as_u64()
                .unwrap()
        })
        .collect();
    assert!(
        seqs.windows(2).all(|pair| pair[1] == pair[0] + 1),
        "{seqs:?}"
    );
}

#[tokio::test]
async fn a_revoked_token_is_refused_from_the_next_request() {
    let setup = setup();
    let (id, agent) = agent_token(&setup, "claude").await;
    let (_, other) = agent_token(&setup, "other").await;
    let app = app(&setup);
    let list = mcp_body("tools/list", json!({}));
    assert_eq!(
        request(&app, "/mcp", sent(Some(&agent)), list.clone())
            .await
            .0,
        200
    );
    // Revoked through the command line's route, as the forwarded command is.
    let revoke = json!({ "token": id });
    let (_, held) = request(
        &app,
        "/cli",
        sent(Some(CLI_TOKEN)),
        json!({
            "command": "mail-token-revoke", "input": revoke, "terminal": true,
        }),
    )
    .await;
    assert_eq!(held["error"]["code"], json!("APPROVAL_REQUIRED"), "{held}");
    let approval = held["error"]["details"]["approvalToken"].as_str().unwrap();
    let (_, revoked) = request(
        &app,
        "/cli",
        sent(Some(CLI_TOKEN)),
        json!({
            "command": "mail-token-revoke", "input": revoke, "terminal": true, "approval": approval,
        }),
    )
    .await;
    assert_eq!(revoked["success"], json!(true), "{revoked}");
    assert_eq!(
        request(&app, "/mcp", sent(Some(&agent)), list.clone())
            .await
            .0,
        401
    );
    assert_eq!(request(&app, "/mcp", sent(Some(&other)), list).await.0, 200);
}

#[tokio::test]
async fn a_new_token_is_named_once_and_never_journaled() {
    let setup = setup();
    let (id, secret) = agent_token(&setup, "claude").await;
    assert!(secret.starts_with("lmail_agent_") && secret.len() > 70);
    let listed = Local(&setup.registry)
        .run("mail-token-list", json!({}), true, None)
        .await;
    let listed = serde_json::to_string(&listed).unwrap();
    assert!(
        listed.contains(&id) && listed.contains("claude"),
        "{listed}"
    );
    assert!(!listed.contains(&secret));
    // A second token of the same name is refused, after the person's yes.
    let again = approved(
        &setup.registry,
        "mail-token-create",
        json!({ "name": "claude" }),
    )
    .await;
    assert_eq!(again.error.unwrap().code, "INVALID_INPUT");

    let journal = std::fs::read_to_string(loam_mail::journal::path(&setup.home)).unwrap();
    assert!(journal.contains("mail-token-create"), "{journal}");
    assert!(
        !journal.contains(&secret),
        "the new token is in the journal"
    );
    assert!(!journal.contains("lmail_agent_"), "{journal}");
    // The approval token a held call returned is not kept either; the
    // crate's suggestion names the field, but no entry carries it.
    let mut held = 0;
    for line in journal.lines() {
        let entry: Value = serde_json::from_str(line).unwrap();
        if entry["result"]["error"]["code"] == json!("APPROVAL_REQUIRED") {
            held += 1;
            assert!(
                entry["result"]["error"]["details"]
                    .get("approvalToken")
                    .is_none(),
                "{line}"
            );
        }
    }
    assert_eq!(held, 2, "both holds are journaled");
    // Read commands are not journaled.
    assert!(!journal.contains("mail-token-list"), "{journal}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(loam_mail::journal::path(&setup.home))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[tokio::test]
async fn the_command_lines_route_runs_only_what_the_command_line_may() {
    let setup = setup();
    let app = app(&setup);
    let (status, body) =
        request(&app, "/cli", sent(Some(CLI_TOKEN)), json!({ "command": 3 })).await;
    assert_eq!(status, 400, "{body}");
    let (status, body) = request(
        &app,
        "/cli",
        sent(Some(CLI_TOKEN)),
        cli_call("mail-nothing", json!({})),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["error"]["code"], json!("COMMAND_NOT_FOUND"), "{body}");
    // A person's command with no terminal is held, and the command line
    // turns that into PERSON_REQUIRED; the server only holds it.
    let (_, held) = request(
        &app,
        "/cli",
        sent(Some(CLI_TOKEN)),
        cli_call("mail-token-create", json!({ "name": "x" })),
    )
    .await;
    assert_eq!(held["error"]["code"], json!("APPROVAL_REQUIRED"), "{held}");
    let (status, _) = request(&app, "/elsewhere", sent(Some(CLI_TOKEN)), json!({})).await;
    assert_eq!(status, 404);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_command_line_forwards_to_a_running_server_and_the_server_cleans_up() {
    let setup = setup();
    let (_, agent) = agent_token(&setup, "claude").await;
    // The server owns the store: the engine above lets it go first.
    let home = setup.home.clone();
    drop(setup.engine);
    drop(setup.registry);
    let engine = Arc::new(Engine::new(Some(home.clone())));
    let registry = Arc::new(loam_mail::registry(&engine).unwrap());
    // Files a killed server left: the new server removes them before it
    // writes its own.
    std::fs::write(server_file(&home), r#"{"pid":1,"port":1}"#).unwrap();
    std::fs::write(cli_token_file(&home), "lmail_cli_old").unwrap();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(loam_mail::serve::serve(
        engine,
        registry,
        0,
        async move {
            let _ = stopped.await;
        },
        |_| {},
    ));
    let mut entry: Option<ServerEntry> = None;
    for _ in 0..200 {
        entry = running(&home).filter(|entry| entry.pid != 1);
        if entry.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    let entry = entry.expect("the server wrote server.json");
    assert_eq!(entry.pid, std::process::id());
    #[cfg(unix)]
    for file in [server_file(&home), cli_token_file(&home)] {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{}", file.display());
    }

    // Another process's view: the store is owned, so the command goes to
    // the server.
    let mine = Arc::new(Engine::new(Some(home.clone())));
    assert!(matches!(
        mine.open_store(),
        Err(loam_mail::store::StoreError::InUse)
    ));
    let local_registry = loam_mail::registry(&mine).unwrap();
    let server_runner = loam_mail::forward::Server::find(&home).expect("the server's files");
    let (status, out) = tokio::task::spawn_blocking(move || {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let status = run_on(
            &["mail-token-list".to_string()],
            &local_registry,
            &server_runner,
            Caller::Script,
            &loam_mail::secrets::InMemory::default(),
            &mut out,
            &mut err,
        )
        .unwrap();
        (status, String::from_utf8(out).unwrap())
    })
    .await
    .unwrap();
    assert_eq!(status, EXIT_OK, "{out}");
    assert!(out.contains("claude"), "{out}");

    assert_ne!(
        std::fs::read_to_string(cli_token_file(&home)).unwrap(),
        "lmail_cli_old"
    );

    // Over a real socket, an agent's token reaches MCP, and the command
    // line's does not.
    let list = mcp_body("tools/list", json!({}));
    let (status, body) = over_tcp(entry.port, "/mcp", &agent, &list).await;
    assert_eq!(status, 200, "{body}");
    assert!(body.contains("afd-call"), "{body}");
    let cli = std::fs::read_to_string(cli_token_file(&home)).unwrap();
    let (status, _) = over_tcp(entry.port, "/mcp", &cli, &list).await;
    assert_eq!(status, 403);

    stop.send(()).unwrap();
    server.await.unwrap().unwrap();
    assert!(running(&home).is_none(), "server.json is removed");
    assert!(!cli_token_file(&home).exists(), "cli.token is removed");
    // With no server, the store is free again.
    assert!(mine.open_store().is_ok());
}

#[tokio::test]
async fn a_request_to_end_that_came_while_the_server_started_stops_it_before_it_writes() {
    let dir = tempfile::tempdir().unwrap();
    let home = Home::at(dir.path().join("mail"));
    let engine = Arc::new(Engine::new(Some(home.clone())));
    let registry = Arc::new(loam_mail::registry(&engine).unwrap());
    loam_mail::serve::serve(engine, registry, 0, async {}, |_| {
        panic!("it announced a server")
    })
    .await
    .unwrap();
    assert!(!server_file(&home).exists());
    assert!(!cli_token_file(&home).exists());
}

/// Posts `body` to a server on `port` over a real connection.
async fn over_tcp(port: u16, path: &str, token: &str, body: &Value) -> (u16, String) {
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    let (mut sender, connection) =
        hyper::client::conn::http1::handshake(hyper_util::rt::TokioIo::new(stream))
            .await
            .unwrap();
    tokio::spawn(connection);
    let request = hyper::Request::post(path)
        .header("host", format!("127.0.0.1:{port}"))
        .header("authorization", format!("Bearer {token}"))
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header(
            "mcp-method",
            body["method"].as_str().unwrap_or_default().to_string(),
        )
        .body(http_body_util::Full::new(axum::body::Bytes::from(
            body.to_string(),
        )))
        .unwrap();
    let response = sender.send_request(request).await.unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8_lossy(&bytes).to_string())
}

#[tokio::test]
async fn a_server_that_is_gone_is_reported_in_the_engines_words() {
    let setup = setup();
    // server.json naming a port nothing listens on.
    std::fs::write(server_file(&setup.home), r#"{"pid":1,"port":1}"#).unwrap();
    std::fs::write(cli_token_file(&setup.home), "lmail_cli_x").unwrap();
    let server = loam_mail::forward::Server::find(&setup.home).unwrap();
    let result = server
        .run("mail-account-list", json!({}), false, None)
        .await;
    assert_eq!(result.error.unwrap().code, "STORE_IN_USE");
}

#[tokio::test]
async fn mcp_over_stdio_refuses_a_store_a_server_owns_and_names_it() {
    let setup = setup();
    std::fs::write(server_file(&setup.home), r#"{"pid":1,"port":4321}"#).unwrap();
    let other = Engine::new(Some(setup.home.clone()));
    let registry = Arc::new(loam_mail::registry(&Arc::new(Engine::new(None))).unwrap());
    let refused = loam_mail::serve::serve_stdio(&Arc::new(other), registry)
        .await
        .unwrap_err();
    assert!(refused.starts_with("STORE_IN_USE"), "{refused}");
    assert!(refused.contains("http://127.0.0.1:4321/mcp"), "{refused}");
}

#[test]
fn the_command_line_context_says_who_is_calling() {
    let person = command_line_context(true);
    assert_eq!(person.actor.as_ref().unwrap().kind, afd::ActorKind::Human);
    let script = command_line_context(false);
    assert_eq!(script.actor.as_ref().unwrap().kind, afd::ActorKind::Script);
}
