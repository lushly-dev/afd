# AFD Implementation Plans

This folder contains planning documents for AFD features. **Task tracking is in GitHub Issues/Projects**, these docs are reference only.

## Active Work

| Feature | GitHub | Status |
|---------|--------|--------|
| **Rust cargo-dist** | [Issue #15](https://github.com/lushly-dev/afd/issues/15) | Ready |
| **Mint Distribution** | [Project #2](https://github.com/orgs/lushly-dev/projects/2) | Future |
| **Design-to-Code** | [Project #3](https://github.com/orgs/lushly-dev/projects/3) | Future |

## Documentation Index

### Rust Support (`rust-support/`)
Adds Rust as third language to AFD (TS, Python, Rust).

- [00-overview.md](./rust-support/00-overview.md) - Requirements, timeline, success criteria
- [01-afd-rust.md](./rust-support/01-afd-rust.md) - Full implementation details

### Mint Distribution (`rust-distribution/`)
Private framework for multi-platform deployment (12+ targets).

- [00-overview.md](./rust-distribution/00-overview.md) - Vision, architecture, phases
- [01-mint.md](./rust-distribution/01-mint.md) - Core Mint framework
- [02-service-layer.md](./rust-distribution/02-service-layer.md) - Database/Storage abstractions
- [03-ui-heads.md](./rust-distribution/03-ui-heads.md) - CLI/Web/Desktop/Mobile heads
- [04-testing-conformance.md](./rust-distribution/04-testing-conformance.md) - 4-layer testing
- [05-collaboration-sync.md](./rust-distribution/05-collaboration-sync.md) - Real-time sync
- [06-future-phases.md](./rust-distribution/06-future-phases.md) - Voice, Watch, etc.

### Design-to-Code (`design-to-code/`)
Figma-to-AFD code generation pipeline.

- [00-overview.md](./design-to-code/00-overview.md) - Pipeline overview
- [01-afd-schema-layer.md](./design-to-code/01-afd-schema-layer.md) - Schema exposure
- [02-figma-plugin.md](./design-to-code/02-figma-plugin.md) - Plugin implementation
- [03-figma-make-generation.md](./design-to-code/03-figma-make-generation.md) - Code generation
- [04-documentation-pipeline.md](./design-to-code/04-documentation-pipeline.md) - Auto-docs
- [05-validation-sync.md](./design-to-code/05-validation-sync.md) - Design/code sync
- [06-implementation-roadmap.md](./design-to-code/06-implementation-roadmap.md) - Rollout

### Other Documentation

- [AFD-Executive-Summary.md](./AFD-Executive-Summary.md) - High-level overview
- [handoff-pattern.md](./handoff-pattern.md) - Agent handoff patterns

## Archived (Completed)

See [Archive/](./Archive/) for completed plans:
- `in-process-binding/` - DirectClient implemented (PR #13)
- `multi-stack-examples/` - Todo example with TS/Python backends
- `performance/` - Performance optimizations
- `jtbd-testing/` - JTBD Scenario Testing Framework
