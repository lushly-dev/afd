//! Confirmation enforcement on the `server` feature (`spec/command-metadata.md`,
//! "Confirmations"), over Streamable HTTP with MCP 2026-07-28 requests.
#![cfg(feature = "server")]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{ConfirmationMode, HttpOptions, McpServer, ToolStrategy};
use afd::{
    success, Actor, ActorKind, CommandContext, CommandDefinition, CommandHandler, CommandParameter,
    CommandRegistry, CommandResult, JsonSchemaType,
};
use async_trait::async_trait;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

struct Clear(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Clear {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!({ "input": input }))
    }
}

fn server(mode: ConfirmationMode) -> (McpServer, Arc<AtomicUsize>) {
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let mut clear = CommandDefinition::new(
        "todo-clear",
        "Delete todos",
        vec![CommandParameter {
            name: "all".to_owned(),
            param_type: JsonSchemaType::Boolean,
            description: "Clear every todo".to_owned(),
            required: false,
            default: None,
            enum_values: None,
            schema: None,
        }],
        Clear(Arc::clone(&runs)),
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Delete every todo?");
    clear.expose.mcp = true;
    registry.register(clear).unwrap();
    let mut list = CommandDefinition::new("todo-list", "List", vec![], Clear(Arc::clone(&runs)));
    list.expose.mcp = true;
    registry.register(list).unwrap();
    (
        McpServer::new(Arc::new(registry), "confirm", "1.0.0").with_confirmations(mode),
        runs,
    )
}

async fn post(server: &McpServer, body: Value, name: &str) -> Value {
    post_as(server, body, name, None).await
}

/// `post`, with the test-only `x-test-actor` header that [`by_header`]'s hook reads.
async fn post_as(server: &McpServer, body: Value, name: &str, actor: Option<&str>) -> Value {
    let service = server.streamable_http_service(HttpOptions::default());
    let mut request = http::Request::post("/mcp");
    if let Some(actor) = actor {
        request = request.header("x-test-actor", actor);
    }
    let request = request
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", body["method"].as_str().unwrap_or_default())
        .header("mcp-name", name)
        .body(Full::new(bytes::Bytes::from(body.to_string())))
        .unwrap();
    let response = service.oneshot(request).await.unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::Null)
    })
}

fn call(id: u64, args: Value, elicitation: bool, extra: Value) -> Value {
    let capabilities = if elicitation {
        json!({ "elicitation": {} })
    } else {
        json!({})
    };
    let mut params = json!({
        "name": "todo-clear",
        "arguments": args,
        "_meta": {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": capabilities,
        },
    });
    if let Value::Object(extra) = extra {
        for (key, value) in extra {
            params[key] = value;
        }
    }
    json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": params })
}

fn body(response: &Value) -> Value {
    serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or("null"),
    )
    .unwrap()
}

#[tokio::test]
async fn gated_tools_advertise_confirm_under_enforce_only() {
    let (enforce, _) = server(ConfirmationMode::Enforce);
    let tools = enforce
        .clone()
        .with_tool_strategy(ToolStrategy::Individual)
        .tools();
    let clear = tools
        .iter()
        .find(|tool| tool["name"] == "todo-clear")
        .unwrap();
    assert!(clear["inputSchema"]["properties"]["confirm"].is_object());
    let list = tools
        .iter()
        .find(|tool| tool["name"] == "todo-list")
        .unwrap();
    assert!(list["inputSchema"]["properties"]["confirm"].is_null());
    let (human, _) = server(ConfirmationMode::RequireHuman);
    let tools = human.with_tool_strategy(ToolStrategy::Individual).tools();
    let clear = tools
        .iter()
        .find(|tool| tool["name"] == "todo-clear")
        .unwrap();
    assert!(clear["inputSchema"]["properties"]["confirm"].is_null());
}

#[tokio::test]
async fn a_client_without_elicitation_must_acknowledge() {
    let (server, runs) = server(ConfirmationMode::Enforce);
    let refused = body(&post(&server, call(1, json!({}), false, json!({})), "todo-clear").await);
    assert_eq!(refused["error"]["code"], "CONFIRMATION_REQUIRED");
    assert_eq!(
        refused["error"]["message"],
        "'todo-clear' needs confirmation: Delete every todo?"
    );
    assert_eq!(
        refused["error"]["details"]["commands"],
        json!(["todo-clear"])
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    let ran = body(
        &post(
            &server,
            call(2, json!({ "confirm": true, "all": true }), false, json!({})),
            "todo-clear",
        )
        .await,
    );
    assert_eq!(ran["success"], true);
    // The acknowledgement is removed before the command sees its input.
    assert_eq!(ran["data"]["input"], json!({ "all": true }));

    let mut meta_call = call(3, json!({}), false, json!({}));
    meta_call["params"]["_meta"]["dev.afd/confirm"] = json!(true);
    assert_eq!(
        body(&post(&server, meta_call, "todo-clear").await)["success"],
        true
    );
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn require_human_refuses_the_acknowledgement() {
    let (server, runs) = server(ConfirmationMode::RequireHuman);
    let refused = body(
        &post(
            &server,
            call(1, json!({ "confirm": true }), false, json!({})),
            "todo-clear",
        )
        .await,
    );
    assert_eq!(refused["error"]["code"], "CONFIRMATION_REQUIRED");
    assert!(refused["error"]["suggestion"]
        .as_str()
        .unwrap()
        .contains("elicitation"));
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn elicitation_round_trip_is_bound_to_the_input() {
    let (server, runs) = server(ConfirmationMode::Enforce);
    let asked = post(
        &server,
        call(1, json!({ "all": true }), true, json!({})),
        "todo-clear",
    )
    .await;
    let result = &asked["result"];
    assert_eq!(result["resultType"], "input_required");
    assert_eq!(
        result["inputRequests"]["confirm"]["params"]["message"],
        "Delete every todo?"
    );
    let state = result["requestState"].as_str().unwrap().to_owned();
    let accept = json!({ "confirm": { "action": "accept", "content": { "confirm": true } } });

    // The same answer and state for other input, or a tampered state: asked again.
    let other = post(
        &server,
        call(
            2,
            json!({ "all": false }),
            true,
            json!({ "inputResponses": accept, "requestState": state }),
        ),
        "todo-clear",
    )
    .await;
    assert_eq!(other["result"]["resultType"], "input_required");
    let tampered = format!("{}x", &state[..state.len() - 1]);
    let other = post(
        &server,
        call(
            3,
            json!({ "all": true }),
            true,
            json!({ "inputResponses": accept, "requestState": tampered }),
        ),
        "todo-clear",
    )
    .await;
    assert_eq!(other["result"]["resultType"], "input_required");
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    let ran = post(
        &server,
        call(
            4,
            json!({ "all": true }),
            true,
            json!({ "inputResponses": accept, "requestState": state }),
        ),
        "todo-clear",
    )
    .await;
    assert_eq!(body(&ran)["success"], true);
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    let decline = json!({ "confirm": { "action": "decline" } });
    let refused = post(
        &server,
        call(
            5,
            json!({ "all": true }),
            true,
            json!({ "inputResponses": decline, "requestState": state }),
        ),
        "todo-clear",
    )
    .await;
    let refused = body(&refused);
    assert_eq!(refused["error"]["code"], "CONFIRMATION_DECLINED");
    assert_eq!(refused["error"]["retryable"], false);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn off_gates_nothing() {
    let (server, runs) = server(ConfirmationMode::Off);
    let ran = body(&post(&server, call(1, json!({}), true, json!({})), "todo-clear").await);
    assert_eq!(ran["success"], true);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[test]
fn a_short_key_is_refused() {
    let (server, _) = server(ConfirmationMode::Off);
    assert!(server
        .with_confirmations_key(ConfirmationMode::Enforce, b"short".to_vec())
        .is_err());
}

/// A hook that takes the actor from the test-only `x-test-actor` header, `<id>` or
/// `<id>@<onBehalfOf>`. Tests only: a real hook reads identity a layer verified, never a header.
fn by_header(server: McpServer) -> McpServer {
    server.with_context_hook(|request, context| async move {
        let header = request
            .http_parts()
            .and_then(|parts| parts.headers.get("x-test-actor"))
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        Ok(match header {
            Some(header) => {
                let (id, principal) = match header.split_once('@') {
                    Some((id, principal)) => (id.to_owned(), Some(principal.to_owned())),
                    None => (header, None),
                };
                let mut actor = Actor::new(ActorKind::Agent).with_id(id);
                if let Some(principal) = principal {
                    actor = actor.with_on_behalf_of(principal);
                }
                context.with_actor(actor)
            }
            None => context,
        })
    })
}

const ACCEPT: &str = r#"{ "confirm": { "action": "accept", "content": { "confirm": true } } }"#;

/// The `input_required` result without its `requestState`, which is fresh on every mint.
fn question(response: &Value) -> Value {
    let mut result = response["result"].clone();
    assert_eq!(result["resultType"], "input_required", "{response}");
    result.as_object_mut().unwrap().remove("requestState");
    result
}

#[tokio::test]
async fn a_state_is_bound_to_the_actor_it_was_issued_to() {
    let (server, runs) = server(ConfirmationMode::Enforce);
    let server = by_header(server);
    let input = json!({ "all": true });
    let asked = post_as(
        &server,
        call(1, input.clone(), true, json!({})),
        "todo-clear",
        Some("agent-a@user-1"),
    )
    .await;
    let asked_question = question(&asked);
    let state = asked["result"]["requestState"].as_str().unwrap().to_owned();
    let accept: Value = serde_json::from_str(ACCEPT).unwrap();
    let retry = |id: u64, state: &str| {
        call(
            id,
            input.clone(),
            true,
            json!({ "inputResponses": accept.clone(), "requestState": state }),
        )
    };

    // The tampered state's answer is the reference: another actor, the same actor acting for
    // someone else, or no actor at all gets exactly that answer, and nothing runs.
    let tampered = format!("{}x", &state[..state.len() - 1]);
    let refused = question(
        &post_as(
            &server,
            retry(2, &tampered),
            "todo-clear",
            Some("agent-a@user-1"),
        )
        .await,
    );
    assert_eq!(refused, asked_question);
    for (id, other) in [
        (3, Some("agent-b@user-1")),
        (4, Some("agent-a@user-2")),
        (5, Some("agent-a")),
        (6, None),
    ] {
        let answer = question(&post_as(&server, retry(id, &state), "todo-clear", other).await);
        assert_eq!(answer, refused, "{other:?}");
    }
    // Declining with another actor's state is no answer either: it is asked again, not declined.
    let decline = call(
        7,
        input.clone(),
        true,
        json!({ "inputResponses": { "confirm": { "action": "decline" } }, "requestState": state }),
    );
    assert_eq!(
        question(&post_as(&server, decline, "todo-clear", Some("agent-b@user-1")).await),
        refused
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    // The actor it was issued to still confirms with it.
    let ran = post_as(
        &server,
        retry(8, &state),
        "todo-clear",
        Some("agent-a@user-1"),
    )
    .await;
    assert_eq!(body(&ran)["success"], true);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_batch_state_is_bound_to_the_actor_too() {
    let (server, runs) = server(ConfirmationMode::Enforce);
    let server = by_header(server);
    let batch = |id: u64, extra: Value| {
        let mut body = call(
            id,
            json!({ "commands": [{ "command": "todo-clear", "input": { "all": true } }] }),
            true,
            extra,
        );
        body["params"]["name"] = json!("afd-batch");
        body
    };
    let asked = post_as(&server, batch(1, json!({})), "afd-batch", Some("agent-a")).await;
    let state = asked["result"]["requestState"].as_str().unwrap().to_owned();
    let accept: Value = serde_json::from_str(ACCEPT).unwrap();
    let extra = json!({ "inputResponses": accept, "requestState": state });
    let other = post_as(
        &server,
        batch(2, extra.clone()),
        "afd-batch",
        Some("agent-b"),
    )
    .await;
    assert_eq!(question(&other), question(&asked));
    assert_eq!(runs.load(Ordering::SeqCst), 0);
    post_as(&server, batch(3, extra), "afd-batch", Some("agent-a")).await;
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_state_from_before_the_principal_binding_does_not_verify() {
    // The layout before #532: the command and input alone, as associated data.
    let key = vec![7u8; 32];
    let codec = rmcp::model::RequestStateCodec::try_new(key.clone()).unwrap();
    let old_binding = br#"[["todo-clear",{"all":true}]]"#;
    let old = codec.seal_with(
        b"confirm",
        &rmcp::model::SealOptions::new()
            .associated_data(old_binding)
            .ttl(std::time::Duration::from_secs(600)),
    );
    let (server, runs) = server(ConfirmationMode::Enforce);
    let server = server
        .with_confirmations_key(ConfirmationMode::Enforce, key)
        .unwrap();
    let accept: Value = serde_json::from_str(ACCEPT).unwrap();
    let asked = post(
        &server,
        call(
            1,
            json!({ "all": true }),
            true,
            json!({ "inputResponses": accept, "requestState": old }),
        ),
        "todo-clear",
    )
    .await;
    assert_eq!(asked["result"]["resultType"], "input_required");
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[test]
fn the_binding_includes_the_principal() {
    use afd::server::confirmations::confirmation_binding;
    let input = json!({ "all": true });
    let a = afd::principal_binding(Some(&Actor::new(ActorKind::Agent).with_id("a")), None).unwrap();
    let b = afd::principal_binding(Some(&Actor::new(ActorKind::Agent).with_id("b")), None).unwrap();
    assert_ne!(
        confirmation_binding("todo-clear", &input, &a),
        confirmation_binding("todo-clear", &input, &b)
    );
    assert_eq!(
        confirmation_binding("todo-clear", &input, &a),
        confirmation_binding("todo-clear", &json!({ "all": true }), &a)
    );
}

/// With `server-auth`: the state binds the verified credentials' issuer, subject and client.
#[cfg(feature = "server-auth")]
mod with_credentials {
    use super::*;
    use afd::server::auth::{
        AuthRefusal, Authorization, Credentials, ProtectedResource, RuleCode, TokenVerifier,
    };

    const RESOURCE: &str = "https://todo.example.com/mcp";

    /// Admits a token `<issuer host>.<subject>.<clientId>` (bearer token characters only) as the
    /// credentials of `https://<issuer host>.example.com`, or of an empty issuer for `-`. A
    /// real verifier never admits empty fields; this one stands for host code that builds them.
    struct ByToken;

    #[async_trait]
    impl TokenVerifier for ByToken {
        async fn verify(
            &self,
            token: &str,
            _request: &http::request::Parts,
        ) -> Result<Credentials, AuthRefusal> {
            let mut parts = token.split('.');
            match (parts.next(), parts.next(), parts.next()) {
                (Some(issuer), Some(subject), Some(client)) => Ok(Credentials::new(
                    if issuer == "-" {
                        String::new()
                    } else {
                        format!("https://{issuer}.example.com")
                    },
                    subject,
                    client,
                    RESOURCE,
                    1_700_000_000,
                    4_000_000_000,
                )),
                _ => Err(AuthRefusal::new(RuleCode::UnknownIssuer)),
            }
        }
    }

    async fn post_with(server: &McpServer, body: Value, token: &str) -> Value {
        let service = server
            .authorized_http_service(HttpOptions::default())
            .unwrap();
        let request = http::Request::post("/mcp")
            .header("host", "localhost")
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", "2026-07-28")
            .header("mcp-method", "tools/call")
            .header("mcp-name", "todo-clear")
            .header("authorization", format!("Bearer {token}"))
            .body(Full::new(bytes::Bytes::from(body.to_string())))
            .unwrap();
        let response = service.oneshot(request).await.unwrap();
        assert_eq!(response.status(), 200);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let text = String::from_utf8_lossy(&bytes).to_string();
        serde_json::from_str(&text).unwrap_or_else(|_| {
            text.lines()
                .find_map(|line| line.strip_prefix("data: "))
                .and_then(|data| serde_json::from_str(data).ok())
                .unwrap_or(Value::Null)
        })
    }

    #[tokio::test]
    async fn a_state_is_bound_to_the_issuer_subject_and_client() {
        let (server, runs) = server(ConfirmationMode::Enforce);
        let authorization = Authorization::new(
            ProtectedResource::new(RESOURCE, ["https://auth.example.com"]).unwrap(),
            ByToken,
        )
        .unwrap();
        // Every caller maps to one actor, so only the credentials tell them apart.
        let server =
            server
                .with_authorization(authorization)
                .with_context_hook(|_, context| async move {
                    Ok(context.with_actor(Actor::new(ActorKind::Agent).with_id("shared")))
                });
        let issued = "auth.user-1.todo-agent";
        let input = json!({ "all": true });
        let asked = post_with(&server, call(1, input.clone(), true, json!({})), issued).await;
        let state = asked["result"]["requestState"].as_str().unwrap().to_owned();
        let accept: Value = serde_json::from_str(ACCEPT).unwrap();
        let retry = |id: u64, state: &str| {
            call(
                id,
                input.clone(),
                true,
                json!({ "inputResponses": accept.clone(), "requestState": state }),
            )
        };
        let tampered = format!("{}x", &state[..state.len() - 1]);
        let refused = question(&post_with(&server, retry(2, &tampered), issued).await);
        assert_eq!(refused, question(&asked));
        for (id, other) in [
            (3, "other.user-1.todo-agent"),
            (4, "auth.user-2.todo-agent"),
            // The same person through another client is another principal.
            (5, "auth.user-1.other-agent"),
        ] {
            let answer = question(&post_with(&server, retry(id, &state), other).await);
            assert_eq!(answer, refused, "{other}");
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0);

        let ran = post_with(&server, retry(6, &state), issued).await;
        assert_eq!(body(&ran)["success"], true, "{ran}");
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    fn authorized(mode: ConfirmationMode) -> (McpServer, std::sync::Arc<AtomicUsize>) {
        let (server, runs) = server(mode);
        let authorization = Authorization::new(
            ProtectedResource::new(RESOURCE, ["https://auth.example.com"]).unwrap(),
            ByToken,
        )
        .unwrap();
        let server =
            server
                .with_authorization(authorization)
                .with_context_hook(|_, context| async move {
                    Ok(context.with_actor(Actor::new(ActorKind::Agent).with_id("shared")))
                });
        (server, runs)
    }

    #[tokio::test]
    async fn incomplete_credentials_never_mint_or_take_a_state() {
        let (server, runs) = authorized(ConfirmationMode::Enforce);
        let input = json!({ "all": true });
        let asked = post_with(
            &server,
            call(1, input.clone(), true, json!({})),
            "auth.user-1.todo-agent",
        )
        .await;
        let state = asked["result"]["requestState"].as_str().unwrap().to_owned();
        let accept: Value = serde_json::from_str(ACCEPT).unwrap();
        for (id, token) in [
            (2, "-.user-1.todo-agent"),
            (3, "auth..todo-agent"),
            (4, "auth.user-1."),
        ] {
            // No state is minted for them...
            let first = post_with(&server, call(id, input.clone(), true, json!({})), token).await;
            assert_eq!(first["error"]["code"], -32603, "{token}: {first}");
            assert_eq!(first["error"]["message"], "Internal error", "{token}");
            // ...and none is taken from them, not even one issued to a complete caller.
            let retry = post_with(
                &server,
                call(
                    id + 10,
                    input.clone(),
                    true,
                    json!({ "inputResponses": accept.clone(), "requestState": state }),
                ),
                token,
            )
            .await;
            assert_eq!(retry["error"]["code"], -32603, "{token}: {retry}");
            assert_eq!(retry["error"]["message"], "Internal error", "{token}");
            let text = retry.to_string();
            assert!(
                !text.contains("user-1") && !text.contains("todo-agent"),
                "{text}"
            );
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0);
        // The acknowledgement holds no state, so it is unaffected.
        let acknowledged = post_with(
            &server,
            call(30, json!({ "confirm": true }), false, json!({})),
            "auth..todo-agent",
        )
        .await;
        assert_eq!(body(&acknowledged)["success"], true, "{acknowledged}");
    }
}
