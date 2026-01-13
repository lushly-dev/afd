# Myoso (AFD Todo Demo)

> A rich todo/notes app demonstrating Agent-First Development with local-first architecture

## Quick Start

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start MCP server (Terminal 1) - for Notes commands
cd backend && npm run dev

# Start Chat server (Terminal 2) - for AI chat
cd backend && npm run chat

# Start frontend (Terminal 3)
cd frontend && npm run dev
```

Then open http://localhost:5173

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                   Frontend (Vite + React)                         │
│                   http://localhost:5173                           │
├───────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     LocalStore (Zustand)                    │  │
│  │       Optimistic updates → instant UI → syncs later         │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────┴──────────────────────────────────┐  │
│  │                      ConvexSync                              │  │
│  │       Background sync → ID replacement → hydration           │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
├──────────────────────────────┼────────────────────────────────────┤
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                  Convex (Cloud Database)                    │  │
│  │       Real-time subscriptions → reactive updates             │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                         Chat Flow                                  │
├───────────────────────────────────────────────────────────────────┤
│  User ─→ ChatSidebar ─→ SSE /chat ─→ Gemini + Tools               │
│                   │          │                                     │
│                   │          └─→ READ: Query Convex                │
│                   │          └─→ WRITE: Return mock success        │
│                   │                                                │
│                   └─→ executeLocalAction ─→ LocalStore (instant)   │
│                                     └─→ ConvexSync (background)    │
└───────────────────────────────────────────────────────────────────┘
```

## Servers

| Server | Port | Purpose |
|--------|------|---------|
| MCP Server (`server.ts`) | 3100 | Notes commands, `/message` endpoint |
| Chat Server (`chat-server.ts`) | 3101 | AI chat, `/chat` SSE endpoint |
| Convex | Cloud | Real-time database, subscriptions |

## Todo Commands (via Chat)

| Command | Description |
|---------|-------------|
| `todo-create` | Create a new todo |
| `todo-list` | List todos with filters |
| `todo-update` | Update todo fields |
| `todo-toggle` | Toggle completion |
| `todo-delete` | Delete todo |
| `todo-complete` | Mark done |
| `todo-uncomplete` | Reopen todo |

## Local-First Architecture

**Why local-first?**
- **Instant UI feedback** - No waiting for network
- **Offline capable** - Works without connection  
- **Optimistic updates** - Changes appear immediately

**How it works:**
1. User action (via UI or chat) → LocalStore update (instant)
2. ConvexSync queues pending operations
3. Background sync to Convex
4. Convex ID replaces local ID after sync
5. Real-time Convex subscription hydrates on load

## Dev Mode

Add `?dev=true` to the URL to enable developer tools:
- Trust signals panel
- Response times
- Raw JSON toggle
- Command log

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useLocalStore.ts` | Zustand store for optimistic state |
| `frontend/src/hooks/useConvexSync.ts` | Background sync to Convex |
| `frontend/src/components/ChatSidebar.tsx` | AI chat with `executeLocalAction` |
| `backend/src/chat.ts` | Gemini integration with mock responses |
| `backend/src/chat-server.ts` | HTTP endpoints for chat |

## Spec

See [docs/demos/afd-todo.research.md](../../docs/demos/afd-todo.research.md) for full spec.
