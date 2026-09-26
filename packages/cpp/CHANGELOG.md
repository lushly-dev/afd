# Changelog

All notable changes to afd-cpp are documented here. The package is versioned independently of the npm packages (proposal D11) and is released with tags of the form `afd-cpp-vX.Y.Z`.

## Unreleased

### Added

- `CommandRegistry`:
  - `register_command` rejects invalid, reserved and duplicate names, a missing handler, unsupported schemas, and examples that fail their schema.
  - `execute` follows the TypeScript engine's dispatch order and errors: COMMAND_NOT_FOUND with "did you mean" matches, COMMAND_NOT_EXPOSED, COMMAND_NOT_IN_CONTEXT, VALIDATION_ERROR, metadata stamping, `on_command`, and COMMAND_EXECUTION_ERROR for exceptions.
  - Listing by category, exposure and handoff.
- `CommandDefinition`, `CommandContext`, `ExposeOptions`, `Handler`, `Middleware` and `validate_command_name`.
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
