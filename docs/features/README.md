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
| [Auth Adapter](./active/auth-adapter/) | Authentication adapter pattern for AFD servers | In Progress |

## Complete Features

| Feature | Description |
|---------|-------------|
| [AFD Bot (Alfred)](./complete/afd-bot/) | Deterministic repo quality agent with lint, parity, and quality commands |
| [Command Trust Config](./complete/command-trust-config/) | Per-command trust levels and exposure control |
| [Command Exposure & Undo](./complete/command-exposure-undo/) | Command visibility and undo support |
| [Handoff Pattern](./complete/handoff-pattern/) | Real-time protocol handoff |
| [Command Pipeline](./complete/command-pipeline/) | Declarative command chaining |

## Proposed Features

| Feature | Description |
|---------|-------------|
| [Platform Utils](./proposed/platform-utils/) | Cross-platform subprocess and connectors |
| [Design to Code](./proposed/design-to-code/) | Figma-to-code generation pipeline |
| [Rust Distribution](./proposed/rust-distribution/) | Rust-based distribution layer |
| [Rust Support](./proposed/rust-support/) | Rust language support for AFD |
| [AFD PyPI Publishing](./proposed/afd-pypi-publishing/) | Python package publishing |
| [Chat History Panel](./proposed/chat-history-panel/) | Chat history UI component |
| [Code Client](./proposed/code-client/) | Code-based client research |
| [Contextual Tool Loading](./proposed/contextual-tool-loading/) | Dynamic tool loading based on context |

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
