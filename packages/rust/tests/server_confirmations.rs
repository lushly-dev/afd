//! Confirmation enforcement on the `server` feature (`spec/command-metadata.md`,
//! "Confirmations"), over Streamable HTTP with MCP 2026-07-28 requests.
#![cfg(feature = "server")]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{ConfirmationMode, HttpOptions, McpServer};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    CommandResult, JsonSchemaType,
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
    let service = server.streamable_http_service(HttpOptions::default());
    let request = http::Request::post("/mcp")
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
    let tools = enforce.tools();
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
    let tools = human.tools();
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
