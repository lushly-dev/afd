//! Command definition and registry types.
//!
//! Commands are the core abstraction in AFD. Every application action
//! is defined as a command with a clear schema.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::batch::{
    BatchCommandResult, BatchRequest, BatchResult, BatchSummary, BatchTiming,
};
use crate::errors::CommandError;
use crate::handoff::HandoffCommandLike;
use crate::result::CommandResult;

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
    /// Unique command name using dot notation (e.g., 'document.create').
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
        if self.commands.contains_key(&command.name) {
            return Err(format!("Command '{}' is already registered", command.name));
        }
        self.commands.insert(command.name.clone(), Arc::new(command));
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
        let command = match self.commands.get(name) {
            Some(cmd) => cmd,
            None => {
                return CommandResult {
                    success: false,
                    data: None,
                    error: Some(CommandError {
                        code: "COMMAND_NOT_FOUND".to_string(),
                        message: format!("Command '{}' not found", name),
                        suggestion: Some("Use 'afd tools' to see available commands".to_string()),
                        retryable: Some(false),
                        details: None,
                        cause: None,
                    }),
                    confidence: None,
                    reasoning: None,
                    sources: None,
                    plan: None,
                    alternatives: None,
                    warnings: None,
                    metadata: None,
                };
            }
        };

        let ctx = context.unwrap_or_default();
        command.execute(input, ctx).await
    }

    /// Execute multiple commands in a batch.
    pub async fn execute_batch(
        &self,
        request: BatchRequest<serde_json::Value>,
    ) -> BatchResult<serde_json::Value> {
        let start_time = std::time::Instant::now();
        let started_at = chrono::Utc::now().to_rfc3339();

        if request.commands.is_empty() {
            return BatchResult {
                success: false,
                results: vec![],
                summary: BatchSummary::new(0, 0, 0, 0),
                timing: BatchTiming {
                    started_at,
                    ended_at: Some(chrono::Utc::now().to_rfc3339()),
                    total_ms: Some(0),
                    average_ms: None,
                },
                error: Some(CommandError {
                    code: "INVALID_BATCH_REQUEST".to_string(),
                    message: "Batch request must contain at least one command".to_string(),
                    suggestion: Some("Provide an array of commands to execute".to_string()),
                    retryable: Some(false),
                    details: None,
                    cause: None,
                }),
            };
        }

        let options = request.options;
        let mut results: Vec<BatchCommandResult<serde_json::Value>> = Vec::new();
        let mut stopped = false;

        for (_i, cmd) in request.commands.into_iter().enumerate() {
            if stopped {
                results.push(BatchCommandResult {
                    id: cmd.id,
                    command: cmd.command,
                    result: CommandResult {
                        success: false,
                        data: None,
                        error: Some(CommandError {
                            code: "COMMAND_SKIPPED".to_string(),
                            message: "Command skipped due to previous error".to_string(),
                            suggestion: None,
                            retryable: None,
                            details: None,
                            cause: None,
                        }),
                        confidence: None,
                        reasoning: None,
                        sources: None,
                        plan: None,
                        alternatives: None,
                        warnings: None,
                        metadata: None,
                    },
                    duration_ms: Some(0),
                });
                continue;
            }

            let cmd_start = std::time::Instant::now();
            let result = self.execute(&cmd.command, cmd.input, None).await;
            let duration_ms = cmd_start.elapsed().as_millis() as u64;

            let is_failure = !result.success;

            results.push(BatchCommandResult {
                id: cmd.id,
                command: cmd.command,
                result,
                duration_ms: Some(duration_ms),
            });

            if is_failure && !options.continue_on_error {
                stopped = true;
            }
        }

        let total_ms = start_time.elapsed().as_millis() as u64;
        let ended_at = chrono::Utc::now().to_rfc3339();

        let total = results.len();
        let succeeded = results.iter().filter(|r| r.result.success).count();
        let failed = total - succeeded;

        BatchResult {
            success: failed == 0,
            results,
            summary: BatchSummary::new(total, succeeded, failed, 0),
            timing: BatchTiming {
                started_at,
                ended_at: Some(ended_at),
                total_ms: Some(total_ms),
                average_ms: if total > 0 {
                    Some(total_ms / total as u64)
                } else {
                    None
                },
            },
            error: None,
        }
    }
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
    use crate::result::success;

    struct TestHandler;

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
            "test.echo",
            "Echoes input back",
            vec![CommandParameter::required_string("message", "Message to echo")],
            TestHandler,
        );

        registry.register(cmd).unwrap();
        assert!(registry.has("test.echo"));

        let result = registry
            .execute("test.echo", serde_json::json!({"message": "hello"}), None)
            .await;

        assert!(result.success);
    }

    #[tokio::test]
    async fn test_command_not_found() {
        let registry = CommandRegistry::new();

        let result = registry.execute("nonexistent", serde_json::json!({}), None).await;

        assert!(!result.success);
        assert_eq!(result.error.as_ref().unwrap().code, "COMMAND_NOT_FOUND");
    }

    #[test]
    fn test_command_to_mcp_tool() {
        let cmd = CommandDefinition::new(
            "test.create",
            "Creates a test",
            vec![
                CommandParameter::required_string("name", "Test name"),
                CommandParameter::optional_string("description", "Test description"),
            ],
            TestHandler,
        );

        let tool = command_to_mcp_tool(&cmd);

        assert_eq!(tool.name, "test.create");
        assert_eq!(tool.input_schema.required, vec!["name"]);
        assert!(tool.input_schema.properties.contains_key("name"));
        assert!(tool.input_schema.properties.contains_key("description"));
    }

    #[test]
    fn test_handoff_command() {
        let cmd = CommandDefinition::new(
            "stream.connect",
            "Connect to stream",
            vec![],
            TestHandler,
        )
        .as_handoff_with_protocol("websocket");

        assert!(cmd.handoff);
        assert_eq!(cmd.handoff_protocol, Some("websocket".to_string()));
        assert!(crate::handoff::is_handoff_command(&cmd));
    }

    #[test]
    fn test_list_handoff_commands() {
        let mut registry = CommandRegistry::new();

        let cmd1 = CommandDefinition::new(
            "test.regular",
            "Regular command",
            vec![],
            TestHandler,
        );

        let cmd2 = CommandDefinition::new(
            "stream.connect",
            "Connect to stream",
            vec![],
            TestHandler,
        )
        .as_handoff_with_protocol("websocket");

        let cmd3 = CommandDefinition::new(
            "events.subscribe",
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
