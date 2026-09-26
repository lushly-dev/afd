# C++ Support (afd-cpp)

> **Goal**: Add C++ as the fourth AFD implementation. It is an engine-free C++20 library that provides:
> - the `CommandResult` contract and command metadata;
> - a validating `CommandRegistry` with middleware;
> - batch, pipeline and in-process execution.
>
> Like the Python and Rust ports, it is tested for conformance against `spec/wire` and the todo conformance suite.

| Field | Value |
|---|---|
| Status | Proposed (awaiting triage of [lushly-dev/afd#270](https://github.com/lushly-dev/afd/issues/270)) |
| Package | `packages/cpp` (working name `afd-cpp`, namespace `afd`, CMake target `afd::afd`) |
| Behavioral reference | TypeScript: `packages/server/src/execution.ts` (single command), `packages/core/src/command-execution.ts` (batch, stream), `packages/core/src/pipeline-executor.ts` (pipeline) |
| Contracts | `spec/wire/*.json`, `spec/pipeline-variables.md`, `packages/examples/todo/spec/{commands.schema.json,test-cases.json}` |
| Precedent | [Rust Support](../rust-support/00-overview.md), [Rust Parity Closure](../../active/rust-parity/rust-parity.plan.md) |
| Work plan | [work-plan.md](./work-plan.md) |
| Updated | 2026-09-26 |

## Why C++

AFD's premise is that the command layer is portable. It already ships in TypeScript, Python and Rust, but none of them fits applications whose host language is C++. Examples include:
- desktop and creative tools;
- native plugins and extensions;
- simulation and robotics cores;
- game engines;
- embedded and device software;
- performance-sensitive services;
- anything compiled to WebAssembly from C++.

Existing options serve these hosts poorly:
- **Rust through FFI** works, but adds a second toolchain and an FFI boundary between the registry and the handlers. It also means integrating with the host's build system.
- **TypeScript** only runs out of process. The command layer becomes a network hop inside the application, which defeats in-process execution.
- **Hand-rolled result types** in each C++ project would bring back the drift that the wire fixtures and parity checks exist to prevent.

#270 came from a C++ simulation built on Unreal Engine. That project is one consumer, not the design target. Nothing in this proposal depends on Unreal, games or simulation, and the [scope principle](#scope-principle-host-agnostic) below keeps it that way.

## Scope principle: host-agnostic

`afd-cpp` is AFD for C++, not AFD for one engine. A feature belongs in it only when it passes this test:

1. **General value.** A C++ host with nothing to do with the requester would use it: a CLI tool, a desktop app, a service or a device.
2. **Contract, not invention.** It is part of the AFD contract that TypeScript, Python and Rust share, or it is the C++ idiom for a concept those languages already have. For example, `CancellationToken` stands in for `AbortSignal`, and `TaskRunner` for `Promise` concurrency.
3. **Not buildable on top.** It cannot reasonably be built in the host application on AFD's extension points: middleware, `CommandContext::extra`, `TaskRunner`, `Clock` and the public registry API.

A feature that fails (1) or (2), or passes (3), belongs in the requesting application. This rules out:
- engine and framework adapters (Unreal, Unity, Godot, Qt, etc.) inside the AFD repo;
- engine-specific macros, string types, allocators or build-tool layouts in the library or its CI;
- context fields or hooks reserved for features that AFD has not accepted.

The requester builds their Unreal integration in their own project, on the public API. If adapters for several unrelated hosts later turn out to share real code, that shared layer can be proposed separately.

## What "the same AFD" means

The quality review ([2026-09-23](../../../reviews/2026-09-23-quality-review.md), Theme 2) found that execution semantics had been implemented several times and had diverged. So this proposal names the reference explicitly:

1. **Single-command semantics** follow the TypeScript **server engine** (`createExecutionEngine`), not the minimal core registry. That covers lookup, "did you mean" suggestions, the context check, validation, middleware, metadata stamping and hooks.
2. **Batch, pipeline and stream semantics** follow the core executors, which every TypeScript host delegates to.
3. **Wire-visible strings are copied verbatim.** This covers error codes, messages and suggestions in batch, pipeline and stream results, plus the result `reasoning` text.
4. **Where Rust and TypeScript differ, C++ follows TypeScript,** and the difference is filed against Rust (see [Research findings](./work-plan.md#research-findings-to-file-separately)).
5. **C++ has one executor.** The registry, the in-process client and the test harness all delegate to it. That rules out the three executors the review found in TypeScript.

## Scope

| Piece | v0.1 (#270) | Later | Notes |
|---|---|---|---|
| `CommandResult`, `CommandError`, `Warning`, `Source`, `PlanStep`, `Alternative`, `ResultMetadata` | Yes | | camelCase JSON with unset fields omitted; must round-trip every `spec/wire` fixture |
| Error codes and error constructors | Yes | | The full TypeScript `ErrorCodes` list, plus the batch, pipeline and stream codes |
| Command metadata | Yes | | `name`, `description`, `category`, `tags`, `version`, `mutation`, `destructive`, `confirmPrompt`, `undoable`, `requires`, `contexts`, `expose`, `handoff`, `handoffProtocol`, `examples`, `executionTime`, `errors` |
| `CommandRegistry`: `register`, `get`, `has`, `list`, `listByCategory`, `listByExposure`, `execute`, `executeBatch`, `executePipeline`, middleware | Yes | | Same dispatch order as `execution.ts` |
| Input validation | Yes | | A JSON Schema draft-07 subset validator (no Zod); see D6 |
| Batch and pipeline semantics | Yes | | `stopOnError`, `parallelism`, deadlines, `$prev`/`$first`/`$steps`/`$input`, `when`, as enforced since #216/#217/#219 |
| Streaming | Yes | | Chunk types, `executeStream`, `consumeStream`, `collectStreamData` |
| Handoff types, similarity helpers | Yes | | Small, and needed for parity |
| In-process client (`DirectClient` equivalent) | Yes | | `allow` predicate, interface exposure, trace IDs, timeouts, `pipe()` |
| Default middleware (trace ID, logging, timing) | Yes | | The log sink is injectable, never hard-wired to stderr |
| Retry, rate-limit and telemetry middleware; bootstrap commands (`afd-help`, `afd-docs`, `afd-schema`) | | Yes | Parity follow-ups |
| MCP JSON-RPC types and helpers, connectors | | Yes | Tracked as a declared parity gap |
| Stdio MCP loop | In the todo backend only | Maybe an optional `afd::mcp_stdio` target | The conformance runner can only talk MCP (see D10) |
| MCP HTTP transport | No | | A host process bridges, or the registry is used in process |
| Engine or framework adapters (Unreal, Unity, Qt, etc.) | No | Not in AFD | Hosts build these on the public API (see the [scope principle](#scope-principle-host-agnostic)) |
| TypeSpec code generation | No | A separate cross-language proposal | There is no TypeSpec in the repo today (see D6) |

## Key design decisions

Each decision has a recommendation. Decisions marked **(confirm)** need a maintainer's sign-off in Phase 0.

**D1. Language and toolchain (confirm).** Target C++20 with CMake 3.24 or later. CI defines the supported floor: GCC 12, Clang 16, Apple Clang 15, MSVC 2022 and a pinned Emscripten.
- Public headers avoid features whose library support still varies: `<format>`, coroutines, modules, `std::jthread`/`std::stop_token` and C++23 `std::expected`.
- Why C++20 rather than C++17:
  - **Designated initializers** let a command definition read like the TypeScript object literal: `CommandDefinition{.name = "todo-create", .description = …}`. Command definitions are the code AFD users write most.
  - `std::span` is also available.
  - Every mainstream compiler has supported these for several years.
  - C++17 remains an option if maintainers value reach into older toolchains more than that ergonomics. It would cost builder-style definitions instead.

**D2. JSON library (confirm): nlohmann/json 3.11 or later, with `afd::Json = nlohmann::json`.** It is the most widely used C++ JSON library: header-only, packaged by vcpkg, Conan and most Linux distributions, and buildable under Emscripten.
- Its versioned ABI namespace avoids clashes when another library in the same program vendors its own copy.
- Use the sorted-map `json`, not `ordered_json`. `ordered_json` equality is order-sensitive, which would break `$eq` structural comparison and fixture comparison.
- Output keys come out alphabetical. That is acceptable, because every consumer compares structurally.
- Resolution order: `find_package` first, then `FetchContent` pinned by URL and SHA-256. This lets a host supply its own copy.

**D3. Builds without exceptions and RTTI are a supported, CI-gated configuration (confirm).**
- A large part of the C++ world compiles without exceptions, and often without RTTI:
  - Google-style and Chromium code;
  - LLVM;
  - most game engines;
  - embedded toolchains;
  - Emscripten, which disables exception catching by default.
- Libraries meant for wide embedding support this configuration, for example fmt, Abseil, Protocol Buffers and nlohmann/json itself. An AFD that required exceptions would exclude those hosts.
- The cost is coding discipline, not features.
- The library therefore compiles, and its tests pass, with `-fno-exceptions -fno-rtti`, with `JSON_NOEXCEPTION` defined.
- Code never calls a throwing accessor on unchecked data (`at`, `get<T>`, `std::regex`, `std::stoi`). It parses with `allow_exceptions = false` and returns errors as values.
- Handler exceptions are caught only when `__cpp_exceptions` is defined. They then map to `COMMAND_EXECUTION_ERROR` exactly as `executionFailure` does.

**D4. Execution model (confirm): synchronous handlers, a pluggable runner and cooperative cancellation.**
- A handler has the signature `CommandResult(const Json& input, CommandContext& ctx)`.
- C++ has no standard async runtime. Building on one (Asio, a coroutine task library, TBB or an engine job system) would tie `afd-cpp` to that ecosystem.
- Synchronous handlers with a runner interface keep the library runtime-agnostic. They also work in single-threaded WebAssembly, and they are what most C++ call sites expect.
- The registry takes an optional host-supplied `TaskRunner`:
  - **Inline (default):** batch `parallelism` is an upper bound; entries run one after another.
  - **Thread pool (native builds):** honors real overlap. Waits race the batch or pipeline deadline, as the TypeScript `Promise.race` does.
- `CommandContext::cancellation` replaces `AbortSignal`. It is a token with a flag and a deadline that handlers can poll without a timer thread.
- With the inline runner, a deadline is enforced before each entry starts and again when it completes. An overrun is reported as `BATCH_TIMEOUT` or `PIPELINE_TIMEOUT` with the same wire result as TypeScript. The C++ call returns when the handler returns, because a synchronous handler cannot be preempted. This limitation is documented, not hidden.
- An injectable `Clock` in `RegistryOptions` covers durations, deadlines and `startedAt`/`completedAt`, so timing tests are deterministic without sleeping.
  - It is a test seam for the library itself, not a `CommandContext` feature.
  - Exposing a clock to handlers is #274's decision, made for all languages.
- Asynchronous (completion-based) handlers are deferred until a concrete consumer needs them.

**D5. Data model: payloads are untyped `Json` in the core,** matching how the Rust crate types its handlers.
- `std::optional<Json>` separates *absent* from `null`. The wire contract, the pipeline absent-value rules and the `data: null` fixtures all depend on that distinction.
- Typed helpers convert through ADL `to_json`/`from_json`, only after validation. Serialization is hand-written, because the `NLOHMANN_DEFINE_TYPE_*` macros throw.

**D6. Validation: a JSON Schema subset validator that follows the TypeScript engine's error shape.**
- Supported keywords:
  - `type` (including `integer`), `properties`, `required`, `default`, `enum`;
  - `items`, `minItems`/`maxItems`, `minLength`/`maxLength`;
  - `minimum`/`maximum` and their exclusive variants, `additionalProperties`;
  - local `$ref` (`#/definitions/…`, `#/$defs/…`), with a cycle guard.
  - This is everything the todo input schemas use.
- Any other keyword fails at **registration**, loudly. That includes `pattern`, `oneOf`/`anyOf`/`allOf`/`not`, remote `$ref` and `format`.
  - `pattern` in particular waits for a host-supplied regex hook such as RE2. `std::regex` throws, and on hostile input it is slow and deeply recursive.
- Failures return `VALIDATION_ERROR` with the message `Input validation failed`. `details` carries `errors[{path, message, code, expected?}]`, `expectedFields`, `unexpectedFields` and `missingFields`, and the suggestion follows `packages/server/src/validation.ts:69-113`.
- Handlers and middleware receive the **parsed** input, with defaults applied and undeclared keys stripped, as Zod gives TypeScript handlers.
- `examples` are validated at registration.
- #270 also proposed generating the schemas from TypeSpec. There is no TypeSpec in the repo: the todo schemas are hand-written in four places. So the C++ todo backend validates directly against the shared `spec/commands.schema.json`. TypeSpec becomes its own cross-language proposal.

**D7. Naming and layout.**
- Types are `PascalCase`; functions and constants are `snake_case`. `alfred parity` normalizes names to snake_case, so C++ names compare directly with the TypeScript names.
- Everything public lives in `namespace afd`. Internals go in `afd::detail`, which the parity parser skips so that C++-only helpers do not grow `missing_from_typescript`.
- Headers live in `include/afd/*.hpp`, under the umbrella `afd/afd.hpp`.

**D8. Strings are UTF-8 `std::string`.** Where TypeScript semantics are visible on the wire, counts use **UTF-16 code units**, as JavaScript does:
- the 128-character name cap and truncation with a trailing `…` that never splits a surrogate pair;
- Levenshtein distance;
- the 1024-character reference limit.

**D9. Wire numbers.** An integral double within ±(2^53−1) is written as a JSON integer, as `JSON.stringify` does. `packages/rust/src/wire.rs` does the same.

**D10. Conformance transport (confirm).**
- The todo runner (`packages/examples/todo/dx/run-conformance.ts`) is an MCP client, so the C++ todo backend ships a minimal **stdio** MCP loop. The TypeScript and Python backends use stdio, which needs no HTTP library, port or health check.
- The loop lives in `packages/examples/todo/backends/cpp`, which keeps the library transport-free as #270 asks.
- Promoting it to an optional `afd::mcp_stdio` target is a follow-up decision.

**D11. Versioning (confirm).**
- The version is independent semver starting at `0.1.0`, as for Rust (`0.1.0`) and Python (`0.8.0`). Changesets does not apply, because there is no `package.json`.
- The package keeps its own `packages/cpp/CHANGELOG.md` and uses tags of the form `afd-cpp-v0.1.0`.
- Distribution is through a CMake package config (`find_package(afd CONFIG)`), `FetchContent` and `add_subdirectory`. vcpkg and Conan ports come later.

## Constraints

- **Embeddable in any C++ host:**
  - It builds with exceptions and RTTI off, and as a CMake unity build.
  - It has no global mutable state and no dependence on static-initialization order.
  - It survives the two macro collisions every portable C++ library meets:
    - `<windows.h>`'s `min` and `max`, handled by writing `(std::min)(…)`;
    - the lowercase `check`, `verify` and `require` in Apple's `AssertMacros.h`, handled by never using those names as identifiers.
  - Host- or engine-specific macros are the host's concern.
- **Safe on hostile input** (quality review Theme 5):
  - Names are capped at 128 before fuzzy matching, with a length-ratio pre-filter and a two-row Levenshtein.
  - Pipeline nesting is capped at 64, checked iteratively.
  - References longer than 1024 are literals.
  - JSON parsing is bounded by depth and size.
  - Serialization never recurses on untrusted depth.
  - Variable resolution follows only own keys of JSON data and rejects `__` segments.
- **Deterministic under test:** clock, runner and random source are all injectable.

## Success criteria

- [ ] All six `spec/wire` fixtures round-trip. The test fails on any fixture it has no mapping for, as `packages/rust/tests/wire_fixtures.rs` does.
- [ ] `spec/pipeline-variables.md` is implemented, with every test in its conformance minimum.
- [ ] The batch and pipeline control cases in `packages/server/src/execution-controls.test.ts` are ported and pass.
- [ ] The C++ todo backend passes 34/34 cases in `conformance.yml`.
- [ ] `cpp.yml` is green for:
  - Linux GCC;
  - Linux Clang with ASan and UBSan;
  - macOS;
  - Windows MSVC;
  - Emscripten, with tests run under Node;
  - no exceptions and no RTTI.
- [ ] `alfred parity` reports C++, with a `missing_from_cpp` budget and a C++ wire round-trip entry.
- [ ] An `afd-cpp` skill exists, and repository docs list four languages.
- [ ] The package can be consumed through `find_package`, `FetchContent` and `add_subdirectory`, and the quick start compiles in CI.

## Companion issues (#271–#276)

#271–#276 were filed alongside #270, and their motivation draws on the same simulation project.
- **The C++ port neither depends on them nor anticipates them.** `CommandContext` gets no reserved fields for them; `extra` is the extension point until a feature is accepted.
- Each one stands or falls on its value across all four languages.

Applying the [scope principle](#scope-principle-host-agnostic) to each:

| Issue | Verdict | Keep in AFD | Push back to the requester's application |
|---|---|---|---|
| #271: `actor` on `CommandContext` | Passes, with one part to push back | The typed principal (`human`, `agent`, `service`, `script`, `test`), which surfaces populate. It serves AFD's own human-and-agent thesis, telemetry and trust rules. | Using the actor to scope what a query returns, such as a per-faction fog-of-war view. That is application authorization: handlers read `ctx.actor` and filter. AFD must not grow data-scoping features. |
| #272: approval middleware | Passes | A pre-execution gate and a resumable `APPROVAL_REQUIRED` result. Agents needing human sign-off is core AFD. | — |
| #273: command journal and replay | Passes, with one part to push back | Ordered recording, a JSON Lines format, and replay with diffs, for audit, reproducing agent sessions and regression tests. | Treating the journal as the application's source of truth, with state derived by replay (event sourcing). That is an architecture choice, built on the journal. Replay determinism beyond clock and random is also the application's job. |
| #274: clock and random on context | Passes | Deterministic tests and replay benefit every AFD application. | — |
| #275: `undoable` dropped by `defineCommand` | Passes (bug) | Fix in TypeScript. C++ carries `undoable` like every other metadata field. | — |
| #276: atomic batch | Passes, low priority | Validate first, then undo-based compensation. Useful for multi-step edits and sagas generally. | "A turn's orders" is only an example. It is not a requirement to design around. |
| #172: optimistic command lifecycle | Not affected by this review | — | — |

Every `parity`-labeled issue costs one more implementation once C++ exists. The work plan proposes shared, language-neutral behavior vectors to keep that cost down.

## Alternatives considered

- **The Rust crate through FFI into C++ hosts:** forces a Rust toolchain on every C++ consumer and an FFI boundary on every call.
- **A TypeScript server only, with C++ as a remote client:** loses in-process execution.
- **Hand-rolled result types in each C++ project:** the drift the wire fixtures exist to prevent.
- **C++20 coroutines as the execution model:** would mirror the async TypeScript code closely. It would also mean owning a task and executor library, or choosing someone else's. That ties AFD to one async ecosystem and raises compile-time and debugging costs for every user. It stays open as a future async layer (see D4).
- **RapidJSON:** faster, but a harder API to use correctly. It has no value-semantic DOM, which the pipeline's deep-copy and structural-equality rules rely on. Speed is not the bottleneck at command granularity.
