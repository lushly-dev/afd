# AFD Rust

Rust implementation of the Agent-First Development core types.

## Overview

This crate provides the AFD result, error, metadata, batch, streaming and pipeline types, plus a
command registry and a pipeline executor.

Its JSON wire format matches `@lushly-dev/afd-core` (TypeScript) and `afd` (Python): camelCase keys,
unset optional fields omitted, and unknown metadata keys preserved. `tests/wire_fixtures.rs`
round-trips every golden fixture in [`spec/wire/`](../../spec/wire/) to enforce this. The Rust API
itself follows Rust conventions and does not mirror every TypeScript or Python feature.

## Installation

```toml
[dependencies]
afd = "0.1"
```

## Quick Start

```rust
use afd::{failure, success, CommandError, CommandResult};

// Create a successful result
let result: CommandResult<String> = success("Hello, AFD!".to_string());
assert!(result.success);

// Create a failure result
let error = CommandError::not_found("Todo", "123");
let result: CommandResult<()> = failure(error);
assert!(!result.success);
```

Add trust signals with `success_with`:

```rust
use afd::{success_with, ResultOptions, Source, SourceType, Warning, WarningSeverity};

let result = success_with(
    serde_json::json!({"id": "todo-1", "title": "Buy milk"}),
    ResultOptions {
        confidence: Some(0.92),
        reasoning: Some("Created todo \"Buy milk\"".to_string()),
        sources: Some(vec![Source::new(SourceType::Document).with_title("Team guidelines")]),
        warnings: Some(vec![Warning::new("DUPLICATE_TITLE", "A todo with this title exists")
            .with_severity(WarningSeverity::Caution)]),
        suggestions: Some(vec!["Use todo-list to review existing todos".to_string()]),
        undo_command: Some("todo-delete".to_string()),
        ..Default::default()
    },
);
assert_eq!(result.confidence, Some(0.92));
```

## API Coverage

### Core Types
- `CommandResult<T>` - Standard result type with UX-enabling fields (`confidence`, `reasoning`,
  `sources`, `plan`, `alternatives`, `warnings`, `suggestions`, `metadata`, `undoCommand`, `undoArgs`)
- `CommandError` - Structured error with recovery guidance; implements `Display` and `std::error::Error`
- `Source`, `PlanStep`, `Alternative`, `Warning` - Metadata types
- `ResultMetadata` - Execution metadata; unknown keys are kept in `extra`

### Batch Operations
- `BatchCommand`, `BatchRequest`, `BatchOptions`, `BatchResult` - Multi-command execution
- `BatchCommandResult`, `BatchSummary`, `BatchTiming` - Batch result details

### Streaming
- `ProgressChunk`, `DataChunk`, `CompleteChunk`, `ErrorChunk` - Stream chunks
- `StreamChunk` - Union of all chunk types, discriminated by `type`
- `StreamOptions`, `StreamCallbacks` - Stream configuration

### Pipelines
- `PipelineRequest`, `PipelineStep`, `PipelineOptions`, `PipelineCondition`
- `PipelineResult`, `PipelineMetadata`, `StepResult`
- `execute_pipeline` - Runs a pipeline through a `CommandExecutor` callback

### Helper Functions
- `success()`, `success_with()`, `failure()`, `failure_with()` - Create results
- `is_success()`, `is_failure()` - Type guards
- Error factories: `validation_error()`, `not_found_error()`, etc.

Public structs are `#[non_exhaustive]`: build them with their constructors and `with_*` methods
(for example `PlanStep::new("validate", "validate").with_description("...")`). The option structs
`ResultOptions` and `FailureOptions` stay open for `..Default::default()`.

## JSON Serialization

All types serialize to camelCase JSON, matching TypeScript and Python:

```rust
use afd::success;

let result = success("hello".to_string());
let json = serde_json::to_string(&result).unwrap();
assert_eq!(json, r#"{"success":true,"data":"hello"}"#);
```

## Batches

A batch runs every command and collects all results, unless `stopOnError` is set.
`BatchResult.success` is `true` whenever the batch ran, even if some commands failed; the
`summary`, `confidence` and each command's `result` report how they fared. It is `false` only
when the batch itself was invalid.

```rust
use afd::{BatchCommand, BatchOptions, BatchRequest};

let request = BatchRequest::new(vec![
    BatchCommand::new("todo-create", serde_json::json!({"title": "Buy milk"})).with_id("create"),
    BatchCommand::new("todo-list", serde_json::json!({})),
])
.with_options(BatchOptions::new().with_parallelism(2).with_timeout(5_000.0));

let json = serde_json::to_value(&request).unwrap();
assert_eq!(json["options"], serde_json::json!({"timeout": 5000, "parallelism": 2}));
```

A handler that panics yields an `INTERNAL_ERROR` result for its own command; the other results
of the batch are kept. The same applies to pipeline steps.

## Pipelines

Step inputs can reference earlier results. Resolution follows
[`spec/pipeline-variables.md`](../../spec/pipeline-variables.md):

- `$prev`, `$first`, `$steps[N]`, `$steps.<alias>` and `$input` (the request's `input` field),
  each optionally followed by a path such as `.items[0].id`.
- Other strings starting with `$` (such as `"$9.99"`) are literals; `"$$prev"` is the literal
  `"$prev"`.
- Unresolved references are omitted from objects and become `null` in arrays.
- Paths only reach own keys and in-bounds indices; segments starting with `__` never resolve.
- Inputs nested deeper than 64 levels are rejected with `VALIDATION_ERROR` before any step runs.

```rust
use afd::{PipelineCondition, PipelineRequest, PipelineStep};

let request = PipelineRequest::new(vec![
    PipelineStep::new("user-get")
        .with_input(serde_json::json!({"id": "$input.userId"}))
        .with_alias("user"),
    PipelineStep::new("order-list")
        .with_input(serde_json::json!({"userId": "$steps.user.id", "note": "$$literal"}))
        .with_when(PipelineCondition::Exists { exists: "$prev.id".to_string() }),
])
.with_input(serde_json::json!({"userId": 7}));

assert_eq!(request.steps[1].alias, None);
```

## Command registry

`CommandRegistry::execute` enforces each command's metadata before its handler runs:

- **Input validation.** The input is checked against the declared `parameters` (required fields,
  JSON types, `enum` values, and a parameter's full `schema` when it has one). Parameter defaults
  are filled in. Invalid input returns `VALIDATION_ERROR` with a suggestion that lists the expected
  parameters, and the problems in `details.errors`.
- **Exposure.** When the `CommandContext` names an `interface`, a command not exposed to it returns
  `COMMAND_NOT_EXPOSED`. Each `expose` flag has its own default, as in TypeScript: `palette` and
  `agent` are on, `mcp` and `cli` are off. Leave `interface` unset for trusted in-process calls.
- **Timeout.** `CommandContext::with_timeout(ms)` returns `TIMEOUT` when the command runs longer
  (`native` feature).
- **Middleware.** `add_middleware` wraps every execution; the first middleware added is the
  outermost.

`execute_batch_with_context` runs every batch entry through the same path, with the caller's
context and the request's `context` entries in `CommandContext::extra`. Commands can also declare
`requires` and `contexts` metadata. Registration takes `&self`, so the bootstrap commands
(`afd-help`, `afd-docs`, `afd-schema`) can be registered into the registry they describe.

```rust
use afd::{
    register_bootstrap_commands, success, CommandContext, CommandDefinition, CommandHandler,
    CommandInterface, CommandParameter, CommandRegistry, CommandResult, ExposeOptions,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::sync::Arc;

struct CreateTodo;

#[async_trait]
impl CommandHandler for CreateTodo {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        success(input)
    }
}

#[tokio::main]
async fn main() {
    let registry = Arc::new(CommandRegistry::new());
    registry
        .register(
            CommandDefinition::new(
                "todo-create",
                "Create a todo",
                vec![
                    CommandParameter::required_string("title", "Todo title"),
                    CommandParameter::optional_string("priority", "Priority")
                        .with_enum(vec![json!("low"), json!("high")])
                        .with_default(json!("low")),
                ],
                CreateTodo,
            )
            .with_expose(ExposeOptions::new().with_mcp(true))
            .with_requires(["todo-list"]),
        )
        .unwrap();
    register_bootstrap_commands(&registry).unwrap();

    let invalid = registry.execute("todo-create", json!({"title": 42}), None).await;
    assert_eq!(invalid.error.unwrap().code, "VALIDATION_ERROR");

    let mcp = CommandContext::new().with_interface(CommandInterface::Mcp);
    let created = registry
        .execute("todo-create", json!({"title": "Buy milk"}), Some(mcp.clone()))
        .await;
    assert_eq!(created.data.unwrap()["priority"], "low");

    let help = registry.execute("afd-help", json!({}), Some(mcp)).await;
    assert_eq!(help.data.unwrap()["total"], 4); // todo-create and the three bootstrap commands
}
```

## Features

- `native` (default) - Deadlines through `tokio::time::timeout`: command timeouts
  (`CommandContext::timeout_ms`), batch `timeout` and pipeline `timeoutMs`. It enables only Tokio's
  `time` feature; the application provides the runtime, with its time driver enabled (for example
  `#[tokio::main]`).
- `wasm` - Browser WebAssembly (`wasm32-unknown-unknown`). Durations are measured with
  [`web-time`](https://crates.io/crates/web-time), because `std::time::Instant::now()` traps on that
  target. Build with `--no-default-features --features wasm`; CI runs
  `cargo check --target wasm32-unknown-unknown --no-default-features --features wasm`.

Builds without `native` reject deadline options with `UNSUPPORTED_OPTION` before invoking any
command. Execution without a deadline remains available. Parallel pipelines are currently rejected
in every build; batch concurrency is supported through `parallelism`.

## License

MIT
