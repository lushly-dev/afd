# Todo Backend - TypeScript

TypeScript implementation of the Todo API.

## Quick Start

```bash
pnpm install
pnpm start
```

Server runs at `http://localhost:3100`.

## Storage Configuration

By default, the server uses **file-based storage** (`packages/examples/todo/data/todos.json`) so that:
- MCP clients (stdio transport) share data with the HTTP server
- The UI and MCP tools see the same todos
- The TypeScript and Python backends share the same data

`data/todos.json` is gitignored. When it is missing, it is created from the committed seed
`data/todos.seed.json`; delete it to reset the data. Writes are atomic (a temporary file renamed
over `todos.json`), and a file that is not valid JSON stops the server with an error naming the
file instead of being treated as empty.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `file` | Storage type: `file` or `memory` |
| `TODO_STORE_PATH` | `data/todos.json` (seeded) | Path to JSON file (file mode only). A custom path starts empty. |
| `PORT` | `3100` | HTTP server port |
| `HOST` | `localhost` | HTTP server host |
| `TRANSPORT` | `auto` | Transport mode: `auto`, `http`, or `stdio` |
| `ALLOWED_ORIGINS` | (none) | Extra exact browser origins, comma-separated (`*` and `null` are refused) |
| `NODE_ENV` | | `development` accepts any browser origin and returns verbose errors |

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
| `todo-delete`      | mutation | Delete a todo             |
| `todo-clear`       | mutation | Clear all completed todos |
| `todo-stats`       | query    | Get todo statistics       |
| `todo-create-batch` | mutation | Create multiple todos     |
| `todo-delete-batch` | mutation | Delete multiple todos     |
| `todo-toggle-batch` | mutation | Toggle multiple todos     |

## Conformance

Run the unit tests and the conformance suite (the runner uses an in-memory store, so it never
touches `data/todos.json`):

```bash
pnpm test
pnpm --dir ../.. test:conformance:ts
```
