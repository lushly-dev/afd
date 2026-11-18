# Rust Todo Backend

Rust implementation of the AFD todo backend, built on the `afd` crate. It implements the
thirteen commands of [`spec/commands.schema.json`](../../spec/commands.schema.json) with the
TypeScript backend's metadata, inputs, error codes, suggestions, result shapes and undo, and
passes every conformance suite: the 41 todo cases, the 5 confirmation cases and the 4 approval
cases, in both MCP eras (`pnpm test:conformance:rs`).

## What it is

- **MCP over stdio** (`cargo run -- stdio`): the `afd` crate's server, MCP 2026-07-28 and 2025
  `initialize` clients on one connection. MCP clients and the conformance runner spawn it this
  way.
- **MCP over HTTP** (`cargo run -- server`): `POST /mcp` (and `POST /message`) is the crate's
  Streamable HTTP endpoint, MCP 2026-07-28 statelessly (per-request `_meta`, `server/discover`)
  and 2025 clients that send `initialize`. `GET /mcp` answers 405. Umbel's mounted mode reaches
  the backend this way.
- **CLI and shell**: run one command, or an interactive shell.
- **In-memory storage**: the live todos, the deleted todos and the change history last until the
  process exits, and are not shared with the TypeScript and Python backends' `data/todos.db`.

Both servers list the library's own tools (`CommandRegistry::get_tool`): each command's whole
input schema, `title`, annotations (`destructiveHint` on the deletes and the clear) and
`_meta.approval`, and under `TOOL_STRATEGY=individual` an `outputSchema` from the command's
declared output. They also serve the bootstrap commands (`afd-help`, `afd-docs`, `afd-schema`)
and the `todo-reading` and `todo-editing` contexts with `afd-context-list`, `-enter` and `-exit`.

## As a library

The crate is a library and a binary. `todo_backend_rust::commands(store)` returns the thirteen
commands as `(CommandDefinition, serde_json::Value)` pairs, each with the JSON Schema of its
input, over a `TodoStore::new()`; nothing is registered, so a host chooses the registry and
registers each with `register_with_schema` (Umbel's todo plugin does). Each command records its
own successful changes in the store's history, so a host keeps `todo-history` without any
middleware. `app::registry` is the registry the binary serves: the commands and the approval
hold; `server::mcp_server` adds the context commands, then the bootstrap commands, as
TypeScript's server orders them. The binary, the CLI, the shell and the servers need the `server`
feature, which is on by default; without it (`--no-default-features`) the crate depends on `afd`
without its `server` feature and on neither `axum` nor `tower-http`.

## Quick start

```bash
cargo run --release -- server
# Todo Rust backend listening on http://127.0.0.1:3100
```

```bash
cargo run -- stdio          # MCP over stdin and stdout
cargo run -- todo-list
cargo run -- todo-create '{"title": "Buy groceries", "priority": "high"}'
cargo run -- todo-toggle '{"id": "<todo-id>"}'
cargo run -- shell          # 'help' lists commands; 'exit' or Ctrl+D quits
cargo run -- list-commands
```

The CLI exits with status 1 when a command fails and 2 for an unknown command or invalid JSON.
The command line runs as the person at the terminal (actor `human`), so a clear there is not
held for approval.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness check |
| `/mcp` | POST | MCP JSON-RPC endpoint |
| `/message` | POST | The same endpoint, for older clients |

## Commands

| Command | Description |
|---------|-------------|
| `todo-create` | Create a todo (`title` 1 to 200 characters) |
| `todo-list` | List todos with filters, sorting and pagination (`total` counts every match); `deleted: true` lists the deleted todos; a filtered list offers the unfiltered and opposite views as `alternatives` |
| `todo-get` | Get a todo by ID |
| `todo-update` | Update a todo (`NO_CHANGES` without fields) |
| `todo-toggle` | Toggle completion |
| `todo-delete` | Delete a todo, kept with the deleted todos for `todo-restore` |
| `todo-clear` | Remove completed todos for good, the deleted todos with `{"deleted": true}`, or every todo with `{"all": true}` |
| `todo-stats` | Counts of the live todos by status and priority |
| `todo-create-batch` | Create up to 100 todos, reporting failures per item |
| `todo-delete-batch` | Delete up to 100 todos |
| `todo-toggle-batch` | Toggle up to 100 todos, or set them all with `completed` |
| `todo-restore` | Bring deleted todos back as they were |
| `todo-history` | Recent changes, newest first: who, when, which todos and the undo |

Each command declares its input as a whole JSON Schema (`src/commands/*.rs`). The registry
validates every call against it before the handler runs (`register_with_schema`), filling
defaults and dropping undeclared keys, and the servers advertise the same schema, so a bad input
returns a `VALIDATION_ERROR` with a `suggestion` and per-field `details`. Each command also
declares a `title`, `examples`, `tags`, its contexts and the shape of its result's `data`
(`returns`).

Every change names its undo (`undoCommand`, `undoArgs`): create with `todo-delete`, update and
toggle with `todo-update` setting the previous values, the deletes with `todo-restore`, a restore
with `todo-delete-batch`, and a batch toggle with `todo-toggle-batch` when one call can undo it
(a mixed toggle warns `NO_SINGLE_UNDO`). Handlers take their time from the context's clock and
make ids from its random source in TypeScript's format (`todo-<ms>-<7 base-36 digits>`), so a
seeded random gives the same ids as TypeScript. Equal sort keys keep the order the todos were
added, in both directions. Titles sort case-folded, then exactly, which is not JavaScript's
`localeCompare` for accented text.

## Approvals

`todo-clear` is the one change nothing undoes, so a caller that is not a person waits for a
person to approve it: the approval middleware (`create_approval_middleware`) holds it for every
actor but `human`. Over MCP every caller is an agent. A client that declares form elicitation is
asked, with a summary of what would go ("Remove the completed todos for good (3 todos now)");
any other client, a 2025 request over HTTP, and a clear inside `afd-batch` or `afd-pipe` get
`APPROVAL_REQUIRED` with a suggestion and no token. Deletes are undoable, so they are not held.

The approval suite runs over stdio, so asking the person is tested there in both eras. Over HTTP
only the hold itself is tested (`src/server/tests.rs`: a client that declares no elicitation gets
`APPROVAL_REQUIRED` and no token); asking the person over MCP 2026-07-28 HTTP is the library's
behaviour but not exercised here.

Under Umbel the clear is not held: a plugin manifest cannot yet declare a per-caller approval, so
the todo plugin drops it and the clear is gated by its confirmation prompt alone
([#1329](https://github.com/lushly-dev/afd/issues/1329)). The command's description says so.

| Variable | Default | Description |
|----------|---------|-------------|
| `APPROVALS` | `agents` | `off` holds nothing; the shared conformance suites run so, since they reset with a clear |
| `TODO_APPROVAL_SECRET` | a random key per process | The key (at least 32 bytes) that signs approval tokens, so several servers accept each other's. Each process keeps its own spent tokens, so one approval can run the clear once on each server that shares the key |

## Security

| Setting | Default | Variable |
|---------|---------|----------|
| Bind address | `127.0.0.1` | `HOST` |
| Port | `3100` | `PORT` |
| Browser origins | the README's dev frontends: `localhost` and `127.0.0.1` on ports 3000, 5173 and 5174 | `ALLOWED_ORIGINS` adds exact origins; `*` and `null` are refused |
| `Host` names | `localhost`, `127.0.0.1`, `[::1]` and `HOST` | `ALLOWED_HOSTS` adds names |
| Request body | 1 MiB | `MAX_BODY_BYTES` |
| Confirmations | `off` | `CONFIRMATIONS`: `enforce` or `require-human` gate `todo-clear` with its prompt |
| Tool list | `grouped`: the meta-tools, one `todo` tool whose actions are the commands, and one `bootstrap` tool for the bootstrap and context commands | `TOOL_STRATEGY=individual` lists one tool per command (a host that mounts the backend renames tools one by one); both strategies call every command by its own name |

- The `Host` check blocks DNS rebinding: a page on `attacker.example` that
  re-points its DNS to 127.0.0.1 still sends `Host: attacker.example`.
- CORS headers are sent only for allowed origins, and requests from any other
  origin are refused with 403 before they reach a command.
- Only commands with `expose.mcp` are listed or callable over MCP, and only
  commands with `expose.cli` run from the command line. The todo commands opt in to
  both; the `afd` defaults keep them closed.

## MCP client configuration

Over stdio, the client spawns the backend (from the repository root):

```jsonc
{
  "servers": {
    "afd-todo-rust": {
      "command": "cargo",
      "args": ["run", "--quiet", "--manifest-path", "packages/examples/todo/backends/rust/Cargo.toml", "--", "stdio"]
    }
  }
}
```

Over HTTP, start the server first (`cargo run --release -- server`), then:

```jsonc
{
  "servers": {
    "afd-todo-rust": { "type": "http", "url": "http://127.0.0.1:3100/mcp" }
  }
}
```

## Testing

```bash
cargo test                             # unit, command and HTTP tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
pnpm --dir ../.. test:conformance:rs   # the shared conformance suite over stdio
pnpm --dir ../.. test:conformance:rs --suite confirmations
pnpm --dir ../.. test:conformance:rs --suite approvals
```

`rust-toolchain.toml` pins the same toolchain as `packages/rust`, and `Cargo.lock`
is committed (this is a binary crate); CI builds with `--locked`.

```bash
curl http://127.0.0.1:3100/health

curl -X POST http://127.0.0.1:3100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2026-07-28" -H "Mcp-Method: tools/call" -H "Mcp-Name: todo-create" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"todo-create","arguments":{"title":"Test todo"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
```

## Layout

```
src/
├── main.rs          # CLI: server, stdio, shell, list-commands, single commands
├── app.rs           # The registry the binary serves: commands, approval hold; contexts
├── server.rs        # The MCP server (contexts, then bootstrap); HTTP: the afd endpoint, Host/Origin checks, CORS, body limit
├── server/tests.rs  # HTTP tests
├── store.rs         # In-memory store: live and deleted todos, the change history
├── types.rs         # Todo, stats and sort types
└── commands/        # One file per command; mod.rs defines them and records the history
```
