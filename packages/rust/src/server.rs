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
//! [`McpServer::with_tool_strategy`] chooses how `tools/list` presents the commands: grouped
//! (the default, as in TypeScript), individual, lazy or hybrid (see [`strategy`]); a hybrid server
//! also needs [`McpServer::with_first_class_tools`] and checks it when it starts serving
//! ([`McpServer::validate`]). Every strategy serves
//! the meta-tools `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` (see
//! [`meta_tools`]), and routes each through the same exposure, context and confirmation checks
//! and the same [`CommandRegistry::execute`] as a command's own tool, so the
//! registry's middleware, the approval middleware among them, wraps every execution.
//!
//! [`McpServer::with_contexts`] scopes commands by context ([`crate::contexts`]) and registers
//! `afd-context-list`, `afd-context-enter` and `afd-context-exit`. An MCP 2026-07-28 request
//! selects its context with `_meta["dev.afd/context"]` (stateless: the context tools never store
//! anything); a 2025 stdio connection keeps one context stack; a 2025 request over the
//! stateless Streamable HTTP endpoint has no session, so it has no active context and the
//! context tools return `SESSION_REQUIRED`.
//!
//! `afd-help` reports `toolStrategy` (and, on a hybrid server, `firstClassTools` and each
//! command's `firstClass`) when it runs behind this server. `tools/list` and `server/discover`
//! carry the same `ttlMs` and `cacheScope`, and `tools.listChanged` is `false`: no strategy sends
//! `notifications/tools/list_changed`.
//!
//! Every tool result on every route carries the whole result (a `CommandResult`, or the batch or
//! pipeline result) as `structuredContent` next to the JSON text. Under the individual strategy a
//! command with `returns` advertises a top-level `outputSchema`
//! ([`McpServer::with_advertise_output_schema`] switches that off), as TypeScript does.
//! [`McpServer::with_context_hook`] sets the per-request context (the actor) from the transport;
//! read [`context_hook`] before using it.
//!
//! The registry's declared context fields ([`CommandRegistry::set_context_fields`],
//! `spec/context-fields.md`) reach every `tools/call` from `params._meta[field.meta]`, on both
//! eras and both transports, into [`CommandContext::extra`] under the field's name; a name the
//! context hook set wins, undeclared `_meta` keys are dropped, and
//! [`CommandRegistry::execute`] validates each value (an invalid one is a `VALIDATION_ERROR`
//! tool result naming the field). They never change `tools/list`. `server/discover` lists them
//! under `_meta["dev.afd/context-fields"]`, and `afd-help` returns them as `contextFields`.
//!
//! A call's output budget ask (`spec/output-budgets.md`, B2) arrives the same way, in
//! `params._meta["dev.afd/outputBudget"]` as `{ "maxBytes": n }`, with the same precedence (an ask
//! the context hook set with [`CommandContext::with_output_budget_ask`] wins) and the same
//! `VALIDATION_ERROR` for an invalid one, for every command the call runs, each batch item and
//! each pipeline step. A command's declared budget is listed on its tool's
//! `_meta["dev.afd/outputBudget"]`, in grouped `_meta.actions` and in `afd-detail`; an ask never
//! changes `tools/list`.
//!
//! For clients that cannot set `_meta`, the five meta-tools take an optional `meta` argument
//! (`spec/context-fields.md`, "Clients that cannot set `_meta`"): its `dev.afd/context`,
//! `dev.afd/outputBudget` and declared field keys count as `_meta` for the whole call, the
//! context hook, the active context and the fields alike. Other keys are dropped; a key also in `_meta` with a different value, or
//! a `meta` that is not an object, is a `VALIDATION_ERROR` tool result.
//!
//! [`McpServer::with_confirmations`] enforces `confirm_prompt` (see [`confirmations`]).
//!
//! A panicking command handler is a `COMMAND_EXECUTION_ERROR` result on every route (the
//! registry catches it, so a batch item or pipeline step fails alone and the journal records
//! it). A panic in code outside the registry, such as a [`McpServer::with_group_by`] closure,
//! would otherwise end `rmcp`'s request task and leave the client waiting: the server guards
//! each request, and answers a generic `INTERNAL_ERROR` (a `-32603` error for `tools/list`) with
//! no panic message. Only unwinding panics are caught; with `panic = "abort"` the process aborts.
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

use std::sync::Arc;

use rmcp::model::{
    CacheScope, CallToolRequestParams, CallToolResponse, CustomRequest, CustomResult,
    DiscoverResult, ListResourceTemplatesResult, ListResourcesResult, ListToolsResult, MetaObject,
    PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResponse, ResourcesCapability,
    ServerCapabilities, ServerConfig, Tool, ToolsCapability,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde_json::{json, Value};

use crate::commands::ToolSurface;
use crate::context_fields::AFD_CONTEXT_FIELDS_META_KEY;
use crate::contexts::{ContextConfig, ContextScope, ContextStack, AFD_CONTEXT_META_KEY};
use crate::{
    with_context_defaults, Actor, ActorKind, Clock, CommandContext, CommandDefinition,
    CommandError, CommandInterface, CommandRegistry, ContextDefaults, RandomSource,
};

/// The MCP revision served statelessly.
pub const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";

/// The Skills extension's identifier (SEP-2640), declared in `capabilities.extensions`.
pub const SKILLS_EXTENSION_ID: &str = "io.modelcontextprotocol/skills";

/// Default freshness hint of `tools/list` results (5 minutes).
pub const DEFAULT_TOOLS_LIST_TTL_MS: u64 = 300_000;

pub mod confirmations;
pub mod context_hook;
mod encoding;
mod meta_argument;
pub mod meta_tools;
mod panic_guard;
mod resources;
mod router;
mod skills;
pub mod strategy;
mod structured;
use confirmations::Gate;
pub use confirmations::{ConfirmationMode, AFD_CONFIRM_META_KEY};
use context_hook::ContextHook;
pub use context_hook::ContextHookRequest;
pub use resources::{
    ResourceContents, ResourceEntry, ResourceProvider, ResourceReadError, DIGEST_META_KEY,
    MCP_APP_MIME_TYPE,
};
pub use skills::{Skill, SkillCatalog, MAX_SKILL_BYTES, MAX_SKILL_FILES};
pub use strategy::{GroupBy, ToolStrategy, MAX_FIRST_CLASS_TOOLS};

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
    tools_list_ttl_ms: Option<u64>,
    strategy: ToolStrategy,
    first_class_tools: Option<Arc<Vec<String>>>,
    group_by: Option<GroupBy>,
    contexts: Option<Arc<Vec<ContextConfig>>>,
    context_defaults: ContextDefaults,
    confirmations: Arc<Gate>,
    context_hook: Option<ContextHook>,
    advertise_output_schema: bool,
    resources: Option<Arc<dyn ResourceProvider>>,
    skills: Option<SkillCatalog>,
    /// Whether a 2025 connection can receive server-sent requests (stdio: yes; the stateless
    /// Streamable HTTP service: no).
    legacy_back_channel: bool,
}

/// An MCP server for the MCP-exposed commands of a [`CommandRegistry`].
///
/// Cloning is cheap: the HTTP service builds one handler per request from clones. Clones share
/// the context stack of a 2025 connection, so serve each connection from its own server (as
/// [`McpServer::serve_stdio`] does).
#[derive(Clone)]
pub struct McpServer {
    inner: Arc<Inner>,
    /// The context stack of a 2025 connection (stdio); `None` on stateless HTTP.
    session: Option<ContextStack>,
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
                tools_list_ttl_ms: None,
                strategy: ToolStrategy::default(),
                first_class_tools: None,
                group_by: None,
                contexts: None,
                context_defaults: ContextDefaults::new().with_actor(ActorKind::Agent),
                confirmations: Arc::new(
                    Gate::new(ConfirmationMode::Off, None)
                        .expect("the OS random source is available"),
                ),
                context_hook: None,
                advertise_output_schema: true,
                resources: None,
                skills: None,
                legacy_back_channel: true,
            }),
            session: Some(ContextStack::new()),
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
            strategy: shared.strategy,
            first_class_tools: shared.first_class_tools.clone(),
            group_by: shared.group_by.clone(),
            contexts: shared.contexts.clone(),
            context_defaults: shared.context_defaults.clone(),
            confirmations: Arc::clone(&shared.confirmations),
            context_hook: shared.context_hook.clone(),
            advertise_output_schema: shared.advertise_output_schema,
            resources: shared.resources.clone(),
            skills: shared.skills.clone(),
            legacy_back_channel: shared.legacy_back_channel,
        });
        change(&mut inner);
        Self {
            inner: Arc::new(inner),
            session: self.session,
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

    /// `ttlMs` freshness hint of `tools/list` and `server/discover` results (0 when the command
    /// set can change). Default: [`DEFAULT_TOOLS_LIST_TTL_MS`], or 0 with contexts, because
    /// `tools/list` then varies by `_meta["dev.afd/context"]`, which clients leave out of their
    /// cache key. A [`ToolStrategy::Hybrid`] list does not vary by context, so it keeps the
    /// default.
    pub fn with_tools_list_ttl_ms(self, ttl_ms: u64) -> Self {
        self.with(|inner| inner.tools_list_ttl_ms = Some(ttl_ms))
    }

    /// How `tools/list` presents the commands. Default: [`ToolStrategy::Grouped`], as in
    /// TypeScript. Every strategy routes every meta-tool and every command by its own name.
    ///
    /// [`ToolStrategy::Hybrid`] needs [`Self::with_first_class_tools`], and nothing else does.
    pub fn with_tool_strategy(self, strategy: ToolStrategy) -> Self {
        self.with(|inner| inner.strategy = strategy)
    }

    /// The commands a [`ToolStrategy::Hybrid`] server lists as their own tools, in list order
    /// (`spec/tool-strategies.md`, H1): at most [`MAX_FIRST_CLASS_TOOLS`], each registered and
    /// exposed to MCP, none a meta-tool or context tool, none repeated. Every other command is
    /// reached through `afd-discover`, `afd-detail`, `afd-call`, `afd-batch` and `afd-pipe`.
    ///
    /// The commands and contexts may be registered after this call, so the set is checked when
    /// the server starts serving (see [`Self::validate`]), not here.
    pub fn with_first_class_tools<I, S>(self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let names = Arc::new(names.into_iter().map(Into::into).collect::<Vec<String>>());
        self.with(|inner| inner.first_class_tools = Some(names))
    }

    /// Check the tool strategy's options against the registry (`spec/tool-strategies.md`, H2).
    ///
    /// [`Self::serve_stdio`] and [`Self::try_streamable_http_service`] call it before serving,
    /// and a request over any other transport fails with `-32603` carrying its message until it
    /// passes, so a misconfigured server never answers from a bad list. Call it yourself to
    /// fail at startup.
    ///
    /// # Errors
    /// The message names the offending option or entry. For resources: a provider entry that
    /// breaks a rule of `spec/mcp-resources.md` R2 (a bad or repeated `uri`, an empty `name`, a
    /// `skill://` entry, a `ui://` entry without the MCP Apps `mimeType`, a `size` that does not
    /// match the bytes, a `_meta` key the key rule refuses). For the tool strategy: a first-class set without the hybrid
    /// strategy, a hybrid server without one or with an empty one, and an entry that is not a
    /// registered command, is not exposed to MCP, is a meta-tool or context tool, repeats, or is
    /// beyond [`MAX_FIRST_CLASS_TOOLS`] (the first one beyond it).
    pub fn validate(&self) -> Result<(), String> {
        self.validate_strategy()?;
        self.validate_resources()
    }

    /// The tool strategy's checks alone, run on every tools request.
    fn validate_strategy(&self) -> Result<(), String> {
        strategy::validate_first_class(
            self.inner.strategy,
            self.inner
                .first_class_tools
                .as_ref()
                .map(|names| names.as_slice()),
            &self.inner.registry,
        )
    }

    /// Name the grouped tool of each command (default: its `category`, else the first segment
    /// of its name; `None` or an empty name is `general`).
    pub fn with_group_by(
        self,
        group_by: impl Fn(&CommandDefinition) -> Option<String> + Send + Sync + 'static,
    ) -> Self {
        let group_by: GroupBy = Arc::new(group_by);
        self.with(|inner| inner.group_by = Some(group_by))
    }

    /// Scope commands by these contexts and register `afd-context-list`, `afd-context-enter` and
    /// `afd-context-exit` into the registry (see the [module documentation](self)).
    ///
    /// # Errors
    /// No contexts, a blank or repeated name, or a registry that already has a command with a
    /// context command's name ([`crate::register_context_commands`]).
    pub fn with_contexts(self, contexts: Vec<ContextConfig>) -> Result<Self, String> {
        crate::register_context_commands(&self.inner.registry, contexts.clone())?;
        let contexts = Arc::new(contexts);
        Ok(self.with(|inner| inner.contexts = Some(contexts)))
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

    /// Advertise a top-level `outputSchema` on tools whose command declares `returns` (the
    /// `CommandResult` envelope with `data` typed by `returns`). Default: `true`. Only the
    /// individual strategy and the hybrid strategy's first-class tools are command tools;
    /// grouped and lazy tools carry no `outputSchema`, as in TypeScript. MCP clients
    /// validate each result's `structuredContent` against it, so a handler whose `data` does not
    /// match its `returns` fails on the client; pass `false` to leave `outputSchema` out, also
    /// from tools given to [`Self::with_tools`]. `structuredContent` is sent either way.
    pub fn with_advertise_output_schema(self, advertise: bool) -> Self {
        self.with(|inner| inner.advertise_output_schema = advertise)
    }

    /// Set the context every tool call runs with from the request itself (the actor, later
    /// credentials). The hook gets the request and the [`CommandContext`] being built and returns
    /// the context to use, or a [`CommandError`] that becomes the call's failed `CommandResult`.
    /// It replaces any hook set before.
    ///
    /// **The hook is trust-bearing and is not token verification**; read the security notes in
    /// [`context_hook`] first. In short: trust identity only from what a layer in front of the
    /// service verified, refuse by returning `Err` (nothing then runs, not even a confirmation
    /// prompt), and put nothing in the refusal you would not tell an unauthenticated caller.
    ///
    /// The hook runs once on every `tools/call` and every route (command and grouped tools, every
    /// meta-tool, unknown tools too), and again on each round of a confirmation flow; batch items
    /// and pipeline steps run with its context. The request's active context
    /// ([`Self::with_contexts`]) is applied after it, and the hook cannot set one. The request's
    /// declared context fields are added after it too, except a name the hook set, which wins.
    /// It does not run for `tools/list`, `server/discover` or `initialize`.
    pub fn with_context_hook<F, Fut>(self, hook: F) -> Self
    where
        F: Fn(ContextHookRequest, CommandContext) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<CommandContext, CommandError>> + Send + 'static,
    {
        let hook = context_hook::boxed(hook);
        self.with(|inner| inner.context_hook = Some(hook))
    }

    /// Serve a [`ResourceProvider`]'s entries through `resources/list` and `resources/read`
    /// (`spec/mcp-resources.md`, R1 to R6). The server then declares the `resources` capability
    /// (never `subscribe` or `listChanged`), answers `resources/templates/list` with an empty list
    /// and adds `dev.afd/digest` to every entry whose bytes the provider gives up front. The
    /// provider's entries are checked when the server starts serving ([`Self::validate`]) and each
    /// time they are listed. It replaces any provider set before.
    pub fn with_resources(self, provider: impl ResourceProvider + 'static) -> Self {
        let provider: Arc<dyn ResourceProvider> = Arc::new(provider);
        self.with(|inner| inner.resources = Some(provider))
    }

    /// Serve a [`SkillCatalog`] through the Skills extension, `io.modelcontextprotocol/skills`
    /// (`spec/mcp-resources.md`, S1 to S8): `skills/list`, `skills/get`, and every skill file as a
    /// resource, listed after the provider's entries. The server declares the extension and the
    /// `resources` capability. A catalog is checked when it is built, so this cannot fail. It
    /// replaces any catalog set before.
    pub fn with_skills(self, catalog: SkillCatalog) -> Self {
        self.with(|inner| inner.skills = Some(catalog))
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

    /// A command's tool as the individual strategy lists it: the `confirm` acknowledgement and
    /// the `outputSchema` included.
    fn individual_tool(&self, name: &str) -> Option<Value> {
        self.command_tool(name)
            .map(|tool| self.with_confirm_argument(tool))
            .map(|tool| self.with_output_schema(tool))
    }

    /// How this server lists its tools, for `afd-help`.
    pub(crate) fn tool_surface(&self) -> ToolSurface {
        ToolSurface {
            strategy: self.inner.strategy.as_str(),
            first_class_tools: (self.inner.strategy == ToolStrategy::Hybrid)
                .then(|| self.inner.first_class_tools.clone())
                .flatten(),
        }
    }

    /// The `ttlMs` of `tools/list` and `server/discover` results.
    fn tools_list_ttl_ms(&self) -> u64 {
        self.inner.tools_list_ttl_ms.unwrap_or(
            if self.inner.contexts.is_some() && self.inner.strategy != ToolStrategy::Hybrid {
                0
            } else {
                DEFAULT_TOOLS_LIST_TTL_MS
            },
        )
    }

    /// MCP-exposed commands, in registration order.
    fn exposed_commands(&self) -> Vec<Arc<CommandDefinition>> {
        self.inner
            .registry
            .list()
            .into_iter()
            .filter(|command| command.expose.mcp)
            .collect()
    }

    /// A command's tool: from [`McpServer::with_tools`] when it lists the command, else the
    /// registry's.
    fn command_tool(&self, name: &str) -> Option<Value> {
        self.inner
            .tools
            .as_ref()
            .and_then(|tools| tools.iter().find(|tool| tool["name"] == name).cloned())
            .or_else(|| self.inner.registry.get_tool(name))
    }

    /// The listed tools with no active context (see [`McpServer::with_tool_strategy`]).
    pub fn tools(&self) -> Vec<Value> {
        self.tools_in(None)
    }

    /// The listed tools while `active` is the active context.
    fn tools_in(&self, active: Option<&str>) -> Vec<Value> {
        let mut tools = Vec::new();
        if self.inner.strategy == ToolStrategy::Hybrid {
            return self.hybrid_tools();
        }
        if self.inner.strategy == ToolStrategy::Lazy {
            tools.push(meta_tools::discover_tool());
            tools.push(meta_tools::detail_tool());
            tools.extend(strategy::built_in_tools());
            return tools;
        }
        let in_context: Vec<Arc<CommandDefinition>> = self
            .exposed_commands()
            .into_iter()
            .filter(|command| command.is_accessible_in_context(active))
            .collect();
        tools.extend(strategy::built_in_tools());
        if self.inner.strategy == ToolStrategy::Individual {
            let listed: Vec<Value> = match &self.inner.tools {
                Some(defined) => defined
                    .iter()
                    .filter(|tool| {
                        in_context
                            .iter()
                            .any(|command| tool["name"] == command.name.as_str())
                    })
                    .cloned()
                    .collect(),
                None => in_context
                    .iter()
                    .filter_map(|command| self.inner.registry.get_tool(&command.name))
                    .collect(),
            };
            tools.extend(
                listed
                    .into_iter()
                    .map(|tool| self.with_confirm_argument(tool))
                    .map(|tool| self.with_output_schema(tool)),
            );
            return tools;
        }
        let enforce = self.inner.confirmations.mode == ConfirmationMode::Enforce;
        let listed: Vec<strategy::Listed> = in_context
            .into_iter()
            .map(|command| {
                let tool = self.command_tool(&command.name);
                let accepts_confirm = enforce
                    && command.confirm_prompt.is_some()
                    && !confirmations::declares_confirm(tool.as_ref());
                strategy::Listed {
                    command,
                    tool,
                    accepts_confirm,
                }
            })
            .collect();
        tools.push(meta_tools::detail_tool());
        tools.extend(strategy::grouped_tools(
            &listed,
            self.inner.group_by.as_ref(),
        ));
        tools
    }

    /// The hybrid list (`spec/tool-strategies.md`, H3): the meta-tools, the context tools when
    /// contexts are configured, then the first-class tools in configured order. It does not
    /// depend on the active context.
    fn hybrid_tools(&self) -> Vec<Value> {
        let mut tools = vec![
            meta_tools::discover_tool(),
            meta_tools::detail_tool(),
            meta_tools::call_tool(),
            meta_tools::batch_tool(),
            meta_tools::pipe_tool(),
        ];
        let context_tools: &[&str] = if self.inner.contexts.is_some() {
            crate::AFD_CONTEXT_COMMAND_NAMES
        } else {
            &[]
        };
        let first_class = self
            .inner
            .first_class_tools
            .as_deref()
            .map_or(&[][..], |names| names.as_slice());
        let names = context_tools
            .iter()
            .copied()
            .chain(first_class.iter().map(String::as_str));
        for name in names {
            let exposed = self
                .inner
                .registry
                .get(name)
                .is_some_and(|command| command.expose.mcp);
            if let Some(tool) = exposed.then(|| self.individual_tool(name)).flatten() {
                tools.push(tool);
            }
        }
        tools
    }

    /// The context command executions start from: interface `mcp`, the configured actor, clock
    /// and random source, and the remote flag (D4).
    fn base_context(&self) -> CommandContext {
        let mut context = CommandContext::new().with_interface(CommandInterface::Mcp);
        context.remote = true;
        with_context_defaults(context, &self.inner.context_defaults)
    }

    /// The context state of one request: none without contexts; on MCP 2026-07-28 the
    /// `_meta["dev.afd/context"]` context, for that request only; on a 2025 connection its
    /// stack, or no session over stateless HTTP.
    ///
    /// # Errors
    /// `-32602` for a `_meta` context the server does not configure.
    fn request_scope(
        &self,
        context: &RequestContext<RoleServer>,
    ) -> Result<Option<ContextScope>, ErrorData> {
        let Some(contexts) = &self.inner.contexts else {
            return Ok(None);
        };
        if !confirmations::is_modern(context) {
            return Ok(Some(match &self.session {
                Some(stack) => ContextScope::Session(stack.clone()),
                None => ContextScope::NoSession,
            }));
        }
        let requested = match context.meta.get(AFD_CONTEXT_META_KEY) {
            None => return Ok(Some(ContextScope::Request(None))),
            Some(requested) => requested,
        };
        match requested.as_str() {
            Some(name) if contexts.iter().any(|config| config.name == name) => {
                Ok(Some(ContextScope::Request(Some(name.to_owned()))))
            }
            _ => {
                let names: Vec<&str> = contexts.iter().map(|config| config.name.as_str()).collect();
                Err(ErrorData::invalid_params(
                    format!("Unknown context in _meta[\"{AFD_CONTEXT_META_KEY}\"]"),
                    Some(json!({ "suggestion": format!("Use one of: {}", names.join(", ")) })),
                ))
            }
        }
    }

    fn default_instructions(&self) -> String {
        let inner = &self.inner;
        let mut lines = vec![format!(
            "{} is an AFD server. Every tool returns a CommandResult as JSON text: \
             {{ success, data, error: {{ code, message, suggestion }} }}; follow \
             error.suggestion to recover.",
            inner.name
        )];
        lines.push(
            match inner.strategy {
                ToolStrategy::Lazy => "Call afd-discover to find commands, afd-detail for a command schema, and afd-call to run one.",
                ToolStrategy::Grouped => "Each tool groups related commands: pass { action, params }. afd-detail returns a command schema; afd-call runs any command by name.",
                ToolStrategy::Individual => "Each command is its own tool; afd-call also runs any command by name.",
                ToolStrategy::Hybrid => "The command tools listed are the common ones. Call afd-discover to find others, afd-detail for a schema, and afd-call to run one.",
            }
            .to_owned(),
        );
        lines.push(
            "Use afd-batch for several independent commands and afd-pipe to chain them.".to_owned(),
        );
        let bootstrap = crate::AFD_BOOTSTRAP_COMMAND_NAMES.iter().all(|name| {
            inner
                .registry
                .get(name)
                .is_some_and(|command| command.expose.mcp)
        });
        if bootstrap {
            lines.push("afd-help, afd-docs and afd-schema describe this server.".to_owned());
        }
        if inner.contexts.is_some() {
            lines.push(format!(
                "Commands are scoped by context (afd-context-list lists them). Send _meta[\"{AFD_CONTEXT_META_KEY}\"] with a context name on tools/list and tools/call to work in that context."
            ));
        }
        lines.join(" ")
    }

    /// Set (or, when switched off, remove) the top-level `outputSchema` of a listed tool.
    fn with_output_schema(&self, mut tool: Value) -> Value {
        let Some(object) = tool.as_object_mut() else {
            return tool;
        };
        if !self.inner.advertise_output_schema {
            object.remove("outputSchema");
        } else if !object.contains_key("outputSchema") {
            let schema = object
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| self.inner.registry.get(name))
                .and_then(|command| structured::output_schema(&command));
            if let Some(schema) = schema {
                object.insert("outputSchema".to_owned(), schema);
            }
        }
        tool
    }

    /// The Streamable HTTP endpoint as a `tower` service, for mounting in an HTTP server
    /// (for example `axum::Router::nest_service("/mcp", ...)`).
    ///
    /// # Panics
    /// When [`Self::validate`] fails. Use [`Self::try_streamable_http_service`] to handle that.
    pub fn streamable_http_service(
        &self,
        options: HttpOptions,
    ) -> StreamableHttpService<McpServer, LocalSessionManager> {
        self.try_streamable_http_service(options)
            .unwrap_or_else(|message| panic!("{message}"))
    }

    /// [`Self::streamable_http_service`], refusing to start when the tool strategy's options are
    /// invalid.
    ///
    /// # Errors
    /// [`Self::validate`]'s message.
    pub fn try_streamable_http_service(
        &self,
        options: HttpOptions,
    ) -> Result<StreamableHttpService<McpServer, LocalSessionManager>, String> {
        self.validate()?;
        let mut config = StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true)
            .with_max_request_body_bytes(options.max_body_bytes);
        config.allowed_hosts = options.allowed_hosts;
        config.allowed_origins = options.allowed_origins;
        let config = config.enforce_origin_validation_if_empty();
        // Stateless HTTP: a 2025 request cannot receive server-sent requests, and has no session
        // to hold a context stack.
        let mut server = self.clone().with(|inner| inner.legacy_back_channel = false);
        server.session = None;
        Ok(StreamableHttpService::new(
            move || Ok(server.clone()),
            Arc::new(LocalSessionManager::default()),
            config,
        ))
    }

    /// Serve MCP over the process's stdin and stdout until the client disconnects.
    ///
    /// # Errors
    /// Returns [`Self::validate`]'s message when the tool strategy's options are invalid, or the
    /// SDK error message when the connection cannot be established.
    pub async fn serve_stdio(self) -> Result<(), String> {
        self.validate()?;
        // One connection, one context stack.
        let server = Self {
            session: Some(ContextStack::new()),
            ..self
        };
        let service = server
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|error| format!("MCP stdio server failed to start: {error}"))?;
        service
            .waiting()
            .await
            .map(|_| ())
            .map_err(|error| format!("MCP stdio server stopped: {error}"))
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
        let mut capabilities = ServerCapabilities::builder().enable_tools().build();
        // No strategy sends `notifications/tools/list_changed`.
        capabilities.tools = Some({
            let mut tools = ToolsCapability::default();
            tools.list_changed = Some(false);
            tools
        });
        if self.serves_resources() {
            // No subscriptions and no list-changed notifications: AFD servers push nothing.
            capabilities.resources = Some(ResourcesCapability::default());
        }
        if let Some(catalog) = &self.inner.skills {
            let mut settings = serde_json::Map::new();
            if catalog.directory_read() {
                settings.insert("directoryRead".to_owned(), Value::Bool(true));
            }
            capabilities
                .extensions
                .get_or_insert_with(Default::default)
                .insert(SKILLS_EXTENSION_ID.to_owned(), settings);
        }
        let mut info = ServerConfig::new(capabilities);
        info.server_info.name = self.inner.name.clone();
        info.server_info.version = self.inner.version.clone();
        info.instructions = Some(
            self.inner
                .instructions
                .clone()
                .unwrap_or_else(|| self.default_instructions()),
        );
        info
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        panic_guard::guard_request(async {
            self.validate_strategy().map_err(internal)?;
            let active = self
                .request_scope(&context)?
                .and_then(|scope| scope.active());
            let tools: Vec<Tool> =
                serde_json::from_value(Value::Array(self.tools_in(active.as_deref())))
                    .map_err(internal)?;
            let ttl_ms = self.tools_list_ttl_ms();
            serde_json::from_value(json!({
                "resultType": "complete",
                "tools": tools,
                "ttlMs": ttl_ms,
                "cacheScope": "public",
            }))
            .map_err(internal)
        })
        .await
    }

    async fn discover(
        &self,
        _context: RequestContext<RoleServer>,
    ) -> Result<DiscoverResult, ErrorData> {
        self.validate_strategy().map_err(internal)?;
        let mut result = DiscoverResult::from_server_info(
            self.supported_protocol_versions().into_owned(),
            self.get_info(),
        )
        .with_ttl_ms(self.tools_list_ttl_ms())
        .with_cache_scope(CacheScope::Public);
        // The declared context fields (`spec/context-fields.md`, "Discovery"), next to the
        // `serverInfo` that `from_server_info` puts in `_meta`. Not in `initialize`, as in
        // TypeScript.
        let fields = self.inner.registry.context_fields();
        if !fields.is_empty() {
            let described = serde_json::to_value(fields).map_err(internal)?;
            result
                .meta
                .get_or_insert_with(MetaObject::new)
                .insert(AFD_CONTEXT_FIELDS_META_KEY.to_owned(), described);
        }
        Ok(result)
    }

    async fn list_resources(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        self.serve_list_resources(request, &context).await
    }

    async fn list_resource_templates(
        &self,
        request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        self.serve_list_resource_templates(request, &context).await
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        self.serve_read_resource(request, &context).await
    }

    async fn on_custom_request(
        &self,
        request: CustomRequest,
        context: RequestContext<RoleServer>,
    ) -> Result<CustomResult, ErrorData> {
        self.serve_custom_request(request, &context).await
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if let Err(message) = self.validate_strategy() {
            return Err(internal(message));
        }
        panic_guard::guard_call(router::route(self, &request, &context)).await
    }
}
