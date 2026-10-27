# Changelog

All notable changes to the `afd` Rust crate are documented here. The crate is versioned independently of the npm packages and other implementations. Rust releases are distributed through [crates.io](https://crates.io/crates/afd) and use tags of the form `rust-vX.Y.Z`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this crate adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor release may break the API.

## [Unreleased]

## [0.2.1] - 2026-10-27

Implements AFD contract **1.0-rc**.

### Fixed

- The docs.rs build: the crate root enables `doc_cfg` under `--cfg docsrs`, so the feature badges on `approval`, `journal-file` and `server` items build on nightly rustdoc. 0.2.0 failed to document with E0658 and has no docs on docs.rs; its code is unchanged in 0.2.1.

## [0.2.0] - 2026-10-27

Implements AFD contract **1.0-rc**.

### Added

- **Confirmations (`server` feature):** `McpServer::with_confirmations(ConfirmationMode::Enforce | RequireHuman)` and `with_confirmations_key` enforce `confirm_prompt` on tool calls (`spec/command-metadata.md`, "Confirmations"). A gated call runs after the user accepts an elicitation (an `input_required` result with an HMAC-signed `requestState` on MCP 2026-07-28, a server-sent request on a 2025 stdio connection), or, under `Enforce`, after `confirm: true` or `_meta["dev.afd/confirm"]`. Otherwise it fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED`. The feature now enables `rmcp`'s `request-state` and `elicitation` features and depends on `getrandom`.

- **Trust fields:** `CommandDefinition` gains `destructive`, `confirm_prompt` and `undoable`, with `with_destructive`, `with_confirm_prompt` and `with_undoable`. `afd-help` (full) reports `destructive` and `undoable`, `afd-docs` reports all three, and a mutation's `destructiveHint` annotation follows `destructive`. `afd-help`'s `CommandInfo` gains two optional fields, so code that builds it with a struct literal must add them.
- **Confirmation error codes:** `error_codes::CONFIRMATION_REQUIRED` and `error_codes::CONFIRMATION_DECLINED`, for servers that enforce `confirm_prompt`. Nothing emits them yet.
- **Approval error code:** `error_codes::APPROVAL_REQUIRED`, returned by the approval middleware before the handler runs (`spec/command-metadata.md`, "Approvals").
- **Approval policy and middleware** (#421, parity with TypeScript #272): `CommandDefinition::with_approval` takes an `ApprovalPolicy` (`Required`, `NotRequired`, or a function of the validated input and context through `ApprovalPolicy::when` and `when_async`), reported by `approval_mode` as `_meta.approval` on `CommandRegistry::get_tool`, in `afd-help` (full) and in `afd-docs` (`conditional` for a function). `create_approval_middleware(ApprovalMiddlewareOptions)`, behind the new default `approval` feature, holds a call with `APPROVAL_REQUIRED` and `details.approvalToken`, `expiresAt`, `summary` and, for a rejected token, `reason` (`malformed`, `invalid-signature`, `expired`, `command-mismatch`, `input-mismatch`, `actor-mismatch`, `already-used`). Tokens (`afdap1.<payload>.<mac>`, HMAC-SHA256 with an app-supplied secret of at least 32 bytes, keyed digests of the canonical input and actor, constant-time comparison) are byte-compatible with TypeScript's, so a token issued by one verifies on the other; `canonical_json` writes numbers and orders keys as JavaScript does and refuses integers a float cannot hold. Single-use by default (`ApprovalReplay::WithinTtl` allows reuse until expiry), with an in-memory or supplied `ApprovalNonceStore`, key rotation (`with_previous_secret`), `with_summarize`, `with_include_token`, `with_on_approval_required` and a security clock that never comes from the context. `CommandContext` gains `approval` (`with_approval`), which only trusted surface code sets; the MCP server never sets it from tool arguments or `_meta`. `CommandContext`'s `Debug` output redacts the token. New dependencies: `hmac`, `subtle`, `ryu-js` (ECMAScript number spelling) and `getrandom` (0.3 or 0.4) outside the `server` feature; the `approval` feature turns on `serde_json/float_roundtrip`, so floats parse exactly as JavaScript parses them; `wasm` enables `getrandom`'s browser backend (Rust 1.85 or later with `approval`). `CommandInfo` gains an optional `approval` field, so code that builds it with a struct literal must add it.

- **`server` feature:** `afd::server::McpServer` serves a `CommandRegistry` over MCP Streamable HTTP (`streamable_http_service`, a `tower` service) and stdio (`serve_stdio`), built on the official MCP Rust SDK (`rmcp` 3.7). It serves MCP 2026-07-28 statelessly and 2025 `initialize` clients from one endpoint, lists only MCP-exposed commands (`with_tools` supplies full tool definitions), returns `COMMAND_NOT_FOUND` for unknown and unexposed tools, carries `ttlMs` cache hints on `tools/list` (`with_tools_list_ttl_ms`) and refuses unlisted browser origins. The feature is off by default and needs Rust 1.88; the crate's minimum stays 1.82 without it.
- **MCP tool annotations:** `CommandRegistry::get_tool` adds `annotations` (`readOnlyHint: false`, `destructiveHint: false`) for a command with `mutation: true` (`spec/command-metadata.md`).
- **Actor, clock and random on `CommandContext`** (#401, parity with TypeScript #271/#274): `Clock` and `RandomSource` traits with `SYSTEM_CLOCK`, `SYSTEM_RANDOM`, `fixed_clock` (a `ManualClock` moved with `set` and `advance`; clones share time) and `seeded_random` (mulberry32 over FNV-1a of the UTF-8 seed, bit-for-bit the TypeScript sequence). `Actor` and `ActorKind` (`human`, `agent`, `service`, `script`, `test`), `ACTOR_KINDS`, `is_actor`, `is_actor_kind`, `ContextDefaults` and `with_context_defaults`. `CommandContext` gains `actor`, `clock` and `random` (with `with_*` builders and `clock()`/`random()` accessors); `CommandRegistry::execute` always fills the clock and random source and stamps the actor's kind as `metadata.actorKind`. The `wasm` feature reads the system time through `web-time`. The `server` feature runs tool calls as actor `agent`, configurable with `McpServer::with_actor`, `with_clock` and `with_random`.
- **Typed `actorKind`:** `ResultMetadata::actor_kind` and `TelemetryEvent::actor_kind` (it used to round-trip in `extra`); an unknown kind on the wire reads as `None`.
- **Command journal and replay** (#426, parity with TypeScript #273; `spec/journal.md`): `JournalEntry`, `JournalRecord`, `JournalTape`, `JournalContextDigest`, `JournalRange`, the `JournalSink` trait with `MemoryJournalSink`, and `FileJournalSink` (JSON Lines, with torn-line recovery) behind the new default `journal-file` feature. `create_context_digest` hashes the actor, interface, trace ID and the names (never the values) of the other context keys, as TypeScript does; `journal_actor`, `is_journal_entry`, `parse_journal`, `serialize_journal` and `serialize_journal_entry` read and write the shared format, and `spec/wire/journal.jsonl` round-trips. `CommandRegistry::set_journal(JournalRecorder)` records each call after validation and around the middleware chain (`with_record_failures`, `with_filter`, `with_redact`, `with_max_tape_reads`, `with_on_error`; `auth-*` commands are skipped by default; timed-out calls are not recorded, and a `timeout_ms` deadline covers the middleware chain only, not the journal append). `replay_journal` re-executes entries with their clock and random tapes restored and reports `same`, `different` (with per-path differences) or `error`, plus notes on tape over- and under-runs. New dependency: `sha2`.
- **MCP 2026-07-28 error codes:** `McpErrorCodes::HEADER_MISMATCH` (-32020), `MISSING_REQUIRED_CLIENT_CAPABILITY` (-32021) and `UNSUPPORTED_PROTOCOL_VERSION` (-32022).

### Changed

- **Breaking:** `TelemetryEvent` gains `actor_kind` and is now `#[non_exhaustive]`; build it with `TelemetryEvent::new` or `create_telemetry_event` and the `with_*` methods.
- `metadata.actorKind` is now the typed `ResultMetadata::actor_kind`, so `metadata.extra.get("actorKind")` returns `None`. An unknown kind (not `human`, `agent`, `service`, `script` or `test`) reads as `None` and is not kept on a round trip, where 0.1.0 kept it in `extra`. When the registry stamps the kind, it removes any `actorKind` a handler left in `extra`.

### Deprecated

- `McpErrorCodes::SERVER_NOT_INITIALIZED` (-32002): MCP 2026-07-28 servers must not emit it.

## [0.1.0] - 2026-10-12

First release. It implements AFD contract **1.0-rc**. Published on
[crates.io](https://crates.io/crates/afd/0.1.0), with
[API documentation](https://docs.rs/afd/0.1.0/afd/). Git and path dependencies remain usable.

### Fixed

- Reject references outside named schema definitions, preventing references into uninspected annotation/default data, and enforce both `const` and `enum` when combined.

- Explicit `null` remains a value instead of taking a default or being reported missing (#282).
- Apply schema and nested defaults as-is; export defaulted parameters as optional and preserve parameter default precedence (#284).
- Empty legacy parameter lists enforce their advertised empty object schema, and validation reports every issue (#332). Applications needing open payloads should use whole-schema registration.
- Pipeline references use the shared 1,024 UTF-16-unit limit, including astral characters (#283).

### Added

- `CommandRegistry::register_with_schema` and `get_tool` preserve whole input schemas without changing existing public field types. Validation supports the required shared subset and `const`; unsupported keywords fail registration. Bootstrap schema/docs discovery uses the same authoritative schema (#311).
- Shared validation vectors exercise supported cases through actual registry dispatch and verify optional unsupported cases fail registration. Boundary tests cover defaults, null, authoritative discovery, uncapped issues, oversized numeric bounds, and UTF-16 limits.

- The wire types, which serialize exactly like `@lushly-dev/afd-core` (camelCase keys, unset fields omitted, unknown metadata keys kept in `extra`). `tests/wire_fixtures.rs` round-trips every `spec/wire` fixture:
  - `CommandResult<T>`, `ResultMetadata`, `CommandError` and `ErrorCode`;
  - `Source`, `PlanStep`, `Alternative` and `Warning`;
  - the batch, pipeline and stream result shapes.
- The result helpers `success`, `success_with`, `failure`, `failure_with`, `error`, `is_success` and `is_failure`, and the error constructors `validation_error`, `not_found_error`, `rate_limit_error`, `timeout_error`, `internal_error`, `wrap_error` and `create_error`.
- `CommandRegistry` (`create_command_registry`). It validates input against the declared parameters and applies defaults, honors `expose` and `CommandContext.timeout_ms`, runs `CommandMiddleware`, and propagates the context into batches (#251).
- Batch execution (`BatchRequest`, `BatchOptions`, `BatchResult`). A batch runs every command unless `stopOnError` is set, and honors `parallelism` and the deadline (#225, #250).
- Pipelines: `execute_pipeline`, which runs through a `CommandExecutor` callback, conditions, and variable resolution that follows `spec/pipeline-variables.md` (#250).
- Stream chunk types and helpers: `ProgressChunk`, `DataChunk`, `CompleteChunk`, `ErrorChunk` and `StreamChunk`.
- The bootstrap commands `afd-help`, `afd-docs` and `afd-schema` (`register_bootstrap_commands`).
- Handoff types and helpers, MCP JSON-RPC types with command-to-tool conversion (there is no MCP server or client), telemetry events, and `find_similar_tools`.
- `AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES`, `AFD_BUILTIN_TOOL_NAMES` and `is_afd_builtin_name`, with the same names as the other languages (#292).
- The `native` feature (default), which enforces deadlines through `tokio::time::timeout`, and the `wasm` feature for `wasm32-unknown-unknown`, which measures durations with `web-time`.
- CI: `rust.yml` runs `cargo fmt --check`, clippy with `-D warnings` and the tests, each with and without default features, and checks the `wasm` build, on a pinned toolchain (#234).
- `execution_failure(message, dev_mode)` and `error_codes::COMMAND_EXECUTION_ERROR`, matching the TypeScript and C++ helpers (#306).
- `afd::CONTRACT_VERSION`, the AFD contract version from `spec/VERSION` (now `1.0-rc`). `afd-help` returns it as `contractVersion` (#313).
- `rust-version = "1.82"` declares the minimum supported Rust version. The README badge said 1.70, which no longer built (#313).
- `error_codes` holds the 42-code shared catalog of `spec/error-codes.md`, adding `COMMAND_NOT_IN_CONTEXT`, `COMMAND_NOT_ALLOWED`, `UNKNOWN_TOOL`, `AMBIGUOUS_ACTION`, `INVALID_GROUPED_CALL`, the context, batch, pipeline and stream codes. `tests/error_codes.rs` checks it against `spec/vectors/error-codes.json`, and the executors use the constants instead of string literals.

### Changed

These changes affect code that used the crate as a git dependency before this release.

- **Breaking:** types serialize exactly like `@lushly-dev/afd-core` (metadata, batch, pipeline and stream shapes). Batches continue on error by default. Public structs are `#[non_exhaustive]`, with constructors and `with_*` builders; `ResultOptions` and `FailureOptions` stay open for `..Default::default()`. A panicking handler fails only its own batch command or pipeline step (#250).
- **Breaking:** pipeline variable references follow `spec/pipeline-variables.md`, as in every language. `$input` is the request's own `input` field and never the host or caller context; `$`-prefixed literals such as `$9.99` pass through; `$$` escapes; paths follow only own JSON keys and in-bounds indices; unresolved references are omitted; `$eq`/`$ne` compare structurally; nesting deeper than 64 is rejected with `VALIDATION_ERROR` (#250).
- **Breaking:** a pipeline step with `stream: true` fails with `UNSUPPORTED_OPTION`, and every other step is skipped before any command runs, as in TypeScript. `stream: false` is still accepted (#253).
- `CommandRegistry::execute` builds its `COMMAND_NOT_FOUND` suggestion the way the TypeScript server does: up to three close matches (`Did you mean 'todo-create'? Other close matches: 'todo-list'.`) instead of a fixed hint. It matches only against commands exposed to `CommandContext.interface` when that is set, so unexposed names are not revealed. It ends with "Use afd-help to list all commands." when `afd-help` is registered and callable, otherwise "Check the command name against the available commands." (#278)
- **Breaking:** `CommandRegistry::execute` behaves like the TypeScript engine in three ways (#286). (1) `VALIDATION_ERROR` has the message `Input validation failed`. The issues and the unknown, missing and expected fields move to `suggestion`, formatted as TypeScript formats them. Each `details.errors` entry gains a Zod `code` (`invalid_type`, `invalid_value`, `too_small`, `too_big` or `invalid_format`), plus `expected` for `invalid_type`. Paths are joined with dots (`tags.1`, or `(root)` for the whole input), and empty `missingFields`/`unexpectedFields` are omitted. (2) Handlers and middleware no longer receive keys the parameters do not declare, nor keys missing from a nested schema's `properties` unless it has `additionalProperties`. A command that read undeclared keys must declare them. (3) An unknown command name is cut to 128 UTF-16 code units in the error message. `find_similar_tools` and `calculate_similarity` count UTF-16 code units, so names with emoji or other characters outside the Basic Multilingual Plane get the same suggestions as in TypeScript. `packages/rust/README.md` lists the differences that remain.
- **Breaking:** a panic in `execute`, a batch or a pipeline returns `COMMAND_EXECUTION_ERROR` with "An internal error occurred" instead of `INTERNAL_ERROR`. The panic payload is never included (#306).
- `is_success` and `is_failure` test only the `success` flag, as in TypeScript (#306).
- **Breaking:** `BatchRequest` and `PipelineRequest` deserialize only envelopes that TypeScript accepts (`spec/vectors/batch-controls.json`). A command name must not be blank. An optional field may be omitted but not `null`, except a pipeline's `input`. A step `input` must be an object, `timeoutMs` a non-negative number, and `onProgress` unset. An invalid batch returns `INVALID_BATCH_REQUEST` with TypeScript's message, "Invalid batch request envelope" (#317).
- With the `native` feature, deadlines and durations use `tokio::time::Instant`, the clock `tokio::time::timeout` enforces them with, so they follow a paused Tokio test clock (#317).

### Fixed

- Batch concurrency, stop and deadline controls are honored, and a pipeline with `parallel: true` fails with `UNSUPPORTED_OPTION` instead of running sequentially (#225).
- Deadline options (`timeoutMs`) fail with `UNSUPPORTED_OPTION` before anything runs in builds without the `native` feature (#225).
- Stream serialization is corrected, and JSON-RPC request IDs may be negative integers (#225).
- Fuzzy matching of unknown command names is bounded, so an oversized name no longer blocks for seconds. Echoed names are truncated (#232).
- The `wasm`, MCP and handoff types are fixed (#251).
- Pipeline deadlines behave as in TypeScript: `timeoutMs: 0` fails step 0 with `PIPELINE_TIMEOUT` instead of skipping every step, and a step that ends past the deadline skips every later step with that error (#317).
- A `when` condition treats a first operand that is not a reference (`"$$prev"`, `"text"`) as absent, and `$eq`/`$ne` compare numbers by value (`2` equals `2.0`), as in TypeScript. `tests/pipeline_vectors.rs` and `tests/batch_controls_vectors.rs` load the shared `spec/vectors` files (#317).
- `CommandRegistry::execute` catches a panic in a middleware layer or the handler, including one raised while building the future and one under `timeout_ms`, instead of letting it unwind to the caller (#306).

[Unreleased]: https://github.com/lushly-dev/afd/compare/rust-v0.2.1...HEAD
[0.2.1]: https://github.com/lushly-dev/afd/compare/rust-v0.2.0...rust-v0.2.1
[0.2.0]: https://github.com/lushly-dev/afd/compare/rust-v0.1.0...rust-v0.2.0
[0.1.0]: https://github.com/lushly-dev/afd/releases/tag/rust-v0.1.0
