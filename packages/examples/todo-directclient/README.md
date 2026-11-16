# Todo DirectClient Example

A copilot that manages the to-do reference's todos by calling its commands through
**DirectClient**, in the server's own process, with no transport between the model's tool calls
and the commands.

The commands are the main example's ([`../todo/backends/typescript`](../todo/backends/typescript)),
imported with their middleware: approvals, the change history and logging. Nothing here defines a
command.

## What it shows

- **The model's tools come from the MCP tool surface.** `createDirectToolSurface` and
  `listTools()` give each command's own name, description and JSON Schema, exactly what an MCP
  server with these commands lists. No schema is written by hand (`backend/src/copilot.ts`).
- **`allow` decides what the model may run.** In look-only mode (`mode: "look"`) only the
  commands that declare `mutation: false` are permitted: the rest are left out of the tool list,
  and a call to one fails with `COMMAND_NOT_ALLOWED` before it runs, including through
  `afd-call` or `afd-batch`. Job 10 ([`backend/scenarios/`](backend/scenarios/)) holds it to that.
- **The copilot is an agent.** Its calls carry `{ kind: 'agent', id: 'todo-copilot' }`, so
  `todo-history` says it made a change and `todo-clear` is held for the person's approval. Until
  the page can ask the person (phase 4's next step), the model gets `APPROVAL_REQUIRED` back and
  says so.
- **One server, one store.** The same process serves MCP at `/mcp`, so the AFD CLI and other MCP
  clients see the todos the copilot changes.

## Quick start

The commands come from the main example's build, so build it and the packages it uses first,
from the repository root, and again after changing them:

```bash
pnpm --filter "@afd/example-todo-directclient^..." build
```

Then:

```bash
cd packages/examples/todo-directclient/backend
cp .env.example .env   # then set GOOGLE_API_KEY
pnpm dev               # http://localhost:3201
```

Open http://localhost:3201 for the page, or connect an MCP client:

```bash
afd connect http://localhost:3201/mcp
afd call todo-list '{}'
```

Without an API key the page and `/mcp` still work; `/chat` answers that Gemini is not
configured. `pnpm demo` runs the copilot's clients with no model and no server: the tool list in
each mode, a refused call, and an approval asked for and answered.

The store is the main example's, chosen by `TODO_STORE_TYPE` (`file`, `sqlite` or `memory`) and
`TODO_STORE_PATH`. The default is the JSON file the main example's server also uses, so both
servers show the same todos.

## Architecture

```
Browser (frontend/)
  todo list ──── POST /execute ──┐
  chat ───────── POST /chat ─────┤
                                 ▼
Server (backend/src/chat-server.ts)
  /chat ──→ Copilot ──→ Gemini (tools from listTools())
              │
              └──→ DirectClient (actor: agent, allow: the mode's commands)
                        │
  /execute ──→ DirectClient (actor: person)
                        ▼
              createDirectRegistry(main commands, main middleware)
                        ▼
  /mcp ────→ createMcpHandler(main server options) ──→ the same store
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | The page (`index.html`, `app.js`, `render.js`) |
| `POST /chat` | `{ message, mode? }`: one turn of the copilot; `mode` is `change` (default) or `look` |
| `POST /execute` | `{ name, args }`: one command, run as the person |
| `/mcp` | MCP over Streamable HTTP: the main example's server |
| `GET /health` | Liveness, and whether Gemini is configured |
| `GET /ready` | 503 until Gemini is configured |
| `GET /metrics` | Turn counts, latencies and errors |

## Security

The defaults are safe for a developer machine; each one is configurable in `.env`.

- **Loopback only**: the server binds `127.0.0.1` (`CHAT_HOST`).
- **Origin allowlist**: browser requests must come from an exact allowed origin (this server's
  own `localhost` and `127.0.0.1` origins, plus any in `ALLOWED_ORIGINS`). `Origin: null` and `*`
  are always refused, and `Access-Control-Allow-Origin` only ever echoes an allowed origin. This
  covers `/mcp` too, except with `NODE_ENV=development`, where the main server's dev mode lets
  any origin call `/mcp`.
- **Host check**: the `Host` header must name this server (`ALLOWED_HOSTS`), which blocks DNS
  rebinding.
- **Rate limiting** on `/chat` and `/execute`: 30 and 120 a minute per client, keyed on the socket
  address. `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, and then only the entry the
  proxy appended is used. The limiter tracks at most `RATE_LIMIT_MAX_CLIENTS` clients. `/mcp` is
  not rate limited and reads its own bodies, as the main example's server does.
- **Validation**: JSON bodies only, capped at `MAX_BODY_SIZE`; command names must be kebab-case;
  every command's Zod schema and `expose.agent` flag are enforced by `createDirectRegistry`.
- **`/execute` runs as the person**, so `todo-clear` there is not held. A browser on another
  origin cannot reach it, but any program on this machine can, as it can reach the store's file.
  It is the page's channel for now; the next step replaces it with `/mcp`, where every caller
  counts as an agent.
- **XSS-safe rendering**: todo titles, tool names and model replies are untrusted (a prompt
  injection can make the model create a todo titled `<img src=x onerror=...>`). `frontend/render.js`
  builds the DOM with `textContent`, and the page is served with a Content-Security-Policy that
  forbids inline script.
- **A bounded agent loop**: at most `GEMINI_MAX_TOOL_ROUNDS` rounds and 20 tool calls per message.
  A turn that reaches either limit ends with what already ran and says it stopped. A blank
  setting keeps the default, and anything but a positive integer is refused at startup, so no
  setting can lift a limit. A page that leaves
  mid-turn cancels the rest of it.
- **Errors the person can read**: a Gemini failure reaches the page as a plain message, never the
  provider's error text; the API key is logged as `***` and its last four characters.

## Configuration

`backend/.env.example` lists every setting with its default, including the main example's
(`APPROVALS`, `TODO_JOURNAL` and the rest), which apply to the copilot's calls and to `/mcp`
alike. With `TODO_JOURNAL` set, both write one journal.

## Speed

`pnpm benchmark` measures `todo-list` both ways on your machine: through DirectClient, and over
MCP (Streamable HTTP on loopback) to a server in the same process with the same commands,
middleware and store. The difference is the transport. The numbers depend on the machine, so this
README states none.

## Tests

```bash
cd backend
pnpm test
```

- `src/copilot.test.ts`: the tool list from `listTools()` in each mode, `allow` refusing changes in
  look mode however the model asks, the history naming the copilot, a clear held, approved or
  denied, the limits, call ids and cancelling. A scripted model stands in for Gemini.
- `src/scenarios.test.ts`: job 10 through the copilot's look-mode client.
- `src/gemini.test.ts`: tool declarations from the JSON Schemas, Gemini's own parts sent back
  unchanged, thoughts left out, an empty answer reported, and error messages for the person.
- `src/chat.test.ts`: the `/chat` backend's errors and metrics.
- `src/services.test.ts`: the server's wiring: `/mcp` accepts the hosts in `ALLOWED_HOSTS`, and the
  copilot and `/mcp` write one journal.
- `src/chat-http.test.ts` and `src/http-security.test.ts`: the routes, `/mcp`, and the origin,
  host, bind, rate-limit and `X-Forwarded-For` policy.
- `src/render.test.ts`: the XSS-safe render helpers.

## When to use DirectClient

Use it when an agent runs in the same process as the commands, as this copilot does. An agent in
another process, such as a coding assistant or a test runner, uses MCP. See the
`afd-directclient` skill.
