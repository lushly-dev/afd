//! The optional command `title` (`spec/command-metadata.md`, "Tool titles"): the MCP tool
//! `title` of the command's own tool only when set, never derived from the name and never in
//! `_meta`; reported by `afd-detail` and by `afd-help` in the `full` format (TypeScript:
//! `tool-title.test.ts`).

mod common;

use std::sync::Arc;

use afd::{
    command_to_mcp_tool, register_bootstrap_commands, success, CommandContext, CommandDefinition,
    CommandHandler, CommandParameter, CommandRegistry, CommandResult, ExposeOptions,
};
use async_trait::async_trait;
use serde_json::{json, Value};

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

fn mcp() -> ExposeOptions {
    ExposeOptions::new().with_mcp(true)
}

/// `todo-create` (titled, mutation), `todo-list` (untitled), `note-add` (titled), and the
/// bootstrap commands.
fn registry() -> Arc<CommandRegistry> {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(
            CommandDefinition::new(
                "todo-create",
                "Create a todo",
                vec![CommandParameter::required_string("title", "Title")],
                Echo,
            )
            .with_title("Create todo")
            .with_category("todo")
            .as_mutation()
            .with_expose(mcp()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("todo-list", "List todos", vec![], Echo)
                .with_category("todo")
                .with_expose(mcp()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("note-add", "Add a note", vec![], Echo)
                .with_title("Add note")
                .with_expose(mcp()),
        )
        .unwrap();
    register_bootstrap_commands(&registry).unwrap();
    registry
}

#[test]
fn a_titled_tool_carries_its_title_and_an_untitled_one_none() {
    let registry = registry();
    let titled = registry.get_tool("todo-create").unwrap();
    assert_eq!(titled["title"], "Create todo");
    assert!(titled.get("annotations").unwrap().get("title").is_none());
    assert!(titled
        .get("_meta")
        .is_none_or(|meta| meta.get("title").is_none()));

    let untitled = registry.get_tool("todo-list").unwrap();
    assert!(untitled.get("title").is_none(), "{untitled}");
}

#[test]
fn the_wire_type_serializes_title_only_when_present() {
    let titled = CommandDefinition::new("note-add", "Add a note", vec![], Echo).with_title("Add");
    let value = serde_json::to_value(command_to_mcp_tool(&titled)).unwrap();
    assert_eq!(value["title"], "Add");
    let untitled = CommandDefinition::new("note-add", "Add a note", vec![], Echo);
    let value = serde_json::to_value(command_to_mcp_tool(&untitled)).unwrap();
    assert!(value.get("title").is_none(), "{value}");
    // A tool without a title still deserializes.
    let tool: afd::McpTool = serde_json::from_value(value).unwrap();
    assert!(tool.title.is_none());
}

fn help_entry<'a>(data: &'a Value, name: &str) -> &'a Value {
    data["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["name"] == name)
        .unwrap()
}

#[tokio::test]
async fn afd_help_reports_title_in_the_full_format_only() {
    let registry = registry();
    let full = registry
        .execute("afd-help", json!({ "format": "full" }), None)
        .await;
    let data = full.data.unwrap();
    assert_eq!(help_entry(&data, "todo-create")["title"], "Create todo");
    assert!(help_entry(&data, "todo-list").get("title").is_none());

    let brief = registry.execute("afd-help", json!({}), None).await;
    let data = brief.data.unwrap();
    assert!(help_entry(&data, "todo-create").get("title").is_none());
}

#[cfg(feature = "server")]
mod server {
    use afd::server::{McpServer, ToolStrategy};
    use serde_json::{json, Value};

    use super::registry;
    use crate::common::{command_result, http_post, modern_post, Stdio};

    fn server(strategy: ToolStrategy) -> McpServer {
        McpServer::new(registry(), "titles", "1.0.0").with_tool_strategy(strategy)
    }

    fn tool<'a>(tools: &'a [Value], name: &str) -> &'a Value {
        tools
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("no tool {name}"))
    }

    async fn modern_tools(server: &McpServer) -> Vec<Value> {
        let response = modern_post(server, "tools/list", json!({}), &[]).await;
        response["result"]["tools"]
            .as_array()
            .unwrap_or_else(|| panic!("no tools: {response}"))
            .clone()
    }

    /// The tools of every lane: 2026-07-28 over HTTP and stdio, 2025 over HTTP and stdio.
    async fn tools_on_every_lane(server: &McpServer) -> Vec<(&'static str, Vec<Value>)> {
        let mut lanes = vec![("http modern", modern_tools(server).await)];
        let mut stdio = Stdio::connect_modern(server.clone());
        let response = stdio
            .request(
                "tools/list",
                json!({ "_meta": serde_json::from_str::<Value>(crate::common::META).unwrap() }),
            )
            .await;
        lanes.push((
            "stdio modern",
            response["result"]["tools"].as_array().unwrap().clone(),
        ));
        let (_, response) = http_post(
            server,
            json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }),
            &[("mcp-protocol-version", "2025-11-25")],
        )
        .await;
        lanes.push((
            "http 2025",
            response["result"]["tools"].as_array().unwrap().clone(),
        ));
        let mut stdio = Stdio::connect(server.clone()).await;
        let response = stdio.request("tools/list", json!({})).await;
        lanes.push((
            "stdio 2025",
            response["result"]["tools"].as_array().unwrap().clone(),
        ));
        lanes
    }

    #[tokio::test]
    async fn individual_tools_list_titles_on_every_era_and_transport() {
        let server = server(ToolStrategy::Individual);
        for (lane, tools) in tools_on_every_lane(&server).await {
            assert_eq!(
                tool(&tools, "todo-create")["title"],
                "Create todo",
                "{lane}"
            );
            assert_eq!(tool(&tools, "note-add")["title"], "Add note", "{lane}");
            let untitled = tool(&tools, "todo-list");
            assert!(untitled.get("title").is_none(), "{lane}: {untitled}");
            assert!(
                tool(&tools, "todo-create")["annotations"]
                    .get("title")
                    .is_none(),
                "{lane}"
            );
        }
    }

    #[tokio::test]
    async fn meta_tools_carry_the_shared_titles() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/meta-tools.json");
        let shared: Vec<Value> =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for strategy in [
            ToolStrategy::Individual,
            ToolStrategy::Grouped,
            ToolStrategy::Lazy,
        ] {
            let tools = modern_tools(&server(strategy)).await;
            for definition in &shared {
                let name = definition["name"].as_str().unwrap();
                if let Some(listed) = tools.iter().find(|tool| tool["name"] == name) {
                    assert_eq!(listed["title"], definition["title"], "{strategy:?} {name}");
                }
            }
        }
        let hybrid = McpServer::new(registry(), "titles", "1.0.0")
            .with_tool_strategy(ToolStrategy::Hybrid)
            .with_first_class_tools(["todo-create"]);
        let tools = modern_tools(&hybrid).await;
        for definition in &shared {
            let name = definition["name"].as_str().unwrap();
            assert_eq!(tool(&tools, name)["title"], definition["title"], "{name}");
        }
    }

    #[tokio::test]
    async fn a_first_class_tool_carries_its_title_under_hybrid() {
        let hybrid = McpServer::new(registry(), "titles", "1.0.0")
            .with_tool_strategy(ToolStrategy::Hybrid)
            .with_first_class_tools(["todo-create", "todo-list"]);
        for (lane, tools) in tools_on_every_lane(&hybrid).await {
            assert_eq!(
                tool(&tools, "todo-create")["title"],
                "Create todo",
                "{lane}"
            );
            assert!(tool(&tools, "todo-list").get("title").is_none(), "{lane}");
        }
    }

    #[tokio::test]
    async fn grouped_tools_have_no_title_and_no_title_in_actions() {
        let tools = modern_tools(&server(ToolStrategy::Grouped)).await;
        let todo = tool(&tools, "todo");
        assert!(todo.get("title").is_none(), "{todo}");
        for action in todo["_meta"]["actions"].as_array().unwrap() {
            assert!(action.get("title").is_none(), "{action}");
        }
        assert!(todo["_meta"].get("title").is_none());
    }

    #[tokio::test]
    async fn afd_detail_reports_title_when_set() {
        let server = server(ToolStrategy::Lazy);
        let response = modern_post(
            &server,
            "tools/call",
            json!({
                "name": "afd-detail",
                "arguments": { "command": ["todo-create", "todo-list"] },
            }),
            &[],
        )
        .await;
        let data = command_result(&response)["data"].clone();
        assert_eq!(data[0]["name"], "todo-create");
        assert_eq!(data[0]["title"], "Create todo");
        assert_eq!(data[1]["name"], "todo-list");
        assert!(data[1].get("title").is_none(), "{}", data[1]);
    }
}
