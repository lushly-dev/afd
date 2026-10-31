//! `structuredContent` and the top-level `outputSchema` on the `server` feature
//! (`spec/command-metadata.md`, "Structured results"), over Streamable HTTP and a stdio-shaped
//! connection. The checks are SDK-shaped: the wire JSON is parsed into the SDK's own `Tool` and
//! `CallToolResult` types, the way a client reads it, and `structuredContent` is validated
//! against the advertised schema the way a client does before it hands the result on.
#![cfg(feature = "server")]

mod common;

use std::sync::Arc;

use afd::server::McpServer;
use afd::{
    failure, success, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandRegistry, CommandResult, JsonSchema, JsonSchemaType,
};
use async_trait::async_trait;
use common::{modern_post, Stdio};
use rmcp::model::{CallToolResult, Tool};
use serde_json::{json, Value};

struct Item;

#[async_trait]
impl CommandHandler for Item {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "id": "item-1" }))
    }
}

struct Missing;

#[async_trait]
impl CommandHandler for Missing {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        failure(
            CommandError::new("NOT_FOUND", "No such item")
                .with_suggestion("List items first")
                .with_retryable(false),
        )
    }
}

/// Declares `returns` but sends data of another shape.
struct Wrong;

#[async_trait]
impl CommandHandler for Wrong {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "id": 7 }))
    }
}

fn item_schema() -> JsonSchema {
    JsonSchema {
        schema_type: Some(JsonSchemaType::Object),
        required: Some(vec!["id".to_owned()]),
        properties: Some(
            [(
                "id".to_owned(),
                JsonSchema {
                    schema_type: Some(JsonSchemaType::String),
                    ..JsonSchema::default()
                },
            )]
            .into(),
        ),
        ..JsonSchema::default()
    }
}

fn server() -> McpServer {
    let registry = CommandRegistry::new();
    let commands = [
        CommandDefinition::new("item-get", "Get an item", vec![], Item).with_returns(item_schema()),
        CommandDefinition::new("item-missing", "Fails", vec![], Missing)
            .with_returns(item_schema()),
        CommandDefinition::new("item-wrong", "Wrong shape", vec![], Wrong)
            .with_returns(item_schema()),
        CommandDefinition::new("item-plain", "No returns", vec![], Item),
    ];
    for mut command in commands {
        command.expose.mcp = true;
        registry.register(command).unwrap();
    }
    McpServer::new(Arc::new(registry), "structured", "1.0.0")
}

/// A client's validation of `structuredContent` against `outputSchema`, through the library's
/// own JSON Schema engine: a command whose input schema is the output schema.
async fn validates(schema: &Value, instance: &Value) -> bool {
    let registry = CommandRegistry::new();
    registry
        .register_with_schema(
            CommandDefinition::new("schema-check", "Validate", vec![], Item),
            schema.clone(),
        )
        .unwrap();
    registry
        .execute("schema-check", instance.clone(), None)
        .await
        .success
}

fn tool_of(tools: &Value, name: &str) -> Tool {
    let tool = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == name)
        .unwrap_or_else(|| panic!("{name} is listed"));
    serde_json::from_value(tool.clone()).expect("the SDK reads the tool")
}

fn output_schema(tool: &Tool) -> Option<Value> {
    tool.output_schema
        .as_ref()
        .map(|schema| Value::Object((**schema).clone()))
}

fn call_result(response: &Value) -> CallToolResult {
    serde_json::from_value(response["result"].clone()).expect("the SDK reads the result")
}

#[test]
fn a_command_with_returns_advertises_the_envelope_with_data_typed_by_returns() {
    let tools = Value::Array(server().tools());
    let schema = output_schema(&tool_of(&tools, "item-get")).expect("outputSchema is advertised");
    assert_eq!(schema["type"], "object");
    assert_eq!(schema["required"], json!(["success"]));
    assert_eq!(
        schema["properties"]["success"],
        json!({ "type": "boolean" })
    );
    assert_eq!(schema["properties"]["data"]["type"], "object");
    assert_eq!(schema["properties"]["data"]["required"], json!(["id"]));
    assert_eq!(
        schema["properties"]["data"]["properties"]["id"],
        json!({ "type": "string" })
    );
    // A command without `returns` advertises none.
    assert!(output_schema(&tool_of(&tools, "item-plain")).is_none());
}

#[test]
fn the_opt_out_removes_every_output_schema() {
    let tools = Value::Array(server().with_advertise_output_schema(false).tools());
    for name in ["item-get", "item-missing", "item-wrong", "item-plain"] {
        assert!(output_schema(&tool_of(&tools, name)).is_none(), "{name}");
    }
    // Turning it back on restores them.
    let tools = Value::Array(
        server()
            .with_advertise_output_schema(false)
            .with_advertise_output_schema(true)
            .tools(),
    );
    assert!(output_schema(&tool_of(&tools, "item-get")).is_some());
}

#[test]
fn custom_tool_lists_get_the_schema_unless_they_bring_their_own() {
    let custom = json!([
        { "name": "item-get", "description": "x", "inputSchema": { "type": "object" } },
        { "name": "item-missing", "description": "x", "inputSchema": { "type": "object" },
          "outputSchema": { "type": "object", "title": "mine" } },
    ]);
    let listed = Value::Array(
        server()
            .with_tools(custom.clone().as_array().unwrap().clone())
            .tools(),
    );
    assert_eq!(
        output_schema(&tool_of(&listed, "item-get")).unwrap()["required"],
        json!(["success"])
    );
    assert_eq!(
        output_schema(&tool_of(&listed, "item-missing")).unwrap()["title"],
        "mine"
    );
    let off = Value::Array(
        server()
            .with_tools(custom.as_array().unwrap().clone())
            .with_advertise_output_schema(false)
            .tools(),
    );
    assert!(output_schema(&tool_of(&off, "item-missing")).is_none());
}

/// What a client checks for one tool: the result validates against the advertised schema.
async fn client_accepts(tools: &Value, tool: &str, result: &CallToolResult, expect_ok: bool) {
    let schema = output_schema(&tool_of(tools, tool)).expect("outputSchema is advertised");
    let structured = result
        .structured_content
        .as_ref()
        .expect("structuredContent is present");
    // The text block is the same JSON, for clients that only read text.
    let text = result.content[0]
        .as_text()
        .expect("a text block")
        .text
        .clone();
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), *structured);
    assert_eq!(structured["success"], expect_ok);
    assert_eq!(result.is_error, Some(!expect_ok));
    assert!(validates(&schema, structured).await, "{structured}");
}

#[tokio::test]
async fn success_and_failure_validate_against_the_schema_over_http() {
    let server = server();
    let listed = modern_post(&server, "tools/list", json!({}), &[]).await;
    let tools = listed["result"]["tools"].clone();
    for (tool, ok) in [("item-get", true), ("item-missing", false)] {
        let response = modern_post(
            &server,
            "tools/call",
            json!({ "name": tool, "arguments": {} }),
            &[],
        )
        .await;
        client_accepts(&tools, tool, &call_result(&response), ok).await;
    }
}

#[tokio::test]
async fn success_and_failure_validate_against_the_schema_over_stdio() {
    let mut client = Stdio::connect(server()).await;
    let listed = client.request("tools/list", json!({})).await;
    let tools = listed["result"]["tools"].clone();
    for (tool, ok) in [("item-get", true), ("item-missing", false)] {
        let response = client
            .request("tools/call", json!({ "name": tool, "arguments": {} }))
            .await;
        client_accepts(&tools, tool, &call_result(&response), ok).await;
    }
}

#[tokio::test]
async fn failures_before_the_handler_carry_structured_content_too() {
    let server = server();
    // Unknown tool, and input that fails validation.
    for name in ["no-such-tool", "item-get"] {
        let args = if name == "item-get" {
            json!({ "unexpected": 1 })
        } else {
            json!({})
        };
        let response = modern_post(
            &server,
            "tools/call",
            json!({ "name": name, "arguments": args }),
            &[],
        )
        .await;
        let result = call_result(&response);
        let structured = result.structured_content.expect("structuredContent");
        if name == "no-such-tool" {
            assert_eq!(structured["error"]["code"], "COMMAND_NOT_FOUND");
            assert_eq!(result.is_error, Some(true));
        }
        assert!(structured["success"].is_boolean());
    }
}

#[tokio::test]
async fn a_handler_that_breaks_its_returns_fails_client_validation_until_opted_out() {
    let server = server();
    let listed = modern_post(&server, "tools/list", json!({}), &[]).await;
    let tools = listed["result"]["tools"].clone();
    let response = modern_post(
        &server,
        "tools/call",
        json!({ "name": "item-wrong", "arguments": {} }),
        &[],
    )
    .await;
    let result = call_result(&response);
    let schema = output_schema(&tool_of(&tools, "item-wrong")).unwrap();
    assert!(!validates(&schema, result.structured_content.as_ref().unwrap()).await);

    // Opted out: no schema to fail against, `structuredContent` still sent.
    let quiet = server.with_advertise_output_schema(false);
    let listed = modern_post(&quiet, "tools/list", json!({}), &[]).await;
    assert!(listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .all(|tool| tool.get("outputSchema").is_none()));
    let response = modern_post(
        &quiet,
        "tools/call",
        json!({ "name": "item-wrong", "arguments": {} }),
        &[],
    )
    .await;
    assert!(call_result(&response).structured_content.is_some());
}

#[tokio::test]
async fn the_validator_rejects_a_malformed_envelope() {
    let tools = Value::Array(server().tools());
    let schema = output_schema(&tool_of(&tools, "item-get")).unwrap();
    assert!(validates(&schema, &json!({ "success": true, "data": { "id": "a" } })).await);
    assert!(!validates(&schema, &json!({ "success": "yes" })).await);
    assert!(!validates(&schema, &json!({ "data": { "id": "a" } })).await);
}
