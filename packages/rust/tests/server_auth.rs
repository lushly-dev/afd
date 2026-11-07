//! `spec/authorization.md` M1 to M7 end to end over HTTP: the bearer layer in front of the
//! Streamable HTTP service, its 401 and 403 answers, the metadata, the resolver, batches,
//! listing, the scope decision after routing, failing closed, and a token canary over the logs.
#![cfg(feature = "server-auth")]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use afd::server::auth::{Authorization, Credentials, ScopeDecision, ScopeResolver};
use afd::server::{ConfirmationMode, HttpOptions, McpServer, ToolStrategy};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use bytes::Bytes;
use common::auth::*;
use common::{command_result, Stdio};
use http_body_util::Full;
use serde_json::{json, Value};
use tower::ServiceExt;

/// Reports the credentials and actor the handler sees, and counts runs.
struct Probe(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Probe {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!({
            "credentials": context.credentials.as_deref(),
            "actor": context.actor,
        }))
    }
}

struct Fixture {
    registry: Arc<CommandRegistry>,
    runs: Arc<AtomicUsize>,
}

/// `todo-list` (todo:read), `todo-create` (todo:write), `todo-purge` (todo:admin, confirm-gated),
/// `info-ping` (no scope), `vault-open` (vault:open), and the unexposed `secret-rotate`
/// (secret:rotate), with the bootstrap commands.
fn fixture() -> Fixture {
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(CommandRegistry::new());
    let exposed = |name: &str, scopes: &[&str]| {
        let mut command = CommandDefinition::new(
            name,
            format!("{name} command"),
            vec![],
            Probe(Arc::clone(&runs)),
        )
        .with_scopes(scopes.iter().copied());
        command.expose.mcp = true;
        command
    };
    registry
        .register(exposed("todo-list", &["todo:read"]))
        .unwrap();
    registry
        .register(exposed("todo-create", &["todo:write"]).as_mutation())
        .unwrap();
    registry
        .register(
            exposed("todo-purge", &["todo:admin"])
                .as_mutation()
                .with_confirm_prompt("Delete every todo?"),
        )
        .unwrap();
    registry.register(exposed("info-ping", &[])).unwrap();
    registry
        .register(exposed("vault-open", &["vault:open"]))
        .unwrap();
    registry
        .register(
            CommandDefinition::new("secret-rotate", "Private", vec![], Probe(Arc::clone(&runs)))
                .with_scopes(["secret:rotate"]),
        )
        .unwrap();
    afd::register_bootstrap_commands(&registry).unwrap();
    Fixture { registry, runs }
}

impl Fixture {
    fn server(&self, strategy: ToolStrategy, authorization: Authorization) -> McpServer {
        let mut server = McpServer::new(Arc::clone(&self.registry), "todo", "1.0.0")
            .with_tool_strategy(strategy);
        if strategy == ToolStrategy::Hybrid {
            server = server.with_first_class_tools(["todo-create", "todo-list"]);
        }
        server.with_authorization(authorization)
    }

    fn runs(&self) -> usize {
        self.runs.load(Ordering::SeqCst)
    }
}

fn required(authorization: Authorization) -> Authorization {
    authorization.with_required_scopes(["todo:read"]).unwrap()
}

fn call(name: &str, arguments: Value) -> Value {
    json!({ "name": name, "arguments": arguments })
}

const UNAUTHORIZED_BODY: &str = "Obtain a token for https://todo.example.com/mcp from an authorization server named in https://todo.example.com/.well-known/oauth-protected-resource/mcp.";

fn assert_401(answer: &Answer, token_sent: bool) {
    assert_eq!(answer.status, 401, "{}", answer.text);
    let mut challenge = format!("Bearer resource_metadata=\"{METADATA_URL}\", scope=\"todo:read\"");
    if token_sent {
        challenge.push_str(", error=\"invalid_token\"");
    }
    assert_eq!(answer.challenge(), challenge);
    assert_eq!(answer.headers["content-type"], "application/json");
    assert_eq!(
        answer.body,
        json!({ "error": "UNAUTHORIZED", "suggestion": UNAUTHORIZED_BODY })
    );
}

fn assert_403(answer: &Answer, missing: &str) {
    assert_eq!(answer.status, 403, "{}", answer.text);
    assert_eq!(
        answer.challenge(),
        format!(
            "Bearer error=\"insufficient_scope\", scope=\"{missing}\", resource_metadata=\"{METADATA_URL}\""
        )
    );
    assert_eq!(answer.headers["content-type"], "application/json");
    assert_eq!(
        answer.body,
        json!({
            "error": "INSUFFICIENT_SCOPE",
            "suggestion": format!("Obtain a token for {RESOURCE} that also grants {missing}, then retry."),
        })
    );
}

// ─── M7: metadata ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn metadata_is_served_at_both_paths_without_a_token() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual, authorization());
    for path in [
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-protected-resource",
    ] {
        let request = http::Request::get(path)
            .header("authorization", "Bearer not-a-valid-token")
            .body(Full::new(Bytes::new()))
            .unwrap();
        let answer = send(&server, request).await;
        assert_eq!(answer.status, 200, "{path}");
        assert_eq!(answer.headers["content-type"], "application/json");
        assert_eq!(
            answer.body,
            json!({
                "resource": RESOURCE,
                "authorization_servers": [ISSUER],
                "scopes_supported": ["todo:read"],
                "bearer_methods_supported": ["header"],
                "tls_client_certificate_bound_access_tokens": false,
            })
        );
        let post = http::Request::post(path)
            .body(Full::new(Bytes::new()))
            .unwrap();
        let answer = send(&server, post).await;
        assert_eq!(answer.status, 405);
        assert_eq!(answer.headers["allow"], "GET");
    }
}

// ─── M2 and M5: the 401 ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn requests_without_a_valid_token_are_401() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual, authorization());
    // No token.
    let answer = send(&server, post("tools/list", json!({}), None)).await;
    assert_401(&answer, false);
    // A refused token: signed by another key.
    let forged = valid_token(rsa_other(), "RS256", "rsa");
    let answer = send(&server, post("tools/list", json!({}), Some(&forged))).await;
    assert_401(&answer, true);
    // Not `Bearer <b64token>`.
    let mut request = post("tools/list", json!({}), None);
    request
        .headers_mut()
        .insert("authorization", "Basic dXNlcjpwYXNz".parse().unwrap());
    assert_401(&send(&server, request).await, true);
    // Two Authorization headers.
    let token = token_with_scope(Some("todo:read"));
    let mut request = post("tools/list", json!({}), Some(&token));
    request
        .headers_mut()
        .append("authorization", format!("Bearer {token}").parse().unwrap());
    assert_401(&send(&server, request).await, true);
    // A token in the query beside a valid header.
    let mut request = post("tools/list", json!({}), Some(&token));
    *request.uri_mut() = "/mcp?access_token=abc".parse().unwrap();
    assert_401(&send(&server, request).await, true);
    // A token in a form-encoded body beside a valid header.
    let request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header(
            "content-type",
            "application/x-www-form-urlencoded; charset=utf-8",
        )
        .header("authorization", format!("Bearer {token}"))
        .body(Full::new(Bytes::from_static(b"access_token=abc")))
        .unwrap();
    assert_401(&send(&server, request).await, true);
    assert_eq!(fixture.runs(), 0);
}

#[tokio::test]
async fn every_method_needs_a_token() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual, authorization());
    for method in [
        "initialize",
        "server/discover",
        "resources/list",
        "tools/call",
    ] {
        let answer = send(&server, post(method, call("info-ping", json!({})), None)).await;
        assert_401(&answer, false);
    }
    let get = http::Request::get("/mcp")
        .header("host", "localhost")
        .body(Full::new(Bytes::new()))
        .unwrap();
    assert_401(&send(&server, get).await, false);
}

// ─── M4: credentials reach the command; the token does not ───────────────────────────────────

#[tokio::test]
async fn a_verified_call_carries_credentials_and_the_default_actor() {
    let fixture = fixture();
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let hook_seen = Arc::clone(&seen);
    let server = fixture
        .server(ToolStrategy::Individual, authorization())
        .with_context_hook(move |request, context| {
            let seen = Arc::clone(&hook_seen);
            async move {
                seen.lock().unwrap().push(json!({
                    "authorization": request.header("authorization"),
                    "credentials": context.credentials.as_deref(),
                    "actor": context.actor,
                }));
                Ok(context)
            }
        });
    let token = token_with_scope(Some("todo:read todo:write"));
    let answer = send(
        &server,
        post("tools/call", call("todo-create", json!({})), Some(&token)),
    )
    .await;
    assert_eq!(answer.status, 200, "{}", answer.text);
    let result = command_result(&answer.body);
    assert_eq!(result["success"], true, "{result}");
    let expected_credentials = json!({
        "issuer": ISSUER,
        "subject": "user-1",
        "clientId": "todo-agent",
        "scopes": ["todo:read", "todo:write"],
        "resource": RESOURCE,
        "expiresAt": NOW + 3540,
        "issuedAt": NOW - 60,
    });
    let expected_actor = json!({ "kind": "agent", "id": "todo-agent", "onBehalfOf": "user-1" });
    assert_eq!(result["data"]["credentials"], expected_credentials);
    assert_eq!(result["data"]["actor"], expected_actor);
    // The hook saw the credentials and the default actor, and never the token.
    let seen = seen.lock().unwrap();
    assert_eq!(seen[0]["authorization"], Value::Null);
    assert_eq!(seen[0]["credentials"], expected_credentials);
    assert_eq!(seen[0]["actor"], expected_actor);
    assert!(!answer.text.contains(&token));
}

#[tokio::test]
async fn the_hook_maps_the_actor_but_cannot_change_the_credentials() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual, authorization())
        .with_context_hook(|_request, mut context| async move {
            let broader = Credentials::new(ISSUER, "root", "root", RESOURCE, 0, i64::MAX)
                .with_scopes(["todo:read", "todo:write", "todo:admin"]);
            context.credentials = Some(Arc::new(broader));
            Ok(context.with_actor(afd::Actor::new(afd::ActorKind::Human).with_id("idp/ada")))
        });
    // The token grants todo:read only, so a host layer that left the decision to after routing
    // (here: trusted code inserting credentials) still refuses todo-create.
    let credentials = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 60)
        .with_scopes(["todo:read"]);
    let service = with_credentials(&server, credentials);
    let answer = send_to(
        service.clone(),
        post("tools/call", call("todo-create", json!({})), None),
    )
    .await;
    let result = command_result(&answer.body);
    assert_eq!(result["error"]["code"], "INSUFFICIENT_SCOPE", "{result}");
    let answer = send_to(
        service,
        post("tools/call", call("todo-list", json!({})), None),
    )
    .await;
    let result = command_result(&answer.body);
    assert_eq!(result["data"]["actor"]["id"], "idp/ada");
    assert_eq!(result["data"]["credentials"]["subject"], "user-1");
    assert_eq!(
        result["data"]["credentials"]["scopes"],
        json!(["todo:read"])
    );
}

// ─── M1: fail closed ─────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_server_with_authorization_fails_closed_without_the_layer() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual, authorization());
    let service = server.streamable_http_service(HttpOptions::default());
    let answer = send_to(
        service.clone(),
        post("tools/call", call("info-ping", json!({})), None),
    )
    .await;
    let result = command_result(&answer.body);
    assert_eq!(result["error"]["code"], "UNAUTHORIZED", "{}", answer.text);
    for method in ["tools/list", "server/discover", "resources/list"] {
        let answer = send_to(service.clone(), post(method, json!({}), None)).await;
        assert_eq!(
            answer.body["error"]["data"]["code"], "UNAUTHORIZED",
            "{method}: {}",
            answer.text
        );
        assert!(answer.body["result"].is_null(), "{method}");
    }
    let initialize = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .body(Full::new(Bytes::from(
            json!({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": { "name": "test", "version": "0" },
                },
            })
            .to_string(),
        )))
        .unwrap();
    let answer = send_to(service, initialize).await;
    assert_eq!(
        answer.body["error"]["data"]["code"], "UNAUTHORIZED",
        "{}",
        answer.text
    );
    assert_eq!(fixture.runs(), 0);
}

#[tokio::test]
async fn stdio_is_unaffected() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual, required(authorization()));
    let mut client = Stdio::connect(server).await;
    let response = client
        .request("tools/call", call("todo-purge", json!({})))
        .await;
    let result: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(result["success"], true, "{result}");
    assert_eq!(result["data"]["credentials"], Value::Null);
    let listed = client.request("tools/list", json!({})).await;
    assert!(listed["result"]["tools"].as_array().unwrap().len() > 3);
}

// ─── M6: the 403 before dispatch ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn a_missing_scope_is_403_before_dispatch_on_every_route() {
    let fixture = fixture();
    let token = token_with_scope(Some("todo:read"));
    for strategy in [
        ToolStrategy::Individual,
        ToolStrategy::Grouped,
        ToolStrategy::Lazy,
        ToolStrategy::Hybrid,
    ] {
        let server = fixture.server(strategy, required(authorization()));
        let mut calls = vec![
            call("afd-call", json!({ "command": "todo-create", "input": {} })),
            call("todo-create", json!({})),
        ];
        if strategy == ToolStrategy::Grouped {
            calls.push(call("todo", json!({ "action": "create", "params": {} })));
        }
        for params in calls {
            let answer = send(&server, post("tools/call", params.clone(), Some(&token))).await;
            assert_403(&answer, "todo:write");
        }
    }
    assert_eq!(fixture.runs(), 0);
}

#[tokio::test]
async fn a_batch_or_pipeline_is_one_403_naming_every_missing_scope() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Individual, required(authorization()));
    let token = token_with_scope(Some("todo:read"));
    let batch = call(
        "afd-batch",
        json!({ "commands": [
            { "command": "todo-list", "input": {} },
            { "command": "todo-create", "input": {} },
            { "command": "todo-purge", "input": {} },
            { "command": "todo-create", "input": {} },
        ] }),
    );
    let answer = send(&server, post("tools/call", batch, Some(&token))).await;
    assert_403(&answer, "todo:write todo:admin");
    let pipe = call(
        "afd-pipe",
        json!({ "steps": [
            { "command": "todo-purge", "input": { "id": "$prev.id" } },
            { "command": "todo-create" },
        ] }),
    );
    let answer = send(&server, post("tools/call", pipe, Some(&token))).await;
    assert_403(&answer, "todo:admin todo:write");
    // A JSON-RPC batch body is decided as a whole, message by message.
    let body = json!([
        { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": call("todo-purge", json!({})) },
        { "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": call("todo-create", json!({})) },
    ]);
    let request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .body(Full::new(Bytes::from(body.to_string())))
        .unwrap();
    assert_403(&send(&server, request).await, "todo:admin todo:write");
    assert_eq!(fixture.runs(), 0);
}

#[tokio::test]
async fn required_scopes_apply_to_every_request() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Grouped, required(authorization()));
    let token = token_with_scope(Some("todo:write"));
    for (method, params) in [
        ("tools/list", json!({})),
        ("server/discover", json!({})),
        ("tools/call", call("info-ping", json!({}))),
        ("tools/call", call("afd-discover", json!({}))),
        ("tools/call", call("no-such-tool", json!({}))),
        // A grouped call the router cannot resolve is decided under the group's own name.
        ("tools/call", call("todo", json!({ "action": "nope" }))),
        // An unexposed command's scopes are never named.
        (
            "tools/call",
            call("afd-call", json!({ "command": "secret-rotate" })),
        ),
    ] {
        let answer = send(&server, post(method, params.clone(), Some(&token))).await;
        assert_403(&answer, "todo:read");
    }
    // With the required scope, an unresolvable grouped call reaches the router.
    let token = token_with_scope(Some("todo:read"));
    let answer = send(
        &server,
        post(
            "tools/call",
            call("todo", json!({ "action": "nope" })),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(
        command_result(&answer.body)["error"]["code"],
        "COMMAND_NOT_FOUND"
    );
    let answer = send(
        &server,
        post(
            "tools/call",
            call("afd-call", json!({ "command": "secret-rotate" })),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(
        command_result(&answer.body)["error"]["code"],
        "COMMAND_NOT_FOUND"
    );
}

#[tokio::test]
async fn an_oversized_body_is_413() {
    let fixture = fixture();
    let server = fixture.server(
        ToolStrategy::Individual,
        authorization().with_max_body_bytes(64),
    );
    let token = token_with_scope(Some("todo:read"));
    let answer = send(
        &server,
        post(
            "tools/call",
            call("info-ping", json!({ "pad": "x".repeat(100) })),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(answer.status, 413);
}

// ─── M6: the resolver ────────────────────────────────────────────────────────────────────────

/// Spaces: `todo-list` needs `todo:read:<space>`; a space named `hidden` defers, so the registry
/// answers; `todo-create` is never visible.
struct Spaces;

impl ScopeResolver for Spaces {
    fn resolve(&self, command: &str, input: &Value, credentials: &Credentials) -> ScopeDecision {
        match (command, input["space"].as_str()) {
            ("todo-list", Some("hidden")) => ScopeDecision::Defer,
            ("todo-list", Some(space)) => {
                let scope = format!("todo:read:{space}");
                if credentials.has_scope(&scope) {
                    ScopeDecision::Allowed
                } else {
                    ScopeDecision::Missing(vec![scope])
                }
            }
            _ => ScopeDecision::Allowed,
        }
    }

    fn visible(&self, command: &str, _credentials: &Credentials) -> bool {
        command != "todo-create"
    }
}

#[tokio::test]
async fn a_resolver_decides_each_call() {
    let fixture = fixture();
    let server = fixture.server(
        ToolStrategy::Individual,
        required(authorization()).with_resolver(Spaces),
    );
    let token = token_with_scope(Some("todo:read todo:read:alpha"));
    let list = |space: &str| call("todo-list", json!({ "space": space }));
    // Allowed.
    let answer = send(&server, post("tools/call", list("alpha"), Some(&token))).await;
    assert_eq!(
        command_result(&answer.body)["success"],
        true,
        "{}",
        answer.text
    );
    // Missing: the resolver's scope.
    let answer = send(&server, post("tools/call", list("beta"), Some(&token))).await;
    assert_403(&answer, "todo:read:beta");
    // Defer: the registry answers (here the command runs: AFD names no scope).
    let answer = send(&server, post("tools/call", list("hidden"), Some(&token))).await;
    assert_eq!(answer.status, 200);
    // The resolver replaces the static rule: todo-create's own scope is not asked for.
    let answer = send(
        &server,
        post("tools/call", call("todo-create", json!({})), Some(&token)),
    )
    .await;
    assert_eq!(command_result(&answer.body)["success"], true);
    // The required scopes still come first.
    let narrow = token_with_scope(Some("todo:read:alpha"));
    let answer = send(&server, post("tools/call", list("beta"), Some(&narrow))).await;
    assert_403(&answer, "todo:read todo:read:beta");
    let answer = send(&server, post("tools/call", list("hidden"), Some(&narrow))).await;
    assert_403(&answer, "todo:read");
}

// ─── M6: after routing ───────────────────────────────────────────────────────────────────────

/// The service with trusted host code inserting `credentials`, and no bearer layer: every call
/// is decided after routing.
fn with_credentials(
    server: &McpServer,
    credentials: Credentials,
) -> impl tower::Service<
    http::Request<Full<Bytes>>,
    Response = http::Response<
        http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>,
    >,
    Error = std::convert::Infallible,
> + Clone {
    let inner = server.streamable_http_service(HttpOptions::default());
    tower::service_fn(move |mut request: http::Request<Full<Bytes>>| {
        request.extensions_mut().insert(credentials.clone());
        inner.clone().oneshot(request)
    })
}

#[tokio::test]
async fn after_routing_a_missing_scope_is_insufficient_scope() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual, required(authorization()))
        .with_confirmations(ConfirmationMode::RequireHuman);
    let credentials = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 60)
        .with_scopes(["todo:read"]);
    let service = with_credentials(&server, credentials);
    let answer = send_to(
        service.clone(),
        post("tools/call", call("todo-create", json!({})), None),
    )
    .await;
    let result = command_result(&answer.body);
    assert_eq!(result["success"], false);
    assert_eq!(
        result["error"],
        json!({
            "code": "INSUFFICIENT_SCOPE",
            "message": "The access token lacks a scope this call needs",
            "suggestion": format!("Obtain a token for {RESOURCE} that also grants todo:write, then retry."),
            "retryable": false,
            "details": { "scopes": ["todo:write"] },
        })
    );
    // The confirmation gate is never reached: no person is asked to confirm a call that cannot
    // run.
    let answer = send_to(
        service.clone(),
        post("tools/call", call("todo-purge", json!({})), None),
    )
    .await;
    assert_eq!(
        command_result(&answer.body)["error"]["code"],
        "INSUFFICIENT_SCOPE"
    );
    // A batch fails as a whole before its first step.
    let batch = call(
        "afd-batch",
        json!({ "commands": [
            { "command": "todo-list", "input": {} },
            { "command": "todo-create", "input": {} },
        ] }),
    );
    let answer = send_to(service.clone(), post("tools/call", batch, None)).await;
    let result = command_result(&answer.body);
    assert_eq!(result["success"], false);
    assert_eq!(result["error"]["code"], "INSUFFICIENT_SCOPE", "{result}");
    assert_eq!(result["results"], json!([]));
    // So does a pipeline.
    let pipe = call(
        "afd-pipe",
        json!({ "steps": [{ "command": "todo-list" }, { "command": "todo-purge" }] }),
    );
    let answer = send_to(service.clone(), post("tools/call", pipe, None)).await;
    let result = command_result(&answer.body);
    assert_eq!(result["steps"][0]["index"], -1, "{result}");
    assert_eq!(result["steps"][0]["error"]["code"], "INSUFFICIENT_SCOPE");
    assert_eq!(
        result["steps"][0]["error"]["details"]["scopes"],
        json!(["todo:admin"])
    );
    // The required scopes apply to listings too.
    let credentials = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 60);
    let service = with_credentials(&server, credentials);
    let answer = send_to(service, post("tools/list", json!({}), None)).await;
    assert_eq!(
        answer.body["error"]["data"]["code"], "INSUFFICIENT_SCOPE",
        "{}",
        answer.text
    );
    assert_eq!(answer.body["error"]["data"]["scopes"], json!(["todo:read"]));
    assert_eq!(fixture.runs(), 0);
}

// ─── M6: listing ─────────────────────────────────────────────────────────────────────────────

fn tool_names(answer: &Answer) -> Vec<String> {
    answer.body["result"]["tools"]
        .as_array()
        .unwrap_or_else(|| panic!("{}", answer.text))
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn listings_filter_by_scope_and_turn_private() {
    let fixture = fixture();
    let token = token_with_scope(Some("todo:read"));
    let filtered = |strategy| {
        fixture.server(
            strategy,
            required(authorization()).with_filter_tools_by_scope(true),
        )
    };
    // Individual: only visible commands; the meta-tools stay.
    let server = filtered(ToolStrategy::Individual);
    let answer = send(&server, post("tools/list", json!({}), Some(&token))).await;
    let names = tool_names(&answer);
    assert_eq!(answer.body["result"]["cacheScope"], "private");
    for shown in [
        "afd-call",
        "afd-batch",
        "afd-pipe",
        "todo-list",
        "info-ping",
        "afd-help",
    ] {
        assert!(names.contains(&shown.to_owned()), "{shown} in {names:?}");
    }
    for hidden in ["todo-create", "todo-purge", "secret-rotate"] {
        assert!(!names.contains(&hidden.to_owned()), "{hidden} in {names:?}");
    }
    // afd-discover, afd-detail and afd-help: a hidden command looks unknown.
    let discover = send(
        &server,
        post("tools/call", call("afd-discover", json!({})), Some(&token)),
    )
    .await;
    let discovered = command_result(&discover.body)["data"]["commands"].to_string();
    assert!(
        discovered.contains("todo-list") && !discovered.contains("todo-create"),
        "{discovered}"
    );
    let detail = send(
        &server,
        post(
            "tools/call",
            call(
                "afd-detail",
                json!({ "command": ["todo-create", "todo-list"] }),
            ),
            Some(&token),
        ),
    )
    .await;
    let detail = command_result(&detail.body);
    assert_eq!(detail["data"][0]["found"], false, "{detail}");
    assert_eq!(detail["data"][1]["found"], true);
    assert_eq!(detail["data"][1]["scopes"], json!(["todo:read"]));
    let help = send(
        &server,
        post("tools/call", call("afd-help", json!({})), Some(&token)),
    )
    .await;
    let help = command_result(&help.body)["data"]["commands"].to_string();
    assert!(
        help.contains("todo-list") && !help.contains("todo-create"),
        "{help}"
    );
    let docs = send(
        &server,
        post("tools/call", call("afd-docs", json!({})), Some(&token)),
    )
    .await;
    let docs = command_result(&docs.body)["data"].to_string();
    assert!(
        docs.contains("todo-list") && !docs.contains("todo-create"),
        "{docs}"
    );
    // Calls are still decided only by the scope rule: a hidden command is a 403, not unknown.
    let answer = send(
        &server,
        post("tools/call", call("todo-create", json!({})), Some(&token)),
    )
    .await;
    assert_403(&answer, "todo:write");

    // Grouped: a group's hidden actions are left out.
    let server = filtered(ToolStrategy::Grouped);
    let answer = send(&server, post("tools/list", json!({}), Some(&token))).await;
    assert_eq!(answer.body["result"]["cacheScope"], "private");
    let todo = answer.body["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "todo")
        .cloned()
        .unwrap();
    assert_eq!(
        todo["inputSchema"]["properties"]["action"]["enum"],
        json!(["list"])
    );
    // A group with no visible action is left out.
    let names = tool_names(&answer);
    assert!(names.contains(&"info".to_owned()), "{names:?}");
    assert!(!names.contains(&"vault".to_owned()), "{names:?}");
    let writer = token_with_scope(Some("todo:read todo:write todo:admin"));
    let answer = send(&server, post("tools/list", json!({}), Some(&writer))).await;
    let todo = answer.body["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "todo")
        .cloned()
        .unwrap();
    assert_eq!(
        todo["inputSchema"]["properties"]["action"]["enum"],
        json!(["list", "create", "purge"])
    );

    // Hybrid: first-class tools are filtered; private in every strategy.
    let server = filtered(ToolStrategy::Hybrid);
    let answer = send(&server, post("tools/list", json!({}), Some(&token))).await;
    let names = tool_names(&answer);
    assert_eq!(answer.body["result"]["cacheScope"], "private");
    assert!(names.contains(&"todo-list".to_owned()) && !names.contains(&"todo-create".to_owned()));
    let server = filtered(ToolStrategy::Lazy);
    let answer = send(&server, post("tools/list", json!({}), Some(&token))).await;
    assert_eq!(answer.body["result"]["cacheScope"], "private");

    // Without filtering, every command is listed and the list stays public.
    let server = fixture.server(ToolStrategy::Individual, required(authorization()));
    let answer = send(&server, post("tools/list", json!({}), Some(&token))).await;
    assert_eq!(answer.body["result"]["cacheScope"], "public");
    assert!(tool_names(&answer).contains(&"todo-create".to_owned()));
}

#[tokio::test]
async fn a_resolver_decides_visibility() {
    let fixture = fixture();
    let server = fixture.server(
        ToolStrategy::Individual,
        required(authorization())
            .with_resolver(Spaces)
            .with_filter_tools_by_scope(true),
    );
    let token = token_with_scope(Some("todo:read"));
    let answer = send(&server, post("tools/list", json!({}), Some(&token))).await;
    let names = tool_names(&answer);
    assert!(names.contains(&"todo-purge".to_owned()), "{names:?}");
    assert!(!names.contains(&"todo-create".to_owned()), "{names:?}");
}
