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

/// The form-mode approval relay (`spec/command-metadata.md`, "Asking the human over MCP").
#[cfg(feature = "approval")]
mod approval_relay {
    use super::*;

    // ─── The form-mode approval relay (`spec/command-metadata.md`, "Asking the human over MCP") ───

    const SECRET: &str = "test-approval-secret-0123456789abcdef";
    const STATE_KEY: [u8; 32] = [9u8; 32];

    /// `todo-delete` needs approval; `todo-clear` needs a confirmation and an approval. The approval
    /// middleware relays over MCP and keeps tokens off.
    pub(super) fn relay_server(mode: ConfirmationMode) -> (McpServer, Arc<AtomicUsize>) {
        use afd::{
            create_approval_middleware, ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalRelay,
        };
        let runs = Arc::new(AtomicUsize::new(0));
        let registry = CommandRegistry::new();
        let mut delete = CommandDefinition::new(
            "todo-delete",
            "Delete a todo",
            vec![afd::CommandParameter::required_number("id", "Todo ID")],
            Clear(Arc::clone(&runs)),
        )
        .with_approval(ApprovalPolicy::Required);
        let mut clear =
            CommandDefinition::new("todo-clear", "Clear", vec![], Clear(Arc::clone(&runs)))
                .with_confirm_prompt("Delete every todo?")
                .with_approval(ApprovalPolicy::Required);
        delete.expose.mcp = true;
        clear.expose.mcp = true;
        registry.register(delete).unwrap();
        registry.register(clear).unwrap();
        let options = ApprovalMiddlewareOptions::new(SECRET, registry.list())
            .with_include_token(false)
            .with_relay(ApprovalRelay::McpElicitation);
        registry.add_middleware(create_approval_middleware(options).unwrap());
        let server = McpServer::new(Arc::new(registry), "relay", "1.0.0")
            .with_confirmations_key(mode, STATE_KEY.to_vec())
            .unwrap();
        (server, runs)
    }

    pub(super) fn named_call(
        name: &str,
        id: u64,
        args: Value,
        elicitation: bool,
        extra: Value,
    ) -> Value {
        let mut body = call(id, args, elicitation, extra);
        body["params"]["name"] = json!(name);
        body
    }

    pub(super) fn approve(answer: bool) -> Value {
        json!({ "approval": { "action": "accept", "content": { "approve": answer } } })
    }

    pub(super) fn state_of(response: &Value) -> String {
        response["result"]["requestState"]
            .as_str()
            .unwrap_or_else(|| panic!("no state: {response}"))
            .to_owned()
    }

    #[tokio::test]
    async fn an_approval_is_asked_with_a_form_and_runs_once() {
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let input = json!({ "id": 7 });
        let asked = post(
            &server,
            named_call("todo-delete", 1, input.clone(), true, json!({})),
            "todo-delete",
        )
        .await;
        let request = &asked["result"]["inputRequests"]["approval"];
        assert_eq!(asked["result"]["resultType"], "input_required", "{asked}");
        assert_eq!(request["params"]["mode"], "form");
        assert_eq!(
            request["params"]["message"],
            "Run todo-delete\n\nCommand: todo-delete\nInput: {\"id\":7}"
        );
        assert_eq!(
            request["params"]["requestedSchema"]["required"],
            json!(["approve"])
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0);
        let state = state_of(&asked);

        let extra = json!({ "inputResponses": approve(true), "requestState": state });
        let ran = post(
            &server,
            named_call("todo-delete", 2, input.clone(), true, extra.clone()),
            "todo-delete",
        )
        .await;
        assert_eq!(body(&ran)["success"], true, "{ran}");
        assert_eq!(runs.load(Ordering::SeqCst), 1);

        // The same answer again: its nonce is spent, so the human is asked again, saying why.
        let again = post(
            &server,
            named_call("todo-delete", 3, input, true, extra),
            "todo-delete",
        )
        .await;
        let message = again["result"]["inputRequests"]["approval"]["params"]["message"]
            .as_str()
            .unwrap_or_else(|| panic!("{again}"));
        assert!(
            message.starts_with("The earlier approval expired or was already used"),
            "{message}"
        );
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_declined_approval_ends_the_call() {
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let input = json!({ "id": 7 });
        let asked = post(
            &server,
            named_call("todo-delete", 1, input.clone(), true, json!({})),
            "todo-delete",
        )
        .await;
        let state = state_of(&asked);
        for (id, responses) in [
            (2, approve(false)),
            (3, json!({ "approval": { "action": "decline" } })),
            (4, json!({ "approval": { "action": "cancel" } })),
        ] {
            let extra = json!({ "inputResponses": responses, "requestState": state });
            let refused = body(
                &post(
                    &server,
                    named_call("todo-delete", id, input.clone(), true, extra),
                    "todo-delete",
                )
                .await,
            );
            assert_eq!(refused["error"]["code"], "APPROVAL_REQUIRED", "{refused}");
            assert_eq!(refused["error"]["details"]["reason"], "declined");
            assert_eq!(refused["error"]["retryable"], false);
            assert!(refused["error"]["details"].get("approvalToken").is_none());
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn a_confirmation_and_an_approval_are_asked_in_turn() {
        let (server, runs) = relay_server(ConfirmationMode::RequireHuman);
        let clear = |id: u64, extra: Value| named_call("todo-clear", id, json!({}), true, extra);
        let first = post(&server, clear(1, json!({})), "todo-clear").await;
        assert!(
            first["result"]["inputRequests"]["confirm"].is_object(),
            "{first}"
        );
        let confirmed =
            json!({ "confirm": { "action": "accept", "content": { "confirm": true } } });
        let second = post(
            &server,
            clear(
                2,
                json!({ "inputResponses": confirmed, "requestState": state_of(&first) }),
            ),
            "todo-clear",
        )
        .await;
        // The confirmation's answer is carried while the approval is asked.
        assert!(
            second["result"]["inputRequests"]["approval"].is_object(),
            "{second}"
        );
        assert!(second["result"]["inputRequests"].get("confirm").is_none());
        assert_eq!(runs.load(Ordering::SeqCst), 0);
        let third = post(
            &server,
            clear(
                3,
                json!({ "inputResponses": approve(true), "requestState": state_of(&second) }),
            ),
            "todo-clear",
        )
        .await;
        assert_eq!(body(&third)["success"], true, "{third}");
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn an_approval_state_is_bound_to_the_actor_it_was_issued_to() {
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let server = by_header(server);
        let input = json!({ "id": 7 });
        let asked = post_as(
            &server,
            named_call("todo-delete", 1, input.clone(), true, json!({})),
            "todo-delete",
            Some("agent-a@user-1"),
        )
        .await;
        let state = state_of(&asked);
        for (id, responses) in [(2, approve(true)), (3, approve(false))] {
            let extra = json!({ "inputResponses": responses, "requestState": state });
            let other = post_as(
                &server,
                named_call("todo-delete", id, input.clone(), true, extra),
                "todo-delete",
                Some("agent-b@user-1"),
            )
            .await;
            // Neither an approval nor a decline for another caller: they are asked themselves.
            assert!(
                other["result"]["inputRequests"]["approval"].is_object(),
                "{other}"
            );
        }
        assert_eq!(runs.load(Ordering::SeqCst), 0);
        let extra = json!({ "inputResponses": approve(true), "requestState": state });
        let ran = post_as(
            &server,
            named_call("todo-delete", 4, input, true, extra),
            "todo-delete",
            Some("agent-a@user-1"),
        )
        .await;
        assert_eq!(body(&ran)["success"], true, "{ran}");
    }

    #[tokio::test]
    async fn the_state_key_alone_cannot_mint_an_approval() {
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let input = json!({ "id": 7 });
        let asked = post(
            &server,
            named_call("todo-delete", 1, input.clone(), true, json!({})),
            "todo-delete",
        )
        .await;
        // Whoever holds the state key reads and re-signs the state, but not the approval's MAC.
        let codec = rmcp::model::RequestStateCodec::try_new(STATE_KEY.to_vec()).unwrap();
        let principal = afd::principal_binding(Some(&Actor::new(ActorKind::Agent)), None).unwrap();
        let binding =
            afd::server::confirmations::confirmation_binding("todo-delete", &input, &principal);
        let opened: Value =
            serde_json::from_slice(&codec.open_with(&state_of(&asked), &binding).unwrap()).unwrap();
        let asked_item = opened["p"][0].clone();
        assert_eq!(asked_item["k"], "approval");
        let forge = |change: &dyn Fn(&mut Value)| {
            let mut item = asked_item.clone();
            change(&mut item);
            let payload = serde_json::to_vec(&json!({ "p": [item], "a": [] })).unwrap();
            codec.seal_with(
                &payload,
                &rmcp::model::SealOptions::new()
                    .associated_data(&binding)
                    .ttl(std::time::Duration::from_secs(600)),
            )
        };
        let forged = [
            forge(&|item| item["n"] = json!("another-nonce")),
            forge(&|item| item["x"] = json!(item["x"].as_i64().unwrap() + 3_600_000)),
            forge(&|item| item["m"] = json!("AAAA")),
        ];
        for (id, state) in forged.into_iter().enumerate() {
            let extra = json!({ "inputResponses": approve(true), "requestState": state });
            let again = post(
                &server,
                named_call("todo-delete", 10 + id as u64, input.clone(), true, extra),
                "todo-delete",
            )
            .await;
            assert!(
                again["result"]["inputRequests"]["approval"].is_object(),
                "{again}"
            );
        }
        // The genuine item, re-signed, still works: only the approval's own MAC was in the way.
        let genuine = forge(&|_| {});
        let extra = json!({ "inputResponses": approve(true), "requestState": genuine });
        let ran = post(
            &server,
            named_call("todo-delete", 20, input, true, extra),
            "todo-delete",
        )
        .await;
        assert_eq!(body(&ran)["success"], true, "{ran}");
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_confirmation_answer_is_never_an_approval() {
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let input = json!({ "id": 7 });
        let asked = post(
            &server,
            named_call("todo-delete", 1, input.clone(), true, json!({})),
            "todo-delete",
        )
        .await;
        let confirmed = json!({ "confirm": { "action": "accept", "content": { "confirm": true, "approve": true } } });
        let extra = json!({ "inputResponses": confirmed, "requestState": state_of(&asked) });
        let again = post(
            &server,
            named_call("todo-delete", 2, input, true, extra),
            "todo-delete",
        )
        .await;
        assert!(
            again["result"]["inputRequests"]["approval"].is_object(),
            "{again}"
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn calls_that_cannot_elicit_are_held_without_a_token() {
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let held = body(
            &post(
                &server,
                named_call("todo-delete", 1, json!({ "id": 7 }), false, json!({})),
                "todo-delete",
            )
            .await,
        );
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED");
        assert!(held["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("supports form elicitation"));
        assert!(held["error"]["details"].get("approvalToken").is_none());
        let batch = named_call(
            "afd-batch",
            2,
            json!({ "commands": [{ "command": "todo-delete", "input": { "id": 7 } }] }),
            true,
            json!({}),
        );
        let batch = post(&server, batch, "afd-batch").await;
        assert_ne!(batch["result"]["resultType"], "input_required", "{batch}");
        let batch = body(&batch);
        let step = &batch["results"][0];
        assert_eq!(
            step["result"]["error"]["code"], "APPROVAL_REQUIRED",
            "{batch}"
        );
        assert!(step["result"]["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("inside afd-batch"));
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }

    /// With the default options (tokens included), a server that relays approvals over MCP still
    /// gives the agent no token on a call that cannot be asked.
    #[tokio::test]
    async fn fallbacks_carry_no_token_even_when_tokens_are_included() {
        use afd::{
            create_approval_middleware, ApprovalMiddlewareOptions, ApprovalPolicy, ApprovalRelay,
        };
        let runs = Arc::new(AtomicUsize::new(0));
        let registry = CommandRegistry::new();
        let mut delete = CommandDefinition::new(
            "todo-delete",
            "Delete a todo",
            vec![afd::CommandParameter::required_number("id", "Todo ID")],
            Clear(Arc::clone(&runs)),
        )
        .with_approval(ApprovalPolicy::Required);
        delete.expose.mcp = true;
        registry.register(delete).unwrap();
        let options = ApprovalMiddlewareOptions::new(SECRET, registry.list())
            .with_relay(ApprovalRelay::McpElicitation);
        registry.add_middleware(create_approval_middleware(options).unwrap());
        let server = McpServer::new(Arc::new(registry), "relay", "1.0.0");
        let without_form = named_call("todo-delete", 1, json!({ "id": 7 }), false, json!({}));
        let held = body(&post(&server, without_form, "todo-delete").await);
        assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED", "{held}");
        assert!(
            held["error"]["details"].get("approvalToken").is_none(),
            "{held}"
        );
        assert!(held["error"]["suggestion"]
            .as_str()
            .unwrap()
            .contains("supports form elicitation"));
        let batch = named_call(
            "afd-batch",
            2,
            json!({ "commands": [{ "command": "todo-delete", "input": { "id": 7 } }] }),
            true,
            json!({}),
        );
        let batch = body(&post(&server, batch, "afd-batch").await);
        let error = &batch["results"][0]["result"]["error"];
        assert_eq!(error["code"], "APPROVAL_REQUIRED", "{batch}");
        assert!(error["details"].get("approvalToken").is_none(), "{batch}");
        assert!(error["suggestion"]
            .as_str()
            .unwrap()
            .contains("inside afd-batch"));
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }

    /// A 2025 stdio connection whose client declares form elicitation and answers each
    /// `elicitation/create` with the next of `answers`; returns the call's response and the questions.
    async fn legacy_call(
        server: McpServer,
        params: Value,
        answers: Vec<Value>,
    ) -> (Value, Vec<Value>) {
        use rmcp::ServiceExt;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let (mut writer, server_reader) = tokio::io::duplex(1 << 20);
        let (server_writer, client_reader) = tokio::io::duplex(1 << 20);
        tokio::spawn(async move {
            if let Ok(running) = server.serve((server_reader, server_writer)).await {
                let _ = running.waiting().await;
            }
        });
        let mut reader = BufReader::new(client_reader);
        let send = |message: Value| format!("{message}\n");
        let mut answers = answers.into_iter();
        let mut asked = Vec::new();
        let initialize = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": { "elicitation": { "form": {} } },
            "clientInfo": { "name": "legacy", "version": "0" },
        }});
        writer.write_all(send(initialize).as_bytes()).await.unwrap();
        let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        writer
            .write_all(send(initialized).as_bytes())
            .await
            .unwrap();
        let call = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": params });
        writer.write_all(send(call).as_bytes()).await.unwrap();
        loop {
            let mut line = String::new();
            assert!(reader.read_line(&mut line).await.unwrap() > 0);
            let message: Value = serde_json::from_str(&line).unwrap();
            if message["method"] == "elicitation/create" {
                asked.push(message["params"].clone());
                let answer = answers.next().unwrap_or(json!({ "action": "cancel" }));
                let reply = json!({ "jsonrpc": "2.0", "id": message["id"], "result": answer });
                writer.write_all(send(reply).as_bytes()).await.unwrap();
            } else if message["id"] == 2 {
                return (message, asked);
            }
        }
    }

    #[tokio::test]
    async fn a_2025_stdio_connection_is_asked_in_band() {
        let params = json!({ "name": "todo-delete", "arguments": { "id": 7 } });
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let accept = json!({ "action": "accept", "content": { "approve": true } });
        let (ran, asked) = legacy_call(server, params.clone(), vec![accept]).await;
        assert_eq!(body(&ran)["success"], true, "{ran}");
        assert_eq!(asked.len(), 1);
        assert_eq!(asked[0]["requestedSchema"]["required"], json!(["approve"]));
        assert_eq!(runs.load(Ordering::SeqCst), 1);

        let (server, runs) = relay_server(ConfirmationMode::Off);
        let (refused, _) = legacy_call(server, params, vec![json!({ "action": "decline" })]).await;
        assert_eq!(
            body(&refused)["error"]["details"]["reason"],
            "declined",
            "{refused}"
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }
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
            .header("mcp-name", body["params"]["name"].as_str().unwrap())
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

    #[cfg(feature = "approval")]
    #[tokio::test]
    async fn incomplete_credentials_never_mint_an_approval_state() {
        use super::approval_relay::{approve, named_call, relay_server, state_of};
        let (server, runs) = relay_server(ConfirmationMode::Off);
        let authorization = Authorization::new(
            ProtectedResource::new(RESOURCE, ["https://auth.example.com"]).unwrap(),
            ByToken,
        )
        .unwrap();
        let server = server.with_authorization(authorization);
        let delete =
            |id: u64, extra: Value| named_call("todo-delete", id, json!({ "id": 7 }), true, extra);
        let asked = post_with(&server, delete(1, json!({})), "auth.user-1.todo-agent").await;
        assert!(
            asked["result"]["inputRequests"]["approval"].is_object(),
            "{asked}"
        );
        let state = state_of(&asked);
        for (id, token) in [
            (2, "-.user-1.todo-agent"),
            (3, "auth..todo-agent"),
            (4, "auth.user-1."),
        ] {
            let first = post_with(&server, delete(id, json!({})), token).await;
            assert_eq!(first["error"]["code"], -32603, "{token}: {first}");
            let extra = json!({ "inputResponses": approve(true), "requestState": state });
            let retry = post_with(&server, delete(id + 10, extra), token).await;
            assert_eq!(retry["error"]["code"], -32603, "{token}: {retry}");
            assert_eq!(retry["error"]["message"], "Internal error");
        }
        // Another client of the same person is another principal: asked again.
        let extra = json!({ "inputResponses": approve(true), "requestState": state });
        let other = post_with(&server, delete(20, extra), "auth.user-1.other-agent").await;
        assert!(
            other["result"]["inputRequests"]["approval"].is_object(),
            "{other}"
        );
        assert_eq!(runs.load(Ordering::SeqCst), 0);
    }
}
