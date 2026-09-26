# C++ Support: Work Plan

This is the implementation plan for [proposal.md](./proposal.md) ([lushly-dev/afd#270](https://github.com/lushly-dev/afd/issues/270)).

- Every phase ends with CI green and ships as its own pull request or small series of pull requests.
- Sizes are rough engineering estimates for one person: S ≈ 1–2 days, M ≈ 3–4 days, L ≈ 5–7 days.

| Phase | Outcome | Size | Depends on |
|---|---|---|---|
| [0. Triage and repo prep](#phase-0-triage-and-repo-prep) | Decisions recorded, repo tooling ready for C++, library behavior spike done | S | Accepting #270 |
| [1. Skeleton, CI, wire types](#phase-1-skeleton-ci-and-wire-types) | `packages/cpp` builds everywhere; every `spec/wire` fixture round-trips | M | 0 |
| [2. Commands, validation, registry](#phase-2-commands-validation-and-registry) | `execute()` matches the TypeScript engine; in-process client | L | 1 |
| [3. Batch, pipeline, streaming](#phase-3-batch-pipeline-and-streaming) | One executor; `spec/pipeline-variables.md` fully implemented | L | 2 |
| [4. Todo backend and conformance](#phase-4-todo-backend-and-conformance) | C++ backend passes 34/34 in `conformance.yml` | M | 3 |
| [5. Parity, skill, docs](#phase-5-parity-skill-and-docs) | `alfred parity` tracks C++; `afd-cpp` skill; docs list four languages | M | 4 (the alfred work can start after 1) |
| [6. Packaging and release](#phase-6-packaging-and-release) | Installable CMake package; `afd-cpp-v0.1.0` | M | 5 |

Phases 1–4 form the critical path, about 3–4 weeks in total. Phase 5's alfred work and Phase 6's packaging can overlap with Phases 3–4.

---

## Phase 0: Triage and repo prep

**Goal:** agree the direction, remove tooling hazards before any C++ lands, and turn the riskiest library assumptions into facts.

### 0.1 Accept the proposal

- [x] Triage #270 and settle the decisions marked *(confirm)* in the proposal, plus the [open questions](#open-questions) below. Record the answers in `proposal.md`.
- [x] Add a "C++ Support" row to the proposed-features table in `docs/features/README.md`.
- [x] Confirm that the port does not wait on the companion issues (#271–#276). The C++ port targets the contract as it is today. Each companion feature lands in all languages if and when it is accepted on its own merits (proposal, "Companion issues").
- [x] Review every scope item below against the proposal's [scope principle](./proposal.md#scope-principle-host-agnostic). Anything that fails goes back to the requester's application.

### 0.2 Repo prep PR (no C++ code)

Research found these hazards. Each would fail an existing gate as soon as a C++ build tree exists.

- [x] **`.gitignore`:** add `packages/cpp/build/` and `packages/examples/todo/backends/cpp/build/`.
  - `conformance.yml` fails when the working tree is dirty (lines 84-91 and 148-155).
- [x] **`scripts/check-portability.mjs`:** skip the CMake build trees `packages/cpp/build/` and `packages/examples/todo/backends/cpp/build/`. As built, only the build trees are skipped, not the whole package as with `/packages/rust/`, so the rest of `packages/cpp` stays checked.
  - The script ignores `.gitignore`.
  - CMake writes absolute `/Users/<name>/` paths into `CMakeConfigureLog.yaml`, `compile_commands.json` and `_deps/**`. Those are portability *errors* in pre-push and in `pnpm check`.
- [x] **`.editorconfig`:** add a `[*.{cpp,hpp,h,cmake}]` block and a `[CMakeLists.txt]` block. Recommendation: 4 spaces, 100 columns. Without them, C++ files inherit the repo's tab indentation.
- [x] **`packages/cpp/.clang-format`:** matching the `.editorconfig` settings, as the single source of formatting.
- [x] **Biome and CMake JSON:** decide whether Biome should reformat `packages/cpp/**/*.json` (for example `CMakePresets.json`) with tabs, as lefthook does to every `*.json`. It does no harm; either accept it or add an ignore in `biome.json`. *Decided: accept it; no `biome.json` change.*

### 0.3 Spike (1 day, disposable)

Build a hello-registry in a scratch branch and verify:

- [x] Parsing with nlohmann `allow_exceptions=false` under `-fno-exceptions -fno-rtti` with `JSON_NOEXCEPTION`:
  - it compiles, and malformed input returns `discarded` instead of aborting;
  - the parser does not recurse;
  - destroying 100k-deep input does not overflow the stack;
  - `dump()` depth behavior is understood.
- [x] Cross-type numeric equality (`0 == 0.0`) and the number formatting behind D9.
- [x] An Emscripten build of the spike that runs under Node, plus the steady clock's behavior there.
- [x] The spike compiles with a force-included macro-hygiene prelude. It defines the portable collisions from the proposal's constraints: function-like `min`/`max` (as `<windows.h>` does) and lowercase `check`/`verify`/`require` (as Apple's `AssertMacros.h` does).

**Exit:** decisions recorded; the prep PR merged; spike findings folded into proposal D2–D4.

**Status: complete (2026-09-26).**
- The proposal and plan landed in #277 and the repo prep in #280.
- The maintainer accepted every recommendation.
- The spike results are in the proposal's [Phase 0 spike evidence](./proposal.md#phase-0-spike-evidence).

---

## Phase 1: Skeleton, CI and wire types

**Goal:** a buildable, tested package in every target configuration. It contains only the data types, and they match `spec/wire` exactly.

### PR 1a: CMake skeleton and CI

```
packages/cpp/
├── CMakeLists.txt          # project(afd VERSION 0.1.0 LANGUAGES CXX)
├── CMakePresets.json       # dev, asan, noexcept-nortti, release, emscripten, msvc
├── cmake/
│   ├── AfdDependencies.cmake   # nlohmann_json and doctest (tests only), pinned URL and SHA-256
│   ├── AfdWarnings.cmake       # -Wall -Wextra -Wpedantic -Werror / MSVC /W4 /WX /permissive-
│   └── afdConfig.cmake.in      # used in Phase 6
├── include/afd/afd.hpp     # umbrella header
├── src/
├── tests/                  # doctest; CTest registration
├── README.md
└── CHANGELOG.md
```

- **Options:**
  - `AFD_BUILD_TESTS` and `AFD_WARNINGS_AS_ERRORS` (ON in CI);
  - `AFD_BUILD_EXAMPLES`, `AFD_BUILD_FUZZERS`, `AFD_USE_SYSTEM_JSON`;
  - `AFD_ENABLE_THREADS` (OFF for Emscripten).
- **Test framework: doctest.** It is header-only, and `DOCTEST_CONFIG_NO_EXCEPTIONS_BUT_WITH_ALL_ASSERTS` works in the no-exceptions build.
- **`.github/workflows/cpp.yml`:**
  - Path filters: `packages/cpp/**`, `spec/wire/**`, `spec/pipeline-variables.md` and the workflow file itself.
  - Pin every action to a full SHA with a `# vX.Y.Z` comment; `scripts/repository-contract.test.mjs:70-84` enforces this.
  - Install Emscripten by cloning emsdk at a pinned tag, which avoids a third-party action, and cache it.

| Job | Configuration |
|---|---|
| format | `clang-format --dry-run -Werror` over `include/`, `src/`, `tests/` |
| linux-gcc | GCC 12+, Release plus tests |
| linux-clang-sanitize | Clang, ASan + UBSan |
| linux-clang-tsan | Clang, TSan with `AFD_ENABLE_THREADS=ON` (from Phase 3) |
| macos | Apple Clang |
| windows-msvc | MSVC 2022, `/W4 /WX /permissive-` |
| noexcept-nortti | Clang: `-fno-exceptions -fno-rtti -DJSON_NOEXCEPTION`, plus a unity build and the macro-hygiene prelude |
| emscripten | `emcmake` build; `ctest` runs through Node |
| fuzz-smoke | Clang libFuzzer, 60 s per target (from Phase 3) |

### PR 1b: wire types

Each item below is a header in `include/afd/` with an implementation in `src/`.

- **`json.hpp`:**
  - `using Json = nlohmann::json;`.
  - `wire::number(double)`, which follows D9. It normalizes integral values, including `-0.0`, to integers, and has tests against the values in the spike table.
  - `wire::iso8601_utc(ms)`, which writes `2026-01-01T00:00:00.000Z` with a hand-written civil-date conversion, no `<format>`.
  - `parse_bounded(text, max_depth = 256, max_bytes)`:
    - It tracks depth in the parser callback and **fails on its own "too deep" flag**. nlohmann silently drops a rejected subtree and still reports success (spike).
    - Its tests must cover input at the limit and one level beyond it.
  - No separate `json_equal`: `afd::Json` is the sorted-key `nlohmann::json`, whose `==` is already structural, ignores key order and compares numbers across integer and floating-point types (Phase 0 spike).
- **`expected.hpp`:** a minimal `afd::Expected<T, E>` for the C++20 build (a stand-in for C++23's `std::expected`).
- **`errors.hpp`:**
  - `CommandError {code, message, suggestion?, retryable?, details?, cause?}`, with `cause` held as `std::shared_ptr<const CommandError>`.
  - The `error_codes::` constants: the full TypeScript `ErrorCodes` list plus `COMMAND_NOT_IN_CONTEXT`, `COMMAND_NOT_EXPOSED`, `COMMAND_NOT_ALLOWED`, `UNKNOWN_TOOL`, `INVALID_BATCH_REQUEST`, `INVALID_PIPELINE_REQUEST`, `BATCH_TIMEOUT`, `COMMAND_SKIPPED`, `PIPELINE_TIMEOUT`, `UNSUPPORTED_OPTION`, `STREAM_*`, `COMMAND_FAILED`.
  - Constructors with the exact TypeScript text: `create_error`, `validation_error`, `not_found_error` (`"<Type> with ID '<id>' not found"`), `rate_limit_error`, `timeout_error`, `internal_error`, `wrap_error`, `execution_failure(dev_mode)`.
- **`metadata.hpp`:**
  - `Source`, with the wire key `type`.
  - `PlanStep` and `PlanStepStatus`, whose wire values are `pending | in_progress | complete | failed | skipped`.
  - `Alternative` and `Warning`, with `WarningSeverity` taking `info | warning | caution`.
- **`result.hpp`:**
  - `ResultMetadata`, whose `extra` keeps unknown keys.
  - `CommandResult`, with `data` as a `std::optional<Json>` so that `null` and absent stay distinct.
  - `ResultOptions`; `success`, `failure` and `error` helpers.
  - `is_success`/`is_failure` test only `success`, as in TypeScript. (Rust also requires `data` to be present.)
- **`batch.hpp`, `pipeline.hpp`, `streaming.hpp`:** types only for now, including `StreamChunk` as a `std::variant` tagged by `type` in JSON.
- **Serialization:** hand-written `to_json`, and `from_json` that returns `Expected<T, std::string>`. No `NLOHMANN_DEFINE_*` macros. Optional fields are omitted when unset, never written as `null`.

### Tests

- **`tests/wire_fixtures.cpp`:**
  - Enumerate `spec/wire/*.json` through a compile definition `AFD_WIRE_DIR`.
  - Dispatch on the file name, **spelled as quoted string literals**, because alfred's `check_wire_fixtures` greps for them.
  - Fail on any unmapped fixture.
  - Compare structurally, ignoring key order.
  - Add typed assertions matching the six in `packages/rust/tests/wire_fixtures.rs`.
- Unit tests for `wire::number`, `iso8601_utc`, `parse_bounded` limits, and absent-versus-null handling.

**Exit:** all six fixtures round-trip in every `cpp.yml` configuration, including Emscripten and noexcept-nortti.

---

## Phase 2: Commands, validation and registry

**Goal:** `CommandRegistry::execute` behaves the same as `packages/server/src/execution.ts:90-191`, and an in-process client matches `packages/client/src/direct.ts`.

### PR 2a: runtime primitives (`runtime.hpp`)

- **`Clock`:** `steady_ms()` and `wall_ms()`. `SystemClock` is the default; `ManualClock` is for tests.
- **`CancellationSource` and `CancellationToken`:** an atomic flag, an optional deadline, and `is_cancelled()`, which also returns true once the deadline passes. No timer thread is needed.
- **`TaskRunner`:**
  - The interface is `submit(std::function<void()>)`.
  - `InlineTaskRunner` is the default. `ThreadPoolTaskRunner` is available only when `AFD_ENABLE_THREADS` is set.
  - A completion primitive supports `wait_until(deadline)`.
- **`RandomSource`:** a seedable `next()` in [0, 1), used for trace-ID suffixes and retry jitter. Like `Clock`, it lives in `RegistryOptions` as the library's own test seam. It is not exposed on `CommandContext`; that is #274's decision.

### PR 2b: command definitions (`command.hpp`)

- **`CommandDefinition` fields:**
  - identity: `name`, `description`, `category`, `tags`, `version`;
  - schemas: `input_schema` (`Json`), `output_schema`, `returns`, `errors`;
  - behavior flags: `mutation`, `destructive`, `confirm_prompt`, `undoable`, `requires`, `contexts`;
  - exposure: `expose`;
  - handoff: `handoff`, `handoff_protocol`;
  - `examples`, `execution_time`, `handler`.
- **`ExposeOptions`** defaults to palette and agent `true`, MCP and CLI `false`. Also `is_exposed_to()` and `default_expose()`.
- **`validate_command_name`:** implements `^[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+$` by hand, with the two TypeScript reason strings.
- **`CommandParameter` builders:** compile into `input_schema`. Core TypeScript's `parameters` is one way to describe inputs; a JSON Schema is the other.
- **Handoff auto-tags:** `handoff` and `handoff:<protocol>`.
- **`CommandContext`:**
  - `trace_id`, `timeout_ms`, `interface`, `active_context` and `cancellation`;
  - `extra` (a `Json` object) standing in for TypeScript's `[key]: unknown`. It is the only extension point.
  - There are no placeholder fields for features AFD has not accepted, such as #271, #272 or #274.
- **Types:**
  - `using Handler = std::function<CommandResult(const Json&, CommandContext&)>;`
  - `using Next = std::function<CommandResult()>;`
  - `using Middleware = std::function<CommandResult(std::string_view name, const Json& input, CommandContext& ctx, const Next& next)>;`

### PR 2c: schema validator (`schema.hpp`)

- **Compile at registration:** `CompiledSchema::compile(const Json&) -> Expected<CompiledSchema, std::string>`.
  - It resolves local `$ref` targets and detects cycles.
  - It rejects any unsupported keyword listed in proposal D6.
- **Validate:** `validate(const Json& input) -> Expected<Json /*parsed*/, ValidationFailure>`.
  - Defaults are applied and undeclared keys stripped (Zod's default behavior). `additionalProperties: false` turns undeclared keys into errors.
  - Issue codes follow Zod 4 names: `invalid_type`, `too_small`, `too_big`, `invalid_value`, `unrecognized_keys`. `expected` is set only for `invalid_type`.
- **`VALIDATION_ERROR` shape**, copied from `packages/server/src/validation.ts:69-113`:
  - message `Input validation failed`;
  - `details {errors, expectedFields, unexpectedFields, missingFields}`, with undefined keys omitted;
  - a suggestion made of one error `path: msg` or several `- path: msg` lines, followed by `Unknown field(s): …`, `Missing required field(s): …` and `Expected fields: …`, all joined with `'. '`.
- **String lengths:** count Unicode code points (JSON Schema semantics, as Rust and Pydantic do). See [finding 3](#research-findings-to-file-separately); Zod counts UTF-16 code units.
- **Issue messages:** they need not match Zod's text byte for byte. Conformance checks codes, paths and field lists.

### PR 2d: registry and `execute` (`registry.hpp`, `similarity.hpp`)

- **Registry basics:**
  - `register_command` rejects invalid names, duplicates and reserved names (the meta-tool names, per `packages/server/src/command-names.ts`), and compiles the schema and examples.
  - Also `get`, `has`, `list` (registration order), `list_by_category`, `list_by_exposure`, `list_handoff_commands` and `use(Middleware)`.
  - `RegistryOptions {on_command, on_error, dev_mode, clock, task_runner, random}`.
  - A `std::shared_mutex` allows concurrent execution while registration takes an exclusive lock.
- **`execute(name, input, ctx)`**, in exactly this order:
  1. **Lookup.** On a miss, return `COMMAND_NOT_FOUND` with the message `Command '<truncated>' not found`.
     - The suggestion comes from `notFoundSuggestion` (`command-routing.ts:65-86`). The unknown name is never echoed.
     - `similarity.hpp` does the matching:
       - It works in UTF-16 code units and gives up on names longer than 128.
       - It skips a candidate early when `1 - |Δlen|/maxLen < 0.4`.
       - It uses a two-row Levenshtein with a 0.4 threshold, applies `std::stable_sort`, and returns at most 3 matches.
  2. **Exposure** (when `ctx.interface` is set): otherwise `COMMAND_NOT_EXPOSED`.
  3. **Context:** `COMMAND_NOT_IN_CONTEXT`, with the exact message and suggestion from `command-routing.ts:89-95`.
  4. **Validation**, as in PR 2c.
  5. **Middleware.** The first middleware registered is the outermost.
     - Middleware receives the *parsed* input and the same mutable context the handler gets.
     - It may short-circuit, or call `next()` more than once.
  6. **Handler.**
  7. **Metadata stamping,** in a new object (the handler's result is never modified in place):
     - `executionTimeMs` is an integer and times only the handler.
     - `commandVersion` and `traceId` are read *after* middleware runs.
     - Engine values override the handler's.
     - Handler failures are stamped too. Lookup, context and validation failures and short-circuits are not.
  8. **`on_command(name, raw_input, result)`,** outside the guarded region.
     - It is skipped for failures before the handler.
     - A hook failure is reported to `on_error`, which is itself swallowed.
- **Exceptions** (only when `__cpp_exceptions` is defined): anything thrown maps to `execution_failure(dev_mode)`.
  - Default: `COMMAND_EXECUTION_ERROR`, `An internal error occurred`, `Contact support if this persists`.
  - In dev mode: the exception's message, and the suggestion `Check the command implementation`.

### PR 2e: default middleware and the in-process client

- **`middleware.hpp`:**
  - `auto_trace_id` fills `traceId` when it is empty, using the injected random source.
  - `logging` writes through an injectable sink, with the TypeScript line formats.
  - `timing` flags slow commands, with a default threshold of 1000 ms.
  - `default_middleware()` returns these three in that order, and each can be switched off.
- **`direct_client.hpp`**, following `packages/client/src/direct.ts:144-240`:
  1. The `allow` predicate: `COMMAND_NOT_ALLOWED`.
  2. The unknown-command path: `UNKNOWN_TOOL`, in the shape `unknown-tool.ts:58-74` produces.
  3. Context defaults: `trace-<ms>-<rand7>`, and interface `agent`.
  4. Timeouts through deadline and cancellation, producing `TIMEOUT` with `Command '<name>' timed out after <ms>ms`.
  5. Client-side middleware.
  - `pipe()` arrives in Phase 3.

### Tests

- Port the behavioral cases (not the code) from the TypeScript engine, middleware and DirectClient test suites in `packages/server/src/*.test.ts` and `packages/client/src/*.test.ts`:
  - dispatch order and short-circuit;
  - retry through repeated `next()` calls;
  - metadata override and absence;
  - hook isolation;
  - suggestions, truncation (including surrogate pairs) and the 128 cap;
  - context and exposure errors;
  - validation formatting.
- Test the validator's keyword matrix and `$ref`, and check that registration fails on unsupported keywords.

**Exit:** a registry test suite that mirrors the TypeScript engine's, green in every configuration.

---

## Phase 3: Batch, pipeline and streaming

**Goal:** one executor, which `registry.execute_batch`, `registry.execute_pipeline`, `DirectClient::pipe` and test harnesses all delegate to (quality review Theme 2). It must match `command-execution.ts` and `pipeline-executor.ts`.

- **Executor type:** `using CommandExecutor = std::function<CommandResult(std::string_view, const Json&, CommandContext&)>;`.
- **Envelope checks run on raw JSON:** `parse_batch_request(const Json&)` and `parse_pipeline_request(const Json&)` return `Expected<Request, CommandError>`. A typed struct cannot represent an invalid envelope, so the check cannot wait until after parsing.

### PR 3a: batch (`batch.hpp`)

- **Preflight:**
  - Each command must have a non-blank `command` and an optional string `id`.
  - `stopOnError` must be a boolean, `timeout` finite and ≥ 0, and `parallelism` an integer > 0. The batch must not be empty.
  - Failure returns `INVALID_BATCH_REQUEST` with the exact suggestion text, as a failed `BatchResult`:
    - `success:false`, `results:[]`, zeroed summary and timing, `confidence 0`;
    - `reasoning:"Batch execution failed: <message>"` and no metadata.
- **Scheduling:**
  - `min(parallelism, n)` workers run through the `TaskRunner`.
  - `stopOnError` stops scheduling, but commands already running finish.
- **Deadline:** one deadline for the whole batch.
  - A command that has not started when the deadline passes gets `BATCH_TIMEOUT` (`Batch timeout exceeded (<n>ms)`, retryable) without running.
  - A command still running at the deadline has its token cancelled and gets `BATCH_TIMEOUT`.
    - With the thread runner, the batch waits until the deadline and then returns.
    - With the inline runner, the overrun is detected when the command completes (D4).
  - `timeout: 0` gives the first command `BATCH_TIMEOUT` immediately.
- **Unstarted entries:** `{id: id ?? "cmd-<i>", index, command, result:{success:false, error: BATCH_TIMEOUT | COMMAND_SKIPPED}, durationMs: 0}`. `COMMAND_SKIPPED` carries TypeScript's exact message and suggestion.
- **Per-entry values:**
  - The trace ID is `<batchTraceId>-<i>`, where `batchTraceId` is `ctx.trace_id` or `batch-<ms>`.
  - `durationMs` is rounded to 2 decimals.
- **`create_batch_result`:**
  - `success` is always `true`.
  - Only `COMMAND_SKIPPED` counts as skipped.
  - `confidence = successRatio·0.5 + avg(successful confidence ?? 1)·0.5`.
  - The reasoning text matches TypeScript, including the singular form and dropping zero counts.
  - Warnings are mapped to `{commandId, code, message}`, and timing is rounded to 2 decimals.

### PR 3b: pipeline variables (`pipeline_variables.hpp`)

- **Parser:** hand-written; no `std::regex`.
  - A string longer than 1024 UTF-16 code units is a literal, **after** unescaping `$$`.
  - It recognizes the forms `$prev`, `$first`, `$steps[N]`, `$steps.<alias>` and `$input`.
  - Keys may use any character except `.`, `[`, `]` and whitespace, and each segment has at most one `[N]`.
  - Any other form is a literal.
- **Traversal:**
  - It follows only own keys of JSON objects and in-bounds indices.
  - An all-digit segment is a key lookup on an object and an index on an array.
  - A segment starting with `__` never resolves; this applies to aliases too.
  - `$prev` is the last *successful* step. `$steps[N]` is the step at its original position. An alias resolves to the first step with that `as`.
- **Absent values:** a property whose value is absent is omitted; an absent array element becomes `null`; resolved values are deep copies.
- **`when` validation:**
  - Each condition is a single-key object with correctly typed operands; `$gt`/`$gte`/`$lt`/`$lte` require finite numbers.
  - Nesting is capped at 128.
- **`when` evaluation:**
  - `$exists` is false for both absent and `null`.
  - Every comparison involving an absent operand is false, `$ne` included.
  - `$eq`/`$ne` use `afd::Json`'s `==`, which is structural and ignores key order.
  - `$and: []` is true and `$or: []` is false.
- **Depth:** request and step inputs deeper than 64 levels are rejected, and the check is iterative.

### PR 3c: pipeline executor (`pipeline.hpp`)

- **Preflight order:**
  1. Envelope: `INVALID_PIPELINE_REQUEST`.
  2. Empty `steps`.
  3. Depth: `VALIDATION_ERROR` `"<what> is nested deeper than 64 levels"`, with details.
  4. `parallel`, then the first `stream: true` step: `UNSUPPORTED_OPTION`. Every other step is `skipped`.
- **Rejected envelopes:** return one synthetic step `{index:-1, command:"", status:"failure", executionTimeMs:0, error}`.
- **Step loop:**
  - A `when` that is false marks the step skipped.
  - A step without `input` gets `{}`.
  - A failure in the condition or in resolution gives `INTERNAL_ERROR` with the TypeScript text.
  - The deadline is enforced before each step and while it runs (`PIPELINE_TIMEOUT`, retryable).
  - The step trace ID is `ctx.trace_id` or `<pipelineId>-step-<i>`.
  - A failure stops the pipeline unless `continueOnFailure` is set. A timeout always stops it.
- **`PipelineResult`:**
  - `data` is the last successful step's data.
  - `confidence` is the minimum over successful steps, or 0 if none succeeded.
  - `confidenceBreakdown` and `reasoning` are included; `warnings`, `sources` and `alternatives` carry `stepIndex`, and warnings also carry `stepAlias`.
  - Also `executionTimeMs` (2 decimals), `completedSteps` and `totalSteps`.
- **`DirectClient::pipe`:**
  - It runs through `call()`.
  - Step trace IDs are counted over **calls actually made**, not over step indexes.
- **Executor exceptions:** these follow the engine's `dev_mode` redaction policy. TypeScript returns the raw message here; see [finding 8](#research-findings-to-file-separately).

### PR 3d: streaming (`streaming.hpp`)

- **Chunk factories:** `progress` is clamped to 0–1.
- **Type guards.**
- **`execute_stream`,** which runs the command to completion and then emits chunks:
  - `STREAM_ABORTED` if cancelled before starting.
  - `STREAM_ERROR` if the executor throws.
  - `STREAM_TIMEOUT` after the command, which takes precedence over its result.
  - A failure result produces an error chunk: `COMMAND_FAILED` if it carries no error, with `recoverable = retryable ?? false`.
  - A success produces one data chunk per array item (none for an empty array), or a single data chunk for any other value, then `complete`.
- **`consume_stream`:** returns `STREAM_ENDED_UNEXPECTEDLY` when the stream ends without a `complete` or `error` chunk.
- **`collect_stream_data`.**

### Shared behavior vectors (recommended)

Put the pipeline-variable rules and the batch-control cases in language-neutral files that C++ runs first:

- `spec/vectors/pipeline-variables.json`: `{request, stepData, expectResolved}` cases;
- `spec/vectors/batch-controls.json`.

A follow-up issue wires the same files into TypeScript, Python and Rust. This follows the quality review's recommendation to replace name parity with fixture comparison, and it cuts the four-language cost of every future `parity` issue.

### Tests and fuzzing

- The conformance minimum from `spec/pipeline-variables.md`:
  - every reference form;
  - `$9.99` and `$$prev`;
  - `__proto__`, `__class__` and `constructor` in paths;
  - an out-of-bounds index;
  - `$input` with and without request input;
  - an unresolved alias;
  - 65-level nesting;
  - `when` over an unresolved path.
- Port `packages/server/src/execution-controls.test.ts:71-146`:
  - bounded overlap, using the thread runner under TSan;
  - `stopOnError` counts `{total:3, success:0, failure:1, skipped:2}`;
  - the deadline.

  Use a `ManualClock` so no test sleeps.
- `fuzz/` libFuzzer targets for the variable resolver, the `when` evaluator, the schema validator, similarity and `parse_bounded`. Commit a seed corpus.

**Exit:** the executors match TypeScript on the ported cases; fuzzers run clean for 60 s per target in CI.

---

## Phase 4: Todo backend and conformance

**Goal:** a fourth todo backend that passes the same 34 cases as TypeScript, Python and Rust.

### PR 4a: `packages/examples/todo/backends/cpp/`

```
backends/cpp/
├── CMakeLists.txt        # add_subdirectory(../../../../cpp afd); embeds ../../spec/commands.schema.json
├── CMakePresets.json
├── README.md
├── src/
│   ├── main.cpp          # default: stdio MCP server; also `list-commands` and `<command> [json]` (exit 1 = failure, 2 = usage)
│   ├── mcp_stdio.{hpp,cpp}
│   ├── store.{hpp,cpp}   # in-memory store with an insertion sequence for stable sorting; ids `todo-<uuid v4>`
│   ├── schema.{hpp,cpp}  # input schemas taken from the embedded commands.schema.json
│   └── commands/*.cpp    # the 11 commands
└── tests/
```

- **The stdio MCP loop** (`mcp_stdio`), newline-delimited JSON-RPC 2.0:
  - **`initialize`:** echo the requested `protocolVersion` if it is one of `2025-06-18`, `2025-03-26` or `2024-11-05`, otherwise answer with the newest supported. Reply with `capabilities.tools.listChanged:false` and `serverInfo`.
  - **Other methods:** `notifications/initialized` gets no reply, `ping` returns `{}`, and `tools/list` returns the tools exposed to MCP.
  - **`tools/call`:** returns `content[{type:"text", text: <compact JSON CommandResult>}]` with `isError = !success`.
    - An unknown tool, or invalid arguments, produce a `CommandResult` (`COMMAND_NOT_FOUND` / `VALIDATION_ERROR`) with `isError:true`, **never** a JSON-RPC error.
  - **JSON-RPC errors:** `-32700` for a parse error, `-32600` for a batch array, `-32601` for an unknown method.
  - **Limits and I/O:** lines are capped at 1 MiB, matching Rust's `MAX_BODY_BYTES`. Logs go only to stderr. The server exits on EOF.
- **Commands** reproduce the exact texts the other backends use:
  - `NOT_FOUND`: `Todo with ID "<id>" not found`, suggestion `Use todo-list to see available todos`, `retryable:false`.
  - `NO_CHANGES`: `No fields to update`.
  - The warnings `PERMANENT`, `PARTIAL_SUCCESS` and `DESTRUCTIVE_BATCH`, with their severities.
  - Timestamps are ISO 8601 with milliseconds and a `Z`, and `completedAt` is removed when a todo is un-completed.
- **Schemas:** this is the first backend that validates against `spec/commands.schema.json` itself, with its `#/definitions` references resolved. The other backends keep hand-written copies.
- **Tests:**
  - Unit tests for each command.
  - A command-list test that reads `commands.schema.json`, as the TypeScript and Python backends do, rather than hard-coding the list as Rust does.

### PR 4b: wire it into conformance

- **`packages/examples/todo/dx/run-conformance.ts`:**
  - Add `'cpp'` to `BACKENDS`.
  - Add a branch that starts the built binary with `StdioClientTransport({command: <binary>, env: {TODO_STORE_TYPE: 'memory'}})`.
- **`packages/examples/todo/package.json`:** `"test:conformance:cpp"` configures and builds `backends/cpp`, then runs `tsx dx/run-conformance.ts --backend cpp`.
- **`.github/workflows/conformance.yml`:**
  - Add `packages/cpp/**` to both path filters.
  - Add a `todo-cpp` job modeled on `todo-rust` (lines 93-156):
    1. configure and build;
    2. `ctest`;
    3. `pnpm install --frozen-lockfile`;
    4. `test:conformance:cpp`;
    5. the clean working-tree check.
- **Docs:**
  - `packages/examples/todo/README.md`.
  - `packages/examples/todo/spec/README.md`, which also fixes its stale "ts and py" wording.
  - `AGENTS.md:70`, which becomes "TypeScript, Python, Rust and C++ backends".

**Exit:** 34/34 cases pass in `conformance.yml`, and the tree stays clean after the run.

---

## Phase 5: Parity, skill and docs

**Goal:** tooling tracks C++ drift, and agents know how to write C++ AFD code.

### PR 5a: `alfred parity` learns C++ (can start after Phase 1)

- **In `alfred/src/alfred/commands/parity.py`:**
  - Add `parse_cpp_exports()`:
    - It starts from `packages/cpp/include/afd/afd.hpp` and follows `#include "afd/…"`.
    - It collects namespace-scope `struct`, `class`, `enum`, `using` aliases, free functions and `inline constexpr` constants in `namespace afd`.
    - It skips `afd::detail`, and it ignores test-only code.
  - Add a C++ mode to `_strip_comments` and `_skip_string` that handles raw strings `R"x(…)x"` and character literals.
  - Add `cpp`, `missing_from_cpp` and `extra_in_cpp` to `ParityReport`, and give `_diff_exports` a fourth input.
  - Add `WIRE_ROUND_TRIP_TESTS["cpp"] = packages/cpp/tests/wire_fixtures.cpp`, and update the entry-file, count and reasoning code paths (lines 639-703).
- **`alfred/tests/test_parity.py`:**
  - Give the `fake_repo` fixture a C++ entry header.
  - Update the three-language wire-coverage test.
  - Add `NAME_GAP_BUDGET["missing_from_cpp"]`, set to the measured value.
  - Add parser unit tests modeled on `test_parse_rust_exports`.
- **Strings and docs:** the alfred docs and help text list three languages in `alfred/AGENTS.md` (the entry-point table and "fixtures × 3"), `plugin.py:26` and `mcp_server.py:25`.
- **Declared deferred surface:**
  - The deferred exports are the MCP types and helpers, connectors, telemetry, the bootstrap commands, and retry and rate-limit middleware.
  - List them in this plan and in the skill, so the budget is honest and can be ratcheted down.

### PR 5b: `afd-cpp` skill and repository docs

- **`.claude/skills/afd-cpp/SKILL.md`,** following the section order of `afd-rust`:
  - Parity Rule, Includes, Result Types, Errors, Command Definition, Registry, Middleware, Batch, Pipelines, Streaming, Metadata, JSON, Testing, CMake and build modes.
  - Embedding constraints: no exceptions or RTTI, and macro hygiene.
  - A short "building host adapters on the public API" section. It covers `TaskRunner`, `Clock`, middleware and `extra`, so hosts know where their integration code goes. The adapters themselves are not in AFD.
  - Related Skills.
- **Register the skill** in:
  - `botcore.toml` `[skills]`;
  - the skill tables in `AGENTS.md` and `.claude/CLAUDE.md`;
  - the Related Skills footers of `afd-typescript`, `afd-python`, `afd-rust` and `afd-developer`.
- **Repository docs:**
  - `README.md`: the badges and the language lists at lines 6-8, 177, 189 and 289.
  - `CONTRIBUTING.md`: the `cpp` commit scope and the local commands.
  - The CI tables in `AGENTS.md` and `.claude/CLAUDE.md`: a `cpp.yml` row, plus a key rule, "Changed `packages/cpp/`? Run `cmake --preset dev && cmake --build --preset dev && ctest --preset dev`".
  - `spec/wire/README.md`: the list of round-trip tests, and "all four languages in the same PR".
  - `docs/features/README.md`.
  - `.claude/skills/do-release`: a C++ section.
- **`botcore.toml` `[packages.cpp]`:** check first whether botcore's package detection recognizes a CMake package. It looks for `pyproject.toml` or `package.json`, per `.claude/skills/configure-botcore/references/per-package.md:71`.

**Exit:** `alfred.yml` is green with a C++ budget, and the skill passes the skill linter.

---

## Phase 6: Packaging and release

**Goal:** consumers can take a tagged release without copying source.

- [ ] Add `install()` rules, `afdConfig.cmake` with a version file, and the exported `afd::afd` target. Generate `include/afd/version.hpp` (`AFD_VERSION_MAJOR/MINOR/PATCH`).
- [ ] Consumer tests in CI:
  - install, then build a tiny project with `find_package(afd 0.1 CONFIG REQUIRED)`;
  - build the same project through `FetchContent`;
  - build a `packages/cpp/examples/quickstart.cpp` that matches the README, playing the role of Rust's README doctests.
- [ ] Release process:
  - Tag `afd-cpp-v0.1.0` and write GitHub release notes from `packages/cpp/CHANGELOG.md`.
  - Document the steps in the `do-release` skill. Changesets does not cover this package.
- [ ] Dependency updates: Dependabot has no CMake ecosystem. Keep every pin in `cmake/AfdDependencies.cmake`, with a documented update procedure. See the [open questions](#open-questions) for Renovate.
- [ ] Embeddability gate, generic and not tied to any host:
  - the noexcept-nortti job;
  - a CMake unity build;
  - the macro-hygiene prelude;
  - MSVC with `/W4 /WX`.

  This proves that hosts which disable exceptions or RTTI, or use unity builds, can consume the library. No specific host is named or installed in CI.

---

## Follow-on work (separate issues, not #270)

Each candidate below must pass the [scope principle](./proposal.md#scope-principle-host-agnostic) again when it is proposed.

1. **An optional `afd::mcp_stdio` target**, promoted from the todo backend. It would let any C++ application expose its registry to MCP clients (Claude Desktop, IDEs, a TypeScript host) with no HTTP stack. Of all the follow-ons it has the widest value, because MCP is AFD's primary agent surface.
2. **Asynchronous handlers**, using completion callbacks, for I/O-bound commands. This needs a design for single-threaded WebAssembly, where blocking waits are impossible. Build it when more than one consumer needs it.
3. **The rest of the parity surface:** MCP types, bootstrap commands, `afd-discover`/`afd-detail`, and retry, rate-limit and telemetry middleware.
4. **Schema to typed C++ structs code generation**, and a cross-language TypeSpec decision as its own proposal.
5. **C++ implementations of companion issues as they are accepted,** limited to the parts the proposal keeps in AFD.
6. **Adopting `spec/vectors/*`** in TypeScript, Python and Rust.
7. **Emscripten JavaScript bindings (embind)**, if a web build needs to call commands from JavaScript directly.

**Not planned in AFD:**
- Engine and framework adapters: Unreal (Blueprint exposure, `FString`/`FJsonObject` bridges, task-graph runners, Unreal Build Tool layouts), Unity, Godot, Qt and similar.
- Application features that ride on the companion issues, such as actor-scoped query results or journal-as-source-of-truth state.

These belong in the requesting application, built on the public API.

---

## Test strategy

| Layer | What it proves | Where | CI |
|---|---|---|---|
| Wire fixtures | Types round-trip the canonical JSON | `packages/cpp/tests/wire_fixtures.cpp` | `cpp.yml`, all configurations |
| Ported behavior cases | Dispatch, validation, batch, pipeline and stream semantics match TypeScript | `packages/cpp/tests/*.cpp` | `cpp.yml` |
| Shared vectors | Language-neutral pipeline and batch rules | `spec/vectors/*.json` | `cpp.yml` (other languages later) |
| Conformance | The end-to-end product matches the other backends | `packages/examples/todo/spec/test-cases.json` | `conformance.yml` `todo-cpp` |
| Sanitizers | Memory and undefined-behavior safety; races in the thread runner | ASan + UBSan, TSan jobs | `cpp.yml` |
| Fuzzing | Hostile-input robustness (Theme 5) | `packages/cpp/fuzz/` | `cpp.yml` fuzz-smoke |
| Build modes | Embeddability in hosts without exceptions or RTTI, in unity builds, and in WebAssembly | noexcept-nortti with a unity build and macro hygiene; Emscripten | `cpp.yml` |
| Parity | Export surface and fixture coverage | `alfred parity` budgets | `alfred.yml` |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Semantics drift from TypeScript in a fourth language | High | High | Name the TypeScript reference explicitly; port its test cases; shared vectors; conformance in CI |
| nlohmann misuse aborts when exceptions are off (for example `.at()` on a missing key) | Medium | High | Coding rule plus a CI grep for throwing accessors in `src/`; fuzzing; the noexcept job runs the full test suite |
| A handler cannot be preempted with the inline runner | Certain | Low | Documented in D4; the wire result still matches; cooperative token; thread runner for hosts that need wall-clock deadlines |
| CI time and cost (six configurations plus Emscripten) | Medium | Medium | Path filters; cache emsdk and the FetchContent downloads; move the fuzzers to a nightly run if slow |
| Every `parity` issue now costs four implementations | High | Medium | Shared vectors; agree which surface C++ must match and which is optional |
| Scope creep toward the requesting project's needs | Medium | High | Apply the scope principle at triage and in review; companion issues are judged on their value across all languages; adapters stay out of the repo |
| Host-integration friction (build systems, allocators, string types) | Medium | Low | Keep the core dependency-light with a small public API; hosts own adapters; the skill documents the extension points |
| Emscripten differences (no threads, clock resolution) | Low | Medium | `AFD_ENABLE_THREADS=OFF`; injected clock; tests run under Node in CI |
| C++ dependencies go stale without Dependabot | Medium | Low | Pins in one file; an update procedure; possibly Renovate |

## Open questions

**Resolved 2026-09-26: the maintainer accepted every recommendation below.**

1. **Is the reference the TypeScript server engine,** rather than the core registry? *Recommended: yes* (proposal, "What the same AFD means").
2. **Execution model:** synchronous handlers plus a pluggable runner, or C++20 coroutines from the start? *Recommended: synchronous first* (D4).
3. **JSON library:** nlohmann/json or RapidJSON? *Recommended: nlohmann* (D2).
4. **Are builds without exceptions and RTTI a CI-gated configuration?** *Recommended: yes.* It is the norm for widely embedded C++ libraries, and it excludes no one (D3).
5. **Where does the stdio MCP loop live:** only in the todo backend, or as an optional library target from day one? *Recommended: the backend only, promoted later* (D10).
6. **Decouple TypeSpec from #270?** *Recommended: yes*; nothing exists yet, and the todo backend can use `commands.schema.json` directly (D6).
7. **Should the port wait for, or pre-build, any companion issue (#271–#276)?** *Recommended: no.* Judge each on its value across all languages. Push the parts that fail back to the requester (proposal, "Companion issues").
8. **Release scheme:** an independent `afd-cpp-vX.Y.Z` tag and version starting at 0.1.0? *Recommended: yes* (D11).
9. **Renovate for CMake pins,** or manual updates? *Recommended: manual for v0.1*, and revisit once there are more than two dependencies.
10. **Which unit counts for `minLength`/`maxLength`?** Code points (JSON Schema, Rust, Pydantic) or UTF-16 code units (Zod)? *Recommended: code points, written into a spec.* This is a cross-language decision, not a C++ one.
11. **Should AFD host engine or framework adapters?** *Recommended: no.* Hosts build them on the public API, and a shared layer is revisited only if several unrelated hosts turn out to need the same code.

## Research findings to file separately

These drifts and stale items turned up while planning. They are outside #270's scope.

1. **Rust's validation error differs from TypeScript's.**
   - Rust uses the message `"Input validation failed for '<cmd>': …"` (`packages/rust/src/validation.rs:405`); the TypeScript engine uses `Input validation failed`.
   - Rust passes undeclared keys through to handlers, while the TypeScript engine (Zod) strips them.
2. **Name truncation units differ.** TypeScript truncates at 128 UTF-16 code units without splitting a surrogate pair (`core/src/similarity.ts:103-109`). Rust truncates at 128 Unicode scalars (`packages/rust/src/commands.rs:1147-1152`).
3. **String-length units differ, and no spec covers it.** Zod counts UTF-16 code units; the Rust validator and Pydantic count code points.
4. **`docs/features/active/rust-parity/rust-parity.plan.md` is stale.**
   - It still says Active and cites the March 2026 counts, although the work shipped in #181. Current `missing_from_rust` is 10, within the budget in `alfred/tests/test_parity.py`.
   - It should move to `complete/`.
5. **`packages/examples/todo/spec/README.md` is stale:** it names only the TypeScript and Python backends.
6. **`.claude/skills/afd-rust/SKILL.md` gives the wrong not-found message** (around line 156). The code produces `Todo with ID '123' not found`.
7. **The `alfred parity` command exits 1 today.** It reports 224 name gaps, 117 of them `missing_from_typescript`. The effective gate is the budget in `test_parity.py`. C++-only helpers must stay in `afd::detail`, or they add to `missing_from_typescript`.
8. **The TypeScript pipeline executor returns an executor exception's raw message** (`packages/core/src/pipeline-executor.ts:293-295`). It does not use the engine's `devMode` redaction. Check whether that is intended.
