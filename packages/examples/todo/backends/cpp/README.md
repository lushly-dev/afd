# Todo backend (C++)

The todo example on [afd-cpp](../../../../cpp/README.md). It is a stdio MCP server that passes the
shared conformance, confirmation and approval suites, like the TypeScript, Python and Rust
backends.

- **One contract:**
  - The 13 commands mirror the TypeScript backend: the same titles, descriptions, tags,
    examples, output schemas, error codes, messages, suggestions, reasoning, warnings and undo.
  - Each declares its whole input schema, which the registry validates and the MCP server
    advertises. A test checks that each is [`spec/commands.schema.json`](../../spec/commands.schema.json)'s,
    descriptions aside, and that the commands and their metadata are exactly the contract's.
  - Ids are TypeScript's (`todo-<ms>-<7 base-36 digits>`), from the command context's clock and
    random, so a seeded random gives the same ids in every language.
- **Undo and history:**
  - A delete keeps the todo with the deleted todos (`todo-list { deleted: true }`) until
    `todo-clear { deleted: true }` or `{ all: true }`; `todo-restore` brings it back as it was.
  - Each result names its undo (`undoCommand`, `undoArgs`).
  - The wrapper every command gets (`src/commands/shared.cpp`) records each successful change,
    with its actor, time, todos and undo, for `todo-history`. A change and its entry run under one
    store lock, so entries keep the changes' order. The latest 1,000 are kept.
  - The store is in memory only.
- **Approvals:** `APPROVALS` (`agents` by default, or `off`) holds `todo-clear` for any caller
  that is not a person, through the library's approval middleware.
  - Over MCP the server asks the person behind a client that declares form elicitation
    (`ApprovalRelay::mcp_elicitation`), with a summary of what would go. Any other client gets
    `APPROVAL_REQUIRED` and no token.
  - `TODO_APPROVAL_SECRET` (at least 32 bytes) signs the tokens, so several servers accept each
    other's; unset, each process makes a random key. Each process keeps its own spent tokens.
  - The command form below runs as the person at the terminal, so a clear there is not held.
- **Transport:**
  - The library's opt-in [`afd::mcp_stdio`](../../../../cpp/README.md#mcp-over-stdio) target serves the commands over stdio in both MCP eras. The backend's CMake turns it on.
  - `CONFIRMATIONS` (`off` by default, `enforce` or `require-human`) sets confirmation enforcement for `todo-clear`, as on the other backends. With `require-human`, or a client that can elicit, the person is asked: in band on a 2025 connection, as `input_required` on MCP 2026-07-28.

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

The command form exits with 1 when the command fails, and 2 for an unknown command, invalid JSON
or an invalid setting.

## Conformance

From `packages/examples/todo`:

```bash
pnpm test:conformance:cpp
pnpm test:conformance:cpp --suite confirmations   # CONFIRMATIONS=enforce, every client kind
pnpm test:conformance:cpp --suite approvals       # APPROVALS=agents, every client kind
```

Add `--mode modern` for MCP 2026-07-28.

## Contexts

The server serves TypeScript's two contexts (`todo_contexts()` in `src/app.cpp`, after
`src/contexts.ts`) with `afd-context-list`, `afd-context-enter` and `afd-context-exit`.
`todo-reading` shows the commands that read (list, get, stats and history); `todo-editing`, and no
context at all, show every command. A 2025 client enters a context for its connection; a
2026-07-28 client names it on each request in `_meta["dev.afd/context"]`. A call outside the
active context fails with `COMMAND_NOT_IN_CONTEXT`.

## Known differences from the TypeScript backend

- **Title sort order** compares case-insensitively and then by code unit. TypeScript's `localeCompare` is locale-aware. The two agree for ASCII titles that differ in more than case.
- **`todo-list` search** lowercases ASCII only.
- **The tool list** has one tool per command, the context tools among them. The library's
  `afd::mcp_stdio` has no meta-tools (`afd-call`, `afd-batch`, `afd-pipe`), bootstrap commands
  or grouped tool strategy yet ([#1451](https://github.com/lushly-dev/afd/issues/1451)).
- **Validation messages** come from the library's validator, not TypeScript's custom zod texts
  (`"Too small: expected string to have >=1 characters"` where TypeScript says `"Todo ID is
  required"`), and `expectedFields` is in alphabetical order. An `offset` beyond 2^53 - 1 is
  clamped to it, where TypeScript refuses it.
- **No journal:** TypeScript records sessions for `afd replay`; this backend, like Python and
  Rust, does not.
