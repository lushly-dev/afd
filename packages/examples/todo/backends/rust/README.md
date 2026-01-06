# Rust Todo Backend

High-performance Rust implementation of the AFD Todo backend using Axum.

## Features

- **MCP Protocol**: Full JSON-RPC 2.0 implementation over HTTP
- **SSE Transport**: Server-Sent Events for real-time updates
- **In-Memory Storage**: Fast DashMap-based concurrent storage
- **CLI Mode**: Execute commands directly from terminal

## Quick Start

### Build

```bash
cargo build --release
```

### Run Server

```bash
cargo run --release -- server
# Server starts on http://127.0.0.1:3100
```

### CLI Mode

```bash
# List todos
cargo run -- todo-list

# Create a todo
cargo run -- todo-create --title "Buy groceries"

# Toggle completion
cargo run -- todo-toggle --id <todo-id>
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/message` | POST | MCP JSON-RPC endpoint |
| `/sse` | GET | SSE transport for MCP clients |

## MCP Commands

All commands use hyphen format (`todo-create`, not `todo.create`):

| Command | Description |
|---------|-------------|
| `todo-create` | Create a new todo |
| `todo-list` | List todos with filtering |
| `todo-get` | Get a single todo by ID |
| `todo-update` | Update a todo's properties |
| `todo-toggle` | Toggle completion status |
| `todo-delete` | Delete a todo |
| `todo-clear` | Clear completed todos |
| `todo-stats` | Get statistics |

## VS Code MCP Integration

The Rust backend uses HTTP/SSE transport (not stdio), so it requires manual server startup.

### Configuration

Add to `.vscode/mcp.json`:

```jsonc
{
  "mcpServers": {
    "afd-todo-rust": {
      "url": "http://127.0.0.1:3100/sse",
      "disabled": false
    }
  }
}
```

### Usage

1. **Start the server**: `cargo run --release -- server`
2. **Enable in mcp.json**: Set `"disabled": false`
3. **Reload VS Code**: Command Palette → "MCP: Restart Servers"
4. **Use MCP tools**: `todo-create`, `todo-list`, etc.

## Testing with curl

```bash
# Health check
curl http://127.0.0.1:3100/health

# Create todo via MCP
curl -X POST http://127.0.0.1:3100/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":"Test todo"}}}'

# List todos via MCP
curl -X POST http://127.0.0.1:3100/message \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"todo-list","arguments":{}}}'
```

## Storage

Currently uses **in-memory storage** (DashMap). Data is lost when the server restarts.

> **Note**: Unlike TypeScript/Python backends which use file-based storage, the Rust backend does not persist data. This is intentional for performance testing but means Rust data is isolated from other backends.

## Architecture

```
src/
├── main.rs          # Entry point, CLI parsing
├── server.rs        # Axum HTTP server setup
├── types.rs         # Todo, CommandResult types
├── store.rs         # In-memory storage (DashMap)
├── registry.rs      # Command registry
└── commands/
    ├── mod.rs       # Command registration
    ├── create.rs    # todo-create
    ├── list.rs      # todo-list
    ├── get.rs       # todo-get
    ├── update.rs    # todo-update
    ├── toggle.rs    # todo-toggle
    ├── delete.rs    # todo-delete
    ├── clear.rs     # todo-clear
    └── stats.rs     # todo-stats
```
