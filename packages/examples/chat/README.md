# Chat Example: the Handoff Pattern

Real-time chat built with AFD commands. `chat-connect` returns a `HandoffResult`
(a WebSocket URL and a short-lived token); the client then talks to the
WebSocket server directly. Agents that cannot hold a socket use `chat-poll`
and `chat-send` instead. See
[the handoff pattern docs](../../../docs/features/complete/handoff-pattern/00-overview.md).

## Run it

```bash
pnpm install && pnpm build   # from the repository root
cd packages/examples/chat
pnpm dev
```

This starts two servers:

| Server | Default address | Purpose |
|--------|-----------------|---------|
| MCP server | `http://127.0.0.1:3100` | Commands for MCP clients, the AFD CLI and the browser demo (`/rpc`) |
| Realtime server | `ws://127.0.0.1:3001` | WebSocket rooms, and the browser demo at `http://localhost:3001` |

```bash
afd connect http://localhost:3100/sse
afd call chat-rooms
afd call chat-connect '{"roomId": "general", "nickname": "CLI-User"}'
```

Open `http://localhost:3001` for the browser demo. It calls `chat-connect`
through the MCP server's `/rpc` route (JSON-RPC with the command name as the
method), so every call gets the same Zod validation, `expose.mcp` check,
middleware and body limit as any other MCP call. Opening `demo.html` from disk
does not work: a `file://` page sends `Origin: null`, which both servers refuse.

## Security defaults

| Setting | Default | Variable |
|---------|---------|----------|
| Bind address (both servers) | `127.0.0.1` | `HOST` |
| Browser origins (both servers) | the demo page: `http://localhost:3001`, `http://127.0.0.1:3001` | `ALLOWED_ORIGINS` adds exact origins; `*` and `null` are refused |
| `Host` header names | `localhost`, `127.0.0.1`, `[::1]`, `HOST` | `ALLOWED_HOSTS` adds names |
| MCP request body | 64 KiB | `MAX_BODY_BYTES` |
| WebSocket message | 16 KiB (the `ws` default is 100 MiB); chat text 2000 characters | `WS_MAX_PAYLOAD` |

The WebSocket server checks `Origin` itself on every upgrade, because CORS does
not apply to WebSockets. The demo renders nicknames and messages with
`textContent`, and the page is served with a Content-Security-Policy that
forbids inline script. `NODE_ENV=development` makes the MCP server accept any
origin and return verbose errors; do not use it on a shared network.

Other variables: `PORT` (MCP, 3100), `WS_PORT` (3001), `WS_BASE_URL` (the
WebSocket URL `chat-connect` hands out), `TRANSPORT` (`auto`, `http` or `stdio`)
and `LOG_LEVEL`.

## Tests

```bash
pnpm test
```

`src/commands/__tests__/commands.test.ts` covers the commands;
`src/security.test.ts` covers the `/rpc` route, the origin and host checks and
the size limits.
