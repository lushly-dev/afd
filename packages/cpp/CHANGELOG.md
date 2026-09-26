# Changelog

All notable changes to afd-cpp are documented here. The package is versioned independently of the npm packages (proposal D11) and is released with tags of the form `afd-cpp-vX.Y.Z`.

## Unreleased

### Added

- The CMake package skeleton: the `afd::afd` target, a generated `afd/version.hpp`, and the `afd::Json` alias for `nlohmann::json`.
- Pinned and hash-verified dependencies: nlohmann/json 3.12.0, and doctest 2.5.3 for tests only.
- Presets for `dev`, `release`, `asan`, `noexcept-nortti` and `emscripten`.
- The `cpp.yml` workflow: clang-format; builds on Linux GCC, Linux Clang with ASan and UBSan, no exceptions or RTTI with a unity build and the macro-hygiene check, macOS, and Windows MSVC; and Emscripten, with tests run under Node.
