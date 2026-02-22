---
name: find-duplicates
source: botcore
description: >
  Detects code duplication using hybrid analysis combining algorithmic (JSCPD) and semantic (AI) techniques. Covers Type-1 through Type-4 clone detection, safe refactoring workflows, and duplication prevention strategies. Use when scanning for copy-paste code, reducing code bloat, consolidating duplicate utilities, or improving DRY compliance. Triggers: duplicates, duplication, copy paste, code clone, DRY, refactor.

version: 1.0.0
triggers:
  - duplicates
  - duplication
  - copy paste
  - code clone
  - DRY
  - refactor
  - shared utility
  - jscpd
  - code smell
portable: true
---

# Finding Duplicates

Detect and eliminate code duplication using hybrid analysis -- algorithmic detection for syntactic clones, AI analysis for semantic clones.

## Why This Exists

AI agents create flat, duplicative codebases because they do not know existing
utilities unless they are in context, they implement first rather than searching
for existing code, and they lack refactoring instinct when patterns emerge. The
result is code bloat, inconsistency, and harder maintenance. This skill provides
the detection and remediation workflow.

## Capabilities

1. **Algorithmic detection** -- Run JSCPD to find Type-1/2/3 clones (exact copies, renamed variables, minor structural changes)
2. **Semantic detection** -- Use AI analysis to find Type-4 clones (same behavior, different implementation)
3. **Prevention** -- Search for existing utilities before writing new code to stop duplication at the source
4. **Prioritization** -- Triage duplicate findings by occurrence count and block size into actionable categories
5. **Safe refactoring** -- Guide Red-Green-Refactor consolidation of duplicates with test coverage

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Refactoring workflow, output format, cross-repo detection | [references/refactoring-guide.md](references/refactoring-guide.md) |

## Core Principles

### 1. Detect Before You Generate

The best duplication is the one that never happens. Before writing any new
utility function, search the codebase for existing implementations. Use
project-level search, grep, or vector-based discovery when available.

### 2. Three-Tier Detection

| Tier | Clone Types | Method | Speed |
|------|-------------|--------|-------|
| Syntactic | Type-1, 2, 3 | JSCPD (token-based) | Fast (~3s) |
| Semantic | Type-4 | AI / vector similarity | Slower (~30s) |
| Preventive | All | Search before generating | Real-time |

Always start with Tier 1 (fast, cheap). Escalate to Tier 2 when algorithmic
detection alone is insufficient. Apply Tier 3 as a habit for every new utility.

### 3. Clone Type Awareness

| Type | Description | Example |
|------|-------------|---------|
| Type-1 | Exact copy | Identical code in two files |
| Type-2 | Renamed identifiers | Same logic, different variable names |
| Type-3 | Structural variation | Added/removed statements, reordered blocks |
| Type-4 | Semantic equivalent | Different implementation, same behavior |

JSCPD catches Types 1-3. Only AI analysis reliably catches Type-4.

### 4. Prioritize by Value, Not Volume

Not all duplication warrants refactoring. Use this triage:

| Priority | Criteria | Action |
|----------|----------|--------|
| High | 3+ occurrences, >20 lines each | Extract to shared utility immediately |
| Medium | 2 occurrences, >10 lines each | Extract if touched again |
| Low | Small blocks, edge cases | Document and defer |

### 5. Safe Refactoring Only

Never consolidate duplicates without test coverage. Follow the Red-Green-Refactor
pattern: write tests covering all duplicate implementations first, verify they
pass, create the unified utility, update call sites, then confirm tests still pass.

## Quick Reference

### JSCPD Commands

```bash
# Scan current directory
lush discover duplicates

# Scan specific path
lush discover duplicates --path src/

# With custom threshold
lush discover duplicates --threshold 3
```

### JSCPD Configuration (`.jscpd.json`)

```json
{
  "threshold": 5,
  "reporters": ["json", "console"],
  "ignore": [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/__pycache__/**"
  ],
  "mode": "mild"
}
```

**Modes:** `strict` (exact only), `mild` (ignores whitespace/formatting),
`weak` (ignores comments and variable names -- finds Type-2).

### AI-Based Detection

```bash
# Run semantic analysis via subagent
lush-subagent run role='duplicates'
```

## Workflow

### Detection Phase

1. **Run algorithmic scan** -- Execute `lush discover duplicates --path <target>` for fast Type-1/2/3 results
2. **Review findings** -- Examine reported clone pairs with file locations and similarity percentages
3. **Run semantic scan** (optional) -- Execute `lush-subagent run role='duplicates'` for Type-4 clones
4. **Triage results** -- Categorize findings into High / Medium / Low priority using the table above

### Remediation Phase

5. **Write tests first** -- Create tests covering every duplicate implementation before changing anything
6. **Verify tests pass** -- Run the test suite to confirm tests pass against current (duplicated) code
7. **Create unified utility** -- Extract the shared logic into a single well-named function or module
8. **Update call sites** -- Replace all duplicate usages with imports from the new shared utility
9. **Verify tests still pass** -- Run the same tests against the unified implementation
10. **Document the extraction** -- Note what was consolidated and where the shared utility lives

## Checklist

- [ ] Algorithmic scan completed (JSCPD or equivalent)
- [ ] High-priority duplicates identified (3+ occurrences, >20 lines)
- [ ] Tests written covering all duplicate implementations before refactoring
- [ ] Unified utility created with clear naming and documentation
- [ ] All call sites updated to use the shared utility
- [ ] Test suite passes after consolidation
- [ ] No new duplication introduced during refactoring

## When to Escalate

- Cross-repo duplication requiring multi-repository analysis or shared packages
- Type-4 semantic clones where AI analysis produces uncertain or conflicting results
- Duplication embedded in generated code (protobuf, OpenAPI codegen) that cannot be refactored
- Consolidation would require breaking public API contracts or changing package boundaries
- Duplicate patterns are intentional (e.g., platform-specific implementations that look similar but must diverge)
