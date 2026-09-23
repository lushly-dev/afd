//! Command definition and registry types.
//!
//! Commands are the core abstraction in AFD. Every application action
//! is defined as a command with a clear schema.

use async_trait::async_trait;
use futures_util::{stream::FuturesUnordered, FutureExt, StreamExt};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use crate::batch::{
    create_batch_result, create_failed_batch_result, BatchCommandResult, BatchRequest, BatchResult,
    BatchTiming,
};
use crate::errors::{error_codes, CommandError};
use crate::handoff::HandoffCommandLike;
use crate::result::{failure, CommandResult, ResultMetadata};

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

/// Controls which interfaces a command is exposed to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExposeOptions {
    #[serde(default = "default_true")]
    pub palette: bool,
    #[serde(default = "default_false")]
    pub mcp: bool,
    #[serde(default = "default_true")]
    pub agent: bool,
    #[serde(default = "default_false")]
    pub cli: bool,
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

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/// Context provided to command handlers.
#[derive(Debug, Clone, Default)]
pub struct CommandContext {
    /// Unique ID for this command invocation.
    pub trace_id: Option<String>,

    /// Timeout in milliseconds.
    pub timeout_ms: Option<u64>,

    /// Custom context values.
    pub extra: HashMap<String, serde_json::Value>,
}

impl CommandContext {
    /// Create a new context with a trace ID.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the trace ID.
    pub fn with_trace_id(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Set the timeout.
    pub fn with_timeout(mut self, timeout_ms: u64) -> Self {
        self.timeout_ms = Some(timeout_ms);
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

/// Type alias for async command handler function.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Deferred execution function used by command middleware.
pub type MiddlewareNext =
    Arc<dyn Fn() -> BoxFuture<'static, CommandResult<serde_json::Value>> + Send + Sync>;

/// Middleware function type for intercepting command execution.
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

    /// Execute the command.
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

/// Registry for managing command definitions.
pub struct CommandRegistry {
    commands: HashMap<String, Arc<CommandDefinition>>,
}

impl CommandRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self {
            commands: HashMap::new(),
        }
    }

    /// Register a command.
    ///
    /// # Errors
    /// Returns an error if a command with the same name already exists.
    pub fn register(&mut self, command: CommandDefinition) -> Result<(), String> {
        validate_command_name(&command.name)?;

        if self.commands.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        self.commands
            .insert(command.name.clone(), Arc::new(command));
        Ok(())
    }

    /// Get a command by name.
    pub fn get(&self, name: &str) -> Option<Arc<CommandDefinition>> {
        self.commands.get(name).cloned()
    }

    /// Check if a command exists.
    pub fn has(&self, name: &str) -> bool {
        self.commands.contains_key(name)
    }

    /// Get all registered commands.
    pub fn list(&self) -> Vec<Arc<CommandDefinition>> {
        self.commands.values().cloned().collect()
    }

    /// Get commands by category.
    pub fn list_by_category(&self, category: &str) -> Vec<Arc<CommandDefinition>> {
        self.commands
            .values()
            .filter(|cmd| cmd.category.as_deref() == Some(category))
            .cloned()
            .collect()
    }

    /// Get all handoff commands.
    pub fn list_handoff_commands(&self) -> Vec<Arc<CommandDefinition>> {
        self.commands
            .values()
            .filter(|cmd| crate::handoff::is_handoff_command(cmd.as_ref()))
            .cloned()
            .collect()
    }

    /// Execute a command by name.
    pub async fn execute(
        &self,
        name: &str,
        input: serde_json::Value,
        context: Option<CommandContext>,
    ) -> CommandResult<serde_json::Value> {
        let Some(command) = self.commands.get(name) else {
            return failure(
                CommandError::new(
                    error_codes::COMMAND_NOT_FOUND,
                    format!("Command '{name}' not found"),
                )
                .with_suggestion("Use 'afd tools' to see available commands")
                .with_retryable(false),
            );
        };

        command.execute(input, context.unwrap_or_default()).await
    }

    /// Execute multiple commands in a batch.
    ///
    /// Uses partial success semantics, as in TypeScript: every command runs
    /// unless `stopOnError` is set, and [`BatchResult::success`] is `true`
    /// whenever the batch itself ran. It is `false` only for an invalid
    /// request. A handler that panics produces an `INTERNAL_ERROR` result for
    /// its own command; the other results are kept.
    pub async fn execute_batch(
        &self,
        request: BatchRequest<serde_json::Value>,
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
                    "UNSUPPORTED_OPTION",
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

        let batch_trace_id = format!("batch-{}", chrono::Utc::now().timestamp_millis());
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
                let context =
                    CommandContext::new().with_trace_id(format!("{batch_trace_id}-{index}"));
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

impl Default for CommandRegistry {
    fn default() -> Self {
        Self::new()
    }
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
mod tests {
    use super::*;
    use crate::batch::{BatchCommand, BatchOptions};
    use crate::result::success;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestHandler;

    /// Panics when the input has `"panic": true`; otherwise echoes the input.
    struct PanickingHandler;

    #[async_trait]
    impl CommandHandler for PanickingHandler {
        async fn execute(
            &self,
            input: serde_json::Value,
            _context: CommandContext,
        ) -> CommandResult<serde_json::Value> {
            if input.get("panic") == Some(&serde_json::Value::Bool(true)) {
                panic!("handler bug");
            }
            success(input)
        }
    }

    fn work_registry() -> (CommandRegistry, Arc<AtomicUsize>) {
        let peak = Arc::new(AtomicUsize::new(0));
        let mut registry = CommandRegistry::new();
        registry
            .register(CommandDefinition::new(
                "work-run",
                "Runs controlled work",
                vec![],
                ControlledHandler {
                    active: Arc::new(AtomicUsize::new(0)),
                    peak: Arc::clone(&peak),
                },
            ))
            .unwrap();
        (registry, peak)
    }

    struct ControlledHandler {
        active: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl CommandHandler for ControlledHandler {
        async fn execute(
            &self,
            input: serde_json::Value,
            _context: CommandContext,
        ) -> CommandResult<serde_json::Value> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(active, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            self.active.fetch_sub(1, Ordering::SeqCst);
            if input.get("fail") == Some(&serde_json::Value::Bool(true)) {
                failure(CommandError::new("EXPECTED", "controlled failure"))
            } else {
                success(input)
            }
        }
    }

    #[async_trait]
    impl CommandHandler for TestHandler {
        async fn execute(
            &self,
            input: serde_json::Value,
            _context: CommandContext,
        ) -> CommandResult<serde_json::Value> {
            success(serde_json::json!({ "echo": input }))
        }
    }

    #[tokio::test]
    async fn test_command_registry() {
        let mut registry = CommandRegistry::new();

        let cmd = CommandDefinition::new(
            "test-echo",
            "Echoes input back",
            vec![CommandParameter::required_string(
                "message",
                "Message to echo",
            )],
            TestHandler,
        );

        registry.register(cmd).unwrap();
        assert!(registry.has("test-echo"));

        let result = registry
            .execute("test-echo", serde_json::json!({"message": "hello"}), None)
            .await;

        assert!(result.success);
    }

    #[tokio::test]
    async fn test_batch_bounds_concurrency_and_preserves_order() {
        let (registry, peak) = work_registry();
        let request = BatchRequest::new(
            (0..4)
                .map(|index| {
                    BatchCommand::new("work-run", serde_json::json!({"index": index}))
                        .with_id(format!("request-{index}"))
                })
                .collect(),
        )
        .with_options(BatchOptions::new().with_parallelism(2));

        let result = registry.execute_batch(request).await;

        assert_eq!(peak.load(Ordering::SeqCst), 2);
        assert_eq!(
            result
                .results
                .iter()
                .map(|result| (result.id.as_str(), result.index))
                .collect::<Vec<_>>(),
            vec![
                ("request-0", 0),
                ("request-1", 1),
                ("request-2", 2),
                ("request-3", 3)
            ]
        );
        assert!(result
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.trace_id.as_deref())
            .is_some_and(|trace_id| trace_id.starts_with("batch-")));
    }

    #[tokio::test]
    async fn test_batch_continues_after_failure_by_default() {
        let (registry, _) = work_registry();
        let request = BatchRequest::new(vec![
            BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("first"),
            BatchCommand::new("work-run", serde_json::json!({})),
            BatchCommand::new("missing-command", serde_json::json!({})),
        ]);

        let result = registry.execute_batch(request).await;

        assert!(result.success, "a batch that ran is successful");
        assert_eq!(result.summary.success_count, 1);
        assert_eq!(result.summary.failure_count, 2);
        assert_eq!(result.summary.skipped_count, 0);
        assert!(result.results[1].result.success);
        assert_eq!(result.results[0].id, "first");
        assert_eq!(result.results[1].id, "cmd-1");
        assert_eq!(result.results[2].id, "cmd-2");
        assert_eq!(
            result.results[2].result.error.as_ref().unwrap().code,
            "COMMAND_NOT_FOUND"
        );
        assert_eq!(
            result.reasoning,
            "Executed 3 commands: 1 succeeded, 2 failed"
        );
    }

    #[tokio::test]
    async fn test_batch_stop_on_error_retains_skipped_correlation() {
        let (registry, _) = work_registry();
        let request = BatchRequest::new(vec![
            BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("first"),
            BatchCommand::new("work-run", serde_json::json!({})).with_id("second"),
        ])
        .with_options(BatchOptions::new().with_stop_on_error(true));

        let result = registry.execute_batch(request).await;

        assert!(result.success);
        assert_eq!(result.summary.failure_count, 1);
        assert_eq!(result.summary.skipped_count, 1);
        assert_eq!(result.results[1].id, "second");
        assert_eq!(result.results[1].index, 1);
        assert_eq!(result.results[1].command, "work-run");
        assert_eq!(
            result.results[1].result.error.as_ref().unwrap().code,
            "COMMAND_SKIPPED"
        );
    }

    #[tokio::test]
    async fn test_batch_honors_deadline_and_max_failures() {
        let (registry, peak) = work_registry();
        let timed_out = registry
            .execute_batch(
                BatchRequest::new(vec![
                    BatchCommand::new("work-run", serde_json::json!({})).with_id("slow")
                ])
                .with_options(BatchOptions::new().with_timeout(1.0)),
            )
            .await;
        #[cfg(feature = "native")]
        assert_eq!(
            timed_out.results[0].result.error.as_ref().unwrap().code,
            "BATCH_TIMEOUT"
        );
        #[cfg(not(feature = "native"))]
        {
            assert!(!timed_out.success);
            assert_eq!(timed_out.error.as_ref().unwrap().code, "UNSUPPORTED_OPTION");
            assert!(timed_out.results.is_empty());
            assert_eq!(peak.load(Ordering::SeqCst), 0);
        }

        let failure_limited = registry
            .execute_batch(
                BatchRequest::new(vec![
                    BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("one"),
                    BatchCommand::new("work-run", serde_json::json!({"fail": true})).with_id("two"),
                    BatchCommand::new("work-run", serde_json::json!({})).with_id("three"),
                ])
                .with_options(BatchOptions::new().with_max_failures(2)),
            )
            .await;
        assert_eq!(failure_limited.summary.failure_count, 2);
        assert_eq!(failure_limited.summary.skipped_count, 1);
        assert_eq!(failure_limited.results[2].id, "three");
        let _ = peak;
    }

    #[tokio::test]
    async fn test_batch_rejects_invalid_options() {
        let (registry, _) = work_registry();
        for options in [
            BatchOptions::new().with_parallelism(0),
            BatchOptions::new().with_timeout(-5.0),
            BatchOptions::new().with_timeout(f64::NAN),
        ] {
            let result = registry
                .execute_batch(
                    BatchRequest::new(vec![BatchCommand::new("work-run", serde_json::json!({}))])
                        .with_options(options),
                )
                .await;
            assert!(!result.success);
            assert_eq!(result.error.as_ref().unwrap().code, "INVALID_BATCH_REQUEST");
        }
        let empty = registry.execute_batch(BatchRequest::new(vec![])).await;
        assert!(!empty.success);
    }

    #[tokio::test]
    async fn test_batch_huge_timeout_does_not_overflow() {
        let (registry, _) = work_registry();
        let result = registry
            .execute_batch(
                BatchRequest::new(vec![BatchCommand::new("work-run", serde_json::json!({}))])
                    .with_options(BatchOptions::new().with_timeout(f64::MAX)),
            )
            .await;
        assert_eq!(result.success, cfg!(feature = "native"));
    }

    #[tokio::test]
    async fn test_batch_panicking_handler_keeps_other_results() {
        let mut registry = CommandRegistry::new();
        registry
            .register(CommandDefinition::new(
                "panic-run",
                "Panics on request",
                vec![],
                PanickingHandler,
            ))
            .unwrap();
        let request = BatchRequest::new(vec![
            BatchCommand::new("panic-run", serde_json::json!({"n": 1})),
            BatchCommand::new("panic-run", serde_json::json!({"panic": true})),
            BatchCommand::new("panic-run", serde_json::json!({"n": 3})),
        ])
        .with_options(BatchOptions::new().with_parallelism(2));

        let result = registry.execute_batch(request).await;

        assert!(result.success);
        assert_eq!(result.results.len(), 3);
        assert_eq!(
            result.results[0].result.data,
            Some(serde_json::json!({"n": 1}))
        );
        let error = result.results[1].result.error.as_ref().unwrap();
        assert_eq!(error.code, "INTERNAL_ERROR");
        assert!(!error.message.contains("handler bug"));
        assert_eq!(
            result.results[2].result.data,
            Some(serde_json::json!({"n": 3}))
        );
        assert_eq!(result.summary.success_count, 2);
        assert_eq!(result.summary.failure_count, 1);
    }

    #[test]
    fn test_validate_command_name() {
        assert!(validate_command_name("todo-create").is_ok());
        assert!(validate_command_name("create").is_err());
        assert!(validate_command_name("TodoCreate").is_err());
    }

    #[test]
    fn test_default_expose_values() {
        let expose = default_expose();
        assert!(expose.palette);
        assert!(expose.agent);
        assert!(!expose.mcp);
        assert!(!expose.cli);
    }

    #[tokio::test]
    async fn test_command_not_found() {
        let registry = CommandRegistry::new();

        let result = registry
            .execute("nonexistent", serde_json::json!({}), None)
            .await;

        assert!(!result.success);
        assert_eq!(result.error.as_ref().unwrap().code, "COMMAND_NOT_FOUND");
    }

    #[test]
    fn test_command_to_mcp_tool() {
        let cmd = CommandDefinition::new(
            "test-create",
            "Creates a test",
            vec![
                CommandParameter::required_string("name", "Test name"),
                CommandParameter::optional_string("description", "Test description"),
            ],
            TestHandler,
        );

        let tool = command_to_mcp_tool(&cmd);

        assert_eq!(tool.name, "test-create");
        assert_eq!(tool.input_schema.required, vec!["name"]);
        assert!(tool.input_schema.properties.contains_key("name"));
        assert!(tool.input_schema.properties.contains_key("description"));
    }

    #[test]
    fn test_handoff_command() {
        let cmd =
            CommandDefinition::new("stream-connect", "Connect to stream", vec![], TestHandler)
                .as_handoff_with_protocol("websocket");

        assert!(cmd.handoff);
        assert_eq!(cmd.handoff_protocol, Some("websocket".to_string()));
        assert!(crate::handoff::is_handoff_command(&cmd));
    }

    #[test]
    fn test_list_handoff_commands() {
        let mut registry = CommandRegistry::new();

        let cmd1 = CommandDefinition::new("test-regular", "Regular command", vec![], TestHandler);

        let cmd2 =
            CommandDefinition::new("stream-connect", "Connect to stream", vec![], TestHandler)
                .as_handoff_with_protocol("websocket");

        let cmd3 = CommandDefinition::new(
            "events-subscribe",
            "Subscribe to events",
            vec![],
            TestHandler,
        )
        .with_tags(vec!["handoff".to_string(), "events".to_string()]);

        registry.register(cmd1).unwrap();
        registry.register(cmd2).unwrap();
        registry.register(cmd3).unwrap();

        let handoff_commands = registry.list_handoff_commands();
        assert_eq!(handoff_commands.len(), 2);
    }
}
