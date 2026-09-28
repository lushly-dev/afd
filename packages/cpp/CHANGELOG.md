# Changelog

All notable changes to afd-cpp are documented here. The package is versioned independently of the npm packages (proposal D11) and is released with tags of the form `cpp-vX.Y.Z`.

## Unreleased

### Changed

- Renamed to match TypeScript: `Handler` → `CommandHandler`, `Middleware` → `CommandMiddleware`, `RegistryOptions` → `CommandRegistryOptions`.

### Added

- **Contract version:** `afd::contract_version` in `afd/version.hpp` is the AFD contract version this library implements (`spec/VERSION`, now `1.0-rc`).
- **Packaging:**
  - install rules and a relocatable CMake package: `find_package(afd 0.1 CONFIG)` provides `afd::afd`, with `SameMinorVersion` compatibility;
  - when afd downloads nlohmann/json, the install includes it;
  - the `AFD_INSTALL` and `AFD_BUILD_EXAMPLES` options, both on only when afd is the top-level project;
  - `examples/quickstart.cpp`, and a consumer project that CI builds through `find_package` and `FetchContent` on Linux and Windows.
- **Handoff:**
  - the types `HandoffResult`, `HandoffCredentials`, `HandoffMetadata`, `ReconnectPolicy` and `CreateHandoffOptions`;
  - the helpers `create_handoff`, `default_reconnect_policy`, `is_handoff`, `is_handoff_protocol`, `is_reconnect_policy`, `is_handoff_command` and `get_handoff_protocol`.
- **Parity helpers:**
  - `ErrorCode`;
  - `create_source`, `create_step`, `update_step_status`, `create_warning`;
  - `is_progress_chunk`, `is_data_chunk`, `is_complete_chunk`, `is_error_chunk`, `is_stream_chunk`;
  - `is_batch_request`, `is_batch_result`, `create_batch_request`;
  - `is_pipeline_request`, `is_pipeline_result`, `create_pipeline`;
  - the built-in tool names `afd_meta_tool_names`, `afd_bootstrap_command_names`, `afd_context_command_names`, `afd_builtin_tool_names` and `is_afd_builtin_name` (`afd/builtin_names.hpp`); `reserved_command_names` now refers to `afd_meta_tool_names`.
- **Tooling:** `alfred parity` now tracks the C++ API, and the `afd-cpp` agent skill is added.
- **Batch execution.**
  - `execute_batch`, and `CommandRegistry::execute_batch`.
  - `parse_batch_request` performs the envelope checks.
  - Semantics follow the TypeScript executor: bounded workers, `stopOnError` with COMMAND_SKIPPED, one deadline with BATCH_TIMEOUT, `<trace>-<index>` trace IDs, and TypeScript's aggregation and reasoning text.
- **Pipeline execution.**
  - `execute_pipeline`, `CommandRegistry::execute_pipeline` and `DirectClient::pipe`.
  - `parse_pipeline_request`, `resolve_variables`, `resolve_variable` and `evaluate_condition` implement every rule in `spec/pipeline-variables.md`.
  - Also: UNSUPPORTED_OPTION for `parallel` and `stream`, 64-level nesting limits, PIPELINE_TIMEOUT, and TypeScript's metadata aggregation.
- **Stream execution.**
  - `execute_stream` and `CommandRegistry::execute_stream`, which return the chunk sequence.
  - `consume_stream`, `collect_stream_data`, and the chunk factories.
- **Runtime.** `TaskRunner` (`InlineTaskRunner`, `ThreadTaskRunner`), and `CancellationSource` chaining to a parent token.
- **`spec/vectors/pipeline-variables.json`,** generated from TypeScript. The C++ resolver and conditions must match it.
- **`spec/vectors/batch-controls.json`:** `tests/batch_vectors_test.cpp` runs its batch and pipeline cases on a `ManualClock`. afd-cpp matched TypeScript on every case without changes (#317).
- **Fuzz targets** (`AFD_BUILD_FUZZERS`), and TSan and fuzz-smoke CI jobs.
- `CommandRegistry`:
  - `register_command` rejects invalid, reserved and duplicate names, a missing handler, unsupported schemas, and examples that fail their schema.
  - `execute` follows the TypeScript engine's dispatch order and errors: COMMAND_NOT_FOUND with "did you mean" matches, COMMAND_NOT_EXPOSED, COMMAND_NOT_IN_CONTEXT, VALIDATION_ERROR, metadata stamping, `on_command`, and COMMAND_EXECUTION_ERROR for exceptions.
  - Listing by category, exposure and handoff.
- `CommandDefinition`, `CommandContext`, `ExposeOptions`, `CommandHandler`, `CommandMiddleware` and `validate_command_name`.
- `CompiledSchema`: a JSON Schema subset validator that returns the parsed input (defaults applied, undeclared members stripped), with Zod 4 issue codes and the TypeScript VALIDATION_ERROR shape. It accepts every todo example input schema.
- `find_similar_tools`, `calculate_similarity` and `truncate_name`, counting UTF-16 code units. Their output matches TypeScript on the same inputs.
- `default_middleware`: trace ID, logging and timing.
- `DirectClient`: allow-list, UNKNOWN_TOOL recovery data, trace IDs, surface exposure, timeouts and client middleware.
- Runtime seams: `Clock` (`SystemClock`, `ManualClock`), `RandomSource` (`SeededRandom`) and `CancellationToken`.
- The wire types, which round-trip every `spec/wire` fixture:
  - `CommandResult` and `ResultMetadata`, which keeps unknown keys in `extra`;
  - `CommandError`, including `cause`;
  - `Source`, `PlanStep`, `Alternative`, `Warning`;
  - `BatchResult`;
  - `PipelineResult`;
  - the four stream chunks.

  Reading goes through `T::from_json`, which returns `afd::Expected<T>` with the path of the first problem. Writing goes through `to_json`, which omits unset fields.
- The `error_codes` constants, and error constructors with the TypeScript text: `create_error`, `validation_error`, `not_found_error`, `rate_limit_error`, `timeout_error`, `internal_error`, `wrap_error`, `is_command_error`.
- The result helpers `success`, `failure`, `error`, `is_success`, `is_failure` and `execution_failure`.
- JSON helpers:
  - `parse_bounded`, which rejects input above its depth limit (default 256) and size limit, and fails on its own depth flag;
  - `wire::number`, which writes numbers as JavaScript does;
  - `wire::iso8601_utc`;
  - `wire::serialize`, which replaces invalid UTF-8 instead of aborting.
- `afd::Expected`, a minimal stand-in for C++23 `std::expected`.
- The CMake package skeleton: the `afd::afd` target, a generated `afd/version.hpp`, and the `afd::Json` alias for `nlohmann::json`.
- Pinned and hash-verified dependencies: nlohmann/json 3.12.0, and doctest 2.5.3 for tests only.
- Presets for `dev`, `release`, `asan`, `noexcept-nortti` and `emscripten`.
- The `cpp.yml` workflow: clang-format; builds on Linux GCC, Linux Clang with ASan and UBSan, no exceptions or RTTI with a unity build and the macro-hygiene check, macOS, and Windows MSVC; and Emscripten, with tests run under Node.
