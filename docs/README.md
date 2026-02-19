# AFD Documentation

> Agent-First Development — where commands are the application and UI is just one surface.

## Structure

| Folder | Purpose |
|--------|---------|
| [features/](./features/) | Feature proposals, specs, and assets |
| [guides/](./guides/) | Conceptual guides, schema patterns, philosophy |
| [demos/](./demos/) | Research and documentation for demo applications |
| [whitepaper/](./whitepaper/) | High-level vision and architecture documents |

## Features

Features progress through three stages:

| Stage | Folder | Description |
|-------|--------|-------------|
| **Proposed** | `features/proposed/` | Draft proposals pending review |
| **Active** | `features/active/` | Approved, in implementation |
| **Complete** | `features/complete/` | Shipped and archived |

### Active Features

- [Platform Utils](./features/active/platform-utils/) — Cross-platform subprocess and connector utilities

### Recently Completed

- [Handoff Pattern](./features/complete/handoff-pattern/) — Real-time protocol handoff for streaming
- [Command Pipeline](./features/complete/command-pipeline/) — Declarative command chaining

## Guides

Guides have been migrated to skills under `.claude/skills/`. See:
- `afd-developer` skill — Philosophy, trust, implementation phases, production considerations
- `afd` skill — Command schema design, telemetry, external adapters
- `afd-directclient` skill — In-process command execution

## Workflow

```
Proposed → Review → Active → Implementation → Complete
```

1. **Proposed** — Draft in `features/proposed/` with `proposal.md`
2. **Active** — Approved, add `spec.md`, begin implementation
3. **Complete** — Shipped, move to `features/complete/`

Each feature folder contains:
- `proposal.md` — The what/why
- `spec.md` — The how (after approval)
- `assets/` — Diagrams, screenshots (optional)
