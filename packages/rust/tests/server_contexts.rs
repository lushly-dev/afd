//! Contexts on the `server` feature in both MCP eras (TypeScript: `mcp-modern.test.ts`,
//! `session-contexts.test.ts`, `context.integration.test.ts`): request `_meta` on MCP
//! 2026-07-28, a stack per 2025 stdio connection, and no session on stateless 2025 HTTP.
#![cfg(feature = "server")]

use std::sync::Arc;

use afd::server::{HttpOptions, McpServer, ToolStrategy};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
    ContextConfig, ExposeOptions,
};
use async_trait::async_trait;
use http_body_util::{BodyExt, Full};
use rmcp::ServiceExt as _;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tower::ServiceExt;

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, _input: Value, context: CommandContext) -> CommandResult<Value> {
        success(json!({ "activeContext": context.active_context() }))
    }
}

fn server() -> McpServer {
    let registry = CommandRegistry::new();
    let mcp = ExposeOptions::new().with_mcp(true);
    registry
        .register(
            CommandDefinition::new("plan-create", "Create a plan", vec![], Echo)
                .with_contexts(["planning"])
                .with_expose(mcp.clone()),
        )
        .unwrap();
    registry
        .register(
            CommandDefinition::new("review-approve", "Approve", vec![], Echo)
                .with_contexts(["review"])
                .with_expose(mcp.clone()),
        )
        .unwrap();
    registry
        .register(CommandDefinition::new("note-add", "Add a note", vec![], Echo).with_expose(mcp))
        .unwrap();
    McpServer::new(Arc::new(registry), "contexts", "1.0.0")
        .with_tool_strategy(ToolStrategy::Individual)
        .with_contexts(vec![
            ContextConfig::new("planning"),
            ContextConfig::new("review"),
        ])
        .unwrap()
}

async fn post(server: &McpServer, body: Value, headers: &[(&str, &str)]) -> Value {
    let service = server.streamable_http_service(HttpOptions::default());
    let mut request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream");
    for (name, value) in headers {
        request = request.header(*name, *value);
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

/// A 2026-07-28 request, in `context` when it is set.
async fn modern(server: &McpServer, method: &str, params: Value, context: Option<&str>) -> Value {
    let mut params = params;
    params["_meta"] = json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
    });
    if let Some(context) = context {
        params["_meta"]["dev.afd/context"] = json!(context);
    }
    let name = params["name"].as_str().map(str::to_owned);
    let mut headers = vec![
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = &name {
        headers.push(("mcp-name", name.as_str()));
    }
    post(
        server,
        json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }),
        &headers,
    )
    .await
}

fn tool_result(response: &Value) -> Value {
    serde_json::from_str(
        response["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_else(|| panic!("no tool result: {response}")),
    )
    .unwrap()
}

fn names(response: &Value) -> Vec<String> {
    response["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn a_request_context_scopes_tools_list_and_calls() {
    let server = server();
    let all = modern(&server, "tools/list", json!({}), None).await;
    assert!(names(&all).contains(&"plan-create".to_owned()));
    assert!(names(&all).contains(&"afd-context-enter".to_owned()));
    // tools/list varies by context, so it is never fresh by default.
    assert_eq!(all["result"]["ttlMs"], 0);

    let planning = modern(&server, "tools/list", json!({}), Some("planning")).await;
    let listed = names(&planning);
    assert!(listed.contains(&"plan-create".to_owned()));
    assert!(listed.contains(&"note-add".to_owned()));
    assert!(!listed.contains(&"review-approve".to_owned()));

    let call = |name: &str| json!({ "name": name, "arguments": {} });
    let ran =
        tool_result(&modern(&server, "tools/call", call("plan-create"), Some("planning")).await);
    assert_eq!(ran["data"]["activeContext"], "planning");
    let denied = tool_result(
        &modern(
            &server,
            "tools/call",
            call("review-approve"),
            Some("planning"),
        )
        .await,
    );
    assert_eq!(denied["error"]["code"], "COMMAND_NOT_IN_CONTEXT");
    assert_eq!(
        denied["error"]["suggestion"],
        "Use afd-context-list to see available contexts, or afd-context-enter to switch."
    );
    let through_call = tool_result(
        &modern(
            &server,
            "tools/call",
            json!({ "name": "afd-call", "arguments": { "command": "review-approve" } }),
            Some("planning"),
        )
        .await,
    );
    assert_eq!(through_call["error"]["code"], "COMMAND_NOT_IN_CONTEXT");
    let batch = tool_result(
        &modern(
            &server,
            "tools/call",
            json!({ "name": "afd-batch", "arguments": { "commands": [
                { "command": "note-add" }, { "command": "review-approve" },
            ] } }),
            Some("planning"),
        )
        .await,
    );
    assert_eq!(batch["results"][0]["result"]["success"], true);
    assert_eq!(
        batch["results"][1]["result"]["error"]["code"],
        "COMMAND_NOT_IN_CONTEXT"
    );
    let discovered = tool_result(
        &modern(
            &server,
            "tools/call",
            json!({ "name": "afd-discover", "arguments": {} }),
            Some("planning"),
        )
        .await,
    );
    let found: Vec<&str> = discovered["data"]["commands"]
        .as_array()
        .unwrap()
        .iter()
        .map(|command| command["name"].as_str().unwrap())
        .collect();
    assert!(!found.contains(&"review-approve"));
}

#[tokio::test]
async fn request_contexts_are_never_stored() {
    let server = server();
    let entered = tool_result(
        &modern(
            &server,
            "tools/call",
            json!({ "name": "afd-context-enter", "arguments": { "context": "review" } }),
            Some("planning"),
        )
        .await,
    );
    assert_eq!(
        entered["data"],
        json!({ "entered": "review", "previous": "planning", "persisted": false })
    );
    // The next request is unscoped again.
    let listed = tool_result(
        &modern(
            &server,
            "tools/call",
            json!({ "name": "afd-context-list", "arguments": {} }),
            None,
        )
        .await,
    );
    assert_eq!(listed["data"]["activeContext"], Value::Null);
}

#[tokio::test]
async fn an_unknown_meta_context_is_invalid_params() {
    let server = server();
    let response = modern(&server, "tools/list", json!({}), Some("nope")).await;
    assert_eq!(response["error"]["code"], -32602, "{response}");
    assert_eq!(
        response["error"]["message"],
        "Unknown context in _meta[\"dev.afd/context\"]"
    );
    assert_eq!(
        response["error"]["data"]["suggestion"],
        "Use one of: planning, review"
    );
}

#[tokio::test]
async fn stateless_2025_http_requests_have_no_session() {
    let server = server();
    let call = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": { "name": "afd-context-enter", "arguments": { "context": "planning" } },
    });
    let response = post(&server, call, &[("mcp-protocol-version", "2025-11-25")]).await;
    let result = tool_result(&response);
    assert_eq!(result["error"]["code"], "SESSION_REQUIRED", "{response}");
}

#[tokio::test]
async fn a_2025_connection_keeps_its_context_stack() {
    let (client, transport) = tokio::io::duplex(64 * 1024);
    let (read, write) = tokio::io::split(transport);
    let service = tokio::spawn(async move {
        let running = server().serve((read, write)).await.unwrap();
        let _ = running.waiting().await;
    });
    let (client_read, mut client_write) = tokio::io::split(client);
    let mut lines = BufReader::new(client_read).lines();
    let mut id = 0;
    let mut request = |method: &str, params: Value| {
        id += 1;
        format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        )
    };
    let mut send = Vec::new();
    send.push(request(
        "initialize",
        json!({ "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "t", "version": "0" } }),
    ));
    for message in send.drain(..) {
        client_write.write_all(message.as_bytes()).await.unwrap();
    }
    let initialized = lines.next_line().await.unwrap().unwrap();
    assert!(initialized.contains("serverInfo"), "{initialized}");
    client_write
        .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
        .await
        .unwrap();

    let mut ask = |method: &str, params: Value| request(method, params);
    let messages = [
        ask(
            "tools/call",
            json!({ "name": "afd-context-enter", "arguments": { "context": "planning" } }),
        ),
        ask("tools/list", json!({})),
        ask(
            "tools/call",
            json!({ "name": "review-approve", "arguments": {} }),
        ),
        ask(
            "tools/call",
            json!({ "name": "afd-context-exit", "arguments": {} }),
        ),
    ];
    let mut responses = Vec::new();
    for message in messages {
        client_write.write_all(message.as_bytes()).await.unwrap();
        let line = lines.next_line().await.unwrap().unwrap();
        responses.push(serde_json::from_str::<Value>(&line).unwrap());
    }
    assert_eq!(
        tool_result(&responses[0])["data"],
        json!({ "entered": "planning", "previous": null })
    );
    let listed = names(&responses[1]);
    assert!(listed.contains(&"plan-create".to_owned()));
    assert!(!listed.contains(&"review-approve".to_owned()));
    assert_eq!(
        tool_result(&responses[2])["error"]["code"],
        "COMMAND_NOT_IN_CONTEXT"
    );
    assert_eq!(
        tool_result(&responses[3])["data"],
        json!({ "exited": "planning", "current": null })
    );
    drop(client_write);
    service.abort();
}

#[test]
fn with_contexts_reserves_the_context_command_names() {
    let registry = CommandRegistry::new();
    registry
        .register(
            CommandDefinition::new("afd-context-list", "Mine", vec![], Echo)
                .with_expose(ExposeOptions::new().with_mcp(true)),
        )
        .unwrap();
    let error = McpServer::new(Arc::new(registry), "x", "1")
        .with_contexts(vec![ContextConfig::new("a")])
        .err()
        .unwrap();
    assert_eq!(error, "Reserved context command name: afd-context-list");
}
