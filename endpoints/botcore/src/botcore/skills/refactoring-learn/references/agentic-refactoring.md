# Agentic Refactoring

Guidelines for AI agents performing code refactoring safely and effectively. Based on empirical research (2024-2026) and production experience with tools like Claude Code, Cursor, Copilot, Devin, and Kiro.

---

## Empirical Findings

Large-scale studies of agentic refactoring (15,000+ refactoring instances across 12,000+ PRs) reveal key patterns:

### What Agents Do Well

- **Low-level consistency refactorings** -- Rename Variable (8.5%), Rename Parameter (10.4%), Change Variable Type (11.8%) dominate agentic refactoring
- **Maintainability improvements** -- 52.5% of agentic refactorings target maintainability
- **Readability improvements** -- 28.1% target readability
- **Structural metric gains** -- Small but statistically significant reductions in class size (LOC median delta = -15.25) and weighted method complexity (WMC median delta = -2.07)

### Where Agents Fall Short

- **High-level architectural refactoring** -- Agents perform 43.0% high-level changes vs. humans at 54.9%
- **Design smell elimination** -- Agents improve basic metrics but fail to meaningfully reduce actual design smells
- **Modularity and duplication** -- Human refactoring more frequently targets modularity and duplication removal
- **Commit hygiene** -- Agents often mix refactoring with functional changes, making rollback harder

### Key Statistic

83.8% of agent-assisted PRs are eventually accepted and merged, with developers relying on agents most for refactoring, documentation, and testing tasks.

---

## Safety Guardrails

### The Cardinal Rules

1. **Never refactor without tests** -- If test coverage is insufficient, write characterization tests first
2. **Never combine refactoring with behavior changes** -- Each commit should be either a refactoring or a behavior change, never both
3. **Never refactor multiple patterns simultaneously** -- One refactoring type per commit
4. **Always verify with tests after each step** -- Run the test suite after every atomic refactoring
5. **Never delete code in the same PR that introduces its replacement** -- Keep old and new paths coexisting until the new path is validated

### Pre-Refactoring Checklist

Before the agent begins any refactoring:

```
1. [ ] Tests exist and pass for the code being refactored
2. [ ] The refactoring goal is clearly defined (not "clean up everything")
3. [ ] The scope is bounded (specific files, functions, or patterns)
4. [ ] A rollback strategy exists (feature flag, revert commit)
5. [ ] The change is incremental, not a big-bang rewrite
```

### Commit Discipline

Each commit should:

- Contain exactly one refactoring operation
- Have a descriptive message naming the refactoring (e.g., "Extract Function: calculateDiscount from processOrder")
- Pass all tests
- Be independently revertible without breaking other commits in the PR

---

## Leveraging IDE/Language Server Tools

Modern agentic refactoring tools (Kiro, Cursor) integrate with IDE refactoring infrastructure for guaranteed correctness.

### Why Language Server Refactoring Is Preferred

| Approach | Correctness | Coverage | Speed |
|----------|------------|----------|-------|
| LLM text generation | Approximate | May miss references | Fast |
| Regex/AST transforms | Exact for pattern | Limited to pattern | Fast |
| Language server (LSP) | Guaranteed | All references in project | Moderate |

### Available Language Server Refactorings

When a language server is available, prefer these over text-based transforms:

- **Rename Symbol** -- Updates all references across the project
- **Extract Function/Method** -- Creates function with correct parameters and return type
- **Inline Variable/Function** -- Replaces all usages with the definition
- **Move File/Symbol** -- Updates all import paths
- **Change Signature** -- Updates all call sites
- **Extract Interface** -- Creates interface from class with correct members

### When to Fall Back to Text-Based Refactoring

- No language server available for the language
- Cross-language refactoring (e.g., renaming an API endpoint used by frontend and backend)
- Pattern-based refactoring (e.g., replacing all instances of a deprecated API pattern)
- Configuration file refactoring (YAML, JSON, TOML)

---

## Agentic Refactoring Workflow

### Phase 1: Assessment

```
1. Identify the code smell or improvement opportunity
2. Assess test coverage for the affected area
3. Map all callers and dependencies
4. Determine the appropriate refactoring technique
5. Estimate scope and risk
```

### Phase 2: Preparation

```
1. If test coverage is insufficient, write characterization tests
2. Create a feature flag if the refactoring is non-trivial
3. Identify seams for safe modification
4. Plan the sequence of atomic changes
```

### Phase 3: Execution

```
1. Apply one atomic refactoring
2. Run tests -- if they fail, diagnose and fix or revert
3. Commit with descriptive message
4. Repeat for next atomic refactoring
5. After all changes, run full test suite
```

### Phase 4: Validation

```
1. Verify all tests pass
2. Review the diff for unintended changes
3. Check that no behavior was altered (refactoring only)
4. Verify performance is not degraded (for hot paths)
5. Request human review for architectural changes
```

---

## Scope Control

### Appropriate Agent Scope

Agents should independently handle:

- Rename refactorings (variable, function, class, file)
- Extract function/method from clearly bounded code blocks
- Inline trivially simple functions or variables
- Replace magic numbers with named constants
- Simplify conditional logic (guard clauses, decompose conditional)
- Replace loop with pipeline
- Introduce parameter objects for repeated parameter groups

### Require Human Approval

Agents should propose but not independently execute:

- Extract class or module (architectural boundary decisions)
- Move functions between modules (ownership decisions)
- Replace inheritance with delegation (design paradigm change)
- Strangler fig or branch by abstraction (multi-PR strategy)
- Delete deprecated code paths (risk assessment)
- Change public API signatures (breaking change assessment)
- Introduce new abstractions or design patterns

---

## Common Pitfalls

### Over-Refactoring

Agents sometimes refactor code that does not need it. Signs of over-refactoring:

- Creating abstractions for a single use case ("premature abstraction")
- Extracting functions that are only called once and add no clarity
- Introducing design patterns where simple procedural code suffices
- Splitting classes that are cohesive into fragments

### Naming Regressions

Agents may rename for consistency but lose domain-specific meaning:

```typescript
// BEFORE: Domain-rich name
function calculateMortgageAmortization(principal, rate, term) { ... }

// BAD agent rename: Lost domain context
function calculate(p, r, t) { ... }

// GOOD agent rename: Preserved domain meaning, improved consistency
function calculateMortgageAmortizationSchedule(principal, annualRate, termInMonths) { ... }
```

### Incomplete Migrations

Agent starts a refactoring pattern but does not complete it across the codebase, leaving the code in a mixed state:

- **Prevention:** Agent should grep for all instances before starting and plan the full migration
- **Detection:** After refactoring, agent should search for remaining instances of the old pattern
- **Resolution:** Either complete the migration or revert to the old pattern everywhere

### Refactoring Without Understanding

Agent applies a refactoring pattern mechanically without understanding the code's intent:

- **Prevention:** Agent should read surrounding context, comments, and tests before refactoring
- **Detection:** Renamed entities lose domain meaning; extracted functions have generic names
- **Resolution:** Agent should be able to explain WHY the refactoring improves the code, not just WHAT it changes
