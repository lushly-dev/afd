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

use crate::actor::{with_context_defaults, ContextDefaults};
use crate::approval::{approval_mode, ApprovalPolicy};
use crate::batch::{
    create_batch_result, create_failed_batch_result, BatchCommandResult, BatchRequest, BatchResult,
    BatchTiming,
};
use crate::context_fields::{apply_context_fields, check_context_fields, ContextField};
use crate::errors::{error_codes, CommandError};
use crate::handoff::HandoffCommandLike;
use crate::journal::JournalRecorder;
use crate::result::{execution_failure, failure, CommandResult, ResultMetadata};
use crate::time::Instant;

mod context;

use context::CallState;
pub use context::CommandContext;
// The MCP server sets these on a request's context.
#[cfg(feature = "server")]
pub(crate) use context::{ScopeCheck, ToolSurface, Visibility};

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
    /// Another app, through a host (opt-in; each call needs the registry's call grant, see
    /// [`CommandRegistry::set_call_grant`]).
    Apps,
}

impl CommandInterface {
    /// The interface name, as used for the `expose` keys.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Palette => "palette",
            Self::Mcp => "mcp",
            Self::Agent => "agent",
            Self::Cli => "cli",
            Self::Apps => "apps",
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
/// `isExposedTo`: `palette` and `agent` default to `true`, `mcp`, `cli` and
/// `apps` to `false`. So `{"mcp": true}` deserializes to palette, agent and MCP
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
    /// Other apps, each under a host's grant (default `false`: opt in). The callee's
    /// declaration that another app may call the command; a call with
    /// [`CommandInterface::Apps`] also needs [`CommandRegistry::set_call_grant`]'s grant
    /// (`spec/command-metadata.md`, "App-to-app calls"). Serialized only when `true`, so the
    /// default serializes as it did before the flag existed.
    #[serde(default = "default_false", skip_serializing_if = "is_false")]
    pub apps: bool,
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

    /// Set exposure to other apps (see [`ExposeOptions::apps`]).
    pub fn with_apps(mut self, exposed: bool) -> Self {
        self.apps = exposed;
        self
    }

    /// Whether these options expose a command to `interface`.
    pub fn is_exposed_to(&self, interface: CommandInterface) -> bool {
        match interface {
            CommandInterface::Palette => self.palette,
            CommandInterface::Mcp => self.mcp,
            CommandInterface::Agent => self.agent,
            CommandInterface::Cli => self.cli,
            CommandInterface::Apps => self.apps,
        }
    }
}

const fn default_true() -> bool {
    true
}

const fn default_false() -> bool {
    false
}

#[allow(clippy::trivially_copy_pass_by_ref)] // serde's skip_serializing_if passes a reference
const fn is_false(value: &bool) -> bool {
    !*value
}

impl Default for ExposeOptions {
    fn default() -> Self {
        Self {
            palette: true,
            mcp: false,
            agent: true,
            cli: false,
            apps: false,
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
// CONFIRMATION MODE OF ONE COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

/// How one command is confirmed over MCP (`spec/command-metadata.md`, "Host-verified
/// confirmation"), reported as `confirmationMode` in `_meta` and `afd-detail`. Unset, the
/// server's [`ConfirmationMode`](crate::server::ConfirmationMode) option applies to the command's
/// `confirm_prompt`.
///
/// Named apart from the server option, which says how a server treats `confirm_prompt`; this one
/// says that only the host can confirm the command at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum CommandConfirmationMode {
    /// `host-verified`: only the host can prove that a person decided, through the server's
    /// [`HumanRelay`](crate::server::HumanRelay). On every MCP surface, whatever the server's
    /// confirmation option says (`Off` included), the server never sends a form elicitation for
    /// the command, never accepts an acknowledgement or a form answer for it, and gates it whether
    /// or not it declares `confirm_prompt`. Without a relay a call fails with
    /// `CONFIRMATION_REQUIRED`. `DirectClient` and in-process registries are unchanged: the host
    /// owns in-process calls.
    HostVerified,
}

impl CommandConfirmationMode {
    /// The wire spelling: `host-verified`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::HostVerified => "host-verified",
        }
    }
}

impl fmt::Display for CommandConfirmationMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASK SUPPORT OF ONE COMMAND
// ═══════════════════════════════════════════════════════════════════════════════

/// Whether an MCP `tools/call` to a command may run as a task under the Tasks extension,
/// `io.modelcontextprotocol/tasks` (`spec/command-metadata.md`, "Tasks"), reported as `task` in
/// `_meta`, grouped `_meta.actions` and `afd-detail`.
///
/// | `task` | A request that declares the extension | One that does not |
/// | --- | --- | --- |
/// | [`Never`](Self::Never) (default) | Inline | Inline |
/// | [`Optional`](Self::Optional) | A task | Inline |
/// | [`Required`](Self::Required) | A task | JSON-RPC `-32021`, naming the extension |
///
/// Only a call that routes to one command (its own tool, a hybrid first-class tool, a grouped
/// tool or `afd-call`) becomes a task; in `afd-batch` and `afd-pipe` an `Optional` step runs
/// inline and a `Required` step fails the whole request before any step runs. `DirectClient`,
/// in-process registries and the CLI always run inline. A task never asks a person, so
/// [`CommandRegistry::register`] refuses `Optional` or `Required` beside `confirm_prompt`, an
/// approval policy other than `not-required`, or a `confirmation_mode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(rename_all = "kebab-case")]
pub enum TaskSupport {
    /// `never`: every call runs inline.
    #[default]
    Never,
    /// `optional`: a task for a request that declares the extension, inline otherwise.
    Optional,
    /// `required`: only as a task; a request that does not declare the extension gets JSON-RPC
    /// `-32021` (missing required client capability).
    Required,
}

impl TaskSupport {
    /// The wire spelling: `never`, `optional` or `required`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Optional => "optional",
            Self::Required => "required",
        }
    }

    /// Whether a call may run as a task (`Optional` or `Required`).
    pub fn allows_task(self) -> bool {
        self != Self::Never
    }
}

impl fmt::Display for TaskSupport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
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

/// Runs the rest of the middleware chain and then the handler, with the context it is given.
///
/// A middleware passes on the context it received, refined if it needs to be (a trace ID, an
/// actor, a field of `extra`): the layers after it and the handler see that context. It may call
/// `next` more than once (a retry middleware does), cloning the context for each call. The
/// `interface`, `credentials`, `clock`, `random` and the state only the crate sets stay as they
/// were before the chain, at every layer and at the handler.
pub type MiddlewareNext = Arc<
    dyn Fn(CommandContext) -> BoxFuture<'static, CommandResult<serde_json::Value>> + Send + Sync,
>;

/// Middleware that wraps command execution, added with
/// [`CommandRegistry::add_middleware`].
///
/// It receives the command name, the validated input (shared, so no layer copies it), the
/// context and `next`, and returns the result: usually `next(context).await`, possibly inspected
/// or replaced. A middleware that returns without calling `next` stops the call.
///
/// # Example
///
/// ```rust
/// use afd::{CommandMiddleware, CommandRegistry};
/// use std::sync::Arc;
///
/// let logging: CommandMiddleware = Arc::new(|name, _input, context, next| {
///     Box::pin(async move {
///         let result = next(context).await;
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
            Arc<serde_json::Value>,
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

    /// Extra `_meta` entries emitted on the command's tool and reported by `afd-detail` as
    /// `toolMeta` (`spec/mcp-resources.md`, T1). Keys follow the key rule
    /// ([`check_meta_entry`](crate::check_meta_entry)); the registry refuses anything else when the
    /// command is registered. `None` or empty is omitted.
    pub tool_meta: Option<serde_json::Map<String, serde_json::Value>>,

    /// The declared output budget (`spec/output-budgets.md`, B1), `None` for no budget. Checked
    /// when the command is registered.
    pub output_budget: Option<crate::output_budget::OutputBudget>,

    /// The OAuth scopes a caller's token needs to run the command over HTTP on a server
    /// configured with authorization (`spec/command-metadata.md`, "Scopes";
    /// `spec/authorization.md`, M6), beside the server's required scopes. Metadata: reported as
    /// `_meta.scopes` and by `afd-detail`, and enforced only by an authorized HTTP server (the
    /// `server-auth` feature), unless a host `ScopeResolver` decides instead. stdio, the CLI,
    /// `DirectClient` and in-process registries ignore it. Each must be a scope token
    /// ([`is_scope_token`](crate::is_scope_token)); the registry refuses anything else when the
    /// command is registered. `None` or empty is no scope of its own.
    pub scopes: Option<Vec<String>>,

    /// How the command is confirmed over MCP: `None` lets the server's confirmation option apply;
    /// [`CommandConfirmationMode::HostVerified`] lets only the host's
    /// [`HumanRelay`](crate::server::HumanRelay) confirm it (`spec/command-metadata.md`,
    /// "Host-verified confirmation"). Reported as `confirmationMode` in `_meta`, grouped
    /// `_meta.actions` and `afd-detail`.
    pub confirmation_mode: Option<CommandConfirmationMode>,

    /// Whether an MCP call may run as a task (`spec/command-metadata.md`, "Tasks"): `None` is
    /// unset, read as [`TaskSupport::Never`]. Reported as `task` in `_meta`, grouped
    /// `_meta.actions` and `afd-detail` when set. [`CommandRegistry::register`] refuses
    /// [`TaskSupport::Optional`] or [`TaskSupport::Required`] beside `confirm_prompt`, an approval
    /// policy other than `not-required`, or a `confirmation_mode`.
    pub task: Option<TaskSupport>,
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
            tool_meta: None,
            output_budget: None,
            scopes: None,
            confirmation_mode: None,
            task: None,
        }
    }

    /// Declare whether an MCP call may run as a task (see [`CommandDefinition::task`]).
    pub fn with_task(mut self, task: TaskSupport) -> Self {
        self.task = Some(task);
        self
    }

    /// The command's task support: [`TaskSupport::Never`] when unset.
    pub fn task_support(&self) -> TaskSupport {
        self.task.unwrap_or_default()
    }

    /// Set how the command is confirmed over MCP (see [`CommandDefinition::confirmation_mode`]):
    /// [`CommandConfirmationMode::HostVerified`] lets only the host's
    /// [`HumanRelay`](crate::server::HumanRelay) confirm it, whatever the server's confirmation
    /// option says.
    pub fn with_confirmation_mode(mut self, mode: CommandConfirmationMode) -> Self {
        self.confirmation_mode = Some(mode);
        self
    }

    /// Whether only the host can confirm the command ([`CommandConfirmationMode::HostVerified`]).
    pub fn is_host_verified(&self) -> bool {
        self.confirmation_mode == Some(CommandConfirmationMode::HostVerified)
    }

    /// Declare the OAuth scopes a caller's token needs to run the command on an authorized HTTP
    /// server (see [`CommandDefinition::scopes`]), compared exactly. Each must be a scope token
    /// (RFC 6749 3.3); [`CommandRegistry::register`] refuses the command otherwise, naming it and
    /// the scope.
    pub fn with_scopes<I, S>(mut self, scopes: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.scopes = Some(scopes.into_iter().map(Into::into).collect());
        self
    }

    /// Declare an output budget (`spec/output-budgets.md`, B1): a result may use `default_bytes`
    /// unless the caller asks for another budget, and `max_bytes` at most
    /// ([`CommandContext::with_output_budget_ask`], or `_meta["dev.afd/outputBudget"]` over MCP).
    ///
    /// Both must be integers from 1 to 9007199254740991 with `default_bytes <= max_bytes`; the
    /// registry refuses the command otherwise ([`CommandRegistry::register`]), naming it and the
    /// field. After the handler, a successful result over its effective budget is replaced by an
    /// `OUTPUT_BUDGET_EXCEEDED` failure, or, for a [mutation](Self::as_mutation), kept with a
    /// warning of that code. Nothing truncates structured output.
    pub fn with_output_budget(mut self, default_bytes: u64, max_bytes: u64) -> Self {
        self.output_budget = Some(crate::output_budget::OutputBudget::new(
            default_bytes,
            max_bytes,
        ));
        self
    }

    /// Add one extra `_meta` entry to the command's tool (`spec/mcp-resources.md`, T1 and T2): a
    /// prefixed key with two or more labels outside `dev.afd/` and MCP's reserved prefixes (for
    /// example `dev.umbel/origin`), or `ui`, the MCP Apps key. A later call with the same key
    /// replaces the value. The key is checked when the command is registered
    /// ([`CommandRegistry::register`]), which refuses the command, naming it and the key.
    pub fn with_tool_meta(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.tool_meta
            .get_or_insert_with(serde_json::Map::new)
            .insert(key.into(), value);
        self
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
    /// validation, parameter defaults, exposure, the timeout, middleware and
    /// the approval admission check (a declared approval policy does not hold
    /// here).
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
/// Normative server-level default per-command deadline in milliseconds (`spec/execution-controls.md`).
pub const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 30_000;

/// Normative default maximum number of commands in a single batch (`spec/execution-controls.md`).
pub const DEFAULT_MAX_BATCH_SIZE: usize = 500;

/// Normative default maximum concurrent commands in a single batch (`spec/execution-controls.md`).
pub const DEFAULT_MAX_BATCH_PARALLELISM: usize = 16;

/// Normative default cap on reported issues per `VALIDATION_ERROR` (`spec/execution-controls.md`).
pub const DEFAULT_MAX_VALIDATION_ISSUES: usize = 100;

#[derive(Debug, Clone, Copy)]
struct ExecutionLimits {
    default_timeout_ms: Option<u64>,
    max_batch_size: usize,
    max_batch_parallelism: usize,
    max_validation_issues: usize,
}

impl Default for ExecutionLimits {
    fn default() -> Self {
        Self {
            default_timeout_ms: None,
            max_batch_size: DEFAULT_MAX_BATCH_SIZE,
            max_batch_parallelism: DEFAULT_MAX_BATCH_PARALLELISM,
            max_validation_issues: DEFAULT_MAX_VALIDATION_ISSUES,
        }
    }
}

#[derive(Default)]
pub struct CommandRegistry {
    commands: RwLock<RegisteredCommands>,
    /// Copied on write, so a call takes the list with one reference count.
    middleware: RwLock<Arc<Vec<CommandMiddleware>>>,
    journal: RwLock<Option<Arc<JournalRecorder>>>,
    context_fields: RwLock<Arc<Vec<ContextField>>>,
    call_grant: RwLock<Option<CallGrant>>,
    limits: RwLock<ExecutionLimits>,
}

/// A host's grant check for app-to-app calls ([`CommandRegistry::set_call_grant`]): whether the
/// caller in the context holds a grant naming the command.
pub type CallGrant = Arc<dyn Fn(&str, &CommandContext) -> bool + Send + Sync>;

/// The one `CALL_NOT_GRANTED` refusal (`spec/command-metadata.md`, "App-to-app calls"): fixed
/// bytes that name neither the command nor the reason.
fn call_not_granted() -> CommandError {
    CommandError::new(
        error_codes::CALL_NOT_GRANTED,
        "This app may not call that command",
    )
    .with_suggestion(
        "Ask the deployer for a calls grant that names the command; the command must also set expose.apps",
    )
    .with_retryable(false)
}

/// Commands by name, plus their registration order.
#[derive(Default)]
struct RegisteredCommands {
    by_name: HashMap<String, Arc<CommandDefinition>>,
    ordered: Vec<Arc<CommandDefinition>>,
    /// The whole input schemas commands validate with ([`CommandRegistry::register_with_schema`]).
    schemas: HashMap<String, Arc<serde_json::Value>>,
    /// The input schemas commands advertise in place of the validation schema
    /// ([`CommandRegistry::register_with_schemas`]).
    advertised: HashMap<String, serde_json::Value>,
}

/// Read a lock, ignoring poisoning: no registry invariant spans a panic.
fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(PoisonError::into_inner)
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write().unwrap_or_else(PoisonError::into_inner)
}

/// Check a batch request against `max_batch_size` and `max_batch_parallelism`
/// (`spec/execution-controls.md`).
///
/// Returns `Some(CommandError)` with `INVALID_BATCH_REQUEST` (`retryable: false`)
/// when either ceiling is exceeded, or `None` when the request is within bounds.
pub fn check_batch_limits<T>(
    request: &BatchRequest<T>,
    max_batch_size: usize,
    max_batch_parallelism: usize,
) -> Option<CommandError> {
    let hint = format!(
        "Send between 1 and {max_batch_size} commands with parallelism at most {max_batch_parallelism}"
    );
    if request.commands.len() > max_batch_size {
        let mut details = HashMap::new();
        details.insert(
            "count".to_string(),
            serde_json::json!(request.commands.len()),
        );
        details.insert(
            "maxBatchSize".to_string(),
            serde_json::json!(max_batch_size),
        );
        return Some(
            CommandError::new(
                error_codes::INVALID_BATCH_REQUEST,
                format!(
                    "Batch size {} exceeds maximum of {max_batch_size} commands",
                    request.commands.len(),
                ),
            )
            .with_suggestion(hint)
            .with_retryable(false)
            .with_details(details),
        );
    }
    let requested_parallelism = request
        .options
        .as_ref()
        .and_then(|opts| opts.parallelism)
        .unwrap_or(1);
    if requested_parallelism > max_batch_parallelism {
        let mut details = HashMap::new();
        details.insert(
            "parallelism".to_string(),
            serde_json::json!(requested_parallelism),
        );
        details.insert(
            "maxBatchParallelism".to_string(),
            serde_json::json!(max_batch_parallelism),
        );
        return Some(
            CommandError::new(
                error_codes::INVALID_BATCH_REQUEST,
                format!(
                    "Batch parallelism {requested_parallelism} exceeds maximum of {max_batch_parallelism}"
                ),
            )
            .with_suggestion(hint)
            .with_retryable(false)
            .with_details(details),
        );
    }
    None
}

impl CommandRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the registry's default per-command deadline in milliseconds (`spec/execution-controls.md`).
    /// `None` or `Some(0)` disables the default deadline.
    pub fn set_default_timeout_ms(&self, timeout_ms: Option<u64>) {
        write_lock(&self.limits).default_timeout_ms = timeout_ms.filter(|&ms| ms > 0);
    }

    /// The registry's default per-command deadline in milliseconds, if configured.
    pub fn default_timeout_ms(&self) -> Option<u64> {
        read_lock(&self.limits).default_timeout_ms
    }

    /// Set the maximum number of commands accepted in a single batch (default: 500).
    pub fn set_max_batch_size(&self, max: usize) -> Result<(), String> {
        if max == 0 {
            return Err("max_batch_size must be at least 1".to_string());
        }
        write_lock(&self.limits).max_batch_size = max;
        Ok(())
    }

    /// The maximum number of commands accepted in a single batch.
    pub fn max_batch_size(&self) -> usize {
        read_lock(&self.limits).max_batch_size
    }

    /// Set the maximum `options.parallelism` accepted in a single batch (default: 16).
    pub fn set_max_batch_parallelism(&self, max: usize) -> Result<(), String> {
        if max == 0 {
            return Err("max_batch_parallelism must be at least 1".to_string());
        }
        write_lock(&self.limits).max_batch_parallelism = max;
        Ok(())
    }

    /// The maximum `options.parallelism` accepted in a single batch.
    pub fn max_batch_parallelism(&self) -> usize {
        read_lock(&self.limits).max_batch_parallelism
    }

    /// Set the maximum number of validation issues reported per `VALIDATION_ERROR` (default: 100).
    pub fn set_max_validation_issues(&self, max: usize) -> Result<(), String> {
        if max == 0 {
            return Err("max_validation_issues must be at least 1".to_string());
        }
        write_lock(&self.limits).max_validation_issues = max;
        Ok(())
    }

    /// The maximum number of validation issues reported per `VALIDATION_ERROR`.
    pub fn max_validation_issues(&self) -> usize {
        read_lock(&self.limits).max_validation_issues
    }

    /// Check batch size and parallelism against the registry's configured limits
    /// (`spec/execution-controls.md`).
    pub(crate) fn check_batch_limits(
        &self,
        request: &BatchRequest<serde_json::Value>,
    ) -> Option<CommandError> {
        let limits = *read_lock(&self.limits);
        check_batch_limits(request, limits.max_batch_size, limits.max_batch_parallelism)
    }

    /// Register a command.
    ///
    /// # Errors
    /// Returns an error if the name is not `domain-action` kebab-case, a
    /// command with the same name already exists, an extra `_meta` key of
    /// [`CommandDefinition::with_tool_meta`] breaks the key rule, a scope of
    /// [`CommandDefinition::with_scopes`] is not a scope token, or the command may run as a task
    /// ([`CommandDefinition::with_task`]) beside `confirm_prompt`, an approval policy other than
    /// `not-required`, or a `confirmation_mode`.
    pub fn register(&self, command: CommandDefinition) -> Result<(), String> {
        validate_command_name(&command.name)?;
        validate_tool_meta(&command)?;
        validate_output_budget(&command)?;
        validate_scopes(&command)?;
        validate_person_gates(&command)?;
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
        self.register_whole(command, schema, None)
    }

    fn register_whole(
        &self,
        command: CommandDefinition,
        schema: serde_json::Value,
        advertised: Option<serde_json::Value>,
    ) -> Result<(), String> {
        // A boolean schema is allowed below the root, but a command's input is an object
        // (spec/validation.md).
        if !schema.is_object() {
            return Err(format!(
                "Command '{}': an input schema must be a JSON Schema object",
                command.name
            ));
        }
        crate::schema_validation::compile(&schema)?;
        validate_command_name(&command.name)?;
        validate_tool_meta(&command)?;
        validate_output_budget(&command)?;
        validate_scopes(&command)?;
        validate_person_gates(&command)?;
        let mut commands = write_lock(&self.commands);
        if commands.by_name.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        commands
            .schemas
            .insert(command.name.clone(), Arc::new(schema));
        if let Some(advertised) = advertised {
            commands.advertised.insert(command.name.clone(), advertised);
        }
        let command = Arc::new(command);
        commands
            .by_name
            .insert(command.name.clone(), Arc::clone(&command));
        commands.ordered.push(command);
        Ok(())
    }

    /// [`Self::register_with_schema`] with a second schema the command advertises
    /// (`spec/mcp-resources.md`, V1 and V2).
    ///
    /// `validation` is compiled and every call is validated against it, exactly as for
    /// [`Self::register_with_schema`]. `advertised` is what every surface shows (a tool's
    /// `inputSchema`, grouped `_meta.actions`, `afd-detail`, `afd-schema` and `afd-docs`) and is
    /// checked for one thing only: a JSON object whose `type` is `"object"`. Nothing else in it is
    /// compiled, so it may use keywords the validator refuses. AFD cannot prove the two agree;
    /// keeping `validation` no wider than `advertised` is the caller's duty.
    ///
    /// # Errors
    /// The command is refused, naming it, when `advertised` is not an object schema, and for every
    /// reason [`Self::register_with_schema`] refuses one.
    pub fn register_with_schemas(
        &self,
        command: CommandDefinition,
        validation: serde_json::Value,
        advertised: serde_json::Value,
    ) -> Result<(), String> {
        if advertised.get("type").and_then(serde_json::Value::as_str) != Some("object") {
            return Err(format!(
                "Command '{}': the advertised input schema must be a JSON object whose type is \"object\"",
                command.name
            ));
        }
        self.register_whole(command, validation, Some(advertised))
    }

    /// Export the authoritative MCP tool, including any whole schema registered with it.
    ///
    /// The tool carries the command's `title` only when it sets one, and its `_meta` the approval
    /// mode, the output budget declaration (`dev.afd/outputBudget`: `{ defaultBytes,
    /// maxBytes }`), the `scopes` (when not empty), `confirmationMode`, `task` and the extra tool
    /// `_meta` entries, each only when set.
    ///
    /// A command with `mutation: true` also carries MCP `annotations`
    /// (`readOnlyHint: false`, `destructiveHint` from `destructive`; `spec/command-metadata.md`). `mutation`
    /// has no unset state here, so a non-mutating command claims nothing.
    pub fn get_tool(&self, name: &str) -> Option<serde_json::Value> {
        let commands = read_lock(&self.commands);
        let command = commands.by_name.get(name)?;
        let mut tool = serde_json::to_value(command_to_mcp_tool(command)).expect("tool serializes");
        if let Some(schema) = commands
            .advertised
            .get(name)
            .or_else(|| commands.schemas.get(name).map(|schema| &**schema))
        {
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
        // The output budget declaration (`spec/output-budgets.md`, B1).
        if let Some(budget) = &command.output_budget {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"][crate::output_budget::AFD_OUTPUT_BUDGET_META_KEY] =
                serde_json::json!(budget);
        }
        // The scopes the command needs (`spec/command-metadata.md`, "Scopes"); `_meta` omits an
        // empty array.
        if let Some(scopes) = command.scopes.as_ref().filter(|scopes| !scopes.is_empty()) {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["scopes"] = serde_json::json!(scopes);
        }
        // Only the host can confirm it (`spec/command-metadata.md`, "Host-verified confirmation").
        if let Some(mode) = command.confirmation_mode {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["confirmationMode"] = serde_json::json!(mode);
        }
        // Whether a call may run as a task (`spec/command-metadata.md`, "Tasks"), when set.
        if let Some(task) = command.task {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            tool["_meta"]["task"] = serde_json::json!(task);
        }
        // The key rule keeps these from replacing any entry the server sets.
        if let Some(extra) = command.tool_meta.as_ref().filter(|extra| !extra.is_empty()) {
            if !tool["_meta"].is_object() {
                tool["_meta"] = serde_json::json!({});
            }
            for (key, value) in extra {
                tool["_meta"][key] = value.clone();
            }
        }
        Some(tool)
    }

    /// Add a middleware to the chain that wraps every command execution.
    ///
    /// Middleware runs in the order it was added (the first added is the
    /// outermost), after input validation, with the validated input. Each one
    /// calls `next(context)` to run the rest of the chain with the context it passes, and can
    /// inspect or replace the result, or return without calling `next` to short-circuit.
    pub fn add_middleware(&self, middleware: CommandMiddleware) {
        Arc::make_mut(&mut write_lock(&self.middleware)).push(middleware);
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

    /// Set the host's grant check for app-to-app calls (`spec/command-metadata.md`, "App-to-app
    /// calls"): whether the caller in `context` holds a grant naming `command`. AFD does not
    /// define a grant's shape or who the caller is; a host reads its own declared context field,
    /// such as Loam's `caller`, from [`CommandContext::extra`].
    ///
    /// A call with [`CommandInterface::Apps`] runs only when the command exists for the caller,
    /// sets [`ExposeOptions::apps`] and this returns `true`. Otherwise, and without a grant
    /// check, it returns `CALL_NOT_GRANTED` before any other check ([`Self::execute`]). A grant
    /// check that panics refuses (where the target can unwind). It replaces any earlier one.
    pub fn set_call_grant(
        &self,
        grant: impl Fn(&str, &CommandContext) -> bool + Send + Sync + 'static,
    ) {
        *write_lock(&self.call_grant) = Some(Arc::new(grant));
    }

    /// Whether an app's call to `name` may run (see [`Self::set_call_grant`]).
    fn app_call_granted(&self, name: &str, context: &CommandContext) -> bool {
        let Some(grant) = read_lock(&self.call_grant).clone() else {
            return false;
        };
        let exposed = self.get(name).is_some_and(|command| {
            command.expose.apps
                && context
                    .known
                    .as_ref()
                    .is_none_or(|known| known.allows(&command))
        });
        exposed
            && std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| grant(name, context)))
                .unwrap_or(false)
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
    /// 0. A call with [`CommandInterface::Apps`], an app's call, returns
    ///    `CALL_NOT_GRANTED` unless the command exists for the caller, sets
    ///    [`ExposeOptions::apps`] and [`Self::set_call_grant`]'s check grants it.
    ///    The answer is the same in every case, before lookup or validation, so an
    ///    app learns nothing about commands it may not call.
    /// 1. An unknown name returns `COMMAND_NOT_FOUND`. Its suggestion names up
    ///    to three close matches, as in TypeScript, chosen among the commands
    ///    exposed to `context.interface` (all commands when it is unset) and
    ///    available in the active context, and points to `afd-help` when that
    ///    is one of them (`afd-discover` for the MCP server's calls). On an
    ///    authorized MCP server, a command its resolver hides from the caller
    ///    is an unknown name here, with the same answer
    ///    (`spec/authorization.md`, M6, "Hidden commands").
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
    ///    The output budget ask ([`CommandContext::with_output_budget_ask`]) is
    ///    validated next, whether or not the command declares a budget: an
    ///    invalid ask returns `VALIDATION_ERROR` (`details.field` is
    ///    `outputBudget`, `details.meta` is `dev.afd/outputBudget`). The
    ///    effective budget ([`CommandContext::output_budget`]) is then set on
    ///    the context (`spec/output-budgets.md`, B3).
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
    /// The innermost link of the chain checks a successful result against the
    /// effective output budget right after the handler, before `metadata` is
    /// stamped (B5, B6): an over-budget read becomes an `OUTPUT_BUDGET_EXCEEDED`
    /// failure, an over-budget [mutation](CommandDefinition::as_mutation) keeps
    /// its result with a warning of that code, and a result within budget
    /// carries `metadata["dev.afd/outputBudget"] = { limitBytes, usedBytes }`.
    /// A handler's own failure passes unchanged.
    ///
    /// The middleware and the handler always see a `clock` and a `random`
    /// source on the context
    /// ([`SYSTEM_CLOCK`](crate::clock::SYSTEM_CLOCK) and
    /// [`SYSTEM_RANDOM`](crate::clock::SYSTEM_RANDOM) unless the caller set
    /// them). When the context has an `actor`, the handler's result carries
    /// its kind as `metadata.actorKind`.
    ///
    /// The handler is not called when any check fails.
    pub async fn execute(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
    ) -> CommandResult<serde_json::Value> {
        let context = with_context_defaults(context.unwrap_or_default(), &ContextDefaults::new());
        if context.interface == Some(CommandInterface::Apps)
            && !self.app_call_granted(name, &context)
        {
            return failure(call_not_granted());
        }
        let active_context = context.active_context();
        let visible = |candidate: &CommandDefinition| {
            context
                .interface
                .is_none_or(|interface| candidate.expose.is_exposed_to(interface))
        };
        // A command that does not exist for the caller (one an authorized server's resolver
        // hides from it, `spec/authorization.md`, M6) is a missing one, before any other check.
        let known = |candidate: &CommandDefinition| {
            context
                .known
                .as_ref()
                .is_none_or(|known| known.allows(candidate))
        };
        // A remote caller cannot tell an unexposed command from a missing one (D4).
        let command = self
            .get(name)
            .filter(|command| known(command))
            .filter(|command| !context.remote || visible(command));
        let Some(command) = command else {
            // Suggest only names the caller could call: an interface caller must
            // not learn the names of commands that are not exposed to it, nor one an
            // authorized server hides from it by scope (`spec/authorization.md`, M6): the
            // listing filter, which the server sets whenever it sets `known`, holds only
            // commands that exist for the caller.
            let listed = context
                .tool_surface
                .as_ref()
                .and_then(|surface| surface.visible.as_ref());
            let callable: Vec<String> = read_lock(&self.commands)
                .ordered
                .iter()
                .filter(|candidate| visible(candidate))
                .filter(|candidate| candidate.is_accessible_in_context(active_context.as_deref()))
                .filter(|candidate| listed.is_none_or(|listed| listed.allows(candidate)))
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
                    .is_some_and(|list| visible(&list) && known(&list));
                return failure(crate::contexts::not_in_context_error(
                    &command,
                    active,
                    context_tools,
                ));
            }
        }

        let effective_timeout_ms = match context.timeout_ms {
            Some(0) => None,
            Some(ms) => Some(ms),
            None => context
                .default_timeout_override
                .unwrap_or_else(|| self.default_timeout_ms()),
        };
        if effective_timeout_ms.is_some() && !cfg!(feature = "native") {
            return failure(
                CommandError::new(
                    error_codes::UNSUPPORTED_OPTION,
                    "Command timeouts require the native feature",
                )
                .with_suggestion("Enable the native feature or omit timeout_ms from the context")
                .with_retryable(false),
            );
        }

        // A step of an `afd-batch` or `afd-pipe` approved up front runs on the input validated
        // then, so the input that runs is the one the human was shown (#1414). It is still
        // validated as sent here; only the value is kept. Every step takes it, not only one whose
        // command declares a policy: an approval middleware's commands list can gate a command
        // that declares none, and the registry cannot see that list.
        let approved = context
            .up_front_approval
            .as_ref()
            .and_then(|up_front| up_front.validated(&command.name, &input));
        let input = match self.validate(&command, input) {
            Ok(input) => approved.unwrap_or(input),
            Err(error) => return failure(*error),
        };

        // This call's own admission record (#1886): fresh for every call, so a batch item, a
        // pipeline step or a nested call never inherits another call's admission.
        let mut context = context;
        context.approval_admission = Some(crate::approval::admission::Admission::begin(
            Arc::clone(&command),
        ));
        let context_fields = Arc::clone(&read_lock(&self.context_fields));
        if let Err(error) = apply_context_fields(&context_fields, &command.name, &mut context) {
            return failure(*error);
        }
        if let Err(error) = crate::output_budget::apply_output_budget(&command, &mut context) {
            return failure(*error);
        }
        // The execute-time scope decision on the validated input, with defaults applied and any
        // pipeline references resolved (`spec/authorization.md`, M6, "At execution").
        if let (Some(check), Some(credentials)) = (&context.scope_check, &context.credentials) {
            if let Some(error) = (check.0)(&command.name, &input, credentials) {
                return failure(error);
            }
        }

        // Pre-dispatch cancellation check (`spec/execution-controls.md`): before middleware and
        // before starting any timer, an already-cancelled call returns COMMAND_CANCELLED.
        if context.is_cancelled() {
            return failure(command_cancelled_error(&command.name));
        }

        let middleware = Arc::clone(&read_lock(&self.middleware));
        // Replayed calls, and the calls nested in them, are never recorded.
        let journal = read_lock(&self.journal)
            .clone()
            .filter(|recorder| !context.journal_state.replaying && recorder.records(name));
        let recording = journal
            .as_ref()
            .map(|recorder| recorder.start(&command.name, &input, &mut context, &context_fields));

        #[cfg(feature = "native")]
        let deadline_signal = effective_timeout_ms.map(|_| match &context.cancellation {
            Some(parent) => parent.child(),
            None => crate::cancellation::CancellationSignal::new(),
        });
        #[cfg(feature = "native")]
        if let Some(signal) = &deadline_signal {
            context.cancellation = Some(signal.clone());
        }

        // `run_handler` and `chain(context)` run inside the guarded future, so a middleware
        // layer that panics while building its future is caught too. With no middleware the
        // handler takes the validated input itself, without a copy.
        let run = run_guarded(async move {
            if middleware.is_empty() {
                run_handler(command, input, context).await
            } else {
                let state = CallState::of(&context);
                let chain = middleware_chain(&command, &middleware, Arc::new(input), state);
                chain(context).await
            }
        });

        // The deadline covers the chain only: a slow journal append cannot turn a finished call
        // into a TIMEOUT, and a call that timed out is not recorded.
        let result = match effective_timeout_ms {
            #[cfg(feature = "native")]
            Some(timeout_ms) => {
                match tokio::time::timeout(Duration::from_millis(timeout_ms), run).await {
                    Ok(result) => result,
                    Err(_) => {
                        if let Some(signal) = &deadline_signal {
                            signal.cancel();
                        }
                        return failure(command_timeout_error(name, timeout_ms));
                    }
                }
            }
            _ => run.await,
        };
        match (journal, recording) {
            (Some(recorder), Some(recording)) => recorder.finish(recording, result).await,
            _ => result,
        }
    }

    /// `input` validated against `command`'s schema, defaults applied, exactly as
    /// [`CommandRegistry::execute`] validates it before the middleware: the MCP server's
    /// host-verified gate validates with it before asking anyone, so the person decides on the
    /// input that runs. A host asking a person through a channel of its own (a terminal that
    /// waits for a decision made elsewhere) validates with it too, so that
    /// [`crate::input_digest`] of the result names what will run.
    ///
    /// # Errors
    /// `VALIDATION_ERROR`, as [`CommandRegistry::execute`] answers it.
    pub fn validate(
        &self,
        command: &CommandDefinition,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, Box<CommandError>> {
        let max_issues = self.max_validation_issues();
        let schema = read_lock(&self.commands)
            .schemas
            .get(&command.name)
            .cloned();
        match schema {
            Some(schema) => {
                crate::schema_validation::execute_with_limit(&schema, input, max_issues)
            }
            None => {
                crate::validation::validate_input_with_limit(&command.parameters, input, max_issues)
            }
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
    /// never change the trace ID, interface or timeout. With
    /// [`CommandInterface::Apps`] they are dropped: an app's batch is the app's,
    /// and only the host's own context may say who called.
    pub async fn execute_batch_with_context(
        &self,
        request: BatchRequest<serde_json::Value>,
        context: CommandContext,
    ) -> BatchResult<serde_json::Value> {
        let start_time = Instant::now();
        let started_at = chrono::Utc::now().to_rfc3339();
        let options = request.options.clone().unwrap_or_default();
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
        if let Some(limit_error) = self.check_batch_limits(&request) {
            return create_failed_batch_result(limit_error, &started_at);
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
        // An app's batch comes from the app: its own `context` must not reach the grant check,
        // which reads only what the host's trusted code set (`spec/command-metadata.md`,
        // "App-to-app calls").
        if base_context.interface != Some(CommandInterface::Apps) {
            for (key, value) in request.context.into_iter().flatten() {
                base_context.extra.entry(key).or_insert(value);
            }
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
        let caller_cancellation = base_context.cancellation.clone();
        #[cfg(feature = "native")]
        let batch_deadline_signal = deadline.map(|_| match &caller_cancellation {
            Some(parent) => parent.child(),
            None => crate::cancellation::CancellationSignal::new(),
        });
        #[cfg(feature = "native")]
        if let Some(signal) = &batch_deadline_signal {
            base_context.cancellation = Some(signal.clone());
        }
        let caller_cancelled = || {
            caller_cancellation
                .as_ref()
                .is_some_and(crate::cancellation::CancellationSignal::is_cancelled)
        };
        let mut pending = request.commands.into_iter().enumerate();
        let mut active: FuturesUnordered<BatchExecutionFuture<'_>> = FuturesUnordered::new();
        let mut results: Vec<Option<BatchCommandResult<serde_json::Value>>> =
            (0..total_commands).map(|_| None).collect();
        let mut failures = 0usize;
        let mut stopped = false;
        let mut timed_out = false;

        loop {
            while !stopped && !caller_cancelled() && active.len() < parallelism {
                let Some((index, cmd)) = pending.next() else {
                    break;
                };
                let (id, command_name) = command_metadata[index].clone();
                let context = base_context
                    .clone()
                    .with_trace_id(format!("{batch_trace_id}-{index}"));
                let timeout_error = &timeout_error;
                #[cfg(feature = "native")]
                let batch_deadline_signal = batch_deadline_signal.clone();
                active.push(Box::pin(async move {
                    let command_start = Instant::now();
                    let name = command_name.clone();
                    let execution = self.execute(&name, cmd.input, Some(context));
                    let result = match deadline {
                        None => Some(execution.await),
                        Some(deadline) => {
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            if remaining.is_zero() {
                                #[cfg(feature = "native")]
                                if let Some(signal) = &batch_deadline_signal {
                                    signal.cancel();
                                }
                                None
                            } else {
                                #[cfg(feature = "native")]
                                {
                                    match tokio::time::timeout(remaining, execution).await {
                                        Ok(result) => Some(result),
                                        Err(_) => {
                                            if let Some(signal) = &batch_deadline_signal {
                                                signal.cancel();
                                            }
                                            None
                                        }
                                    }
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
                    } else if caller_cancelled() {
                        CommandError::new(
                            error_codes::COMMAND_CANCELLED,
                            "Command cancelled before starting",
                        )
                        .with_suggestion("Start the command again if the result is still needed")
                        .with_retryable(false)
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

/// Standard `COMMAND_CANCELLED` error (`spec/execution-controls.md`).
fn command_cancelled_error(name: &str) -> CommandError {
    CommandError::new(
        error_codes::COMMAND_CANCELLED,
        format!(
            "Command '{}' was cancelled before it started",
            truncate_name(name)
        ),
    )
    .with_suggestion("Retry with a fresh signal if the command is still needed.")
    .with_retryable(false)
}

/// Standard `TIMEOUT` error (`spec/execution-controls.md`).
#[cfg(feature = "native")]
fn command_timeout_error(name: &str, timeout_ms: u64) -> CommandError {
    let mut details = HashMap::new();
    details.insert("command".to_string(), serde_json::json!(name));
    details.insert("timeoutMs".to_string(), serde_json::json!(timeout_ms));
    CommandError::new(
        error_codes::TIMEOUT,
        format!("Command '{}' timed out after {}ms", truncate_name(name), timeout_ms),
    )
    .with_suggestion(
        "Retry with a larger timeout. The command was signalled to abort but may have completed, so check its effect before retrying a mutation.",
    )
    .with_retryable(true)
    .with_details(details)
}

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
/// The returned function can be called more than once (a retry middleware calls `next` again).
/// Every layer shares `input`; the handler step makes the one copy the handler owns. The context
/// moves down the chain, so no layer copies it unless it calls `next` more than once. Each step
/// (every layer and the handler) puts `state`, the call's own state from before the chain, back
/// on the context it is given, so a middleware refines only the other public fields.
fn middleware_chain(
    command: &Arc<CommandDefinition>,
    middleware: &[CommandMiddleware],
    input: Arc<serde_json::Value>,
    state: CallState,
) -> MiddlewareNext {
    let state = Arc::new(state);
    let handler: MiddlewareNext = {
        let command = Arc::clone(command);
        let input = Arc::clone(&input);
        let state = Arc::clone(&state);
        Arc::new(move |mut context| {
            state.restore(&mut context);
            run_handler(Arc::clone(&command), (*input).clone(), context)
        })
    };

    middleware.iter().rev().fold(handler, |next, layer| {
        let layer = Arc::clone(layer);
        let name = command.name.clone();
        let input = Arc::clone(&input);
        let state = Arc::clone(&state);
        Arc::new(move |mut context| {
            state.restore(&mut context);
            layer(name.clone(), Arc::clone(&input), context, Arc::clone(&next))
        })
    })
}

/// The handler step at the end of the chain: the approval admission check, the handler, the
/// output budget and the actor kind.
fn run_handler(
    command: Arc<CommandDefinition>,
    input: serde_json::Value,
    mut context: CommandContext,
) -> BoxFuture<'static, CommandResult<serde_json::Value>> {
    // A declared approval policy holds without the approval middleware (#1886): a command
    // whose policy is neither unset nor `NotRequired` runs only on an admission that names
    // it and this validated input, taken here, so one admission runs one handler. A
    // policy function is not evaluated here; declaring one needs an approval step.
    // A gate declared only in the approval middleware's list is taken here too.
    let admission = context.approval_admission.take();
    let gated = crate::approval::admission::gates(command.approval.as_ref())
        || admission
            .as_ref()
            .is_some_and(|admission| admission.gated());
    let refused = gated
        .then(|| {
            admission.map_or(crate::approval::admission::Taken::Missing, |admission| {
                admission.take(&command.name, &input)
            })
        })
        .filter(|taken| *taken != crate::approval::admission::Taken::Admitted);
    if let Some(taken) = refused {
        return Box::pin(std::future::ready(failure(approval_unavailable(
            &command.name,
            taken,
        ))));
    }
    // Relay evidence and the approval relay serve the call that reached the middleware,
    // never a command the handler runs in process with this context.
    context.relay_evidence = None;
    context.up_front_approval = None;
    if context.approval_relay.is_some() {
        context.approval_relay = Some(Arc::new(
            crate::approval::relay::ApprovalRelayChannel::never_asks(),
        ));
    }
    Box::pin(async move {
        // Re-check immediately before handler start (including after an approval wait).
        if context.is_cancelled() {
            return failure(command_cancelled_error(&command.name));
        }
        // Only the kind is reported, never the actor's id or label.
        let actor_kind = context.actor.as_ref().map(|actor| actor.kind);
        let output_budget = context.output_budget;
        let mut result = command.execute(input, context).await;
        // The output budget check (`spec/output-budgets.md`, B5): right after the
        // handler, before `metadata` is stamped and before any middleware sees it.
        if let Some(limit) = output_budget {
            result = crate::output_budget::check_result(&command, limit, result);
        }
        if let Some(actor_kind) = actor_kind {
            let metadata = result.metadata.get_or_insert_with(ResultMetadata::new);
            metadata.actor_kind = Some(actor_kind);
            // A handler that still writes the key into `extra` would serialize it twice.
            metadata.extra.remove("actorKind");
        }
        result
    })
}

/// `APPROVAL_UNAVAILABLE` for a gated dispatch no approval step admitted (#1886):
/// `details.reason` is `no-approval-step` when none ever did, else `admission-mismatch`.
fn approval_unavailable(name: &str, taken: crate::approval::admission::Taken) -> CommandError {
    use crate::approval::admission::Taken;
    let (reason, suggestion) = match taken {
        Taken::Missing => ("no-approval-step", format!("Tell the user that {name} needs their approval and this server has no approval step; do not retry. The operator adds the approval middleware (create_approval_middleware; enable the `approval` feature) or removes the command's approval policy.")),
        Taken::Mismatch | Taken::Admitted => ("admission-mismatch", "Do not retry: this call is not the one approved. The operator moves middleware that retries or changes input before the approval middleware.".to_owned()),
    };
    CommandError::new(
        error_codes::APPROVAL_UNAVAILABLE,
        format!("{name} needs a person's approval, and this server cannot ask for it"),
    )
    .with_suggestion(suggestion)
    .with_retryable(false)
    .with_details(std::collections::HashMap::from([(
        "reason".to_owned(),
        serde_json::json!(reason),
    )]))
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

/// Keywords of the schema subset (`spec/validation.md`) whose value is a schema.
const SCHEMA_KEYWORDS: [&str; 11] = [
    "items",
    "additionalProperties",
    "not",
    "if",
    "then",
    "else",
    "contains",
    "propertyNames",
    "additionalItems",
    "unevaluatedItems",
    "unevaluatedProperties",
];
/// Keywords whose value is an array of schemas.
const SCHEMA_LIST_KEYWORDS: [&str; 5] = ["allOf", "anyOf", "oneOf", "prefixItems", "items"];
/// Keywords whose value maps names to schemas. Draft-07 `dependencies` maps a name to a schema or
/// to a list of property names; only a schema is walked.
const SCHEMA_MAP_KEYWORDS: [&str; 6] = [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependentSchemas",
    "dependencies",
];

/// Point every `"$ref": "#"` naming `schema`'s root, outside any nested schema resource, at
/// `target`. Values and annotations (`const`, `enum`, `default`, `examples`) are left alone.
fn retarget_root(schema: &mut serde_json::Value, target: &str, root: bool) {
    use serde_json::Value;
    if !root && crate::schema_validation::starts_resource(schema) {
        return;
    }
    let Value::Object(object) = schema else {
        return;
    };
    for (key, value) in object.iter_mut() {
        let key = key.as_str();
        if key == "$ref" && value == "#" {
            *value = Value::String(target.to_owned());
        } else if SCHEMA_LIST_KEYWORDS.contains(&key) && value.is_array() {
            for item in value.as_array_mut().into_iter().flatten() {
                retarget_root(item, target, false);
            }
        } else if SCHEMA_KEYWORDS.contains(&key) {
            retarget_root(value, target, false);
        } else if SCHEMA_MAP_KEYWORDS.contains(&key) {
            for item in value
                .as_object_mut()
                .into_iter()
                .flat_map(|map| map.values_mut())
            {
                retarget_root(item, target, false);
            }
        }
    }
}

/// The MCP `outputSchema` of a command tool: the CommandResult envelope, with `data` typed by
/// `data_schema` (`spec/command-metadata.md`, "Structured results").
///
/// `$schema` is dropped. When `data` starts a schema resource (a string `$id` that is not a bare
/// fragment, the validators' test), its local references resolve against it, so its definitions
/// stay inside it. Otherwise its definitions move to the envelope, and a `"$ref": "#"` that named
/// `data` becomes `"#/properties/data"`, since `#` now names the envelope.
pub fn command_result_output_schema(data_schema: &serde_json::Value) -> serde_json::Value {
    let mut data = data_schema.clone();
    let mut hoisted = serde_json::Map::new();
    if let Some(object) = data.as_object_mut() {
        object.remove("$schema");
    }
    if !crate::schema_validation::starts_resource(&data) {
        retarget_root(&mut data, "#/properties/data", true);
        if let Some(object) = data.as_object_mut() {
            for key in ["$defs", "definitions"] {
                if let Some(definitions) = object.remove(key) {
                    hoisted.insert(key.to_owned(), definitions);
                }
            }
        }
    }
    let mut envelope = serde_json::json!({
        "type": "object",
        "properties": {
            "success": { "type": "boolean" },
            "data": data,
            "error": {
                "type": "object",
                "properties": {
                    "code": { "type": "string" },
                    "message": { "type": "string" },
                    "suggestion": { "type": "string" },
                    "retryable": { "type": "boolean" },
                },
                "required": ["code", "message"],
            },
            "metadata": { "type": "object" },
        },
        "required": ["success"],
    });
    if let Some(object) = envelope.as_object_mut() {
        object.extend(hoisted);
    }
    envelope
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

/// Refuse a command whose output budget declaration is out of bounds, naming the command and the
/// field (`spec/output-budgets.md`, B1).
fn validate_output_budget(command: &CommandDefinition) -> Result<(), String> {
    match &command.output_budget {
        Some(budget) => budget
            .check()
            .map_err(|reason| format!("Command '{}': {reason}", command.name)),
        None => Ok(()),
    }
}

/// Refuse a command whose `scopes` hold something that is not a scope token, naming the command
/// and the scope (`spec/command-metadata.md`, "Scopes").
fn validate_scopes(command: &CommandDefinition) -> Result<(), String> {
    for scope in command.scopes.iter().flatten() {
        if !crate::credentials::is_scope_token(scope) {
            return Err(format!(
                "Command '{}': scope {scope:?} is not an OAuth scope token (one or more visible ASCII characters other than '\"' and '\\', RFC 6749 3.3)",
                command.name
            ));
        }
    }
    Ok(())
}

/// The registration check of the settings that make a call ask a person: `confirm_prompt`, an
/// approval policy other than `not-required`, and `confirmation_mode`.
///
/// A command that may run as a task (`task: optional` or `required`) is refused beside any of
/// the three, naming the command and the setting (`spec/command-metadata.md`, "Tasks": a task
/// never asks a person, so no AFD task is ever `input_required`).
fn validate_person_gates(command: &CommandDefinition) -> Result<(), String> {
    let task = command.task_support();
    if !task.allows_task() {
        return Ok(());
    }
    let asks_approval = !matches!(
        command.approval,
        None | Some(crate::ApprovalPolicy::NotRequired)
    );
    let gate = if command.confirm_prompt.is_some() {
        Some("confirm_prompt")
    } else if asks_approval {
        Some("an approval policy other than not-required")
    } else if command.confirmation_mode.is_some() {
        Some("confirmation_mode")
    } else {
        None
    };
    match gate {
        Some(gate) => Err(format!(
            "Command '{}': task \"{task}\" cannot be combined with {gate}: a task never asks a person (spec/command-metadata.md, \"Tasks\")",
            command.name
        )),
        None => Ok(()),
    }
}

/// Refuse a command whose extra tool `_meta` breaks the key rule, naming the command and the key.
fn validate_tool_meta(command: &CommandDefinition) -> Result<(), String> {
    for (key, value) in command.tool_meta.iter().flatten() {
        crate::meta_keys::check_meta_entry(key, value, true)
            .map_err(|reason| format!("Command '{}': {reason}", command.name))?;
    }
    Ok(())
}

pub fn create_command_registry() -> CommandRegistry {
    CommandRegistry::new()
}

#[cfg(test)]
mod tests;
