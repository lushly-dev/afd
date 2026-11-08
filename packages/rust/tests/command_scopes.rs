//! A command's `scopes` (`spec/command-metadata.md`, "Scopes"): checked at registration and
//! reported in `_meta` (command tools and grouped actions) and by `afd-detail`. Metadata only:
//! without authorization nothing is enforced.
#![cfg(feature = "server")]

mod common;

use std::sync::Arc;

use afd::server::{McpServer, ToolStrategy};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use common::{command_result, modern_post};
use serde_json::{json, Value};

struct Runs;

#[async_trait]
impl CommandHandler for Runs {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "ran": true }))
    }
}

fn registry() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    let mut scoped = CommandDefinition::new("todo-create", "Create", vec![], Runs)
        .with_scopes(["todo:write", "todo:admin"]);
    scoped.expose.mcp = true;
    registry.register(scoped).unwrap();
    let mut empty =
        CommandDefinition::new("todo-list", "List", vec![], Runs).with_scopes(Vec::<String>::new());
    empty.expose.mcp = true;
    registry.register(empty).unwrap();
    registry
}

#[test]
fn registration_refuses_a_scope_that_is_not_a_scope_token() {
    let registry = CommandRegistry::new();
    for bad in ["", "todo write", "todo:\"x\"", "todo\\x", "todo:é"] {
        let error = registry
            .register(CommandDefinition::new("todo-bad", "Bad", vec![], Runs).with_scopes([bad]))
            .unwrap_err();
        assert!(
            error.contains("todo-bad") && error.contains("scope"),
            "{error}"
        );
    }
    let schema = json!({ "type": "object" });
    assert!(registry
        .register_with_schema(
            CommandDefinition::new("todo-bad", "Bad", vec![], Runs).with_scopes(["a b"]),
            schema
        )
        .is_err());
}

#[test]
fn command_tools_carry_scopes_in_meta() {
    let registry = registry();
    let tool = registry.get_tool("todo-create").unwrap();
    assert_eq!(tool["_meta"]["scopes"], json!(["todo:write", "todo:admin"]));
    // `_meta` omits an empty array.
    let tool = registry.get_tool("todo-list").unwrap();
    assert!(tool["_meta"].get("scopes").is_none(), "{tool}");
}

#[tokio::test]
async fn grouped_actions_and_afd_detail_report_scopes_and_nothing_is_enforced() {
    let server =
        McpServer::new(registry(), "todo", "1.0.0").with_tool_strategy(ToolStrategy::Grouped);
    let listed = modern_post(&server, "tools/list", json!({}), &[]).await;
    let todo = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "todo")
        .cloned()
        .unwrap();
    let actions = todo["_meta"]["actions"].as_array().unwrap();
    assert_eq!(actions[0]["scopes"], json!(["todo:write", "todo:admin"]));
    assert!(actions[1].get("scopes").is_none());
    let detail = modern_post(
        &server,
        "tools/call",
        json!({ "name": "afd-detail", "arguments": { "command": ["todo-create", "todo-list"] } }),
        &[],
    )
    .await;
    let detail = command_result(&detail);
    assert_eq!(
        detail["data"][0]["scopes"],
        json!(["todo:write", "todo:admin"])
    );
    assert_eq!(detail["data"][1]["scopes"], json!([]));
    // Without authorization, scopes are metadata only.
    let ran = modern_post(
        &server,
        "tools/call",
        json!({ "name": "afd-call", "arguments": { "command": "todo-create" } }),
        &[],
    )
    .await;
    assert_eq!(command_result(&ran)["data"]["ran"], true);
    let individual =
        McpServer::new(registry(), "todo", "1.0.0").with_tool_strategy(ToolStrategy::Individual);
    let listed = modern_post(&individual, "tools/list", json!({}), &[]).await;
    assert_eq!(listed["result"]["cacheScope"], "public");
    let tool = listed["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "todo-create")
        .cloned()
        .unwrap();
    assert_eq!(tool["_meta"]["scopes"], json!(["todo:write", "todo:admin"]));
}
