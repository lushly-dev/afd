# Todo Backend - Python

Python implementation of the Todo commands, built on the repository's
[`afd` package](../../../../../python) (installed from source through a uv path
dependency, so it tests the code in this repo, not the PyPI release).

It is an MCP server over **stdio** with the same thirteen `todo-*` commands as the
TypeScript backend: the same titles, metadata, inputs, output shapes, error codes,
suggestions and undo, the same change history and the same approval hold on `todo-clear`.
Every command opts in to MCP with `expose=ExposeOptions(mcp=True)`, and both backends pass
the shared conformance suite in [`spec/`](../../spec).

## Quick Start

Requires [uv](https://docs.astral.sh/uv/) and Python 3.11+.

```bash
cd packages/examples/todo/backends/python
uv sync                  # creates .venv and installs the todo-server script
uv run todo-server       # MCP server on stdin/stdout
```

From `packages/examples/todo`, `pnpm dev:py` runs the same thing. `uv run python -m todo_backend`
is equivalent to `uv run todo-server`.

The server speaks MCP over stdio, so start it from an MCP client rather than a browser.
For example, in `.vscode/mcp.json`:

```jsonc
{
  "mcpServers": {
    "afd-todo-python": {
      "command": "uv",
      "args": ["run", "--project", "packages/examples/todo/backends/python", "todo-server"]
    }
  }
}
```

The web frontends call the TypeScript backend's HTTP endpoint (`/mcp` on port 3100),
which this backend does not serve. Use the TypeScript backend for the pages; it shares
this backend's database, so both show the same todos.

## Storage

By default the server keeps its todos in the **SQLite database**
`packages/examples/todo/data/todos.db`, the same file the TypeScript backend opens, so both
backends see the same todos, deleted todos and history (`src/todo_backend/store/sqlite.py`).

- It reads and writes the layout of `@lushly-dev/local-db`'s SQLite adapter, which the
  TypeScript store writes through, using the standard library's `sqlite3`: one `records`
  table keyed by table name and id, each value a record's JSON, `user_version` 1, WAL mode.
  A database with any other layout is refused, untouched.
- Each change is one transaction that reads the todo it changes inside it, so a delete or
  restore moves its todo all or nothing, and a change to a todo another process removed
  meanwhile reports it missing. Rows keep the order they were written in, so ties in a sort
  come out as in the TypeScript backend, and titles sort as JavaScript's `localeCompare` does
  (`src/todo_backend/collation.py`: base letters, then accents, then case).
- A history entry is numbered inside its write, so two Python servers never take the same
  number. The TypeScript store numbers it before its write, so when it records at the same
  moment as another process, one entry can replace the other
  ([#1317](https://github.com/lushly-dev/afd/issues/1317)).
- If SQLite fails mid-write (a full disk, an I/O error), the write is rolled back, the original
  error is reported, and a connection left inside a transaction is closed and reopened on the
  next call, as local-db's adapter does.
- `data/todos.db` is gitignored. When the default database is new, the store adds the todos
  in the committed seed `data/todos.seed.json`. To reset the data, delete `data/todos.db` and
  its `-wal` and `-shm` files.

`TODO_STORE_TYPE=file` keeps the todos in the JSON files the TypeScript backend's file store
also uses: the live todos in `data/todos.json` (seeded when missing), the deleted todos in
`todos.deleted.json` and the history in `todos.history.json` beside it. Each write is atomic
(a temporary file renamed over the old one), and a file that is not valid JSON stops the
server, and fails commands, with an error naming the file; it is never treated as empty.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `sqlite` | Storage type: `sqlite`, `file` or `memory` |
| `TODO_STORE_PATH` | `data/todos.db`, or `data/todos.json` for `file` (both seeded) | Path to the database or the JSON file. A custom path starts empty. |
| `APPROVALS` | `agents` | `agents` holds `todo-clear` for any caller that is not a person; `off` holds nothing |
| `TODO_APPROVAL_SECRET` | (random per process) | Key that signs approval tokens, at least 32 bytes; set it so several servers, in either language, accept each other's tokens. Each server keeps its own record of spent tokens, so one approval can run the clear once on each |
| `CONFIRMATIONS` | `off` | `enforce` or `require-human` to ask before `todo-clear` |
| `LOG_LEVEL` | `info` | `debug` logs each call's input and result |

### Examples

```bash
# Default: the SQLite database, shared with the TypeScript backend
uv run todo-server

# The JSON files instead
TODO_STORE_TYPE=file uv run todo-server

# In-memory storage (isolated per process)
TODO_STORE_TYPE=memory uv run todo-server

# Custom storage path
TODO_STORE_PATH=/path/to/todos.db uv run todo-server
```

## Commands

| Command             | Type     | Description                               |
| ------------------- | -------- | ----------------------------------------- |
| `todo-create`       | mutation | Create a new todo                         |
| `todo-list`         | query    | List todos with filtering and pagination, or the deleted ones with `deleted` |
| `todo-get`          | query    | Get a single todo by ID                   |
| `todo-update`       | mutation | Update todo fields                        |
| `todo-toggle`       | mutation | Toggle completion status                  |
| `todo-delete`       | mutation | Delete a todo; `todo-restore` brings it back |
| `todo-clear`        | mutation | Remove completed todos (or the deleted ones, or all) for good; held for approval unless a person calls it |
| `todo-stats`        | query    | Get todo statistics                       |
| `todo-create-batch` | mutation | Create multiple todos                     |
| `todo-delete-batch` | mutation | Delete multiple todos                     |
| `todo-toggle-batch` | mutation | Toggle multiple todos                     |
| `todo-restore`      | mutation | Bring deleted todos back as they were     |
| `todo-history`      | query    | Recent changes: who, when, and each change's undo |

Inputs, limits (titles are 1-200 characters, batches 1-100 items, `limit` 1-100) and
result shapes are defined in [`spec/commands.schema.json`](../../spec/commands.schema.json).
Each change's result names its undo in `undoCommand` and `undoArgs`, and the history
middleware (`src/todo_backend/history.py`) records each change with its actor's kind and id;
the example README's
[Undo, history and approvals](../../README.md#undo-history-and-approvals)
explains them.

### Approvals

`todo-clear` is held for any caller that is not a person, through `afd`'s
`create_approval_middleware`, with the TypeScript backend's summary of what would go ("Remove the
completed todos for good (2 todos now)"). `APPROVALS=agents` is the default, as in TypeScript.

Every MCP caller is an agent, so a clear over MCP is held. When the MCP client declares form
elicitation, the server asks its person (`relay="mcp-elicitation"`): the question names what would
go, the clear runs once the person approves, and a decline fails it with `APPROVAL_REQUIRED` and
`details.reason: "declined"`. Any other MCP caller gets `APPROVAL_REQUIRED` with a suggestion to
ask the person; no MCP call can carry the approval token (tool arguments never reach
`context.approval`). In process, trusted code retries with the token from the held result once a
person approved (`await server.execute("todo-clear", input, CommandContext(approval=token))`), and
a person (`CommandContext(actor=Actor(kind="human"))`) is never held.

## Tests

```bash
# Unit tests: commands, approvals, the stores and the TypeScript backend's jobs
uv run pytest

# Lint, with the repository's ruff rules
uv run ruff check src tests
uv run ruff format --check src tests

# Conformance: spawns todo-server and runs spec/ over MCP
pnpm --dir ../.. test:conformance:py
pnpm --dir ../.. test:conformance:py --suite confirmations
pnpm --dir ../.. test:conformance:py --suite approvals

# Both backends on one SQLite database, and a database either creates opened by the other
pnpm --dir ../.. test:interop
```

The tests use `afd.testing`'s assertions, and its scenario runner runs the TypeScript backend's
jobs (`backends/typescript/scenarios`) against this backend in-process on every store. Job 7
(replaying a journal) is skipped, since this backend records no journal, and job 9 is expected to
fail until `afd.testing` matches an expected array of objects item by item, as TypeScript's runner
does; `test_commands.py` covers its history instead. Job 10 (a command's `idempotency` in
`afd-help`) runs here too: the nine mutations each declare `natural` or `keyed`, as the
TypeScript backend's do, and the server answers a repeat of a `keyed` one that carries the same
idempotency key from an in-memory store.

The conformance runner starts the server with `TODO_STORE_TYPE=memory`, so it never touches
the data files. CI runs every suite above in `.github/workflows/conformance.yml`.
