//! MCP over HTTP.
//!
//! `POST /mcp` (and `POST /message`, which the web frontends use) is the MCP
//! Streamable HTTP endpoint of the `afd` crate's `server` feature: it serves
//! MCP 2026-07-28 statelessly (per-request `_meta`, `server/discover`, the
//! routing headers) and 2025 clients that send `initialize`. `GET` answers
//! 405. `GET /health` is a liveness check.
//!
//! Every request passes [`guard`] first: the `Host` header must name this
//! server (DNS rebinding) and a browser `Origin` must be on the allowlist
//! (`null` never is). Only commands with `expose.mcp` are listed or callable,
//! bodies are capped, and the server binds 127.0.0.1 unless `HOST` says
//! otherwise.

use crate::commands::Tool;
use afd::server::{ConfirmationMode, HttpOptions, McpServer, ToolStrategy};
use afd::CommandRegistry;
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::{
        header::{ACCEPT, CONTENT_TYPE, HOST, ORIGIN},
        HeaderName, HeaderValue, Method, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};

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
    /// Confirmation enforcement (`CONFIRMATIONS`: `off`, `enforce` or `require-human`; default
    /// `off`).
    pub confirmations: ConfirmationMode,
    /// How `tools/list` presents the commands (`TOOL_STRATEGY`: `grouped` or `individual`;
    /// default `grouped`). Every strategy routes every command by its own name.
    pub strategy: ToolStrategy,
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

        let confirmations = match var("CONFIRMATIONS").as_deref().map(str::trim) {
            None | Some("off") => ConfirmationMode::Off,
            Some("enforce") => ConfirmationMode::Enforce,
            Some("require-human") => ConfirmationMode::RequireHuman,
            Some(other) => {
                return Err(format!(
                    "CONFIRMATIONS must be off, enforce or require-human, got \"{other}\""
                ))
            }
        };

        let strategy = match var("TOOL_STRATEGY").as_deref().map(str::trim) {
            None | Some("grouped") => ToolStrategy::Grouped,
            Some("individual") => ToolStrategy::Individual,
            Some(other) => {
                return Err(format!(
                    "TOOL_STRATEGY must be grouped or individual, got \"{other}\""
                ))
            }
        };

        Ok(Self {
            host,
            port,
            max_body_bytes,
            confirmations,
            strategy,
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
    /// The MCP server over the registry, listing the tools with their schemas.
    pub mcp: McpServer,
    pub policy: HttpPolicy,
}

/// The MCP server for the todo registry, listing `tools` (which carry the
/// commands' full input schemas).
pub fn mcp_server(registry: CommandRegistry, tools: &[Tool]) -> Result<McpServer, String> {
    let tools = tools
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not describe the tools: {error}"))?;
    Ok(McpServer::new(
        Arc::new(registry),
        "todo-app-rust",
        env!("CARGO_PKG_VERSION"),
    )
    .with_tools(tools))
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
            HeaderName::from_static("mcp-method"),
            HeaderName::from_static("mcp-name"),
            HeaderName::from_static("mcp-session-id"),
        ])
        .max_age(Duration::from_secs(600));

    // The guard below already enforces the policy; the SDK applies it again.
    let mcp = state.mcp.streamable_http_service(HttpOptions {
        allowed_hosts: state.policy.allowed_hosts.clone(),
        allowed_origins: state.policy.allowed_origins.clone(),
        max_body_bytes,
    });

    // The last layer runs first: guard, then CORS (preflights), then the body limit.
    Ok(Router::new()
        .route("/health", get(health))
        .route_service("/mcp", mcp.clone())
        .route_service("/message", mcp)
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

#[cfg(test)]
mod tests;
