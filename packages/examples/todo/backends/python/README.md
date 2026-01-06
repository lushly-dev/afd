# Todo Backend - Python

Python implementation of the Todo API using FastMCP.

## Quick Start

```bash
pip install -r requirements.txt
python server.py
```

Server runs at `http://localhost:3101`.

## Storage Configuration

By default, the server uses **file-based storage** (`../data/todos.json`) so that:
- MCP clients (stdio transport) share data with the HTTP server
- The UI and MCP tools see the same todos
- **Both TypeScript and Python backends share the same data file**

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TODO_STORE_TYPE` | `file` | Storage type: `file` or `memory` |
| `TODO_STORE_PATH` | `../data/todos.json` | Path to JSON file (file mode only) |

### Examples

```bash
# Default: file storage, shared with TypeScript backend
python server.py

# Use in-memory storage (isolated per process)
TODO_STORE_TYPE=memory python server.py

# Custom storage path
TODO_STORE_PATH=/path/to/todos.json python server.py
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
| `todo-createBatch` | mutation | Create multiple todos     |
| `todo-deleteBatch` | mutation | Delete multiple todos     |
| `todo-toggleBatch` | mutation | Toggle multiple todos     |

## Conformance

Run conformance tests:

```bash
BACKEND_URL=http://localhost:3101 pnpm example:todo:test
```
