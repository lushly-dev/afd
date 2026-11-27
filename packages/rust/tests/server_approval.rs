//! The approval middleware behind the `server` feature (`spec/approvals.md`, "Approvals"):
//! tool arguments and request `_meta` never carry approval evidence (rule 1).
#![cfg(all(feature = "server", feature = "approval"))]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use afd::server::{HttpOptions, McpServer, ToolStrategy};
use afd::{
    create_approval_middleware, success, ApprovalMiddlewareOptions, ApprovalPolicy, CommandContext,
    CommandDefinition, CommandHandler, CommandParameter, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

const SECRET: &str = "test-approval-secret-0123456789abcdef";

struct Delete(Arc<AtomicUsize>);

#[async_trait]
impl CommandHandler for Delete {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        self.0.fetch_add(1, Ordering::SeqCst);
        success(json!({ "deleted": input["id"] }))
    }
}

fn server_with_options(
    configure: impl FnOnce(ApprovalMiddlewareOptions) -> ApprovalMiddlewareOptions,
) -> (McpServer, Arc<AtomicUsize>, Arc<Mutex<Vec<String>>>) {
    let runs = Arc::new(AtomicUsize::new(0));
    let issued = Arc::new(Mutex::new(Vec::<String>::new()));
    let registry = CommandRegistry::new();
    let mut delete = CommandDefinition::new(
        "todo-delete",
        "Delete a todo",
        vec![CommandParameter::required_number("id", "Todo ID")],
        Delete(Arc::clone(&runs)),
    )
    .as_mutation()
    .with_approval(ApprovalPolicy::Required);
    delete.expose.mcp = true;
    registry.register(delete).unwrap();
    let captured = Arc::clone(&issued);
    let options = configure(
        ApprovalMiddlewareOptions::new(SECRET, registry.list()).with_on_approval_required(
            move |request| {
                let captured = Arc::clone(&captured);
                Box::pin(async move {
                    captured.lock().unwrap().push(request.approval_token);
                })
            },
        ),
    );
    registry.add_middleware(create_approval_middleware(options).unwrap());
    (
        McpServer::new(Arc::new(registry), "approval", "1.0.0"),
        runs,
        issued,
    )
}

fn server() -> (McpServer, Arc<AtomicUsize>, Arc<Mutex<Vec<String>>>) {
    server_with_options(|options| options)
}

async fn call(server: &McpServer, arguments: Value, meta: Value) -> Value {
    call_tool(server, "todo-delete", arguments, meta).await
}

async fn call_tool(server: &McpServer, name: &str, arguments: Value, meta: Value) -> Value {
    let mut meta = meta;
    meta["io.modelcontextprotocol/protocolVersion"] = json!("2026-07-28");
    meta["io.modelcontextprotocol/clientCapabilities"] = json!({});
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": { "name": name, "arguments": arguments, "_meta": meta },
    });
    let service = server.streamable_http_service(HttpOptions::default());
    let request = http::Request::post("/mcp")
        .header("host", "localhost")
        .header("content-type", "application/json")
        .header("accept", "application/json, text/event-stream")
        .header("mcp-protocol-version", "2026-07-28")
        .header("mcp-method", "tools/call")
        .header("mcp-name", name)
        .body(Full::new(bytes::Bytes::from(body.to_string())))
        .unwrap();
    let response = service.oneshot(request).await.unwrap();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let response: Value = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::Null)
    });
    serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn lists_the_policy_in_tool_meta() {
    let (server, _, _) = server();
    let tools = server
        .clone()
        .with_tool_strategy(ToolStrategy::Individual)
        .tools();
    let delete = tools
        .iter()
        .find(|tool| tool["name"] == "todo-delete")
        .unwrap();
    assert_eq!(delete["_meta"], json!({ "approval": "required" }));
    // Grouped: on the action entry.
    let grouped = server.tools();
    let todo = grouped.iter().find(|tool| tool["name"] == "todo").unwrap();
    assert_eq!(todo["_meta"]["actions"][0]["approval"], "required");
}

#[tokio::test]
async fn mcp_call_omits_approval_token_by_default_and_includes_on_opt_in() {
    let (default_server, _, issued) = server();
    let held = call(&default_server, json!({ "id": 1 }), json!({})).await;
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED");
    // Rule 6: non-approver MCP callers do not get details.approvalToken by default.
    assert!(held["error"]["details"].get("approvalToken").is_none());
    assert_eq!(issued.lock().unwrap().len(), 1);

    // Explicit opt-in includes the token on MCP calls.
    let (opt_in_server, _, _) = server_with_options(|options| options.with_include_token(true));
    let opted_in = call(&opt_in_server, json!({ "id": 1 }), json!({})).await;
    assert_eq!(opted_in["error"]["code"], "APPROVAL_REQUIRED");
    assert!(opted_in["error"]["details"]["approvalToken"].is_string());
}

#[tokio::test]
async fn never_takes_approval_from_tool_arguments_or_request_meta() {
    let (server, runs, issued) = server();
    let held = call(&server, json!({ "id": 1 }), json!({})).await;
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED");
    assert!(held["error"]["details"].get("approvalToken").is_none());
    let token = issued.lock().unwrap()[0].clone();

    let smuggled = [
        (json!({ "id": 1, "approval": token }), json!({})),
        (json!({ "id": 1, "approvalToken": token }), json!({})),
        (
            json!({ "id": 1 }),
            json!({ "approval": token, "dev.afd/approval": token }),
        ),
    ];
    for (arguments, meta) in smuggled {
        let result = call(&server, arguments.clone(), meta).await;
        assert_eq!(result["error"]["code"], "APPROVAL_REQUIRED", "{arguments}");
        // No evidence reached the context, so nothing was rejected.
        assert!(
            result["error"]["details"]["reason"].is_null(),
            "{arguments}"
        );
    }
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn meta_tools_go_through_the_approval_middleware() {
    let (server, runs, _) = server();
    let called = call_tool(
        &server,
        "afd-call",
        json!({ "command": "todo-delete", "input": { "id": 1 } }),
        json!({}),
    )
    .await;
    assert_eq!(called["error"]["code"], "APPROVAL_REQUIRED");
    assert!(called["error"]["details"].get("approvalToken").is_none());
    let grouped = call_tool(
        &server,
        "todo",
        json!({ "action": "delete", "params": { "id": 1 } }),
        json!({}),
    )
    .await;
    assert_eq!(grouped["error"]["code"], "APPROVAL_REQUIRED");
    assert!(grouped["error"]["details"].get("approvalToken").is_none());
    let batch = call_tool(
        &server,
        "afd-batch",
        json!({ "commands": [{ "command": "todo-delete", "input": { "id": 1 } }] }),
        json!({}),
    )
    .await;
    assert_eq!(
        batch["results"][0]["result"]["error"]["code"],
        "APPROVAL_REQUIRED"
    );
    let pipe = call_tool(
        &server,
        "afd-pipe",
        json!({ "steps": [{ "command": "todo-delete", "input": { "id": 1 } }] }),
        json!({}),
    )
    .await;
    assert_eq!(pipe["steps"][0]["error"]["code"], "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_first_class_tool_and_the_meta_tools_of_a_hybrid_server_hold_for_approval() {
    let (server, runs, issued) = server();
    let server = server
        .with_tool_strategy(ToolStrategy::Hybrid)
        .with_first_class_tools(["todo-delete"]);
    let held = call_tool(&server, "todo-delete", json!({ "id": 1 }), json!({})).await;
    assert_eq!(held["error"]["code"], "APPROVAL_REQUIRED");
    assert!(held["error"]["details"].get("approvalToken").is_none());
    let called = call_tool(
        &server,
        "afd-call",
        json!({ "command": "todo-delete", "input": { "id": 1 } }),
        json!({}),
    )
    .await;
    assert_eq!(called["error"]["code"], "APPROVAL_REQUIRED");
    // Evidence in the arguments of a first-class tool is no evidence.
    let token = issued.lock().unwrap()[0].clone();
    let smuggled = call_tool(
        &server,
        "todo-delete",
        json!({ "id": 1, "approvalToken": token }),
        json!({ "approval": token }),
    )
    .await;
    assert_eq!(smuggled["error"]["code"], "APPROVAL_REQUIRED");
    assert_eq!(runs.load(Ordering::SeqCst), 0);
}
