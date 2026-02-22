---
name: manage-git
source: botcore
description: >
  Orchestrates git workflows including branching strategies, release management, conflict resolution, changelog generation, and multi-agent parallel development. Covers trunk-based development, GitHub Flow, stacked PRs, conventional commits, semantic versioning, git worktrees, monorepo strategies, and git hooks automation. Use when choosing branching strategies, setting up release pipelines, resolving merge conflicts, configuring git hooks, managing changelogs, coordinating parallel agent work with worktrees, or adopting monorepo patterns. Triggers: git workflow, branching strategy, release management, merge conflict, changelog, git hooks, worktree, monorepo, semantic versioning, trunk-based, GitHub Flow, stacked PRs, git automation, parallel development.

version: 1.0.0
triggers:
  - git workflow
  - branching strategy
  - release management
  - merge conflict
  - changelog
  - git hooks
  - worktree
  - monorepo
  - semantic versioning
  - trunk-based development
  - GitHub Flow
  - stacked PRs
  - git automation
  - parallel development
  - release-please
  - changesets
  - husky
  - lefthook
  - lint-staged
portable: true
---

# Managing Git

Git workflow orchestration -- branching strategies, release management, conflict resolution, changelog generation, and multi-agent parallel development patterns.

## Capabilities

1. **Branching Strategy Selection** -- Evaluate and recommend trunk-based development, GitHub Flow, GitFlow, or stacked PRs based on team size and deployment cadence
2. **Release Management** -- Configure automated releases with semantic versioning, release-please, changesets, or semantic-release
3. **Conflict Resolution** -- Systematic merge conflict resolution including prevention strategies and agentic conflict handling
4. **Changelog Generation** -- Automated changelogs from conventional commits using release tooling
5. **Parallel Development** -- Git worktree setup for multi-agent and multi-feature parallel work
6. **Monorepo Git Patterns** -- Affected-only CI, sparse checkout, code ownership, and cross-package coordination
7. **Git Hooks Automation** -- Configure Husky, Lefthook, or lint-staged for pre-commit, pre-push, and commit-msg enforcement
8. **Agentic Git Workflows** -- Safe patterns for AI agents performing git operations with isolation and rollback

## Routing Logic

| Request Type | Load Reference |
|---|---|
| Branching strategy selection or comparison | [references/branching-strategies.md](references/branching-strategies.md) |
| Release pipelines, versioning, changelogs | [references/release-management.md](references/release-management.md) |
| Merge conflict resolution or prevention | [references/conflict-resolution.md](references/conflict-resolution.md) |
| Git worktrees, parallel agent work | [references/worktrees-parallel.md](references/worktrees-parallel.md) |
| Monorepo git patterns and tooling | [references/monorepo-strategies.md](references/monorepo-strategies.md) |
| Git hooks setup (Husky, Lefthook, lint-staged) | [references/git-hooks.md](references/git-hooks.md) |

## Core Principles

### 1. Prefer Trunk-Based Development

Short-lived branches merged frequently to main. This is a prerequisite for true CI/CD. Feature flags replace long-lived feature branches. Reserve GitFlow only for projects with strict versioned releases and multiple supported versions.

### 2. Automate Everything That Can Be Automated

Commit message linting, version bumps, changelog generation, release notes, and tag creation should all be automated. Manual release processes introduce human error and slow delivery.

### 3. Conventional Commits Are the Foundation

All release tooling (release-please, semantic-release, changesets) depends on structured commit messages. Enforce the Conventional Commits specification via commit-msg hooks. See the `write-commits` skill for message formatting.

### 4. Isolate Agent Work

AI agents performing git operations must work in isolated environments -- worktrees, separate branches, or sandboxed clones. Never allow agents to force-push to main or perform destructive operations without explicit human approval.

### 5. Resolve Conflicts Early

Merge frequently. Keep branches short-lived (hours to days, not weeks). Use consistent formatting (Prettier, Black, gofmt) to eliminate cosmetic conflicts. When conflicts arise, understand intent before choosing a resolution strategy.

### 6. One Concern Per Branch

Each branch addresses a single feature, fix, or refactor. Mixed-concern branches create review bottleneck, merge complexity, and unclear changelogs. Use stacked PRs for dependent changes.

## Strategy Selection Guide

Use this decision tree to choose a branching strategy:

```
Is your team deploying continuously to production?
├─ Yes: Trunk-Based Development
│   ├─ Team > 10 devs? → Add short-lived feature branches (1-2 days max)
│   └─ Need incremental reviews? → Add stacked PRs
├─ No, but deploying regularly (weekly/biweekly):
│   └─ GitHub Flow (feature branches + PR merge to main)
└─ No, versioned releases with multiple supported versions:
    └─ GitFlow or modified GitFlow
```

| Factor | Trunk-Based | GitHub Flow | GitFlow |
|---|---|---|---|
| Deploy cadence | Continuous | Regular | Versioned releases |
| Team size | Any (with feature flags) | Small to medium | Medium to large |
| Branch lifespan | Hours | Days | Days to weeks |
| CI/CD maturity | High (required) | Medium | Low to medium |
| Complexity | Low | Low | High |
| Best for | SaaS, microservices | Web apps, APIs | Mobile, libraries, enterprise |

## Workflow: Setting Up a Git Project

### Step 1: Choose Branching Strategy

Use the decision tree above. Document the chosen strategy in the project's CONTRIBUTING.md or AGENTS.md.

### Step 2: Configure Commit Enforcement

```bash
# Option A: Husky + commitlint (Node.js projects)
npm install -D husky @commitlint/cli @commitlint/config-conventional
npx husky init
echo 'npx commitlint --edit "$1"' > .husky/commit-msg

# Option B: Lefthook (polyglot projects)
brew install lefthook   # or: go install github.com/evilmartians/lefthook@latest
lefthook install
# Configure in lefthook.yml
```

### Step 3: Configure Release Automation

Choose one based on project needs:

| Tool | Best For | How It Works |
|---|---|---|
| **release-please** | Single packages, Google-style | Maintains a release PR, bumps on merge |
| **changesets** | Monorepos, multi-package | Contributors add changeset files, batch release |
| **semantic-release** | Fully automated, CI-driven | Releases on every qualifying merge to main |

### Step 4: Set Up Branch Protection

```
Main branch rules:
- Require PR reviews (1-2 reviewers)
- Require status checks to pass
- Require up-to-date branches before merge
- Require signed commits (optional but recommended)
- Restrict force pushes (always)
- Restrict deletions (always)
```

### Step 5: Configure Git Hooks

See [references/git-hooks.md](references/git-hooks.md) for detailed setup. At minimum:

- **commit-msg** -- Validate conventional commit format
- **pre-commit** -- Run linter and formatter on staged files
- **pre-push** -- Run type checks and fast tests

## Agentic Git Safety Rules

When an AI agent performs git operations, enforce these guardrails:

1. **Never force-push** -- Use `--force-with-lease` only when explicitly approved
2. **Never commit to main directly** -- Always work on a branch
3. **Never skip hooks** -- Do not use `--no-verify`
4. **Never amend shared commits** -- Only amend local, unpushed commits when explicitly requested
5. **Always verify before destructive ops** -- `reset --hard`, `clean -f`, `branch -D` require human confirmation
6. **Use worktrees for parallel work** -- Each agent session gets its own worktree
7. **Create atomic commits** -- One logical change per commit
8. **Include Co-Authored-By** -- Agent commits must attribute the AI co-author
9. **Prefer staging specific files** -- Use `git add <file>` over `git add .` or `git add -A`
10. **Review diff before committing** -- Always run `git diff --staged` before `git commit`

## Quick Reference: Common Operations

### Create a Feature Branch

```bash
git checkout main && git pull origin main
git checkout -b feat/short-description
# ... make changes ...
git add <specific-files>
git commit -m "feat(scope): add feature description"
git push -u origin feat/short-description
```

### Resolve a Merge Conflict

```bash
git fetch origin
git merge origin/main          # or: git rebase origin/main
# Fix conflicts in editor (look for <<<<<<<, =======, >>>>>>>)
git add <resolved-files>
git merge --continue           # or: git rebase --continue
```

### Create a Worktree for Parallel Work

```bash
git worktree add ../project-hotfix hotfix/issue-123
cd ../project-hotfix
# Work independently, then clean up:
git worktree remove ../project-hotfix
```

### Stacked PRs Workflow

```bash
# PR 1: Base change
git checkout -b stack/part-1
# ... changes ...
git push -u origin stack/part-1

# PR 2: Builds on PR 1
git checkout -b stack/part-2
# ... changes ...
git push -u origin stack/part-2
# Create PR targeting stack/part-1 (not main)
```

## Checklist

- [ ] Branching strategy chosen and documented
- [ ] Conventional commits enforced via commit-msg hook
- [ ] Release automation configured (release-please, changesets, or semantic-release)
- [ ] Branch protection rules applied to main
- [ ] Pre-commit hooks running linter and formatter
- [ ] Pre-push hooks running type checks and fast tests
- [ ] Agent git operations follow safety rules (no force-push, no direct main commits)
- [ ] Worktree strategy defined for parallel agent work
- [ ] Changelog generation automated from commit history
- [ ] Merge conflict prevention measures in place (short branches, consistent formatting)

## When to Escalate

- **Strategy disagreement** -- Team cannot agree on branching model; facilitate a decision meeting with trade-off analysis
- **Persistent merge conflicts** -- Same files conflict repeatedly; review code ownership boundaries and module architecture
- **Release pipeline failure** -- Automated versioning produces wrong results; audit commit history for non-conventional messages
- **Agent destructive operation** -- Agent requests force-push, reset --hard, or branch deletion; require explicit human approval
- **Monorepo scaling issues** -- CI times exceed tolerance; evaluate sparse checkout, affected-only builds, or repo splitting
- **Cross-team branch contention** -- Multiple teams blocking each other on shared branches; consider trunk-based development with feature flags
- **Security incident in hooks** -- Hooks executing arbitrary code or blocking critical operations; review hook permissions and sandboxing
