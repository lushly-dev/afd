//! The `server` feature over Streamable HTTP: MCP 2026-07-28 requests and 2025 `initialize`
//! clients against one endpoint, driven through the `tower` service in process.
#![cfg(feature = "server")]

use std::sync::Arc;

use afd::server::{HttpOptions, McpServer};
use afd::{
    success, CommandContext, CommandDefinition, CommandHandler, CommandRegistry, CommandResult,
};
use async_trait::async_trait;
use http_body_util::{BodyExt, Full};
use serde_json::{json, Value};
use tower::ServiceExt;

struct Echo;

#[async_trait]
impl CommandHandler for Echo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "echo": input }))
    }
}

fn server() -> McpServer {
    let registry = CommandRegistry::new();
    let mut public = CommandDefinition::new("item-echo", "Echo the input", vec![], Echo);
    public.expose.mcp = true;
    registry.register(public).unwrap();
    registry
        .register(CommandDefinition::new(
            "secret-rotate",
            "Private",
            vec![],
            Echo,
        ))
        .unwrap();
    McpServer::new(Arc::new(registry), "rust-test", "1.2.3").with_tools_list_ttl_ms(60_000)
}

const META: &str = r#"{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

async fn post(body: Value, headers: &[(&str, &str)]) -> (u16, Value) {
    let service = server().streamable_http_service(HttpOptions::default());
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
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let json = serde_json::from_str(&text).unwrap_or_else(|_| {
        text.lines()
            .find_map(|line| line.strip_prefix("data: "))
            .and_then(|data| serde_json::from_str(data).ok())
            .unwrap_or(Value::Null)
    });
    (status, json)
}

fn modern(method: &str, id: u64, params: Value) -> Value {
    let mut params = params;
    params["_meta"] = serde_json::from_str(META).unwrap();
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

fn headers<'a>(method: &'a str, name: Option<&'a str>) -> Vec<(&'a str, &'a str)> {
    let mut headers = vec![
        ("mcp-protocol-version", "2026-07-28"),
        ("mcp-method", method),
    ];
    if let Some(name) = name {
        headers.push(("mcp-name", name));
    }
    headers
}

#[tokio::test]
async fn discover_describes_the_server() {
    let (status, body) = post(
        modern("server/discover", 1, json!({})),
        &headers("server/discover", None),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let result = &body["result"];
    assert_eq!(result["resultType"], "complete");
    assert!(result["supportedVersions"]
        .as_array()
        .unwrap()
        .contains(&json!("2026-07-28")));
    assert!(result["instructions"]
        .as_str()
        .unwrap()
        .contains("CommandResult"));
}

#[tokio::test]
async fn tools_list_shows_exposed_commands_with_cache_hints() {
    let (_, body) = post(
        modern("tools/list", 2, json!({})),
        &headers("tools/list", None),
    )
    .await;
    let result = &body["result"];
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["ttlMs"], 60_000);
    assert_eq!(result["cacheScope"], "public");
    let names: Vec<&str> = result["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["item-echo"]);
}

#[tokio::test]
async fn tools_call_returns_command_results_and_hides_private_commands() {
    let call =
        |name: &'static str| modern("tools/call", 3, json!({ "name": name, "arguments": {} }));
    let (_, body) = post(call("item-echo"), &headers("tools/call", Some("item-echo"))).await;
    let result = &body["result"];
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["isError"], false);
    let payload: Value =
        serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["success"], true);

    let (_, body) = post(
        call("secret-rotate"),
        &headers("tools/call", Some("secret-rotate")),
    )
    .await;
    assert_eq!(body["result"]["isError"], true);
    let payload: Value =
        serde_json::from_str(body["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["error"]["code"], "COMMAND_NOT_FOUND");
}

#[tokio::test]
async fn header_mismatch_is_rejected() {
    let call = modern(
        "tools/call",
        4,
        json!({ "name": "item-echo", "arguments": {} }),
    );
    let (status, body) = post(call, &headers("tools/call", Some("other"))).await;
    assert_eq!(status, 400, "{body}");
    assert_eq!(body["error"]["code"], -32020);
}

#[tokio::test]
async fn legacy_clients_initialize_on_the_same_endpoint() {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": { "name": "legacy", "version": "0" }
        }
    });
    let (status, body) = post(initialize, &[]).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(body["result"]["serverInfo"]["name"], "rust-test");
}

#[tokio::test]
async fn foreign_origins_are_refused() {
    let (status, _) = post(
        modern("tools/list", 6, json!({})),
        &[
            ("mcp-protocol-version", "2026-07-28"),
            ("mcp-method", "tools/list"),
            ("origin", "https://evil.example"),
        ],
    )
    .await;
    assert_eq!(status, 403);
}
