# Agentic Migration Workflows Reference

## Overview

Agentic migration uses AI agents to discover, plan, transform, verify, and land code changes at scale. The agent acts as a junior engineer supervised by a human lead -- it proposes changes that are verified automatically and approved by a developer before merging.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Migration Orchestrator              │
│                                                      │
│  1. Discovery ──> 2. Planning ──> 3. Transform       │
│       │                │               │              │
│       v                v               v              │
│  Find all          Sequence        Generate           │
│  locations         changes         diffs              │
│                                                      │
│  4. Verify ────> 5. Review ────> 6. Land             │
│       │               │               │              │
│       v               v               v              │
│  Build/test       Human           Merge in           │
│  passes           approval        batches            │
└─────────────────────────────────────────────────────┘
```

## Phase 1: Discovery

The agent identifies all locations in the codebase that need to change.

### Discovery Methods

| Method | Best for | Tool |
|---|---|---|
| AST query | Structural patterns (function calls, imports) | jscodeshift, ts-morph, libcst |
| Regex/grep | Text patterns (string literals, comments) | ripgrep, grep |
| Type analysis | Type-based patterns (all usages of a type) | TypeScript compiler, mypy |
| Semantic search | Fuzzy patterns (similar but not identical code) | LLM embeddings, code search |
| Dependency graph | Transitive dependents of a changed module | Build system, import analysis |

### Discovery Output

```typescript
interface DiscoveryResult {
  filePath: string;
  lineRange: [number, number];
  matchType: "exact" | "fuzzy" | "transitive";
  context: string;       // Surrounding code for agent context
  confidence: number;    // 0-1, how confident the match is correct
  complexity: "simple" | "moderate" | "complex";
}
```

### Agentic Discovery Tips

- Start with high-confidence exact matches (AST queries, grep)
- Use LLM semantic search for patterns that vary in implementation
- Include transitive dependents -- changing a function signature affects all callers
- Produce a manifest of all discovered locations for human review before proceeding

## Phase 2: Planning

The agent sequences discovered locations into an execution order that minimizes risk and maximizes parallelism.

### Sequencing Rules

1. **Leaf nodes first** -- Change files with no downstream dependents before files that other files depend on
2. **Group by module** -- Changes within a single module/package should be batched together
3. **Separate schema from code** -- Database schema changes should be sequenced independently from application code changes
4. **Independent batches** -- Group changes that do not affect each other into parallel batches

### Batch Sizing

| Codebase size | Recommended batch size | Rationale |
|---|---|---|
| < 50 files affected | 1 batch (all at once) | Small enough for one review |
| 50-200 files | 5-10 files per batch | Manageable review chunks |
| 200-1000 files | 10-25 files per batch | Balance between speed and review quality |
| > 1000 files | 25-50 files per batch | Large campaigns need structured batches |

### Migration Plan Template

```markdown
## Migration: [Name]
**Total locations**: [N] files, [M] change sites
**Estimated batches**: [B]
**Pattern**: [source pattern] -> [target pattern]

### Batch 1: [Description]
- [ ] file_a.ts (simple, leaf node)
- [ ] file_b.ts (simple, leaf node)

### Batch 2: [Description]
- [ ] file_c.ts (moderate, depends on batch 1)
- [ ] file_d.ts (moderate, depends on batch 1)

### Manual Review Required
- [ ] file_e.ts (complex, business logic intertwined)
```

## Phase 3: Transform

The agent generates the actual code changes for each discovered location.

### Transform Strategies

| Strategy | When to use | Accuracy | Speed |
|---|---|---|---|
| Deterministic codemod | Well-defined AST pattern | Very high | Very fast |
| LLM-generated edit | Fuzzy or context-dependent pattern | High | Moderate |
| Hybrid (codemod + LLM) | Mix of simple and complex patterns | Very high | Moderate |
| Template-based | Boilerplate generation | Very high | Very fast |

### Hybrid Transform Workflow

```
1. Run deterministic codemod on all discovered locations
2. Identify locations where the codemod failed or produced no change
3. For each unhandled location:
   a. Extract the surrounding code context
   b. Provide the LLM with: source pattern, target pattern, context, examples
   c. LLM generates the specific edit for that location
4. Collect all changes (codemod + LLM) into a unified diff
```

### LLM Transform Prompt Template

```
You are performing a code migration. Transform the following code from the old pattern to the new pattern.

## Old Pattern
[Description and example of the old pattern]

## New Pattern
[Description and example of the new pattern]

## Rules
- Preserve all existing functionality
- Maintain the same variable names where possible
- Keep comments and formatting
- Do not change unrelated code

## Code to Transform
```[language]
[code]
```

## Expected Output
Provide ONLY the transformed code, no explanations.
```

### Transform Quality Checks

Before submitting for verification:
- **Syntax check** -- Parse the output to ensure it is valid syntax
- **Diff size check** -- Unusually large diffs may indicate the LLM rewrote more than intended
- **Scope check** -- Verify that only the targeted pattern was changed, not surrounding code
- **Idempotency check** -- Running the transform again should produce no further changes

## Phase 4: Verify

Every generated change must pass automated verification before human review.

### Verification Pipeline

```
Change ──> Syntax Check ──> Build ──> Type Check ──> Lint ──> Test ──> Pass/Fail
```

| Check | Purpose | Tool |
|---|---|---|
| Syntax parse | File is valid syntax | Language parser |
| Build | Project compiles | Build system (tsc, cargo, go build) |
| Type check | No type errors introduced | tsc, mypy, pyright |
| Lint | No lint violations | eslint, ruff, clippy |
| Unit tests | No regressions | jest, pytest, cargo test |
| Integration tests | Cross-module behavior preserved | Test suite |
| Snapshot tests | UI output unchanged (if applicable) | Jest snapshots, Percy |

### Handling Verification Failures

When a change fails verification:

1. **Log the failure** -- Record which check failed and the error message
2. **Attempt self-repair** -- If the error is simple (missing import, type mismatch), the agent can attempt a fix
3. **Limit retries** -- Allow at most 3 self-repair attempts before escalating
4. **Escalate to human** -- If self-repair fails, flag the location for manual intervention
5. **Do not skip** -- Never merge a change that fails verification

### Self-Repair Loop

```
Generate Change ──> Verify
                      │
                 Pass? ──> Yes ──> Submit for Review
                      │
                      No
                      │
                 Attempt < 3? ──> Yes ──> Feed error back to agent
                      │                        │
                      No                       v
                      │                   Agent fixes and re-verifies
                      v
                 Escalate to Human
```

## Phase 5: Human Review

All agent-generated changes require human approval. This is non-negotiable.

### Review Workflow

1. Agent submits a pull request (or diff) for each batch
2. PR description includes:
   - Migration name and purpose
   - Number of files changed
   - Transform strategy used (codemod, LLM, hybrid)
   - Verification results (all checks passed)
   - Known limitations or edge cases
3. Reviewer checks:
   - Semantic correctness (does the change preserve behavior?)
   - Edge cases (are unusual patterns handled correctly?)
   - Completeness (are all instances migrated, or are some missed?)
4. Reviewer approves, requests changes, or flags for manual intervention

### Review Efficiency Tips

- Keep batches small enough to review in 15-30 minutes
- Group similar changes together so the reviewer can pattern-match
- Highlight any LLM-generated changes (vs. deterministic codemod) for extra scrutiny
- Provide before/after examples in the PR description

## Phase 6: Landing

Merge approved changes in a controlled manner.

### Landing Strategy

| Approach | When to use |
|---|---|
| Merge all at once | Small migration (< 50 files), all changes independent |
| Merge batch by batch | Medium migration, sequential dependencies between batches |
| Merge behind feature flag | Large or risky migration, needs production verification |
| Merge with staged rollout | User-facing changes, needs gradual traffic shift |

### Post-Landing Monitoring

After each batch lands:
- **Error rates** -- Check for increased error rates in affected services
- **Performance** -- Compare latency metrics before and after
- **Test stability** -- Watch for newly flaky tests
- **User reports** -- Monitor support channels for related issues
- **Rollback readiness** -- Ensure the batch can be reverted independently if needed

## Real-World Examples

### Google's LLM-Assisted Migrations

Google uses an automated algorithm combining change location discovery with LLM-generated edits. In a study of 39 migrations over 12 months:
- 69.46% of edits were generated by the LLM
- Developers reported high satisfaction with LLM-suggested modifications
- The approach handled migrations that had been stalled for years

Key lessons:
- LLMs have good representation and reasoning on code
- Regression test suites are essential for verification
- Some changes are rolled out in production slowly to observe effects

### Moderne's Multi-Repo Agent

Moderne combines deterministic OpenRewrite recipes with LLM-generated transforms:
- Thousands of existing recipes available as tools for the LLM
- Works across multiple repositories simultaneously
- Hybrid approach achieves higher accuracy than either method alone

### Aviator's Assisted Agents

Aviator's approach treats agents as junior engineers supervised by team leads:
- Agents iterate on solutions and receive feedback
- Search public and private documentation for migration guidance
- Analyze codebases in sandboxed environments
- Human review is mandatory for all agent-generated changes

## Safety Guardrails

### Must-Have Guardrails

1. **No auto-merge** -- Agent-generated changes never merge without human approval
2. **Build gate** -- Changes that fail build/test are never submitted for review
3. **Scope limit** -- Agent can only modify files within the defined migration scope
4. **Rollback plan** -- Every batch has a documented rollback procedure
5. **Rate limit** -- Limit the number of PRs an agent can create per hour/day
6. **Audit trail** -- Log every action the agent takes (discovery, transform, verify, submit)

### Should-Have Guardrails

7. **Diff size limit** -- Flag changes that modify more than N lines for extra review
8. **File exclusion** -- Exclude critical files (configs, secrets, infrastructure) from agent modification
9. **Canary batch** -- Always land the first batch manually and monitor before automating the rest
10. **Kill switch** -- Ability to halt all agent activity immediately

## Tooling for Agentic Migrations

| Tool | Type | Key capability |
|---|---|---|
| Claude Code | AI agent | Codebase analysis, transform generation, multi-file edits |
| Moderne | Platform | Multi-repo recipes + LLM, OpenRewrite ecosystem |
| Codemod.com | Platform | Community codemods, AI-assisted generation |
| Aviator | Platform | Assisted agents, migration campaigns |
| GitHub Copilot | AI assistant | In-editor migration suggestions |
| Sourcegraph | Search + batch | Code search, batch changes across repos |
| Trunk | CI/DevEx | Merge queues, test selection for migration PRs |
