//! Tool strategies, the meta-tools and their checks on the `server` feature, over Streamable
//! HTTP with MCP 2026-07-28 requests (TypeScript: `tool-surface.test.ts`, `grouped-tools.test.ts`,
//! `lazy-tools.test.ts`, `meta-tools.test.ts`).
#![cfg(feature = "server")]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use afd::server::{ConfirmationMode, HttpOptions, McpServer, ToolStrategy};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandParameter, CommandRegistry,
    CommandResult, ExposeOptions,
};
use async_trait::async_trait;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

struct Echo(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!({ "input": input, "trace": context.trace_id }))
    }
}

fn mcp() -> ExposeOptions {
    ExposeOptions::new().with_mcp(true)
}

/// `todo-create`, `todo-list`, `todo-clear` (confirm-gated), `note-add`, and a private
/// `secret-rotate`; the count of handler runs.
fn registry() -> (Arc<CommandRegistry>, Arc<AtomicUsize>) {
    let runs = Arc::new(AtomicUsize::new(0));
    let registry = CommandRegistry::new();
    let echo = || Echo(Arc::clone(&runs));
    registry
        .register(
            CommandDefinition::new(
                "todo-create",
                "Create a todo. Adds it to the list.",
                vec![CommandParameter::required_string("title", "Title")],
                echo(),
            )
            .with_category("todo")
            .with_tags(vec!["write".into()])
            .as_mutation()
            .with_expose(mcp()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("todo-list", "List todos", vec![], echo())
                .with_category("todo")
                .with_tags(vec!["read".into()])
                .with_expose(mcp()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("todo-clear", "Delete todos", vec![], echo())
                .with_category("todo")
                .as_mutation()
                .with_destructive(true)
                .with_confirm_prompt("Delete every todo?")
                .with_expose(mcp()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("note-add", "Add a note", vec![], echo()).with_expose(mcp()),
        )
        .unwrap();
    registry
        .register(CommandDefinition::new(
            "secret-rotate",
            "Private",
            vec![],
            echo(),
        ))
        .unwrap();
    (Arc::new(registry), runs)
}

fn serve(strategy: ToolStrategy) -> (McpServer, Arc<AtomicUsize>) {
    let (registry, runs) = registry();
    (
        McpServer::new(registry, "strategies", "1.0.0").with_tool_strategy(strategy),
        runs,
    )
}

async fn rpc(server: &McpServer, method: &str, params: Value, meta: Value) -> Value {
    let mut params = params;
    let mut full_meta = json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
    });
    if let Value::Object(extra) = meta {
        for (key, value) in extra {
            full_meta[key] = value;
        }
    }
    params["_meta"] = full_meta;
    let name = params["name"].as_str().map(str::to_owned);
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let service = server.streamable_http_service(HttpOptions::default());
    let mut request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", method);
    if let Some(name) = &name {
        request = request.header("mcp-name", name.as_str());
    }
    let request = request
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

/// A tool call's parsed result and `isError`.
async fn call(server: &McpServer, name: &str, arguments: Value) -> (Value, bool) {
    let response = rpc(
        server,
        "tools/call",
        json!({ "name": name, "arguments": arguments }),
        json!({}),
    )
    .await;
    let result = &response["result"];
    let text = result["content"][0]["text"]
        .as_str()
        .unwrap_or_else(|| panic!("no tool result: {response}"));
    (
        serde_json::from_str(text).unwrap(),
        result["isError"] == true,
    )
}

fn names(tools: &[Value]) -> Vec<&str> {
    tools
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect()
}

#[test]
fn meta_tools_match_the_shared_definitions() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spec/meta-tools.json");
    let shared: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let ours = json!([
        afd::server::meta_tools::call_tool(),
        afd::server::meta_tools::batch_tool(),
        afd::server::meta_tools::pipe_tool(),
        afd::server::meta_tools::discover_tool(),
        afd::server::meta_tools::detail_tool(),
    ]);
    assert_eq!(ours, shared);
    let listed: Vec<&str> = ours
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    let mut expected = afd::AFD_META_TOOL_NAMES.to_vec();
    expected.sort_unstable();
    let mut listed_sorted = listed.clone();
    listed_sorted.sort_unstable();
    assert_eq!(listed_sorted, expected);
}

#[test]
fn each_strategy_lists_its_tools() {
    let (individual, _) = serve(ToolStrategy::Individual);
    assert_eq!(
        names(&individual.tools()),
        [
            "afd-batch",
            "afd-pipe",
            "afd-call",
            "todo-create",
            "todo-list",
            "todo-clear",
            "note-add"
        ]
    );
    let (grouped, _) = serve(ToolStrategy::Grouped);
    assert_eq!(
        names(&grouped.tools()),
        [
            "afd-batch",
            "afd-pipe",
            "afd-call",
            "afd-detail",
            "todo",
            "note"
        ]
    );
    let (lazy, _) = serve(ToolStrategy::Lazy);
    assert_eq!(
        names(&lazy.tools()),
        [
            "afd-discover",
            "afd-detail",
            "afd-batch",
            "afd-pipe",
            "afd-call"
        ]
    );
    // Grouped is the default, as in TypeScript.
    let (registry, _) = registry();
    assert_eq!(
        names(&McpServer::new(registry, "default", "1").tools()),
        names(&grouped.tools())
    );
}

#[test]
fn grouped_tools_carry_actions_schemas_and_metadata() {
    let (server, _) = serve(ToolStrategy::Grouped);
    let tools = server.tools();
    let todo = tools.iter().find(|tool| tool["name"] == "todo").unwrap();
    assert_eq!(todo["description"], "todo operations: create, list, clear");
    let schema = &todo["inputSchema"];
    assert_eq!(schema["required"], json!(["action"]));
    assert_eq!(
        schema["properties"]["action"],
        json!({
            "type": "string",
            "enum": ["create", "list", "clear"],
            "description": "Action to perform: create | list | clear",
        })
    );
    // Small groups inline each action's schema as an `anyOf` branch of `params`.
    let branches = schema["properties"]["params"]["anyOf"].as_array().unwrap();
    assert_eq!(branches.len(), 3);
    assert_eq!(branches[0]["title"], "create");
    assert_eq!(
        branches[0]["description"],
        "Parameters for action 'create' (todo-create)"
    );
    assert_eq!(branches[0]["required"], json!(["title"]));
    // No `confirm` unless confirmations are enforced.
    assert!(schema["properties"]["confirm"].is_null());

    let actions = todo["_meta"]["actions"].as_array().unwrap();
    assert_eq!(
        actions[0],
        json!({
            "action": "create",
            "command": "todo-create",
            "description": "Create a todo. Adds it to the list.",
            "inputSchema": branches[0].as_object().map(|branch| {
                let mut schema = branch.clone();
                schema.remove("title");
                schema.remove("description");
                Value::Object(schema)
            }).unwrap(),
            "category": "todo",
            "mutation": true,
        })
    );
    assert_eq!(actions[2]["destructive"], true);
    assert!(todo.get("annotations").is_none());

    let (enforcing, _) = serve(ToolStrategy::Grouped);
    let enforcing = enforcing.with_confirmations(ConfirmationMode::Enforce);
    let tools = enforcing.tools();
    let todo = tools.iter().find(|tool| tool["name"] == "todo").unwrap();
    assert_eq!(
        todo["inputSchema"]["properties"]["confirm"]["type"],
        "boolean"
    );
    let note = tools.iter().find(|tool| tool["name"] == "note").unwrap();
    assert!(note["inputSchema"]["properties"]["confirm"].is_null());
}

#[test]
fn large_groups_keep_their_schemas_in_meta_only() {
    let registry = CommandRegistry::new();
    let runs = Arc::new(AtomicUsize::new(0));
    let long = "x".repeat(9_000);
    registry
        .register(
            CommandDefinition::new(
                "big-run",
                "Run",
                vec![CommandParameter::required_string("value", &long)],
                Echo(runs),
            )
            .with_expose(mcp()),
        )
        .unwrap();
    let server = McpServer::new(Arc::new(registry), "big", "1");
    let tools = server.tools();
    let big = tools.iter().find(|tool| tool["name"] == "big").unwrap();
    let params = &big["inputSchema"]["properties"]["params"];
    assert!(params.get("anyOf").is_none());
    assert_eq!(
        params["description"],
        "Parameters for the action: see _meta.actions[].inputSchema, or call afd-detail with the action's command name"
    );
    assert!(big["_meta"]["actions"][0]["inputSchema"]["properties"]["value"].is_object());
}

#[tokio::test]
async fn group_by_names_the_grouped_tools() {
    let (registry, _) = registry();
    let server = McpServer::new(registry, "groups", "1").with_group_by(|command| {
        command
            .mutation
            .then(|| "writes".to_owned())
            .or_else(|| (command.name == "note-add").then(String::new))
    });
    assert_eq!(
        names(&server.tools()),
        [
            "afd-batch",
            "afd-pipe",
            "afd-call",
            "afd-detail",
            "writes",
            "general"
        ]
    );
    // `todo-create` and `todo-clear` are `create` and `clear` in `writes`.
    let (created, failed) = call(
        &server,
        "writes",
        json!({ "action": "create", "params": { "title": "a" } }),
    )
    .await;
    assert!(!failed, "{created}");
    assert_eq!(created["data"]["input"], json!({ "title": "a" }));
}

#[tokio::test]
async fn grouped_calls_route_actions_and_explain_bad_ones() {
    let (server, runs) = serve(ToolStrategy::Grouped);
    let (created, failed) = call(
        &server,
        "todo",
        json!({ "action": "create", "params": { "title": "a" } }),
    )
    .await;
    assert!(!failed);
    assert_eq!(created["data"]["input"], json!({ "title": "a" }));
    assert_eq!(runs.load(Ordering::SeqCst), 1);

    let (missing, failed) = call(&server, "todo", json!({})).await;
    assert!(failed);
    assert_eq!(missing["error"]["code"], "INVALID_GROUPED_CALL");
    assert_eq!(
        missing["error"]["suggestion"],
        "Provide { action: \"<action>\", params: {...} }. Available actions: create, list, clear"
    );

    let (unknown, _) = call(&server, "todo", json!({ "action": "rename" })).await;
    assert_eq!(unknown["error"]["code"], "COMMAND_NOT_FOUND");
    assert_eq!(
        unknown["error"]["message"],
        "Action 'rename' does not identify one command in group 'todo'"
    );

    // Invalid params are the command's own VALIDATION_ERROR.
    let (invalid, _) = call(&server, "todo", json!({ "action": "create", "params": {} })).await;
    assert_eq!(invalid["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn an_action_two_commands_share_is_ambiguous() {
    let registry = CommandRegistry::new();
    let runs = Arc::new(AtomicUsize::new(0));
    for name in ["note-add", "memo-add"] {
        registry
            .register(
                CommandDefinition::new(name, "Add", vec![], Echo(Arc::clone(&runs)))
                    .with_expose(mcp()),
            )
            .unwrap();
    }
    let server =
        McpServer::new(Arc::new(registry), "groups", "1").with_group_by(|_| Some("all".into()));
    let (ambiguous, failed) = call(&server, "all", json!({ "action": "add" })).await;
    assert!(failed);
    assert_eq!(ambiguous["error"]["code"], "AMBIGUOUS_ACTION");
    assert_eq!(
        ambiguous["error"]["suggestion"],
        "Use afd-call with the full command name, or list tools to find a valid action."
    );
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn every_strategy_routes_commands_and_meta_tools_by_name() {
    for strategy in [
        ToolStrategy::Individual,
        ToolStrategy::Grouped,
        ToolStrategy::Lazy,
    ] {
        let (server, _) = serve(strategy);
        let (direct, failed) = call(&server, "todo-list", json!({})).await;
        assert!(!failed, "{strategy:?}: {direct}");
        let (called, failed) = call(
            &server,
            "afd-call",
            json!({ "command": "todo-create", "input": { "title": "b" } }),
        )
        .await;
        assert!(!failed, "{strategy:?}: {called}");
        assert!(called["data"]["trace"]
            .as_str()
            .unwrap()
            .starts_with("afd-call-"));
        let (found, _) = call(&server, "afd-discover", json!({})).await;
        assert_eq!(found["data"]["total"], 4, "{strategy:?}");
        let (detailed, _) = call(&server, "afd-detail", json!({ "command": "todo-clear" })).await;
        assert_eq!(detailed["data"][0]["found"], true, "{strategy:?}");
    }
}

#[tokio::test]
async fn private_commands_look_unknown_on_every_route() {
    let (server, runs) = serve(ToolStrategy::Lazy);
    let (direct, _) = call(&server, "secret-rotate", json!({})).await;
    let (called, _) = call(&server, "afd-call", json!({ "command": "secret-rotate" })).await;
    let (unknown, _) = call(&server, "afd-call", json!({ "command": "secret-rotat" })).await;
    for result in [&direct, &called] {
        assert_eq!(result["error"]["code"], "COMMAND_NOT_FOUND", "{result}");
        assert_eq!(
            result["error"]["message"],
            "Command 'secret-rotate' not found"
        );
        assert_eq!(
            result["error"]["suggestion"],
            "Use afd-discover to list all commands."
        );
    }
    // Close matches never name a private command.
    assert!(!unknown["error"]["suggestion"]
        .as_str()
        .unwrap()
        .contains("secret-rotate"));

    let (batch, _) = call(
        &server,
        "afd-batch",
        json!({ "commands": [{ "command": "secret-rotate" }, { "command": "todo-list" }] }),
    )
    .await;
    assert_eq!(
        batch["results"][0]["result"]["error"]["code"],
        "COMMAND_NOT_FOUND"
    );
    assert_eq!(batch["results"][1]["result"]["success"], true);

    let (pipe, failed) = call(
        &server,
        "afd-pipe",
        json!({ "steps": [{ "command": "secret-rotate" }] }),
    )
    .await;
    assert!(failed);
    assert_eq!(pipe["steps"][0]["error"]["code"], "COMMAND_NOT_FOUND");

    let (discovered, _) = call(&server, "afd-discover", json!({ "search": "secret" })).await;
    assert_eq!(discovered["data"]["returned"], 0);
    let (detailed, _) = call(&server, "afd-detail", json!({ "command": "secret-rotate" })).await;
    assert_eq!(detailed["data"][0]["found"], false);
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn discover_filters_paginates_and_summarizes() {
    let (server, _) = serve(ToolStrategy::Lazy);
    let (all, _) = call(&server, "afd-discover", json!({ "limit": 2 })).await;
    let data = &all["data"];
    assert_eq!(data["total"], 4);
    assert_eq!(data["filtered"], 4);
    assert_eq!(data["returned"], 2);
    assert_eq!(data["hasMore"], true);
    assert_eq!(data["availableCategories"], json!(["note", "todo"]));
    assert_eq!(data["availableTags"], json!(["read", "write"]));
    assert_eq!(
        data["commands"][0],
        json!({ "name": "todo-create", "description": "Create a todo", "category": "todo" })
    );
    assert_eq!(
        all["reasoning"],
        "Returned 2 of 4 matching commands (4 total). Use offset: 2 to see more."
    );
    assert_eq!(all["confidence"], 1.0);

    let (tagged, _) = call(
        &server,
        "afd-discover",
        json!({ "tag": ["read", "write"], "tagMode": "all", "includeMutation": true }),
    )
    .await;
    assert_eq!(tagged["data"]["returned"], 0);
    let (any, _) = call(
        &server,
        "afd-discover",
        json!({ "tag": "write", "category": "todo", "includeMutation": true, "offset": null }),
    )
    .await;
    assert_eq!(
        any["data"]["commands"],
        json!([{ "name": "todo-create", "description": "Create a todo", "category": "todo", "mutation": true }])
    );
    assert_eq!(
        any["reasoning"],
        "Returned 1 of 1 matching commands (4 total) in category 'todo'"
    );
    let (searched, _) = call(&server, "afd-discover", json!({ "search": "DELETE todos" })).await;
    assert_eq!(searched["data"]["commands"][0]["name"], "todo-clear");
}

#[tokio::test]
async fn detail_reports_every_field_and_bounds_unknown_names() {
    let (server, _) = serve(ToolStrategy::Lazy);
    let long = "z".repeat(300);
    let (detailed, failed) = call(
        &server,
        "afd-detail",
        json!({ "command": ["todo-clear", "todo-crate", long] }),
    )
    .await;
    assert!(!failed);
    let entries = detailed["data"].as_array().unwrap();
    assert_eq!(
        entries[0],
        json!({
            "name": "todo-clear",
            "found": true,
            "description": "Delete todos",
            "category": "todo",
            "mutation": true,
            "inputSchema": { "type": "object", "properties": {}, "required": [] },
            "destructive": true,
            "confirmPrompt": "Delete every todo?",
            "callable": true,
        })
    );
    assert_eq!(entries[1]["error"]["code"], "COMMAND_NOT_FOUND");
    assert_eq!(
        entries[1]["error"]["suggestion"],
        "Did you mean 'todo-create'? Other close matches: 'todo-list', 'todo-clear'. Use afd-discover to list all commands."
    );
    assert!(entries[2]["name"].as_str().unwrap().ends_with('…'));
    assert_eq!(detailed["reasoning"], "Resolved 1 of 3 requested commands");
}

#[tokio::test]
async fn invalid_meta_tool_arguments_return_structured_failures() {
    let (server, runs) = serve(ToolStrategy::Lazy);
    let (missing, failed) = call(&server, "afd-call", json!({})).await;
    assert!(failed);
    assert_eq!(missing["error"]["code"], "VALIDATION_ERROR");
    assert_eq!(missing["error"]["message"], "Invalid afd-call arguments");
    assert!(missing["error"]["suggestion"]
        .as_str()
        .unwrap()
        .ends_with(". Provide { command: \"command-name\", input: {...} }"));
    assert!(missing["error"]["details"]["errors"].is_array());

    // A top-level null counts as omitted.
    let (nulls, failed) = call(
        &server,
        "afd-call",
        json!({ "command": "todo-list", "input": null, "confirm": null }),
    )
    .await;
    assert!(!failed, "{nulls}");

    for (tool, args) in [
        ("afd-discover", json!({ "tagMode": "some" })),
        ("afd-discover", json!({ "limit": "ten" })),
        ("afd-detail", json!({})),
        ("afd-detail", json!({ "command": 42 })),
    ] {
        let (result, failed) = call(&server, tool, args).await;
        assert!(failed);
        assert_eq!(result["error"]["code"], "VALIDATION_ERROR", "{tool}");
        assert_eq!(
            result["error"]["message"],
            format!("Invalid {tool} arguments")
        );
    }

    let (batch, failed) = call(&server, "afd-batch", json!({ "commands": "todo-list" })).await;
    assert!(failed);
    assert_eq!(batch["success"], false);
    assert_eq!(batch["error"]["code"], "INVALID_BATCH_REQUEST");
    assert!(batch["error"]["suggestion"]
        .as_str()
        .unwrap()
        .ends_with(". Provide { commands: [...] } with command objects"));
    let (empty, _) = call(&server, "afd-batch", json!({ "commands": [] })).await;
    assert_eq!(empty["error"]["code"], "INVALID_BATCH_REQUEST");

    let (pipe, failed) = call(&server, "afd-pipe", json!({ "steps": [{ "command": "" }] })).await;
    assert!(failed);
    assert_eq!(pipe["steps"][0]["index"], -1);
    assert_eq!(
        pipe["steps"][0]["error"]["code"],
        "INVALID_PIPELINE_REQUEST"
    );
    assert!(pipe["steps"][0]["error"]["details"]["errors"].is_array());
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn batches_and_pipelines_run_through_the_registry() {
    let (server, runs) = serve(ToolStrategy::Grouped);
    let (batch, failed) = call(
        &server,
        "afd-batch",
        json!({ "commands": [
            { "id": "a", "command": "todo-create", "input": { "title": "a" } },
            { "command": "todo-list" },
        ] }),
    )
    .await;
    assert!(!failed, "{batch}");
    assert_eq!(batch["summary"]["successCount"], 2);
    assert!(batch["results"][0]["result"]["data"]["trace"]
        .as_str()
        .unwrap()
        .starts_with("batch-"));

    let (pipe, failed) = call(
        &server,
        "afd-pipe",
        json!({ "steps": [
            { "command": "todo-create", "input": { "title": "p" }, "as": "made" },
            { "command": "todo-create", "input": { "title": "$prev.input.title" } },
        ] }),
    )
    .await;
    assert!(!failed, "{pipe}");
    assert_eq!(pipe["steps"][1]["data"]["input"], json!({ "title": "p" }));
    assert!(pipe["steps"][1]["data"]["trace"]
        .as_str()
        .unwrap()
        .contains("-step-1"));

    // A streaming step is UNSUPPORTED_OPTION before any step runs, as in TypeScript.
    let before = runs.load(Ordering::SeqCst);
    let (streamed, failed) = call(
        &server,
        "afd-pipe",
        json!({ "steps": [{ "command": "todo-list" }, { "command": "todo-list", "stream": true }] }),
    )
    .await;
    assert!(failed);
    assert_eq!(streamed["steps"][1]["error"]["code"], "UNSUPPORTED_OPTION");
    assert_eq!(runs.load(Ordering::SeqCst), before);
}

#[tokio::test]
async fn confirmations_gate_every_route_before_any_command_runs() {
    let (server, runs) = serve(ToolStrategy::Grouped);
    let server = server.with_confirmations(ConfirmationMode::Enforce);
    let required = |result: &Value| result["error"]["code"] == "CONFIRMATION_REQUIRED";

    let (called, failed) = call(&server, "afd-call", json!({ "command": "todo-clear" })).await;
    assert!(failed && required(&called), "{called}");
    assert_eq!(
        called["error"]["suggestion"],
        "Make sure the user intends this, then repeat the afd-call with confirm: true."
    );
    let (grouped, _) = call(&server, "todo", json!({ "action": "clear" })).await;
    assert!(required(&grouped));
    assert_eq!(
        grouped["error"]["suggestion"],
        "Make sure the user intends this, then repeat the todo call with confirm: true."
    );
    let (batch, failed) = call(
        &server,
        "afd-batch",
        json!({ "commands": [{ "command": "todo-list" }, { "command": "todo-clear" }] }),
    )
    .await;
    assert!(failed);
    assert_eq!(batch["error"]["code"], "CONFIRMATION_REQUIRED");
    assert_eq!(batch["error"]["details"]["commands"], json!(["todo-clear"]));
    let (pipe, _) = call(
        &server,
        "afd-pipe",
        json!({ "steps": [{ "command": "todo-list" }, { "command": "todo-clear" }] }),
    )
    .await;
    assert_eq!(pipe["steps"][0]["index"], -1);
    assert_eq!(pipe["steps"][0]["error"]["code"], "CONFIRMATION_REQUIRED");
    // Nothing ran, not even the batch's first, ungated command.
    assert_eq!(runs.load(Ordering::SeqCst), 0);

    let (called, failed) = call(
        &server,
        "afd-call",
        json!({ "command": "todo-clear", "confirm": true }),
    )
    .await;
    assert!(!failed, "{called}");
    let (grouped, failed) = call(
        &server,
        "todo",
        json!({ "action": "clear", "confirm": true }),
    )
    .await;
    assert!(!failed, "{grouped}");
    let (batch, failed) = call(
        &server,
        "afd-batch",
        json!({ "commands": [{ "command": "todo-clear" }], "confirm": ["todo-clear"] }),
    )
    .await;
    assert!(!failed, "{batch}");
    let (pipe, failed) = call(
        &server,
        "afd-pipe",
        json!({ "steps": [{ "command": "todo-clear" }], "confirm": ["todo-clear"] }),
    )
    .await;
    assert!(!failed, "{pipe}");
    assert_eq!(runs.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn a_batch_elicits_one_confirmation_for_all_its_gated_commands() {
    let (server, runs) = serve(ToolStrategy::Lazy);
    let server = server.with_confirmations(ConfirmationMode::RequireHuman);
    let arguments = json!({ "commands": [
        { "command": "todo-clear" },
        { "command": "todo-clear", "input": { "again": true } },
    ] });
    let response = rpc(
        &server,
        "tools/call",
        json!({ "name": "afd-batch", "arguments": arguments }),
        json!({ "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } } }),
    )
    .await;
    let result = &response["result"];
    assert_eq!(result["resultType"], "input_required", "{response}");
    let request = &result["inputRequests"]["confirm"];
    assert_eq!(
        request["params"]["message"],
        "This request runs commands that need confirmation:\n- todo-clear: Delete every todo?\n- todo-clear: Delete every todo?"
    );

    let retry = rpc(
        &server,
        "tools/call",
        json!({
            "name": "afd-batch",
            "arguments": arguments,
            "inputResponses": { "confirm": { "action": "accept", "content": { "confirm": true } } },
            "requestState": result["requestState"],
        }),
        json!({ "io.modelcontextprotocol/clientCapabilities": { "elicitation": { "form": {} } } }),
    )
    .await;
    assert_eq!(retry["result"]["isError"], false, "{retry}");
    assert_eq!(runs.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn instructions_describe_the_strategy() {
    let (lazy, _) = serve(ToolStrategy::Lazy);
    let response = rpc(&lazy, "server/discover", json!({}), json!({})).await;
    let instructions = response["result"]["instructions"].as_str().unwrap();
    assert!(
        instructions.contains("Call afd-discover to find commands"),
        "{instructions}"
    );
    assert!(instructions.contains("Use afd-batch for several independent commands"));
    assert!(!instructions.contains("afd-context-list"));
}
