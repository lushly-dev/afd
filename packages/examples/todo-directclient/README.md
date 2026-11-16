# Todo DirectClient Example

A copilot that manages the to-do reference's todos by calling its commands through
**DirectClient**, in the server's own process, with no transport between the model's tool calls
and the commands. Its page is the FAST-AF to-do page with a copilot panel beside it.

The commands are the main example's ([`../todo/backends/typescript`](../todo/backends/typescript)),
imported with their middleware: approvals, the change history and logging. Nothing here defines a
command. The list on the page is the FAST-AF page's own element
([`../todo/frontends/fast-af`](../todo/frontends/fast-af)), talking MCP to this server.

## What it shows

- **The model's tools come from the MCP tool surface.** `createDirectToolSurface` and
  `listTools()` give each command's own name, description and JSON Schema, exactly what an MCP
  server with these commands lists. No schema is written by hand (`backend/src/copilot.ts`).
- **`allow` decides what the model may run.** With the panel's "Only look" (`mode: "look"`) only
  the commands that declare `mutation: false`, and the page's view-state commands, are permitted:
  the rest are left out of the tool list, and a call to one fails with `COMMAND_NOT_ALLOWED`
  before it runs, including through `afd-call` or `afd-batch`. Job 10
  ([`backend/scenarios/`](backend/scenarios/)) holds it to that.
- **Approvals through `onApprovalNeeded`.** The copilot's calls carry
  `{ kind: 'agent', id: 'todo-copilot' }`, so `todo-history` says it made a change and
  `todo-clear` is held. DirectClient's `onApprovalNeeded` hook asks the page that sent the
  message, which shows a `violet-approval-card` in the conversation; only a yes from the person
  runs the clear.
- **The page hosts the view.** The list follows the `todo-filter` view, which the page serves with
  `view-state-*` commands in its own registry. The copilot's registry holds stand-ins with the
  same schemas that send each call to the page (`backend/src/page.ts`), so "show my urgent open
  todos" changes the list on screen rather than copying it into the chat (job 6).
- **One server, one store.** The same process serves MCP at `/mcp`, which the page's list uses, and
  so can the AFD CLI and other MCP clients.

## Quick start

The commands and the page come from other packages' builds, so build them first, from the
repository root, and again after changing them:

```bash
pnpm --filter "@afd/example-todo-directclient-page..." build
```

Then:

```bash
cd packages/examples/todo-directclient/backend
cp .env.example .env   # then set GOOGLE_API_KEY
pnpm dev               # http://localhost:3201
```

Open http://localhost:3201, or connect an MCP client:

```bash
afd connect http://localhost:3201/mcp
afd call todo-list '{}'
```

Without an API key the page and `/mcp` still work; the copilot answers that Gemini is not
configured. `pnpm demo` runs the copilot's clients with no model and no server: the tool list in
each mode, a refused call, and an approval asked for and answered.

To work on the page with Vite, run the server with `ALLOWED_ORIGINS=http://localhost:5175`, then
`pnpm dev` in `frontend/`, which sends `/chat`, `/mcp` and `/health` to it.

The store is the main example's, chosen by `TODO_STORE_TYPE` (`file`, `sqlite` or `memory`) and
`TODO_STORE_PATH`. The default is the JSON file the main example's server also uses, so both
servers show the same todos.

## Architecture

```
Browser (frontend/: <todo-app> and <todo-copilot>)
  the list ─────── MCP at /mcp ─────────────────────────────┐
  the panel ────── POST /chat (a turn, streamed) ─┐         │
     ▲  answers ── POST /chat/answer ─────────────┤         │
     │                                            ▼         │
Server (backend/src/chat-server.ts)                         │
  Copilot ──→ Gemini (tools from listTools())               │
     │                                                      │
     └─→ DirectClient (actor: agent, allow: the mode's commands,
           onApprovalNeeded: ask the page)                  │
              ▼                                             ▼
       createDirectRegistry(main commands      createMcpHandler(main
       + the page's view-state commands,        server options)
       main middleware)                                     │
              ▼                                             ▼
                          the same store
```

A turn streams JSON lines: `turn` (its id), `call` and `result` for each command, an `approval`
or `view` question when the server needs the page, `withdrawn` when one lapses, and last `done` or
`error`. The page answers each question on `/chat/answer`.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | The built page (`frontend/dist`) |
| `POST /chat` | `{ message, mode? }`: one turn, streamed as `application/x-ndjson`; `mode` is `change` (default) or `look` |
| `POST /chat/answer` | `{ turn, ask, approved }` for an approval, `{ turn, ask, result }` for a view call |
| `/mcp` | MCP over Streamable HTTP: the main example's server |
| `GET /health` | Liveness, and whether Gemini is configured |
| `GET /ready` | 503 until Gemini is configured |
| `GET /metrics` | Turn counts, latencies, errors and open turns |

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
- **Rate limiting** on `/chat` and `/chat/answer`: 30 and 120 a minute per client, keyed on the
  socket address. `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, and then only the entry
  the proxy appended is used. The limiter tracks at most `RATE_LIMIT_MAX_CLIENTS` clients. `/mcp`
  is not rate limited and reads its own bodies, as the main example's server does.
- **Answers only from the turn's page**: a turn's id is random and goes only to the page that
  holds its stream; each question takes one answer of its own kind. An approval not answered by
  the approval token's expiry, a view call not answered in 10 seconds, and any question still
  open when the page leaves settle as a no.
- **The approval is the server's**: the page never sees an approval token. It only says yes or
  no; DirectClient retries the held call with the token in this process.
- **Validation**: JSON bodies only, capped at `MAX_BODY_SIZE`; every command's Zod schema and
  `expose.agent` flag are enforced by `createDirectRegistry`, the page's view calls included,
  before they reach the page.
- **XSS-safe rendering**: todo titles, tool names and model replies are untrusted (a prompt
  injection can make the model create a todo titled `<img src=x onerror=...>`). The page renders
  them as text through FAST bindings, never as markup, and is served with a
  Content-Security-Policy that forbids inline script.
- **A bounded agent loop**: at most `GEMINI_MAX_TOOL_ROUNDS` rounds and 20 tool calls per message.
  A turn that reaches either limit ends with what already ran and says it stopped. A blank
  setting keeps the default, and anything but a positive integer is refused at startup, so no
  setting can lift a limit. A page that leaves mid-turn cancels the rest of it.
- **Errors the person can read**: a Gemini failure reaches the page as a plain message, never the
  provider's error text; the API key is logged as `***` and its last four characters.

## Configuration

`backend/.env.example` lists every setting with its default, including the main example's
(`APPROVALS`, `TODO_JOURNAL` and the rest), which apply to the copilot's calls and to `/mcp`
alike. With `TODO_JOURNAL` set, both write one journal; it records the copilot's view-state calls
too, which `afd replay` against the main example's registry reports as unknown commands.

## Speed

`pnpm benchmark` measures `todo-list` both ways on your machine: through DirectClient, and over
MCP (Streamable HTTP on loopback) to a server in the same process with the same commands,
middleware and store. The difference is the transport. The numbers depend on the machine, so this
README states none.

## Tests

```bash
cd backend && pnpm test             # the server and the copilot, with a scripted model
cd frontend && pnpm test            # the page's turn client
cd frontend && pnpm build && pnpm test:browser   # the page in Chromium
```

The backend's tests:

- `src/copilot.test.ts`: the tool list from `listTools()` in each mode, `allow` refusing changes in
  look mode however the model asks, the history naming the copilot, a clear held, approved or
  denied, the page's view calls, the limits, call ids, events and cancelling. A scripted model
  stands in for Gemini.
- `src/turn-http.test.ts`: a turn over HTTP with the real copilot: the page approves or denies a
  clear, leaves mid-question, answers once only, and runs or misses a view call.
- `src/scenarios.test.ts`: job 10 through the copilot's look-mode client.
- `src/gemini.test.ts`: tool declarations from the JSON Schemas, Gemini's own parts sent back
  unchanged, thoughts left out, an empty answer reported, and error messages for the person.
- `src/chat.test.ts`: the `/chat` backend's errors and metrics.
- `src/services.test.ts`: the server's wiring: `/mcp` accepts the hosts in `ALLOWED_HOSTS`, and the
  copilot and `/mcp` write one journal.
- `src/chat-http.test.ts` and `src/http-security.test.ts`: the routes, the built page's files,
  `/mcp`, and the origin, host, bind, rate-limit and `X-Forwarded-For` policy.

The page's tests:

- `src/turn-client.test.ts`: reading a turn's stream and answering a view call.
- `test/copilot.test.ts`: the built page in Chromium, served by the real server with a scripted
  model: the copilot adds a todo the list shows, narrows the view (job 6), waits for an approval
  given or refused in the panel, is refused a change in look-only mode (job 10), and axe.
- `test/page.test.ts`: the to-do pages' shared Chromium suite on this page's build.

## When to use DirectClient

Use it when an agent runs in the same process as the commands, as this copilot does. An agent in
another process, such as a coding assistant or a test runner, uses MCP, as this page's list does.
See the `afd-directclient` skill.
