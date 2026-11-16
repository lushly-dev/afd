# Todo Backend - TypeScript

TypeScript implementation of the Todo API.

## Quick Start

```bash
pnpm install
pnpm start
```

From a terminal the server listens on `http://localhost:3100`, with MCP at `/mcp`
(`afd connect http://localhost:3100/mcp`). When its standard input is not a terminal, as when an
MCP client spawns it, it speaks MCP over stdio instead. `TRANSPORT=http` or `TRANSPORT=stdio`
forces one.

## Storage Configuration

By default, the server uses **file-based storage** (`packages/examples/todo/data/todos.json`) so that:
- MCP clients (stdio transport) share data with the HTTP server
- The UI and MCP tools see the same todos
- The TypeScript and Python backends share the same data

`data/todos.json` is gitignored. When it is missing, it is created from the committed seed
`data/todos.seed.json`; delete it to reset the data. Deleted todos and the change history are kept
beside it in `todos.deleted.json` and `todos.history.json` (also gitignored), so the Python
backend, which shares `todos.json`, never sees a deleted todo as live. Each file's write is atomic,
but they are separate writes; the planned move to SQLite replaces them with one transaction. Writes are atomic (a temporary file renamed
over `todos.json`), and a file that is not valid JSON stops the server with an error naming the
file instead of being treated as empty.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `file` | Storage type: `file`, `memory` or `sqlite` |
| `TODO_STORE_PATH` | `data/todos.json` (seeded), or `data/todos.db` | Path to the JSON file or the SQLite database. A custom path starts empty. |
| `PORT` | `3100` | HTTP server port |
| `HOST` | `localhost` | HTTP server host |
| `TRANSPORT` | `auto` | Transport mode: `auto`, `http`, or `stdio` |
| `ALLOWED_ORIGINS` | (none) | Extra exact browser origins, comma-separated (`*` and `null` are refused) |
| `NODE_ENV` | | `development` accepts any browser origin and returns verbose errors |
| `APPROVALS` | `agents` | `agents` holds `todo-clear` for any caller that is not a person; `off` holds nothing |
| `TODO_APPROVAL_SECRET` | (random per process) | Key that signs approval tokens, at least 32 bytes; set it so several processes accept each other's tokens |
| `CONFIRMATIONS` | `off` | `enforce` or `require-human` to ask before `todo-clear` |
| `TODO_JOURNAL` | (none) | Path of a JSON Lines file to record every call to, for `afd replay` |
| `LOG_LEVEL` | `info` | `debug` logs each call's input and result |

### Browser access

Browsers may call the server from the dev frontends in the
[todo README](../../README.md): `pnpm dev:web` (`http://localhost:3000`) and the
Vite dev servers (`http://localhost:5173`, and `5174` when both frontends run),
on `localhost` or `127.0.0.1`. Any other page gets `403 Origin is not allowed`;
add its exact origin to `ALLOWED_ORIGINS`. The list is built in
`src/server-options.ts` and tested in `src/server-options.test.ts`.

### Examples

```bash
# Default: file storage, shared between MCP and HTTP
pnpm start

# Use in-memory storage (isolated per process)
TODO_STORE_TYPE=memory pnpm start

# Custom storage path
TODO_STORE_PATH=/path/to/todos.json pnpm start
```

## Commands

| Command            | Type     | Description               |
| ------------------ | -------- | ------------------------- |
| `todo-create`      | mutation | Create a new todo         |
| `todo-list`        | query    | List todos with filtering |
| `todo-get`         | query    | Get a single todo by ID   |
| `todo-update`      | mutation | Update todo fields        |
| `todo-toggle`      | mutation | Toggle completion status  |
| `todo-delete`      | mutation | Delete a todo; `todo-restore` brings it back |
| `todo-clear`       | mutation | Remove completed todos (or deleted ones, or all) for good; held for approval unless a person calls it |
| `todo-stats`       | query    | Get todo statistics       |
| `todo-create-batch` | mutation | Create multiple todos     |
| `todo-delete-batch` | mutation | Delete multiple todos     |
| `todo-toggle-batch` | mutation | Toggle multiple todos     |
| `todo-restore`     | mutation | Bring deleted todos back as they were |
| `todo-history`     | query    | Recent changes: who, when, and each change's undo |

Each change's result names its undo in `undoCommand` and `undoArgs`; the example README's
[Undo, history and approvals](../../README.md#undo-history-and-approvals-typescript) explains them.

### SQLite storage

`TODO_STORE_TYPE=sqlite` keeps the todos, the deleted todos and the history in one SQLite
database (`data/todos.db`, gitignored) through `@lushly-dev/local-db`'s adapter on `node:sqlite`
(`src/store/sqlite.ts`). Each write is one transaction, so a delete or restore moves its todo
between the live and deleted tables all or nothing, and a write to a todo another process removed
since it was read rolls back and reports the todo missing. Several processes can share the file.
The history entry for a change is a separate write after it. Filtering, sorting (ties included)
and undo are the in-memory store's rules; the backend's tests run every job against both the
in-memory and the SQLite store. A path that cannot hold a database fails at startup.

The JSON file stays the default until the Python backend reads the same database (the to-do
reference plan's phase 5); until then only the file store is shared with Python.

## Recording and replaying a session

`TODO_JOURNAL` records every call that gets past the approval hold (failures included, held calls
not, approved ones once approved) with the clock and random values it read, through
`createJournalMiddleware`. `afd replay` runs the file again against a fresh in-memory store from
`src/registry.ts`, with the same middleware but no approval hold (each recorded call already got
past it), and reports, per call, whether the result is the same:

```bash
pnpm -F "@lushly-dev/afd-cli..." build    # once, from the repository root: the afd CLI
pnpm build
TODO_JOURNAL=session.jsonl TODO_STORE_TYPE=memory TRANSPORT=http pnpm start
# in another terminal, make some calls, then stop the server:
node ../../../../cli/dist/bin.js connect http://localhost:3100/mcp
node ../../../../cli/dist/bin.js call todo-create '{"title":"Recorded"}'
# replay:
node ../../../../cli/dist/bin.js replay session.jsonl --module dist/registry.js
```

Replay starts from an empty store, so record from an empty one (`TODO_STORE_TYPE=memory`): a
session that reads todos it did not create diverges at the first such read. Loading the replay
module touches no data file. Ids and times come
from the command context's random and clock, which the journal records, so they replay exactly.
`src/replay.test.ts` records job 7 this way and replays it.

The middleware runs in this order: `defaultMiddleware()` (a trace id, logging, a slow-call
warning), the approval hold, the journal, then the change history (`src/server-options.ts`).

## Jobs

`scenarios/` holds the jobs built so far, one scenario file each, from the
[to-do reference plan](../../../../../docs/features/active/todo-reference/todo-reference.proposal.md#phase-2-jobs).
`src/scenarios.test.ts` runs them in-process through the server's own middleware, with a fixed
clock and seeded random, as part of `pnpm test`. `src/surface.test.ts` runs AFD's strict surface
validation over the commands and checks each declares a title, an output, an example and, when it
changes todos, an approval policy.

## Conformance

Run the unit tests and the conformance suite (the runner uses an in-memory store, so it never
touches `data/todos.json`):

```bash
pnpm test
pnpm --dir ../.. test:conformance:ts
```
