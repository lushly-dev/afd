# AFD Features

Feature specifications organized by lifecycle stage.

## Stages

| Stage | Description |
|-------|-------------|
| [proposed/](./proposed/) | Draft proposals awaiting review |
| [active/](./active/) | Approved features in implementation |
| [complete/](./complete/) | Shipped features (reference archive) |

## Active Features

Cross-language gaps (TypeScript, Python, Rust, C++) are tracked in [Language Parity](../language-parity.md). The plans below cover the export names for each language.

| Feature | Description |
|---------|-------------|
| [Python Parity Closure](./active/python-parity/) | Close the export-surface gap between TypeScript and Python. 97 names are missing; 60 of them are implemented but not exported. |
| [Rust Parity Closure](./active/rust-parity/) | Rust name closure is done: 9 names are missing, down from 78. The remaining work is behavioral; see Language Parity. |

## Complete Features

| Feature | Description |
|---------|-------------|
| [AFD Bot (Alfred)](./complete/afd-bot/) | Deterministic repo quality agent with lint, parity, and quality commands |
| [AFD PyPI Publishing](./complete/afd-pypi-publishing/) | Python package publishing to PyPI |
| [Auth Adapter](./complete/auth-adapter/) | Provider-agnostic authentication adapter for AFD servers |
| [Command Prerequisites](./complete/command-prerequisites/) | Declarative `requires` field for planning-order dependencies |
| [Contextual Tool Loading](./complete/contextual-tool-loading/) | Dynamic context scoping for large command sets |
| [Command Trust Config](./complete/command-trust-config/) | Per-command trust levels and exposure control |
| [Command Exposure & Undo](./complete/command-exposure-undo/) | Command visibility and undo support |
| [Command Pipeline](./complete/command-pipeline/) | Declarative command chaining |
| [Handoff Pattern](./complete/handoff-pattern/) | Real-time protocol handoff |
| [Lazy Loading & Discovery](./complete/lazy-loading-discovery/) | `afd-discover`/`afd-detail`/`afd-call` tool strategy for lazy command enumeration |
| [Middleware Defaults](./complete/middleware-defaults/) | Zero-config observability bundle (`defaultMiddleware()`) |
| [Output Shape Predictability](./complete/output-shape-predictability/) | Optional `output` Zod schema for agent response shape introspection |
| [Schema Complexity Scoring](./complete/schema-complexity-scoring/) | Weighted input schema complexity analysis |
| [Schema Examples](./complete/schema-examples/) | Concrete input examples on commands for agent consumption |
| [Semantic Quality Validation](./complete/semantic-quality-validation/) | Cross-command surface analysis for naming, schema overlap, injection |
| [View State](./complete/view-state/) | Unified UI view state management via `@lushly-dev/afd-view-state` commands |

## Proposed Features

| Feature | Description |
|---------|-------------|
| [C++ Support](./proposed/cpp-support/) | Engine-free C++20 implementation of AFD core, conformance-tested against `spec/wire` (#270). **Implemented:** v0.1 release candidate; it moves to `complete/` when `afd-cpp-v0.1.0` is tagged. |
| [Chat History Panel](./proposed/chat-history-panel/) | Chat history UI component |
| [Code Client](./proposed/code-client/) | Code-based client research |
| [Design to Code](./proposed/design-to-code/) | Figma-to-code generation pipeline |
| [Multi-Tool Registration](./proposed/multi-tool-registration/) | Batch MCP tool registration |
| [Platform Utils](./proposed/platform-utils/) | Cross-platform subprocess and connectors |
| [Plugin Discovery](./proposed/plugin-discovery/) | Auto-discovery of AFD plugins |
| [Rust Distribution](./proposed/rust-distribution/) | Rust-based distribution layer |
| [Rust Support](./proposed/rust-support/) | Rust language support for AFD |
| [Skill Knowledge Layer](./proposed/skill-knowledge-layer/) | Skills as structured knowledge for agents |
| [Zero Chat Tools](./proposed/zero-chat-tools/) | Canvas-aware AFD commands for Zero chat agent |

## Feature Structure

Each feature folder contains:

```
feature-name/
├── proposal.md      # The what/why (required)
├── spec.md          # The how (after approval)
└── assets/          # Diagrams, screenshots (optional)
```

## Workflow

```
Proposed → Review → Active → Implementation → Complete
```
