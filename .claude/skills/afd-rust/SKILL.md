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
    CommandHandler, CommandRegistry,
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
    StreamChunk, create_progress_chunk, create_data_chunk,
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
            Some("Use user.login instead, or reset password"),
        ));
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
    Some("Wait 60 seconds before retrying"),
);

// With retryable flag
let err = CommandError {
    code: "TIMEOUT".to_string(),
    message: "Request timed out".to_string(),
    suggestion: Some("Try again in a few seconds".to_string()),
    retryable: Some(true),
    details: None,
    cause: None,
};
```

## Command Definition

### Using CommandHandler Trait

```rust
use async_trait::async_trait;
use afd::{CommandHandler, CommandContext, CommandResult, success};
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
        // Parse input
        let title = input["title"].as_str()
            .ok_or_else(|| CommandError::validation("title is required", None))?;

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
    "todo.create",
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
use afd::{CommandRegistry, CommandDefinition};

// Create registry
let mut registry = CommandRegistry::new();

// Register commands
registry.register(create_todo_cmd)?;
registry.register(list_todos_cmd)?;
registry.register(get_todo_cmd)?;

// Check if command exists
if registry.has("todo.create") {
    println!("Command registered");
}

// Get command definition
if let Some(cmd) = registry.get("todo.create") {
    println!("Description: {}", cmd.description);
}

// Execute command
let result = registry.execute(
    "todo.create",
    serde_json::json!({"title": "Test"}),
    None,
).await;
```

## Batch Execution

```rust
use afd::{BatchRequest, BatchCommand, BatchOptions};

// Create batch request
let request = BatchRequest {
    commands: vec![
        BatchCommand {
            id: Some("1".to_string()),
            command: "todo.create".to_string(),
            input: serde_json::json!({"title": "First"}),
        },
        BatchCommand {
            id: Some("2".to_string()),
            command: "todo.create".to_string(),
            input: serde_json::json!({"title": "Second"}),
        },
    ],
    options: BatchOptions {
        continue_on_error: true,
        max_concurrent: Some(4),
    },
};

// Execute batch
let result = registry.execute_batch(request).await;

println!("Succeeded: {}", result.summary.succeeded);
println!("Failed: {}", result.summary.failed);
```

## Streaming Results

```rust
use afd::{
    StreamChunk, create_progress_chunk, create_data_chunk,
    create_complete_chunk, create_error_chunk,
};

// Progress update
let progress = create_progress_chunk(50.0, "Processing items...");

// Partial data
let data = create_data_chunk(partial_result, false);

// Final data
let final_data = create_data_chunk(complete_result, true);

// Completion
let complete = create_complete_chunk(final_result);

// Error during streaming
let error = create_error_chunk(CommandError::internal("Stream interrupted"));
```

## Metadata Types

### Warnings

```rust
use afd::{Warning, WarningSeverity, create_warning};

let warning = create_warning("DEPRECATION", "This field is deprecated");

let warning = Warning {
    code: "PERMANENT".to_string(),
    message: "This action cannot be undone".to_string(),
    severity: Some(WarningSeverity::High),
    field: None,
};
```

### Sources

```rust
use afd::{Source, SourceType, create_source};

let source = create_source("API Response", SourceType::Api);

let source = Source {
    name: "User Database".to_string(),
    source_type: SourceType::Database,
    url: Some("postgres://...".to_string()),
    confidence: Some(0.99),
};
```

### Plan Steps

```rust
use afd::{PlanStep, PlanStepStatus, create_step, update_step_status};

let step = create_step(1, "Validate input");

let mut step = PlanStep::new(1, "Process data");
step = update_step_status(step, PlanStepStatus::InProgress);
step = update_step_status(step, PlanStepStatus::Completed);
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

### Using Result with ?

```rust
async fn create_todo(input: Value, store: &TodoStore) -> CommandResult<Todo> {
    // Parse required field
    let title = input["title"].as_str()
        .ok_or_else(|| CommandError::validation("title is required", None))?;

    // Validate
    if title.is_empty() {
        return failure(CommandError::validation(
            "title cannot be empty",
            Some("Provide a non-empty title"),
        ));
    }

    // Execute with error conversion
    let todo = store.create(title).await
        .map_err(|e| CommandError::internal(&e.to_string()))?;

    success_with(todo, ResultOptions {
        reasoning: Some(format!("Created todo '{}'", title)),
        ..Default::default()
    })
}
```

### Wrapping External Errors

```rust
impl From<sqlx::Error> for CommandError {
    fn from(err: sqlx::Error) -> Self {
        CommandError::internal(&format!("Database error: {}", err))
    }
}

async fn get_user(id: &str) -> CommandResult<User> {
    let user = db.get_user(id).await?;  // Converts sqlx::Error
    success(user)
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
    let mut registry = CommandRegistry::new();
    registry.register(create_test_command()).unwrap();

    let result = registry.execute(
        "test.echo",
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
