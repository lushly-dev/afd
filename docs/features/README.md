# AFD Features

Feature specifications organized by lifecycle stage.

## Stages

| Stage | Description |
|-------|-------------|
| [proposed/](./proposed/) | Draft proposals awaiting review |
| [active/](./active/) | Approved features in implementation |
| [complete/](./complete/) | Shipped features (reference archive) |

## Active Features

Cross-language gaps (TypeScript, Python, Rust, C++) are tracked in [Language Parity](../language-parity.md), and the Language Parity Closure plan closes them. The Python plan covers export names only; the Rust one is complete.

| Feature | Description |
|---------|-------------|
| [Platform Monorepo](./active/platform-monorepo/) | Consolidate independent foundations and composable developer endpoints with guarded publishing; Lushly remains separate and Creator is excluded. |
| [Specimens](./active/specimens/STATUS.md) | Native component observation and CPU/memory pilots; workstream 0 acceptance, retained-CSF compatibility and consumer cutover remain open. |
| [Python Parity Closure](./active/python-parity/) | Close the export-surface gap between TypeScript and Python. 97 names are missing; 60 of them are implemented but not exported. |
| [Language Parity Closure](./active/parity-closure/parity-closure.plan.md) | Close the unintended cross-language gaps in [Language Parity](../language-parity.md): spec first, in waves 0–4, with every undeclared gap decided |
| [MCP 2026-07-28 upgrade](./active/mcp-2026-07-28/proposal.md) | Move every AFD MCP surface to the stateless 2026-07-28 spec, served dual-era, with legacy lanes removed in 3.0 |
| [MCP Confirmations](./active/mcp-confirmations/mcp-confirmations.proposal.md) | Enforce `confirmPrompt` through MCP `input_required` elicitation, with an acknowledgement fallback; resolves D10 of the MCP upgrade |
| [Versioning and Release](./active/versioning/versioning.plan.md) | Maintain independent semver for each implementation and the shared AFD contract; keep release paths and current versions accurate |

## Complete Features

| Feature | Description |
|---------|-------------|
| [AFD Bot (Alfred)](./complete/afd-bot/) | Deterministic repo quality agent with lint, parity, and quality commands |
| [AFD PyPI Publishing](./complete/afd-pypi-publishing/) | Python package publishing to PyPI |
| [Auth Adapter](./complete/auth-adapter/) | Provider-agnostic authentication adapter for AFD servers |
| [C++ Support](./complete/cpp-support/) | Engine-free C++20 AFD core, published as `cpp-v0.1.0`; shared conformance and fresh tagged CMake consumers verified (#270, #327). |
| [Command Prerequisites](./complete/command-prerequisites/) | Declarative `requires` field for planning-order dependencies |
| [Contextual Tool Loading](./complete/contextual-tool-loading/) | Dynamic context scoping for large command sets |
| [Command Trust Config](./complete/command-trust-config/) | Per-command trust levels and exposure control |
| [Command Exposure & Undo](./complete/command-exposure-undo/) | Command visibility and undo support |
| [Command Pipeline](./complete/command-pipeline/) | Declarative command chaining |
| [Handoff Pattern](./complete/handoff-pattern/) | Real-time protocol handoff |
| [Lazy Loading & Discovery](./complete/lazy-loading-discovery/) | `afd-discover`/`afd-detail`/`afd-call` tool strategy for lazy command enumeration |
| [Middleware Defaults](./complete/middleware-defaults/) | Zero-config observability bundle (`defaultMiddleware()`) |
| [Platform Utils](./complete/platform-utils/) | Cross-platform `exec`, `findUp` and GitHub/package-manager connectors in `afd-core` (#92) and Python (#155) |
| [Output Shape Predictability](./complete/output-shape-predictability/) | Optional `output` Zod schema for agent response shape introspection |
| [Rust Parity Closure](./complete/rust-parity/) | Closed the export-surface gap between TypeScript and Rust (78 missing exports to 0 in #181), tracked with `alfred parity`. The remaining behavioral work is Wave 2 of Language Parity Closure. |
| [Schema Complexity Scoring](./complete/schema-complexity-scoring/) | Weighted input schema complexity analysis |
| [Schema Examples](./complete/schema-examples/) | Concrete input examples on commands for agent consumption |
| [Semantic Quality Validation](./complete/semantic-quality-validation/) | Cross-command surface analysis for naming, schema overlap, injection |
| [View State](./complete/view-state/) | Unified UI view state management via `@lushly-dev/afd-view-state` commands |

## Proposed Features

| Feature | Description |
|---------|-------------|
| [Umbel](../../endpoints/umbel/README.md) | AFD Umbel, an empty Rust host for capability plugins over MCP and CLI, with knowledge, memory and context as first-party plugins; owner-approved direction, documented in `endpoints/umbel/` |
| [Loam](../../endpoints/loam/README.md) | AFD Loam, an application shell for AFD apps: a TypeScript kernel for the browser, Tauri desktop and hosted server, a FAST-AF chrome on a Violet design foundation and a TanStack AI copilot; shell-level projects, documents, multiplayer, identity, agent members, settings, experiments, overlays, a provider-agnostic copilot and an in-shell app builder that apps subscribe to; drafted 2026-10-30, awaiting review, documented in `endpoints/loam/` |
| [Browser-Safe Direct Registry](./proposed/browser-direct-registry/proposal.md) | A `/direct` entry point that runs the validating registry, journal, approvals (on WebCrypto) and AFD contexts in a browser or webview |
| [Declared Context Fields](./proposed/declared-context-fields/proposal.md) | Host-declared, schema-validated request values carried in `_meta` and in process, with the journal recording the ones declared safe so dependent calls replay |
| [Agent Engine](./proposed/agent-engine/proposal.md) | Research and proposed new packages for modular, controllable, ongoing agentic work |
| [Chat History Panel](./proposed/chat-history-panel/) | Chat history UI component |
| [Code Client](./proposed/code-client/) | Code-based client research |
| [Design to Code](./proposed/design-to-code/) | Figma-to-code generation pipeline |
| [MCP Authorization](./proposed/mcp-authorization/mcp-authorization.proposal.md) | OAuth resource-server role for HTTP MCP servers: RFC 9728 metadata, audience checks, per-command scopes (MCP follow-on, rank 2) |
| [MCP Progress](./proposed/mcp-progress/mcp-progress.proposal.md) | A progress hook on the command context, delivered as MCP progress notifications, `/stream` chunks and DirectClient callbacks (MCP follow-on, rank 3) |
| [MCP Tasks](./proposed/mcp-tasks/mcp-tasks.proposal.md) | Long-running commands as `io.modelcontextprotocol/tasks` tasks (MCP follow-on, rank 4; wait) |
| [Multi-Tool Registration](./proposed/multi-tool-registration/) | Batch MCP tool registration |
| [Plugin Discovery](./proposed/plugin-discovery/) | Auto-discovery of AFD plugins |
| [Rust Distribution](./proposed/rust-distribution/) | Rust-based distribution layer |
| [Rust Support](./proposed/rust-support/) | Core crate published as 0.1.0; broader MCP transport and distribution proposal remains open |
| [Skill Knowledge Layer](./proposed/skill-knowledge-layer/) | Skills as structured knowledge for agents |
| [Zero Chat Tools](./proposed/zero-chat-tools/) | Canvas-aware AFD commands for Zero chat agent |

### Lifecycle audit (2026-10-25, #349)

Each proposed folder was compared with the code on `main`, merged PRs and the active and complete plans. A folder moves only when the evidence supports it.

| Folder | Disposition | Evidence and remaining scope |
|--------|-------------|------------------------------|
| platform-utils | Complete (moved) | TypeScript #92, Python #155; no remaining scope |
| rust-support | Proposed, partially shipped | Core, WASM, crates.io 0.1.0 (#379) and the `server` feature (#394) shipped; `cargo-dist`, proc macro and examples, and client interop remain |
| rust-distribution | Proposed (research) | Mint is a private framework in another repository; nothing in this repo |
| code-client | Proposed (research) | No code-generation client in `packages/client` |
| design-to-code | Proposed | No Figma or schema-export code in the repo |
| multi-tool-registration | Proposed | No `afd register` command in `packages/cli` |
| plugin-discovery | Proposed | No `AfdPlugin` or discovery option in `afd-server` |
| skill-knowledge-layer | Proposed | No `skill` option, `validateCommandSkills()` or `skill-docs` command |
| chat-history-panel | Proposed | No session-history UI; `packages/examples/chat` is a WebSocket server |
| zero-chat-tools | Proposed | Targets the external `fabric-ux-prototype` app |

No folder is superseded. Each proposal opens with a dated disposition note.

## Feature Structure

Each feature folder contains:

```
feature-name/
├── proposal.md      # The what/why (required)
├── spec.md          # The how (after approval)
├── STATUS.md        # Exactly what is done and not done, how it was verified, and follow-ups not yet issues; kept current by every session once work starts
└── assets/          # Diagrams, screenshots (optional)
```

> **Plan files and `.gitignore`.** `.gitignore` ignores `*.plan.md` everywhere except `docs/features/active/` (and `PLAN/` and `archive/`). A `*.plan.md` written under `proposed/` or `complete/` is silently left out of commits; `git status` does not list it. Name plans outside `active/` without the `.plan` suffix, for example `complete/<feature>/plan.md`, and check that `git status` shows any new plan file before committing.

A status file exists so that an agent never has to scan the codebase to learn what is current: it names what is done with evidence, what is not, and what future sessions must know. The [Umbel status](../../endpoints/umbel/docs/STATUS.md) is the reference shape.

## Workflow

```
Proposed → Review → Active → Implementation → Complete
```
