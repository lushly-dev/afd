# Rust Todo Backend

Rust implementation of the AFD todo backend, built on the `afd` crate and Axum.
It implements all eleven commands of [`spec/commands.schema.json`](../../spec/commands.schema.json)
and passes the shared conformance suite (`pnpm test:conformance:rs`).

## What it is

- **MCP over HTTP**: `POST /mcp` (and `POST /message`, which the web frontends use)
  takes one JSON-RPC 2.0 message and answers with `application/json`. It supports
  `initialize`, `ping`, `tools/list` and `tools/call`: the subset of the MCP
  Streamable HTTP transport that tool clients need. There is no SSE stream
  (`GET /mcp` answers 405, which MCP clients accept), no stdio transport and no
  session state.
- **CLI and shell**: run one command, or an interactive shell.
- **In-memory storage**: data lasts until the process exits and is not shared with
  the TypeScript and Python backends' `data/todos.json`.

## Quick start

```bash
cargo run --release -- server
# Todo Rust backend listening on http://127.0.0.1:3100
```

```bash
cargo run -- todo-list
cargo run -- todo-create '{"title": "Buy groceries", "priority": "high"}'
cargo run -- todo-toggle '{"id": "<todo-id>"}'
cargo run -- shell          # 'help' lists commands; 'exit' or Ctrl+D quits
cargo run -- list-commands
```

The CLI exits with status 1 when a command fails and 2 for an unknown command or
invalid JSON.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness check |
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/message` | POST | Same endpoint, the path the web frontends call |

## Commands

| Command | Description |
|---------|-------------|
| `todo-create` | Create a todo (`title` 1 to 200 characters) |
| `todo-list` | List todos with filters, sorting and pagination (`total` counts every match) |
| `todo-get` | Get a todo by ID |
| `todo-update` | Update a todo (`NO_CHANGES` without fields) |
| `todo-toggle` | Toggle completion |
| `todo-delete` | Delete a todo |
| `todo-clear` | Clear completed todos, or all with `{"all": true}` |
| `todo-stats` | Counts by status and priority |
| `todo-create-batch` | Create up to 100 todos, reporting failures per item |
| `todo-delete-batch` | Delete up to 100 todos |
| `todo-toggle-batch` | Toggle up to 100 todos, or set them all with `completed` |

Each command declares its input as a JSON Schema (`src/commands/*.rs`). The same
schema is advertised by `tools/list` and enforced before the handler runs
(`src/validation.rs`), so a bad input returns a `VALIDATION_ERROR` with a
`suggestion` and per-field `details`, as in the TypeScript backend.

## Security

| Setting | Default | Variable |
|---------|---------|----------|
| Bind address | `127.0.0.1` | `HOST` |
| Port | `3100` | `PORT` |
| Browser origins | the README's dev frontends: `localhost` and `127.0.0.1` on ports 3000, 5173 and 5174 | `ALLOWED_ORIGINS` adds exact origins; `*` and `null` are refused |
| `Host` names | `localhost`, `127.0.0.1`, `[::1]` and `HOST` | `ALLOWED_HOSTS` adds names |
| Request body | 1 MiB | `MAX_BODY_BYTES` |

- The `Host` check blocks DNS rebinding: a page on `attacker.example` that
  re-points its DNS to 127.0.0.1 still sends `Host: attacker.example`.
- CORS headers are sent only for allowed origins, and requests from any other
  origin are refused with 403 before they reach a command.
- Only commands with `expose.mcp` are listed or callable over HTTP, and only
  commands with `expose.cli` run from the command line. The todo commands opt in to
  both; the `afd` defaults keep them closed.

## VS Code MCP configuration

Start the server first (`cargo run --release -- server`), then add to
`.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "afd-todo-rust": { "type": "http", "url": "http://127.0.0.1:3100/mcp" }
  }
}
```

## Testing

```bash
cargo test                             # unit and HTTP tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
pnpm --dir ../.. test:conformance:rs   # the shared conformance suite over HTTP
```

`rust-toolchain.toml` pins the same toolchain as `packages/rust`, and `Cargo.lock`
is committed (this is a binary crate); CI builds with `--locked`.

```bash
curl http://127.0.0.1:3100/health

curl -X POST http://127.0.0.1:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":"Test todo"}}}'
```

## Layout

```
src/
├── main.rs          # CLI: server, shell, list-commands, single commands
├── server.rs        # HTTP server: MCP JSON-RPC, Host/Origin checks, CORS, body limit
├── server/tests.rs  # HTTP tests
├── validation.rs    # JSON Schema subset validator
├── store.rs         # In-memory store
├── types.rs         # Todo, stats and sort types
└── commands/        # One file per command; mod.rs registers them
```
