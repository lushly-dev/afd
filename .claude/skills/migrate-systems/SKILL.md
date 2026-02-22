---
name: migrate-systems
source: botcore
description: >
  Guides orchestration of system migrations, framework upgrades, dependency version bumps, database schema evolution, and codemod generation with safe incremental transformation patterns. Covers strangler fig, expand-contract, parallel run, dual-write verification, feature-flag-gated rollouts, AST-based codemods (jscodeshift, ts-morph, libcst), and agentic migration workflows where AI agents discover, transform, verify, and land changes at scale. Use when upgrading frameworks, migrating APIs, evolving database schemas, generating codemods, planning incremental migrations, or orchestrating large-scale automated refactors. Triggers: migrate, migration, upgrade, codemod, schema evolution, strangler fig, expand-contract, version bump, framework upgrade, dependency upgrade, database migration.

version: 1.0.0
triggers:
  - migrate
  - migration
  - upgrade
  - codemod
  - schema evolution
  - strangler fig
  - expand-contract
  - version bump
  - framework upgrade
  - dependency upgrade
  - database migration
  - major version
  - breaking change
  - parallel run
  - dual write
  - AST transform
portable: true
---

# Migrating Systems

Orchestrate safe, incremental system migrations -- framework upgrades, dependency bumps, database schema evolution, codemod generation, and agentic transformation workflows.

## Capabilities

1. **Plan migration strategy** -- Assess scope, risk, and sequencing for framework upgrades, API migrations, and dependency version bumps
2. **Apply incremental patterns** -- Use strangler fig, expand-contract, parallel run, and feature-flag-gated rollouts to migrate without downtime
3. **Generate and run codemods** -- Author AST-based transforms using jscodeshift (JS/TS), ts-morph (TS), or libcst (Python) to automate repetitive code changes
4. **Evolve database schemas** -- Execute zero-downtime schema migrations with expand-contract, shadow tables, and backward-compatible migrations
5. **Orchestrate dependency upgrades** -- Manage major version bumps across package ecosystems (npm, pip, cargo) with automated tooling and staged rollout
6. **Execute agentic migrations** -- Use AI agents to discover change locations, generate transforms, verify builds, and land changes with human-in-the-loop review
7. **Validate and verify** -- Run parallel verification, shadow traffic comparison, regression suites, and incremental rollout to confirm migration correctness

## Routing Logic

| Request type | Load reference |
|---|---|
| Incremental migration patterns (strangler fig, parallel run, feature flags) | [references/incremental-patterns.md](references/incremental-patterns.md) |
| Database schema evolution (expand-contract, zero-downtime) | [references/database-evolution.md](references/database-evolution.md) |
| Codemod authoring and AST tools (jscodeshift, ts-morph, libcst) | [references/codemod-authoring.md](references/codemod-authoring.md) |
| Agentic migration workflows (AI-assisted, large-scale) | [references/agentic-workflows.md](references/agentic-workflows.md) |
| Dependency upgrade workflows (npm, pip, cargo) | [references/dependency-upgrades.md](references/dependency-upgrades.md) |

## Core Principles

### 1. Incremental over Big-Bang

Never attempt a full rewrite or single-step cutover for non-trivial systems. Break migrations into thin vertical slices that each deliver value independently and can be rolled back without affecting other slices.

```
CORRECT:  Migrate one route/module/table at a time, verify, proceed
WRONG:    Rewrite entire system, switch over on a weekend
```

### 2. Always Be Shippable

Every intermediate state of a migration must be deployable to production. The codebase should never enter a "half-migrated" state that blocks other work or prevents emergency releases.

### 3. Old and New Coexist

Design for dual-mode operation. Both old and new implementations run simultaneously during the migration window, controlled by routing layers, feature flags, or facade patterns. Remove old code only after the new path is verified in production.

### 4. Verify Before You Cut Over

Use parallel run, shadow traffic, or dual-write verification to prove the new implementation matches the old before redirecting real traffic. Automated comparison catches differences that unit tests miss.

### 5. Automate Repetitive Transforms

When a migration requires the same mechanical change across many files, write a codemod rather than making manual edits. Codemods are reviewable, testable, and reproducible -- manual edits are error-prone at scale.

### 6. Backward-Compatible First

Database migrations, API changes, and schema evolutions should always expand before they contract. Add new columns/fields/endpoints first, migrate consumers, then remove old ones. Never drop before all readers have moved.

### 7. Human-in-the-Loop for Agentic Work

AI agents accelerate discovery and transformation but must not land changes without human review. Every agent-generated changeset requires build verification, test passage, and developer approval before merge.

## Workflow: Plan a Migration

1. **Inventory** -- List all components, modules, or services affected by the migration. Identify dependencies between them.
2. **Classify risk** -- Rate each component by blast radius (how many users/services depend on it) and complexity (how much logic changes).
3. **Choose pattern** -- Select the migration pattern based on risk and scope:

| Situation | Recommended pattern |
|---|---|
| Replacing a service or subsystem | Strangler fig |
| Database schema change | Expand-contract |
| Verifying behavioral equivalence | Parallel run / shadow traffic |
| Gradual user-facing rollout | Feature-flag-gated migration |
| Repetitive code transformation | Codemod |
| Large-scale cross-repo changes | Agentic migration workflow |

4. **Sequence slices** -- Order migration slices from lowest to highest risk. Start with leaf nodes (no downstream dependents) to build confidence.
5. **Define verification** -- For each slice, define what "correct" means: test suites, comparison queries, metric thresholds, or manual acceptance.
6. **Set rollback criteria** -- Specify the conditions that trigger a rollback and the procedure for reverting each slice.
7. **Execute iteratively** -- Migrate one slice, verify, stabilize, then proceed to the next. Never batch slices unless they are truly independent.

## Workflow: Execute a Framework Upgrade

1. **Read the migration guide** -- Check the framework's official upgrade guide, changelog, and known breaking changes before writing any code.
2. **Update tooling first** -- Upgrade CLI tools, linters, type-checking, and build plugins to versions that support the new framework version.
3. **Run official codemods** -- Apply any codemods provided by the framework maintainers (e.g., `react-codemod`, `@angular/core:migrations`, `django-upgrade`).
4. **Fix remaining breaks** -- Address compiler errors, type mismatches, and deprecated API usages that codemods did not cover.
5. **Update tests** -- Migrate test utilities and assertions to match new APIs (e.g., Enzyme to React Testing Library, TestBed changes).
6. **Verify in staging** -- Deploy the upgraded application to a staging environment and run the full test suite plus manual smoke tests.
7. **Roll out with flags** -- Use feature flags to gradually expose the upgraded code paths to production traffic.
8. **Clean up** -- Remove compatibility shims, polyfills, and dual-mode code once the migration is verified and stable.

## Workflow: Agentic Migration

1. **Define the transform** -- Write a clear specification of what changes: source pattern, target pattern, edge cases, and exclusions.
2. **Agent discovers locations** -- The agent searches the codebase for all instances matching the source pattern using AST queries, grep, or semantic search.
3. **Agent generates changes** -- For each location, the agent produces a diff using codemods, LLM-generated edits, or a hybrid approach.
4. **Automated verification** -- Each changeset is validated: build passes, tests pass, linter clean, type-check clean.
5. **Human review** -- A developer reviews the batch of changes, checking for semantic correctness that automated checks cannot catch.
6. **Staged landing** -- Changes are merged in batches (not all at once) to limit blast radius and allow incremental rollback.
7. **Monitor and iterate** -- After each batch lands, monitor error rates, performance metrics, and user reports before proceeding.

## Quick Reference: Migration Patterns

| Pattern | When to use | Key mechanism | Risk level |
|---|---|---|---|
| **Strangler fig** | Replacing a service/module | Facade routes traffic to old or new | Low -- gradual |
| **Expand-contract** | Schema/API evolution | Add new, migrate, remove old | Low -- reversible |
| **Parallel run** | Behavioral verification | Both systems process, compare outputs | Medium -- operational cost |
| **Shadow traffic** | Load/perf verification | Copy traffic to new system, discard results | Low -- no user impact |
| **Dual write** | Data store migration | Write to both stores, reconcile | Medium -- consistency risk |
| **Feature flag** | User-facing rollout | Flag controls which path executes | Low -- instant rollback |
| **Codemod** | Repetitive code changes | AST transform applied across codebase | Low -- reviewable diffs |
| **Agentic** | Large-scale cross-repo | AI discovers and transforms with verification | Medium -- requires review |

## Quick Reference: Codemod Tools

| Tool | Language | Engine | Best for |
|---|---|---|---|
| jscodeshift | JavaScript/TypeScript | recast (AST) | React migrations, API refactors |
| ts-morph | TypeScript | TypeScript compiler API | Type-aware transforms, complex TS |
| libcst | Python | Concrete syntax tree | Python upgrades, Django/Flask migrations |
| Codemod.com | Multi-language | jscodeshift + ts-morph + AI | Enterprise-scale, community codemods |
| react-codemod | React | jscodeshift | Class-to-hooks, version upgrades |
| OpenRewrite | Java/Kotlin | Lossless semantic trees | Spring Boot, Java version upgrades |
| Scalafix | Scala | SemanticDB | Scala 2-to-3, library upgrades |
| Rector | PHP | PHP-Parser | PHP/Laravel version upgrades |

## Checklist

- [ ] Migration scope inventoried -- all affected components, services, and schemas listed
- [ ] Risk classification completed for each migration slice
- [ ] Migration pattern selected and documented (strangler fig, expand-contract, etc.)
- [ ] Slices sequenced from lowest to highest risk
- [ ] Rollback procedure defined for each slice
- [ ] Verification criteria defined (tests, comparisons, metrics)
- [ ] Official migration guide and changelog reviewed
- [ ] Official codemods applied before manual changes
- [ ] Custom codemods written for repetitive transforms (if applicable)
- [ ] Codemods tested on representative samples before full run
- [ ] Database migrations are backward-compatible (expand before contract)
- [ ] Feature flags in place for gradual rollout (if applicable)
- [ ] Parallel run or shadow traffic verification completed (if applicable)
- [ ] All tests pass in both old and new code paths
- [ ] Staging deployment verified before production rollout
- [ ] Monitoring and alerting configured for migration metrics
- [ ] Old code, shims, and compatibility layers cleaned up after stabilization
- [ ] Agent-generated changes reviewed by a human before merge

## When to Escalate

- **Cross-system data migrations** -- If the migration involves moving data between fundamentally different storage engines (e.g., RDBMS to document store) with complex consistency requirements, involve a data architect
- **Breaking API contracts** -- If an external-facing API must introduce breaking changes, coordinate with API consumers and consider a versioned rollout strategy beyond what flags alone can handle
- **Regulatory or compliance boundaries** -- If migrated systems handle PCI, HIPAA, or SOC 2 regulated data, involve compliance teams before changing data flows or storage
- **Multi-team coordination** -- If the migration spans more than 3 teams or repositories, designate a migration lead and establish a shared tracking mechanism
- **Performance-critical paths** -- If the migrated component is on a latency-sensitive hot path (p99 < 50ms), run load tests and shadow traffic verification before any production cutover
- **Irreversible schema changes** -- If a database migration cannot be rolled back (e.g., data loss on contract), require explicit sign-off from a senior engineer or DBA
- **Agent-generated changes at scale** -- If an agentic workflow will touch more than 500 files or 10 repositories, break into smaller campaigns and escalate review requirements
