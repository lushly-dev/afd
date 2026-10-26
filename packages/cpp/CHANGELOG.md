# Changelog

All notable changes to afd-cpp are documented here. The package is versioned independently of the npm packages (proposal D11) and is released with tags of the form `cpp-vX.Y.Z`.

## Unreleased

### Added

- Approval policy and approval middleware, matching TypeScript (#272, #422; `spec/command-metadata.md`, "Approvals"). `CommandDefinition::approval` takes an `ApprovalDecision` (`required`, `not_required`) or an `ApprovalPolicyFunction` of the validated input and context; `approval_mode` and `approval_mode_name` report it (`conditional` for a function), and the todo backend's `tools/list` sends it as `_meta.approval`. `afd/approval.hpp` adds `create_approval_middleware`, which returns `APPROVAL_REQUIRED` before the handler with `details.approvalToken`, `expiresAt`, `summary` and, for a rejected token, `reason` (`ApprovalRejection`). Tokens are `afdap1.<payload>.<mac>`, byte for byte TypeScript's, so a token issued by one verifies on the other with the same secret: HMAC-SHA256 with an app-supplied secret (no default, at least 32 bytes, several for rotation), constant-time comparison, single-use by default (`ApprovalReplay::within_ttl`, `ApprovalNonceStore`), expiry from the middleware's own clock. Also `canonical_json` (keys in UTF-16 order, numbers as JavaScript writes them; refuses integers beyond 2^53 − 1, non-finite numbers and invalid UTF-8 rather than risk two inputs sharing a digest), `ApprovalCommand`, `ApprovalRequest`, `summarize`, `include_token`, `on_approval_required` and `random_bytes`. `CommandContext` gains `approval`, the evidence a trusted surface sets; the journal names it in the context digest, never its value. HMAC-SHA256 is self-contained on the existing SHA-256 and checked against RFC 4231; a new `afd_fuzz_approval` target fuzzes token verification and the `canonical_json` round trip.
- Command journal and replay, matching TypeScript (#273, #427; `spec/journal.md`). `afd/journal.hpp` has `JournalEntry`, `JournalRecord`, `JournalTape`, `JournalContextDigest`, `JournalRange`, the `JournalSink` interface and a thread-safe `MemoryJournalSink`; `create_context_digest` (SHA-256 over the actor, the surface, the trace ID and the names of the other context members, never their values; the same hash as TypeScript for the same context), `journal_actor`, `is_journal_entry`, `JournalEntry::from_json`, `serialize_journal_entry`, `serialize_journal` and `parse_journal` (JSON Lines through `parse_bounded`, errors name the line). `create_journal_middleware` records each call after validation with its clock and random tape (`record_failures`, `filter`, which skips `auth-*` by default, `redact`, `max_tape_reads`, `on_error`). `replay_journal` re-executes entries through a `CommandRegistry` or any `CommandExecutor`, restoring the trace ID, actor, surface and tape, and reports `same`, `different` (path, kind, both values) or `error` with notes on tape over- and under-runs. `FileJournalSink` is in the optional `afd/journal_file.hpp` (`AFD_JOURNAL_FILE`, ON by default). `CommandContext` gains `journal`, internal state the middleware and replay share; leave it unset. `spec/wire/journal.jsonl` is recorded, round-tripped and replayed in the tests, and a new `afd_fuzz_journal` target fuzzes `parse_journal`.
- Clock, random and actor on `CommandContext`, matching TypeScript (#271, #274, #402). `context.clock` and `context.random` are filled from `CommandRegistryOptions::clock` and `random` when the caller set none, and the registry times handlers with `context.clock`. `context.actor` (`Actor`, `ActorKind`, `actor_kinds`, `is_actor`, `is_actor_kind`, `parse_actor_kind`, `actor_kind_name`) says who is calling; `DirectClient` fills `human` (option `actor`; its `clock` and `random` options, when set, also reach the context), `CommandRegistryOptions::actor` sets a default, and the registry stamps the kind, never the id, as the typed `ResultMetadata::actor_kind` (`metadata.actorKind` on the wire; an unknown kind stays in `extra`). Also `ContextDefaults` and `with_context_defaults`, `fixed_clock(ms)`, `ManualClock::set(ms)`, `RandomSource::seed()` and `SystemRandom`. The todo backend's stdio loop calls as `agent`.
- `error_codes::CONFIRMATION_REQUIRED` and `error_codes::CONFIRMATION_DECLINED`, for servers that enforce `confirm_prompt` (`spec/command-metadata.md`, "Confirmations"). Nothing emits them yet.
- `error_codes::APPROVAL_REQUIRED`, for an approval middleware that holds a call before the handler runs (`spec/command-metadata.md`, "Approvals"). `create_approval_middleware` emits it (#422).
- `afd_benchmarks` (behind `AFD_BUILD_BENCHMARKS`, OFF by default) replaces the dispatch-only benchmark and covers `execute` with and without `default_middleware()`, validation against 3, 20 and 100 property schemas, `DirectClient::call`, `execute_batch` and `execute_pipeline` at N = 1, 10 and 100, `get` and `list` on 1,000 commands, and `parse_bounded` and result serialization at 1 KB and 100 KB. CI runs it on the release preset and under Node (Emscripten) and uploads the numbers; there are no thresholds (#340).
- `afd_benchmarks` also has `json_parse/1KB` and `/100KB`, plain `Json::parse` of the same text, as the reference for `parse_bounded`.

### Changed

- **Breaking:** `SeededRandom` is now mulberry32 seeded with the FNV-1a hash of a string, `SeededRandom("seed")`, and gives the same sequence as TypeScript's `seededRandom("seed")`. The `std::uint64_t` and default constructors are gone (a numeric seed no longer compiles): use `SeededRandom(std::to_string(n))` for a numbered seed, and `SystemRandom` (the former randomly seeded `std::mt19937_64`) for real randomness. Library defaults now use `SystemRandom`.

### Fixed

- `parse_bounded` is linear in input size. It enforced the depth limit with a nlohmann parser callback, and the callback parser rescans the enclosing container after every object, so an array of N objects cost O(N²); 100 KB took about 6 to 9 times as long as plain `nlohmann::json::parse`. It now builds the document from SAX events and stops at the first container over the limit, and costs about the same as `Json::parse` (within 10 percent at 100 KB). Results are unchanged: the outermost container is level 1, and the input is reported too deep or malformed by whichever comes first (#397).

### Documentation

- The `asan` preset is documented as unsupported on macOS, where it hangs at startup; use the Linux CI sanitizer job (#331).

## [0.1.0] - 2026-10-12

### Changed

- Renamed to match TypeScript: `Handler` → `CommandHandler`, `Middleware` → `CommandMiddleware`, `RegistryOptions` → `CommandRegistryOptions`.
- Error suggestions name only tools the host provides (`spec/error-codes.md`, D4). An unknown command's suggestion ends with "Use afd-help to list all commands." when the caller can call `afd-help`, otherwise "Check the command name against the available commands.", instead of naming `afd-discover`. `COMMAND_NOT_IN_CONTEXT` names the contexts the command belongs to instead of the `afd-context-*` tools.

### Fixed

- CMake now rejects cl.exe older than MSVC 19.30 with a clear Visual Studio 2022 requirement while
  allowing clang-cl to use the Microsoft frontend with older Visual Studio headers. Configure tests
  cover the compiler floor and the warning sets selected for MSVC, clang-cl and Clang.
- Clang 21 and newer receive the designated-initializer warning suppression under both the GNU and
  Microsoft frontends, so `AFD_WARNINGS_AS_ERRORS=ON` works with clang-cl. Windows CI now builds and
  tests with both MSVC and a checksum-verified official LLVM 22.1.8 clang-cl installation, and CMake
  rejects the regression job unless it detects that exact Clang version with the MSVC frontend.
- Missing required boolean-true and untyped properties reject with `invalid_type` / `nonoptional`, including reference targets; presence, explicit null and defaults keep their schema behavior. An expired batch deadline takes precedence over cancellation when assigning unstarted results after inflight work drains.

- Schema string and array length bounds compare without narrowing huge JSON numbers into `size_t`; nonfinite bounds fail compilation. Pipeline reference indices must fit both JavaScript's safe-integer range and the host's index range, including wasm32.
- `ThreadTaskRunner` joins started workers during thread-start failure and captures task exceptions for rethrow on the caller after all tasks finish. No-exception builds retain their supported behavior.
- Successful registry dispatch only looks up its command; suggestion candidate lists are built on lookup and exposure failures.
- Shared validation vectors now cover all supported cases and explicit rejection of unsupported optional keywords. Missing required values use their full schema's enum and union errors, integer type errors distinguish numbers from other inputs, nullable type lists report the non-null type, and validation reports every issue without a fixed cap. Field lists and sibling issues follow the contract's duplicate-preserving multiset comparison.
- Caller cancellation stops queued batch commands and pipeline steps with COMMAND_CANCELLED while preserving outcomes of handlers already running.

- `DirectClient::call` with `timeout_ms` no longer drops the caller's cancellation token. The call's deadline token now chains to it, as batch and pipeline execution do and as TypeScript does with `AbortSignal.any`. Cancelling the caller, or a `DirectClient::pipe` step passing the pipeline's deadline, now reaches the handler. Only the call's own deadline produces TIMEOUT.

### Added

- **Error codes:** `error_codes` adds `AMBIGUOUS_ACTION`, `INVALID_GROUPED_CALL`, `SESSION_REQUIRED`, `CONTEXT_NOT_FOUND` and `CONTEXT_DEPTH_EXCEEDED`, completing the 42-code shared catalog of `spec/error-codes.md`. `vectors_test.cpp` checks it against `spec/vectors/error-codes.json`.
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
