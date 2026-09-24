use super::*;
use crate::commands::register_commands;
use crate::store::TodoStore;
use afd::{success, CommandDefinition, CommandHandler};
use async_trait::async_trait;
use axum::body::Body;
use axum::http::Request as HttpRequest;
use http_body_util::BodyExt;
use tower::ServiceExt;

/// A command registered without MCP exposure (the default).
struct Internal;

#[async_trait]
impl CommandHandler for Internal {
    async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(json!({ "ran": true }))
    }
}

fn config(vars: &[(&str, &str)]) -> ServerConfig {
    ServerConfig::from_env(|name| {
        vars.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_string())
    })
    .expect("valid configuration")
}

fn app_with(max_body_bytes: usize) -> Router {
    let mut registry = CommandRegistry::new();
    let tools = register_commands(&mut registry, &Arc::new(TodoStore::default()))
        .expect("commands register");
    registry
        .register(CommandDefinition::new(
            "admin-reset",
            "Internal only",
            vec![],
            Internal,
        ))
        .expect("internal command registers");
    let state = AppState {
        registry,
        tools,
        policy: config(&[]).policy,
    };
    router(Arc::new(state), max_body_bytes).expect("router builds")
}

fn app() -> Router {
    app_with(1024 * 1024)
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Value,
}

async fn send(app: Router, request: HttpRequest<Body>) -> Reply {
    let response = app
        .oneshot(request)
        .await
        .expect("the router is infallible");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body reads")
        .to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    Reply {
        status,
        headers,
        body,
    }
}

fn post() -> axum::http::request::Builder {
    HttpRequest::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", "127.0.0.1:3100")
        .header("content-type", "application/json")
}

async fn rpc(app: Router, message: Value) -> Reply {
    let request = post()
        .body(Body::from(message.to_string()))
        .expect("request builds");
    send(app, request).await
}

async fn call(app: Router, name: &str, arguments: Value) -> (Value, Value) {
    let reply = rpc(
        app,
        json!({
            "jsonrpc": "2.0", "id": 7, "method": "tools/call",
            "params": { "name": name, "arguments": arguments }
        }),
    )
    .await;
    let text = reply.body["result"]["content"][0]["text"]
        .as_str()
        .expect("tools/call returns text content")
        .to_string();
    let result: Value = serde_json::from_str(&text).expect("the text is a CommandResult");
    (reply.body, result)
}

// ─── JSON-RPC and MCP ────────────────────────────────────────────────────────

#[tokio::test]
async fn initialize_negotiates_the_protocol_version() {
    let reply = rpc(
        app(),
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "2025-03-26" } }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body["result"]["protocolVersion"], "2025-03-26");
    assert!(reply.body["result"]["capabilities"]["tools"].is_object());
    assert!(reply.body.get("error").is_none(), "no \"error\": null");

    let unknown = rpc(
        app(),
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "1999-01-01" } }),
    )
    .await;
    assert_eq!(
        unknown.body["result"]["protocolVersion"],
        PROTOCOL_VERSIONS[0]
    );
}

#[tokio::test]
async fn tools_list_shows_only_exposed_commands_with_their_schemas() {
    let reply = rpc(
        app(),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
    )
    .await;
    let tools = reply.body["result"]["tools"]
        .as_array()
        .expect("tools array");
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();

    assert_eq!(tools.len(), 11);
    assert!(!names.contains(&"admin-reset"));
    for batch in [
        "todo-create-batch",
        "todo-delete-batch",
        "todo-toggle-batch",
    ] {
        assert!(names.contains(&batch), "{batch} is listed");
    }
    let create = tools
        .iter()
        .find(|t| t["name"] == "todo-create")
        .expect("todo-create is listed");
    assert_eq!(
        create["inputSchema"]["properties"]["title"]["maxLength"],
        200
    );
    assert_eq!(create["inputSchema"]["required"], json!(["title"]));
}

#[tokio::test]
async fn tools_call_returns_a_command_result() {
    let (envelope, result) = call(app(), "todo-create", json!({ "title": "From MCP" })).await;
    assert_eq!(envelope["result"]["isError"], false);
    assert!(envelope.get("error").is_none());
    assert_eq!(result["success"], true);
    assert_eq!(result["data"]["title"], "From MCP");
}

#[tokio::test]
async fn tools_call_reports_failures_with_is_error() {
    let (envelope, result) = call(app(), "todo-create", json!({ "title": "" })).await;
    assert_eq!(envelope["result"]["isError"], true);
    assert_eq!(result["error"]["code"], "VALIDATION_ERROR");
    assert!(result["error"]["suggestion"].is_string());
}

#[tokio::test]
async fn unexposed_commands_cannot_be_called() {
    let (envelope, result) = call(app(), "admin-reset", json!({})).await;
    assert_eq!(envelope["result"]["isError"], true);
    assert_eq!(result["error"]["code"], "COMMAND_NOT_FOUND");
    assert!(result.get("data").is_none());
}

#[tokio::test]
async fn protocol_errors_are_json_rpc_errors() {
    let unknown = rpc(
        app(),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" }),
    )
    .await;
    assert_eq!(unknown.body["error"]["code"], METHOD_NOT_FOUND);
    assert!(unknown.body.get("result").is_none());

    let no_name = rpc(
        app(),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {} }),
    )
    .await;
    assert_eq!(no_name.body["error"]["code"], INVALID_PARAMS);

    let not_json = post().body(Body::from("{")).expect("request builds");
    let reply = send(app(), not_json).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body["error"]["code"], PARSE_ERROR);
}

#[tokio::test]
async fn notifications_get_202_and_no_body() {
    let reply = rpc(
        app(),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    )
    .await;
    assert_eq!(reply.status, StatusCode::ACCEPTED);
    assert_eq!(reply.body, Value::Null);
}

#[tokio::test]
async fn get_on_the_endpoint_is_405() {
    let request = HttpRequest::builder()
        .uri("/mcp")
        .header("host", "localhost:3100")
        .body(Body::empty())
        .expect("request builds");
    assert_eq!(
        send(app(), request).await.status,
        StatusCode::METHOD_NOT_ALLOWED
    );
}

// ─── HTTP security ───────────────────────────────────────────────────────────

#[tokio::test]
async fn rejects_other_host_names() {
    let request = HttpRequest::builder()
        .uri("/health")
        .header("host", "rebind.evil.example:3100")
        .body(Body::empty())
        .expect("request builds");
    assert_eq!(send(app(), request).await.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn allows_the_dev_frontends_and_nothing_else() {
    let message = json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" });
    let with_origin = |origin: &str| {
        post()
            .header("origin", origin)
            .body(Body::from(message.to_string()))
            .expect("request builds")
    };

    let allowed = send(app(), with_origin("http://localhost:5173")).await;
    assert_eq!(allowed.status, StatusCode::OK);
    assert_eq!(
        allowed.headers.get("access-control-allow-origin"),
        Some(&HeaderValue::from_static("http://localhost:5173"))
    );

    for origin in [
        "https://evil.example",
        "null",
        "http://localhost:5173.evil.example",
    ] {
        let denied = send(app(), with_origin(origin)).await;
        assert_eq!(denied.status, StatusCode::FORBIDDEN, "{origin}");
        assert!(denied.headers.get("access-control-allow-origin").is_none());
    }
}

#[tokio::test]
async fn answers_preflights_only_for_allowed_origins() {
    let preflight = |origin: &str| {
        HttpRequest::builder()
            .method("OPTIONS")
            .uri("/message")
            .header("host", "localhost:3100")
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header("access-control-request-headers", "content-type")
            .body(Body::empty())
            .expect("request builds")
    };
    let allowed = send(app(), preflight("http://localhost:3000")).await;
    assert_eq!(allowed.status, StatusCode::OK);
    assert!(allowed.headers.get("access-control-allow-origin").is_some());

    let denied = send(app(), preflight("https://evil.example")).await;
    assert_eq!(denied.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn rejects_cross_site_requests_without_origin() {
    let request = HttpRequest::builder()
        .uri("/health")
        .header("host", "localhost:3100")
        .header("sec-fetch-site", "cross-site")
        .body(Body::empty())
        .expect("request builds");
    assert_eq!(send(app(), request).await.status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn caps_the_body_and_requires_json() {
    let big = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                      "params": { "name": "todo-create", "arguments": { "title": "x".repeat(4096) } } });
    let request = post()
        .body(Body::from(big.to_string()))
        .expect("request builds");
    assert_eq!(
        send(app_with(1024), request).await.status,
        StatusCode::PAYLOAD_TOO_LARGE
    );

    let text = HttpRequest::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", "localhost:3100")
        .header("content-type", "text/plain")
        .body(Body::from("{}"))
        .expect("request builds");
    assert_eq!(
        send(app(), text).await.status,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
}

// ─── Configuration ───────────────────────────────────────────────────────────

#[test]
fn binds_loopback_by_default() {
    let config = config(&[]);
    assert_eq!(config.host, "127.0.0.1");
    assert_eq!(config.port, 3100);
    assert!(config
        .policy
        .allowed_origins
        .contains(&"http://127.0.0.1:3000".to_string()));
}

#[test]
fn reads_overrides() {
    let config = config(&[
        ("HOST", "0.0.0.0"),
        ("PORT", "4000"),
        ("ALLOWED_ORIGINS", "https://todo.example.com"),
        ("ALLOWED_HOSTS", "todo.example.com"),
    ]);
    assert_eq!(config.port, 4000);
    assert!(config
        .policy
        .allowed_origins
        .contains(&"https://todo.example.com".to_string()));
    assert!(config.policy.host_allowed(Some("todo.example.com")));
    assert!(config.policy.host_allowed(Some("0.0.0.0:4000")));
}

#[test]
fn refuses_wildcard_null_and_url_origins() {
    for origin in ["*", "null", "localhost:3000", "http://localhost:3000/app"] {
        let result =
            ServerConfig::from_env(|name| (name == "ALLOWED_ORIGINS").then(|| origin.to_string()));
        assert!(result.is_err(), "{origin}");
    }
    assert!(ServerConfig::from_env(|name| (name == "PORT").then(|| "99999".to_string())).is_err());
}

#[test]
fn parses_host_headers() {
    assert_eq!(hostname("LocalHost:3100").as_deref(), Some("localhost"));
    assert_eq!(hostname("[::1]:3100").as_deref(), Some("[::1]"));
    assert_eq!(hostname("127.0.0.1").as_deref(), Some("127.0.0.1"));
    for bad in [
        "",
        "evil@localhost",
        "localhost:abc",
        "[::1]x",
        "a b",
        "::1",
    ] {
        assert_eq!(hostname(bad), None, "{bad}");
    }
}
