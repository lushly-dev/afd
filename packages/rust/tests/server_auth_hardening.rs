//! The step 0b security review's findings, each pinned (`spec/authorization.md`, M1, M5 and M6):
//! suggestions never name a command the scope filter hides; a resolver's `Missing` refuses even
//! when it names no valid scope; an authorized server refuses an untrusted transport and
//! credentials its own layer did not admit; a resolver is asked again at execution on the
//! validated input; resource providers see the caller; JWT `exp` before `iat`; and debug output
//! never holds a credential-derived actor.
#![cfg(feature = "server-auth")]

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use afd::server::auth::{
    check_claims, Authorization, Credentials, RuleCode, ScopeDecision, ScopeResolver,
};
use afd::server::{
    HttpOptions, McpServer, ResourceCaller, ResourceContents, ResourceEntry, ResourceProvider,
    ResourceReadError, ToolStrategy,
};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    CommandResult,
};
use async_trait::async_trait;
use bytes::Bytes;
use common::auth::*;
use common::{command_result, Stdio};
use http_body_util::Full;
use serde_json::{json, Value};
use tower::{Layer, ServiceExt};

/// Counts runs and answers `{ space }` from its input, or a fixed space for `space-pick`.
struct Probe {
    runs: Arc<AtomicUsize>,
    pick: bool,
}

#[async_trait]
impl CommandHandler for Probe {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.runs.fetch_add(1, Ordering::SeqCst);
        if self.pick {
            return success(json!({ "space": "secret" }));
        }
        success(json!({ "space": input["space"] }))
    }
}

/// Calls `notes-read` in process with no input, passing its own context on.
struct Nested(Arc<OnceLock<Arc<CommandRegistry>>>);

#[async_trait]
impl CommandHandler for Nested {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        let registry = self.0.get().unwrap();
        let inner = registry
            .execute("notes-read", json!({}), Some(context))
            .await;
        success(json!({ "inner": inner }))
    }
}

struct Fixture {
    registry: Arc<CommandRegistry>,
    runs: Arc<AtomicUsize>,
}

/// `todo-list` (todo:read), `todo-create` (todo:write), `vault-open` (vault:open),
/// `notes-read` (its `space` defaults to `secret`), `space-pick` (answers `{ space: "secret" }`)
/// and `notes-nested` (calls `notes-read` in process).
fn fixture() -> Fixture {
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = Arc::new(CommandRegistry::new());
    let probe = |pick| Probe {
        runs: Arc::clone(&runs),
        pick,
    };
    let exposed = |command: CommandDefinition| {
        let mut command = command;
        command.expose.mcp = true;
        command
    };
    for (name, scopes) in [
        ("todo-list", "todo:read"),
        ("todo-create", "todo:write"),
        ("vault-open", "vault:open"),
    ] {
        registry
            .register(exposed(
                CommandDefinition::new(name, "A command", vec![], probe(false))
                    .with_scopes([scopes]),
            ))
            .unwrap();
    }
    registry
        .register(exposed(CommandDefinition::new(
            "notes-read",
            "Read notes",
            vec![CommandParameter::optional_string("space", "The space")
                .with_default(json!("secret"))],
            probe(false),
        )))
        .unwrap();
    registry
        .register(exposed(CommandDefinition::new(
            "space-pick",
            "Pick a space",
            vec![],
            probe(true),
        )))
        .unwrap();
    let cell = Arc::new(OnceLock::new());
    registry
        .register(exposed(CommandDefinition::new(
            "notes-nested",
            "Read notes in process",
            vec![],
            Nested(Arc::clone(&cell)),
        )))
        .unwrap();
    cell.set(Arc::clone(&registry)).ok();
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

fn call(name: &str, arguments: Value) -> Value {
    json!({ "name": name, "arguments": arguments })
}

fn filtered() -> Authorization {
    authorization()
        .with_required_scopes(["todo:read"])
        .unwrap()
        .with_filter_tools_by_scope(true)
}

// ─── Suggestions never name a hidden command ─────────────────────────────────────────────────

#[tokio::test]
async fn suggestions_never_name_a_hidden_command_on_any_route() {
    let fixture = fixture();
    let reader = token_with_scope(Some("todo:read"));
    let writer = token_with_scope(Some("todo:read todo:write vault:open"));
    for strategy in [
        ToolStrategy::Individual,
        ToolStrategy::Grouped,
        ToolStrategy::Hybrid,
    ] {
        let server = fixture.server(strategy, filtered());
        for (label, params) in [
            ("direct", call("todo-creat", json!({}))),
            ("direct", call("vault-ope", json!({}))),
            (
                "afd-batch",
                call(
                    "afd-batch",
                    json!({ "commands": [{ "command": "todo-creat" }, { "command": "vault-ope" }] }),
                ),
            ),
            (
                "afd-pipe",
                call(
                    "afd-pipe",
                    json!({ "steps": [{ "command": "todo-creat" }] }),
                ),
            ),
        ] {
            let hidden = send(&server, post("tools/call", params.clone(), Some(&reader))).await;
            assert_eq!(hidden.status, 200, "{}", hidden.text);
            let text = command_result(&hidden.body).to_string();
            assert!(
                text.contains("COMMAND_NOT_FOUND"),
                "{strategy:?} {label}: {text}"
            );
            for name in ["todo-create", "vault-open"] {
                assert!(
                    !text.contains(name),
                    "{strategy:?} {label} names hidden {name}: {text}"
                );
            }
            // A caller who may see them is told about them: the check is not vacuous.
            let shown = send(&server, post("tools/call", params, Some(&writer))).await;
            let text = command_result(&shown.body).to_string();
            assert!(
                text.contains("todo-create") || text.contains("vault-open"),
                "{strategy:?} {label}: {text}"
            );
        }
    }
    assert_eq!(fixture.runs(), 0);
}

#[tokio::test]
async fn a_group_with_every_action_hidden_looks_like_no_tool() {
    let fixture = fixture();
    let server = fixture.server(ToolStrategy::Grouped, filtered());
    let reader = token_with_scope(Some("todo:read"));
    let error = |answer: &Answer| command_result(&answer.body)["error"].clone();
    let hidden = error(
        &send(
            &server,
            post("tools/call", call("vault", json!({})), Some(&reader)),
        )
        .await,
    );
    let absent = error(
        &send(
            &server,
            post("tools/call", call("vaulx", json!({})), Some(&reader)),
        )
        .await,
    );
    assert_eq!(hidden["code"], "COMMAND_NOT_FOUND", "{hidden}");
    assert_eq!(hidden["message"], "Command 'vault' not found");
    assert_eq!(absent["message"], "Command 'vaulx' not found");
    assert_eq!(hidden["suggestion"], absent["suggestion"]);
    assert!(!hidden.to_string().contains("open"), "{hidden}");
    // With vault:open the group is listed, and an action is asked for.
    let opener = token_with_scope(Some("todo:read vault:open"));
    let shown = error(
        &send(
            &server,
            post("tools/call", call("vault", json!({})), Some(&opener)),
        )
        .await,
    );
    assert_eq!(shown["code"], "INVALID_GROUPED_CALL", "{shown}");
}

// ─── A resolver's Missing always refuses ─────────────────────────────────────────────────────

/// `Missing` with no name for `todo-list`, with a name that is not a scope token for
/// `vault-open`.
struct Careless;

impl ScopeResolver for Careless {
    fn resolve(&self, command: &str, _input: &Value, _credentials: &Credentials) -> ScopeDecision {
        match command {
            "todo-list" => ScopeDecision::Missing(vec![]),
            "vault-open" => ScopeDecision::Missing(vec!["not a scope".to_owned()]),
            _ => ScopeDecision::Allowed,
        }
    }

    fn visible(&self, _command: &str, _credentials: &Credentials) -> bool {
        true
    }
}

#[tokio::test]
async fn a_missing_decision_without_valid_names_refuses() {
    let fixture = fixture();
    let auth = authorization().with_resolver(Careless);
    let server = fixture.server(ToolStrategy::Individual, auth.clone());
    let token = token_with_scope(Some("todo:read"));
    for command in ["todo-list", "vault-open"] {
        let answer = send(
            &server,
            post("tools/call", call(command, json!({})), Some(&token)),
        )
        .await;
        assert_eq!(answer.status, 403, "{command}: {}", answer.text);
        // No scope can be named, so the challenge has no `scope` parameter, never an empty one.
        assert_eq!(
            answer.challenge(),
            format!("Bearer error=\"insufficient_scope\", resource_metadata=\"{METADATA_URL}\"")
        );
        assert_eq!(
            answer.body["suggestion"],
            format!(
                "Obtain a token for {RESOURCE} that grants the scopes this call needs, then retry."
            )
        );
    }
    // After routing too.
    let credentials = Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 60)
        .with_scopes(["todo:read"]);
    let answer = send_to(
        admitting(&server, &auth, credentials),
        post("tools/call", call("todo-list", json!({})), None),
    )
    .await;
    let error = &command_result(&answer.body)["error"];
    assert_eq!(error["code"], "INSUFFICIENT_SCOPE", "{error}");
    assert_eq!(error["details"]["scopes"], json!([]));
    assert_eq!(fixture.runs(), 0);
}

// ─── Fail closed on an untrusted transport and on credentials not admitted ───────────────────

/// The Streamable HTTP service with `credentials` admitted for `authorization`.
fn admitting(
    server: &McpServer,
    authorization: &Authorization,
    credentials: Credentials,
) -> impl tower::Service<
    http::Request<Full<Bytes>>,
    Response = http::Response<
        http_body_util::combinators::BoxBody<Bytes, std::convert::Infallible>,
    >,
    Error = std::convert::Infallible,
> + Clone {
    let inner = server.streamable_http_service(HttpOptions::default());
    let authorization = authorization.clone();
    tower::service_fn(move |mut request: http::Request<Full<Bytes>>| {
        authorization.admit(request.extensions_mut(), credentials.clone());
        inner.clone().oneshot(request)
    })
}

#[tokio::test]
async fn an_untrusted_transport_is_refused() {
    let fixture = fixture();
    // `ServiceExt::serve` over a pipe, without `with_trusted_transport`: no HTTP request, and no
    // trust, so nothing is served.
    let server = fixture.server(ToolStrategy::Individual, authorization());
    let mut client = Stdio::connect_modern(server);
    let mut params = call("todo-list", json!({}));
    params["_meta"] = serde_json::from_str(common::META).unwrap();
    let response = client.request("tools/call", params.clone()).await;
    let result: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(result["error"]["code"], "UNAUTHORIZED", "{response}");
    let listed = client
        .request("tools/list", json!({ "_meta": params["_meta"] }))
        .await;
    assert_eq!(listed["error"]["data"]["code"], "UNAUTHORIZED", "{listed}");
    // Marked trusted, the same pipe is served without credentials.
    let trusted = fixture
        .server(ToolStrategy::Individual, authorization())
        .with_trusted_transport();
    let mut client = Stdio::connect_modern(trusted);
    let response = client.request("tools/call", params).await;
    let result: Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(result["success"], true, "{response}");
}

#[tokio::test]
async fn credentials_this_server_did_not_admit_are_refused() {
    let fixture = fixture();
    let token = token_with_scope(Some("todo:read"));
    // A layer from one authorized server over the service of another, configured alike.
    let layered = fixture.server(ToolStrategy::Individual, authorization());
    let served = fixture.server(ToolStrategy::Individual, authorization());
    let service = layered
        .bearer_layer()
        .unwrap()
        .layer(served.streamable_http_service(HttpOptions::default()));
    let answer = send_to(
        service,
        post("tools/call", call("todo-list", json!({})), Some(&token)),
    )
    .await;
    assert_eq!(
        command_result(&answer.body)["error"]["code"],
        "UNAUTHORIZED",
        "{}",
        answer.text
    );
    // Credentials put in the extensions without `Authorization::admit`.
    let inner = served.streamable_http_service(HttpOptions::default());
    let raw = tower::service_fn(move |mut request: http::Request<Full<Bytes>>| {
        request.extensions_mut().insert(
            Credentials::new(ISSUER, "user-1", "todo-agent", RESOURCE, NOW, NOW + 60)
                .with_scopes(["todo:read"]),
        );
        inner.clone().oneshot(request)
    });
    let answer = send_to(raw, post("tools/call", call("todo-list", json!({})), None)).await;
    assert_eq!(
        command_result(&answer.body)["error"]["code"],
        "UNAUTHORIZED"
    );
    // The one constructor that builds both from the same server serves it.
    let answer = send(
        &served,
        post("tools/call", call("todo-list", json!({})), Some(&token)),
    )
    .await;
    assert_eq!(
        command_result(&answer.body)["success"],
        true,
        "{}",
        answer.text
    );
    assert_eq!(fixture.runs(), 1);
}

// ─── A resolver is asked again at execution ──────────────────────────────────────────────────

/// `notes-read` in the space `secret` needs `notes:secret`.
struct Secret;

impl ScopeResolver for Secret {
    fn resolve(&self, command: &str, input: &Value, credentials: &Credentials) -> ScopeDecision {
        if command == "notes-read"
            && input["space"] == "secret"
            && !credentials.has_scope("notes:secret")
        {
            return ScopeDecision::Missing(vec!["notes:secret".to_owned()]);
        }
        ScopeDecision::Allowed
    }

    fn visible(&self, _command: &str, _credentials: &Credentials) -> bool {
        true
    }
}

#[tokio::test]
async fn a_resolver_decides_again_on_the_validated_input() {
    let fixture = fixture();
    let server = fixture.server(
        ToolStrategy::Individual,
        authorization().with_resolver(Secret),
    );
    let token = token_with_scope(Some("todo:read"));
    let refused = |answer: &Answer| {
        let text = command_result(&answer.body).to_string();
        text.contains("INSUFFICIENT_SCOPE") && text.contains("notes:secret")
    };
    // Sent explicitly: the 403 before dispatch.
    let answer = send(
        &server,
        post(
            "tools/call",
            call("notes-read", json!({ "space": "secret" })),
            Some(&token),
        ),
    )
    .await;
    assert_eq!(answer.status, 403);
    // Left out, so the default supplies it: refused at execution.
    let answer = send(
        &server,
        post("tools/call", call("notes-read", json!({})), Some(&token)),
    )
    .await;
    assert!(refused(&answer), "{}", answer.text);
    // Through afd-call and afd-batch the same way.
    let answer = send(
        &server,
        post(
            "tools/call",
            call("afd-call", json!({ "command": "notes-read" })),
            Some(&token),
        ),
    )
    .await;
    assert!(refused(&answer), "{}", answer.text);
    let answer = send(
        &server,
        post(
            "tools/call",
            call(
                "afd-batch",
                json!({ "commands": [{ "command": "notes-read" }] }),
            ),
            Some(&token),
        ),
    )
    .await;
    assert!(refused(&answer), "{}", answer.text);
    // Drawn from a previous step: refused at execution, after the reference is resolved.
    let pipe = call(
        "afd-pipe",
        json!({ "steps": [
            { "command": "space-pick" },
            { "command": "notes-read", "input": { "space": "$prev.space" } },
        ] }),
    );
    let answer = send(&server, post("tools/call", pipe, Some(&token))).await;
    let result = command_result(&answer.body);
    assert_eq!(
        result["steps"][1]["error"]["code"], "INSUFFICIENT_SCOPE",
        "{result}"
    );
    // A nested in-process call that passes its context on.
    let answer = send(
        &server,
        post("tools/call", call("notes-nested", json!({})), Some(&token)),
    )
    .await;
    let result = command_result(&answer.body);
    assert_eq!(
        result["data"]["inner"]["error"]["code"], "INSUFFICIENT_SCOPE",
        "{result}"
    );
    // Only `space-pick` ran; `notes-read` never did.
    assert_eq!(fixture.runs(), 1);
    // With the scope, the defaulted call runs.
    let granted = token_with_scope(Some("todo:read notes:secret"));
    let answer = send(
        &server,
        post("tools/call", call("notes-read", json!({})), Some(&granted)),
    )
    .await;
    assert_eq!(
        command_result(&answer.body)["data"]["space"],
        "secret",
        "{}",
        answer.text
    );
}

// ─── Resource providers see the caller ───────────────────────────────────────────────────────

/// Lists and reads `file:///secret.txt` only for a caller holding `docs:read`.
struct Gated;

#[async_trait]
impl ResourceProvider for Gated {
    fn list(&self) -> Vec<ResourceEntry> {
        vec![ResourceEntry::new("file:///secret.txt", "secret")]
    }

    fn list_for(&self, caller: &ResourceCaller) -> Vec<ResourceEntry> {
        let allowed = caller
            .credentials
            .as_ref()
            .is_some_and(|credentials| credentials.has_scope("docs:read"));
        if allowed {
            self.list()
        } else {
            Vec::new()
        }
    }

    async fn read_for(
        &self,
        _uri: &str,
        caller: &ResourceCaller,
    ) -> Result<ResourceContents, ResourceReadError> {
        match &caller.credentials {
            Some(credentials) if credentials.has_scope("docs:read") => {
                Ok(ResourceContents::new(b"the secret".to_vec()))
            }
            _ => Err(ResourceReadError::NotFound),
        }
    }
}

#[tokio::test]
async fn resource_providers_see_the_caller() {
    let fixture = fixture();
    let server = fixture
        .server(ToolStrategy::Individual, authorization())
        .with_resources(Gated);
    let reader = token_with_scope(Some("docs:read"));
    let other = token_with_scope(Some("todo:read"));
    let listed = send(&server, post("resources/list", json!({}), Some(&reader))).await;
    assert_eq!(
        listed.body["result"]["resources"][0]["uri"], "file:///secret.txt",
        "{}",
        listed.text
    );
    let listed = send(&server, post("resources/list", json!({}), Some(&other))).await;
    assert_eq!(
        listed.body["result"]["resources"],
        json!([]),
        "{}",
        listed.text
    );
    let read = json!({ "uri": "file:///secret.txt" });
    let read_post = |token: &str| {
        let mut request = post("resources/read", read.clone(), Some(token));
        request
            .headers_mut()
            .insert("mcp-name", "file:///secret.txt".parse().unwrap());
        request
    };
    let answer = send(&server, read_post(&reader)).await;
    assert_eq!(
        answer.body["result"]["contents"][0]["text"], "the secret",
        "{}",
        answer.text
    );
    let answer = send(&server, read_post(&other)).await;
    assert_eq!(answer.body["error"]["code"], -32602, "{}", answer.text);
}

// ─── Claims and debug output ─────────────────────────────────────────────────────────────────

#[test]
fn a_token_that_expires_before_it_was_issued_is_refused() {
    let mut claims = claims();
    claims["iat"] = json!(NOW);
    claims["exp"] = json!(NOW - 1);
    // `now` inside the skew of `exp`, so only the lifetime rule can refuse it.
    let got = check_claims(
        claims.as_object().unwrap(),
        ISSUER,
        &rules(),
        NOW - 30,
        None,
    );
    assert_eq!(got.map(|_| ()), Err(RuleCode::Lifetime));
}

#[test]
fn debug_output_never_holds_the_credentials_actor() {
    let credentials = Credentials::new(
        ISSUER,
        "subject-4f1c",
        "client-8d2e",
        RESOURCE,
        NOW,
        NOW + 60,
    );
    let context = CommandContext::new()
        .with_actor(credentials.default_actor())
        .with_credentials(credentials);
    let printed = format!("{context:?}");
    assert!(!printed.contains("subject-4f1c"), "{printed}");
    assert!(!printed.contains("client-8d2e"), "{printed}");
    assert!(printed.contains("Agent"), "{printed}");
}
