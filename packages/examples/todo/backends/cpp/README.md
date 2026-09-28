# Todo backend (C++)

The todo example on [afd-cpp](../../../../cpp/README.md). It is a stdio MCP server that passes the shared
conformance suite, like the TypeScript, Python and Rust backends.

- **One contract:**
  - It validates every input against [`spec/commands.schema.json`](../../spec/commands.schema.json), embedded at build time, rather than a hand-written copy.
  - A test checks that the registered commands are exactly the ones the contract lists.
- **The same product:**
  - The 11 commands reproduce the TypeScript backend's data, error codes, messages, suggestions, reasoning and warnings.
  - The store is in memory only.
- **Transport:**
  - `src/mcp_stdio.cpp` implements newline-delimited JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`.
  - Unknown tools and invalid arguments come back as `CommandResult`s with `isError: true`, never as JSON-RPC errors.
  - Lines are capped at 1 MiB.
  - The transport lives here, not in the library (proposal D10).

## Build and run

This needs CMake 3.25+ and a C++20 compiler. Dependencies come through the library's pinned CMake
setup.

```bash
cd packages/examples/todo/backends/cpp
cmake --preset release
cmake --build --preset release
ctest --preset release

./build/release/todo-server-cpp                                  # stdio MCP server
./build/release/todo-server-cpp list-commands
./build/release/todo-server-cpp todo-create '{"title": "Buy milk"}'
```

The command form exits with 1 when the command fails, and 2 for an unknown command or invalid JSON.

## Conformance

From `packages/examples/todo`:

```bash
pnpm test:conformance:cpp
```

## Known differences from the TypeScript backend

- **Title sort order** compares case-insensitively and then by code unit. TypeScript's `localeCompare` is locale-aware. The two agree for ASCII titles that differ in more than case.
- **`todo-list` search** lowercases ASCII only.
