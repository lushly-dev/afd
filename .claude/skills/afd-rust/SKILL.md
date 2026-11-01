---
name: afd-rust
description: >
  Rust implementation patterns for AFD commands using the afd crate,
  CommandResult types, and async handlers. Covers command definition,
  schema design with JSON Schema, error handling, registry patterns,
  and testing. The crate is an in-process library with MCP wire types and an
  optional MCP server (`server` feature, on `rmcp`). Use when: implementing commands in Rust, embedding AFD in
  a Rust or WebAssembly application, working with CommandResult types, or
  debugging Rust AFD code.
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
- Behavior vectors in `spec/vectors`, generated from TypeScript, must pass: pipeline references and conditions (`tests/pipeline_vectors.rs`), and batch and pipeline controls on Tokio's paused clock (`tests/batch_controls_vectors.rs`).

## Crate Imports

```rust
// Core result types
use afd::{
    success, failure, success_with,
    CommandResult, ResultOptions,
    is_success, is_failure, execution_failure,
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
// -> { code: "NOT_FOUND", message: "Todo with ID '123' not found" }

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
// - rejects an unknown name (COMMAND_NOT_FOUND) with up to three close matches, as in TypeScript,
//   drawn only from commands exposed to the context's interface, and a pointer to afd-help
//   when the caller can call it (TypeScript points to afd-discover, which Rust does not have),
// - validates input against `parameters` or the registered whole schema, fills defaults and drops undeclared keys, as Zod does
//   in TypeScript (VALIDATION_ERROR, "Input validation failed"; see Current Parity Note),
// - checks `expose` when the context names an interface (COMMAND_NOT_EXPOSED),
// - applies `timeout_ms` (TIMEOUT; needs the `native` feature).
// Middleware and the handler always get `context.clock()` and `context.random()` (system ones
// unless set with `with_clock(fixed_clock(ms))` / `with_random(seeded_random(seed))`); a context
// actor (`with_actor(ActorKind::Human)`) is reported as `metadata.actorKind`, never its id.
// A panic in middleware or the handler becomes COMMAND_EXECUTION_ERROR with the redacted
// message "An internal error occurred", as TypeScript does outside devMode.
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

### Output budgets (`spec/output-budgets.md`)

```rust
use afd::{CommandContext, CommandDefinition};

// Declare: 16 KB by default, 64 KB at most. The registry refuses a bad declaration at `register`.
let search = CommandDefinition::new("doc-search", "Search documents", params, Search)
    .with_output_budget(16_000, 64_000);

// A handler fits its result to the effective budget, structurally (fewer hits, a cursor):
//     let budget = context.output_budget(); // Option<u64>: None without a declaration

// Ask per call, in process (over MCP: `_meta["dev.afd/outputBudget"] = { "maxBytes": n }`):
let context = CommandContext::new().with_output_budget_ask(32_000);
let result = registry.execute("doc-search", input, Some(context)).await;
```

Effective budget: `min(ask, max_bytes)`, or `default_bytes`. The check is the innermost link of the
middleware chain, right after the handler and before `metadata` is stamped, so middleware and the
journal see the checked result. It measures the canonical JSON of the result without `metadata`
and only checks successes: an over-budget **read** becomes `OUTPUT_BUDGET_EXCEEDED`
(`details.limitBytes`, `actualBytes`, `maxBytes`), an over-budget **mutation**
(`as_mutation()`) keeps its result with a warning of that code, and a result within budget carries
`metadata["dev.afd/outputBudget"] = { limitBytes, usedBytes }`. Never truncate JSON to fit: return
fewer items or a smaller window and say how to read on. An invalid ask (0, above 2^53 − 1, not
`{ "maxBytes": integer }` over MCP) is `VALIDATION_ERROR` even for a command with no declaration.
Batch items and pipeline steps each take the ask; the journal records `output_budget` and replay
restores it as the ask. `tests/output_budget.rs` loads `spec/output-budgets.json`.

### Frontmatter (`frontmatter` feature, on with `server`)

`afd::frontmatter::parse(text)` returns `Ok(None)` for a text whose first line is not `---` (no
frontmatter), `Ok(Some(Frontmatter { fields, body_offset, body_line }))`, or a typed
`FrontmatterError` (`Unclosed`, `NotAMapping`, `Forbidden`, `TooDeep`, `Syntax`,
`MoreThanOneDocument`; lines are 1-based in the whole text). YAML 1.2 core schema: `2026-11-01`
and `yes` stay strings; tags, anchors and aliases are refused. It sets no size cap and strips no
BOM: cap and clean the input first.

### Journal and replay

```rust
use afd::{parse_journal, replay_journal, JournalRecorder, MemoryJournalSink, ReplayJournalOptions};

// Record each accepted call (after validation, around the middleware chain). Not a middleware:
// Rust middleware cannot swap the clock and random source the handler sees.
let journal = Arc::new(MemoryJournalSink::new()); // or FileJournalSink (`journal-file` feature)
registry.set_journal(JournalRecorder::new(journal.clone()).with_record_failures(true));

// Replay against a fresh registry with the same middleware; tapes restore clock and random.
let report = replay_journal(&fresh, &journal.entries(), ReplayJournalOptions::default()).await;
assert!(!report.diverged);
```

Entries keep only the actor, interface and trace ID from the context (plus a hash of the other key
names). `parse_journal`/`serialize_journal` read and write `spec/journal.md` JSON Lines; compare with
TypeScript output as JSON values, since object key order differs.

### Approvals (`approval` feature, default)

```rust
use afd::{create_approval_middleware, ApprovalMiddlewareOptions, ApprovalPolicy, CommandContext};

let delete = delete.with_approval(ApprovalPolicy::Required); // or ApprovalPolicy::when(|input, ctx| ...)
registry.register(delete)?;
// After any middleware that sets the actor: tokens are bound to command, validated input and actor.
let options = ApprovalMiddlewareOptions::new(std::env::var("AFD_APPROVAL_SECRET")?, registry.list());
registry.add_middleware(create_approval_middleware(options)?);
// APPROVAL_REQUIRED carries details.approvalToken; once a human approves, trusted code retries:
let context = CommandContext::new().with_approval(token); // never from tool arguments
```

Single-use by default (`with_replay(ApprovalReplay::WithinTtl)` to allow repeats), five-minute TTL,
security time from `with_clock` only (never the context clock). Tokens are byte-compatible with
TypeScript's `createApprovalMiddleware`, including `canonical_json` (JavaScript number spelling,
UTF-16 key order; integers beyond 2^53 that a float cannot hold fail the call).

## Private in-process approvals

Use `DirectClient::new(Arc<CommandRegistry>)` for agent-facing calls. Its
`with_on_approval_needed` hook returns a future of `Result<bool, String>`; only `Ok(true)`
permits one private retry. Errors/panics decline. `DirectApprovalRequest` is token-free;
public context evidence is ignored and results/journals never receive the private token.
One deadline covers the initial call, human wait and retry, and dropping the future cancels
that flow. Raw `CommandRegistry::execute` remains a trusted host token API. This DirectClient
has `call` but no `pipe`, remote transport or CLI.

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
// commands failed; a panicking handler becomes a COMMAND_EXECUTION_ERROR for that command.
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

## Current Parity Note

The cross-language matrix is [`docs/language-parity.md`](../../../docs/language-parity.md). `alfred parity` reports the names missing from Rust (see `docs/language-parity.md`), and most of those are export artifacts. The real gaps are behavioral.

- **Shared with TypeScript today:**
  - wire shapes (round-trip `spec/wire`);
  - the behavior vectors in `spec/vectors`;
  - enforced exposure;
  - input validation in the engine's shape (`packages/server/src/execution.ts`, `validation.ts`): `VALIDATION_ERROR` has the message `Input validation failed` and the issues in `suggestion`, formatted as `formatEnhancedValidationError` does. `details` holds `errors` (`path` joined with dots or `(root)`, `message`, a Zod `code`, and `expected` for `invalid_type`), `expectedFields`, and `unexpectedFields`/`missingFields` when they are not empty;
  - undeclared keys dropped before middleware and the handler, including in nested objects whose schema lists `properties` and has no `additionalProperties`;
  - the middleware chain;
  - `requires` metadata;
  - active-context scoping at execution time (`crate::contexts`): `CommandContext::with_active_context` or `with_context_stack`, enforced by `execute` (also for batch items and pipeline steps) with `COMMAND_NOT_IN_CONTEXT` before validation; `register_context_commands` adds `afd-context-list`, `-enter` and `-exit`;
  - bootstrap commands (`register_bootstrap_commands`);
  - batch execution (`CommandRegistry::execute_batch`) and pipelines per `spec/pipeline-variables.md`;
  - crash handling: a handler panic in `execute`, a batch or a pipeline becomes the redacted `COMMAND_EXECUTION_ERROR` (`execution_failure`);
  - `is_success` and `is_failure` test only `success`;
  - stream chunk types;
  - similarity helpers and name truncation, which count UTF-16 code units (`packages/core/src/similarity.ts`): echoed unknown names are cut to 128 units, and `find_similar_tools` and `calculate_similarity` measure lengths and edit distance in units;
  - handoff and telemetry types.
- **MCP server (`server` feature):** see [MCP Server](#mcp-server-server-feature).
- **Not in the crate yet:**
  - a stream executor;
  - built-in middleware (trace ID, logging, timing, retry, rate limit, telemetry);
  - result metadata stamping and `onCommand` hooks;
  - a registry dev mode: panic details are always redacted;
- **Validation in the unmerged stabilization candidate:**
  - `register_with_schema(command, serde_json::Value)` adds the full required schema subset, including nullable type lists, root/nested `additionalProperties`, recursive local refs and numeric/string/array bounds. Existing public schema fields remain compatible.
  - Use `registry.get_tool(name)` for authoritative discovery. `afd-schema` and `afd-docs` use it; standalone `command_to_mcp_tool` converts legacy definitions only. Read whole-schema bootstrap results as JSON when they exceed legacy `SchemaInfo`/`McpTool` types.
  - Unsupported optional keywords fail registration with their location. The whole-schema path rejects `pattern`, `format`, combiners and `multipleOf`; legacy regex compilation failures also reject registration.
  - Explicit null is present, never replaced by a default, and checked against its schema. Absent defaults are cloned as-is without validating or descending into inserted values. Parameter defaults take precedence over schema defaults.
  - An empty legacy parameter list advertises an empty object: object keys are stripped, nonobjects fail. Top-level null arguments normalize to `{}` before validation.
  - There is no issue or suggestion truncation. Sibling order may differ, preserving duplicates; array item issues precede bounds and object unknown-key issues follow property issues. Whole-schema validation has an explicit 128-level depth rejection.
  - Shared validation fixture: 34 cases / 130 tests, with 102 executed inputs and 28 explicit optional-keyword registration rejections. This is source validation evidence, not a published crate or hosted MCP result.
- **Remaining divergences:** legacy issue wording differs; examples are stored without validation. Whole-schema TypeScript export includes raw schema JSON and a conservative `unknown` alias.
- **Parity decisions** SHOULD compare agent-visible behavior first, then record Rust-specific gaps in the matrix instead of assuming every TypeScript or Python feature already exists in the crate.

## MCP Server (`server` feature)

Off by default; needs Rust 1.88 (the rest of the crate keeps 1.82). Built on the official MCP Rust SDK (`rmcp`), it serves MCP 2026-07-28 statelessly and 2025 `initialize` clients from one endpoint or connection.

```rust
use std::sync::Arc;
use afd::server::{HttpOptions, McpServer};

let server = McpServer::new(Arc::new(registry), "my-app", env!("CARGO_PKG_VERSION"));

// stdio
server.clone().serve_stdio().await?;

// Streamable HTTP: a tower service, for example with axum
let app = axum::Router::new().route_service("/mcp", server.streamable_http_service(HttpOptions::default()));
```

- Lists only commands with `expose.mcp`, through `CommandRegistry::get_tool` (or `with_tools` for full tool definitions); unknown and unexposed tools return a `COMMAND_NOT_FOUND` `CommandResult` as the tool result.
- `with_instructions` sets the `server/discover` guidance; `with_tools_list_ttl_ms` the `tools/list` freshness hint.
- Every tool call runs with actor `agent` (reported as `metadata.actorKind`); `with_actor`, `with_clock` and `with_random` override the actor, clock and random source on its context.
- `HttpOptions` sets accepted `Host` names, browser `Origin`s (any other `Origin` is refused) and the body cap.
- `with_confirmations(ConfirmationMode::Enforce)` gates commands with `confirm_prompt`: an elicitation when the client supports it, otherwise `CONFIRMATION_REQUIRED` until the call carries `confirm: true`. `RequireHuman` accepts the elicitation only; `with_confirmations_key` shares the `requestState` key across instances.
- `with_tool_strategy(ToolStrategy::Grouped | Individual | Lazy | Hybrid)`; grouped is the default, as in TypeScript (`with_group_by` names the groups). Every strategy lists `afd-batch`, `afd-pipe` and `afd-call` (grouped adds `afd-detail`, lazy lists only `afd-discover`, `afd-detail` and those three) and routes every meta-tool and every command by name. Meta-tool definitions equal TypeScript's (`spec/meta-tools.json`).
- Hybrid (`spec/tool-strategies.md`, H1 to H8): `with_tool_strategy(ToolStrategy::Hybrid).with_first_class_tools(["todo-list", "todo-create"])` lists `afd-discover`, `afd-detail`, `afd-call`, `afd-batch`, `afd-pipe`, then the context tools when `with_contexts` is set, then the first-class command tools in the order given (at most `MAX_FIRST_CLASS_TOOLS`, 8), each equal to its individual-strategy tool. The list never varies by context and `ttlMs` keeps 300,000 under contexts; a first-class call outside the active context answers `COMMAND_NOT_IN_CONTEXT`. `ToolStrategy` is `Copy`, so the set is a separate builder; it needs the Hybrid strategy and the Hybrid strategy needs it. Commands and contexts may be registered after the builder, so `McpServer::validate` checks the set when the server starts: `serve_stdio` returns its `Err`, `try_streamable_http_service` returns it, `streamable_http_service` panics, and any request over another transport answers `-32603` with the message. Entries must be registered, `expose.mcp`, no meta-tool or context-tool name, unrepeated and within the cap; a bootstrap command may be first-class. `afd-help` reports `toolStrategy` on every strategy, and on hybrid `firstClassTools` and `firstClass: true`; run in process it reports none of them.
- Every route (command tool, grouped tool, `afd-call`, `afd-batch`, `afd-pipe`) ends in `CommandRegistry::execute` with the same remote context: unexposed commands are `COMMAND_NOT_FOUND` (suggestion points to `afd-discover`), confirmations are checked for every command of a batch or pipeline before any runs (`confirm: [names]` acknowledges them), and the registry's middleware (approval included) wraps each execution.
- `with_contexts(vec![ContextConfig::new("planning")])` registers the context tools. MCP 2026-07-28 requests select a context with `_meta["dev.afd/context"]` (never stored; unknown names are `-32602`); a 2025 stdio connection keeps one stack; stateless 2025 HTTP has no session (`SESSION_REQUIRED`). `tools/list` and `server/discover` default to `ttlMs: 0` with contexts (300,000 under the hybrid strategy), and no strategy sends `notifications/tools/list_changed` (`tools.listChanged: false`).
- Every tool result on every route (meta-tools, batch and pipeline results, `COMMAND_NOT_FOUND`) also carries the whole result as `structuredContent`. Under the individual strategy a command with `returns` advertises a top-level `outputSchema`, as in TypeScript; `with_advertise_output_schema(false)` leaves it out (clients validate `structuredContent` against it). Grouped and lazy tools carry none.
- `with_context_hook(|request, context| async move { ... })` sets the per-request context (the actor) from the transport: `request.http_parts()` / `request.header(..)` over Streamable HTTP, `None` over stdio. It returns the context or a `CommandError` that becomes the failed result. It is trust-bearing and not token verification: read identity only from what a layer in front of the service verified, refuse by returning `Err` (it runs once per call on every route, before the confirmation gate and the tool lookup), and keep the refusal generic (`details` and `cause` are dropped). Batch items and pipeline steps run with its context. The server re-asserts `interface: mcp`, the remote flag and the trace id after it, then applies the request's active context, which the hook cannot set.
- Resources and skills (`spec/mcp-resources.md`): `with_resources(provider)` serves `resources/list`, `resources/read` and an empty `resources/templates/list`; `with_skills(SkillCatalog)` serves the Skills extension (`io.modelcontextprotocol/skills`: `skills/list`, `skills/get`, and every skill file as a `skill://` resource after the provider's entries). Either one declares `resources` (never `subscribe` or `listChanged`); a server with neither declares nothing. A `ResourceProvider` has `fn list(&self) -> Vec<ResourceEntry>` (called on every list, so entries may change; a `Vec<ResourceEntry>` is a static provider) and an async `read(uri)` that defaults to `ResourceReadError::NotFound`. `ResourceEntry::new(uri, name)` takes `with_mime_type`, `with_size`, `with_meta` (key rule, no `ui`) and `with_bytes`/`with_text`: with the bytes up front the server serves them, sets `size` and adds `_meta["dev.afd/digest"]`. Entries are checked by `McpServer::validate` (start-up) and on every list (`-32603`): absolute URI, unique, non-empty name, no `skill://` entry, `ui://` needs `MCP_APP_MIME_TYPE`. `ResourceContents::new(bytes)` may carry `_meta` (including `ui`); content is `text` when UTF-8, else `blob`. An unknown URI is `-32602` with `data.uri` on both eras; a cursor is `-32602`; modern results carry `ttlMs` (the `tools/list` option, not lowered by contexts) and `cacheScope: "public"`. A read runs no command, middleware or journal entry and skips the context hook. `SkillCatalog::new(vec![Skill::new("acme/lint-rules").with_file("SKILL.md", bytes)])` (or `Skill::from_dir`) checks everything at build time and returns an `Err` naming the skill and the rule: frontmatter is one YAML 1.2 core-schema mapping (no tags, anchors, aliases; `2026-11-01` stays a string), `name` (a-z, 0-9, `-`, 1 to 64) equals the path's last segment and is unique in the catalog, `description` 1 to 1,024 characters, at most 512 files and 16 MiB. `with_directory_read(true)` adds `resources/directory/read`. Skills are untrusted data: the server never acts on their content.
- Extra tool `_meta` and advertised schemas: `CommandDefinition::with_tool_meta("dev.umbel/origin", json!(..))` (prefixed key with two or more labels, not `dev.afd/` or an MCP-reserved prefix) or the MCP Apps key `ui` (`{ "resourceUri": "ui://..." }`); registration refuses every other key, naming the command and key. Entries reach an individual or first-class tool's `_meta`, a grouped tool's `_meta.actions` entry, and `afd-detail` (`toolMeta`). `CommandRegistry::register_with_schemas(command, validation, advertised)` validates calls against `validation` (the checker's subset) and shows `advertised` (any JSON object schema with `type: "object"`) on every surface; keeping the first no wider than the second is your job.
- Not yet: full `_meta` on individual tools (only `approval` and `with_tool_meta` entries), and reserved-name checks for meta-tool names at registration.

## Metadata Types

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

As in TypeScript, the guards test only `success`: every result is exactly one of the two, and a
result from another peer can be a success without `data` or a failure without `error`. Read both
as `Option`.

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

    registry.register(create_test_command()).unwrap(); // "test-echo"

    let result = registry.execute("test-ecko", serde_json::json!({}), None).await;

    let error = result.error.unwrap();
    assert_eq!(error.code, "COMMAND_NOT_FOUND");
    // Close matches, then where to look (no afd-help is registered here)
    assert_eq!(
        error.suggestion.as_deref(),
        Some("Did you mean 'test-echo'? Check the command name against the available commands.")
    );
}
```

## Cargo.toml Configuration

`afd` 0.2.1 is published and verified on crates.io, with API docs on docs.rs. Install
with `cargo add afd`, or pin this release with `cargo add afd@=0.2.1`.

```toml
[package]
name = "my-afd-app"
version = "0.1.0"
edition = "2021"

[dependencies]
afd = "=0.1.0"
# For a local checkout instead: afd = { path = "../afd/packages/rust" }
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
- `journal-file` (default): `FileJournalSink` (blocking `std::fs`). Everything else in the journal
  works without it.
- `frontmatter`: `afd::frontmatter` and `saphyr-parser`; `server` enables it. Use it alone
  (`default-features = false, features = ["frontmatter"]`) to read frontmatter without the MCP
  server.

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
- `afd-cpp` - C++ implementation patterns
