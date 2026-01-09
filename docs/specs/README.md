# AFD Specifications

Technical specifications for AFD features. These are living documents that evolve with the codebase.

## Active Specs

| Spec | Description | GitHub Issue |
|------|-------------|--------------|
| [Rust Support](./rust-support/00-overview.md) | Rust as third language for AFD | [#15](https://github.com/lushly-dev/afd/issues/15) |
| [Rust Distribution (Mint)](./rust-distribution/00-overview.md) | Multi-platform distribution framework | [#16](https://github.com/lushly-dev/afd/issues/16) |
| [Design-to-Code](./design-to-code/00-overview.md) | Figma-to-AFD code generation | [#17](https://github.com/lushly-dev/afd/issues/17) |
| [Handoff Pattern](./handoff-pattern/00-overview.md) | Commands that bootstrap specialized protocols | [#18](https://github.com/lushly-dev/afd/issues/18) |

## Spec Structure

Each spec folder contains:
- `00-overview.md` - Summary, goals, success criteria
- Numbered detail files for each component/phase

## Related

- **[GitHub Issues](https://github.com/lushly-dev/afd/issues)** - Work tracking, acceptance criteria
- **[GitHub Projects](https://github.com/orgs/lushly-dev/projects)** - Project boards

## Archive

Completed/shipped specs are in [Archive/](./Archive/):
- `in-process-binding/` - DirectClient (shipped)
- `jtbd-testing/` - Testing framework (shipped)
- `multi-stack-examples/` - Todo example (shipped)
- `performance/` - Performance optimizations
- `afd_example_compliance.plan.md` - Example compliance (shipped)
- `handoff-pattern-v1.md` - Original concept (superseded by full spec)
