# Changelog

All notable changes to the `afd` Rust crate are documented here. The crate is versioned independently of the npm packages and the other implementations, is published to [crates.io](https://crates.io/crates/afd), and is released with tags of the form `rust-vX.Y.Z`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this crate adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, a minor release may break the API.

## [0.1.0] - Unreleased

The first release on crates.io. Until now the crate was only available as a git dependency.

### Added

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

### Changed

These changes affect code that used the crate as a git dependency before this release.

- **Breaking:** types serialize exactly like `@lushly-dev/afd-core` (metadata, batch, pipeline and stream shapes). Batches continue on error by default. Public structs are `#[non_exhaustive]`, with constructors and `with_*` builders; `ResultOptions` and `FailureOptions` stay open for `..Default::default()`. A panicking handler fails only its own batch command or pipeline step (#250).
- **Breaking:** pipeline variable references follow `spec/pipeline-variables.md`, as in every language. `$input` is the request's own `input` field and never the host or caller context; `$`-prefixed literals such as `$9.99` pass through; `$$` escapes; paths follow only own JSON keys and in-bounds indices; unresolved references are omitted; `$eq`/`$ne` compare structurally; nesting deeper than 64 is rejected with `VALIDATION_ERROR` (#250).
- **Breaking:** a pipeline step with `stream: true` fails with `UNSUPPORTED_OPTION`, and every other step is skipped before any command runs, as in TypeScript. `stream: false` is still accepted (#253).
- `CommandRegistry::execute` builds its `COMMAND_NOT_FOUND` suggestion the way the TypeScript server does: up to three close matches (`Did you mean 'todo-create'? Other close matches: 'todo-list'.`) instead of a fixed hint. It matches only against commands exposed to `CommandContext.interface` when that is set, so unexposed names are not revealed. It ends with "Use afd-help to list all commands." when `afd-help` is registered and callable, otherwise "Check the command name against the available commands." (#278)
- **Breaking:** `CommandRegistry::execute` behaves like the TypeScript engine in three ways (#286). (1) `VALIDATION_ERROR` has the message `Input validation failed`. The issues and the unknown, missing and expected fields move to `suggestion`, formatted as TypeScript formats them. Each `details.errors` entry gains a Zod `code` (`invalid_type`, `invalid_value`, `too_small`, `too_big` or `invalid_format`), plus `expected` for `invalid_type`. Paths are joined with dots (`tags.1`, or `(root)` for the whole input), and empty `missingFields`/`unexpectedFields` are omitted. (2) Handlers and middleware no longer receive keys the parameters do not declare, nor keys missing from a nested schema's `properties` unless it has `additionalProperties`. A command that read undeclared keys must declare them. (3) An unknown command name is cut to 128 UTF-16 code units in the error message. `find_similar_tools` and `calculate_similarity` count UTF-16 code units, so names with emoji or other characters outside the Basic Multilingual Plane get the same suggestions as in TypeScript. `packages/rust/README.md` lists the differences that remain.
- **Breaking:** a panic in `execute`, a batch or a pipeline returns `COMMAND_EXECUTION_ERROR` with "An internal error occurred" instead of `INTERNAL_ERROR`. The panic payload is never included (#306).
- `is_success` and `is_failure` test only the `success` flag, as in TypeScript (#306).

### Fixed

- Batch concurrency, stop and deadline controls are honored, and a pipeline with `parallel: true` fails with `UNSUPPORTED_OPTION` instead of running sequentially (#225).
- Deadline options (`timeoutMs`) fail with `UNSUPPORTED_OPTION` before anything runs in builds without the `native` feature (#225).
- Stream serialization is corrected, and JSON-RPC request IDs may be negative integers (#225).
- Fuzzy matching of unknown command names is bounded, so an oversized name no longer blocks for seconds. Echoed names are truncated (#232).
- The `wasm`, MCP and handoff types are fixed (#251).
- `CommandRegistry::execute` catches a panic in a middleware layer or the handler, including one raised while building the future and one under `timeout_ms`, instead of letting it unwind to the caller (#306).

[0.1.0]: https://github.com/lushly-dev/afd/commits/main/packages/rust
