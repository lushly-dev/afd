# Todo Backend - TypeScript

TypeScript implementation of the Todo API.

## Quick Start

```bash
pnpm install
pnpm start
```

Server runs at `http://localhost:3100`.

## Storage Configuration

By default, the server uses **file-based storage** (`data/todos.json`) so that:
- MCP clients (stdio transport) share data with the HTTP server
- The UI and MCP tools see the same todos

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `file` | Storage type: `file` or `memory` |
| `TODO_STORE_PATH` | `./data/todos.json` | Path to JSON file (file mode only) |
| `PORT` | `3100` | HTTP server port |
| `HOST` | `localhost` | HTTP server host |
| `TRANSPORT` | `auto` | Transport mode: `auto`, `http`, or `stdio` |

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
| `todo-delete`      | mutation | Delete a todo             |
| `todo-clear`       | mutation | Clear all completed todos |
| `todo-stats`       | query    | Get todo statistics       |
| `todo-create-batch` | mutation | Create multiple todos     |
| `todo-delete-batch` | mutation | Delete multiple todos     |
| `todo-toggle-batch` | mutation | Toggle multiple todos     |

## Conformance

Run conformance tests:

```bash
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```
