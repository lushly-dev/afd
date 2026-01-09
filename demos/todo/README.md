# AFD Todo Demo

> A rich todo/notes app demonstrating Agent-First Development

## Quick Start

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start backend (Terminal 1)
cd backend && npm run dev

# Start frontend (Terminal 2)
cd frontend && npm run dev
```

Then open http://localhost:5173

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Frontend (Vite + Lit)                      │
│       http://localhost:5173                                 │
├─────────────────────────────────────────────────────────────┤
│  Task UI ──────→ POST /execute ──────→ DirectClient         │
│                         │                ~0.03ms            │
│                         ▼                                   │
│                  Command Registry                           │
│         (task-create, task-list, list-create, etc.)         │
├─────────────────────────────────────────────────────────────┤
│                  SQLite Database                            │
│             ./todo.db (tasks + lists)                       │
└─────────────────────────────────────────────────────────────┘
```

## Commands

### Task Commands

| Command | Description |
|---------|-------------|
| `task-create` | Create a new task |
| `task-list` | List tasks with filters |
| `task-update` | Update task fields |
| `task-complete` | Mark task done |
| `task-uncomplete` | Reopen task |
| `task-delete` | Delete task |

### List Commands

| Command | Description |
|---------|-------------|
| `list-create` | Create new list |
| `list-list` | Get all lists |
| `list-update` | Update list |
| `list-delete` | Delete list |

## Dev Mode

Add `?dev=true` to the URL to enable developer tools:
- Trust signals panel
- Response times
- Raw JSON toggle
- Command log

## Spec

See [docs/demos/afd-todo.research.md](../../docs/demos/afd-todo.research.md) for full spec.
