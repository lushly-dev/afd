//! Extra tool `_meta` and the advertised input schema (`spec/mcp-resources.md`, T1 to T3, V1 and
//! V2): emitted on every strategy that lists a command's own entry, reported by `afd-detail`,
//! and kept apart from the schema the registry validates with.
#![cfg(feature = "server")]

mod common;

use std::sync::Arc;

use afd::server::{ConfirmationMode, McpServer, ToolStrategy};
use afd::{
    register_bootstrap_commands, success, CommandContext, CommandDefinition, CommandHandler,
    CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::{command_result, Stdio};
use serde_json::{json, Value};

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

fn mcp() -> afd::ExposeOptions {
    afd::ExposeOptions::new().with_mcp(true)
}

fn view_meta() -> Value {
    json!({ "resourceUri": "ui://hello/view.html", "visibility": ["model", "app"] })
}

fn registry() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(
            CommandDefinition::new("hello-greet", "Greet", vec![], Echo)
                .with_expose(mcp())
                .with_category("hello")
                .with_approval(afd::approval::ApprovalDecision::Required)
                .with_tool_meta("dev.umbel/origin", json!({ "plugin": "hello" }))
                .with_tool_meta("ui", view_meta()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("hello-plain", "Plain", vec![], Echo)
                .with_expose(mcp())
                .with_category("hello"),
        )
        .unwrap();
    register_bootstrap_commands(&registry).unwrap();
    registry
}

fn server_for(strategy: ToolStrategy) -> McpServer {
    let server = McpServer::new(registry(), "meta", "1.0.0").with_tool_strategy(strategy);
    match strategy {
        ToolStrategy::Hybrid => server.with_first_class_tools(["hello-greet"]),
        _ => server,
    }
}

async fn tools(strategy: ToolStrategy) -> Vec<Value> {
    let server = server_for(strategy);
    let mut client = Stdio::connect_modern(server);
    let response = client
        .request(
            "tools/list",
            json!({ "_meta": serde_json::from_str::<Value>(common::META).unwrap() }),
        )
        .await;
    response["result"]["tools"].as_array().unwrap().clone()
}

fn tool<'a>(tools: &'a [Value], name: &str) -> &'a Value {
    tools
        .iter()
        .find(|tool| tool["name"] == name)
        .unwrap_or_else(|| panic!("no tool {name}"))
}

#[tokio::test]
async fn individual_and_first_class_tools_carry_the_entries_beside_the_servers() {
    for strategy in [ToolStrategy::Individual, ToolStrategy::Hybrid] {
        let listed = tools(strategy).await;
        let meta = &tool(&listed, "hello-greet")["_meta"];
        assert_eq!(
            meta["dev.umbel/origin"],
            json!({ "plugin": "hello" }),
            "{strategy:?}"
        );
        assert_eq!(meta["ui"], view_meta(), "{strategy:?}");
        assert_eq!(meta["approval"], "required", "{strategy:?}");
    }
    let individual = tools(ToolStrategy::Individual).await;
    assert!(tool(&individual, "hello-plain").get("_meta").is_none());
    // Meta-tools never carry extra entries.
    assert!(tool(&individual, "afd-call").get("_meta").is_none());
    // A hybrid first-class tool equals the individual tool for the same command (T3).
    let hybrid = tools(ToolStrategy::Hybrid).await;
    assert_eq!(
        tool(&hybrid, "hello-greet"),
        tool(&individual, "hello-greet")
    );
}

#[tokio::test]
async fn a_grouped_tool_carries_them_in_the_commands_action_entry_only() {
    let listed = tools(ToolStrategy::Grouped).await;
    let group = tool(&listed, "hello");
    let actions = group["_meta"]["actions"].as_array().unwrap();
    let greet = actions
        .iter()
        .find(|entry| entry["command"] == "hello-greet")
        .unwrap();
    assert_eq!(greet["dev.umbel/origin"], json!({ "plugin": "hello" }));
    assert_eq!(greet["ui"], view_meta());
    assert_eq!(greet["approval"], "required");
    let plain = actions
        .iter()
        .find(|entry| entry["command"] == "hello-plain")
        .unwrap();
    assert!(plain.get("ui").is_none() && plain.get("dev.umbel/origin").is_none());
    assert!(group["_meta"].get("ui").is_none());
}

#[tokio::test]
async fn afd_detail_reports_tool_meta_on_every_strategy() {
    for strategy in [
        ToolStrategy::Individual,
        ToolStrategy::Grouped,
        ToolStrategy::Lazy,
        ToolStrategy::Hybrid,
    ] {
        let server = server_for(strategy);
        let mut client = Stdio::connect_modern(server);
        let response = client
            .request(
                "tools/call",
                json!({
                    "name": "afd-detail",
                    "arguments": { "command": ["hello-greet", "hello-plain"] },
                    "_meta": serde_json::from_str::<Value>(common::META).unwrap(),
                }),
            )
            .await;
        let data = &command_result(&response)["data"];
        assert_eq!(
            data[0]["toolMeta"],
            json!({ "dev.umbel/origin": { "plugin": "hello" }, "ui": view_meta() }),
            "{strategy:?}"
        );
        assert!(data[1].get("toolMeta").is_none(), "{strategy:?}");
    }
}

#[test]
fn registration_refuses_keys_the_server_sets_itself_naming_the_command_and_key() {
    for key in [
        "approval",
        "category",
        "actions",
        "outputSchema",
        "dev.afd/context",
        "ui/resourceUri",
    ] {
        let registry = CommandRegistry::new();
        let error = registry
            .register(
                CommandDefinition::new("hello-greet", "Greet", vec![], Echo)
                    .with_tool_meta(key, json!(1)),
            )
            .unwrap_err();
        assert!(
            error.contains("hello-greet") && error.contains(key),
            "{error}"
        );
        assert!(!registry.has("hello-greet"));
        let error = registry
            .register_with_schema(
                CommandDefinition::new("hello-greet", "Greet", vec![], Echo)
                    .with_tool_meta(key, json!(1)),
                json!({ "type": "object" }),
            )
            .unwrap_err();
        assert!(
            error.contains("hello-greet") && error.contains(key),
            "{error}"
        );
    }
}

// ── Advertised and validation schemas ─────────────────────────────────────────────────────────

/// What the wrapped server advertises: keywords the checker refuses (`oneOf`, `pattern`).
fn advertised() -> Value {
    json!({
        "type": "object",
        "properties": {
            "count": { "oneOf": [{ "type": "integer" }, { "type": "string", "pattern": "^[0-9]+$" }] },
            "name": { "type": "string" },
        },
        "required": ["count"],
    })
}

/// What the registry can check: the subset.
fn validation() -> Value {
    json!({
        "type": "object",
        "properties": { "count": {}, "name": { "type": "string" } },
        "required": ["count"],
        "additionalProperties": false,
    })
}

fn split_registry() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register_with_schemas(
            CommandDefinition::new("wrap-count", "Count", vec![], Echo)
                .with_expose(mcp())
                .with_category("wrap")
                .as_mutation()
                .with_confirm_prompt("Count?"),
            validation(),
            advertised(),
        )
        .unwrap();
    register_bootstrap_commands(&registry).unwrap();
    registry
}

#[test]
fn the_advertised_schema_must_be_an_object_schema_and_nothing_else_is_checked() {
    let registry = CommandRegistry::new();
    for (bad, label) in [
        (json!([]), "array"),
        (json!("object"), "string"),
        (json!({}), "no type"),
        (json!({ "type": "string" }), "other type"),
        (json!({ "type": ["object", "null"] }), "type list"),
    ] {
        let error = registry
            .register_with_schemas(
                CommandDefinition::new("wrap-count", "Count", vec![], Echo),
                validation(),
                bad,
            )
            .unwrap_err();
        assert!(
            error.contains("wrap-count") && error.contains("advertised"),
            "{label}: {error}"
        );
        assert!(!registry.has("wrap-count"), "{label}");
    }
    // The validation schema still follows every existing rule.
    let error = registry
        .register_with_schemas(
            CommandDefinition::new("wrap-count", "Count", vec![], Echo),
            advertised(),
            advertised(),
        )
        .unwrap_err();
    assert!(error.contains("oneOf"), "{error}");
    assert!(!registry.has("wrap-count"));
    // Unsupported keywords are fine in the advertised schema.
    registry
        .register_with_schemas(
            CommandDefinition::new("wrap-count", "Count", vec![], Echo),
            validation(),
            advertised(),
        )
        .unwrap();
    assert_eq!(
        registry.get_tool("wrap-count").unwrap()["inputSchema"],
        advertised()
    );
    // A duplicate is still refused.
    assert!(registry
        .register_with_schemas(
            CommandDefinition::new("wrap-count", "Again", vec![], Echo),
            validation(),
            advertised(),
        )
        .is_err());
}

#[tokio::test]
async fn calls_validate_against_the_validation_schema_not_the_advertised_one() {
    let registry = split_registry();
    let accepted = registry
        .execute("wrap-count", json!({ "count": "12" }), None)
        .await;
    assert!(accepted.success, "{accepted:?}");
    // Valid for the advertised schema's `name`, refused by the validation schema.
    let refused = registry
        .execute("wrap-count", json!({ "count": 1, "extra": true }), None)
        .await;
    assert!(!refused.success);
    assert_eq!(refused.error.unwrap().code, "VALIDATION_ERROR");
    let missing = registry.execute("wrap-count", json!({}), None).await;
    assert!(!missing.success);
}

#[tokio::test]
async fn every_surface_shows_the_advertised_schema() {
    let registry = split_registry();
    for strategy in [ToolStrategy::Individual, ToolStrategy::Grouped] {
        let server =
            McpServer::new(Arc::clone(&registry), "wrap", "1.0.0").with_tool_strategy(strategy);
        let listed = {
            let mut client = Stdio::connect_modern(server);
            let response = client
                .request(
                    "tools/list",
                    json!({ "_meta": serde_json::from_str::<Value>(common::META).unwrap() }),
                )
                .await;
            response["result"]["tools"].as_array().unwrap().clone()
        };
        match strategy {
            ToolStrategy::Individual => {
                assert_eq!(tool(&listed, "wrap-count")["inputSchema"], advertised());
            }
            _ => {
                let group = tool(&listed, "wrap");
                assert_eq!(group["_meta"]["actions"][0]["inputSchema"], advertised());
                assert_eq!(
                    group["inputSchema"]["properties"]["params"]["anyOf"][0]["properties"],
                    advertised()["properties"]
                );
            }
        }
    }
    let detail = registry
        .execute("afd-schema", json!({ "command": "wrap-count" }), None)
        .await
        .data
        .unwrap();
    assert_eq!(detail["schemas"][0]["mcpTool"]["inputSchema"], advertised());
    let docs = registry
        .execute("afd-docs", json!({}), None)
        .await
        .data
        .unwrap()
        .to_string();
    assert!(
        docs.contains("oneOf"),
        "afd-docs shows the advertised schema: {docs}"
    );
    assert!(!docs.contains("additionalProperties"), "{docs}");

    let server = McpServer::new(Arc::clone(&registry), "wrap", "1.0.0");
    let mut client = Stdio::connect_modern(server);
    let response = client
        .request(
            "tools/call",
            json!({
                "name": "afd-detail",
                "arguments": { "command": "wrap-count" },
                "_meta": serde_json::from_str::<Value>(common::META).unwrap(),
            }),
        )
        .await;
    assert_eq!(
        command_result(&response)["data"][0]["inputSchema"],
        advertised()
    );
}

#[tokio::test]
async fn the_confirm_property_is_added_to_the_advertised_schema() {
    let server = McpServer::new(split_registry(), "wrap", "1.0.0")
        .with_tool_strategy(ToolStrategy::Individual)
        .with_confirmations(ConfirmationMode::Enforce);
    let listed = server.tools();
    let schema = &tool(&listed, "wrap-count")["inputSchema"];
    assert!(schema["properties"]["confirm"].is_object(), "{schema}");
    assert!(
        schema["properties"]["count"]["oneOf"].is_array(),
        "{schema}"
    );
}
