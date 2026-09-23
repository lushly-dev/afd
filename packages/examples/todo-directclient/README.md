# Todo DirectClient Example

A Todo app demonstrating **DirectClient** - AFD's zero-overhead transport for AI agents co-located with your application.

## What This Demonstrates

- **DirectClient**: ~0.03ms per command (vs ~2-10ms for MCP)
- **AI Copilot**: Gemini integration with tool calling
- **Security Hardening**: localhost-only defaults, Origin and Host allowlists, rate limiting, input validation, XSS-safe rendering
- **Observability**: Health checks, metrics, request tracing

The same commands also opt in to external MCP access with `expose: { mcp: true }`.
Command exposure defaults to private for MCP, even when a command is registered
with a server; this explicit flag makes the remote surface intentional.

## Quick Start

```bash
# Terminal 1: MCP Server (for CLI compatibility)
cd backend
npx tsx src/server.ts

# Terminal 2: Chat Server (DirectClient + Gemini), which also serves the UI
cd backend
npx tsx src/chat-server.ts

# Then open http://localhost:3201 in a browser
```

The chat server serves `frontend/` itself, so the page and the API share one
origin. Opening `frontend/index.html` from disk does not work: a `file://` page
sends `Origin: null`, which the server refuses.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Browser (frontend/index.html)                           │
├─────────────────────────────────────────────────────────┤
│ Chat UI ────────→ POST /chat ────────→ Gemini API       │
│                         │                    │          │
│                         ▼                    ▼          │
│ Todo UI ────────→ POST /execute ◄─── DirectClient       │
│                         │              ~0.03ms          │
│                         ▼                               │
│                   Command Registry                      │
│                   (todo-create, todo-list, etc.)       │
└─────────────────────────────────────────────────────────┘
```

The registry (`backend/src/registry.ts`) is built with `createDirectRegistry`
from `@lushly-dev/afd-server`. Every call, from the AI or the UI, goes through
the same engine as the MCP server: Zod input validation, middleware, error
sanitization and the `expose.agent` check.

```ts
import { createDirectRegistry } from '@lushly-dev/afd-server';

export const registry = createDirectRegistry(allCommands, { interface: 'agent' });
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | The frontend (`index.html`, `app.js`, `render.js`) |
| `POST /chat` | Send message to Gemini + execute tools |
| `POST /execute` | Execute command directly via DirectClient |
| `GET /health` | Basic liveness check |
| `GET /ready` | Comprehensive readiness check |
| `GET /metrics` | Request counts, latencies, error rates |

## Security Features

The defaults are safe for a developer machine; each one is configurable.

- **Loopback only**: the server binds `127.0.0.1` (`CHAT_HOST`).
- **Origin allowlist**: browser requests must come from an exact allowed origin
  (this server's own `localhost`/`127.0.0.1` origins, plus any in `ALLOWED_ORIGINS`).
  `Origin: null` and `*` are always refused, and the `Access-Control-Allow-Origin`
  header only ever echoes an allowed origin.
- **Host check**: the `Host` header must name this server (`ALLOWED_HOSTS`), which
  blocks DNS rebinding.
- **Rate limiting**: 30 chat/min and 120 execute/min per client, keyed on the socket
  address. `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, and then only the
  entry the proxy appended is used, so a client cannot rotate the header to reset its
  limit. The limiter tracks at most `RATE_LIMIT_MAX_CLIENTS` clients and sweeps
  expired windows every minute.
- **Input validation**: JSON bodies only, capped at `MAX_BODY_SIZE`; command names must
  be kebab-case; every command's Zod schema and `expose.agent` flag are enforced by
  `createDirectRegistry`, for UI and AI calls alike.
- **XSS-safe rendering**: todo titles, tool names and model replies are untrusted (a
  prompt injection can make the model create a todo titled `<img src=x onerror=...>`).
  `frontend/render.js` builds the DOM with `textContent`, never `innerHTML`, and the
  page is served with a Content-Security-Policy that forbids inline script.
- **Bounded agent loop**: at most `GEMINI_MAX_TOOL_ROUNDS` rounds of tool calls per message.
- **API key masking**: keys shown as `***XXXX` in logs.

## Configuration

Copy `.env.example` to `.env` and set:

```env
GOOGLE_API_KEY=your-gemini-api-key
CHAT_HOST=127.0.0.1                  # interface to bind
ALLOWED_ORIGINS=http://localhost:5173  # extra exact origins; the bundled UI is always allowed
ALLOWED_HOSTS=chat.example.com       # extra Host names; loopback names always allowed
TRUST_PROXY=false                    # true only behind one reverse proxy
RATE_LIMIT_CHAT=30                   # per minute
RATE_LIMIT_EXECUTE=120               # per minute
MAX_BODY_SIZE=10240                  # 10KB
```

## Tests

```bash
cd backend
pnpm test
```

The tests cover the origin, host, bind, rate-limit and `X-Forwarded-For` policy
(`src/http-security.test.ts`), the HTTP routes (`src/chat-http.test.ts`) and the
XSS-safe render helpers (`src/render.test.ts`).

## When to Use DirectClient

✅ **Use when**: An AI agent runs in the same process as your app  
❌ **Don't use when**: Tests (GitHub Actions), remote agents, cross-process

See the `afd-directclient` skill for details.
