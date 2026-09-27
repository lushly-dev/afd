---
name: afd-cpp
description: >
  C++20 implementation patterns for AFD commands using afd-cpp (packages/cpp): CommandResult
  types, CommandDefinition with designated initializers, JSON Schema validation, the
  CommandRegistry and middleware, DirectClient, batch, pipeline and stream execution, and
  testing with doctest. Covers the embedding constraints (no exceptions or RTTI, macro hygiene,
  WebAssembly) and where host adapters belong. Use when: implementing commands in C++, embedding
  AFD in a C++ application, game engine, simulation or tool, building afd-cpp, or debugging C++
  AFD code. Triggers: afd-cpp, c++ afd, cpp command, CommandRegistry c++, CompiledSchema,
  DirectClient c++, cmake afd, emscripten afd.
---

# AFD C++ Implementation

Patterns for implementing AFD commands in C++ with `afd-cpp` (`packages/cpp`). The design is in
[proposal.md](../../../docs/features/proposed/cpp-support/proposal.md).

## Parity Rule

C++ matches the AFD contract that TypeScript, Python and Rust share. The behavioral reference is
the TypeScript server engine.

- **Wire shapes** must round-trip every `spec/wire` fixture (`tests/wire_fixtures_test.cpp`).
- **Pipeline references and conditions** must match `spec/vectors/pipeline-variables.json`, which is generated from TypeScript.
- **Error codes, messages and suggestions** in results are copied verbatim from TypeScript.
- **Names follow TypeScript,** in snake_case for functions and PascalCase for types (`alfred parity` compares them). There are two exceptions:
  - `requires` is `prerequisites`, because `requires` is a C++20 keyword.
  - The context's `interface` is `surface`, because `<windows.h>` defines `interface` as a macro.
- **Host-agnostic:** nothing specific to an engine, framework or async runtime goes in `afd-cpp`. Hosts build adapters on the public API (see [Building host integrations](#building-host-integrations)).

## Build and Include

```cmake
# From this repository, or FetchContent / find_package once released.
add_subdirectory(path/to/afd/packages/cpp afd)
target_link_libraries(my_app PRIVATE afd::afd)
```

```cpp
#include <afd/afd.hpp>   // the whole public API
```

Presets live in `packages/cpp/CMakePresets.json`:
- `dev` and `release`;
- `asan` and `tsan`;
- `noexcept-nortti`;
- `emscripten`, configured with `emcmake cmake --preset emscripten`.

`nlohmann/json` is the only runtime dependency, and `afd::Json` is `nlohmann::json`.

## Command Results

```cpp
afd::CommandResult ok = afd::success({{"id", "todo-1"}, {"title", "Buy milk"}},
                                     {.confidence = 0.95, .reasoning = "Created todo"});

afd::CommandResult missing = afd::failure(afd::not_found_error("Todo", "42"));
// {"success":false,"error":{"code":"NOT_FOUND","message":"Todo with ID '42' not found",
//   "suggestion":"Verify the todo ID exists and try again","retryable":false,"details":{...}}}

afd::CommandResult custom =
    afd::error("NO_CHANGES", "No fields to update",
               {.suggestion = "Provide at least one of: title, description, completed, priority"});
```

- **Options are partial designated initializers:** `ResultOptions` and `ErrorOptions`, written as `{.suggestion = ...}`. Fields must follow declaration order.
- **`data` is a `std::optional<afd::Json>`.** `null` is a value; `std::nullopt` means absent. On the wire, unset fields are omitted, never written as `null`.
- **Error constructors** carry TypeScript's exact text: `validation_error`, `not_found_error`, `rate_limit_error`, `timeout_error`, `internal_error`, `wrap_error` and `create_error`. The codes live in `afd::error_codes`, for example `afd::error_codes::NOT_FOUND`.
- **Always include a `suggestion`** in errors your commands return.

## Command Definition

```cpp
afd::CommandDefinition create{
    .name = "todo-create",                       // domain-action kebab-case
    .description = "Create a new todo item",
    .category = "todo",
    .input_schema = afd::Json::parse(R"({
        "type": "object",
        "properties": {
            "title": {"type": "string", "minLength": 1, "maxLength": 200},
            "priority": {"enum": ["low", "medium", "high"], "default": "medium"}
        },
        "required": ["title"]
    })"),
    .handler = [](const afd::Json& input, afd::CommandContext&) {
        return afd::success({{"title", input["title"]}, {"priority", input["priority"]}});
    },
    .version = "1.0.0",
    .mutation = true,
    .expose = {.mcp = true},
};
```

- **Handler signature:** `afd::CommandResult(const afd::Json& input, afd::CommandContext& context)`, the `afd::CommandHandler` type. Handlers are synchronous.
- **The handler receives parsed input.** Defaults are applied and undeclared members stripped, as Zod does for TypeScript handlers.
- **The input schema is a JSON Schema subset** (see `afd/schema.hpp`): `type`, `properties`, `required`, `default`, `enum`, `items`, min/max bounds, `additionalProperties`, and local `$ref`.
  - Any other keyword (`pattern`, `format`, `oneOf`, …) **fails registration**, so a schema is never silently under-enforced.
- **`examples` are validated at registration.**
- **Metadata fields:** `destructive`, `confirm_prompt`, `undoable`, `prerequisites`, `contexts`, `errors`, `handoff`, `handoff_protocol` and `execution_time`.

## Command Registry

```cpp
auto registry = std::make_shared<afd::CommandRegistry>(
    afd::CommandRegistryOptions{.middleware = afd::default_middleware()});

if (auto problem = registry->register_command(create)) {
    // invalid/reserved/duplicate name, no handler, unsupported schema, or a failing example
}

afd::CommandResult result = registry->execute("todo-create", {{"title", "Buy milk"}});
```

`execute` runs in the TypeScript engine's order:
1. **Lookup.** An unknown name gets COMMAND_NOT_FOUND with "did you mean" matches.
2. **Exposure**, when `context.surface` is set: COMMAND_NOT_EXPOSED.
3. **Context:** COMMAND_NOT_IN_CONTEXT.
4. **Validation:** VALIDATION_ERROR, with `details.errors`, `missingFields` and similar lists.
5. **Middleware**, then the handler.
6. **Metadata stamping:** `executionTimeMs`, `commandVersion`, and `traceId` read after middleware ran.
7. **`on_command`.**

An exception escaping a handler becomes COMMAND_EXECUTION_ERROR. Details appear only with `.dev_mode = true`.

### Middleware

```cpp
afd::CommandMiddleware audit = [](std::string_view name, const afd::Json& input,
                                  afd::CommandContext& context, const afd::Next& next) {
    // before: may inspect or short-circuit (return without calling next)
    afd::CommandResult result = next();   // may call next() again to retry
    return result;
};
registry->use(audit);   // the first middleware added is outermost
```

`default_middleware()` gives trace ID, logging and timing. Each can be disabled through `DefaultMiddlewareOptions`.

## In-Process Agents: DirectClient

```cpp
afd::DirectClient agent(registry, {.surface = afd::Interface::agent});
afd::CommandResult r = agent.call("todo-crate");   // UNKNOWN_TOOL, data lists close matches
afd::CommandContext timed;
timed.timeout_ms = 500;                          // late finish -> TIMEOUT
afd::CommandResult t = agent.call("todo-create", {{"title", "x"}}, timed);
```

The client sees only commands exposed to its surface, and further filtered by `allow`. `pipe()` runs pipelines through `call`.

## Batch, Pipeline and Stream

```cpp
afd::BatchResult batch = registry->execute_batch(afd::Json::parse(R"({
    "commands": [{"command": "todo-create", "input": {"title": "a"}}],
    "options": {"stopOnError": true, "timeout": 5000}})"));

afd::PipelineResult pipeline = registry->execute_pipeline(afd::Json::parse(R"({"steps": [
    {"command": "todo-create", "input": {"title": "Buy milk"}, "as": "created"},
    {"command": "todo-get", "input": {"id": "$steps.created.id"},
     "when": {"$exists": "$prev.id"}}]})"));

std::vector<afd::StreamChunk> chunks = registry->execute_stream("todo-list");
```

- **One executor.** `afd::execute_batch`, `afd::execute_pipeline` and `afd::execute_stream` take any `CommandExecutor`. The registry and `DirectClient` delegate to them.
- **Deadlines are cooperative.** A handler sees the deadline on `context.cancellation.is_cancelled()`. A late finish is reported as BATCH_TIMEOUT or PIPELINE_TIMEOUT, and nothing is interrupted.
- **Parallelism:** pass `CommandRegistryOptions{.runner = std::make_shared<afd::ThreadTaskRunner>()}` for real overlap. Handlers must then be thread-safe. The default runner runs commands one at a time.

## JSON and the Wire

```cpp
auto parsed = afd::parse_bounded(untrusted_text);        // depth 256, 16 MiB, never throws
if (!parsed) {
    // parsed.error().kind: too_large, too_deep or malformed
} else if (auto result = afd::CommandResult::from_json(*parsed)) {   // never throws
    afd::Json out = *result;                              // camelCase, unset fields omitted
    std::string text = afd::wire::serialize(out);         // invalid UTF-8 replaced, not fatal
} else {
    // result.error() names the first problem: "error.code: expected a string"
}
```

- **Numbers:** `wire::number(double)` writes integral values as integers, as `JSON.stringify` does.
- **Timestamps:** `wire::iso8601_utc(ms)` matches `Date#toISOString`.

## Runtime Seams (for Tests and Hosts)

- **`Clock`:** `SystemClock`, or `ManualClock` for tests, which move time explicitly with `advance(ms)`.
- **`RandomSource`:** `SeededRandom`, which takes a seed for reproducible tests.
- **`CancellationSource` and `CancellationToken`:** cooperative cancellation, optionally with a deadline or a parent token.
- **`TaskRunner`:** `InlineTaskRunner`, or `ThreadTaskRunner` when `AFD_ENABLE_THREADS` is set (off for Emscripten).

## Embedding Constraints

Library code must build and pass its tests:
- with `-fno-exceptions -fno-rtti -DJSON_NOEXCEPTION`;
- as a CMake unity build;
- with the macro-hygiene prelude force-included.

In practice, for library code:
- **Never call a throwing accessor on unchecked data** (`at`, `get<T>`, `std::regex`). Parse with `allow_exceptions = false` or `parse_bounded`.
- **Write `(std::min)(a, b)` and `(std::numeric_limits<T>::max)()`,** because `<windows.h>` defines `min` and `max` as macros.
- **Never name anything `check`, `verify`, `require` or `interface`.**
- **Guard catch blocks** with `#if defined(__cpp_exceptions)`.
- **No global mutable state, and no dependence on static-initialization order.**

## Building Host Integrations

Engine and framework adapters (Unreal, Unity, Godot, Qt, …) are **not** part of afd-cpp. Build them in your application on these extension points:
- **`TaskRunner`:** run batch workers on a host job system.
- **`Clock` and `RandomSource`:** host time and randomness, including deterministic simulation.
- **`CommandMiddleware`:** host logging, authorization and telemetry.
- **`CommandContext::extra`:** host data a handler needs.
- **A transport around `CommandRegistry::execute`.** `packages/examples/todo/backends/cpp/src/mcp_stdio.cpp` is a small stdio MCP loop to copy.

## Testing

```cpp
#include <afd/afd.hpp>
#include <doctest.h>

TEST_CASE("todo-create validates and stamps metadata") {
    auto clock = std::make_shared<afd::ManualClock>();
    afd::CommandRegistry registry(afd::CommandRegistryOptions{.clock = clock});
    REQUIRE_FALSE(registry.register_command({.name = "todo-create", .description = "Create",
        .handler = [&](const afd::Json& input, afd::CommandContext&) {
            clock->advance(5);
            return afd::success(input);
        }}).has_value());
    const afd::Json result = registry.execute("todo-create", {{"title", "x"}});
    CHECK(result["metadata"]["executionTimeMs"] == 5);
}
```

- **Library tests:** `packages/cpp/tests`, run with `ctest --preset dev`.
- **Conformance:** `pnpm --dir packages/examples/todo test:conformance:cpp`.
- **Formatting:** clang-format 22.1.8, pinned, run with `uvx --from clang-format==22.1.8 clang-format -i <files>`.

## Current Parity Note

`alfred parity` tracks `missing_from_cpp` (budget in `alfred/tests/test_parity.py`). The remaining
gaps are deliberate:
- **MCP JSON-RPC types and helpers.** Transports live in hosts and examples.
- **The typed pipeline-condition structs and their guards.** C++ keeps conditions as validated JSON.
- **Telemetry, timeout controllers and streamable-command helpers.**
- **The pipeline aggregation helpers,** which are internal to `execute_pipeline`.
- **`CommandParameter` builders and `createCommandRegistry`.**

## Related Skills

- `afd` - Core AFD patterns
- `afd-typescript` - TypeScript implementation (the behavioral reference)
- `afd-python` - Python implementation patterns
- `afd-rust` - Rust implementation patterns
- `afd-developer` - AFD methodology
