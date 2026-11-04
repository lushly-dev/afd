---
name: afd-rust
description: >
  Writes AFD commands in Rust with the afd crate: Cargo features, CommandRegistry execution
  order, approvals, output budgets and the optional `server` MCP feature. Use when implementing
  or embedding AFD commands in Rust or WebAssembly, or debugging Rust AFD code; for C++, use
  afd-cpp.
---

# AFD Rust

The `afd` crate lives in `packages/rust`. It is an in-process library: a validating `CommandRegistry`, batch and pipeline executors, bootstrap and context commands, an approval-aware `DirectClient`, and an optional MCP server. It has no remote client.

- **Version and MSRV.** Read the current version from `packages/rust/Cargo.toml`; don't copy one. The `rust-version` field and its comment give the minimum Rust: 1.85 for the crate, 1.88 with `server`, 1.89 with `journal-file-shared`.
- **Install** with `cargo add afd` (to pin, use the version `Cargo.toml` shows), or `afd = { path = "../afd/packages/rust" }` for a checkout.
- **References.** `packages/rust/README.md` is the API tour. [docs/language-parity.md](../../../docs/language-parity.md) lists Rust's gaps against the TypeScript reference.

## Feature flags

| Feature | Default | What it adds |
|---|---|---|
| `native` | yes | Deadlines (`CommandContext::timeout_ms`, batch `timeout`, pipeline `timeoutMs`) through `tokio::time::timeout`. Only Tokio's `time` feature is enabled; the application provides the runtime. Without it, a deadline returns `UNSUPPORTED_OPTION`. |
| `journal-file` | yes | `FileJournalSink`, through blocking `std::fs`. The rest of the journal works without it. |
| `approval` | yes | `create_approval_middleware`, `ApprovalMiddlewareOptions`, `canonical_json`: HMAC-SHA256 tokens and OS-random nonces. Policies (`with_approval`, `_meta.approval`) need no feature. |
| `journal-file-shared` | no | `FileJournalSink::shared` and `JournalFileLock`: several sinks and processes append to one file under an exclusive OS lock. Local file systems only. |
| `wasm` | no | `wasm32-unknown-unknown`: durations through `web-time`, because `std::time::Instant::now()` traps there. |
| `frontmatter` | no | `afd::frontmatter::parse`, a YAML 1.2 core-schema reader. `server` enables it. |
| `server` | no | `afd::server::McpServer` on `rmcp`: stdio and Streamable HTTP. Enables `native` and `frontmatter`. |

- **WebAssembly.** Build with `--no-default-features --features wasm`. That also drops `approval` and `journal-file`; add `approval` back (`--features wasm,approval`, which CI checks) for approvals in the browser. Its nonce then comes from `crypto.getRandomValues`.
- **Panics.** Only unwinding panics become results. A `panic = "abort"` build, and `wasm32-unknown-unknown`, which cannot unwind, still abort the process.

## Commands and the registry

```rust
let registry = Arc::new(CommandRegistry::new());     // `register` takes &self
registry.register(
    CommandDefinition::new("todo-create", "Create a todo", params, CreateTodo)
        .with_expose(ExposeOptions::new().with_mcp(true))   // MCP is opt-in
        .with_requires(["workspace-open"])                  // metadata only
        .as_mutation(),
)?;
register_bootstrap_commands(&registry)?;            // afd-help, afd-docs, afd-schema
let result = registry
    .execute("todo-create", json!({"title": "x"}), Some(CommandContext::new().with_timeout(5_000)))
    .await;
```

- **Handlers** implement `CommandHandler` with `#[async_trait]`: `async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value>`.
- **`ExposeOptions::default()`** is `palette` and `agent` on, `mcp` and `cli` off.
- **`register` rejects** a name that isn't `domain-action` kebab-case (TypeScript only warns), a duplicate, an invalid `with_tool_meta` key, an invalid output budget and an invalid parameter schema. It does not reserve the meta-tool names: a command named `afd-call` registers, but over MCP the meta-tool wins.
- **Bootstrap commands.** `register_bootstrap_commands(&registry)` is the only way to get `afd-help`, `afd-docs` and `afd-schema`; the MCP server doesn't add them. It fails if one of their names is taken.
- **Whole schemas.** `register_with_schema(command, schema)` validates against a whole input JSON Schema instead of `parameters`. It refuses `pattern`, `format`, `anyOf`/`oneOf`/`allOf`/`not` and `multipleOf` at registration. `register_with_schemas(command, validation, advertised)` validates with one schema and shows another; keeping `validation` no wider than `advertised` is your job.
- **Tool export.** `registry.get_tool(name)` is the authoritative MCP tool: whole schema, `annotations`, and `_meta` with `approval`, `dev.afd/outputBudget` and `with_tool_meta` entries. `command_to_mcp_tool` converts legacy parameters only.
- **What the definition doesn't check.** Examples are stored, not validated. Results get no `executionTimeMs` or `traceId` stamping, and there are no `onCommand` hooks.

`CommandRegistry::execute` runs, in order:

1. **Lookup.** An unknown name gets `COMMAND_NOT_FOUND`, with up to three close matches drawn only from commands the caller could call, and a pointer to `afd-help` when it is callable (`afd-discover` over MCP).
2. **Exposure,** when the context names an interface: `COMMAND_NOT_EXPOSED`. Remote (MCP) callers get `COMMAND_NOT_FOUND` instead.
3. **Active context:** `COMMAND_NOT_IN_CONTEXT`. Set it with `CommandContext::with_active_context` or `with_context_stack`.
4. **A deadline without `native`:** `UNSUPPORTED_OPTION`.
5. **Input validation** against `parameters` or the whole schema. It fills defaults and drops undeclared keys, as Zod does, and returns `VALIDATION_ERROR` ("Input validation failed") with the issues in `suggestion` and `details.errors`.
6. **Declared context fields** (`set_context_fields`), then the output budget ask: both fail with `VALIDATION_ERROR`.
7. **Middleware, then the handler.** With `timeout_ms`, a late finish is `TIMEOUT`. A panic becomes `COMMAND_EXECUTION_ERROR`, "An internal error occurred", and the payload is never shown, since Rust has no dev mode.

- **The handler isn't called when any check fails.** `CommandDefinition::execute` calls it directly and skips every check, so call commands through the registry.
- **No stream executor and no stock middleware.** Rust has batch and pipeline executors only, and no default, retry, rate-limit or tracing middleware; see the Middleware rows of `docs/language-parity.md`.
- **Middleware** (`add_middleware`; the first added is outermost) gets the name, the validated input, the context and `next`. `next` takes no arguments, so middleware cannot change the input, context or actor the handler sees. Set the actor on the context before `execute`, or in the server's context hook.
- **Context defaults.** Handlers always get `context.clock()` and `context.random()`; use `with_clock(fixed_clock(ms))` and `with_random(seeded_random(seed))` in tests. An actor (`with_actor(ActorKind::Human)`) is reported as `metadata.actorKind`, never its id.

## Output budgets

The contract is [spec/output-budgets.md](../../../spec/output-budgets.md). `tests/output_budget.rs` loads `spec/output-budgets.json`.

```rust
let search = CommandDefinition::new("doc-search", "Search documents", params, Search)
    .with_output_budget(16_000, 64_000);            // default_bytes, max_bytes; checked at register
// In the handler: context.output_budget() -> Option<u64>, None without a declaration.
let context = CommandContext::new().with_output_budget_ask(32_000);
// Over MCP: _meta["dev.afd/outputBudget"] = { "maxBytes": n }
```

- **The effective budget** is `min(ask, max_bytes)`, or `default_bytes` without an ask.
- **Where the check runs.** It is the innermost link of the chain, right after the handler and before metadata, so middleware and the journal see the checked result. It measures the canonical JSON of the result without `metadata`, and checks only successes.
- **Over budget.** A read becomes `OUTPUT_BUDGET_EXCEEDED`, with `details.limitBytes`, `actualBytes` and `maxBytes`. A mutation (`as_mutation()`) keeps its result, with a warning of that code.
- **Within budget,** the result carries `metadata["dev.afd/outputBudget"] = { limitBytes, usedBytes }`.
- **Fit results structurally.** Return fewer items or a smaller window, and say how to read on. Never truncate JSON to fit.
- **An invalid ask** (0, above 2^53 − 1, or not `{ "maxBytes": integer }`) is `VALIDATION_ERROR`, even for a command with no declaration.
- **Batches, pipelines and the journal.** Each batch item and pipeline step takes the ask. The journal records it, and replay restores it.

## Approvals

```rust
let delete = delete.with_approval(ApprovalPolicy::Required); // or ApprovalPolicy::when(|input, ctx| ...)
registry.register(delete)?;
// Build after registering the gated commands: `registry.list()` is a snapshot.
let options = ApprovalMiddlewareOptions::new(std::env::var("AFD_APPROVAL_SECRET")?, registry.list());
registry.add_middleware(create_approval_middleware(options)?); // after any actor-setting middleware
// APPROVAL_REQUIRED carries details.approvalToken. Once a human approves, trusted code retries:
let context = CommandContext::new().with_approval(token); // never from tool arguments
```

- **Gating.** A command not in the options' list is never held, whatever its policy says.
- **Secrets** must be at least 32 bytes; `create_approval_middleware` returns `Err` otherwise.
- **Tokens** are bound to the command, the validated input and the actor. They are single-use by default (`with_replay(ApprovalReplay::WithinTtl)` allows repeats) and have a five-minute TTL. Security time comes from the options' `with_clock` only, never the context clock.
- **Cross-language.** Tokens are byte-compatible with TypeScript's, including `canonical_json`: JavaScript number spelling and UTF-16 key order. An integer beyond 2^53 that a float cannot hold fails the call. See [spec/command-metadata.md](../../../spec/command-metadata.md), "Approvals".

**In-process agents.** Give agent-facing callers `DirectClient::new(Arc<CommandRegistry>)`, never the registry.

- **The approval hook.** `with_on_approval_needed` returns a future of `Result<bool, String>`. Only `Ok(true)` permits one private retry; errors and panics decline. `DirectApprovalRequest` is token-free, caller context evidence is ignored, and results and journals never see the token.
- **Deadlines.** One deadline covers the call, the human wait and the retry, and dropping the future cancels the flow.
- **Interface.** `with_interface` picks the interface, `Agent` by default.
- **What it lacks.** `DirectClient` has `call` only: no `pipe`, remote transport or CLI. `CommandRegistry::execute` stays the trusted host API for out-of-band tokens.

## Journal, batches and pipelines

- **The journal is not a middleware:** Rust middleware cannot swap the clock and random source the handler sees. Record with `registry.set_journal(JournalRecorder::new(Arc::new(MemoryJournalSink::new())).with_record_failures(true))`; `FileJournalSink` writes JSON Lines instead. Each accepted call is recorded after validation, around the middleware chain.
- **Replay** with `replay_journal(&fresh_registry, &entries, ReplayJournalOptions::default()).await` and check `report.diverged`. Entries follow [spec/journal.md](../../../spec/journal.md); compare them with TypeScript output as JSON values, because key order differs.
- **Batches.** `registry.execute_batch(request)`, or `execute_batch_with_context` to pass an interface or trace ID. Every item runs through `execute`. `BatchResult.success` is true whenever the batch ran; it is false only for `INVALID_BATCH_REQUEST`. An item without an id is reported as `cmd-<index>`.
- **Pipelines.** `execute_pipeline(&request, &executor, None)` takes a `CommandExecutor` closure, usually wrapping `registry.execute`, and a plain map context. Variables follow [spec/pipeline-variables.md](../../../spec/pipeline-variables.md). An unresolved reference is omitted from objects and is `null` in arrays, and inputs deeper than 64 levels are rejected.
- **Vectors.** `tests/pipeline_vectors.rs` and `tests/batch_controls_vectors.rs` run `spec/vectors`, the latter on Tokio's paused clock.

## MCP server (`server` feature)

```rust
use afd::server::{HttpOptions, McpServer, ToolStrategy};

let server = McpServer::new(registry.clone(), "my-app", env!("CARGO_PKG_VERSION"))
    .with_tool_strategy(ToolStrategy::Hybrid)
    .with_first_class_tools(["todo-list", "todo-create"])
    .with_contexts(vec![ContextConfig::new("planning")])?;   // returns Result
server.clone().serve_stdio().await?;
// or: axum::Router::new().route_service("/mcp", server.try_streamable_http_service(HttpOptions::default())?)
```

The README's "Features" section documents every builder. Behavior an agent would otherwise get wrong:

- **Protocol eras.** One endpoint or connection serves MCP 2026-07-28 statelessly and 2025 `initialize` clients.
- **Listing.** Only `expose.mcp` commands are listed. Unknown and unexposed tools return a `COMMAND_NOT_FOUND` result.
- **Every route** (command tool, grouped tool, `afd-call`, `afd-batch`, `afd-pipe`) ends in `CommandRegistry::execute`, so the registry's middleware, approval included, wraps each call. Calls run as actor `agent`.
- **Strategies** follow [spec/tool-strategies.md](../../../spec/tool-strategies.md). `Grouped` is the default, as in TypeScript. Every strategy lists `afd-batch`, `afd-pipe` and `afd-call`; grouped adds `afd-detail`, and lazy lists only `afd-discover`, `afd-detail` and those three.
- **Hybrid lists** the five meta-tools, the context tools when `with_contexts` is set, then at most `MAX_FIRST_CLASS_TOOLS` (8) command tools. The list never varies by context, so `ttlMs` stays 300,000. `ToolStrategy` is `Copy`, so the set is a separate builder, and each of the two requires the other.
- **The set is checked at start** (`McpServer::validate`): entries must be registered, `expose.mcp`, not a meta-tool or context tool, and unrepeated. `serve_stdio` and `try_streamable_http_service` return `Err`, `streamable_http_service` panics, and other transports answer `-32603`.
- **Contexts.** A 2026-07-28 request selects one with `_meta["dev.afd/context"]`; an unknown name is `-32602`. A 2025 stdio connection keeps one stack. Stateless 2025 HTTP has no session, so entering a context returns `SESSION_REQUIRED`. With contexts, `ttlMs` defaults to 0, and no strategy sends `notifications/tools/list_changed`.
- **Confirmations.** `with_confirmations(ConfirmationMode::Enforce)` gates commands with `confirm_prompt`: an elicitation when the client supports it, otherwise `CONFIRMATION_REQUIRED` until the call carries `confirm: true`. `RequireHuman` accepts the elicitation only. A batch or pipeline checks confirmations for every command before any runs.
- **The context hook is trust-bearing.** `with_context_hook` sets the per-request context, such as the actor, from verified transport data (`request.http_parts()` over HTTP, `None` on stdio). It runs once per call on every route, before the confirmation gate. Refuse by returning `Err` with a generic error, because `details` and `cause` are dropped. The server then re-asserts `interface: mcp`, the remote flag and the trace id, and applies the active context, which the hook cannot set.
- **Results and schemas.** Every tool result carries the whole result as `structuredContent`. Under the individual strategy, a command with `returns` advertises a top-level `outputSchema` (`with_advertise_output_schema(false)` removes it). An individual or first-class tool's `_meta` holds only `approval`, `dev.afd/outputBudget` and `with_tool_meta` entries, with no `category`, `requires` or `outputSchema` as in TypeScript; a grouped tool's `_meta.actions` entries carry the full set.
- **Resources and skills** ([spec/mcp-resources.md](../../../spec/mcp-resources.md)). `with_resources(provider)` serves `resources/*`, and `with_skills(SkillCatalog)` serves the Skills extension. A read runs no command, middleware or journal entry. `SkillCatalog::new` checks frontmatter, names and size limits at build time.
- **Extra tool `_meta`.** `with_tool_meta(key, value)` takes a prefixed key with two or more labels (not `dev.afd/` or an MCP-reserved prefix), or the MCP Apps key `ui`. Registration refuses any other key.
- **`frontmatter::parse`** returns `Ok(None)` for text without frontmatter and a typed `FrontmatterError` for malformed frontmatter. It sets no size cap and strips no BOM, so cap and clean the input first.

## Gotcha: wrapping external errors

`impl From<sqlx::Error> for CommandError` does not compile in your crate: `From`, `sqlx::Error` and `CommandError` are all foreign to it (the orphan rule). Convert with a local function, or through a local error type, which may implement `From` in both directions:

```rust
fn db_error(err: sqlx::Error) -> CommandError {
    eprintln!("database error: {err}");   // log details; don't send them to agents
    CommandError::internal("Database error")
}

enum AppError { Db(sqlx::Error), NotFound(String) }
impl From<sqlx::Error> for AppError { fn from(err: sqlx::Error) -> Self { AppError::Db(err) } }
impl From<AppError> for CommandError {
    fn from(err: AppError) -> Self {
        match err {
            AppError::Db(err) => db_error(err),
            AppError::NotFound(id) => CommandError::not_found("User", &id),
        }
    }
}
```

`CommandError` is `#[non_exhaustive]`, so build it with `CommandError::new(code, message)` and `.with_suggestion(..)`, `.with_retryable(..)` and `.with_details(..)`, or with the constructors `not_found`, `validation` and `internal`. `is_success` and `is_failure` test only `success`: read `data` and `error` as `Option`, because a result from another peer can be a success without `data`.
