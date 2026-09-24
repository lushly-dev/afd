//! MCP over HTTP.
//!
//! `POST /mcp` (and `POST /message`, which the web frontends use) accepts one
//! JSON-RPC 2.0 message and answers with `application/json`: enough of the MCP
//! Streamable HTTP transport for `initialize`, `ping`, `tools/list` and
//! `tools/call`. There is no SSE stream (`GET` answers 405, which MCP clients
//! accept) and no session state. `GET /health` is a liveness check.
//!
//! Every request passes [`guard`] first: the `Host` header must name this
//! server (DNS rebinding) and a browser `Origin` must be on the allowlist
//! (`null` never is). Only commands with `expose.mcp` are listed or callable,
//! bodies are capped, and the server binds 127.0.0.1 unless `HOST` says
//! otherwise.

use crate::commands::Tool;
use afd::{failure, CommandContext, CommandError, CommandRegistry, CommandResult};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Request, State},
    http::{
        header::{ACCEPT, CONTENT_TYPE, HOST, ORIGIN},
        HeaderMap, HeaderName, HeaderValue, Method, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};

const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;
const INTERNAL_ERROR: i64 = -32603;

/// MCP protocol versions this server can speak, newest first.
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

/// Ports of the dev frontends in the todo README: `pnpm dev:web` (3000) and
/// the Vite dev servers (5173, and 5174 when both run).
const DEV_FRONTEND_PORTS: [u16; 3] = [3000, 5173, 5174];

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION AND POLICY
// ═══════════════════════════════════════════════════════════════════════════════

/// Which browser origins and `Host` names the server accepts.
#[derive(Debug, Clone, PartialEq)]
pub struct HttpPolicy {
    pub allowed_origins: Vec<String>,
    pub allowed_hosts: Vec<String>,
}

impl HttpPolicy {
    /// Whether the `Host` header names this server.
    pub fn host_allowed(&self, host: Option<&str>) -> bool {
        host.and_then(hostname)
            .is_some_and(|name| self.allowed_hosts.contains(&name))
    }

    /// Whether a request may proceed: an `Origin` must be allowed exactly (never
    /// `null`); without one, only non-browser or same-origin requests pass.
    pub fn origin_allowed(&self, origin: Option<&str>, fetch_site: Option<&str>) -> bool {
        match origin {
            Some(origin) => origin != "null" && self.allowed_origins.iter().any(|o| o == origin),
            None => matches!(fetch_site, None | Some("same-origin" | "none")),
        }
    }
}

/// The host name of a `Host` header value (`name`, `name:port`, `[v6]:port`),
/// lower-cased, or `None` if it is malformed.
fn hostname(host: &str) -> Option<String> {
    let invalid = |c: char| c.is_whitespace() || matches!(c, '/' | '@' | '\\' | '?' | '#');
    if host.is_empty() || host.contains(invalid) {
        return None;
    }
    let is_port = |port: &str| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit());
    let name = if host.starts_with('[') {
        let end = host.find(']')?;
        let rest = &host[end + 1..];
        if !rest.is_empty() && !rest.strip_prefix(':').is_some_and(is_port) {
            return None;
        }
        &host[..=end]
    } else {
        match host.rsplit_once(':') {
            Some((name, port)) if is_port(port) && !name.contains(':') => name,
            Some(_) => return None,
            None => host,
        }
    };
    Some(name.to_ascii_lowercase())
}

fn list(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(str::to_string)
        .collect()
}

/// Accept an exact `http(s)://host[:port]` origin; refuse `*`, `null` and URLs.
fn exact_origin(origin: String) -> Result<String, String> {
    let rest = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"));
    match rest {
        Some(rest)
            if !rest.is_empty()
                && !rest.contains(|c: char| {
                    matches!(c, '/' | '?' | '#' | '@') || c.is_whitespace()
                }) =>
        {
            Ok(origin)
        }
        _ => Err(format!(
            "ALLOWED_ORIGINS entry \"{origin}\" must be an exact http(s) origin such as \
             http://localhost:8080 (\"*\" and \"null\" are not allowed)"
        )),
    }
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Interface to bind (`HOST`, default `127.0.0.1`).
    pub host: String,
    /// Port (`PORT`, default 3100).
    pub port: u16,
    /// Largest request body (`MAX_BODY_BYTES`, default 1 MiB).
    pub max_body_bytes: usize,
    pub policy: HttpPolicy,
}

impl ServerConfig {
    /// Read the configuration through `var` (normally `std::env::var`).
    pub fn from_env(var: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let host = var("HOST")
            .map(|h| h.trim().to_string())
            .filter(|h| !h.is_empty())
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let port = match var("PORT") {
            Some(port) => port
                .trim()
                .parse::<u16>()
                .map_err(|_| format!("PORT must be a port number, got \"{port}\""))?,
            None => 3100,
        };
        let max_body_bytes = match var("MAX_BODY_BYTES") {
            Some(bytes) => bytes
                .trim()
                .parse::<usize>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| {
                    format!("MAX_BODY_BYTES must be a positive integer, got \"{bytes}\"")
                })?,
            None => 1024 * 1024,
        };

        let mut allowed_origins: Vec<String> = DEV_FRONTEND_PORTS
            .iter()
            .flat_map(|port| {
                [
                    format!("http://localhost:{port}"),
                    format!("http://127.0.0.1:{port}"),
                ]
            })
            .collect();
        for origin in list(var("ALLOWED_ORIGINS")) {
            let origin = exact_origin(origin)?;
            if !allowed_origins.contains(&origin) {
                allowed_origins.push(origin);
            }
        }

        let bind_name = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host.clone()
        };
        let mut allowed_hosts: Vec<String> = ["localhost", "127.0.0.1", "[::1]"]
            .into_iter()
            .map(str::to_string)
            .collect();
        for name in std::iter::once(bind_name).chain(list(var("ALLOWED_HOSTS"))) {
            let name = name.to_ascii_lowercase();
            if !allowed_hosts.contains(&name) {
                allowed_hosts.push(name);
            }
        }

        Ok(Self {
            host,
            port,
            max_body_bytes,
            policy: HttpPolicy {
                allowed_origins,
                allowed_hosts,
            },
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

pub struct AppState {
    pub registry: CommandRegistry,
    /// Tool descriptions (with input schemas) of the registered commands.
    pub tools: Vec<Tool>,
    pub policy: HttpPolicy,
}

impl AppState {
    fn exposed(&self, name: &str) -> bool {
        self.registry
            .get(name)
            .is_some_and(|command| command.expose.mcp)
    }
}

/// Build the HTTP application.
pub fn router(state: Arc<AppState>, max_body_bytes: usize) -> Result<Router, String> {
    let origins = state
        .policy
        .allowed_origins
        .iter()
        .map(|origin| {
            HeaderValue::from_str(origin).map_err(|_| format!("Invalid allowed origin: {origin}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            CONTENT_TYPE,
            ACCEPT,
            HeaderName::from_static("mcp-protocol-version"),
            HeaderName::from_static("mcp-session-id"),
        ])
        .max_age(Duration::from_secs(600));

    // The last layer runs first: guard, then CORS (preflights), then the body limit.
    Ok(Router::new()
        .route("/health", get(health))
        .route("/mcp", post(rpc))
        .route("/message", post(rpc))
        .layer(DefaultBodyLimit::max(max_body_bytes))
        .layer(cors)
        .layer(middleware::from_fn_with_state(Arc::clone(&state), guard))
        .with_state(state))
}

/// Start the server and run until Ctrl+C.
pub async fn start_server(state: AppState, config: &ServerConfig) -> Result<(), String> {
    let app = router(Arc::new(state), config.max_body_bytes)?;
    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port))
        .await
        .map_err(|error| {
            format!(
                "Could not listen on {}:{}: {error}",
                config.host, config.port
            )
        })?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("Could not read the bound address: {error}"))?;

    println!("Todo Rust backend listening on http://{address}");
    println!("  MCP endpoint: POST http://{address}/mcp (also /message)");
    println!(
        "  Allowed browser origins: {}",
        config.policy.allowed_origins.join(", ")
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|error| format!("Server error: {error}"))
}

async fn shutdown_signal() {
    if tokio::signal::ctrl_c().await.is_err() {
        // No signal handler available: run until the process is killed.
        std::future::pending::<()>().await;
    }
}

fn forbidden(message: &str, suggestion: &str) -> Response {
    let body = json!({ "error": message, "suggestion": suggestion });
    (StatusCode::FORBIDDEN, Json(body)).into_response()
}

/// Reject requests for another host name or from a disallowed browser origin.
async fn guard(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let header = |name| {
        headers
            .get(name)
            .and_then(|value: &HeaderValue| value.to_str().ok())
    };

    if !state.policy.host_allowed(header(HOST)) {
        return forbidden(
            "Host is not allowed",
            "Use localhost or 127.0.0.1, or add the host name to ALLOWED_HOSTS",
        );
    }
    let fetch_site = headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok());
    if !state.policy.origin_allowed(header(ORIGIN), fetch_site) {
        return forbidden(
            "Origin is not allowed",
            "Serve the page from an allowed origin or add it to ALLOWED_ORIGINS",
        );
    }
    next.run(request).await
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "name": "todo-app-rust",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

async fn rpc(State(state): State<Arc<AppState>>, headers: HeaderMap, body: Bytes) -> Response {
    let is_json = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !is_json {
        let body = rpc_error(
            Value::Null,
            INVALID_REQUEST,
            "Content-Type must be application/json",
        );
        return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(body)).into_response();
    }

    let message: Value = match serde_json::from_slice(&body) {
        Ok(message) => message,
        Err(_) => {
            let body = rpc_error(Value::Null, PARSE_ERROR, "Request body must be valid JSON");
            return (StatusCode::BAD_REQUEST, Json(body)).into_response();
        }
    };

    match handle_message(&state, message).await {
        Some(response) => Json(response).into_response(),
        // Notifications get no JSON-RPC response.
        None => StatusCode::ACCEPTED.into_response(),
    }
}

/// Answer one JSON-RPC message, or `None` for a notification.
pub async fn handle_message(state: &AppState, message: Value) -> Option<Value> {
    let Value::Object(message) = message else {
        return Some(rpc_error(
            Value::Null,
            INVALID_REQUEST,
            "Send one JSON-RPC 2.0 request object (batches are not supported)",
        ));
    };
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str);
    let Some(method) = method.filter(|_| message.get("jsonrpc") == Some(&json!("2.0"))) else {
        return Some(rpc_error(
            id.unwrap_or(Value::Null),
            INVALID_REQUEST,
            "Expected a JSON-RPC 2.0 request with a string method",
        ));
    };
    // A notification (no id) never gets a response. The MCP notifications
    // (initialized, cancelled) need no work here, and a request method sent
    // without an id is not run: nobody could see its result.
    let id = id?;
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));

    Some(match method {
        "initialize" => rpc_result(id, initialize(&params)),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => {
            let tools: Vec<&Tool> = state
                .tools
                .iter()
                .filter(|t| state.exposed(&t.name))
                .collect();
            rpc_result(id, json!({ "tools": tools }))
        }
        "tools/call" => match call_tool(state, &params).await {
            Ok(result) => rpc_result(id, result),
            Err((code, message)) => rpc_error(id, code, &message),
        },
        other => {
            let shown: String = other.chars().take(64).collect();
            rpc_error(id, METHOD_NOT_FOUND, &format!("Method not found: {shown}"))
        }
    })
}

fn initialize(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = requested
        .filter(|version| PROTOCOL_VERSIONS.contains(version))
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "todo-app-rust", "version": env!("CARGO_PKG_VERSION") },
    })
}

async fn call_tool(state: &AppState, params: &Value) -> Result<Value, (i64, String)> {
    let name = params.get("name").and_then(Value::as_str).ok_or((
        INVALID_PARAMS,
        "tools/call requires params.name".to_string(),
    ))?;
    let arguments = match params.get("arguments") {
        None | Some(Value::Null) => json!({}),
        Some(arguments @ Value::Object(_)) => arguments.clone(),
        Some(_) => {
            return Err((
                INVALID_PARAMS,
                "tools/call params.arguments must be an object".to_string(),
            ))
        }
    };

    let result: CommandResult<Value> = if state.exposed(name) {
        let context = CommandContext::new().with_trace_id(format!("mcp-{}", uuid::Uuid::new_v4()));
        state.registry.execute(name, arguments, Some(context)).await
    } else {
        // Unknown and unexposed commands look the same from outside.
        let shown: String = name.chars().take(64).collect();
        failure(
            CommandError::new("COMMAND_NOT_FOUND", format!("Unknown tool: {shown}"))
                .with_suggestion("Call tools/list to see the available tools")
                .with_retryable(false),
        )
    };

    let text = serde_json::to_string(&result).map_err(|error| {
        (
            INTERNAL_ERROR,
            format!("Could not serialize the result: {error}"),
        )
    })?;
    Ok(json!({
        "content": [{ "type": "text", "text": text }],
        "isError": !result.success,
    }))
}

#[cfg(test)]
mod tests;
