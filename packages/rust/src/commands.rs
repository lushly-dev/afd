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

use crate::batch::{
    create_batch_result, create_failed_batch_result, BatchCommandResult, BatchRequest, BatchResult,
    BatchTiming,
};
use crate::errors::{error_codes, CommandError};
use crate::handoff::HandoffCommandLike;
use crate::result::{failure, CommandResult, ResultMetadata};
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
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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
    #[serde(skip_serializing_if = "Option::is_none")]
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

/// Context provided to command handlers.
///
/// Build it with [`CommandContext::new`] and the `with_*` methods.
#[derive(Debug, Clone, Default)]
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

    /// Custom context values.
    pub extra: HashMap<String, serde_json::Value>,
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
    /// Metadata for hosts that scope commands by an active context: see
    /// [`CommandDefinition::is_accessible_in_context`]. The registry does not
    /// enforce it.
    pub contexts: Option<Vec<String>>,

    /// Whether this command performs side effects.
    pub mutation: bool,

    /// Estimated execution time.
    pub execution_time: Option<ExecutionTime>,

    /// Which interfaces this command is exposed to.
    pub expose: ExposeOptions,

    /// Concrete input examples to help agents construct valid payloads.
    pub examples: Option<Vec<CommandExample>>,
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
        }
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

    /// Set the contexts this command belongs to (metadata only).
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
}

/// Commands by name, plus their registration order.
#[derive(Default)]
struct RegisteredCommands {
    by_name: HashMap<String, Arc<CommandDefinition>>,
    ordered: Vec<Arc<CommandDefinition>>,
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

    /// Add a middleware to the chain that wraps every command execution.
    ///
    /// Middleware runs in the order it was added (the first added is the
    /// outermost), after input validation, with the validated input. Each one
    /// calls `next()` to run the rest of the chain and can inspect or replace
    /// the result, or return without calling `next()` to short-circuit.
    pub fn add_middleware(&self, middleware: CommandMiddleware) {
        write_lock(&self.middleware).push(middleware);
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
    /// 1. An unknown name returns `COMMAND_NOT_FOUND`.
    /// 2. When `context.interface` is set, a command not exposed to that
    ///    interface returns `COMMAND_NOT_EXPOSED` (see [`ExposeOptions`]).
    /// 3. A `context.timeout_ms` without the `native` feature returns
    ///    `UNSUPPORTED_OPTION`.
    /// 4. The input is validated against the command's `parameters`, and
    ///    parameter defaults are applied; invalid input returns
    ///    `VALIDATION_ERROR` with the problems in `details.errors`.
    /// 5. The middleware chain and then the handler run with the validated
    ///    input. With `context.timeout_ms`, a run that outlasts it returns
    ///    `TIMEOUT` (this needs a Tokio runtime with time enabled).
    ///
    /// The handler is not called when any check fails.
    pub async fn execute(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
    ) -> CommandResult<serde_json::Value> {
        let context = context.unwrap_or_default();
        let Some(command) = self.get(name) else {
            return failure(
                CommandError::new(
                    error_codes::COMMAND_NOT_FOUND,
                    format!("Command '{}' not found", truncate_name(name)),
                )
                .with_suggestion("Use 'afd-help' or 'afd tools' to see available commands")
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

        let input = match validate_input(&command.name, &command.parameters, input) {
            Ok(input) => input,
            Err(error) => return failure(*error),
        };

        let timeout_ms = context.timeout_ms;
        let middleware = read_lock(&self.middleware).clone();
        let chain = middleware_chain(&command, &middleware, input, context);

        match timeout_ms {
            #[cfg(feature = "native")]
            Some(timeout_ms) => {
                match tokio::time::timeout(Duration::from_millis(timeout_ms), chain()).await {
                    Ok(result) => result,
                    Err(_) => failure(CommandError::timeout(&command.name, timeout_ms)),
                }
            }
            _ => chain().await,
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
    /// request. A handler that panics produces an `INTERNAL_ERROR` result for
    /// its own command; the other results are kept.
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
        let invalid = |message: &str, suggestion: &str| {
            create_failed_batch_result(
                CommandError::new("INVALID_BATCH_REQUEST", message)
                    .with_suggestion(suggestion)
                    .with_retryable(false),
                &started_at,
            )
        };

        if request.commands.is_empty() {
            return invalid(
                "Batch request must contain at least one command",
                "Provide an array of commands to execute",
            );
        }

        let options = request.options.unwrap_or_default();
        if options
            .timeout
            .is_some_and(|timeout| !timeout.is_finite() || timeout < 0.0)
        {
            return invalid(
                "Batch timeout must be a non-negative number",
                "Set timeout to a non-negative number of milliseconds or omit it",
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
        if parallelism == 0 || options.max_failures == Some(0) {
            return invalid(
                "Batch parallelism and maxFailures must be positive",
                "Set parallelism and maxFailures to values greater than zero",
            );
        }

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
                "BATCH_TIMEOUT",
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
                    let execution = run_guarded(self.execute(&name, cmd.input, Some(context)));
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
                    .is_some_and(|error| error.code == "BATCH_TIMEOUT");
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
                            "COMMAND_SKIPPED",
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

/// Longest command name echoed back in an error, as in TypeScript.
const MAX_ECHOED_NAME_LENGTH: usize = crate::similarity::MAX_SIMILARITY_INPUT_LENGTH;

/// `name` cut to [`MAX_ECHOED_NAME_LENGTH`] characters, with `…` when cut.
fn truncate_name(name: &str) -> String {
    match name.char_indices().nth(MAX_ECHOED_NAME_LENGTH) {
        None => name.to_string(),
        Some((end, _)) => format!("{}…", &name[..end]),
    }
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
            Box::pin(async move { command.execute(input, context).await })
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

/// The error reported in place of a result when a command handler panics.
///
/// The panic payload is not included: it may contain internal details.
pub(crate) fn handler_panic_error() -> CommandError {
    CommandError::new(error_codes::INTERNAL_ERROR, "The command handler panicked")
        .with_suggestion(
            "This is a bug in the command implementation. Report it, or retry with different input",
        )
        .with_retryable(false)
}

/// Run a command future, turning a panic into an `INTERNAL_ERROR` failure so
/// one handler cannot abort a whole batch or pipeline.
pub(crate) async fn run_guarded<F>(future: F) -> CommandResult<serde_json::Value>
where
    F: Future<Output = CommandResult<serde_json::Value>>,
{
    AssertUnwindSafe(future)
        .catch_unwind()
        .await
        .unwrap_or_else(|_| failure(handler_panic_error()))
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP TOOL CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

/// MCP Tool format for command export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
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

pub fn command_to_mcp_tool(command: &CommandDefinition) -> McpTool {
    let mut properties = HashMap::new();
    let mut required = Vec::new();

    for param in &command.parameters {
        let schema = param.schema.clone().unwrap_or_else(|| JsonSchema {
            schema_type: Some(param.param_type.clone()),
            description: Some(param.description.clone()),
            default: param.default.clone(),
            enum_values: param.enum_values.clone(),
            ..Default::default()
        });

        properties.insert(param.name.clone(), schema);

        if param.required {
            required.push(param.name.clone());
        }
    }

    McpTool {
        name: command.name.clone(),
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
