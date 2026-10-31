# AFD Documentation

> Agent-First Development — where commands are the application and UI is just one surface.

## Structure

| Folder | Purpose |
|--------|---------|
| [features/](./features/) | Feature proposals, specs, and assets |
| [language-parity.md](./language-parity.md) | Capability matrix and known gaps across the TypeScript, Python, Rust and C++ implementations |
| [reviews/](./reviews/) | Dated repository review reports |
| [whitepaper/](./whitepaper/) | High-level vision and architecture documents |

## Features

Features progress through three stages:

| Stage | Folder | Description |
|-------|--------|-------------|
| **Proposed** | `features/proposed/` | Draft proposals pending review |
| **Active** | `features/active/` | Approved, in implementation |
| **Complete** | `features/complete/` | Shipped and archived |

### Completed

- [Alfred (afd-bot)](./features/complete/afd-bot/) — Repo quality bot: `afd-lint`, `afd-parity`, `afd-quality` (partly complete; see its status note)
- [AFD PyPI Publishing](./features/complete/afd-pypi-publishing/) — The Python package published to PyPI as `afd`
- [Auth Adapter](./features/complete/auth-adapter/) — Authentication adapter pattern for AFD servers
- [Command Exposure & Undo](./features/complete/command-exposure-undo/) — Command visibility and undo support
- [Command Pipeline](./features/complete/command-pipeline/) — Declarative command chaining
- [Command Prerequisites](./features/complete/command-prerequisites/) — Declared `requires` ordering between commands
- [Command Trust Config](./features/complete/command-trust-config/) — Per-command trust levels and exposure control
- [Contextual Tool Loading](./features/complete/contextual-tool-loading/) — Context-scoped tool sets (`afd-context-*`; partly complete, see its status note)
- [C++ Support](./features/complete/cpp-support/) — The `afd-cpp` C++20 implementation
- [Handoff Pattern](./features/complete/handoff-pattern/) — Real-time protocol handoff for streaming
- [Lazy-Loading Discovery](./features/complete/lazy-loading-discovery/) — The `lazy` tool strategy (`afd-discover`, `afd-detail`, `afd-call`)
- [Middleware Defaults](./features/complete/middleware-defaults/) — `defaultMiddleware()` observability bundle
- [Output Shape Predictability](./features/complete/output-shape-predictability/) — Declared and validated output schemas
- [Platform Utils](./features/complete/platform-utils/) — Cross-platform subprocess, path and environment utilities
- [Rust Parity](./features/complete/rust-parity/) — Rust crate export-name parity with TypeScript
- [Schema Complexity Scoring](./features/complete/schema-complexity-scoring/) — Surface rule scoring input-schema difficulty
- [Schema Examples](./features/complete/schema-examples/) — Valid input examples attached to commands
- [Semantic Quality Validation](./features/complete/semantic-quality-validation/) — `validateCommandSurface()` and `afd validate --surface`
- [View State](./features/complete/view-state/) — UI view state managed through commands

### Active

Each active project keeps its current state in `STATUS.md`.

- [AFD platform monorepo](./features/active/platform-monorepo/) — Independent foundations, composable endpoints and shared release safeguards. [Specification](./features/active/platform-monorepo/spec.md), [inventory](./features/active/platform-monorepo/inventory.md), [status](./features/active/platform-monorepo/STATUS.md). Lushly remains separate; Creator is excluded.
- [Hybrid tool strategy](./features/active/hybrid-tool-strategy/) — Hybrid MCP tool-list strategy across implementations. [Status](./features/active/hybrid-tool-strategy/STATUS.md)
- [MCP 2026-07-28](./features/active/mcp-2026-07-28/) — Migration to the MCP 2026-07-28 revision. [Status](./features/active/mcp-2026-07-28/STATUS.md)
- [MCP confirmations](./features/active/mcp-confirmations/) — Server-enforced `confirmPrompt` confirmations. [Status](./features/active/mcp-confirmations/STATUS.md)
- [Parity closure](./features/active/parity-closure/) — Closing cross-language parity gaps toward contract 1.0. [Status](./features/active/parity-closure/STATUS.md)
- [Python parity](./features/active/python-parity/) — Python export-name parity waves. [Status](./features/active/python-parity/STATUS.md)
- [Specimens](./features/active/specimens/) — Native component observation bench. [Proposal](./features/active/specimens/specimens.proposal.md), [status](./features/active/specimens/STATUS.md)
- [Versioning](./features/active/versioning/) — Per-implementation versioning and the shared contract version. [Status](./features/active/versioning/STATUS.md)

### Proposed

Agent engine, browser direct registry, chat history panel, code client, declared context fields, design-to-code, MCP authorization, MCP progress, MCP tasks, multi-tool registration, plugin discovery, Rust distribution, Rust support, skill knowledge layer and zero chat tools. See [features/proposed/](./features/proposed/).

## Guides

Guides have been migrated to skills under `.claude/skills/`. See:
- `afd-developer` skill — Philosophy, trust, implementation phases, production considerations
- `afd` skill — Command schema design, telemetry, external adapters
- `afd-directclient` skill — In-process command execution
- `optimistic-mutations` skill — Optimistic mutation patterns for interactive AFD clients

## Workflow

```
Proposed → Review → Active → Implementation → Complete
```

1. **Proposed** — Draft in `features/proposed/` with `proposal.md`
2. **Active** — Approved, add `spec.md`, begin implementation
3. **Complete** — Shipped, move to `features/complete/`

Active and complete doc sets carry a `STATUS.md` or an up-to-date status header (done, not done, evidence, dates), per AGENTS.md "Tracking Work Against Plans".

Each feature folder typically contains:
- A proposal (`proposal.md` or `<name>.proposal.md`) — The what/why
- A spec or plan (`spec.md`, `<name>.spec.md`, `<name>.plan.md`) — The how (after approval)
- `STATUS.md` — Done, not done, evidence, follow-ups (once active)
- `assets/` — Diagrams, screenshots (optional)
