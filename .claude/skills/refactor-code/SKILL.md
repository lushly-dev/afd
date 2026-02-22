---
name: refactor-code
source: botcore
description: >
  Guides systematic code refactoring using extract, inline, move, and rename patterns, dependency inversion, legacy modernization, and technical debt reduction. Covers code smell detection, safe transformation techniques (strangler fig, branch by abstraction, parallel change), and agentic refactoring guardrails for AI-assisted workflows. Use when improving code structure, reducing complexity, eliminating duplication, modernizing legacy systems, or managing technical debt. Triggers: refactor, extract method, inline, move function, rename, code smell, technical debt, legacy code, dependency inversion, strangler fig, codemod.

version: 1.0.0
triggers:
  - refactor
  - refactoring
  - extract method
  - extract function
  - inline
  - move function
  - rename
  - code smell
  - technical debt
  - tech debt
  - legacy code
  - legacy modernization
  - dependency inversion
  - strangler fig
  - branch by abstraction
  - codemod
  - dead code
  - duplication
  - clean up code
  - simplify
  - decompose
portable: true
---

# Refactoring Code

Systematic code refactoring -- extract, inline, move, and rename patterns, dependency inversion, legacy modernization, technical debt reduction, and safe transformation techniques for agentic workflows.

## Capabilities

1. **Refactoring Pattern Application** -- Apply extract, inline, move, rename, and composing patterns from the Fowler catalog to improve code structure
2. **Code Smell Detection** -- Identify bloaters, couplers, change preventers, dispensables, and OO abusers with structured reporting
3. **Safe Transformation Execution** -- Use strangler fig, branch by abstraction, parallel change, and feature flag techniques for risk-controlled refactoring
4. **Dependency and Architecture Refactoring** -- Apply SOLID principles, dependency inversion, module boundary restructuring, and anti-corruption layers
5. **Technical Debt Management** -- Prioritize debt using cost-impact matrices and the debt quadrant, allocate refactoring budgets, and track reduction over time
6. **Agentic Refactoring with Guardrails** -- Perform AI-agent-driven refactoring with commit discipline, scope control, and safety checks grounded in empirical research
7. **Legacy Code Modernization** -- Introduce seams, adapters, and facades to make legacy code testable and incrementally replaceable
8. **Automated Refactoring via Codemods** -- Generate and apply AST-based transformations for large-scale pattern migrations

## Routing Logic

| Request Type | Reference |
|---|---|
| Specific refactoring patterns (extract, inline, move, rename) | [refactoring-catalog.md](references/refactoring-catalog.md) |
| Safe transformation techniques (strangler fig, parallel change) | [safe-transformation-techniques.md](references/safe-transformation-techniques.md) |
| Code smell identification and remedies | [code-smells.md](references/code-smells.md) |
| SOLID principles, DI, architecture, codemods | [dependency-and-architecture.md](references/dependency-and-architecture.md) |
| Technical debt prioritization and budget | [technical-debt-management.md](references/technical-debt-management.md) |
| Agentic workflow safety and guardrails | [agentic-refactoring.md](references/agentic-refactoring.md) |

## Core Principles

### 1. Behavior Preservation Is Non-Negotiable

<rules>
Refactoring changes code structure WITHOUT changing observable behavior. If behavior changes, it is NOT a refactoring -- it is a rewrite, a feature, or a bug fix. Never combine refactoring commits with behavior-changing commits.
</rules>

- Every refactoring step must pass the existing test suite
- If tests do not exist for the code being refactored, write characterization tests first
- Use the Red-Green-Refactor cycle: make tests pass first, then refactor the passing code

### 2. Small Steps, Always

<rules>
Apply one refactoring operation per commit. Run tests after each operation. If tests fail, revert and try a smaller step. Never batch multiple unrelated refactorings into a single commit.
</rules>

- Each commit should be independently revertible
- Name commits after the refactoring: "Extract Function: calculateDiscount from processOrder"
- If a refactoring requires prerequisite changes, address prerequisites in separate commits first

### 3. Measure Before Optimizing Structure

<rules>
Never refactor based on intuition alone. Use static analysis, git history, and test coverage data to identify what needs refactoring and to verify improvements after refactoring.
</rules>

- Identify hotspots: files with high churn AND high complexity
- Measure cyclomatic complexity, coupling, class size before and after
- Check git blame and history to understand why code is structured as it is

### 4. Tests Are the Safety Net

- If coverage is insufficient, invest in characterization tests before refactoring
- Characterization tests capture CURRENT behavior, not intended behavior
- After refactoring, all existing tests must pass without modification (unless the test was testing internal structure, not behavior)

### 5. Refactoring Is Not Rewriting

| Refactoring | Rewriting |
|---|---|
| Incremental, step-by-step | Big-bang replacement |
| Tests pass at every step | Tests may break during transition |
| Low risk, easy to revert | High risk, hard to revert |
| Preserves behavior by definition | May change behavior intentionally |
| Can be done alongside feature work | Usually requires a dedicated effort |

## Workflow

### Step 1: Identify the Target

- Detect code smells via static analysis, code review, or developer intuition
- Check git history for churn hotspots (`git log --name-only` analysis)
- Review test coverage for the target area
- Assess severity using the cost-impact matrix (see [technical-debt-management.md](references/technical-debt-management.md))

### Step 2: Assess Safety

- Verify test coverage -- if insufficient, write characterization tests first
- Map all callers and dependents of the code being refactored
- Determine if the change can be made atomically or needs a safe transformation technique
- For non-trivial changes, plan a feature flag or parallel run strategy

### Step 3: Choose the Technique

| Situation | Recommended Technique |
|---|---|
| Complex expression hard to read | Extract Variable |
| Long function doing multiple things | Extract Function |
| Function body is clearer than its name | Inline Function |
| Logic belongs in another class/module | Move Function |
| Name does not communicate intent | Rename |
| Conditional logic is convoluted | Decompose Conditional, Guard Clauses |
| Replacing a perimeter component | Strangler Fig |
| Replacing a deep internal component | Branch by Abstraction |
| Changing a public API signature | Parallel Change (Expand-Migrate-Contract) |
| High-risk algorithm replacement | Parallel Run (Shadow Testing) |
| Large-scale pattern migration (10+ files) | Codemod |

### Step 4: Execute

1. Apply one atomic refactoring
2. Run tests -- all must pass
3. Commit with descriptive message naming the refactoring
4. Repeat for the next atomic refactoring
5. After all changes, run the full test suite

### Step 5: Validate

- Confirm all tests pass
- Review the complete diff for unintended changes
- Verify no behavior was altered
- For hot paths, check that performance was not degraded
- For architectural changes, request human review

## Quick Reference: Code Smell to Refactoring

| Code Smell | Primary Refactoring | See |
|---|---|---|
| Long Method | Extract Function | [catalog](references/refactoring-catalog.md) |
| Large Class | Extract Class | [catalog](references/refactoring-catalog.md) |
| Primitive Obsession | Replace Primitive with Object | [catalog](references/refactoring-catalog.md) |
| Long Parameter List | Introduce Parameter Object | [catalog](references/refactoring-catalog.md) |
| Duplicated Code | Extract Function, Pull Up Method | [smells](references/code-smells.md) |
| Feature Envy | Move Function | [smells](references/code-smells.md) |
| Shotgun Surgery | Move Function, Inline Class | [smells](references/code-smells.md) |
| Divergent Change | Extract Class | [smells](references/code-smells.md) |
| Switch Statements | Replace Conditional with Polymorphism | [smells](references/code-smells.md) |
| Message Chains | Hide Delegate | [smells](references/code-smells.md) |
| Dead Code | Remove Dead Code | [smells](references/code-smells.md) |
| Speculative Generality | Collapse Hierarchy, Inline Class | [smells](references/code-smells.md) |

## Agentic Refactoring Rules

<rules>
When refactoring as an AI agent, these rules are mandatory:

1. NEVER combine refactoring with behavior changes in the same commit
2. NEVER refactor without verifying tests exist and pass
3. NEVER delete code in the same PR that introduces its replacement -- keep both paths until validated
4. NEVER batch multiple refactoring types in one commit
5. ALWAYS run tests after each atomic refactoring step
6. ALWAYS use language server / IDE refactoring tools when available (rename, extract, move) for guaranteed correctness
7. ALWAYS search for all references before renaming or moving
8. ALWAYS verify the complete migration -- search for remaining instances of the old pattern after refactoring
9. PREFER small, independently revertible commits over large batched changes
10. REQUIRE human approval for architectural changes (extract class/module, design pattern introduction, public API changes)
</rules>

### Agent Scope Boundaries

**Handle independently:**
- Rename (variable, function, class, file)
- Extract function from clearly bounded blocks
- Inline trivially simple functions or variables
- Replace magic numbers with named constants
- Simplify conditional logic (guard clauses, decompose conditional)
- Replace loop with pipeline
- Introduce parameter objects

**Propose, do not execute independently:**
- Extract class or module (architectural boundary)
- Move functions between modules (ownership change)
- Replace inheritance with delegation (paradigm change)
- Multi-PR transformation strategies (strangler fig, branch by abstraction)
- Delete deprecated code paths
- Change public API signatures

## Checklist

### Pre-Refactoring

- [ ] Target area identified via code smell detection, churn analysis, or review feedback
- [ ] Tests exist and pass for the code being refactored
- [ ] Scope is bounded -- specific files, functions, or patterns identified
- [ ] Refactoring technique selected based on the smell/situation
- [ ] For non-trivial changes: feature flag or rollback strategy planned

### During Refactoring

- [ ] One refactoring operation per commit
- [ ] Tests pass after each commit
- [ ] Commit messages name the specific refactoring applied
- [ ] No behavior changes mixed with structural changes
- [ ] All callers and references updated (verified with search)

### Post-Refactoring

- [ ] Full test suite passes
- [ ] No remaining instances of the old pattern (verified with grep)
- [ ] Diff reviewed for unintended changes
- [ ] Performance verified for hot paths
- [ ] Architectural changes reviewed by human
- [ ] Technical debt register updated (if applicable)

## When to Escalate

| Condition | Action |
|---|---|
| No tests exist and writing characterization tests is impractical | Escalate to tech lead -- refactoring without tests is high risk |
| Refactoring reveals a bug in existing behavior | Stop refactoring; file the bug separately; fix bug in its own PR |
| Circular dependencies prevent clean extraction | Escalate for architectural review -- may need domain redesign |
| Refactoring scope grows beyond the original target | Stop and re-scope; avoid refactoring creep |
| Legacy code has no documentation and behavior is unclear | Escalate to domain expert; do not guess at intended behavior |
| Performance-critical path may be affected | Benchmark before and after; escalate if regression detected |
| Public API changes affect external consumers | Escalate for breaking change review and versioning decision |
| Agent encounters conflicting code patterns across the codebase | Escalate for team alignment on the canonical pattern |
