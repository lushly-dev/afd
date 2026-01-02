# Multi-Stack Examples - Overview

> **Goal**: Demonstrate AFD's core promise — "commands ARE the application, UI is just one surface" — by showing the same API implemented in multiple backend languages and consumed by multiple frontend frameworks.

---

## Vision

AFD (Agent-First Development) inverts traditional application architecture:

```
Traditional: UI → API → Agent Access (afterthought)
Agent-First: Commands → Validation → UI (surface)
```

This example suite proves that promise by showing:

1. **Two backends** (TypeScript, Python) implementing the **same API contract**
2. **Two frontends** (Vanilla JS, React) consuming **any backend** interchangeably
3. **One conformance test suite** validating all implementations

If the architecture is correct, any backend should work with any frontend. The commands are the application; the surfaces are interchangeable.

---

## Success Criteria

| Criteria | Measurement |
|----------|-------------|
| **Interoperability** | Any backend + any frontend combination works |
| **Conformance** | Both backends pass the same test suite |
| **Extensibility** | Clear pattern for adding new backends/frontends |
| **Onboarding** | Developer can run an example in < 5 minutes |

---

## Target Architecture

```
packages/examples/
├── _shared/                      # Shared across ALL examples
│   ├── test-runner/              # Portable conformance test runner
│   │   ├── runner.ts             # Runs tests against any backend URL
│   │   └── package.json
│   └── README.md
│
├── todo/                         # Todo example (refactored)
│   ├── spec/                     # API contract for todo
│   │   ├── commands.schema.json  # JSON Schema for all commands
│   │   ├── test-cases.json       # Conformance test cases
│   │   └── README.md             # Contract documentation
│   │
│   ├── backends/
│   │   ├── typescript/           # Full implementation (11 commands)
│   │   │   ├── src/
│   │   │   ├── package.json
│   │   │   └── README.md
│   │   └── python/               # Full implementation (11 commands)
│   │       ├── server.py
│   │       ├── pyproject.toml
│   │       └── README.md
│   │
│   ├── frontends/
│   │   ├── vanilla/              # Vanilla JS implementation
│   │   │   ├── index.html
│   │   │   ├── app.js
│   │   │   └── README.md
│   │   └── react/                # React implementation
│   │       ├── src/
│   │       ├── package.json
│   │       └── README.md
│   │
│   └── README.md                 # How to run any backend+frontend combo
│
└── README.md                     # Examples overview, pattern explanation
```

---

## Swap Mechanism

Simple environment variable approach for developers:

```bash
# Start any backend (exposes http://localhost:3100)
pnpm example:todo:ts    # TypeScript backend
# OR
pnpm example:todo:py    # Python backend

# Start any frontend (reads BACKEND_URL, defaults to localhost:3100)
pnpm example:todo:vanilla
# OR
pnpm example:todo:react

# Run conformance tests against running backend
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```

No fancy UI switcher — developers run commands, read READMEs.

---

## Phase Summary

| Phase | Document | Focus |
|-------|----------|-------|
| 01 | [01-specification.plan.md](./01-specification.plan.md) | Define shared API contract (JSON Schema + test cases) |
| 02 | [02-restructure.plan.md](./02-restructure.plan.md) | Reorganize folder structure, move existing code |
| 03 | [03-backends.plan.md](./03-backends.plan.md) | TypeScript refactor + Python parity |
| 04 | [04-frontends.plan.md](./04-frontends.plan.md) | Vanilla JS refactor + React implementation |
| 05 | [05-developer-experience.plan.md](./05-developer-experience.plan.md) | Scripts, docs, onboarding |

---

## Commands to Implement (11 total)

All backends must implement these commands with identical behavior:

| Command | Type | Description |
|---------|------|-------------|
| `todo.create` | mutation | Create a new todo |
| `todo.list` | query | List todos with filtering |
| `todo.get` | query | Get a single todo by ID |
| `todo.update` | mutation | Update todo fields |
| `todo.toggle` | mutation | Toggle completion status |
| `todo.delete` | mutation | Delete a todo |
| `todo.clear` | mutation | Clear completed todos |
| `todo.stats` | query | Get statistics |
| `todo.createBatch` | mutation | Create multiple todos at once |
| `todo.deleteBatch` | mutation | Delete multiple todos at once |
| `todo.toggleBatch` | mutation | Toggle multiple todos at once |

---

## Current State

| Component | Status | Location |
|-----------|--------|----------|
| TypeScript backend | Complete (11 commands) | `packages/examples/todo-app/` |
| Python backend | Partial (6 commands) | `python/examples/todo_server.py` |
| Vanilla JS frontend | Complete | `packages/examples/todo-app/ui/` |
| React frontend | Not started | — |
| Shared spec | Not started | — |
| Conformance tests | Not started | — |

---

## Non-Goals

- **Production-ready code**: These are learning examples, not production templates
- **Complex features**: Keep the todo app simple to focus on AFD patterns
- **UI polish**: Functional UI that demonstrates AFD metadata, not beautiful design
- **More than 2 backends/frontends initially**: Can add Rust, Vue, etc. later

---

## Related Documents

- [AFD Philosophy](../philosophy.md) — Why AFD exists
- [Command Schema Guide](../command-schema-guide.md) — How to design commands
- [Implementation Phases](../implementation-phases.md) — General AFD implementation guide
- [Trust Through Validation](../trust-through-validation.md) — Why CLI validation matters
