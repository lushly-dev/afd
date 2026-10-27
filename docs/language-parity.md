# AFD Language Parity

What each AFD implementation provides, where they differ, and which differences are intended.

| Field | Value |
|---|---|
| Updated | 2026-10-25 (MCP 2026-07-28 rows); 2026-10-13 otherwise |
| Reviewed at | Stabilization `f19257e` (#367); Python 0.9.0 published from `4e16a06` (#372); npm 2.1.0 published from `0148d22` (#338); C++ and Rust 0.1.0 published from `a311562` (#377); fresh consumers verified |
| Implementations | TypeScript (reference), Python, Rust, C++ |
| Replaces | The export counts in the [Python](./features/active/python-parity/python-parity.plan.md) and [Rust](./features/complete/rust-parity/plan.md) parity plans, which now link here |
| Plans | [Parity closure](./features/active/parity-closure/parity-closure.plan.md) closes the gaps listed here; [Versioning and release](./features/active/versioning/versioning.plan.md) covers each implementation's version and the contract version |
| Related | [`spec/wire`](../spec/wire/README.md), [`spec/pipeline-variables.md`](../spec/pipeline-variables.md), [`spec/command-metadata.md`](../spec/command-metadata.md), [`spec/validation.md`](../spec/validation.md), [`spec/error-codes.md`](../spec/error-codes.md), [`spec/vectors`](../spec/vectors/README.md), [C++ proposal](./features/complete/cpp-support/proposal.md), [2026-09-23 quality review](./reviews/2026-09-23-quality-review.md) |

The implementation rows below include the stabilization merged in #367. Python 0.9.0 is published: all 12 fresh published-wheel installs passed across Python 3.10–3.12 and base/client/server/CLI, including the original base-import reproduction; [#347](https://github.com/lushly-dev/afd/issues/347) is closed. All nine npm packages are published at 2.1.0 after verified historical 2.0.0 recovery; [#369](https://github.com/lushly-dev/afd/issues/369) is closed. See the [publication record](./operations/stabilization-release.md) for exact commits, registry consumers and workflow receipts. The historical export measurement below remains dated separately.

## What parity means

The `afd` skill defines parity as a **shared capability contract and agent-visible behavior**, not identical symbols. A language may rename helpers or reshape modules. It should not change what an agent sees.

The contract has three layers:

1. **Wire shapes.** `CommandResult`, errors, batch, pipeline and stream results serialize identically. `spec/wire` enforces this.
2. **Behavior.** Dispatch order, validation, exposure, batch/pipeline/stream semantics and error codes match. `spec/pipeline-variables.md`, `spec/vectors` and the todo conformance suite enforce parts of this.
3. **Surfaces.** An MCP server, meta-tools, clients and tooling. These depend on the host, and some languages leave them out on purpose.

**TypeScript is the behavioral reference:** `packages/server/src/execution.ts` for single commands, and `packages/core/src/command-execution.ts` and `pipeline-executor.ts` for batch, stream and pipeline.

## Implementations at a glance

Versions below describe repository manifests. Registry checks independently confirm all nine npm packages at 2.1.0 Python at 0.9.0 and Rust at 0.1.0; repository versions alone do not imply publication.

| | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Package | 9 `@lushly-dev/*` packages | `afd` | `afd` crate | `afd-cpp` (`afd::afd`) |
| Version | 2.2.0 | 0.9.0 | 0.1.0 (published) | 0.1.0 |
| Contract | 1.0-rc (`AFD_CONTRACT_VERSION`) | 1.0-rc (`afd.CONTRACT_VERSION`) | 1.0-rc (`afd::CONTRACT_VERSION`) | 1.0-rc (`afd::contract_version`) |
| Distribution | npm | PyPI | [crates.io](https://crates.io/crates/afd); published 0.1.0 | CMake `FetchContent`, `find_package`, `add_subdirectory`; published [cpp-v0.1.0](https://github.com/lushly-dev/afd/releases/tag/cpp-v0.1.0) |
| Scope | Full stack: core, MCP server, MCP client, DirectClient, CLI, auth, testing, UI packages | Full stack in one package: core, FastMCP server, client, DirectClient, CLI, testing, platform and connectors | Core library, validating registry, batch and pipeline executors, bootstrap commands, optional MCP server (`server` feature). No client | Core library, validating registry, middleware, `DirectClient`, batch, pipeline and stream executors. No server or client |
| Todo backend | stdio (SDK v2), both MCP eras | stdio (`mcp` 2.x), both eras | Streamable HTTP (`server` feature on axum), both eras | stdio (hand-rolled), both eras |
| CI | `ci.yml` (`pnpm check`) | `python.yml` | `rust.yml` | `cpp.yml` |
| Skill | `afd-typescript` | `afd-python` | `afd-rust` | `afd-cpp` |

## How parity is checked today

| Check | What it proves | TS | Python | Rust | C++ |
|---|---|---|---|---|---|
| `spec/wire` round-trip, 6 fixtures | Wire shapes | Yes (generator) | Yes | Yes | Yes |
| `spec/vectors/pipeline-variables.json`, 51 references and 27 conditions | Pipeline reference and `when` behavior | Yes (generator) | Yes | Yes | Yes |
| `spec/vectors/batch-controls.json`, 24 batch and 25 pipeline cases | `stopOnError`, `parallelism`, deadlines, `continueOnFailure`, `UNSUPPORTED_OPTION` and envelope validation in the batch and pipeline executors | Yes (generator) | Yes, through `afd-batch` and `afd-pipe` | Yes | Yes |
| `spec/vectors/error-codes.json`, 45 codes | The shared `ErrorCodes` catalog of `spec/error-codes.md` | Yes | Yes | Yes | Yes |
| `spec/vectors/validation.json`, 34 cases / 130 tests | Required schema subset; unsupported optional keywords must reject registration | Yes | Yes: 130 execute | Yes: 102 execute, 28 optional rejections | Yes: 98 execute, 32 optional rejections |
| [AFD protocol conformance tier](../spec/protocol-conformance.md) | Both MCP eras over real transports: discovery, `_meta`, headers, exposure, contexts, cache hints, tool fields | `/mcp` and stdio, both eras | Streamable HTTP and stdio, both eras | `server` feature over Streamable HTTP | Todo backend stdio |
| Todo conformance, 34 cases (`conformance.yml`) | Domain results through MCP `tools/call` | Yes | Yes | Yes | Yes |
| `alfred parity` name budget (`alfred/tests/test_parity.py`) | Historical name measurement; current configured upper budgets | Reference | Budget 97 | Budget 9 | Budget 75 |
| `alfred parity` contract version, `scripts/check-versions.mjs` | The contract constant equals `spec/VERSION` | Yes | Yes | Yes | Yes |

Limits of these checks:

- **The conformance suite tests the todo domain, not the AFD protocol.** Its 34 cases call todo commands and check result fields. They do not exercise:
  - meta-tools, bootstrap or discovery;
  - exposure;
  - the batch, pipeline or stream executors;
  - unknown-command handling.
- **Name parity is not behavioral parity.** Rust is 9 names short of TypeScript but has no stream executor and its MCP server covers the individual tool strategy only. Python is 97 names short, but 61 of those exist and are just not exported (see [Name parity](#name-parity-alfred-parity)).
- **The behavior vectors cover pipeline references, conditions, executor controls, validation (loaded by all four implementations) and the error-code catalog.** Streams and single-command dispatch have no vectors yet, so a change there can still drift unnoticed.

## Capability matrix

**Legend:**

- **Yes**: implemented and matches the reference.
- **Partial**: present, with a gap or divergence noted in the cell.
- **No**: absent and not declared intentional. This is a gap to close.
- **Deferred**: absent, and a plan says "later".
- **N/A**: absent by design (see [Intended differences](#intended-differences)).

### Wire contract

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| `CommandResult`, `CommandError`, metadata shapes (camelCase, unset omitted) | Yes | Yes | Yes | Yes |
| `Warning`, `Source`, `PlanStep`, `Alternative` | Yes | Yes | Yes | Yes |
| `ErrorCodes` catalog: the 42 shared codes of [`spec/error-codes.md`](../spec/error-codes.md), checked against `spec/vectors/error-codes.json` | Yes | Yes | Yes | Yes |
| `success` / `failure` / `error` constructors | Yes | Partial: `failure()` accepts only `warnings` and `metadata` | Partial: `FailureOptions` has no `alternatives` or `undo*` | Yes |
| `isSuccess` / `isFailure` test only `success` | Yes | Yes, including `success(None)` | Yes | Yes |

### Command definition

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Core metadata: name, description, category, tags, version, mutation, requires, contexts, expose, handoff, examples, executionTime | Yes | Partial: the decorator has no `errors` or `execution_time`; `MCPServer.command` drops `handoff` | Yes | Yes (`requires` is `prerequisites`) |
| `destructive`, `confirmPrompt`, `undoable` ([`spec/command-metadata.md`](../spec/command-metadata.md)) | Yes: on core `CommandDefinition` and `defineCommand`; `_meta` has `destructive` and `undoable`, afd-detail all three | Yes: on `CommandDefinition`, `define_command` and `@server.command`; same surfaces as TypeScript | Yes: on `CommandDefinition` (`with_destructive`, `with_confirm_prompt`, `with_undoable`); afd-help (full) and afd-docs, no `_meta` | Yes |
| `approval` policy, `_meta.approval` ([`spec/command-metadata.md`](../spec/command-metadata.md#approvals), #272) | Yes: on core `CommandDefinition` and `defineCommand`; `_meta`, afd-detail and afd-docs | Yes: on `CommandDefinition`, `define_command` and `@server.command`; same surfaces as TypeScript, and `afd validate` warns on a mutation or destructive tool without one | Yes: `CommandDefinition::with_approval` (`ApprovalPolicy::when` for a function); `_meta` on `get_tool`, `afd-help` (full) and afd-docs | Yes (#422): `CommandDefinition::approval` (an `ApprovalDecision` or a function), `approval_mode`; the todo backend reports `_meta.approval` (C++ has no afd-detail or afd-docs) |
| `confirmPrompt` enforcement ([`spec/command-metadata.md`](../spec/command-metadata.md#confirmations)) | Yes: `confirmations` server option, elicitation on `/mcp` and stdio, acknowledgement fallback; client `onElicitation`, CLI prompt | Yes: `create_server(confirmations=...)`, elicitation on 2026-07-28 and stateful 2025 connections; no client handler yet | Yes: `McpServer::with_confirmations`, individual tools; elicitation on 2026-07-28 and 2025 stdio | Planned |
| Kebab-case name rule | Warns in `defineCommand` | Yes: warns in `define_command` and in the core registry for a raw definition | Yes, rejects at registration | Yes, rejects at registration |
| Duplicate and reserved names | Throws for meta-tools, and for bootstrap and context names when enabled | Partial: meta-tools only; a command named like a bootstrap tool silently shadows it | Partial: bootstrap names only | Yes: meta-tools (C++ has no bootstrap or context tools) |
| Input validated before the handler ([`spec/validation.md`](../spec/validation.md)) | Yes: Zod | Yes: advertised JSON Schema enforced before middleware, then Pydantic conversion where applicable | Yes: legacy parameters or additive `register_with_schema`; use `get_tool` for authoritative discovery | Yes: required subset; unsupported optional keywords reject registration |
| Examples validated at definition | Yes | Yes | No: stored only | Yes |
| Output schema advertised | Yes (`_meta.outputSchema`) | Yes | Partial: `returns` not surfaced by `afd-schema` | No: stored, never emitted |
| Command to MCP tool with `_meta` | Yes | Partial: no `category` in `_meta` | Partial: `command_to_mcp_tool`, no plural helper | Deferred |

### Single-command execution

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Dispatch order: lookup, context, validation, middleware, handler, stamp, `onCommand` | Reference | Partial: matches through the stamp; no `onCommand` hook | Partial: no stamping or hooks | Yes |
| "Did you mean" on an unknown command | Yes | Yes | Yes (points to `afd-help`) | Yes |
| Exposure enforced | Yes: the remote engine holds only MCP-exposed commands | Yes | Yes | Yes, when `context.surface` is set |
| Active-context scoping | Yes: a stack per session, depth 16 | Yes: trusted transport-session stacks, depth 16; stateless HTTP mutation returns `SESSION_REQUIRED` | No: `contexts` is metadata only | Partial: `active_context` is supplied by the caller |
| Result metadata stamped (`executionTimeMs`, `commandVersion`, `traceId`) | Yes | Yes | No | Yes |
| `onCommand` / `onError` hooks | Yes | No | No | Yes |
| A thrown error becomes a redacted `COMMAND_EXECUTION_ERROR` | Yes (`devMode` shows detail) | Yes (`dev_mode` shows detail in the server, `create_command_registry`, `execute_pipeline` and `SimpleRegistry`) | Yes: a panic in `execute`, a batch or a pipeline (`execution_failure`); there is no dev mode to show detail | Yes, when built with exceptions |
| Cancellation | `AbortSignal` | Partial: DirectClient enforces positive finite millisecond deadlines; server per-command timeout remains deferred | Per-command timeout drops the future; no signal | Cooperative `CancellationToken` and deadline |
| `context.clock` and `context.random` (#274): injectable, `fixedClock`, `seededRandom` | Yes | Yes (`fixed_clock`, `seeded_random`, same sequence) | Yes: `fixed_clock`, `seeded_random` (same sequence as TypeScript); the registry fills both | Yes: `context.clock` and `context.random`, filled from the registry options; `fixed_clock` takes epoch milliseconds only (no ISO string); `SeededRandom` matches the TypeScript sequence bit for bit; `executionTimeMs` uses the steady clock, so `ManualClock::set` does not change it |
| `context.actor` (#271), filled per surface; `metadata.actorKind` | Yes | Yes: MCP `agent`, `DirectClient` `human`, testing helpers `test`; `SimpleRegistry` handlers that declare a keyword-only `context` get it, with `clock` and `random` (#431). The CLI calls over MCP, so its calls are `agent`, as in TypeScript, whose CLI is also an MCP client. Neither server takes a caller-declared actor from request `_meta`: any MCP client could claim `human` (#431). No auth middleware to fill `id` | Yes: typed `actor_kind`; the MCP server (`server` feature) fills `agent`; no DirectClient or testing package to fill `human`/`test`; middleware cannot change the actor the handler sees (`next` takes no context), so there is no auth refinement; pipelines take a plain map context | Yes: `std::optional<Actor>`; `DirectClient` defaults to `human`; `CommandRegistryOptions::actor` sets a default, and the todo backend's MCP loop sets `agent` (C++ has no MCP server, testing package or auth middleware); typed `ResultMetadata::actor_kind` |
| Command journal and replay (#273): `JournalEntry`, memory and file sinks, recording middleware, `replayJournal` with tape-restored clock and random ([`spec/journal.md`](../spec/journal.md)) | Yes | Yes ([#425](https://github.com/lushly-dev/afd/issues/425)): `afd.core.journal` (`MemoryJournalSink`, `FileJournalSink`, JSON Lines written as `JSON.stringify` writes them), `create_journal_middleware` and `replay_journal` in `afd.server`; reads, writes and replays `spec/wire/journal.jsonl`, with the same context hashes | Yes (#426): `MemoryJournalSink`, `FileJournalSink` (`journal-file` feature, on by default), `replay_journal`; the recorder is `CommandRegistry::set_journal`, not a middleware (middleware cannot change the context the handler sees), so it sits after validation and outside every middleware and its tape holds what the middleware read too; the context digest hashes the same as TypeScript for a context holding only clock and random; entries match TypeScript's as JSON values, not byte for byte (object key order) | Yes (#427): `create_journal_middleware`, `replay_journal` over a `CommandRegistry` or any `CommandExecutor`, `MemoryJournalSink`, and `FileJournalSink` in the optional `afd/journal_file.hpp` (`AFD_JOURNAL_FILE`, ON by default). The tape holds `steady_ms` and `wall_ms` readings in one `clock` list, in read order; the context digest names the same keys as TypeScript, so the fixture's hashes match. Reads and replays `spec/wire/journal.jsonl` |

### Middleware

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Middleware chain | Yes | Yes | Yes | Yes |
| `defaultMiddleware()`: trace ID, logging, timing | Yes | Yes | No | Yes |
| Retry, rate limit, telemetry | Yes | Yes | No | Deferred |
| Tracing (OpenTelemetry-shaped), `composeMiddleware` | Yes | Yes | No | No: not declared |
| Auth middleware | Yes (`packages/auth`) | No | No | N/A: built by the host |
| Approval middleware (`APPROVAL_REQUIRED`, signed tokens) | Yes (`createApprovalMiddleware`) | Yes (`create_approval_middleware`; tokens verify across the two) | Yes (`create_approval_middleware`, `approval` feature, default); tokens verify across TypeScript and Rust | Yes (#422): `create_approval_middleware` and `canonical_json`, evidence in `CommandContext::approval`; tokens are TypeScript's byte for byte and verify across the two. Configuration errors are an `Expected`, not an exception. An integer beyond 2^53 − 1 can be bound only when spelled as JavaScript writes its double (`2^53 + 1` cannot; `1e18` can) |
| Approval relay over MCP (form elicitation, #418) | Yes (`relay: 'mcp-elicitation'`) | No | No | N/A: built by the host |

### Batch, pipeline and stream

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| Batch executor with the reference defaults (`stopOnError` false, parallelism 1, whole-batch deadline) | Yes | Partial: private `MCPServer._execute_batch`, with limits of 500 commands and parallelism 16; observed failure stops new starts and drains running work normally | Yes: `CommandRegistry::execute_batch`, no free function | Yes |
| Pipeline variables per `spec/pipeline-variables.md`: `$prev`, `$first`, `$steps`, `$input`, `$$`, the `__` guard, caps of 64 and 1024 | Yes | Yes (core) | Yes | Yes |
| `when` conditions | Yes | Yes | Yes | Yes (as validated JSON) |
| Pipeline aggregation (confidence, reasoning, warnings, sources, alternatives) | Yes | Yes | Yes | Yes (internal helpers) |
| One pipeline engine | Yes | No: core `execute_pipeline` and `DirectClient.pipe` differ in options and result shape | Yes | Yes |
| Stream chunk types, `consumeStream`, `collectStreamData` | Yes | Yes | Yes (`consume_stream` takes a synchronous iterator) | Yes |
| Stream executor | Yes (runs to completion, then chunks) | No | No | Yes (returns a vector) |
| Timeout controller, progress-with-steps helpers | Yes | Yes, with a Pythonic shape: `TimeoutController` is a deadline, not an `AbortController`; `run()` bounds an await by the time left, with `remaining_ms` and `is_expired` | Partial: `TimeoutController` tracks elapsed time only | N/A: `CancellationSource` covers the timeout controller |

### Handoff, telemetry and similarity

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| `HandoffResult`, `createHandoff`, default reconnect policy (3 attempts, 1000 ms) | Yes | Partial: `create_handoff` applies no default policy | Partial: `is_handoff_protocol` and `is_handoff_command` mean different things; `handoff:<p>` tags are ignored | Yes |
| Handoff client: WebSocket and SSE handlers, reconnect | Yes: reconnect falls back to the default policy | Partial: reconnect falls back to 5 attempts, not the default policy's 3 | No | No: not declared |
| `TelemetryEvent`, `TelemetrySink` | Yes | Partial: the core event serializes snake_case, and the middleware defines a second copy | Partial: `durationMs` is an integer | Deferred |
| Telemetry middleware | Yes | Yes | No | Deferred |
| `calculateSimilarity`, `findSimilarTools` (128 cap, 0.4 threshold) | Yes | Yes (not exported from `afd`) | Yes (counts chars, not UTF-16 units) | Yes |

### MCP server

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| MCP server in the library | Yes (SDK v2) | Yes (`mcp` 2.x `MCPServer`) | Yes: `server` feature (`rmcp`), off by default, needs Rust 1.88 | Deferred: the todo backend hand-rolls stdio (#341) |
| MCP 2026-07-28 (stateless, per-request `_meta`, `server/discover`) and 2025 `initialize` on one endpoint or connection | Yes: `/mcp` and stdio | Yes: stdio and Streamable HTTP | Yes: Streamable HTTP and stdio | Todo backend stdio only |
| MCP Streamable HTTP | Yes: `/mcp`; the 2024-11-05 `/sse` + `/message` lane is deprecated | Yes, through `run`, `run_async` and `streamable_http_app` | Yes (`streamable_http_service`) | N/A: no HTTP by design |
| Contexts as request input (`_meta["dev.afd/context"]`) on the modern era | Yes | Yes | N/A: no contexts yet | N/A |
| MCP tool fields: annotations, `structuredContent`, CommandResult `outputSchema` ([`spec/command-metadata.md`](../spec/command-metadata.md#mcp-tool-fields-mcp-2026-07-28-tool-surface)) | Yes | Partial: annotations | Partial: annotations | Partial: annotations (todo backend) |
| Tool strategies: individual, grouped, lazy | Yes (default grouped) | Partial: default individual; all strategies serve discovery/detail, but grouped per-action schema/default alignment remains planned | No | Deferred |
| Meta-tools: `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail` | Yes | Yes | No | Deferred |
| Bootstrap: `afd-help`, `afd-docs`, `afd-schema` | Yes, opt-in | Partial: always registered and MCP-exposed | Yes (`register_bootstrap_commands`) | Deferred |
| Context tools: `afd-context-list`, `-enter`, `-exit` | Yes | Yes: backed by trusted transport sessions, with a deliberate local/default scope | No | No |
| HTTP hardening: Host/Origin checks, body cap | Yes | SDK `transport_security` defaults (foreign `Origin` refused); body cap through `max_request_body_size` | Yes: `HttpOptions` (unlisted origins refused) | N/A |
| MCP JSON-RPC types and helpers | Yes | Partial: Pythonic names; no notification type or error-code constants | Yes | Deferred |

### Clients and tooling

| Capability | TypeScript | Python | Rust | C++ |
|---|---|---|---|---|
| MCP client: call, batch, pipe, stream | Yes: `streamable-http` (SDK v2, `protocolMode`) by default; `sse`/`http` deprecated | Partial: `StreamableHttpTransport` (`mcp.Client`, `protocol_mode`) by default; reconnect refreshes discovery without replaying calls; `stream` only works against the TS server | No | No: not declared |
| In-process client (`DirectClient`) with `allow`, exposure, timeout, `pipe` | Yes | Partial: millisecond timeout and shallow JSON types enforced; exposure, `allow` and middleware remain gaps | Partial: `execute` with an interface; no `pipe` or unknown-tool helper | Yes (see [defects](#defects-found-in-this-review)) |
| CLI | Yes | Partial: no `batch`, `stream` or `scenario` | N/A | N/A |
| Auth adapter | Yes | No | No | N/A: built by the host |
| Testing: JTBD scenarios, surface validation (13 rules), assertions | Yes | Yes | No | No |
| UI: view-state, adapters, local-db, React hooks | Yes | N/A | N/A | N/A |
| Platform utilities and connectors (exec, GitHub, package manager) | Yes (subpath exports) | Yes | Partial: types only | Deferred (connectors) |

## Intended differences

These gaps are appropriate. They follow the framework-agnostic rule, a language's idioms, or the C++ scope principle.

| Difference | Where | Why it is fine |
|---|---|---|
| UI packages (`view-state`, `adapters`, `local-db`) and auth React hooks | TypeScript only | The `afd` skill keeps React and browser integration in ecosystem layers, outside the core parity target. |
| No HTTP transport, engine adapters or auth in the library | C++ | The C++ [scope principle](./features/complete/cpp-support/proposal.md#scope-principle-host-agnostic): hosts build these on middleware, `CommandContext::extra`, `TaskRunner` and `Clock`. Approval is the exception (#422): its tokens must match TypeScript's byte for byte, which a host should not have to reimplement. |
| Synchronous handlers and cooperative deadlines | C++ | Decision D4. A late finish still produces the reference `TIMEOUT` result and error codes; nothing is interrupted. |
| `CancellationSource` instead of a timeout controller | C++ | It is the C++ idiom for `AbortSignal` plus a deadline. |
| Renames: `requires` to `prerequisites`, `interface` to `surface` | C++ | `requires` is a C++20 keyword, and `<windows.h>` defines `interface`. |
| Renames: `success_with`, `failure_with`, `ResultOptions` | Rust | They stand in for TypeScript's option spreads. |
| Pythonic MCP names (`TextContent`, `ToolDefinition`, `mcp_request`) | Python | Same capability, different names. |
| Typed condition guards (`isEqCondition` and nine more) | Missing in Python and C++ | They are TypeScript discriminated-union artifacts. Pydantic models (Python) and validated JSON (C++) do the same job. |
| JSON Schema validation instead of Zod or Pydantic | Rust, C++ | Each language uses its own validator. [`spec/validation.md`](../spec/validation.md) defines the subset every validator supports and the results it gives. |
| No CLI | Rust, C++ | One CLI serves every language, provided the language ships an MCP server the CLI can reach. |
| Platform utilities and connectors | Optional everywhere | These are ecosystem helpers, not the command contract. TypeScript removed them from the core barrel. |
| Rust-only extensions: batch `maxFailures`, per-command `timeout_ms` | Rust | Additive. They should be documented or proposed for the other languages. |

## Declared deferred

These gaps are planned. They are listed so the name budgets stay honest. D1/D2/D6 in the [closure plan](./features/active/parity-closure/parity-closure.plan.md) explicitly cover the native server targets, remaining native middleware/stream work and Python auth. The historical "undeclared" inventory below is retained for context; those decisions are now accepted plans.

- **C++** (the [proposal scope table](./features/complete/cpp-support/proposal.md#scope) and work plan PR 5a):
  - MCP JSON-RPC types and helpers, and perhaps an optional `afd::mcp_stdio` target;
  - the meta-tools and bootstrap commands;
  - retry, rate-limit and telemetry middleware, and the telemetry types;
  - connectors;
  - `CommandParameter`;
  - streamable-command metadata.
- **Rust** (the `afd-rust` skill's parity note): an MCP server, active-context scoping at execution time, and the server-side tool strategies.

**Accepted role decisions (D6).** Native MCP clients, CLIs, testing toolkits and handoff clients are N/A; Python auth is planned. Remaining implementation gaps include:

- **C++:** planned `compose_middleware` and deferred native stdio target/middleware; tracing middleware is N/A.
- **Rust:** planned stream executor, built-in middleware and optional server feature.
- **Python:** planned auth adapter.

## Unintended gaps

Ordered by how much an agent or a security boundary is affected.

### Priority 1: agent-visible behavior and safety

1. **Python dispatch order.** Fixed. The server runs lookup (with "did you mean"), exposure, active context and input validation before the middleware chain (`python/src/afd/server/factory.py`, `_prepare_command`). Middleware now sees only calls that reach a handler, with validated input. `input=None` validates as `{}`, so a missing required field returns `VALIDATION_ERROR` instead of crashing the handler.
2. **Exception text reaches callers.**
   - **Python:** fixed. The core registry, the core pipeline and `SimpleRegistry` return `COMMAND_EXECUTION_ERROR` with "An internal error occurred" and log the exception. Each takes a `dev_mode` flag, as the server does.
   - **Rust (fixed):** single `CommandRegistry::execute` did not catch panics; only batch and pipeline did. It now catches a panic in middleware or the handler, and returns the redacted error.
3. **Crash error code (fixed).** Rust returned `INTERNAL_ERROR` where the reference returns `COMMAND_EXECUTION_ERROR`, and its `error_codes` omitted that code. `execute`, batch and pipeline now return `COMMAND_EXECUTION_ERROR` through the exported `execution_failure`, and `error_codes` has the code.
4. **Success discriminants (fixed in the candidate).** Python `is_success(success(None))` is true; Rust guards also test only `success`.
5. **Python `DirectClient` boundary remains partial.** Positive finite millisecond deadlines and shallow JSON-shaped input checks are implemented. Exposure, an `allow` predicate and middleware remain gaps. Cancellation is cooperative: a blocking or cancellation-resistant handler may still mutate after a deadline.
6. **Python context state (fixed in the candidate).** Actual FastMCP SDK transport sessions own independent stacks capped at 16. Caller-supplied session strings never establish identity; stateless HTTP context mutation returns `SESSION_REQUIRED`. Local calls use a deliberate default scope.
7. **Python `SseDecoder` frame cap (fixed in the candidate).** Decoded UTF-8 frames default to 1 MiB, counting metadata, comments and separators. Upstream reader line allocation remains outside this decoder.
8. **Python defaults differ from TypeScript.**
   - The bootstrap tools are always registered and MCP-exposed; in TypeScript they are opt-in.
   - The default tool strategy is `individual`; in TypeScript it is `grouped`.

### Priority 2: shared executors and cross-language tests

9. **Done for pipeline and batch vectors.** `pipeline-variables.json` and `batch-controls.json` pass in TypeScript, Python, Rust and C++ (parity closure plan items 1.1 and 1.4). `validation.json` now loads in all four candidate suites (#310, #311, #312), including explicit registration rejection for unsupported optional keywords. Wiring them in fixed these divergences:
    - **Python and Rust** treated a literal `when` operand, such as `{"$exists": "$$prev"}`, as present. TypeScript and C++ treat it as absent. Rust's `$eq` also told `2` from `2.0`.
    - **Python and Rust** ran envelopes that TypeScript rejects: blank command names, `null` in place of an omitted field, and (in Python) a string where a boolean or number belongs. Python's `afd-batch` and `afd-pipe` also answered some malformed envelopes with a plain failure; they now return the failed `BatchResult`, or the pipeline's synthetic step at index -1.
    - **Rust** skipped every step for `timeoutMs: 0`, where TypeScript fails step 0. It also failed the step after one that overran the deadline, instead of skipping it.

    Fixed in the candidate: TypeScript MCP `afd-batch` and POST `/batch` return the canonical failed `BatchResult` for malformed AFD envelopes (#314). Non-object MCP arguments are rejected earlier as JSON-RPC `-32602`.
10. **Add a stream executor to Python and Rust,** and a public batch executor to Python. Collapse Python's two pipeline engines into one.
11. **Rust single-command engine:**
    - result metadata stamping;
    - active-context scoping;
    - `onCommand` and `onError` hooks;
    - the built-in middleware bundle.
12. **Validation alignment in the candidate.** [`spec/validation.md`](../spec/validation.md) and 34 cases / 130 tests cover the required subset in all four languages. Python executes all 130; Rust executes 102 and rejects 28 tests across unsupported optional cases; C++ executes 98 and rejects 32. These rejection checks are conformance to the subset contract, not skipped tests.
    - Python validates advertised raw/Pydantic schemas before handlers and rejects coercible numeric strings and booleans as numbers. Pydantic conversion still supports valid UUID/date strings.
    - Rust's additive `register_with_schema(command, Value)` supports the full required subset without changing legacy public schema fields. `get_tool`, `afd-schema` and `afd-docs` use the authoritative schema; standalone `command_to_mcp_tool` only converts legacy definitions.
    - Explicit null stays present and is never defaulted. Inserted defaults are cloned as-is, without validation or nested default expansion. Empty legacy Rust parameter lists strip object input to `{}` and reject nonobjects.
    - Diagnostic issues are uncapped. Sibling field/issue order may differ; comparisons preserve multiplicity and absent/present distinctions. Array items remain in index order before bounds; object unknown-key issues follow property issues. Suggestions use actual issue order.
    - Schema lengths count code points on supported Zod 4.5.4+. Reference caps count 1,024 UTF-16 units in every implementation. Unsupported optional keywords/formats/regex syntax fail registration with a location.
13. **Command metadata** ([`spec/command-metadata.md`](../spec/command-metadata.md) lists the fields).
    - Python's decorator lacks `errors` and `execution_time`.
    - Rust's tools carry no `_meta`, so `destructive` and `undoable` reach agents through annotations, afd-help and afd-docs only.
14. **Handoff.**
    - Python's `create_handoff` applies no default reconnect policy, and its handoff client falls back to 5 attempts where the default policy has 3.
    - Rust's guard helpers differ in meaning.
15. **Python MCP client (fixed in the candidate).** HTTP/SSE loss and idle SSE EOF trigger one bounded reconnect loop with refreshed discovery; manual lifecycle operations cancel obsolete attempts. In-flight mutations are never replayed. Socket tests exercise actual httpx/MCP SDK sessions locally.
16. **C++ metadata cannot reach the wire.**
    - There is no command-to-MCP-tool conversion and no `to_json` for `CommandDefinition`.
    - The todo backend's `tools/list` sends no `_meta` or `outputSchema`.
    - Suggestions no longer name `afd-discover` and `afd-context-*`, which C++ does not have (fixed): an unknown command points to `afd-help` when the caller can call it, as in Rust, and `COMMAND_NOT_IN_CONTEXT` names the command's contexts.

### Priority 3: reference decisions that affect every language

17. **The TypeScript server does not speak MCP Streamable HTTP (fixed).** The [MCP 2026-07-28 upgrade](./features/active/mcp-2026-07-28/proposal.md) added `/mcp` and dual-era stdio on the official SDK (#391) and a `streamable-http` client transport (#392). All four todo backends pass the conformance suite in `legacy`, `auto` and `modern` mode.
18. **Unknown and unexposed commands (decided: D4).** [`spec/error-codes.md`](../spec/error-codes.md#unknown-and-unexposed-commands-d4) writes the TypeScript split down as the rule: remote MCP gives `COMMAND_NOT_FOUND` for both, an in-process registry called with an interface gives `COMMAND_NOT_EXPOSED`, and `DirectClient` gives `UNKNOWN_TOOL` with a `suggestion`. Suggestions name only tools the host provides. Fixed to match:
    - **TypeScript and Python:** the router's unreachable `COMMAND_NOT_EXPOSED` branch in `afd-call` is gone.
    - **Python:** `afd-batch` and `afd-pipe` no longer reveal a private command with `COMMAND_NOT_EXPOSED`, and the context check no longer reveals it through tools/call. `INVALID_INTERFACE` is gone: an unknown interface exposes nothing, and an empty one is no interface. `DirectClient`'s `UNKNOWN_TOOL` has a `suggestion` and `retryable: false`. The core registry's `COMMAND_NOT_IN_CONTEXT` names the command's contexts instead of the `afd-context-*` tools it lacks.
    - **C++:** see item 16.
    - **Fixed in the candidate:** Python intercepts unknown/private FastMCP tools with structured `COMMAND_NOT_FOUND`; all strategies serve `afd-discover` and `afd-detail` (#325).
19. **The `ErrorCodes` catalog (fixed).** TypeScript's catalog omitted 20 codes the engines emit, so each language added its own. [`spec/error-codes.md`](../spec/error-codes.md) now lists every emitted code with its meaning, retryability and emitting layer, and separates the 42-code shared catalog from transport-specific and package codes. All four languages define the shared catalog, and each test suite checks it against `spec/vectors/error-codes.json`.
20. **The TypeScript `MockServer` runs on the core registry.** It has no Zod validation, did-you-mean, middleware or context scoping, so scenario tests run different semantics from production.

## Defects found in this review

| Defect | Location | Notes |
|---|---|---|
| C++ `DirectClient::call` previously lost caller cancellation when `timeout_ms` was set | `packages/cpp/src/direct_client.cpp` | Fixed in #315: the deadline source chains the caller token; the current source preserves parent cancellation. |
| Rust single `execute` lets a handler panic unwind to the caller | `packages/rust/src/commands.rs` (`CommandRegistry::execute`) | Fixed; Priority 1 item 2 |
| Python core registry, core pipeline and `SimpleRegistry` return exception text | See Priority 1 item 2 | Fixed |
| TypeScript core `executePipeline` exposed custom executor exceptions | `packages/core/src/pipeline-executor.ts` | Fixed in candidate [#366](https://github.com/lushly-dev/afd/issues/366): shared redacted execution failure, with secret/path regressions. |
| Python `auto_reconnect` was dead code | `python/src/afd/client.py` | Fixed in candidate; Priority 2 item 15 |

## Name parity (`alfred parity`)

Measured at `0777217`: TypeScript 186 exports, Python 179, Rust 225, C++ 158. The Rust row was re-measured after `execution_failure` was exported, after #401 (Rust then had 251 exports), after #426 and after #421 (Rust then had 285 exports), and the Python row after #348, #400, #425 and #420 (Python then had 230 exports).

| Language | Missing | What the missing names are |
|---|---|---|
| Python | 88 | **56 exist but are not exported from `afd`:** the pipeline contract in `afd.core.pipeline` and `pipeline_variables` (38), similarity (4), `execution_failure`, and 13 MCP names with Pythonic spellings. Re-exporting the pipeline names is blocked by collisions: `afd.PipelineStep`, `PipelineResult`, `CommandDefinition` and `CommandContext` are the `afd.direct` dataclasses, not the core types. **13 are real gaps:** the batch and stream executors and their options, the registry and executor options types (`create_command_registry` and `execute_pipeline` take a `dev_mode` keyword instead), the exposure helpers, `DEFAULT_RECONNECT_POLICY`, and the MCP error-code constants and notification and list types. **19 are TypeScript typing artifacts:** the condition guards, `McpId` and similar. [#348](https://github.com/lushly-dev/afd/issues/348) exported the core registry, middleware, `WarningSeverity` and `ErrorCode` names and added the timeout controller and progress-with-steps; [#400](https://github.com/lushly-dev/afd/issues/400) added the 15 context primitives; [#425](https://github.com/lushly-dev/afd/issues/425) added the 13 command journal names; [#420](https://github.com/lushly-dev/afd/issues/420) added the 3 approval policy names. |
| Rust | 9 | **Export artifacts:** `is_mcp_exposed` (`is_exposed_to(Mcp)`), `max_similarity_input_length` (at `afd::similarity`), `truncate_name` (private), `execute_batch` (a registry method). **A convenience:** `commands_to_mcp_tools`. **Real gaps:** `execute_stream` and `stream_executor_options`. **No dev mode:** `executor_options` and `command_registry_options`. [#426](https://github.com/lushly-dev/afd/issues/426) closed the 13 command journal names; [#421](https://github.com/lushly-dev/afd/issues/421) the 3 approval policy names. |
| C++ | 76 | #427 closed the 13 command-journal names and [#422](https://github.com/lushly-dev/afd/issues/422) the 3 approval-policy names. **MCP tool fields (2):** `command_tool_annotations` and `command_result_output_schema`; the C++ todo backend derives them inline. **By design (1, #402):** `ClockInstant`; C++ clocks take epoch milliseconds only. #402 closed the other nine context-primitive names (`Actor`, `ActorKind`, `actor_kinds`, `is_actor`, `is_actor_kind`, `ContextDefaults`, `with_context_defaults`, `fixed_clock`, `SystemRandom`). **Deferred (33):** 26 MCP types and helpers, 4 telemetry, `CommandParameter`, and the 2 streamable-command names. **By design (25):** 21 typed condition types and guards, the timeout controller (2), `json_schema` and `create_command_registry`. **Cheap to close (15):** `is_mcp_exposed`, `command_to_mcp_tool`, `commands_to_mcp_tools`, `is_pipeline_condition` over JSON, `is_batch_command`, `is_pipeline_step`, `get_nested_value`, `stream_executor_options` (an alias of `StreamOptions`), `create_progress_chunk_with_steps`, and the 6 aggregation helpers. |

The budgets in `alfred/tests/test_parity.py` equal these counts. Lower a budget in the same pull request that closes a gap.

## Documentation drift

**Updated:**

- The [Python](./features/active/python-parity/python-parity.plan.md) and [Rust](./features/complete/rust-parity/plan.md) parity plans still showed their 2026-03-21 counts.
- The [C++ proposal](./features/complete/cpp-support/proposal.md) still read "Phase 0 complete", with no success criterion checked.
- The [feature index](./features/README.md) listed C++ only as proposed.
- The root `README.md` said every language shares "the same AFD capability set", and listed Rust stream support.
- The `afd` skill's parity rule named three languages.
- The parity notes in the `afd-rust` and `afd-cpp` skills.
- The `afd-rust` skill showed the not-found message as `"Todo '123' not found"`, and its description said "building Rust MCP servers".
- The `afd-cpp` skill said to guard catch blocks with `__cpp_exceptions`. Library code uses `AFD_HAS_EXCEPTIONS`, which also checks MSVC's `_CPPUNWIND`.
- The C++ `README.md` said the library was "being built in phases", fetched a release tag that was not cut yet, and said CI ran every preset on Linux, macOS and Windows.
- The [C++ work plan](./features/complete/cpp-support/work-plan.md) named the wire test `tests/wire_fixtures.cpp`, and did not record that `TaskRunner` shipped as `run_all` with `ThreadTaskRunner`.
- `site/index.html` listed three languages, showed `cargo add afd` for a crate that is not on crates.io, and used the old `@afd/*` package names, as did the root `README.md`.
- The todo `spec/README.md` said "TypeScript, Python, etc.". It and the todo `README.md` said only the TypeScript and Python suites check `commands.schema.json`; the C++ suite does too.

The Python README and skill examples listed here previously were corrected in #305: MCP exposure is explicit, handlers use declared input models, middleware examples use the supported API, and server startup uses the supported signature.

## Recommended next steps

1. **Validate and deliver the candidate boundary fixes.** C++ `DirectClient` parent cancellation was fixed in #315; custom TypeScript pipeline exception redaction is fixed in this candidate (#366). Publication remains separate.
2. **Complete review and release gates for the validation candidate** (#310, #311, #312). All four suites now load validation, reference and executor-control vectors; fresh review fixes need final validation before merge.
3. **Write the unknown and unexposed error codes into a spec,** and add the emitted codes to the `ErrorCodes` catalog. Done: [`spec/error-codes.md`](../spec/error-codes.md).
4. **Extend the [AFD protocol conformance tier](../spec/protocol-conformance.md).** All four backends run the todo suite in both MCP eras. Rust's grouped and lazy strategies, meta-tools and contexts (D1), the C++ `afd::mcp_stdio` target (#341) and a shared executable protocol fixture remain follow-up work.
5. **Python export cleanup:** resolve the `afd.direct` name collisions, then re-export the pipeline, similarity and registry contract. This removes 61 names from the budget.
6. **Decide the undeclared gaps** listed under [Declared deferred](#declared-deferred), and record each decision here.

## Keeping this current

- Update the relevant row when a change adds, removes or changes a capability in any language. A change that closes a gap should also lower the `alfred` budget.
- Update the Version and Contract rows with each release and each contract change (see [`spec/CHANGELOG.md`](../spec/CHANGELOG.md)). `node scripts/check-versions.mjs`, which `pnpm check` runs, fails when they disagree with the manifests or the contract constants. `node scripts/check-versions.mjs --write` rewrites them from those sources, and `pnpm version-packages` runs it for TypeScript releases.
- Re-measure with `uv run --project alfred alfred parity --path .`. It exits 1 while any gap remains; `alfred/tests/test_parity.py` holds the budgets.
- When TypeScript gains a shared capability, add a row with **No** or **Deferred** for the other languages, rather than leaving it out.
