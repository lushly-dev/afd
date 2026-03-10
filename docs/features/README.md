# AFD Features

Feature specifications organized by lifecycle stage.

## Stages

| Stage | Description |
|-------|-------------|
| [proposed/](./proposed/) | Draft proposals awaiting review |
| [active/](./active/) | Approved features in implementation |
| [complete/](./complete/) | Shipped features (reference archive) |

## Active Features

| Feature | Description | Status |
|---------|-------------|--------|
| [Contextual Tool Loading](./active/contextual-tool-loading/) | Dynamic context scoping for large command sets | Spec Ready |
| [Output Shape Predictability](./active/output-shape-predictability/) | Declare output schemas so agents know response shapes | Spec Ready |
| [View State](./active/view-state/) | Unified UI view state management via commands | Planned |
| [Zero Chat Tools](./active/zero-chat-tools/) | Canvas-aware AFD commands for Zero chat agent | Spec Ready |

## Complete Features

| Feature | Description |
|---------|-------------|
| [AFD Bot (Alfred)](./complete/afd-bot/) | Deterministic repo quality agent with lint, parity, and quality commands |
| [Auth Adapter](./complete/auth-adapter/) | Provider-agnostic authentication adapter for AFD servers |
| [Command Prerequisites](./complete/command-prerequisites/) | Declarative `requires` field for planning-order dependencies |
| [Command Trust Config](./complete/command-trust-config/) | Per-command trust levels and exposure control |
| [Command Exposure & Undo](./complete/command-exposure-undo/) | Command visibility and undo support |
| [Command Pipeline](./complete/command-pipeline/) | Declarative command chaining |
| [Handoff Pattern](./complete/handoff-pattern/) | Real-time protocol handoff |
| [Lazy Loading & Discovery](./complete/lazy-loading-discovery/) | `afd-discover`/`afd-detail`/`afd-call` tool strategy for lazy command enumeration |
| [Middleware Defaults](./complete/middleware-defaults/) | Zero-config observability bundle (`defaultMiddleware()`) |
| [Schema Complexity Scoring](./complete/schema-complexity-scoring/) | Weighted input schema complexity analysis |
| [Schema Examples](./complete/schema-examples/) | Concrete input examples on commands for agent consumption |
| [Semantic Quality Validation](./complete/semantic-quality-validation/) | Cross-command surface analysis for naming, schema overlap, injection |

## Proposed Features

| Feature | Description |
|---------|-------------|
| [AFD PyPI Publishing](./proposed/afd-pypi-publishing/) | Python package publishing to PyPI |
| [Chat History Panel](./proposed/chat-history-panel/) | Chat history UI component |
| [Code Client](./proposed/code-client/) | Code-based client research |
| [Design to Code](./proposed/design-to-code/) | Figma-to-code generation pipeline |
| [Multi-Tool Registration](./proposed/multi-tool-registration/) | Batch MCP tool registration |
| [Platform Utils](./proposed/platform-utils/) | Cross-platform subprocess and connectors |
| [Plugin Discovery](./proposed/plugin-discovery/) | Auto-discovery of AFD plugins |
| [Rust Distribution](./proposed/rust-distribution/) | Rust-based distribution layer |
| [Rust Support](./proposed/rust-support/) | Rust language support for AFD |
| [Skill Knowledge Layer](./proposed/skill-knowledge-layer/) | Skills as structured knowledge for agents |

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
