# Todo Backend - Python

Python implementation of the Todo commands, built on the repository's
[`afd` package](../../../../../python) (installed from source through a uv path
dependency, so it tests the code in this repo, not the PyPI release).

It is an MCP server over **stdio** with the same eleven `todo-*` commands as the
TypeScript backend. Every command opts in to MCP with `expose=ExposeOptions(mcp=True)`,
and both backends pass the shared conformance suite in [`spec/`](../../spec).

## Quick Start

Requires [uv](https://docs.astral.sh/uv/) and Python 3.10+.

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

The web frontends call the TypeScript backend's HTTP endpoint (`/message` on port 3100),
which this backend does not serve. Use the TypeScript backend for the UI.

## Storage Configuration

By default the server uses **file-based storage** in `packages/examples/todo/data/todos.json`,
the same file as the TypeScript backend, so both backends see the same todos.

- `data/todos.json` is gitignored. When it is missing, it is created from the committed seed
  `data/todos.seed.json`. To reset the data, delete `data/todos.json`.
- Writes are atomic: the store writes a temporary file and renames it over `todos.json`.
- If `todos.json` is not valid JSON, the server refuses to start (and commands fail) with an
  error naming the file. It never treats an unreadable file as empty, so data is not erased.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `file` | Storage type: `file` or `memory` |
| `TODO_STORE_PATH` | `data/todos.json` (seeded) | JSON file path (file mode only). A custom path starts empty. |

### Examples

```bash
# Default: file storage, shared with the TypeScript backend
uv run todo-server

# In-memory storage (isolated per process)
TODO_STORE_TYPE=memory uv run todo-server

# Custom storage path
TODO_STORE_PATH=/path/to/todos.json uv run todo-server
```

## Commands

| Command             | Type     | Description                               |
| ------------------- | -------- | ----------------------------------------- |
| `todo-create`       | mutation | Create a new todo                         |
| `todo-list`         | query    | List todos with filtering and pagination  |
| `todo-get`          | query    | Get a single todo by ID                   |
| `todo-update`       | mutation | Update todo fields                        |
| `todo-toggle`       | mutation | Toggle completion status                  |
| `todo-delete`       | mutation | Delete a todo                             |
| `todo-clear`        | mutation | Clear completed todos (or all with `all`) |
| `todo-stats`        | query    | Get todo statistics                       |
| `todo-create-batch` | mutation | Create multiple todos                     |
| `todo-delete-batch` | mutation | Delete multiple todos                     |
| `todo-toggle-batch` | mutation | Toggle multiple todos                     |

Inputs, limits (titles are 1-200 characters, batches 1-100 items, `limit` 1-100) and
result shapes are defined in [`spec/commands.schema.json`](../../spec/commands.schema.json).

## Tests

```bash
# Unit tests (commands and file store)
uv run pytest

# Conformance: spawns todo-server and runs spec/test-cases.json over MCP
pnpm --dir ../.. test:conformance:py
```

The conformance runner starts the server with `TODO_STORE_TYPE=memory`, so it never
touches `data/todos.json`. CI runs both suites in `.github/workflows/conformance.yml`.
