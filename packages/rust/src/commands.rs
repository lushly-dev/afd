//! Command definition and registry types.
//!
//! Commands are the core abstraction in AFD. Every application action
//! is defined as a command with a clear schema.

use async_trait::async_trait;
use futures_util::{stream::FuturesUnordered, FutureExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use crate::actor::{with_context_defaults, Actor, ContextDefaults};
use crate::approval::{approval_mode, ApprovalPolicy};
use crate::batch::{
    create_batch_result, create_failed_batch_result, BatchCommandResult, BatchRequest, BatchResult,
    BatchTiming,
};
use crate::clock::{Clock, RandomSource, SYSTEM_CLOCK, SYSTEM_RANDOM};
use crate::context_fields::{apply_context_fields, check_context_fields, ContextField};
use crate::errors::{error_codes, CommandError};
use crate::handoff::HandoffCommandLike;
use crate::journal::{JournalContextState, JournalRecorder};
use crate::result::{execution_failure, failure, CommandResult, ResultMetadata};
use crate::time::Instant;
use crate::validation::validate_input;

type BatchExecutionFuture<'a> =
    Pin<Box<dyn Future<Output = (usize, BatchCommandResult<serde_json::Value>)> + Send + 'a>>;

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND NAME VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

fn command_name_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$")
            .expect("command name regex should be valid")
    })
}

/// Validate that a command name follows the `domain-action` kebab-case convention.
pub fn validate_command_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Command name must not be empty".to_string());
    }

    if !command_name_pattern().is_match(name) {
        return Err(format!(
            "Command name '{name}' must use kebab-case with at least two segments (e.g., 'domain-action')."
        ));
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON SCHEMA TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// JSON Schema type for command parameter validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JsonSchemaType {
    String,
    Number,
    Boolean,
    Object,
    Array,
    Null,
    Integer,
}

/// JSON Schema subset for command parameter validation.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JsonSchema {
    /// The type of the value.
    #[serde(rename = "type")]
    pub schema_type: Option<JsonSchemaType>,

    /// Human-readable description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// For object schemas, required property names.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<Vec<String>>,

    /// Default value.
    #[serde(
        default,
        deserialize_with = "crate::schema_legacy::deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<serde_json::Value>,

    /// Allowed values (enum).
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<serde_json::Value>>,

    /// Schema for array items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Box<JsonSchema>>,

    /// Properties for object schemas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<HashMap<String, JsonSchema>>,

    /// Additional properties schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_properties: Option<Box<JsonSchema>>,

    /// Minimum value for numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,

    /// Maximum value for numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,

    /// Minimum length for strings/arrays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,

    /// Maximum length for strings/arrays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,

    /// Regex pattern for strings.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,

    /// Format hint (e.g., "date", "email").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND PARAMETER
// ═══════════════════════════════════════════════════════════════════════════════

/// Definition for a single command parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandParameter {
    /// Parameter name.
    pub name: String,

    /// JSON Schema type.
    #[serde(rename = "type")]
    pub param_type: JsonSchemaType,

    /// Human-readable description.
    pub description: String,

    /// Whether this parameter is required.
    #[serde(default)]
    pub required: bool,

    /// Default value if not provided.
    #[serde(
        default,
        deserialize_with = "crate::schema_legacy::deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<serde_json::Value>,

    /// For enum types, the allowed values.
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<serde_json::Value>>,

    /// Full JSON Schema for complex validation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<JsonSchema>,
}

impl CommandParameter {
    /// Create a new required string parameter.
    pub fn required_string(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::String,
            description: description.to_string(),
            required: true,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Create a new optional string parameter.
    pub fn optional_string(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::String,
            description: description.to_string(),
            required: false,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Create a new required number parameter.
    pub fn required_number(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::Number,
            description: description.to_string(),
            required: true,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Create a new required boolean parameter.
    pub fn required_boolean(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            param_type: JsonSchemaType::Boolean,
            description: description.to_string(),
            required: true,
            default: None,
            enum_values: None,
            schema: None,
        }
    }

    /// Set a default value.
    pub fn with_default(mut self, default: serde_json::Value) -> Self {
        self.default = Some(default);
        self
    }

    /// Set enum values.
    pub fn with_enum(mut self, values: Vec<serde_json::Value>) -> Self {
        self.enum_values = Some(values);
        self
    }
}

/// A concrete input example for a command.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandExample<T = serde_json::Value> {
    /// Short description of what this example demonstrates.
    pub title: String,

    /// A valid input payload.
    pub input: T,
}

impl<T> CommandExample<T> {
    /// Create a new command example.
    pub fn new(title: impl Into<String>, input: T) -> Self {
        Self {
            title: title.into(),
            input,
        }
    }
}

/// An interface that invokes commands. Each has a flag in [`ExposeOptions`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandInterface {
    /// Command palette (exposed by default).
    Palette,
    /// External MCP agents (opt-in).
    Mcp,
    /// In-app AI assistant (exposed by default).
    Agent,
    /// Terminal/CLI (opt-in).
    Cli,
}

impl CommandInterface {
    /// The interface name, as used for the `expose` keys.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Palette => "palette",
            Self::Mcp => "mcp",
            Self::Agent => "agent",
            Self::Cli => "cli",
        }
    }
}

impl fmt::Display for CommandInterface {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Controls which interfaces a command is exposed to.
///
/// A flag that is left out takes its own default, as in TypeScript's
/// `isExposedTo`: `palette` and `agent` default to `true`, `mcp` and `cli` to
/// `false`. So `{"mcp": true}` deserializes to palette, agent and MCP
/// exposure, the same as `ExposeOptions::new().with_mcp(true)`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExposeOptions {
    /// Command palette (default `true`).
    #[serde(default = "default_true")]
    pub palette: bool,
    /// External MCP agents (default `false`: opt in).
    #[serde(default = "default_false")]
    pub mcp: bool,
    /// In-app AI assistant (default `true`).
    #[serde(default = "default_true")]
    pub agent: bool,
    /// Terminal/CLI (default `false`: opt in).
    #[serde(default = "default_false")]
    pub cli: bool,
}

impl ExposeOptions {
    /// The default exposure: palette and agent, not MCP or CLI.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set palette exposure.
    pub fn with_palette(mut self, exposed: bool) -> Self {
        self.palette = exposed;
        self
    }

    /// Set MCP exposure.
    pub fn with_mcp(mut self, exposed: bool) -> Self {
        self.mcp = exposed;
        self
    }

    /// Set in-app agent exposure.
    pub fn with_agent(mut self, exposed: bool) -> Self {
        self.agent = exposed;
        self
    }

    /// Set CLI exposure.
    pub fn with_cli(mut self, exposed: bool) -> Self {
        self.cli = exposed;
        self
    }

    /// Whether these options expose a command to `interface`.
    pub fn is_exposed_to(&self, interface: CommandInterface) -> bool {
        match interface {
            CommandInterface::Palette => self.palette,
            CommandInterface::Mcp => self.mcp,
            CommandInterface::Agent => self.agent,
            CommandInterface::Cli => self.cli,
        }
    }
}

const fn default_true() -> bool {
    true
}

const fn default_false() -> bool {
    false
}

impl Default for ExposeOptions {
    fn default() -> Self {
        Self {
            palette: true,
            mcp: false,
            agent: true,
            cli: false,
        }
    }
}

/// Return the default command exposure configuration.
pub fn default_expose() -> ExposeOptions {
    ExposeOptions::default()
}

/// Whether `command` is exposed to `interface` (TypeScript `isExposedTo`).
pub fn is_exposed_to(command: &CommandDefinition, interface: CommandInterface) -> bool {
    command.expose.is_exposed_to(interface)
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/// How an MCP server lists its tools, for `afd-help` (`spec/tool-strategies.md`, H8). Only the
/// MCP server sets it, so `afd-help` run in process reports none of it.
#[derive(Clone, Debug)]
pub(crate) struct ToolSurface {
    pub(crate) strategy: &'static str,
    /// The first-class tool names in list order, on a hybrid server.
    pub(crate) first_class_tools: Option<Arc<Vec<String>>>,
}

/// Context provided to command handlers.
///
/// Build it with [`CommandContext::new`] and the `with_*` methods.
#[derive(Clone, Default)]
#[non_exhaustive]
pub struct CommandContext {
    /// Unique ID for this command invocation.
    pub trace_id: Option<String>,

    /// Deadline for the command in milliseconds.
    ///
    /// [`CommandRegistry::execute`] enforces it with `tokio::time::timeout`
    /// (the `native` feature, inside a Tokio runtime with time enabled) and
    /// returns `TIMEOUT` when it passes. Without `native`, a context with a
    /// timeout is rejected with `UNSUPPORTED_OPTION` before the handler runs.
    pub timeout_ms: Option<u64>,

    /// The interface invoking the command.
    ///
    /// When set, [`CommandRegistry::execute`] rejects commands that are not
    /// exposed to it with `COMMAND_NOT_EXPOSED`. Leave it unset for trusted
    /// in-process calls.
    pub interface: Option<CommandInterface>,

    /// Who is calling: a human, an agent, a service, a script or a test.
    ///
    /// The MCP server (feature `server`) sets `agent` unless configured otherwise. When it is
    /// set, [`CommandRegistry::execute`] reports its kind as `metadata.actorKind` on the
    /// handler's result (never the id).
    pub actor: Option<Actor>,

    /// Approval evidence for a command whose approval policy requires it: the
    /// `details.approvalToken` of an `APPROVAL_REQUIRED` result, set by the surface once a human
    /// approved (`spec/command-metadata.md`, "Approvals"). Only trusted surface code sets it,
    /// never tool arguments: whoever holds a valid token can run the call. The MCP server never
    /// sets it.
    pub approval: Option<String>,

    /// Source of the current time. Read time from [`CommandContext::clock`] instead of the
    /// system time so tests and replays can control it.
    ///
    /// [`CommandRegistry::execute`] always sets it for the handler (to
    /// [`SYSTEM_CLOCK`] unless the caller set one).
    pub clock: Option<Arc<dyn Clock>>,

    /// Source of randomness. Read random numbers from [`CommandContext::random`] so tests
    /// and replays can seed them.
    ///
    /// [`CommandRegistry::execute`] always sets it for the handler (to
    /// [`SYSTEM_RANDOM`] unless the caller set one).
    pub random: Option<Arc<dyn RandomSource>>,

    /// Custom context values.
    pub extra: HashMap<String, serde_json::Value>,

    /// What a journal recorder and replay pass to nested calls.
    pub(crate) journal_state: JournalContextState,
    pub(crate) direct_approval: Option<Arc<std::sync::Mutex<crate::direct::Exchange>>>,
    /// The active-context state: a session stack, one request's context, or no session.
    pub(crate) context_scope: Option<crate::contexts::ContextScope>,
    /// A remote MCP caller: an unexposed command looks unknown, and recovery points to
    /// `afd-discover` (`spec/error-codes.md`, D4). Only the MCP server sets it.
    pub(crate) remote: bool,
    /// How the MCP server lists its tools: read by `afd-help`. Only the MCP server sets it.
    pub(crate) tool_surface: Option<ToolSurface>,
}

impl fmt::Debug for CommandContext {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CommandContext")
            .field("trace_id", &self.trace_id)
            .field("timeout_ms", &self.timeout_ms)
            .field("interface", &self.interface)
            .field("actor", &self.actor)
            // An approval token is a credential: never print it.
            .field("approval", &self.approval.as_ref().map(|_| "[redacted]"))
            .field("clock", &self.clock.as_ref().map(|_| ".."))
            .field("random", &self.random.as_ref().map(|_| ".."))
            .field("extra", &self.extra)
            .field("journal_state", &self.journal_state)
            .field("context_scope", &self.context_scope)
            .field("tool_surface", &self.tool_surface)
            .finish()
    }
}

impl CommandContext {
    /// Create an empty context.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the trace ID.
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Set the deadline in milliseconds.
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
        self
    }

    /// Set the invoking interface, which turns on exposure checks.
    pub fn with_interface(mut self, interface: CommandInterface) -> Self {
        self.interface = Some(interface);
        self
    }

    /// Set the calling actor.
    pub fn with_actor(mut self, actor: impl Into<Actor>) -> Self {
        self.actor = Some(actor.into());
        self
    }

    /// Set the approval evidence: a token a human approved. Trusted surface code only.
    pub fn with_approval(mut self, token: impl Into<String>) -> Self {
        self.approval = Some(token.into());
        self
    }

    /// Set the clock, for example a [`fixed_clock`](crate::fixed_clock).
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }

    /// Set the random source, for example a [`seeded_random`](crate::seeded_random).
    pub fn with_random(mut self, random: impl RandomSource + 'static) -> Self {
        self.random = Some(Arc::new(random));
        self
    }

    /// The context's clock, or [`SYSTEM_CLOCK`] when it has none.
    pub fn clock(&self) -> &dyn Clock {
        match &self.clock {
            Some(clock) => clock.as_ref(),
            None => &SYSTEM_CLOCK,
        }
    }

    /// The context's random source, or [`SYSTEM_RANDOM`] when it has none.
    pub fn random(&self) -> &dyn RandomSource {
        match &self.random {
            Some(random) => random.as_ref(),
            None => &SYSTEM_RANDOM,
        }
    }

    /// Run with `context` active, for this call only: commands outside it return
    /// `COMMAND_NOT_IN_CONTEXT`, and `afd-context-enter` and `afd-context-exit` report that
    /// nothing persists (see [`crate::contexts`]).
    pub fn with_active_context(mut self, context: impl Into<String>) -> Self {
        self.context_scope = Some(crate::contexts::ContextScope::Request(Some(context.into())));
        self
    }

    /// Run in the session whose contexts `stack` holds: its top is the active context, and
    /// `afd-context-enter` and `afd-context-exit` change it (see [`crate::contexts`]).
    pub fn with_context_stack(mut self, stack: crate::contexts::ContextStack) -> Self {
        self.context_scope = Some(crate::contexts::ContextScope::Session(stack));
        self
    }

    /// The active context, if any.
    pub fn active_context(&self) -> Option<String> {
        self.context_scope
            .as_ref()
            .and_then(crate::contexts::ContextScope::active)
    }

    /// Add a custom context value.
    pub fn with_extra(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.extra.insert(key.into(), value);
        self
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION TIME ESTIMATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Estimated execution time category.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionTime {
    /// < 100ms
    Instant,
    /// 100ms - 1s
    Fast,
    /// 1s - 10s
    Slow,
    /// > 10s
    LongRunning,
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

/// A boxed, `Send` future, as returned by middleware.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Runs the rest of the middleware chain and then the handler.
pub type MiddlewareNext =
    Arc<dyn Fn() -> BoxFuture<'static, CommandResult<serde_json::Value>> + Send + Sync>;

/// Middleware that wraps command execution, added with
/// [`CommandRegistry::add_middleware`].
///
/// It receives the command name, the validated input, the context and `next`,
/// and returns the result: usually `next().await`, possibly inspected or
/// replaced.
///
/// # Example
///
/// ```rust
/// use afd::{CommandMiddleware, CommandRegistry};
/// use std::sync::Arc;
///
/// let logging: CommandMiddleware = Arc::new(|name, _input, _context, next| {
///     Box::pin(async move {
///         let result = next().await;
///         println!("{name}: success={}", result.success);
///         result
///     })
/// });
///
/// let registry = CommandRegistry::new();
/// registry.add_middleware(logging);
/// ```
pub type CommandMiddleware = Arc<
    dyn Fn(
            String,
            serde_json::Value,
            CommandContext,
            MiddlewareNext,
        ) -> BoxFuture<'static, CommandResult<serde_json::Value>>
        + Send
        + Sync,
>;

/// Trait for command handlers.
#[async_trait]
pub trait CommandHandler: Send + Sync {
    /// Execute the command with the given input.
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value>;
}

/// Full command definition with schema, handler, and metadata.
pub struct CommandDefinition {
    /// Unique command name using kebab-case (e.g., 'document-create').
    pub name: String,

    /// Human-readable description.
    pub description: String,

    /// A short human-readable label (`spec/command-metadata.md`, "Tool titles"): the MCP tool
    /// `title` of the command's own tool, and reported by `afd-detail` and `afd-help` (`full`).
    /// Display text, so never in `_meta`. `None` is unset; nothing is derived from the name.
    pub title: Option<String>,

    /// Category for grouping related commands.
    pub category: Option<String>,

    /// Command parameters with types and descriptions.
    pub parameters: Vec<CommandParameter>,

    /// Schema describing the return type.
    pub returns: Option<JsonSchema>,

    /// Error codes this command may return.
    pub errors: Option<Vec<String>>,

    /// Whether this is a handoff command.
    pub handoff: bool,

    /// Protocol for handoff commands (websocket, webrtc, sse, http-stream).
    pub handoff_protocol: Option<String>,

    /// The command handler.
    handler: Arc<dyn CommandHandler>,

    /// Command version.
    pub version: Option<String>,

    /// Tags for categorization.
    pub tags: Option<Vec<String>>,

    /// Commands that should be called before this one.
    ///
    /// Metadata only: the registry does not enforce it. `afd-help` lists it.
    pub requires: Option<Vec<String>>,

    /// Contexts this command belongs to.
    ///
    /// [`CommandRegistry::execute`] runs the command only when no context is
    /// active or one of these is ([`CommandDefinition::is_accessible_in_context`];
    /// see [`crate::contexts`]).
    pub contexts: Option<Vec<String>>,

    /// Whether this command performs side effects.
    pub mutation: bool,

    /// Estimated execution time.
    pub execution_time: Option<ExecutionTime>,

    /// Which interfaces this command is exposed to.
    pub expose: ExposeOptions,

    /// Concrete input examples to help agents construct valid payloads.
    pub examples: Option<Vec<CommandExample>>,

    /// Whether the command's effects are hard to reverse. `None` is unset.
    pub destructive: Option<bool>,

    /// The question a frontend asks before running the command. A server may enforce it
    /// (`spec/command-metadata.md`, "Confirmations").
    pub confirm_prompt: Option<String>,

    /// Whether the command's effects can be undone. `None` is unset.
    pub undoable: Option<bool>,

    /// Whether a call needs a human's approval before the handler runs. `None` is unset
    /// (`not-required`). Enforced by the approval middleware; reported as `_meta.approval`.
    pub approval: Option<ApprovalPolicy>,
}

impl CommandDefinition {
    /// Create a new command definition.
    pub fn new<H: CommandHandler + 'static>(
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: Vec<CommandParameter>,
        handler: H,
    ) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            title: None,
            category: None,
            parameters,
            returns: None,
            errors: None,
            handoff: false,
            handoff_protocol: None,
            handler: Arc::new(handler),
            version: None,
            tags: None,
            requires: None,
            contexts: None,
            mutation: false,
            execution_time: None,
            expose: default_expose(),
            examples: None,
            destructive: None,
            confirm_prompt: None,
            undoable: None,
            approval: None,
        }
    }

    /// Set the display label, reported as the MCP tool `title`.
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Set the category.
    pub fn with_category(mut self, category: impl Into<String>) -> Self {
        self.category = Some(category.into());
        self
    }

    /// Set the return schema.
    pub fn with_returns(mut self, returns: JsonSchema) -> Self {
        self.returns = Some(returns);
        self
    }

    /// Mark as mutation.
    pub fn as_mutation(mut self) -> Self {
        self.mutation = true;
        self
    }

    /// Declare whether the command's effects are hard to reverse.
    pub fn with_destructive(mut self, destructive: bool) -> Self {
        self.destructive = Some(destructive);
        self
    }

    /// Set the question to ask before running the command.
    pub fn with_confirm_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.confirm_prompt = Some(prompt.into());
        self
    }

    /// Set the approval policy: [`ApprovalPolicy::Required`], [`ApprovalPolicy::NotRequired`],
    /// an [`ApprovalDecision`](crate::ApprovalDecision), or a function
    /// ([`ApprovalPolicy::when`]). Enforced by the approval middleware.
    pub fn with_approval(mut self, approval: impl Into<ApprovalPolicy>) -> Self {
        self.approval = Some(approval.into());
        self
    }

    /// Declare whether the command's effects can be undone.
    pub fn with_undoable(mut self, undoable: bool) -> Self {
        self.undoable = Some(undoable);
        self
    }

    /// Set execution time estimate.
    pub fn with_execution_time(mut self, time: ExecutionTime) -> Self {
        self.execution_time = Some(time);
        self
    }

    /// Set tags for categorization.
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = Some(tags);
        self
    }

    /// Set the version for this command.
    pub fn with_version(mut self, version: impl Into<String>) -> Self {
        self.version = Some(version.into());
        self
    }

    /// Set the commands that should be called before this one (metadata only).
    pub fn with_requires<I, S>(mut self, requires: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.requires = Some(requires.into_iter().map(Into::into).collect());
        self
    }

    /// Set the contexts this command belongs to (see [`crate::contexts`]).
    pub fn with_contexts<I, S>(mut self, contexts: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.contexts = Some(contexts.into_iter().map(Into::into).collect());
        self
    }

    /// Whether this command is available while `active_context` is active.
    ///
    /// As in TypeScript: every command is available when no context is
    /// active, and a command without `contexts` is available in every context.
    pub fn is_accessible_in_context(&self, active_context: Option<&str>) -> bool {
        match (active_context, self.contexts.as_deref()) {
            (None, _) | (_, None | Some([])) => true,
            (Some(active), Some(contexts)) => contexts.iter().any(|context| context == active),
        }
    }

    /// Set the command exposure configuration.
    pub fn with_expose(mut self, expose: ExposeOptions) -> Self {
        self.expose = expose;
        self
    }

    /// Set concrete command examples.
    pub fn with_examples(mut self, examples: Vec<CommandExample>) -> Self {
        self.examples = Some(examples);
        self
    }

    /// Mark as a handoff command.
    pub fn as_handoff(mut self) -> Self {
        self.handoff = true;
        self
    }

    /// Mark as a handoff command with a specific protocol.
    pub fn as_handoff_with_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.handoff = true;
        self.handoff_protocol = Some(protocol.into());
        self
    }

    /// Call the command's handler directly.
    ///
    /// This skips everything [`CommandRegistry::execute`] enforces: input
    /// validation, parameter defaults, exposure, the timeout and middleware.
    pub async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        self.handler.execute(input, context).await
    }
}

impl HandoffCommandLike for CommandDefinition {
    fn is_handoff(&self) -> bool {
        self.handoff
    }

    fn handoff_protocol(&self) -> Option<&str> {
        self.handoff_protocol.as_deref()
    }

    fn tags(&self) -> Option<&[String]> {
        self.tags.as_deref()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

/// Registry for managing and executing command definitions.
///
/// Registration takes `&self` (the registry uses interior mutability), so a
/// registry shared as `Arc<CommandRegistry>` can still gain commands, such as
/// the bootstrap commands that describe it
/// ([`register_bootstrap_commands`](crate::bootstrap::register_bootstrap_commands)).
/// [`CommandRegistry::list`] returns commands in registration order.
///
/// [`CommandRegistry::execute`] enforces each command's metadata; see its
/// documentation.
#[derive(Default)]
pub struct CommandRegistry {
    commands: RwLock<RegisteredCommands>,
    middleware: RwLock<Vec<CommandMiddleware>>,
    journal: RwLock<Option<Arc<JournalRecorder>>>,
    context_fields: RwLock<Arc<Vec<ContextField>>>,
}

/// Commands by name, plus their registration order.
#[derive(Default)]
struct RegisteredCommands {
    by_name: HashMap<String, Arc<CommandDefinition>>,
    ordered: Vec<Arc<CommandDefinition>>,
    schemas: HashMap<String, serde_json::Value>,
}

/// Read a lock, ignoring poisoning: no registry invariant spans a panic.
fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

impl CommandRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a command.
    ///
    /// # Errors
    /// Returns an error if the name is not `domain-action` kebab-case or a
    /// command with the same name already exists.
    pub fn register(&self, command: CommandDefinition) -> Result<(), String> {
        validate_command_name(&command.name)?;
        for parameter in &command.parameters {
            if let Some(schema) = &parameter.schema {
                crate::validation::validate_schema_definition(
                    schema,
                    &format!("#/properties/{}", parameter.name),
                )?;
            }
        }

        let mut commands = write_lock(&self.commands);
        if commands.by_name.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        let command = Arc::new(command);
        commands
            .by_name
            .insert(command.name.clone(), Arc::clone(&command));
        commands.ordered.push(command);
        Ok(())
    }

    /// Register a whole input JSON Schema without converting it to legacy parameters.
    /// Unsupported keywords fail registration. Use [`Self::get_tool`] to export this schema.
    pub fn register_with_schema(
        &self,
        command: CommandDefinition,
        schema: serde_json::Value,
    ) -> Result<(), String> {
        crate::schema_validation::compile(&schema)?;
        validate_command_name(&command.name)?;
        let mut commands = write_lock(&self.commands);
        if commands.by_name.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        commands.schemas.insert(command.name.clone(), schema);
        let command = Arc::new(command);
        commands
            .by_name
            .insert(command.name.clone(), Arc::clone(&command));
        commands.ordered.push(command);
        Ok(())
    }

    /// Export the authoritative MCP tool, including any whole schema registered with it.
    ///
    /// The tool carries the command's `title` only when it sets one.
    ///
    /// A command with `mutation: true` also carries MCP `annotations`
    /// (`readOnlyHint: false`, `destructiveHint` from `destructive`; `spec/command-metadata.md`). `mutation`
    /// has no unset state here, so a non-mutating command claims nothing.
    pub fn get_tool(&self, name: &str) -> Option<serde_json::Value> {
        let commands = read_lock(&self.commands);
        let command = commands.by_name.get(name)?;
        let mut tool = serde_json::to_value(command_to_mcp_tool(command)).expect("tool serializes");
        if let Some(schema) = commands.schemas.get(name) {
            tool["inputSchema"] = schema.clone();
        }
        if let Some(annotations) = command_tool_annotations(command) {
            tool["annotations"] = annotations;
        }
        if let Some(approval) = approval_mode(command.approval.as_ref()) {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["approval"] = serde_json::json!(approval);
        }
        Some(tool)
    }

    /// Add a middleware to the chain that wraps every command execution.
    ///
    /// Middleware runs in the order it was added (the first added is the
    /// outermost), after input validation, with the validated input. Each one
    /// calls `next()` to run the rest of the chain and can inspect or replace
    /// the result, or return without calling `next()` to short-circuit.
    pub fn add_middleware(&self, middleware: CommandMiddleware) {
        write_lock(&self.middleware).push(middleware);
    }

    /// Record every accepted call to a journal (`spec/journal.md`), replacing any recorder set
    /// before.
    ///
    /// The recorder runs after input validation and around the middleware chain; see
    /// [`JournalRecorder`]. Replay with [`replay_journal`](crate::replay_journal).
    pub fn set_journal(&self, recorder: JournalRecorder) {
        *write_lock(&self.journal) = Some(Arc::new(recorder));
    }

    /// Stop recording to the journal set with [`Self::set_journal`].
    pub fn clear_journal(&self) {
        *write_lock(&self.journal) = None;
    }

    /// Declare the request values calls may carry (`spec/context-fields.md`), replacing any
    /// declared before; an empty list removes them.
    ///
    /// A call carries its value for a field in [`CommandContext::extra`] under the field's name.
    /// [`Self::execute`] validates it after the input and before the middleware and the handler,
    /// and gives them the schema's output. An invalid value, or a missing required one, fails
    /// the call with `VALIDATION_ERROR`. A journal recorder keeps the values of the fields
    /// declared `journal: true`, and [`replay_journal`](crate::replay_journal) restores them;
    /// see [`crate::context_fields`]. The MCP server (feature `server`) reads the values from
    /// each `tools/call`'s `_meta` and lists the fields in `server/discover`; `afd-help` returns
    /// them as `contextFields`.
    ///
    /// # Errors
    /// Returns a message naming the field, and keeps the previous declarations, for an empty,
    /// reserved or repeated name, a `meta` key without a reverse-DNS prefix, with a reserved
    /// prefix (`dev.afd/`, or a label `mcp` or `modelcontextprotocol`) or repeated, or a schema
    /// outside the subset [`Self::register_with_schema`] supports.
    pub fn set_context_fields(
        &self,
        fields: impl IntoIterator<Item = ContextField>,
    ) -> Result<(), String> {
        let fields: Vec<ContextField> = fields.into_iter().collect();
        check_context_fields(&fields)?;
        *write_lock(&self.context_fields) = Arc::new(fields);
        Ok(())
    }

    /// The context fields declared with [`Self::set_context_fields`], in declaration order.
    pub fn context_fields(&self) -> Vec<ContextField> {
        read_lock(&self.context_fields).as_ref().clone()
    }

    /// Get a command by name.
    pub fn get(&self, name: &str) -> Option<Arc<CommandDefinition>> {
        read_lock(&self.commands).by_name.get(name).cloned()
    }

    /// Check if a command exists.
    pub fn has(&self, name: &str) -> bool {
        read_lock(&self.commands).by_name.contains_key(name)
    }

    /// Get all registered commands, in registration order.
    pub fn list(&self) -> Vec<Arc<CommandDefinition>> {
        read_lock(&self.commands).ordered.clone()
    }

    fn list_where(&self, keep: impl Fn(&CommandDefinition) -> bool) -> Vec<Arc<CommandDefinition>> {
        read_lock(&self.commands)
            .ordered
            .iter()
            .filter(|command| keep(command))
            .cloned()
            .collect()
    }

    /// Get commands by category.
    pub fn list_by_category(&self, category: &str) -> Vec<Arc<CommandDefinition>> {
        self.list_where(|command| command.category.as_deref() == Some(category))
    }

    /// Get the commands exposed to `interface`.
    pub fn list_by_exposure(&self, interface: CommandInterface) -> Vec<Arc<CommandDefinition>> {
        self.list_where(|command| command.expose.is_exposed_to(interface))
    }

    /// Get all handoff commands.
    pub fn list_handoff_commands(&self) -> Vec<Arc<CommandDefinition>> {
        self.list_where(crate::handoff::is_handoff_command)
    }

    /// Execute a command by name, enforcing its metadata.
    ///
    /// In order:
    ///
    /// 1. An unknown name returns `COMMAND_NOT_FOUND`. Its suggestion names up
    ///    to three close matches, as in TypeScript, chosen among the commands
    ///    exposed to `context.interface` (all commands when it is unset) and
    ///    available in the active context, and points to `afd-help` when that
    ///    is one of them (`afd-discover` for the MCP server's calls).
    /// 2. When `context.interface` is set, a command not exposed to that
    ///    interface returns `COMMAND_NOT_EXPOSED` (see [`ExposeOptions`]); the
    ///    MCP server's calls get `COMMAND_NOT_FOUND` instead, as for an unknown
    ///    name.
    /// 3. With an active context ([`CommandContext::active_context`]), a
    ///    command outside it returns `COMMAND_NOT_IN_CONTEXT` (see
    ///    [`crate::contexts`]).
    /// 4. A `context.timeout_ms` without the `native` feature returns
    ///    `UNSUPPORTED_OPTION`.
    /// 5. The input is validated against the command's `parameters`, parameter
    ///    defaults are applied, and undeclared keys are dropped, as Zod does in
    ///    TypeScript. Invalid input returns `VALIDATION_ERROR` (`Input
    ///    validation failed`) with the problems in `suggestion` and
    ///    `details.errors`.
    /// 6. The declared context fields ([`Self::set_context_fields`]) are
    ///    validated on `context.extra`, each value replaced by its schema's
    ///    output; `null` counts as no value. An invalid value or a missing
    ///    required one returns `VALIDATION_ERROR` (`Context field '<name>'
    ///    is not valid` or `is required`), with `details.field`,
    ///    `details.meta` and `details.errors`. Commands named `afd-*` do not
    ///    enforce `required`.
    /// 7. The middleware chain and then the handler run with the validated
    ///    input. With `context.timeout_ms`, a run that outlasts it returns
    ///    `TIMEOUT` (this needs a Tokio runtime with time enabled). A panic in
    ///    a middleware layer or the handler returns `COMMAND_EXECUTION_ERROR`
    ///    with the generic message of [`execution_failure`], as TypeScript
    ///    does for a thrown exception outside `devMode`; the panic payload is
    ///    never included. The failure is what the journal records (with
    ///    `with_record_failures(true)`), and a batch or pipeline treats it as
    ///    any failed command. Only unwinding panics are caught: with
    ///    `panic = "abort"`, and on `wasm32-unknown-unknown` (which cannot
    ///    unwind), a panic aborts the process.
    ///
    /// The middleware and the handler always see a `clock` and a `random`
    /// source on the context ([`SYSTEM_CLOCK`] and [`SYSTEM_RANDOM`] unless the
    /// caller set them). When the context has an `actor`, the handler's result
    /// carries its kind as `metadata.actorKind`.
    ///
    /// The handler is not called when any check fails.
    pub async fn execute(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
    ) -> CommandResult<serde_json::Value> {
        let context = with_context_defaults(context.unwrap_or_default(), &ContextDefaults::new());
        let active_context = context.active_context();
        let visible = |candidate: &CommandDefinition| {
            context
                .interface
                .is_none_or(|interface| candidate.expose.is_exposed_to(interface))
        };
        // A remote caller cannot tell an unexposed command from a missing one (D4).
        let command = self
            .get(name)
            .filter(|command| !context.remote || visible(command));
        let Some(command) = command else {
            // Suggest only names the caller could call: an interface caller must
            // not learn the names of commands that are not exposed to it.
            let callable: Vec<String> = read_lock(&self.commands)
                .ordered
                .iter()
                .filter(|candidate| visible(candidate))
                .filter(|candidate| candidate.is_accessible_in_context(active_context.as_deref()))
                .map(|candidate| candidate.name.clone())
                .collect();
            return failure(
                CommandError::new(
                    error_codes::COMMAND_NOT_FOUND,
                    format!("Command '{}' not found", truncate_name(name)),
                )
                .with_suggestion(not_found_suggestion(name, &callable, context.remote))
                .with_retryable(false),
            );
        };

        if let Some(interface) = context.interface {
            if !command.expose.is_exposed_to(interface) {
                return failure(
                    CommandError::new(
                        error_codes::COMMAND_NOT_EXPOSED,
                        format!("Command '{name}' is not exposed to {interface}"),
                    )
                    .with_suggestion(format!(
                        "Call it from an interface it is exposed to, or set expose.{interface} to true in its definition"
                    ))
                    .with_retryable(false),
                );
            }
        }

        if let Some(active) = active_context.as_deref() {
            if !command.is_accessible_in_context(Some(active)) {
                let context_tools = self
                    .get(crate::builtin_names::AFD_CONTEXT_COMMAND_NAMES[0])
                    .is_some_and(|list| visible(&list));
                return failure(crate::contexts::not_in_context_error(
                    &command,
                    active,
                    context_tools,
                ));
            }
        }

        if context.timeout_ms.is_some() && !cfg!(feature = "native") {
            return failure(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Command timeouts require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout_ms from the context")
                .with_retryable(false),
            );
        }

        let schema = read_lock(&self.commands).schemas.get(name).cloned();
        let validation = match schema {
            Some(schema) => crate::schema_validation::execute(&schema, input),
            None => validate_input(&command.parameters, input),
        };
        let input = match validation {
            Ok(input) => input,
            Err(error) => return failure(*error),
        };

        let mut context = context;
        let context_fields = Arc::clone(&read_lock(&self.context_fields));
        if let Err(error) = apply_context_fields(&context_fields, &command.name, &mut context) {
            return failure(*error);
        }

        let timeout_ms = context.timeout_ms;
        let middleware = read_lock(&self.middleware).clone();
        // Replayed calls, and the calls nested in them, are never recorded.
        let journal = read_lock(&self.journal)
            .clone()
            .filter(|recorder| !context.journal_state.replaying && recorder.records(name));
        let recording = journal
            .as_ref()
            .map(|recorder| recorder.start(&command.name, &input, &mut context, &context_fields));
        let chain = middleware_chain(&command, &middleware, input, context);
        // `chain()` runs inside the guarded future, so a middleware layer that
        // panics while building its future is caught too.
        let run = run_guarded(async move { chain().await });

        // The deadline covers the chain only: a slow journal append cannot turn a finished call
        // into a TIMEOUT, and a call that timed out is not recorded.
        let result = match timeout_ms {
            #[cfg(feature = "native")]
            Some(timeout_ms) => {
                match tokio::time::timeout(Duration::from_millis(timeout_ms), run).await {
                    Ok(result) => result,
                    Err(_) => return failure(CommandError::timeout(&command.name, timeout_ms)),
                }
            }
            _ => run.await,
        };
        match (journal, recording) {
            (Some(recorder), Some(recording)) => recorder.finish(recording, result).await,
            _ => result,
        }
    }

    /// Execute multiple commands in a batch with a default context.
    ///
    /// See [`CommandRegistry::execute_batch_with_context`].
    pub async fn execute_batch(
        &self,
        request: BatchRequest<serde_json::Value>,
    ) -> BatchResult<serde_json::Value> {
        self.execute_batch_with_context(request, CommandContext::new())
            .await
    }

    /// Execute multiple commands in a batch.
    ///
    /// Uses partial success semantics, as in TypeScript: every command runs
    /// unless `stopOnError` is set, and [`BatchResult::success`] is `true`
    /// whenever the batch itself ran. It is `false` only for an invalid
    /// request: no commands, a blank command name, a negative or non-finite
    /// `timeout`, or a zero `parallelism` or `maxFailures` return
    /// `INVALID_BATCH_REQUEST` with TypeScript's message, `Invalid batch
    /// request envelope`, before any command runs. A handler that panics
    /// produces a `COMMAND_EXECUTION_ERROR` result for its own command (see
    /// [`CommandRegistry::execute`]); the other results are kept.
    ///
    /// Every command runs through [`CommandRegistry::execute`] with a copy of
    /// `context` (so exposure checks, validation, the timeout and middleware
    /// apply to each) and a per-command trace ID, `<batch trace ID>-<index>`.
    /// The batch trace ID is `context.trace_id`, or `batch-<timestamp>`.
    /// The request's `context` entries are added to each command's
    /// [`CommandContext::extra`], without replacing keys the caller set; they
    /// never change the trace ID, interface or timeout.
    pub async fn execute_batch_with_context(
        &self,
        request: BatchRequest<serde_json::Value>,
        context: CommandContext,
    ) -> BatchResult<serde_json::Value> {
        let start_time = Instant::now();
        let started_at = chrono::Utc::now().to_rfc3339();
        let options = request.options.unwrap_or_default();
        if request.commands.is_empty()
            || request
                .commands
                .iter()
                .any(|command| crate::wire::is_blank(&command.command))
            || options
                .timeout
                .is_some_and(|timeout| !timeout.is_finite() || timeout < 0.0)
            || options.parallelism == Some(0)
            || options.max_failures == Some(0)
        {
            // TypeScript's error. The suggestion also names maxFailures, a Rust extension.
            return create_failed_batch_result(
                CommandError::new(error_codes::INVALID_BATCH_REQUEST, "Invalid batch request envelope")
                    .with_suggestion(
                        "Provide at least one command with a nonempty command name and optional string ID, and valid boolean stopOnError, nonnegative timeout, and positive integer parallelism and maxFailures options",
                    )
                    .with_retryable(false),
                &started_at,
            );
        }
        #[cfg(not(feature = "native"))]
        if options.timeout.is_some() {
            return create_failed_batch_result(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Batch deadlines require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout")
                .with_retryable(false),
                &started_at,
            );
        }
        let parallelism = options.parallelism.unwrap_or(1);

        let batch_trace_id = context
            .trace_id
            .clone()
            .unwrap_or_else(|| format!("batch-{}", chrono::Utc::now().timestamp_millis()));
        let mut base_context = context;
        for (key, value) in request.context.into_iter().flatten() {
            base_context.extra.entry(key).or_insert(value);
        }
        let total_commands = request.commands.len();
        let command_metadata: Vec<_> = request
            .commands
            .iter()
            .enumerate()
            .map(|(index, command)| {
                (
                    command.id.clone().unwrap_or_else(|| format!("cmd-{index}")),
                    command.command.clone(),
                )
            })
            .collect();
        let timeout_error = || {
            CommandError::new(
                error_codes::BATCH_TIMEOUT,
                format!(
                    "Batch timeout exceeded ({}ms)",
                    options.timeout.unwrap_or(0.0)
                ),
            )
            .with_suggestion("Increase timeout or reduce the number of batch commands")
            .with_retryable(true)
        };
        let stop_on_error = options.stops_on_error();
        let max_failures = options.max_failures;
        let deadline = options
            .timeout
            .and_then(|timeout| deadline_after(start_time, timeout));
        let mut pending = request.commands.into_iter().enumerate();
        let mut active: FuturesUnordered<BatchExecutionFuture<'_>> = FuturesUnordered::new();
        let mut results: Vec<Option<BatchCommandResult<serde_json::Value>>> =
            (0..total_commands).map(|_| None).collect();
        let mut failures = 0usize;
        let mut stopped = false;
        let mut timed_out = false;

        loop {
            while !stopped && active.len() < parallelism {
                let Some((index, cmd)) = pending.next() else {
                    break;
                };
                let (id, command_name) = command_metadata[index].clone();
                let context = base_context
                    .clone()
                    .with_trace_id(format!("{batch_trace_id}-{index}"));
                let timeout_error = &timeout_error;
                active.push(Box::pin(async move {
                    let command_start = Instant::now();
                    let name = command_name.clone();
                    let execution = self.execute(&name, cmd.input, Some(context));
                    let result = match deadline {
                        None => Some(execution.await),
                        Some(deadline) => {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                None
                            } else {
                                #[cfg(feature = "native")]
                                {
                                    tokio::time::timeout(remaining, execution).await.ok()
                                }
                                // Unreachable: deadlines are rejected above without `native`.
                                #[cfg(not(feature = "native"))]
                                {
                                    Some(execution.await)
                                }
                            }
                        }
                    };
                    let result = result.unwrap_or_else(|| failure(timeout_error()));
                    (
                        index,
                        BatchCommandResult::new(id, index, command_name, result)
                            .with_duration(elapsed_ms(command_start)),
                    )
                }));
            }

            let Some((index, command_result)) = active.next().await else {
                break;
            };
            if !command_result.result.success {
                failures += 1;
                timed_out |= command_result
                    .result
                    .error
                    .as_ref()
                    .is_some_and(|error| error.code == error_codes::BATCH_TIMEOUT);
                stopped = timed_out
                    || stop_on_error
                    || max_failures.is_some_and(|maximum| failures >= maximum);
            }
            results[index] = Some(command_result);
        }

        let results: Vec<_> = results
            .into_iter()
            .enumerate()
            .map(|(index, result)| {
                result.unwrap_or_else(|| {
                    let (id, command) = command_metadata[index].clone();
                    let error = if timed_out {
                        timeout_error()
                    } else {
                        CommandError::new(
                            error_codes::COMMAND_SKIPPED,
                            "Command skipped because batch execution stopped after a failure",
                        )
                        .with_suggestion("Disable stopOnError to execute every command")
                    };
                    BatchCommandResult::new(id, index, command, failure(error))
                })
            })
            .collect();

        let total_ms = elapsed_ms(start_time);
        let average_ms = (total_ms / results.len() as f64 * 100.0).round() / 100.0;
        create_batch_result(
            results,
            BatchTiming::new(
                started_at.clone(),
                chrono::Utc::now().to_rfc3339(),
                total_ms,
                average_ms,
            ),
            Some(ResultMetadata::new().with_trace_id(batch_trace_id)),
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Longest command name (in UTF-16 code units) echoed back in an error, as in
/// TypeScript.
const MAX_ECHOED_NAME_LENGTH: usize = crate::similarity::MAX_SIMILARITY_INPUT_LENGTH;

/// `name` cut to [`MAX_ECHOED_NAME_LENGTH`] UTF-16 code units, with `…` when
/// cut, as TypeScript's `truncateName` does. A character that would straddle
/// the cut (a surrogate pair) is left out whole.
pub(crate) fn truncate_name(name: &str) -> String {
    let mut length = 0;
    for (end, character) in name.char_indices() {
        length += character.len_utf16();
        if length > MAX_ECHOED_NAME_LENGTH {
            return format!("{}…", &name[..end]);
        }
    }
    name.to_string()
}

/// How many close matches a `COMMAND_NOT_FOUND` suggestion names at most, as in TypeScript.
const MAX_NOT_FOUND_MATCHES: usize = 3;

/// The bootstrap command that lists the commands a caller can call.
const HELP_COMMAND: &str = "afd-help";

/// Recovery guidance for an unknown command name, as in TypeScript's
/// `notFoundSuggestion`: at most [`MAX_NOT_FOUND_MATCHES`] close matches
/// (bounded fuzzy matching; none for very long names), never the whole list,
/// and a pointer to `afd-help`.
///
/// TypeScript points to `afd-discover`, which its server always routes. Here
/// the pointer is `afd-help`, and only when `callable` contains it: it exists
/// only after [`register_bootstrap_commands`](crate::bootstrap::register_bootstrap_commands),
/// and is not exposed to every interface.
///
/// `name` is untrusted and never echoed; `callable` holds the names the caller
/// may call, in registration order (ties keep that order, as in TypeScript).
pub(crate) fn not_found_suggestion(name: &str, callable: &[String], remote: bool) -> String {
    // The MCP server routes afd-discover in every tool strategy.
    let list = if remote {
        "Use afd-discover to list all commands."
    } else if callable.iter().any(|candidate| candidate == HELP_COMMAND) {
        "Use afd-help to list all commands."
    } else {
        "Check the command name against the available commands."
    };
    let mut matches =
        crate::similarity::find_similar_tools(name, callable, Some(MAX_NOT_FOUND_MATCHES))
            .into_iter();
    let Some(best) = matches.next() else {
        return list.to_string();
    };
    let others: Vec<String> = matches.map(|other| format!("'{other}'")).collect();
    let also_close = if others.is_empty() {
        String::new()
    } else {
        format!(" Other close matches: {}.", others.join(", "))
    };
    format!("Did you mean '{best}'?{also_close} {list}")
}

/// Build the middleware chain around `command`'s handler.
///
/// The returned function can be called more than once (a retry middleware
/// calls `next()` again); each call clones the input and context.
fn middleware_chain(
    command: &Arc<CommandDefinition>,
    middleware: &[CommandMiddleware],
    input: serde_json::Value,
    context: CommandContext,
) -> MiddlewareNext {
    let handler: MiddlewareNext = {
        let command = Arc::clone(command);
        let input = input.clone();
        let context = context.clone();
        Arc::new(move || {
            let command = Arc::clone(&command);
            let input = input.clone();
            let context = context.clone();
            Box::pin(async move {
                // Only the kind is reported, never the actor's id or label.
                let actor_kind = context.actor.as_ref().map(|actor| actor.kind);
                let mut result = command.execute(input, context).await;
                if let Some(actor_kind) = actor_kind {
                    let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
                    metadata.actor_kind = Some(actor_kind);
                    // A handler that still writes the key into `extra` would serialize it twice.
                    metadata.extra.remove("actorKind");
                }
                result
            })
        })
    };

    middleware.iter().rev().fold(handler, |next, layer| {
        let layer = Arc::clone(layer);
        let name = command.name.clone();
        let input = input.clone();
        let context = context.clone();
        Arc::new(move || {
            layer(
                name.clone(),
                input.clone(),
                context.clone(),
                Arc::clone(&next),
            )
        })
    })
}

/// Milliseconds since `start`, rounded to two decimals as in TypeScript.
pub(crate) fn elapsed_ms(start: Instant) -> f64 {
    (start.elapsed().as_secs_f64() * 100_000.0).round() / 100.0
}

/// The instant `timeout_ms` after `start`, or `None` when it is too far away
/// to represent (effectively no deadline).
pub(crate) fn deadline_after(start: Instant, timeout_ms: f64) -> Option<Instant> {
    Duration::try_from_secs_f64(timeout_ms / 1000.0)
        .ok()
        .and_then(|timeout| start.checked_add(timeout))
}

/// The result reported in place of one when a command handler panics: the
/// redacted `COMMAND_EXECUTION_ERROR`. The panic payload is not included, as
/// it may contain internal details.
pub(crate) fn handler_panic_failure() -> CommandResult<serde_json::Value> {
    execution_failure("The command handler panicked", false)
}

/// Run a command future, turning a panic into a `COMMAND_EXECUTION_ERROR`
/// failure so one handler cannot abort its caller, a batch or a pipeline.
pub(crate) async fn run_guarded<F>(future: F) -> CommandResult<serde_json::Value>
where
    F: Future<Output = CommandResult<serde_json::Value>>,
{
    AssertUnwindSafe(future)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| handler_panic_failure())
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP TOOL CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

/// MCP Tool format for command export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    /// Display label (`spec/command-metadata.md`, "Tool titles"), only when the command sets one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    pub input_schema: McpInputSchema,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInputSchema {
    #[serde(rename = "type")]
    pub schema_type: String,
    pub properties: HashMap<String, JsonSchema>,
    pub required: Vec<String>,
}

/// MCP tool annotations for a command (`spec/command-metadata.md`, "Annotations").
///
/// Only what the command declares is reported. `mutation` has no unset state here, so a
/// mutation gives `readOnlyHint: false` and `destructiveHint` from `destructive` (`false` when
/// unset), and anything else gives `None`.
pub fn command_tool_annotations(command: &CommandDefinition) -> Option<serde_json::Value> {
    command.mutation.then(|| {
        serde_json::json!({
            "readOnlyHint": false,
            "destructiveHint": command.destructive.unwrap_or(false),
        })
    })
}

/// The MCP `outputSchema` of a command tool: the CommandResult envelope, with `data` typed by
/// `data_schema` (`spec/command-metadata.md`, "Structured results").
pub fn command_result_output_schema(data_schema: &serde_json::Value) -> serde_json::Value {
    let mut data = data_schema.clone();
    if let Some(object) = data.as_object_mut() {
        object.remove("$schema");
    }
    serde_json::json!({
        "type": "object",
        "properties": {
            "success": { "type": "boolean" },
            "data": data,
            "error": { "type": "object" },
            "metadata": { "type": "object" },
        },
        "required": ["success"],
    })
}

/// Convert a legacy definition to a tool. For whole-schema registrations, use
/// [`CommandRegistry::get_tool`] instead: the definition alone does not carry the override.
pub fn command_to_mcp_tool(command: &CommandDefinition) -> McpTool {
    let mut properties = HashMap::new();
    let mut required = Vec::new();

    for param in &command.parameters {
        let mut schema = param.schema.clone().unwrap_or_else(|| JsonSchema {
            schema_type: Some(param.param_type.clone()),
            description: Some(param.description.clone()),
            default: param.default.clone(),
            enum_values: param.enum_values.clone(),
            ..Default::default()
        });

        if param.default.is_some() {
            schema.default = param.default.clone();
        }
        let has_default = schema.default.is_some();
        properties.insert(param.name.clone(), schema);

        if param.required && !has_default {
            required.push(param.name.clone());
        }
    }

    McpTool {
        name: command.name.clone(),
        title: command.title.clone(),
        description: command.description.clone(),
        input_schema: McpInputSchema {
            schema_type: "object".to_string(),
            properties,
            required,
        },
    }
}

pub fn create_command_registry() -> CommandRegistry {
    CommandRegistry::new()
}

#[cfg(test)]
mod tests;
