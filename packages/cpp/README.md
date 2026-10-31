# afd-cpp

The C++20 implementation of [AFD (Agent-First Development)](../../README.md). The [proposal](../../docs/features/complete/cpp-support/proposal.md) records the design decisions, and the [work plan](../../docs/features/complete/cpp-support/work-plan.md) records how each phase was built.

> **Status: v0.2.0 released.** The library is feature-complete for v0.2: the wire types, the validating `CommandRegistry`, middleware, `DirectClient`, and batch, pipeline and stream execution. The [C++ todo backend](../examples/todo/backends/cpp/README.md) passes the 34-case conformance suite, `alfred parity` tracks the API, and the package installs with a CMake config. The current release is [cpp-v0.2.0](https://github.com/lushly-dev/afd/releases/tag/cpp-v0.2.0), implementing AFD contract `1.0-rc`; the first was [cpp-v0.1.0](https://github.com/lushly-dev/afd/releases/tag/cpp-v0.1.0).

## Design in brief

- **Host-agnostic:** no dependency on any engine, framework or async runtime. Hosts build their own integration on the public API.
- **One runtime dependency:** [nlohmann/json](https://github.com/nlohmann/json), 3.11 or later. A host's own copy is used when `find_package(nlohmann_json)` finds one; otherwise 3.12.0 is downloaded and hash-verified.
- **Embeddable:** builds and passes its tests with exceptions and RTTI off, as a unity build, and with the common `min`/`max`, `interface` and `check`/`verify`/`require` macros defined.
- **WebAssembly:** builds with Emscripten, and the tests run under Node.

## Commands

```cpp
#include <afd/afd.hpp>

auto registry = std::make_shared<afd::CommandRegistry>(
    afd::CommandRegistryOptions{.middleware = afd::default_middleware()});

auto error = registry->register_command(afd::CommandDefinition{
    .name = "todo-create",
    .description = "Create a todo",
    .input_schema = afd::Json::parse(R"({"type": "object",
        "properties": {"title": {"type": "string", "minLength": 1}}, "required": ["title"]})"),
    .handler = [](const afd::Json& input, afd::CommandContext&) {
        return afd::success({{"title", input["title"]}}, {.reasoning = "Created"});
    },
    .mutation = true,
});

afd::CommandResult result = registry->execute("todo-create", {{"title", "Buy milk"}});

afd::DirectClient agent(registry);          // an in-process agent: sees only commands exposed to it
afd::CommandResult typo = agent.call("todo-crate");  // UNKNOWN_TOOL with "Did you mean 'todo-create'?"
```

- **Dispatch order.** `execute` follows the TypeScript engine: lookup, exposure, context, validation, middleware, handler, metadata, `on_command`. Errors carry the TypeScript codes and text.
- **Input schemas.** These are JSON Schema; `afd/schema.hpp` lists the supported subset. An unsupported keyword fails registration, so a schema is never silently under-enforced. The shared validation vectors cover every supported case and verify explicit registration rejection for optional keywords outside the subset. Error field lists and sibling issues compare as duplicate-preserving multisets, following `spec/validation.md`; `afd::Json` retains structural equality independent of object key order.
- **Handlers are synchronous.** A timeout is a deadline on `context.cancellation` for the handler to poll, plus a TIMEOUT result for a late finish. Nothing is interrupted.
- **Names that differ from TypeScript:** `requires` is `prerequisites` (a C++20 keyword), and the context's `interface` is `surface` (a `<windows.h>` macro).

## Batches, pipelines and streams

```cpp
auto batch = registry->execute_batch(afd::Json::parse(R"({"commands": [
    {"command": "todo-create", "input": {"title": "a"}},
    {"command": "todo-create", "input": {"title": "b"}}], "options": {"stopOnError": true}})"));

auto pipeline = registry->execute_pipeline(afd::Json::parse(R"({"steps": [
    {"command": "todo-create", "input": {"title": "Buy milk"}, "as": "created"},
    {"command": "todo-get", "input": {"id": "$steps.created.id"}}]})"));

std::vector<afd::StreamChunk> chunks = registry->execute_stream("todo-list");
```

- **Semantics** follow `packages/core/src/command-execution.ts` and `pipeline-executor.ts`. Pipeline references follow [`spec/pipeline-variables.md`](../../spec/pipeline-variables.md), and results match the TypeScript-generated vectors in `spec/vectors`.
- **Concurrency.** Pass `CommandRegistryOptions{.runner = std::make_shared<afd::ThreadTaskRunner>()}` for real batch parallelism; handlers must then be thread-safe. The default `InlineTaskRunner` runs commands one at a time. `ThreadTaskRunner` joins all started workers on every exit path. With exceptions enabled, task exceptions are rethrown on the caller after all tasks finish; thread-start exceptions propagate after joining the workers already started.
- **Deadlines are cooperative.** A handler sees the deadline on `context.cancellation`, and a late finish is reported as BATCH_TIMEOUT or PIPELINE_TIMEOUT. Nothing is interrupted. Observed caller cancellation prevents queued batch commands and pipeline steps from starting; their errors are COMMAND_CANCELLED, and pipeline steps are skipped. Inflight handlers keep their actual outcomes and can poll the inherited cancellation token.

## Journal and replay

```cpp
auto journal = std::make_shared<afd::MemoryJournalSink>(); // or afd::FileJournalSink("s.jsonl")
afd::CommandRegistry registry({.middleware = {afd::create_journal_middleware(journal)}});
// ... calls ...
std::string jsonl = afd::serialize_journal(*journal->read());

auto entries = afd::parse_journal(jsonl);
afd::ReplayReport report = afd::replay_journal(fresh_registry, *entries);
```

- **Format and rules** are [`spec/journal.md`](../../spec/journal.md); `tests/journal_wire_test.cpp` records the session in `spec/wire/journal.jsonl`, compares it entry for entry, and replays the file to `same`.
- **No secrets from the context.** An entry keeps the actor, the surface, the trace ID and the declared context fields marked `journal` (below); `contextDigest.hash` covers those and the names of the other members, never their values. Inputs and results are kept as they are: commands named `auth-*` are skipped, and `filter` and `redact` handle the rest.
- **The tape** holds every `steady_ms`, `wall_ms` and `random->next()` value the handler and the registry's timing read, so add the middleware last. Replay feeds it back and reports each entry as `same`, `different` (with paths) or `error`.

## Declared context fields

```cpp
auto registry = afd::CommandRegistry::create({
    .middleware = {afd::create_journal_middleware(journal)},
    .context_fields = {
        {.name = "scope", .meta = "dev.example/scope", .schema = scope_schema, .journal = true},
        {.name = "locale", .meta = "dev.example/locale", .schema = {{"type", "string"}}},
    }});
if (!registry) { /* registry.error() names the field */ }

afd::CommandContext context;
context.extra["scope"] = {{"project", "p-1"}};   // a host's MCP loop reads it from _meta["dev.example/scope"]
(*registry)->execute("todo-list", {}, context);
```

- **Rules** are [`spec/context-fields.md`](../../spec/context-fields.md). `create` refuses an empty, reserved or repeated name, a `meta` key without a reverse-DNS prefix (or with `dev.afd/`, `mcp` or `modelcontextprotocol`), a repeated `meta` key and an unsupported schema. A registry constructed directly with such a declaration fails every call with INTERNAL_ERROR.
- **Validated on every call**, after the input and before middleware: the handler sees the schema's output in `context.extra[name]`, and an invalid value or a missing required one fails with VALIDATION_ERROR (`details.field`, `details.meta`, `details.errors`). A JSON `null` counts as no value, and `required` is not enforced for `afd-*` commands.
- **The journal** keeps the values of fields declared `journal` in the entry's `context` (a value over 4096 bytes of canonical JSON is named in `contextOmitted` instead); the registry tells the journal middleware which fields those are. `replay_journal` restores them, and notes a field the registry no longer declares and each omitted one.

## Approvals

For agents, use `DirectClient` with `DirectClientOptions::on_approval_needed`. Its
`DirectApprovalRequest` contains command, input, summary, expiry, rejection reason and
cancellation, never the credential. Only a true answer enables one private retry. Public
call/pipe contexts cannot approve, and held results, observers and journals contain no token.
The synchronous hook must cooperate with `request.cancellation`; a late answer never retries.
The raw registry example below is a trusted host API for out-of-band approval handling.

```cpp
afd::CommandDefinition remove{.name = "todo-delete", /* ... */ .approval = afd::ApprovalDecision::required};
auto approval = afd::create_approval_middleware(
    {.secrets = {secret_from_environment}, .commands = {remove}}); // at least 32 bytes, no default
if (!approval) { /* approval.error() says why */ }
afd::CommandRegistry registry({.middleware = {*approval}});

auto held = registry.execute("todo-delete", {{"id", 42}}); // APPROVAL_REQUIRED, details.approvalToken
// ... trusted surface code shows the summary; once a human approves, it (never the gated caller) retries:
afd::CommandContext context;
context.approval = held.error->details->at("approvalToken").get<std::string>();
registry.execute("todo-delete", {{"id", 42}}, context); // runs once
```

- **Rules** are [`spec/command-metadata.md`](../../spec/command-metadata.md#approvals) ("Approvals"). A policy is an `ApprovalDecision` or a function of the validated input and the context; anything but `not_required` holds the call.
- **Evidence comes from trusted code.** Only the surface sets `CommandContext::approval`, after a human approved; never copy it from tool arguments.
- **Tokens are TypeScript's**, byte for byte: HMAC-SHA256 over the command, keyed digests of `canonical_json(input)` and of the actor's kind, id and `on_behalf_of`, issue and expiry times and a random nonce. A token issued by a TypeScript server with the same secret verifies here, and the reverse. Single-use by default (`ApprovalReplay::within_ttl` allows reuse until expiry); share an `ApprovalNonceStore` between instances. Expiry uses the middleware's `clock`, never the context's.
- **HMAC-SHA256** is self-contained (on the SHA-256 the journal uses) and checked against the RFC 4231 vectors, so there is no crypto dependency. Nonces come from `std::random_device` unless `random_bytes` is set.

## Wire types

```cpp
#include <afd/afd.hpp>

afd::CommandResult created = afd::success({{"id", "todo-1"}}, {.confidence = 0.9, .reasoning = "Created"});
afd::Json wire = created;                                    // camelCase, unset fields omitted
auto parsed = afd::CommandResult::from_json(wire);           // never throws
if (!parsed) { /* parsed.error() == "error.code: expected a string", etc. */ }

auto untrusted = afd::parse_bounded(text);                   // depth- and size-limited parse
```

- **Reading.** `T::from_json` returns `afd::Expected<T>`, never throws, and reports the path of the first problem. `null` members read as absent, except `data` and `result`, where `null` is a value.
- **Writing.** Converting to `afd::Json` omits unset fields. Integral numbers are written as integers, as JavaScript does.
- **Designated initializers.** Option structs are meant for partial designated initializers, such as `{.suggestion = "…"}`. Clang, clang-cl and GCC warn about the omitted fields under their higher warning levels. afd-cpp turns the applicable warnings off for its own targets. In your own code you may want `-Wno-missing-field-initializers` and, with Clang 21 or newer, `-Wno-missing-designated-field-initializers`.

## Using the package

afd-cpp is not on a package registry. Get it in one of three ways, and link `afd::afd`. Use the immutable `cpp-v0.2.0` tag for the published 0.2.0 release.

**FetchContent:**

```cmake
include(FetchContent)
FetchContent_Declare(afd
    GIT_REPOSITORY https://github.com/lushly-dev/afd.git
    GIT_TAG cpp-v0.2.0
    SOURCE_SUBDIR packages/cpp)
FetchContent_MakeAvailable(afd)
target_link_libraries(my_app PRIVATE afd::afd)
```

**An installed package:**

```bash
cmake -S packages/cpp -B build -DCMAKE_BUILD_TYPE=Release -DAFD_BUILD_TESTS=OFF
cmake --build build --config Release
cmake --install build --config Release --prefix /opt/afd
```

```cmake
find_package(afd 0.2 CONFIG REQUIRED)  # with CMAKE_PREFIX_PATH=/opt/afd
target_link_libraries(my_app PRIVATE afd::afd)
```

The install includes the nlohmann/json that afd downloaded, unless `AFD_USE_SYSTEM_JSON` is on, in which case the consumer must find the same one. Minor versions may break the API before 1.0, so the version file accepts only the same major and minor version.

**A vendored copy:** `add_subdirectory(path/to/packages/cpp)`.

As a subproject, afd builds only the library: tests, examples and install rules are off unless you turn them on. [`examples/quickstart.cpp`](examples/quickstart.cpp) is a complete program that defines a command, executes it and calls it through `DirectClient`; CI builds it both ways against [`tests/consumer`](tests/consumer/CMakeLists.txt).

## Building

This needs CMake 3.25 or later and a C++20 compiler: GCC 12+, Clang 16+, Apple Clang 15+ or MSVC 2022 (19.30+). clang-cl is also supported. CMake rejects older cl.exe versions before the build; the check does not reject clang-cl using an older Visual Studio SDK. Emscripten is optional.

```bash
cd packages/cpp
cmake --preset dev
cmake --build --preset dev
ctest --preset dev
```

| Preset | Configuration |
|---|---|
| `dev` | Debug build with tests |
| `release` | Release build with tests (Linux, macOS and Windows CI) |
| `asan` | AddressSanitizer and UndefinedBehaviorSanitizer (Linux with Clang; unsupported on macOS, see below) |
| `tsan` | ThreadSanitizer with `AFD_ENABLE_THREADS` (Clang) |
| `noexcept-nortti` | `-fno-exceptions -fno-rtti`, unity build, macro-hygiene check (GCC or Clang) |
| `emscripten` | WebAssembly; configure with `emcmake cmake --preset emscripten`. Tests run under Node. |

Build trees go to `packages/cpp/build/<preset>/`, which git ignores. Set `CMAKE_GENERATOR=Ninja` for faster local builds.

**The `asan` preset is not supported on macOS.** It hangs at startup there: Apple Clang 17's
sanitizer runtime stalls while finding the dynamic shadow region, before afd-cpp enters `main`, so no
test runs, even when only listing test cases. `ASAN_OPTIONS=detect_leaks=0` does not help
([#331](https://github.com/lushly-dev/afd/issues/331)). Do not use it as local evidence on a Mac; rely
on CI's `linux-clang-sanitize` job, or run the preset on Linux (for example in a container).

## Options

| Option | Default | Effect |
|---|---|---|
| `AFD_BUILD_TESTS` | ON when top-level | Build the doctest suite |
| `AFD_BUILD_EXAMPLES` | ON when top-level | Build `examples/` (and test them when `AFD_BUILD_TESTS` is on) |
| `AFD_INSTALL` | ON when top-level | Generate install rules and the `afd` CMake package |
| `AFD_WARNINGS_AS_ERRORS` | OFF (ON in presets) | `-Werror` or `/WX` |
| `AFD_USE_SYSTEM_JSON` | OFF | Require `nlohmann_json` from `find_package` instead of downloading it |
| `AFD_ENABLE_THREADS` | ON (OFF for Emscripten) | Build `ThreadTaskRunner` and link `Threads::Threads` |
| `AFD_JOURNAL_FILE` | ON | Build `FileJournalSink` (`afd/journal_file.hpp`, not in `afd/afd.hpp`), which uses `std::filesystem` |
| `AFD_BUILD_BENCHMARKS` | OFF | Build `benchmarks/` (`afd_benchmarks`); see [Benchmarks](#benchmarks) |
| `AFD_BUILD_FUZZERS` | OFF | Build the `fuzz/` targets: libFuzzer with Clang, corpus replay elsewhere |
| `AFD_MACRO_HYGIENE_CHECK` | OFF (ON in `noexcept-nortti`) | Compile afd-cpp's own code with `cmake/macro_hygiene_prelude.hpp` force-included |

## Formatting

The formatting source is `.clang-format`. CI pins clang-format through PyPI, and this runs the same version locally:

```bash
cd packages/cpp
find include src tests cmake fuzz benchmarks \( -name '*.cpp' -o -name '*.hpp' \) -print0 | xargs -0 uvx --from clang-format==22.1.8 clang-format -i
```

## Contributing

Library code must be exception-free and RTTI-free:
- Never call a throwing accessor on unchecked data (`at`, `get<T>`).
- Parse JSON with `allow_exceptions = false`.
- Write `(std::min)(…)`.
- Never name anything `check`, `verify`, `require` or `interface`.

CI (`.github/workflows/cpp.yml`) runs the `release` preset on Linux (GCC), macOS and Windows (MSVC and checksum-verified LLVM 22.1.8 clang-cl). The clang-cl configure step asserts that CMake selected that exact Clang version with the MSVC frontend; the regression gate also rejects Clang older than 21. The `asan`, `tsan`, `noexcept-nortti` and `emscripten` presets run on Linux only. CI also checks formatting, runs the [benchmarks](#benchmarks) on the `release` preset, builds [`tests/consumer`](tests/consumer/CMakeLists.txt) on Linux and Windows, and fuzzes each target for 60 seconds on Linux.

## Benchmarks

`benchmarks/` holds a dependency-free harness (`benchmarks/harness.hpp`) and one executable,
`afd_benchmarks`, behind `AFD_BUILD_BENCHMARKS` (OFF by default). Each case doubles its batch until
one batch lasts 50 ms, then times five batches and prints the median and fastest nanoseconds per
operation. There are no pass or fail thresholds: timing is evidence to compare across commits and
machines, not a unit-test gate (see [#336](https://github.com/lushly-dev/afd/issues/336)).

```bash
cd packages/cpp
cmake --preset release -DAFD_BUILD_BENCHMARKS=ON
cmake --build --preset release --target afd_benchmarks
build/release/benchmarks/afd_benchmarks            # every case
build/release/benchmarks/afd_benchmarks validate   # cases whose name contains "validate"
```

Under Emscripten, configure with `emcmake cmake --preset emscripten -DAFD_BUILD_BENCHMARKS=ON`, build
the same target and run `node build/emscripten/benchmarks/afd_benchmarks.cjs`.

| Case | Measures (one operation) |
|---|---|
| `execute/trivial` | `execute` of a no-op command, no middleware: lookup, exposure, validation, handler, metadata |
| `execute/trace_id_middleware` | The same with `default_middleware()` reduced to the trace ID |
| `execute/default_middleware` | The same with all of `default_middleware()`; logging writes to a discarding sink |
| `direct_client/call` | `DirectClient::call` of the no-op command |
| `execute/validate/string_properties=N` | `execute` with an input schema of N required string properties (3, 20, 100) |
| `registry_1000/execute`, `/get`, `/list` | Dispatch, `get` and `list` on a registry of 1,000 commands |
| `execute_batch/n=N` | One batch of N no-op commands (1, 10, 100) |
| `execute_pipeline/n=N` | One pipeline of N steps, each after the first reading `$prev.value` (1, 10, 100) |
| `json_parse/1KB`, `/100KB` | Plain `nlohmann::json::parse` of the same text, the reference for `parse_bounded` |
| `parse_bounded/1KB`, `/100KB` | `parse_bounded` of a todo-list result |
| `serialize_result/1KB`, `/100KB` | `CommandResult` to `Json` to `wire::serialize` text |

CI's `C++ (benchmarks)` job runs it on the `release` preset (Linux, GCC) and uploads the output as the
`cpp-benchmarks` artifact; the `C++ (emscripten)` job runs it under Node and uploads
`cpp-benchmarks-wasm`. Every other C++ CI build compiles it without running it. Shared runners are
noisy, so compare runs rather than single numbers.

### Baseline

Recorded 2026-10-25 at commit `585265a` plus this harness, on an Apple M5 (10 cores), macOS 27.0.1.
Native: Apple clang 17.0.0 (clang-1700.6.4.2), CMake 4.4.3, `release` preset. WebAssembly: Emscripten
6.0.10, Node 24.21.0, `emscripten` preset. Other builds were running on the machine (load average
about 40), so treat these as upper bounds. Median nanoseconds per operation:

| Case | Native | WebAssembly |
|---|---:|---:|
| `execute/trivial` | 679 | 804 |
| `execute/trace_id_middleware` | 1,231 | 1,332 |
| `execute/default_middleware` | 2,112 | 2,853 |
| `direct_client/call` | 1,136 | 1,626 |
| `execute/validate/string_properties=3` | 1,760 | 1,710 |
| `execute/validate/string_properties=20` | 10,323 | 7,490 |
| `execute/validate/string_properties=100` | 58,202 | 40,379 |
| `registry_1000/execute` | 645 | 826 |
| `registry_1000/get` | 51 | 105 |
| `registry_1000/list` | 4,279 | 4,702 |
| `execute_batch/n=1` | 2,832 | 4,836 |
| `execute_batch/n=10` | 11,792 | 19,935 |
| `execute_batch/n=100` | 99,589 | 170,393 |
| `execute_pipeline/n=1` | 4,129 | 4,513 |
| `execute_pipeline/n=10` | 34,597 | 36,708 |
| `execute_pipeline/n=100` | 326,519 | 409,671 |
| `parse_bounded/1KB` | 16,990 | 26,294 |
| `parse_bounded/100KB` | 6,243,180 | 3,054,655 |
| `serialize_result/1KB` | 11,707 | 38,789 |
| `serialize_result/100KB` | 992,546 | 2,415,343 |

A call costs about 1 µs in process (about 2 µs with all of `default_middleware()`), and dispatch on 1,000 commands costs the same as on one.
Batch and pipeline scale linearly in N. The `parse_bounded` rows above predate the fix for
[#397](https://github.com/lushly-dev/afd/issues/397): it enforced the depth limit with a nlohmann parser
callback, and the callback parser rescans the enclosing container after every object, which is
quadratic in the number of objects in an array. It now builds the document from SAX events and costs
about the same as `json_parse`. On the same machine (load average about 25), median nanoseconds per
operation:

| Case | Native before | Native after | WebAssembly after |
|---|---:|---:|---:|
| `json_parse/1KB` | | 16,264–31,339 | 18,789 |
| `parse_bounded/1KB` | 23,036–26,469 | 19,254–23,885 | 18,103 |
| `json_parse/100KB` | | 1,402,186–2,228,992 | 1,587,483 |
| `parse_bounded/100KB` | 8,825,469–12,287,302 | 1,423,739–1,818,014 | 1,609,969 |

Native ranges are three interleaved runs of each build; before, 100 KB was about 6 to 9 times
`json_parse`, and after, within 10 percent of it.
