# afd-cpp

The C++20 implementation of [AFD (Agent-First Development)](../../README.md). It is being built in phases; see the [proposal](../../docs/features/proposed/cpp-support/proposal.md) and the [work plan](../../docs/features/proposed/cpp-support/work-plan.md).

> **Status: Phase 1.** The wire types (`CommandResult`, batch, pipeline and stream results) are in place and round-trip every `spec/wire` fixture. The registry and executors come in Phases 2 and 3. Do not depend on the package until `afd-cpp-v0.1.0`.

## Design in brief

- **Host-agnostic:** no dependency on any engine, framework or async runtime. Hosts build their own integration on the public API.
- **One runtime dependency:** [nlohmann/json](https://github.com/nlohmann/json), 3.11 or later. A host's own copy is used when `find_package(nlohmann_json)` finds one; otherwise 3.12.0 is downloaded and hash-verified.
- **Embeddable:** builds and passes its tests with exceptions and RTTI off, as a unity build, and with the common `min`/`max` and `check`/`verify`/`require` macros defined.
- **WebAssembly:** builds with Emscripten, and the tests run under Node.

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
- **Designated initializers.** Option structs are meant for partial designated initializers, such as `{.suggestion = "…"}`. Clang 21 and later, and newer GCC, warn about the omitted fields under `-Wextra`. afd-cpp turns that warning off for its own targets. In your own code you may want `-Wno-missing-designated-field-initializers` (Clang) or `-Wno-missing-field-initializers` (GCC).

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
| `noexcept-nortti` | `-fno-exceptions -fno-rtti`, unity build, macro-hygiene check (GCC or Clang) |
| `emscripten` | WebAssembly; configure with `emcmake cmake --preset emscripten`. Tests run under Node. |

Build trees go to `packages/cpp/build/<preset>/`, which git ignores. Set `CMAKE_GENERATOR=Ninja` for faster local builds.

## Options

| Option | Default | Effect |
|---|---|---|
| `AFD_BUILD_TESTS` | ON when top-level | Build the doctest suite |
| `AFD_WARNINGS_AS_ERRORS` | OFF (ON in presets) | `-Werror` or `/WX` |
| `AFD_USE_SYSTEM_JSON` | OFF | Require `nlohmann_json` from `find_package` instead of downloading it |
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
- Never name anything `check`, `verify` or `require`.

CI (`.github/workflows/cpp.yml`) runs every preset on Linux, macOS and Windows, plus Emscripten.
