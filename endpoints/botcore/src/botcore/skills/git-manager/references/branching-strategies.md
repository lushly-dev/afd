# Branching Strategies

Detailed comparison of modern git branching strategies with selection criteria, trade-offs, and implementation guidance.

## Trunk-Based Development

The entire team commits to a single main branch (the "trunk"). Feature branches, if used at all, live for hours -- never more than a day or two. CI/CD pipelines run on every commit. Feature flags gate incomplete work.

### When to Use

- Continuous deployment to production (SaaS, web services)
- Team has mature CI/CD with comprehensive automated tests
- Organization values fast feedback loops over release control
- Microservices architecture where each service deploys independently

### Setup

```
main (trunk)
  ├── developer commits directly (small teams)
  └── short-lived branches (large teams)
       ├── feat/add-search (merged within hours)
       └── fix/null-check (merged within hours)
```

### Rules

1. **No long-lived branches** -- Feature branches last hours, not days
2. **Feature flags for incomplete work** -- Never merge broken features; gate them
3. **CI must pass before merge** -- Automated tests are the quality gate
4. **Small, frequent commits** -- Multiple merges per developer per day
5. **No release branches** -- Deploy from main using tags or automated releases
6. **Revert over fix-forward** -- If a bad commit hits main, revert immediately

### Scaling for Large Teams (10+ Developers)

- Allow short-lived feature branches (max 1-2 days)
- Require PR review but keep review cycles under 4 hours
- Use merge queues (GitHub merge queue, Mergify) to prevent broken main
- Pair with stacked PRs for dependent changes

### Trade-offs

| Advantage | Disadvantage |
|---|---|
| Fastest integration cycle | Requires strong CI/CD |
| Minimal merge conflicts | Feature flags add complexity |
| Always-deployable main | Bad commits affect everyone immediately |
| Simplest mental model | Requires team discipline |

## GitHub Flow

A lightweight branching model: developers create feature branches from main, open pull requests, get reviews, and merge. Main is always deployable. Releases happen from main via tags or automation.

### When to Use

- Regular but not continuous deployment (weekly, biweekly)
- Teams that need PR-based code review
- Web applications and APIs with a single production version
- Small to medium teams (2-20 developers)

### Setup

```
main
  ├── feat/user-dashboard ──── PR ──── merge to main
  ├── fix/login-timeout ────── PR ──── merge to main
  └── docs/api-reference ───── PR ──── merge to main
```

### Rules

1. **Main is always deployable** -- Never merge broken code
2. **Feature branches from main** -- Always branch from the latest main
3. **Descriptive branch names** -- `feat/`, `fix/`, `docs/`, `chore/` prefixes
4. **Open PR early** -- Draft PRs for visibility, even before code is complete
5. **Review before merge** -- At least one approval required
6. **Delete branches after merge** -- Keep the branch list clean
7. **Deploy from main** -- Tag for releases, or deploy on every merge

### Branch Naming Convention

```
<type>/<short-description>

Types: feat, fix, docs, refactor, test, chore, perf, ci, build
Examples:
  feat/oauth-token-refresh
  fix/cart-total-rounding
  docs/api-v2-migration-guide
  refactor/extract-query-builder
```

### Trade-offs

| Advantage | Disadvantage |
|---|---|
| Simple to understand | No built-in support for versioned releases |
| PR-based review workflow | Branch lifetime can drift if reviews are slow |
| Works with most CI/CD setups | No staging branch concept |
| Good GitHub integration | Not ideal for multiple production versions |

## GitFlow

A structured branching model with dedicated branches for development, releases, and hotfixes. Best for projects that maintain multiple production versions or have scheduled release cycles.

### When to Use

- Versioned software releases (mobile apps, libraries, SDKs, enterprise)
- Multiple production versions maintained simultaneously
- Regulatory or compliance requirements for release gates
- Infrequent, scheduled releases (monthly, quarterly)

### Setup

```
main (production)
  └── develop (integration)
       ├── feature/user-auth ──── merge to develop
       ├── feature/dashboard ──── merge to develop
       └── release/1.2.0 ──────── merge to main + develop
            └── hotfix/1.2.1 ──── merge to main + develop
```

### Branch Types

| Branch | Lifetime | Branches From | Merges To |
|---|---|---|---|
| `main` | Permanent | -- | -- |
| `develop` | Permanent | `main` | -- |
| `feature/*` | Temporary | `develop` | `develop` |
| `release/*` | Temporary | `develop` | `main` + `develop` |
| `hotfix/*` | Temporary | `main` | `main` + `develop` |

### Rules

1. **Never commit directly to main or develop**
2. **Features branch from develop** -- Merge back to develop via PR
3. **Release branches freeze features** -- Only bug fixes allowed
4. **Hotfixes from main** -- Emergency fixes bypass develop
5. **Tag every release** -- `v1.2.0` on main after release merge
6. **Keep develop up to date** -- Merge release and hotfix changes back

### When to Avoid GitFlow

- Continuous deployment projects (too much overhead)
- Small teams deploying frequently (GitHub Flow is simpler)
- Microservices (each service should have its own simple flow)
- Single-version SaaS products (no need for release branches)

### Trade-offs

| Advantage | Disadvantage |
|---|---|
| Clear release process | High branching complexity |
| Supports multiple versions | Frequent merge conflicts between branches |
| Hotfix isolation | Slow integration (features wait for releases) |
| Good for compliance | Overhead for small teams |

## Stacked PRs

Break large features into small, dependent pull requests that build on each other. Each PR is reviewable and mergeable independently (from bottom of stack up).

### When to Use

- Large features that benefit from incremental review
- Trunk-based development with complex changes
- Teams that value small, focused PRs
- Projects where review turnaround is a bottleneck

### Setup

```
main
  └── stack/auth-types ──── PR #1 (base, targets main)
       └── stack/auth-service ──── PR #2 (targets stack/auth-types)
            └── stack/auth-middleware ──── PR #3 (targets stack/auth-service)
```

### Workflow

1. Create the base branch and PR targeting main
2. Create each subsequent branch from the previous one
3. Each PR targets the branch below it in the stack
4. Review and merge from bottom up
5. After merging the base, retarget the next PR to main

### Tools

| Tool | Description |
|---|---|
| **Graphite** | Full stacked PR workflow with CLI and GitHub integration |
| **ghstack** | Facebook's tool for stacking PRs on GitHub |
| **git-town** | Git workflow automation including stacked branches |
| **spr** | Simple stacked PR tool from Evernote |
| **stack-pr** | Open-source tool from Modular (2026) |

### Challenges

- **Rebase cascade** -- Changing a base PR requires rebasing all PRs above it
- **Merge order matters** -- Must merge bottom-up
- **CI runs per PR** -- Each PR in the stack needs its own CI run
- **Manual management is error-prone** -- Use tooling to manage the stack

## Comparison Matrix

| Dimension | Trunk-Based | GitHub Flow | GitFlow | Stacked PRs |
|---|---|---|---|---|
| Complexity | Low | Low | High | Medium |
| Merge frequency | Very high | High | Low | High |
| Branch lifespan | Hours | Days | Days-weeks | Days |
| Release control | Tags/automation | Tags/automation | Release branches | Per-stack |
| CI/CD requirement | High | Medium | Low | High |
| Code review | Optional/async | PR-based | PR-based | PR-based |
| Conflict risk | Very low | Low | High | Low |
| Team adoption curve | Medium | Easy | Steep | Medium |

## Agentic Considerations

When AI agents work within these strategies:

- **Trunk-based**: Agents should create short-lived branches even if the team commits directly, to allow human review before merge
- **GitHub Flow**: Agents follow the standard branch-PR-merge flow; always push to a named branch, never to main
- **GitFlow**: Agents must understand which branch to base from (develop for features, main for hotfixes)
- **Stacked PRs**: Agents can propose stack structures but should not auto-merge stacks without human review of each layer
