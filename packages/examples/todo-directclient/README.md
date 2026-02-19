# Todo DirectClient Example

A Todo app demonstrating **DirectClient** - AFD's zero-overhead transport for AI agents co-located with your application.

## What This Demonstrates

- **DirectClient**: ~0.03ms per command (vs ~2-10ms for MCP)
- **AI Copilot**: Gemini 2.0 Flash integration with tool calling
- **Security Hardening**: CORS, rate limiting, input validation
- **Observability**: Health checks, metrics, request tracing

## Quick Start

```bash
# Terminal 1: MCP Server (for CLI compatibility)
cd backend
npx tsx src/server.ts

# Terminal 2: Chat Server (DirectClient + Gemini)
cd backend
npx tsx src/chat-server.ts

# Then open frontend/index.html in browser
```

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

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /chat` | Send message to Gemini + execute tools |
| `POST /execute` | Execute command directly via DirectClient |
| `GET /health` | Basic liveness check |
| `GET /ready` | Comprehensive readiness check |
| `GET /metrics` | Request counts, latencies, error rates |

## Security Features

- **API Key Masking**: Keys shown as `***XXXX` in logs
- **CORS**: Configurable via `ALLOWED_ORIGINS`
- **Rate Limiting**: 30 chat/min, 120 execute/min
- **Input Validation**: Command name regex, body size limits

## Configuration

Copy `.env.example` to `.env` and set:

```env
GOOGLE_API_KEY=your-gemini-api-key
ALLOWED_ORIGINS=*                    # or specific origins
RATE_LIMIT_CHAT=30                   # per minute
RATE_LIMIT_EXECUTE=120               # per minute
MAX_BODY_SIZE=10240                  # 10KB
```

## When to Use DirectClient

✅ **Use when**: An AI agent runs in the same process as your app  
❌ **Don't use when**: Tests (GitHub Actions), remote agents, cross-process

See the `afd-directclient` skill for details.
