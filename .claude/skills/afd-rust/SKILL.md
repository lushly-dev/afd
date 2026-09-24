---
name: afd-rust
description: >
  Rust implementation patterns for AFD commands using the afd crate,
  CommandResult types, and async handlers. Covers command definition,
  schema design with JSON Schema, error handling, registry patterns,
  and testing. Use when: implementing commands in Rust, building Rust
  MCP servers, working with CommandResult types, or debugging Rust AFD code.
  Triggers: rust afd, rs command, CommandResult rust, CommandHandler,
  rust implementation, afd crate, cargo afd.
---

# AFD Rust Implementation

Patterns for implementing AFD commands in Rust.

## Parity Rule

Rust implementations SHOULD match the shared AFD capability set and agent-visible behavior, while keeping Rust-idiomatic data types, traits, and module boundaries where that improves fit.

- Core command surfaces MUST stay framework-agnostic.
- React or browser integrations SHOULD stay in examples or ecosystem layers.
- Cross-language parity does NOT require a 1:1 port of TypeScript or Python helper names.
- Shared parity features to evaluate include output schemas, validated examples, prerequisite metadata, context scoping, grouped/lazy discovery strategies, and the common meta-tool patterns exposed to agents.

## Crate Imports

```rust
// Core result types
use afd::{
    success, failure, success_with,
    CommandResult, ResultOptions,
    is_success, is_failure,
};

// Error types
use afd::{
    CommandError,
    validation_error, not_found_error, internal_error,
    error_codes,
};

// Command types
use afd::{
    CommandDefinition, CommandParameter, CommandContext,
    CommandExample, CommandHandler, CommandRegistry,
    ExposeOptions, default_expose, validate_command_name,
    JsonSchema, JsonSchemaType,
};

// Metadata types
use afd::{
    Warning, Source, PlanStep, Alternative,
    create_warning, create_source, create_step,
};

// Batch and streaming
use afd::{
    BatchRequest, BatchResult, BatchCommand,
    StreamChunk, StreamableCommand,
    create_progress_chunk, create_data_chunk,
    create_complete_chunk, create_error_chunk,
};

// Additional parity helpers
use afd::{
    create_handoff, create_mcp_request, create_mcp_response,
    create_telemetry_event, execute_pipeline,
    calculate_similarity, find_similar_tools,
};
```

## Command Result Types

### Success Response

```rust
use afd::{success, success_with, ResultOptions};

// Basic success
fn get_user() -> CommandResult<User> {
    let user = User { id: "123".into(), name: "Alice".into() };
    success(user)
}

// With UX metadata (recommended)
fn create_todo(title: &str) -> CommandResult<Todo> {
    let todo = Todo::new(title);

    success_with(todo, ResultOptions {
        reasoning: Some(format!("Created todo '{}'", title)),
        confidence: Some(1.0),
        ..Default::default()
    })
}

// With warnings
fn delete_todo(id: &str) -> CommandResult<DeleteResult> {
    let result = DeleteResult { id: id.to_string(), deleted: true };

    success_with(result, ResultOptions {
        reasoning: Some("Todo deleted permanently".to_string()),
        warnings: Some(vec![
            Warning::new("PERMANENT", "This action cannot be undone"),
        ]),
        ..Default::default()
    })
}
```

### Failure Response

```rust
use afd::{failure, CommandError};

// Using error constructors
fn get_todo(id: &str) -> CommandResult<Todo> {
    let todo = store.get(id);
    match todo {
        Some(t) => success(t),
        None => failure(CommandError::not_found("Todo", id)),
    }
}

// With custom suggestion
fn create_user(email: &str) -> CommandResult<User> {
    if store.email_exists(email) {
        return failure(CommandError::new(
            "CONFLICT",
            format!("Email '{}' already registered", email),
        ).with_suggestion("Use user-login instead, or reset password"));
    }
    // ... create user
}

// Validation error
fn update_priority(priority: &str) -> CommandResult<Todo> {
    let valid = ["low", "medium", "high"];
    if !valid.contains(&priority) {
        return failure(CommandError::validation(
            &format!("Invalid priority: {}. Must be one of {:?}", priority, valid),
            Some("Use 'low', 'medium', or 'high'"),
        ));
    }
    // ... update
}
```

## CommandError Constructors

```rust
use afd::CommandError;

// Not found
let err = CommandError::not_found("Todo", "123");
// -> { code: "NOT_FOUND", message: "Todo '123' not found" }

// Validation error
let err = CommandError::validation(
    "Title cannot be empty",
    Some("Provide a title between 1 and 200 characters"),
);

// Internal error
let err = CommandError::internal("Database connection failed");

// Custom error
let err = CommandError::new(
    "RATE_LIMITED",
    "Too many requests",
).with_suggestion("Wait 60 seconds before retrying");

// With retryable flag (CommandError is #[non_exhaustive]: use the builders)
let err = CommandError::new("TIMEOUT", "Request timed out")
    .with_suggestion("Try again in a few seconds")
    .with_retryable(true);

// CommandError implements Display ("TIMEOUT: Request timed out") and std::error::Error
```

## Command Definition

### Using CommandHandler Trait

```rust
use async_trait::async_trait;
use std::sync::Arc;

use afd::{CommandContext, CommandError, CommandHandler, CommandResult, failure, success};
use serde_json::Value;

struct CreateTodoHandler {
    store: Arc<TodoStore>,
}

#[async_trait]
impl CommandHandler for CreateTodoHandler {
    async fn execute(
        &self,
        input: Value,
        _context: CommandContext,
    ) -> CommandResult<Value> {
        // Parse input at the command boundary and return a CommandResult on failure.
        let title = match input.get("title").and_then(|value| value.as_str()) {
            Some(title) => title,
            None => return failure(CommandError::validation("title is required", None)),
        };

        // Execute logic
        let todo = self.store.create(title).await;

        // Return result
        success(serde_json::to_value(todo).unwrap())
    }
}
```

### Building CommandDefinition

```rust
use afd::{CommandDefinition, CommandParameter, JsonSchemaType};

let create_cmd = CommandDefinition::new(
    "todo-create",
    "Create a new todo item",
    vec![
        CommandParameter::required_string("title", "The todo title"),
        CommandParameter::optional_string("description", "Optional description")
            .with_default(serde_json::json!(null)),
        CommandParameter::required_string("priority", "Priority level")
            .with_enum(vec![
                serde_json::json!("low"),
                serde_json::json!("medium"),
                serde_json::json!("high"),
            ])
            .with_default(serde_json::json!("medium")),
    ],
    CreateTodoHandler { store: store.clone() },
)
.with_category("todo")
.as_mutation();
```

## CommandParameter Builders

```rust
use afd::{CommandParameter, JsonSchemaType};

// Required string
let param = CommandParameter::required_string("title", "The todo title");

// Optional string
let param = CommandParameter::optional_string("description", "Optional description");

// Required number
let param = CommandParameter::required_number("count", "Number of items");

// Required boolean
let param = CommandParameter::required_boolean("completed", "Completion status");

// With default value
let param = CommandParameter::required_string("priority", "Priority level")
    .with_default(serde_json::json!("medium"));

// With enum values
let param = CommandParameter::required_string("priority", "Priority level")
    .with_enum(vec![
        serde_json::json!("low"),
        serde_json::json!("medium"),
        serde_json::json!("high"),
    ]);
```

## Command Registry

```rust
use afd::{
    register_bootstrap_commands, validate_command_name, CommandContext, CommandDefinition,
    CommandInterface, CommandMiddleware, CommandRegistry, ExposeOptions,
};
use std::sync::Arc;

// Create registry. `register` takes &self, so an Arc'd registry can still grow.
let registry = Arc::new(CommandRegistry::new());

// Register commands
registry.register(create_todo_cmd).expect("valid command definition");
registry.register(
    list_todos_cmd
        .with_expose(ExposeOptions::new().with_mcp(true)) // other flags keep their defaults
        .with_requires(["todo-create"]),                  // metadata only
).expect("valid command definition");

// afd-help, afd-docs and afd-schema, describing this registry (including themselves)
register_bootstrap_commands(&registry).expect("no name clash");

validate_command_name("todo-create").expect("valid command name");

// Middleware wraps every execution; the first added is the outermost
let logging: CommandMiddleware = Arc::new(|name, _input, _context, next| {
    Box::pin(async move {
        let result = next().await;
        println!("{name}: {}", result.success);
        result
    })
});
registry.add_middleware(logging);

// Execute command. Before the handler runs, the registry:
// - validates input against `parameters` and fills defaults (VALIDATION_ERROR),
// - checks `expose` when the context names an interface (COMMAND_NOT_EXPOSED),
// - applies `timeout_ms` (TIMEOUT; needs the `native` feature).
let context = CommandContext::new()
    .with_interface(CommandInterface::Mcp)
    .with_timeout(5_000);
let result = registry.execute(
    "todo-create",
    serde_json::json!({"title": "Test"}),
    Some(context),
).await;
```

`CommandDefinition::execute` calls the handler directly and skips all of these checks; call
commands through the registry.

## Batch Execution

```rust
use afd::{BatchRequest, BatchCommand, BatchOptions};

// Create batch request. Every command runs unless stopOnError is set;
// commands without an ID are reported as `cmd-<index>`.
let request = BatchRequest::new(vec![
    BatchCommand::new("todo-create", serde_json::json!({"title": "First"})).with_id("first"),
    BatchCommand::new("todo-create", serde_json::json!({"title": "Second"})),
])
.with_options(BatchOptions::new().with_parallelism(4).with_timeout(5_000.0));

// Execute batch. `result.success` is true whenever the batch ran, even if some
// commands failed; a panicking handler becomes an INTERNAL_ERROR for that command.
// Every entry runs through `execute` (validation, exposure, middleware).
let result = registry.execute_batch(request).await;

// Or with a caller context (interface, trace ID); the request's `context`
// entries are added to each entry's `CommandContext::extra`.
let result = registry
    .execute_batch_with_context(mcp_request, CommandContext::new().with_interface(CommandInterface::Mcp))
    .await;

println!("Succeeded: {}", result.summary.success_count);
println!("Failed: {}", result.summary.failure_count);
println!("Skipped: {}", result.summary.skipped_count);
```

## Streaming Results

```rust
use afd::{
    StreamChunk, create_progress_chunk, create_data_chunk,
    create_complete_chunk, create_error_chunk,
};
use afd::CommandError;

// Progress update (a 0-1 fraction)
let progress = create_progress_chunk(0.5, "Processing items...");

// Partial data: (data, index, is_last)
let data = create_data_chunk(partial_result, 0, false);

// Final data
let final_data = create_data_chunk(complete_result, 1, true);

// Completion: (total_chunks, total_duration_ms), then optional data/reasoning/confidence
let complete = create_complete_chunk(2, 1500.0).with_data(final_result);

// Error during streaming: (error, chunks_before_error, recoverable)
let error = create_error_chunk(CommandError::internal("Stream interrupted"), 2, false);

// Every chunk serializes with its `type` discriminator; wrap with `.into()` for StreamChunk
let chunk: StreamChunk = progress.into();
```

## Metadata Types

## Current Parity Note

The Rust crate now includes parity helpers for:

- command ergonomics: `CommandExample`, `ExposeOptions`, `default_expose`, `validate_command_name`
- streaming: `StreamableCommand`, `consume_stream`, `create_timeout_controller`
- handoff and telemetry: `create_handoff`, `default_reconnect_policy`, `TelemetryEvent`
- MCP and pipelines: `create_mcp_request`, `create_mcp_response`, `execute_pipeline`
- discovery helpers: `calculate_similarity`, `find_similar_tools`

Status clarity for cross-language planning:

- Shared today: output schemas, examples, enforced exposure and input validation, middleware, `requires`/`contexts` metadata, bootstrap commands (`register_bootstrap_commands`), pipelines, discovery helpers, telemetry, handoff
- Not yet part of the Rust crate surface: an MCP server, active-context scoping at execution time (`contexts` is metadata; use `CommandDefinition::is_accessible_in_context`), and the server-side tool strategies exposed in TypeScript and Python
- Parity decisions SHOULD compare agent-visible behavior first, then document Rust-specific gaps explicitly instead of assuming every TS/Python feature already exists in the crate

### Warnings

```rust
use afd::{Warning, WarningSeverity, create_warning};

// Severity defaults to WarningSeverity::Warning (info | warning | caution)
let warning = create_warning("DEPRECATION", "This field is deprecated", None);

let warning = Warning::new("PERMANENT", "This action cannot be undone")
    .with_severity(WarningSeverity::Caution);
```

### Sources

```rust
use afd::{Source, SourceType, create_source};

// Serializes as {"type": "api", "title": "API Response"}
let source = create_source(SourceType::Api, Some("API Response"), None);

let source = Source::new(SourceType::Database)
    .with_id("users")
    .with_title("User Database")
    .with_location("users table")
    .with_relevance(0.99);
```

### Plan Steps

```rust
use afd::{PlanStep, PlanStepStatus, create_step, update_step_status};

// (id, action, description)
let step = create_step("validate", "validate", Some("Validate input"));

let mut step = PlanStep::new("process", "transform").with_depends_on(vec!["validate".into()]);
update_step_status(&mut step, PlanStepStatus::InProgress, None);
update_step_status(&mut step, PlanStepStatus::Complete, Some(serde_json::json!({"rows": 3})));
```

### Pipelines

Variable references follow `spec/pipeline-variables.md`: `$prev`, `$first`, `$steps[N]`,
`$steps.<alias>`, `$input` (from `PipelineRequest.input`, never the host context), each with an
optional path. Other `$` strings are literals; `$$` escapes. Unresolved references are omitted
from objects and `null` in arrays; inputs deeper than 64 levels are rejected.

```rust
use afd::{PipelineRequest, PipelineStep, execute_pipeline};

let request = PipelineRequest::new(vec![
    PipelineStep::new("user-get").with_input(serde_json::json!({"id": "$input.userId"})).with_alias("user"),
    PipelineStep::new("order-list").with_input(serde_json::json!({"userId": "$steps.user.id"})),
])
.with_input(serde_json::json!({"userId": 7}));

let result = execute_pipeline(&request, &executor, None).await;
```

## JSON Serialization

All AFD types use `camelCase` for JSON serialization:

```rust
let result = success(serde_json::json!({"name": "test"}));
let json = serde_json::to_string(&result).unwrap();

// Output: {"success":true,"data":{"name":"test"}}
// Note: Optional fields that are None are omitted
```

## Type Guards

```rust
use afd::{is_success, is_failure, CommandResult};

fn process_result<T>(result: &CommandResult<T>) {
    if is_success(result) {
        println!("Success: {:?}", result.data);
    } else if is_failure(result) {
        println!("Error: {:?}", result.error);
    }
}
```

## Error Handling Patterns

### Using Result Internally

Use `Result<T, CommandError>` inside helpers, then convert to `CommandResult<T>` at the command boundary.

```rust
use afd::{failure, success_with, CommandError, CommandResult, ResultOptions};
use serde_json::Value;

fn parse_title(input: &Value) -> Result<&str, CommandError> {
    input
        .get("title")
        .and_then(|value| value.as_str())
        .ok_or_else(|| CommandError::validation("title is required", None))
}

async fn create_todo(input: Value, store: &TodoStore) -> CommandResult<Todo> {
    let title = match parse_title(&input) {
        Ok(title) => title,
        Err(error) => return failure(error),
    };

    // Validate
    if title.is_empty() {
        return failure(CommandError::validation(
            "title cannot be empty",
            Some("Provide a non-empty title"),
        ));
    }

    // Execute with error conversion
    let todo = match store.create(title).await {
        Ok(todo) => todo,
        Err(error) => return failure(CommandError::internal(&error.to_string())),
    };

    success_with(todo, ResultOptions {
        reasoning: Some(format!("Created todo '{}'", title)),
        ..Default::default()
    })
}
```

### Wrapping External Errors

`impl From<sqlx::Error> for CommandError` does not compile in your crate: `From`, `sqlx::Error`
and `CommandError` are all foreign to it (Rust's orphan rule). Convert with a local function, or
through a local error type, which may implement `From` in both directions.

```rust
use afd::{failure, success, CommandError, CommandResult};

// Option 1: a local conversion function.
fn db_error(err: sqlx::Error) -> CommandError {
    eprintln!("database error: {err}"); // log the details; don't send them to agents
    CommandError::internal("Database error")
}

async fn load_user(id: &str) -> Result<User, CommandError> {
    db.get_user(id).await.map_err(db_error)
}

// Option 2: a local error type. Both impls are allowed because `AppError` is local.
enum AppError {
    Db(sqlx::Error),
    NotFound(String),
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Db(err)
    }
}

impl From<AppError> for CommandError {
    fn from(err: AppError) -> Self {
        match err {
            AppError::Db(err) => db_error(err),
            AppError::NotFound(id) => CommandError::not_found("User", &id),
        }
    }
}

async fn find_user(id: &str) -> Result<User, AppError> {
    db.get_user(id).await?.ok_or_else(|| AppError::NotFound(id.to_string()))
}

async fn get_user(id: &str) -> CommandResult<User> {
    match load_user(id).await {
        Ok(user) => success(user),
        Err(error) => failure(error),
    }
}
```

## Testing

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_success_result() {
        let result = success("hello".to_string());
        assert!(result.success);
        assert_eq!(result.data, Some("hello".to_string()));
        assert!(result.error.is_none());
    }

    #[test]
    fn test_failure_result() {
        let error = CommandError::not_found("Todo", "123");
        let result: CommandResult<()> = failure(error);
        assert!(!result.success);
        assert!(result.error.is_some());
        assert_eq!(result.error.unwrap().code, "NOT_FOUND");
    }

    #[test]
    fn test_type_guards() {
        let success_result = success("data".to_string());
        assert!(is_success(&success_result));
        assert!(!is_failure(&success_result));

        let failure_result: CommandResult<String> =
            failure(CommandError::validation("bad", None));
        assert!(is_failure(&failure_result));
        assert!(!is_success(&failure_result));
    }
}
```

### Async Tests

```rust
#[tokio::test]
async fn test_command_execution() {
    let registry = CommandRegistry::new();
    registry.register(create_test_command()).unwrap();

    let result = registry.execute(
        "test-echo",
        serde_json::json!({"message": "hello"}),
        None,
    ).await;

    assert!(result.success);
}

#[tokio::test]
async fn test_command_not_found() {
    let registry = CommandRegistry::new();

    let result = registry.execute("nonexistent", serde_json::json!({}), None).await;

    assert!(!result.success);
    assert_eq!(result.error.unwrap().code, "COMMAND_NOT_FOUND");
}
```

## Cargo.toml Configuration

```toml
[package]
name = "my-afd-app"
version = "0.1.0"
edition = "2021"

[dependencies]
afd = "0.1"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
async-trait = "0.1"

[dev-dependencies]
tokio-test = "0.4"
```

## Feature Flags

- `native` (default): deadlines (`CommandContext::timeout_ms`, batch `timeout`, pipeline
  `timeoutMs`) through `tokio::time::timeout`. Only Tokio's `time` feature is enabled; the
  application provides the runtime. Without it, deadlines return `UNSUPPORTED_OPTION`.
- `wasm`: `wasm32-unknown-unknown` (browsers), using `web-time` for durations. Build with
  `--no-default-features --features wasm`.

```rust
// Check compilation mode
if afd::is_native() {
    println!("Running with tokio support");
}

if afd::is_wasm() {
    println!("Running in WebAssembly");
}
```

## Related Skills

- `afd-developer` - Core AFD methodology
- `afd-typescript` - TypeScript implementation patterns
- `afd-python` - Python implementation patterns
