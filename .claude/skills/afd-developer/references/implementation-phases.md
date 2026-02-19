# Implementation Phases

A phased approach to implementing AFD. Each phase builds on the previous one.

## Overview

```
PHASE 1: Foundation   -> PHASE 2: Expansion    -> PHASE 3: Refinement -> PHASE 4: Ecosystem
- Core commands         - More commands           - UI surfaces          - Third party
- CLI validation        - Deeper integrations     - Trust signals        - Plugin arch
- Basic errors          - Validation suite        - Error recovery       - Cross product
[Weeks 1-4]            [Weeks 5-8]              [Weeks 9-12]          [Ongoing]
```

## Phase 1: Foundation

**Goal**: Establish the command layer as the source of truth.

1. Define 5-10 core commands with schemas
2. Set up CLI validation
3. Standardize error codes with `message` and `suggestion`
4. Create command registry with auto-generated docs

**Schema focus**: Core fields only (`success`, `data`, `error`).

**Exit criteria**:
- [ ] All core commands work via CLI
- [ ] Error handling is consistent
- [ ] Commands are documented
- [ ] Basic tests exist for happy path

## Phase 2: Capability Expansion

**Goal**: Broaden command coverage and deepen integrations.

1. Add commands for secondary features and edge cases
2. Implement MCP server for agent access
3. Build comprehensive test suite
4. Add UX-enabling fields (`confidence`, `sources`, `plan`)

**Exit criteria**:
- [ ] 90%+ feature coverage via commands
- [ ] MCP server functional
- [ ] Test coverage > 80%
- [ ] AI commands include confidence scores

## Phase 3: Experience Refinement

**Goal**: Build polished user experiences on the proven command layer.

1. Build UI components that invoke commands
2. Display confidence indicators, reasoning, sources
3. Implement error recovery UX
4. Performance optimization and accessibility

**Exit criteria**:
- [ ] UI feature parity with CLI
- [ ] Trust signals visible in UI
- [ ] Error recovery tested
- [ ] User testing completed

## Phase 4: Ecosystem Development

**Goal**: Enable third-party extensions and cross-product integration.

> **Security**: Before opening commands to external developers, establish authorization boundaries, sandboxing, and audit requirements.

1. Define command extension API and plugin architecture
2. SDK for command development
3. Cross-product shared command libraries
4. Community building and marketplace

## Command Design Checklist

Gate before building UI surfaces:

### Core Requirements (All Commands)
- [ ] Schema defined (inputs/outputs fully specified)
- [ ] CLI testable (`afd call` executes successfully)
- [ ] Error codes documented
- [ ] Errors actionable (every error has a `suggestion`)
- [ ] Happy path tested
- [ ] Edge cases covered

### AI-Powered Commands (Additional)
- [ ] Confidence returned (0-1 score)
- [ ] Confidence calibrated (not always 1.0 or 0.5)
- [ ] Reasoning provided
- [ ] Sources attributed (if applicable)

### Mutation Commands (Additional)
- [ ] Idempotency considered
- [ ] Concurrency considered
- [ ] Effects visible in response

## Phase Transitions

**Phase 1 -> 2: "Honesty Check"** -- Can every core feature be done via CLI?

**Phase 2 -> 3: "Trust Check"** -- Do AI commands return trust-enabling data?

**Phase 3 -> 4: "Integration Check"** -- Can external systems use commands reliably?

## Anti-Patterns by Phase

| Phase | Anti-Pattern | Solution |
|-------|-------------|----------|
| 1 | Building UI first | Command first, always |
| 1 | Vague error messages | Include `suggestion` |
| 2 | UI-specific commands | Commands are surface-agnostic |
| 2 | Skipping confidence | Add to all AI commands |
| 3 | UI diverges from CLI | UI must invoke same commands |
| 3 | Hiding errors | Show errors with recovery options |
| 4 | Breaking changes | Version commands properly |
| 4 | No validation for extensions | Require tests for extensions |
