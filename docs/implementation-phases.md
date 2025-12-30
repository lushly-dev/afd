# Implementation Phases

This guide outlines a phased approach to implementing AFD in your project. Each phase builds on the previous one, progressively expanding capabilities while maintaining the command-first discipline.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    AFD IMPLEMENTATION PHASES                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PHASE 1          PHASE 2            PHASE 3          PHASE 4  │
│  Foundation  →   Expansion     →    Refinement   →   Ecosystem │
│                                                                 │
│  • Core           • More             • UI              • Third   │
│    commands         commands           surfaces          party   │
│  • CLI            • Deeper           • Trust           • Plugin  │
│    validation       integrations       signals           arch    │
│  • Basic          • Validation       • Error           • Cross   │
│    errors           suite              recovery          product │
│                                                                 │
│  [Weeks 1-4]      [Weeks 5-8]        [Weeks 9-12]     [Ongoing] │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Phase 1: Foundation

**Goal**: Establish the command layer as the source of truth.

**Duration**: 2-4 weeks

### Key Activities

1. **Define Core Commands**
   - Identify the 5-10 most critical actions in your application
   - Define schemas for each command
   - Focus on `success`, `data`, and `error` fields first

2. **Set Up CLI Validation**
   - Configure `afd` CLI or equivalent tool
   - Create scripts to call each command
   - Document expected inputs/outputs

3. **Implement Basic Error Handling**
   - Standardize error codes
   - Add `message` and `suggestion` to all errors
   - Ensure errors are actionable

4. **Create Command Registry**
   - Central place to register all commands
   - Auto-generate documentation from schemas
   - Enable command discovery

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Command schemas | TypeScript/JSON schemas for core commands |
| CLI scripts | Scripts to invoke each command |
| Error catalog | List of error codes with meanings |
| Command registry | Central registration and discovery |

### Command Schema Focus

In Phase 1, focus on core fields:

```typescript
interface Phase1Result<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    retryable?: boolean;
  };
}
```

### Validation Criteria

Before moving to Phase 2:
- [ ] All core commands work via CLI
- [ ] Error handling is consistent
- [ ] Commands are documented
- [ ] Basic tests exist for happy path

---

## Phase 2: Capability Expansion

**Goal**: Broaden command coverage and deepen integrations.

**Duration**: 3-4 weeks

### Key Activities

1. **Expand Command Coverage**
   - Add commands for secondary features
   - Cover edge cases in existing commands
   - Add batch/bulk variants where useful

2. **Deepen Integrations**
   - Connect to external systems via commands
   - Implement MCP server for agent access
   - Add API endpoints that wrap commands

3. **Build Validation Suite**
   - Comprehensive tests for all commands
   - Error case coverage
   - Performance benchmarks

4. **Add UX-Enabling Fields**
   - Start adding `confidence` to AI-powered commands
   - Add `sources` where applicable
   - Add `plan` for multi-step commands

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Full command set | Commands for all application features |
| MCP server | Agent-accessible command interface |
| Test suite | Comprehensive automated tests |
| API layer | REST/GraphQL wrapping commands |

### Command Schema Focus

In Phase 2, add UX-enabling fields:

```typescript
interface Phase2Result<T> extends Phase1Result<T> {
  // Add these fields to AI-powered commands
  confidence?: number;
  sources?: Source[];
  plan?: PlanStep[];
}
```

### Validation Criteria

Before moving to Phase 3:
- [ ] 90%+ feature coverage via commands
- [ ] MCP server functional
- [ ] Test coverage > 80%
- [ ] AI commands include confidence scores

---

## Phase 3: Experience Refinement

**Goal**: Build polished user experiences on the proven command layer.

**Duration**: 3-4 weeks

### Key Activities

1. **Build UI Surfaces**
   - Create UI components that invoke commands
   - Ensure UI behavior matches CLI behavior exactly
   - Add loading states, error displays

2. **Implement Trust Signals**
   - Display confidence indicators
   - Show reasoning/sources
   - Visualize plans for multi-step operations

3. **Error Recovery UX**
   - User-friendly error messages
   - Retry mechanisms
   - Fallback behaviors

4. **Polish and Consistency**
   - Consistent interaction patterns
   - Accessibility compliance
   - Performance optimization

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| UI components | All features accessible via UI |
| Trust displays | Confidence meters, source links, plan views |
| Error recovery | Graceful error handling throughout |
| Accessibility audit | WCAG compliance verified |

### Command Schema Focus

In Phase 3, ensure all UX fields are populated:

```typescript
interface Phase3Result<T> extends Phase2Result<T> {
  // Ensure these are populated for relevant commands
  reasoning?: string;
  alternatives?: Alternative<T>[];
  warnings?: Warning[];
  metadata?: {
    executionTimeMs: number;
    traceId: string;
  };
}
```

### Validation Criteria

Before moving to Phase 4:
- [ ] UI feature parity with CLI
- [ ] Trust signals visible in UI
- [ ] Error recovery tested
- [ ] User testing completed

---

## Phase 4: Ecosystem Development

**Goal**: Enable third-party extensions and cross-product integration.

**Duration**: Ongoing

> **Security Consideration**: Phase 4 involves third-party code execution. Before opening your command layer to external developers, establish authorization boundaries, sandboxing strategies, and audit requirements. See [Production Considerations](./production-considerations.md#security--authorization) for patterns.

### Key Activities

1. **Third-Party Commands**
   - Define command extension API
   - Create plugin architecture
   - Document extension guidelines
   - **Define permission model for third-party commands**

2. **Developer Tools**
   - SDK for command development
   - Testing utilities
   - Documentation generators

3. **Cross-Product Integration**
   - Shared command libraries
   - Consistent schemas across products
   - Federated command discovery

4. **Community Building**
   - Public command marketplace (if applicable)
   - Contribution guidelines
   - Example implementations

### Deliverables

| Deliverable | Description |
|-------------|-------------|
| Extension API | Documented API for third-party commands |
| SDK | Developer tools for command creation |
| Marketplace | Discovery mechanism for shared commands |
| Documentation | Comprehensive guides and examples |

### Command Schema Focus

In Phase 4, standardize for ecosystem:

```typescript
// Commands should be fully self-describing
interface EcosystemCommand<I, O> {
  name: string;
  version: string;
  description: string;
  
  input: JsonSchema<I>;
  output: JsonSchema<O>;
  errors: ErrorDefinition[];
  
  // Ecosystem metadata
  author?: string;
  license?: string;
  repository?: string;
  dependencies?: string[];
}
```

---

## Command Design Checklist

Before a command is considered "Phase 2 complete," verify it passes this checklist. Use this as a gate before building UI surfaces.

### Core Requirements (All Commands)

| Check | Question | Pass Criteria |
|-------|----------|---------------|
| ☐ **Schema defined** | Are inputs/outputs fully specified? | JSON Schema or TypeScript types exist |
| ☐ **CLI testable** | Can you call it via `afd call`? | Command executes successfully |
| ☐ **Error codes documented** | Are all error cases enumerated? | Error catalog includes this command |
| ☐ **Errors actionable** | Does every error have a `suggestion`? | No opaque "Something went wrong" |
| ☐ **Happy path tested** | Does the basic case work? | Automated test exists |
| ☐ **Edge cases covered** | Are boundary conditions handled? | Tests for empty input, max length, etc. |

### AI-Powered Commands (Additional)

| Check | Question | Pass Criteria |
|-------|----------|---------------|
| ☐ **Confidence returned** | Is `confidence` included? | 0-1 score in response |
| ☐ **Confidence calibrated** | Is confidence meaningful? | Not always 1.0 or 0.5 |
| ☐ **Reasoning provided** | Is `reasoning` included? | Explains "why" in response |
| ☐ **Sources attributed** | Is `sources` included (if applicable)? | External data is cited |

### Mutation Commands (Additional)

| Check | Question | Pass Criteria |
|-------|----------|---------------|
| ☐ **Idempotency considered** | Is retrying safe? | Either idempotent or has idempotency key |
| ☐ **Concurrency considered** | What if two calls race? | Either last-write-wins or has version check |
| ☐ **Effects visible** | Can user see what changed? | Response or plan shows modifications |

> **Note**: For production mutation commands, also review [Production Considerations](./production-considerations.md#mutation-safety) for patterns like preview/apply and undo tokens.

### Quick Validation Script

```bash
#!/bin/bash
# validate-command.sh <command-name>

COMMAND=$1

echo "Testing $COMMAND..."

# 1. Can it be called?
afd call $COMMAND --help || exit 1

# 2. Does it return structured data?
afd call $COMMAND <test-args> --format json | jq . || exit 1

# 3. Does error case have suggestion?
afd call $COMMAND --invalid-arg 2>&1 | jq '.error.suggestion' || echo "WARN: No suggestion in error"

# 4. (AI commands) Does it return confidence?
afd call $COMMAND <test-args> | jq '.confidence' || echo "WARN: No confidence field"

echo "✅ $COMMAND passed basic validation"
```

---

## Phase Transitions

### Phase 1 → Phase 2: "Honesty Check"

Ask: Can every core feature be done via CLI?

```bash
# Run this for each feature
afd call <command> --<args>

# If ANY feature can't be CLI-invoked, don't proceed
```

### Phase 2 → Phase 3: "Trust Check"

Ask: Do AI-powered commands return trust-enabling data?

```bash
# Verify confidence is returned
afd call ai.analyze --input "test" | jq '.confidence'

# Verify sources are returned
afd call ai.recommend --input "test" | jq '.sources'
```

### Phase 3 → Phase 4: "Integration Check"

Ask: Can external systems use our commands reliably?

```bash
# Test via MCP
curl -X POST http://localhost:3100/message -d '{"method": "tools/call", ...}'

# Test via API
curl -X POST http://localhost:8080/api/command/content.review
```

---

## Anti-Patterns by Phase

### Phase 1 Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Building UI first | Skips validation | Command first, always |
| Vague error messages | Not actionable | Include `suggestion` |
| No CLI scripts | Can't validate | Create scripts immediately |

### Phase 2 Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| UI-specific commands | Breaks agent access | Commands are surface-agnostic |
| Inconsistent schemas | Confusing for consumers | Standardize early |
| Skipping confidence | No trust calibration | Add to all AI commands |

### Phase 3 Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| UI diverges from CLI | Behavior inconsistency | UI must invoke same commands |
| Hiding errors | Erodes trust | Show errors with recovery options |
| Ignoring confidence | Missed trust signals | Display confidence in UI |

### Phase 4 Anti-Patterns

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Breaking changes | Ecosystem disruption | Version commands properly |
| Poor documentation | Adoption friction | Generate docs from schemas |
| No validation for extensions | Quality issues | Require tests for extensions |

---

## Timeline Example

For a medium-complexity application:

| Week | Phase | Focus |
|------|-------|-------|
| 1-2 | Foundation | Core commands, CLI setup |
| 3-4 | Foundation | Error handling, registry |
| 5-6 | Expansion | More commands, MCP server |
| 7-8 | Expansion | Test suite, UX fields |
| 9-10 | Refinement | UI surfaces, trust signals |
| 11-12 | Refinement | Error recovery, polish |
| 13+ | Ecosystem | Extensions, SDK, docs |

---

## Measuring Progress

### Phase 1 Metrics

| Metric | Target |
|--------|--------|
| Core commands defined | 5-10 |
| CLI validation scripts | 100% of commands |
| Error codes documented | 100% |

### Phase 2 Metrics

| Metric | Target |
|--------|--------|
| Total commands | All features covered |
| Test coverage | > 80% |
| MCP tools available | 100% of commands |
| AI commands with confidence | 100% |

### Phase 3 Metrics

| Metric | Target |
|--------|--------|
| UI feature parity | 100% |
| Trust signals displayed | All AI features |
| Error recovery implemented | All error types |
| User satisfaction | Measured via testing |

### Phase 4 Metrics

| Metric | Target |
|--------|--------|
| Third-party commands | Growing |
| SDK downloads | Growing |
| Documentation coverage | 100% |
| Community contributions | Active |

---

## Related

- [Command Schema Guide](./command-schema-guide.md) - Schema design for each phase
- [Trust Through Validation](./trust-through-validation.md) - Why validation matters
- [Production Considerations](./production-considerations.md) - Security, mutation safety for Phase 3-4
- [Agentic AI UX Design Principles](/Agentic%20AI%20UX%20Design%20Principles/09-Agentic-AI-Implementation-Strategy-and-Roadmap.md) - UX implementation strategy
