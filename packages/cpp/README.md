# afd-cpp

The C++20 implementation of [AFD (Agent-First Development)](../../README.md). The [proposal](../../docs/features/proposed/cpp-support/proposal.md) records the design decisions, and the [work plan](../../docs/features/proposed/cpp-support/work-plan.md) records how each phase was built.

> **Status: v0.1 release candidate.** The library is feature-complete for v0.1: the wire types, the validating `CommandRegistry`, middleware, `DirectClient`, and batch, pipeline and stream execution. The [C++ todo backend](../examples/todo/backends/cpp/README.md) passes the 34-case conformance suite, `alfred parity` tracks the API, and the package installs with a CMake config. Releases will be tagged `cpp-vX.Y.Z`; the first tag, `cpp-v0.1.0`, is not cut yet.

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
- **Input schemas.** These are JSON Schema; `afd/schema.hpp` lists the supported subset. An unsupported keyword fails registration, so a schema is never silently under-enforced.
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
- **Concurrency.** Pass `CommandRegistryOptions{.runner = std::make_shared<afd::ThreadTaskRunner>()}` for real batch parallelism; handlers must then be thread-safe. The default `InlineTaskRunner` runs commands one at a time.
- **Deadlines are cooperative.** A handler sees the deadline on `context.cancellation`, and a late finish is reported as BATCH_TIMEOUT or PIPELINE_TIMEOUT. Nothing is interrupted.

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
- **Designated initializers.** Option structs are meant for partial designated initializers, such as `{.suggestion = "…"}`. Clang and GCC warn about the omitted fields under `-Wextra`. afd-cpp turns that warning off for its own targets. In your own code you may want `-Wno-missing-field-initializers`, which covers both compilers.

## Using the package

afd-cpp is not on a package registry. Get it in one of three ways, and link `afd::afd`. Releases will be tagged `cpp-vX.Y.Z`, but no tag exists until the first release, `cpp-v0.1.0`. Until then, take `main`, or pin a commit SHA from it.

**FetchContent:**

```cmake
include(FetchContent)
FetchContent_Declare(afd
    GIT_REPOSITORY https://github.com/lushly-dev/afd.git
    GIT_TAG main  # or a commit SHA; cpp-v0.1.0 once it is released
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
find_package(afd 0.1 CONFIG REQUIRED)  # with CMAKE_PREFIX_PATH=/opt/afd
target_link_libraries(my_app PRIVATE afd::afd)
```

The install includes the nlohmann/json that afd downloaded, unless `AFD_USE_SYSTEM_JSON` is on, in which case the consumer must find the same one. Minor versions may break the API before 1.0, so the version file accepts only the same major and minor version.

**A vendored copy:** `add_subdirectory(path/to/packages/cpp)`.

As a subproject, afd builds only the library: tests, examples and install rules are off unless you turn them on. [`examples/quickstart.cpp`](examples/quickstart.cpp) is a complete program that defines a command, executes it and calls it through `DirectClient`; CI builds it both ways against [`tests/consumer`](tests/consumer/CMakeLists.txt).

## Building

This needs CMake 3.25 or later and a C++20 compiler: GCC 12+, Clang 16+, Apple Clang 15+ or MSVC 2022. Emscripten is optional.

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
| `asan` | AddressSanitizer and UndefinedBehaviorSanitizer (GCC or Clang) |
| `tsan` | ThreadSanitizer with `AFD_ENABLE_THREADS` (Clang) |
| `noexcept-nortti` | `-fno-exceptions -fno-rtti`, unity build, macro-hygiene check (GCC or Clang) |
| `emscripten` | WebAssembly; configure with `emcmake cmake --preset emscripten`. Tests run under Node. |

Build trees go to `packages/cpp/build/<preset>/`, which git ignores. Set `CMAKE_GENERATOR=Ninja` for faster local builds.

## Options

| Option | Default | Effect |
|---|---|---|
| `AFD_BUILD_TESTS` | ON when top-level | Build the doctest suite |
| `AFD_BUILD_EXAMPLES` | ON when top-level | Build `examples/` (and test them when `AFD_BUILD_TESTS` is on) |
| `AFD_INSTALL` | ON when top-level | Generate install rules and the `afd` CMake package |
| `AFD_WARNINGS_AS_ERRORS` | OFF (ON in presets) | `-Werror` or `/WX` |
| `AFD_USE_SYSTEM_JSON` | OFF | Require `nlohmann_json` from `find_package` instead of downloading it |
| `AFD_ENABLE_THREADS` | ON (OFF for Emscripten) | Build `ThreadTaskRunner` and link `Threads::Threads` |
| `AFD_BUILD_FUZZERS` | OFF | Build the `fuzz/` targets: libFuzzer with Clang, corpus replay elsewhere |
| `AFD_MACRO_HYGIENE_CHECK` | OFF (ON in `noexcept-nortti`) | Compile afd-cpp's own code with `cmake/macro_hygiene_prelude.hpp` force-included |

## Formatting

The formatting source is `.clang-format`. CI pins clang-format through PyPI, and this runs the same version locally:

```bash
cd packages/cpp
find include src tests cmake \( -name '*.cpp' -o -name '*.hpp' \) -print0 | xargs -0 uvx --from clang-format==22.1.8 clang-format -i
```

## Contributing

Library code must be exception-free and RTTI-free:
- Never call a throwing accessor on unchecked data (`at`, `get<T>`).
- Parse JSON with `allow_exceptions = false`.
- Write `(std::min)(…)`.
- Never name anything `check`, `verify`, `require` or `interface`.

CI (`.github/workflows/cpp.yml`) runs the `release` preset on Linux (GCC), macOS and Windows (MSVC). The `asan`, `tsan`, `noexcept-nortti` and `emscripten` presets run on Linux only. CI also checks formatting, builds [`tests/consumer`](tests/consumer/CMakeLists.txt) on Linux and Windows, and fuzzes each target for 60 seconds on Linux.
