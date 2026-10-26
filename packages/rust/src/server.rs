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
//! [`McpServer::with_confirmations`] enforces `confirm_prompt` (see [`confirmations`]).
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

use crate::{
    failure, with_context_defaults, Actor, ActorKind, Clock, CommandContext, CommandError,
    CommandInterface, CommandRegistry, ContextDefaults, RandomSource,
};

/// The MCP revision served statelessly.
pub const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";

/// Default freshness hint of `tools/list` results (5 minutes).
pub const DEFAULT_TOOLS_LIST_TTL_MS: u64 = 300_000;

static TRACE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub mod confirmations;
pub use confirmations::{ConfirmationMode, AFD_CONFIRM_META_KEY};
use confirmations::{Decision, Gate};

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
    context_defaults: ContextDefaults,
    confirmations: Arc<Gate>,
    /// Whether a 2025 connection can receive server-sent requests (stdio: yes; the stateless
    /// Streamable HTTP service: no).
    legacy_back_channel: bool,
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
                context_defaults: ContextDefaults::new().with_actor(ActorKind::Agent),
                confirmations: Arc::new(
                    Gate::new(ConfirmationMode::Off, None)
                        .expect("the OS random source is available"),
                ),
                legacy_back_channel: true,
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
            context_defaults: shared.context_defaults.clone(),
            confirmations: Arc::clone(&shared.confirmations),
            legacy_back_channel: shared.legacy_back_channel,
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

    /// The actor on every tool call's context. Default: `{ kind: "agent" }`, reported as
    /// `metadata.actorKind`.
    pub fn with_actor(self, actor: impl Into<Actor>) -> Self {
        let actor = actor.into();
        self.with(|inner| inner.context_defaults.actor = Some(actor))
    }

    /// The clock on every tool call's context. Default: [`SYSTEM_CLOCK`](crate::SYSTEM_CLOCK).
    pub fn with_clock(self, clock: impl Clock + 'static) -> Self {
        let clock: Arc<dyn Clock> = Arc::new(clock);
        self.with(|inner| inner.context_defaults.clock = Some(clock))
    }

    /// The random source on every tool call's context. Default:
    /// [`SYSTEM_RANDOM`](crate::SYSTEM_RANDOM).
    pub fn with_random(self, random: impl RandomSource + 'static) -> Self {
        let random: Arc<dyn RandomSource> = Arc::new(random);
        self.with(|inner| inner.context_defaults.random = Some(random))
    }

    /// Enforce `confirm_prompt` (`spec/command-metadata.md`, "Confirmations"). Default:
    /// [`ConfirmationMode::Off`]. Under [`ConfirmationMode::Enforce`] a confirm-gated tool also
    /// advertises an optional `confirm` argument.
    ///
    /// # Panics
    /// When the OS random source that makes the per-process key is unavailable.
    pub fn with_confirmations(self, mode: ConfirmationMode) -> Self {
        let gate = Gate::new(mode, None).expect("the OS random source is available");
        self.with(|inner| inner.confirmations = Arc::new(gate))
    }

    /// Enforce `confirm_prompt` with `key` (at least 32 bytes) signing the confirmation
    /// `requestState`, shared by every instance behind one URL. Without a key each process
    /// uses a random one.
    ///
    /// # Errors
    /// The key is shorter than 32 bytes.
    pub fn with_confirmations_key(
        self,
        mode: ConfirmationMode,
        key: impl Into<Vec<u8>>,
    ) -> Result<Self, String> {
        let gate = Gate::new(mode, Some(key.into()))?;
        Ok(self.with(|inner| inner.confirmations = Arc::new(gate)))
    }

    /// Add the `confirm` acknowledgement to a confirm-gated tool under `Enforce`.
    fn with_confirm_argument(&self, mut tool: Value) -> Value {
        if self.inner.confirmations.mode != ConfirmationMode::Enforce
            || confirmations::declares_confirm(Some(&tool))
        {
            return tool;
        }
        let gated = tool["name"]
            .as_str()
            .and_then(|name| self.inner.registry.get(name))
            .is_some_and(|command| command.confirm_prompt.is_some());
        if gated {
            if let Some(schema) = tool["inputSchema"].as_object_mut() {
                let properties = schema
                    .entry("properties")
                    .or_insert_with(|| Value::Object(serde_json::Map::new()));
                if let Some(properties) = properties.as_object_mut() {
                    properties.insert("confirm".to_owned(), confirmations::confirm_property());
                }
            }
        }
        tool
    }

    fn exposed(&self, name: &str) -> bool {
        self.inner
            .registry
            .get(name)
            .is_some_and(|command| command.expose.mcp)
    }

    /// The listed tools: MCP-exposed commands, in registration order.
    pub fn tools(&self) -> Vec<Value> {
        let tools: Vec<Value> = match &self.inner.tools {
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
        };
        tools
            .into_iter()
            .map(|tool| self.with_confirm_argument(tool))
            .collect()
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
        // Stateless HTTP: a 2025 request cannot receive server-sent requests.
        let server = self.clone().with(|inner| inner.legacy_back_channel = false);
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
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let name = request.name.as_ref();
        let result = if self.exposed(name) {
            let gate = &self.inner.confirmations;
            let prompt = self
                .inner
                .registry
                .get(name)
                .and_then(|command| command.confirm_prompt.clone());
            let decision = match prompt {
                Some(prompt) if gate.mode != ConfirmationMode::Off => {
                    let tool = self.inner.registry.get_tool(name);
                    confirmations::check(
                        gate,
                        name,
                        &prompt,
                        tool.as_ref(),
                        &request,
                        &context,
                        self.inner.legacy_back_channel,
                    )
                    .await
                }
                _ => {
                    Decision::Proceed(Value::Object(request.arguments.clone().unwrap_or_default()))
                }
            };
            match decision {
                Decision::Ask(response) => return Ok(response),
                Decision::Refuse(error) => failure(error),
                Decision::Proceed(input) => {
                    let context = CommandContext::new()
                        .with_trace_id(Self::trace_id())
                        .with_interface(CommandInterface::Mcp);
                    let context = with_context_defaults(context, &self.inner.context_defaults);
                    self.inner
                        .registry
                        .execute(name, input, Some(context))
                        .await
                }
            }
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
