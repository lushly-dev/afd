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

Install the published [afd crate](https://crates.io/crates/afd):

```bash
cargo add afd
```

To pin the first release in `Cargo.toml`:

```toml
[dependencies]
afd = "=0.1.0"
```

For source development, Cargo finds the package in `packages/rust`:

```toml
[dependencies]
afd = { git = "https://github.com/lushly-dev/afd", tag = "rust-v0.1.0" }
# Or use a local checkout: afd = { path = "../afd/packages/rust" }
```

For WebAssembly, see [Features](#features).

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
- `is_success()`, `is_failure()` - Type guards. As in TypeScript they test only `success`, so
  `{"success": true}` without `data` is a success and `{"success": false}` without `error` is a
  failure.
- `execution_failure()` - The `COMMAND_EXECUTION_ERROR` result for a crashed handler, redacted
  unless `dev_mode` is set (TypeScript's `executionFailure`)
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
when the batch itself was invalid, with TypeScript's `INVALID_BATCH_REQUEST` error. A command
`id` or an option set to `null` fails to deserialize.

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

A handler that panics yields a `COMMAND_EXECUTION_ERROR` result for its own command (see
[Command registry](#command-registry)); the other results of the batch are kept. The same applies
to pipeline steps, including a panic in the `CommandExecutor` callback itself.

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
- A `PipelineRequest` whose envelope TypeScript would reject with `INVALID_PIPELINE_REQUEST` fails
  to deserialize: a blank command, a step `input` that is not an object, a negative `timeoutMs`,
  `options.onProgress`, or `null` for an optional field other than `input`.

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

- **Unknown names.** `COMMAND_NOT_FOUND` carries the same suggestion as the TypeScript server: up
  to three close matches, for example `Did you mean 'todo-create'? Other close matches:
  'todo-list'.` It never lists every command. When the `CommandContext` names an `interface`, only
  commands exposed to that interface are matched, so an unexposed name is never suggested. The
  suggestion ends with `Use afd-help to list all commands.` when `afd-help` is registered and
  callable (TypeScript points to `afd-discover`, which Rust does not have). Otherwise it ends with
  `Check the command name against the available commands.` The registry does not track an active
  context, so, unlike TypeScript, matches are not filtered by `contexts`. As in TypeScript, the
  name in the message is cut to 128 UTF-16 code units, and `find_similar_tools` and
  `calculate_similarity` count UTF-16 code units, so they suggest the same names (an emoji counts
  as two units).
- **Input validation.** The input is checked against the declared `parameters` (required fields,
  JSON types, `enum` values, and a parameter's full `schema` when it has one). Parameter defaults
  are filled in. Keys that no parameter declares are dropped, as Zod drops them in TypeScript, so
  the handler and middleware never see them. The same applies inside a nested object whose schema
  lists `properties`, unless the schema also has `additionalProperties`. Invalid input returns
  `VALIDATION_ERROR` in the TypeScript engine's shape: the message `Input validation failed`, the
  problems and field lists in `suggestion`, and `details` with `errors` (each with `path`,
  `message`, `code` and, for `invalid_type`, `expected`), `expectedFields`, `unexpectedFields` and
  `missingFields`.
- **Exposure.** When the `CommandContext` names an `interface`, a command not exposed to it returns
  `COMMAND_NOT_EXPOSED`. Each `expose` flag has its own default, as in TypeScript: `palette` and
  `agent` are on, `mcp` and `cli` are off. Leave `interface` unset for trusted in-process calls.
- **Timeout.** `CommandContext::with_timeout(ms)` returns `TIMEOUT` when the command runs longer
  (`native` feature).
- **Middleware.** `add_middleware` wraps every execution; the first middleware added is the
  outermost.
- **Crashes.** A panic in a middleware layer or the handler returns `COMMAND_EXECUTION_ERROR` with
  the message `An internal error occurred`, as TypeScript does for a thrown exception outside
  `devMode`. The panic payload is never included, and the registry has no dev mode that would show
  it. The panic is caught with `catch_unwind`, so a build with `panic = "abort"` still aborts.

For the complete required subset of [`spec/validation.md`](../../spec/validation.md), use
`registry.register_with_schema(command, schema)` with a `serde_json::Value` schema. It supports
nullable type lists, root and nested boolean/schema `additionalProperties`, local recursive
`$ref` (`#`, `#/definitions/<name>`, `#/$defs/<name>` only), `definitions`/`$defs`, item and code-point length bounds, numeric and exclusive bounds,
`enum`, `const`, and defaults. Unsupported optional keywords (`pattern`, `format`, `anyOf`,
`oneOf`, `allOf`, `not`, `multipleOf`) and unknown keywords fail registration, with their location.
The legacy typed schema remains available; it accepts harmless annotations during deserialization,
rejects unknown constraints, rejects `format` at registration, and accepts only patterns the Rust
regex engine can compile.

Use `registry.get_tool(name)` to export the authoritative whole schema. The `afd-schema` and
`afd-docs` bootstrap commands use that same schema. `command_to_mcp_tool` converts only a legacy
`CommandDefinition`; a definition obtained with `registry.get(name)` does not contain a separately
registered whole schema. Likewise, `SchemaInfo`/`McpTool` remain legacy typed representations;
consume whole-schema bootstrap output as JSON when its types exceed that representation.
TypeScript export of a whole schema includes its JSON source and a conservative `unknown` alias.

Explicit property `null` is validated and never replaced by a default. Missing properties receive
defaults at every present enclosing object; inserted defaults are used as-is, without validation,
stripping, or nested default expansion. Defaulted parameters are omitted from exported `required`.
A command with no legacy parameters now follows its advertised empty `properties`: it strips
object keys and rejects non-object input. Top-level `null` arguments normalize to `{}`. Applications
needing open payloads can register `{"type":"object","additionalProperties":true}`.

Validation reports every issue and suggestion line. Field lists and sibling issues may differ in
order from TypeScript; array item issues precede their bound issue and unknown-key issues follow
property issues. Legacy issue wording differs from TypeScript. Whole-schema recursion has an
explicit 128-level validation guard, reported as a validation error. The vector loader checks every
required-subset case through registry execution and verifies unsupported optional cases fail
registration; it preserves duplicate issues when comparing across languages.

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
    let error = invalid.error.unwrap();
    assert_eq!(error.code, "VALIDATION_ERROR");
    assert_eq!(error.message, "Input validation failed");
    assert_eq!(
        error.suggestion.as_deref(),
        Some("title: must be a string, got number. Expected fields: title, priority")
    );

    let mcp = CommandContext::new().with_interface(CommandInterface::Mcp);
    let created = registry
        .execute("todo-create", json!({"title": "Buy milk", "typo": 1}), Some(mcp.clone()))
        .await;
    // The default is filled in and the undeclared key is dropped.
    assert_eq!(created.data.unwrap(), json!({"title": "Buy milk", "priority": "low"}));

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
- `server` - An MCP server for a `CommandRegistry` (`afd::server::McpServer`), built on the official
  MCP Rust SDK ([`rmcp`](https://crates.io/crates/rmcp)). One Streamable HTTP endpoint
  (`streamable_http_service`, a `tower` service to mount at `/mcp`) or one stdio connection
  (`serve_stdio`) serves MCP 2026-07-28 statelessly (per-request `_meta`, `server/discover`, the
  `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers) and 2025 clients that open with
  `initialize`. Only MCP-exposed commands are listed or callable; unknown and unexposed tools return a
  `COMMAND_NOT_FOUND` result. `HttpOptions` sets the accepted `Host` names and browser `Origin`s (any
  other `Origin` is refused) and the body cap. It covers the individual tool strategy; grouped and
  lazy strategies, meta-tools and contexts are planned. **The `server` feature needs Rust 1.88**
  (`rmcp`'s minimum); the rest of the crate keeps the 1.82 minimum.

Builds without `native` reject deadline options with `UNSUPPORTED_OPTION` before invoking any
command. Execution without a deadline remains available. Parallel pipelines and pipeline steps with
`stream: true` are currently rejected with `UNSUPPORTED_OPTION` in every build, before any step
runs; batch concurrency is supported through `parallelism`.

## License

MIT
