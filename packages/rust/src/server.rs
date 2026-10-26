//! MCP server for a [`CommandRegistry`] (feature `server`).
//!
//! Built on the official MCP Rust SDK (`rmcp`), which serves MCP 2026-07-28 statelessly
//! (per-request `_meta`, `server/discover`, the `MCP-Protocol-Version`, `Mcp-Method` and
//! `Mcp-Name` headers, `resultType`) and 2025 clients that open with `initialize`, on one
//! Streamable HTTP endpoint or one stdio connection.
//!
//! Only commands exposed to MCP (`expose.mcp`) are listed or callable. An unknown or
//! unexposed tool returns a `COMMAND_NOT_FOUND` `CommandResult` as the tool result, so private
//! commands are indistinguishable from missing ones (`spec/error-codes.md`, D4).
//!
//! This module covers the individual tool strategy only. Grouped and lazy strategies, the
//! meta-tools and context scoping remain in the parity plan (D1).
//!
//! ```no_run
//! # async fn run() -> Result<(), String> {
//! use std::sync::Arc;
//! use afd::{server::McpServer, CommandRegistry};
//!
//! let registry = Arc::new(CommandRegistry::new());
//! McpServer::new(registry, "my-app", "1.0.0").serve_stdio().await
//! # }
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde_json::{json, Value};

use crate::{failure, CommandContext, CommandError, CommandInterface, CommandRegistry};

/// The MCP revision served statelessly.
pub const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";

/// Default freshness hint of `tools/list` results (5 minutes).
pub const DEFAULT_TOOLS_LIST_TTL_MS: u64 = 300_000;

static TRACE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Origin, Host and body-size policy for [`McpServer::streamable_http_service`].
#[derive(Debug, Clone)]
pub struct HttpOptions {
    /// Accepted `Host` names (with or without a port). Default: loopback names.
    pub allowed_hosts: Vec<String>,
    /// Accepted browser `Origin` values (scheme, host and port). An `Origin` that is not
    /// listed is refused with 403; requests without one pass. Default: none.
    pub allowed_origins: Vec<String>,
    /// Largest request body in bytes. Default: 1 MiB.
    pub max_body_bytes: usize,
}

impl Default for HttpOptions {
    fn default() -> Self {
        Self {
            allowed_hosts: ["localhost", "127.0.0.1", "[::1]"]
                .into_iter()
                .map(str::to_string)
                .collect(),
            allowed_origins: Vec::new(),
            max_body_bytes: 1024 * 1024,
        }
    }
}

struct Inner {
    registry: Arc<CommandRegistry>,
    name: String,
    version: String,
    instructions: Option<String>,
    tools: Option<Vec<Value>>,
    tools_list_ttl_ms: u64,
}

/// An MCP server for the MCP-exposed commands of a [`CommandRegistry`].
///
/// Cloning is cheap: the HTTP service builds one handler per request from clones.
#[derive(Clone)]
pub struct McpServer {
    inner: Arc<Inner>,
}

impl McpServer {
    /// Serve `registry` as `name` / `version` (reported in `serverInfo`).
    pub fn new(
        registry: Arc<CommandRegistry>,
        name: impl Into<String>,
        version: impl Into<String>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                registry,
                name: name.into(),
                version: version.into(),
                instructions: None,
                tools: None,
                tools_list_ttl_ms: DEFAULT_TOOLS_LIST_TTL_MS,
            }),
        }
    }

    fn with(self, change: impl FnOnce(&mut Inner)) -> Self {
        let mut inner = Arc::try_unwrap(self.inner).unwrap_or_else(|shared| Inner {
            registry: Arc::clone(&shared.registry),
            name: shared.name.clone(),
            version: shared.version.clone(),
            instructions: shared.instructions.clone(),
            tools: shared.tools.clone(),
            tools_list_ttl_ms: shared.tools_list_ttl_ms,
        });
        change(&mut inner);
        Self {
            inner: Arc::new(inner),
        }
    }

    /// Guidance for agents, returned by `server/discover` and `initialize`. Default: a short
    /// description of the `CommandResult` envelope.
    pub fn with_instructions(self, instructions: impl Into<String>) -> Self {
        let instructions = instructions.into();
        self.with(|inner| inner.instructions = Some(instructions))
    }

    /// List these MCP tool definitions instead of the registry's (for example tools with full
    /// input schemas). Only tools whose command is exposed to MCP are listed.
    pub fn with_tools(self, tools: Vec<Value>) -> Self {
        self.with(|inner| inner.tools = Some(tools))
    }

    /// `ttlMs` freshness hint of `tools/list` results (0 when the command set can change).
    pub fn with_tools_list_ttl_ms(self, ttl_ms: u64) -> Self {
        self.with(|inner| inner.tools_list_ttl_ms = ttl_ms)
    }

    fn exposed(&self, name: &str) -> bool {
        self.inner
            .registry
            .get(name)
            .is_some_and(|command| command.expose.mcp)
    }

    /// The listed tools: MCP-exposed commands, in registration order.
    pub fn tools(&self) -> Vec<Value> {
        match &self.inner.tools {
            Some(tools) => tools
                .iter()
                .filter(|tool| tool["name"].as_str().is_some_and(|name| self.exposed(name)))
                .cloned()
                .collect(),
            None => self
                .inner
                .registry
                .list()
                .iter()
                .filter(|command| command.expose.mcp)
                .filter_map(|command| self.inner.registry.get_tool(&command.name))
                .collect(),
        }
    }

    /// The Streamable HTTP endpoint as a `tower` service, for mounting in an HTTP server
    /// (for example `axum::Router::nest_service("/mcp", ...)`).
    pub fn streamable_http_service(
        &self,
        options: HttpOptions,
    ) -> StreamableHttpService<McpServer, LocalSessionManager> {
        let mut config = StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true)
            .with_max_request_body_bytes(options.max_body_bytes);
        config.allowed_hosts = options.allowed_hosts;
        config.allowed_origins = options.allowed_origins;
        let config = config.enforce_origin_validation_if_empty();
        let server = self.clone();
        StreamableHttpService::new(
            move || Ok(server.clone()),
            Arc::new(LocalSessionManager::default()),
            config,
        )
    }

    /// Serve MCP over the process's stdin and stdout until the client disconnects.
    ///
    /// # Errors
    /// Returns the SDK error message when the connection cannot be established.
    pub async fn serve_stdio(self) -> Result<(), String> {
        let service = self
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|error| format!("MCP stdio server failed to start: {error}"))?;
        service
            .waiting()
            .await
            .map(|_| ())
            .map_err(|error| format!("MCP stdio server stopped: {error}"))
    }

    fn trace_id() -> String {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos());
        let count = TRACE_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("mcp-{nanos:x}-{count}")
    }
}

trait OriginValidation {
    fn enforce_origin_validation_if_empty(self) -> Self;
}

impl OriginValidation for StreamableHttpServerConfig {
    /// `rmcp` skips Origin validation when the allowlist is empty; an AFD server refuses any
    /// browser `Origin` it was not told about instead.
    fn enforce_origin_validation_if_empty(self) -> Self {
        if self.allowed_origins.is_empty() {
            self.enforce_origin_validation()
        } else {
            self
        }
    }
}

fn internal(error: impl std::fmt::Display) -> ErrorData {
    ErrorData::internal_error(error.to_string(), None)
}

impl ServerHandler for McpServer {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info.name = self.inner.name.clone();
        info.server_info.version = self.inner.version.clone();
        info.instructions = Some(self.inner.instructions.clone().unwrap_or_else(|| {
            format!(
                "{} is an AFD server. Every tool returns a CommandResult as JSON text: \
                 {{ success, data, error: {{ code, message, suggestion }} }}; follow \
                 error.suggestion to recover.",
                self.inner.name
            )
        }));
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let tools: Vec<Tool> =
            serde_json::from_value(Value::Array(self.tools())).map_err(internal)?;
        serde_json::from_value(json!({
            "resultType": "complete",
            "tools": tools,
            "ttlMs": self.inner.tools_list_ttl_ms,
            "cacheScope": "public",
        }))
        .map_err(internal)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let name = request.name.as_ref();
        let result = if self.exposed(name) {
            let mut context = CommandContext::new().with_trace_id(Self::trace_id());
            context.interface = Some(CommandInterface::Mcp);
            let input = Value::Object(request.arguments.unwrap_or_default());
            self.inner
                .registry
                .execute(name, input, Some(context))
                .await
        } else {
            // Unknown and unexposed commands look the same from outside.
            let shown: String = name.chars().take(64).collect();
            failure(
                CommandError::new("COMMAND_NOT_FOUND", format!("Unknown tool: {shown}"))
                    .with_suggestion("Call tools/list to see the available tools")
                    .with_retryable(false),
            )
        };
        let text = serde_json::to_string(&result).map_err(internal)?;
        let content = vec![ContentBlock::text(text)];
        Ok(if result.success {
            CallToolResult::success(content)
        } else {
            CallToolResult::error(content)
        }
        .into())
    }
}
