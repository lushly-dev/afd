# Todo Example

Multi-stack implementation of a Todo application demonstrating **Agent-First Development (AFD)** patterns. This example features TypeScript, Python, Rust and C++ backends that are validated against a shared conformance test suite.

## Architecture

- **Spec-First**: All backends must comply with the [API Contract](./spec/test-cases.json).
- **Multi-Stack**: Identical functionality implemented in TypeScript, Python, Rust and C++.
- **MCP-Native**: Backends are Model Context Protocol (MCP) servers, ready for AI agents.
- **Thin UI**: Frontends are thin surfaces that invoke commands via MCP.
- **Shared Storage**: The TypeScript and Python backends use the same SQLite database, `data/todos.db`, by default (the Rust and C++ backends keep their data in memory).
- **Conformance in CI**: `.github/workflows/conformance.yml` runs the suite against all four backends.
- **Shared metadata**: [commands.schema.json](./spec/commands.schema.json) gives each command's
  `mutation`, `destructive`, `contexts` and `confirmPrompt`, and every backend's tests check that
  its definitions match.

This example is being brought up to date with current AFD; the plan and its progress are in
[docs/features/active/todo-reference](../../../docs/features/active/todo-reference/STATUS.md).

The TypeScript commands explicitly set `expose: { mcp: true }`. AFD commands are
private to external MCP clients by default, so every command intended for a remote
agent must opt in at its definition.

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
pnpm build
```

The Python backend also needs [uv](https://docs.astral.sh/uv/). It installs the repository's
`afd` package from `python/` on first run.

### 2. Run Conformance Tests

The conformance suite validates that a backend correctly implements the required commands and logic.

**TypeScript Backend:**

```bash
pnpm test:conformance:ts
```

**Python Backend:**

```bash
pnpm test:conformance:py
```

**Rust Backend** (needs a Rust toolchain; `backends/rust/rust-toolchain.toml` pins it):

```bash
pnpm test:conformance:rs
```

**C++ Backend** (needs CMake 3.25+ and a C++20 compiler; see [backends/cpp](./backends/cpp/README.md)):

```bash
pnpm test:conformance:cpp
```

The runner spawns every backend over stdio, the TypeScript and Python ones with
`TODO_STORE_TYPE=memory` (the Rust backend through `cargo run -- stdio`). It runs every
case in [spec/test-cases.json](./spec/test-cases.json) that the backend's language implements and
exits non-zero if any case fails. The TypeScript, Python and Rust backends also have an approval
suite (`pnpm test:conformance:ts --suite approvals`, and `:py`, `:rs`), the TypeScript backend a run of AFD's
own `validate --surface --strict` and `scenario run` against it (`pnpm test:scenarios:ts`), and
`pnpm test:interop` runs both side by side on one SQLite database, each reading what the other
wrote, and has each create a new database the other then opens; the
[spec README](./spec/README.md) explains each.

### 3. Start a Backend (Manual)

**TypeScript:**

```bash
cd backends/typescript
pnpm dev
```

**Python** (MCP over stdio, for MCP clients; the web frontends need the TypeScript backend):

```bash
uv run --project backends/python todo-server
```

### 4. Start a Frontend

**The page, on FAST-AF and violet-elements** (`frontends/fast-af`, http://localhost:5173):

```bash
pnpm dev:ts      # the TypeScript backend on http://localhost:3100
pnpm dev:web     # the page
```

`?backend=http://host:port` points the page at another backend.

**The same page in React 19** (`frontends/react`, http://localhost:5174), on the same elements and
shared modules:

```bash
pnpm dev:ts
pnpm dev:react
```

## Storage Configuration

The TypeScript and Python backends keep their todos in a SQLite database by default, and also
offer the JSON files or memory (the Rust and C++ backends are in-memory only):

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `sqlite` | `sqlite` for the shared database, `file` for the shared JSON files, `memory` for isolated in-memory |
| `TODO_STORE_PATH` | `data/todos.db` | Path to the database, or to the JSON file (default `data/todos.json`). A custom path starts empty. |

Both backends resolve the same default, `data/todos.db`, and read and write it in the layout of
`@lushly-dev/local-db`'s SQLite adapter: TypeScript through that adapter, Python through the
standard library's `sqlite3`. The live todos, the deleted todos and the change history are in it,
each change is one transaction, and several processes in either language can use it at once.
When the default database is new, the stores add the todos in the committed seed
`data/todos.seed.json`; delete `data/todos.db` (and its `-wal` and `-shm` files) to reset.
Both list titles in the same order, as JavaScript's `localeCompare` sorts them.

One known limit: the TypeScript store numbers a history entry before the write that records it,
so when it and another process record a change at the same moment, both can take the same
number and one entry replaces the other
([#1317](https://github.com/lushly-dev/afd/issues/1317)). The todos themselves are not affected,
and two Python servers do not collide, since Python numbers the entry inside its write.

With `TODO_STORE_TYPE=file`, the live todos are in `data/todos.json`, the deleted todos in
`data/todos.deleted.json` and the change history in `data/todos.history.json` beside it, which
both backends also share. Each file's write is atomic (temporary file + rename), and a file that is
not valid JSON is reported as an error instead of being treated as empty.

Every data file is gitignored, so running the example does not change the working tree. Shared
storage means MCP clients over stdio and the HTTP server, in either language, see the same todos.

## Frontend Features

The page, in FAST-AF (`frontends/fast-af`) and in React (`frontends/react`), is a thin surface:
every action is a backend command over MCP on `/mcp` (Streamable HTTP), and everything it shows
comes from those commands' results. Its state and actions, the elements it registers, its theme
and its styles live in plain modules (`frontends/shared`), so the two frontends differ only in how
they render, and one browser suite (`frontends/shared/test/page-suite.ts`) runs against both.

- **Trust:** the last result's confidence (`violet-progress`), reasoning, warnings, sources and
  alternatives, and the undo it names.
- **Undo:** after each change, a `violet-snackbar` offers Undo, which runs the `undoCommand` and
  `undoArgs` the result named. Deleted todos have their own list, with Restore.
- **Approvals in the page:** the page's MCP client declares form elicitation, so when the server
  holds `todo-clear` for a person, it asks the page, which shows a `violet-approval-card` and
  answers with the person's choice. Denying keeps everything and shows the error's suggestion.
- **Errors:** a `violet-alert` with the code, the message, the suggestion and Retry when the
  error is retryable.
- **Recent changes:** `todo-history`, with Undo on each change still the latest to its todos.
- **Command log:** every command the page ran, with its input and result
  (`violet-tool-call-card`).
- **Other clients:** the page polls `todo-history` every 3 seconds and says when another client
  changed the todos. Without sign-in, the server counts every page and MCP client as an agent.
- **View state an agent can drive:** the filter (status, priority, search) is view state
  (`@lushly-dev/afd-view-state`), served in the page as `view-state-get` and `view-state-set` on
  `todo-filter`. A person's filter controls and an agent's commands change the same state, and
  the list follows (job 6). Phase 4's in-page copilot calls them.

`pnpm test:page` builds the backend and both frontends and runs the suite on each in Chromium
against the backend: add (with the button and with Enter), undo, a clear approved and one denied
in the page, an agent narrowing the view, and axe.

## Mix and Match

The page talks MCP on `/mcp`, so it works with a backend that serves Streamable HTTP. It is
tested against the TypeScript backend. Approvals in the page need MCP 2026-07-28, which the
page negotiates with it: a 2025-era HTTP request cannot carry the server's question, so against
such a backend a held clear stays `APPROVAL_REQUIRED`. The Rust backend serves the same commands
on `/mcp`, so the page should work against it too; that pairing is not tested yet.

| Backend    | Frontend | Command                          |
| ---------- | -------- | -------------------------------- |
| TypeScript | FAST-AF  | `pnpm dev:ts` + `pnpm dev:web`   |
| TypeScript | React    | `pnpm dev:ts` + `pnpm dev:react` |

Both frontends talk MCP on `/mcp`; neither uses the deprecated `/message` lane. The TypeScript
and Rust backends accept browser requests from the dev frontends' origins (`http://localhost:3000`, `http://localhost:5173` and
`5174`, also on `127.0.0.1`) and refuse other origins with 403; add yours with
`ALLOWED_ORIGINS`. The Python backend is a stdio MCP server without that HTTP endpoint, so use it
from an MCP client (see below) and the conformance suite rather than the web frontends.

## VS Code MCP Configuration

All four backends can be configured as MCP servers in VS Code. Edit `.vscode/mcp.json`:

```jsonc
{
  "mcpServers": {
    // TypeScript backend (stdio transport - auto-starts)
    "afd-todo-ts": {
      "command": "node",
      "args": ["packages/examples/todo/backends/typescript/dist/server.js"],
      "disabled": false
    },
    
    // Python backend (stdio transport - auto-starts)
    "afd-todo-python": {
      "command": "uv",
      "args": ["run", "--project", "packages/examples/todo/backends/python", "todo-server"],
      "disabled": true
    },
    
    // C++ backend (stdio transport - build it first: pnpm test:conformance:cpp)
    "afd-todo-cpp": {
      "command": "packages/examples/todo/backends/cpp/build/release/todo-server-cpp",
      "disabled": true
    },

    // Rust backend (stdio transport - auto-starts; cargo builds it on first use)
    "afd-todo-rust": {
      "command": "cargo",
      "args": ["run", "--quiet", "--manifest-path", "packages/examples/todo/backends/rust/Cargo.toml", "--", "stdio"],
      "disabled": true
    }
  }
}
```

### Transport Differences

| Backend | Transport | Auto-Start | Notes |
|---------|-----------|------------|-------|
| TypeScript | stdio | ✅ Yes | VS Code spawns the process |
| Python | stdio | ✅ Yes | VS Code spawns the process |
| C++ | stdio | ✅ Yes | VS Code spawns the built binary |
| Rust | stdio, or HTTP (`POST /mcp`) | ✅ Yes (stdio) | `cargo run` spawns it; for HTTP, start `cargo run -- server` first |

### Switching Backends

1. **Enable ONE backend** - Set `"disabled": false` for the desired backend
2. **Disable others** - Set `"disabled": true` (they share the same tool names)
3. **Reload VS Code** - Or use Command Palette → "MCP: Restart Servers"

### Rust Backend over HTTP

The Rust backend also serves Streamable HTTP. To use that instead of stdio, start the server and
point the entry at it (`"type": "http", "url": "http://127.0.0.1:3100/mcp"`):

```bash
cd packages/examples/todo/backends/rust
cargo run --release -- server
# Server runs on http://127.0.0.1:3100
```

## API Contract

The source of truth for this example is the [test-cases.json](./spec/test-cases.json) file, which defines the expected inputs, outputs, and state transitions for all commands. [commands.schema.json](./spec/commands.schema.json) documents each command's input and result shape, and gives each command's metadata. The test suites of all four backends check that it lists exactly the commands each backend defines, with the same metadata.

## Commands

| Command | Description | Contexts | Destructive |
|---------|-------------|----------|-------------|
| `todo-create` | Create a new todo | editing | |
| `todo-list` | List todos with filtering/pagination | reading, editing | |
| `todo-get` | Get a single todo by ID | reading, editing | |
| `todo-update` | Update a todo's properties | editing | |
| `todo-toggle` | Toggle completion status | editing | |
| `todo-delete` | Delete a todo, kept for `todo-restore` | editing | Yes |
| `todo-clear` | Clear completed todos for good (asks for confirmation when the server enforces it, and is held for approval) | editing | Yes |
| `todo-stats` | Get statistics | reading, editing | |
| `todo-create-batch` | Create multiple todos | editing | |
| `todo-toggle-batch` | Toggle multiple todos | editing | |
| `todo-delete-batch` | Delete multiple todos, kept for `todo-restore` | editing | Yes |
| `todo-restore` | Bring deleted todos back as they were | editing | |
| `todo-history` | Recent changes: who, when, and each change's undo | reading, editing | |

`todo-restore` and `todo-history` came to TypeScript with the
[to-do reference plan](../../../docs/features/active/todo-reference/todo-reference.proposal.md)'s
phase 2, and to the other three backends in phase 5. Every backend implements all 13 commands.

### Undo, history and approvals

Every change says how to take it back. Its result carries `undoCommand` and `undoArgs`: run that
command with those arguments, through `afd-call` or the `todo` group tool, since `undoCommand` names
a command, not a tool (the C++ server lists each command as its own tool, so there it is the tool's
name too). Toggling and editing undo with `todo-update`; creating with `todo-delete`;
deleting with `todo-restore`. A delete keeps the todo out of every list but
`todo-list { deleted: true }` until `todo-clear { deleted: true }` or `{ all: true }` removes it,
so a todo deleted by mistake can be found and restored long after.

`todo-history` lists recent changes, newest first, with the actor that made each one (`human`,
`agent` and so on, from the command context), the time and its undo. An entry offers its undo only
while it is the latest change to its todos, so undoing an old entry never overwrites a later edit.
A middleware records each change from its result (`src/history.ts`, and `history.py` in
Python); in Rust and C++ the wrapper around every command does (`src/commands/mod.rs`,
`src/commands/shared.cpp`), so the Umbel plugin, which registers the Rust commands in a registry
of its own, keeps the history too. The latest 1,000 are kept.

`todo-clear` is the one change nothing undoes, so a caller that is not a person waits for a person
to approve it (`createApprovalMiddleware`, `create_approval_middleware` in Python, Rust and C++).
Against every backend, an MCP client that declares form elicitation asks its person; any other
caller gets `APPROVAL_REQUIRED` with a suggestion naming what would go. Over MCP every caller
counts as an agent, so the page's "clear completed" is held too: the page shows the approval and
answers with the person's choice, in both frontends.

The Rust and C++ command lines (`cargo run -- todo-clear '{}'` and the shell,
`todo-server-cpp todo-clear '{}'`) run as the person at the terminal, so a clear there is not
held. Under Umbel the clear is not held either: a plugin
manifest declares only a fixed approval, so the todo plugin drops the per-caller policy and the
clear keeps its confirmation prompt ([#1329](https://github.com/lushly-dev/afd/issues/1329)).
`todo-clear`'s description says both: held for approval where the server holds clears, gated by
its confirmation prompt elsewhere.

Run a server with `APPROVALS=off` to hold nothing; the conformance runner does, since the shared
suites reset each case with a clear. `TODO_APPROVAL_SECRET` (at least 32 bytes) lets
several servers, in any of the four languages, accept each other's approval tokens. Each server keeps its own record of spent tokens, so with a shared secret one approval can run the clear once on each server that receives it.

### Contexts

The TypeScript, Python and Rust servers configure two contexts, so an agent can scope itself
before it works:

- `todo-reading` shows only `todo-list`, `todo-get`, `todo-stats` and `todo-history`. A command
  that changes todos
  is refused with `COMMAND_NOT_IN_CONTEXT` and a suggestion.
- `todo-editing` shows every command.

With no context entered every command is visible. `afd-context-list`, `afd-context-enter` and
`afd-context-exit` manage them; on the stateless `/mcp` endpoint a request names its context in
`_meta["dev.afd/context"]` instead. The C++ backend declares each command's contexts but does
not serve them: the library's `afd::mcp_stdio` has no context tools yet
([#1425](https://github.com/lushly-dev/afd/issues/1425)).

Clients that never enter a context are unaffected, with three visible differences: `tools/list`
includes the three context tools (in the `bootstrap` group under the TypeScript server's default
grouped strategy), `initialize` on the deprecated `/message` lane returns an `Mcp-Session-Id`
header that carries the session's context, and `/mcp` marks `tools/list` stale at once
(`ttlMs: 0`) because its answer depends on the request's context.

## Performance Features

This example demonstrates two levels of batching:

### Domain-Level Batch Commands

The todo app exposes batch operations as dedicated commands:

```bash
# Create multiple todos at once
afd call todo-create-batch '{"todos": [{"title": "Task 1"}, {"title": "Task 2"}]}'

# Toggle multiple todos
afd call todo-toggle-batch '{"ids": ["id1", "id2"]}'

# Delete multiple todos
afd call todo-delete-batch '{"ids": ["id1", "id2"]}'
```

These return partial success semantics with confidence scores based on success rate.

### Transport-Level Batching (`@lushly-dev/afd-core`)

For calling multiple different commands in a single roundtrip, use the `afd-batch` tool:

```bash
# Execute multiple different commands in one request
afd batch '[{"command":"todo-create","input":{"title":"Task 1"}},{"command":"todo-list","input":{}},{"command":"todo-stats","input":{}}]'
```

Or via the client SDK:

```typescript
import { McpClient } from '@lushly-dev/afd-client';

const client = new McpClient({ url: 'http://localhost:3100/mcp' });
await client.connect();

const result = await client.batch(
  [
    { command: 'todo-create', input: { title: 'Task 1' } },
    { command: 'todo-create', input: { title: 'Task 2' } },
    { command: 'todo-list', input: {} }
  ],
  { stopOnError: false }
);

console.log(result.summary); // { total: 3, successCount: 3, failureCount: 0, skippedCount: 0 }
console.log(result.confidence); // Aggregated confidence score
```

### Streaming

No todo command is long-running, so this example does not stream. The server's `/stream`
endpoint runs a command to completion and then sends its result as `data` chunks and a
`complete` chunk; it sends no `progress` chunks (see the `@lushly-dev/afd-server` README,
"Streaming").
