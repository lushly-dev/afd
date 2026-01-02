# AFD Implementation Plans

This folder contains planning documents for future AFD features and integrations.

## Folder Structure

```
PLAN/
├── Archive/                    # ✅ Completed plans
│   ├── multi-stack-examples/   # Todo example with TS/Python backends, Vanilla/React frontends
│   ├── performance/            # Performance optimizations
│   └── jtbd-testing/           # JTBD Scenario Testing Framework (4 phases complete)
│
├── design-to-code/            # ❌ NOT STARTED - Figma + AFD integration
│   └── 00-overview.md         # Design-to-code pipeline with Figma Make
│
├── rust-distribution/         # ❌ NOT STARTED - Mint distribution framework
│   └── 00-overview.md         # Multi-platform deployment (depends on rust-support)
│
└── rust-support/              # ❌ NOT STARTED - Rust implementation for AFD
    └── 00-overview.md         # Add Rust as third language to AFD
```

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ Completed | All phases implemented, moved to Archive |
| 🟡 Partial | Some phases complete, work in progress |
| ❌ Not Started | Future work, planning only |

## Current Priorities

### Future Work (Not Started)

1. **Rust Support** (`rust-support/`) - Prerequisite for Mint
2. **Mint Distribution** (`rust-distribution/`) - Multi-platform deployment
3. **Design-to-Code** (`design-to-code/`) - Figma integration

## Completed Work (Archive)

### JTBD Testing Framework

Jobs-to-be-Done scenario testing for validating complete user workflows.

**Deliverables**:
- Phase 1: Core Framework (YAML parser, executor, fixtures, step references)
- Phase 2: Command Suite (list, evaluate, coverage, create)
- Phase 3: Agent Integration (MCP server, tools, agent hints, suggestions)
- Phase 4: Multi-App Support (adapters, registry, todo/generic adapters)

**Tests**: 169 passing | **Location**: `packages/testing/`

### Multi-Stack Examples

Demonstrates AFD's core promise: "commands ARE the application, surfaces are interchangeable"

**Deliverables**:
- TypeScript backend (11 commands)
- Python backend (11 commands)
- Vanilla JS frontend (with trust signals)
- React frontend
- Shared test runner
- Conformance test suite

**Location**: `packages/examples/todo/`

### Performance

Performance optimizations for command execution.

---

## Adding New Plans

When creating new plans:

1. Create a folder with descriptive name (e.g., `feature-name/`)
2. Add `00-overview.md` as the entry point
3. Number sub-plans: `01-component.md`, `02-component.md`, etc.
4. Update this README with status

When completing plans:

1. Move folder to `Archive/`
2. Update this README
3. Update CHANGELOG.md with accomplishments
