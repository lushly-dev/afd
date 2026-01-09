# AFD Documentation

> Agent-First Development — where commands are the application and UI is just one surface.

## Structure

| Folder | Purpose |
|--------|---------|
| [guides/](./guides/) | Conceptual guides, schema patterns, philosophy |
| [specs/](./specs/) | Approved specifications with GitHub issues |
| [proposals/](./proposals/) | Draft specifications pending approval |
| [whitepaper/](./whitepaper/) | High-level vision and architecture documents |

## Quick Links

### Guides

- [Philosophy](./guides/philosophy.md) — Why "commands first" matters
- [Command Schema Guide](./guides/command-schema-guide.md) — Designing agent-friendly commands

### Specifications

- [Handoff Pattern](./specs/handoff-pattern/) — Real-time protocol handoff for streaming connections

### Proposals

- [Command Pipeline](./proposals/command-pipeline/) — Chain commands declaratively (under review)

## Workflow

```
Proposal → Review → Spec → GitHub Issues → Implementation
```

1. **Proposal** — Draft in `proposals/` for discussion
2. **Spec** — Approved, moved to `specs/`, GitHub issues created
3. **Archive** — Completed specs archived in `specs/Archive/`
