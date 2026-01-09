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
| [Platform Utils](./active/platform-utils/) | Cross-platform subprocess and connectors | In Progress |

## Complete Features

| Feature | Description | Issue |
|---------|-------------|-------|
| [Handoff Pattern](./complete/handoff-pattern/) | Real-time protocol handoff | [#18](https://github.com/lushly-dev/afd/issues/18) |
| [Command Pipeline](./complete/command-pipeline/) | Declarative command chaining | — |

## Feature Structure

Each feature folder contains:

```
feature-name/
├── proposal.md      # The what/why (required)
├── spec.md          # The how (after approval)
└── assets/          # Diagrams, screenshots (optional)
```

## Workflow

See [/review-proposal](/lushbot/.agent/workflows/review-proposal.md) and [/create-spec](/lushbot/.agent/workflows/create-spec.md) workflows.
