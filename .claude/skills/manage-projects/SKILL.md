---
name: manage-projects
source: botcore
description: >
  Orchestrates GitHub Projects, issues, specs, and parallel Claude agent waves. Covers feature lifecycle (proposed/active/complete), issue templates with parent/sub-issue patterns, wave-based parallelization, STATUS.md tracking, and spec review workflows. Use when creating issues, managing feature lifecycles, launching parallel agent waves, tracking project status, or reviewing proposals and specs. Triggers: project management, create issue, launch agents, wave orchestration, STATUS.md, feature lifecycle, parallel development, spec review, proposal review.

version: 1.0.0
triggers:
  - project management
  - create issue
  - launch agents
  - wave orchestration
  - STATUS.md
  - feature lifecycle
  - parallel development
  - spec review
  - proposal review
portable: true
---

# Managing Projects

Expert guidance for orchestrating GitHub-based development with parallel Claude agents, feature lifecycles, and structured issue management.

## Capabilities

1. **Feature Lifecycle** -- Manage features through proposed, active, and complete stages with structured folder conventions
2. **Issue Orchestration** -- Create parent issues with sub-issue dependency graphs using standardized templates
3. **Wave-Based Parallelization** -- Launch parallel Claude agents grouped by dependency and file isolation constraints
4. **Status Tracking** -- Monitor agent progress via STATUS-{issue}.md files with YAML frontmatter
5. **Spec Review Workflow** -- Drive proposals through captured, draft, ready, and approved states with model-appropriate reviews
6. **CLI Agent Management** -- Launch, monitor, and close agent sessions via lush/lushx CLI commands

## Routing Logic

| Request Type | Load Reference |
|---|---|
| Feature folder structure, lifecycle stages | [references/feature-lifecycle.md](references/feature-lifecycle.md) |
| Issue templates, parent/sub-issue patterns | [references/issue-templates.md](references/issue-templates.md) |
| Wave orchestration, parallel agents, file isolation | [references/wave-orchestration.md](references/wave-orchestration.md) |
| STATUS.md tracking, templates, phases | [references/status-tracking.md](references/status-tracking.md) |
| Proposal/spec review, CLI handoff, audit output | [references/spec-review-workflow.md](references/spec-review-workflow.md) |
| CLI commands, lush agent launch/wave/status | [references/cli-commands.md](references/cli-commands.md) |

## Core Principles

### 1. Feature-Centric Organization

Features live in a three-stage directory structure:

```
docs/features/
  proposed/       # Draft proposals awaiting review
  active/         # Approved features in implementation
  complete/       # Shipped features (reference archive)
```

Each feature folder contains a `proposal.md` (the what/why), and upon approval a `spec.md` (the how), plus STATUS files per issue.

### 2. Proposal Status Lifecycle

Proposals use YAML frontmatter to track their review state:

| Status | Meaning | Next Action |
|---|---|---|
| `captured` | Idea captured, not yet refined | Refine scope, add details |
| `draft` | Being refined, not ready for review | Polish, get feedback |
| `ready` | Ready for Opus review | Run review workflow |
| `approved` | Passed review | Move to `active/`, create spec |

Move to `active/` only after Opus review approves and creates a spec.

### 3. Wave-Based Parallelization

Analyze dependencies and file overlap, then group issues into waves:

| Wave | Purpose | Constraint |
|---|---|---|
| Wave 0 | Infrastructure setup (test frameworks, tooling) | None |
| Wave 1 | Issues with no dependencies | Can start immediately |
| Wave 2 | Issues depending on Wave 1 | Must wait for Wave 1 |
| Wave 3 | Issues depending on Wave 2 | Must wait for Wave 2 |

**Critical rule:** Parallel agents MUST NOT work on the same files. If multiple tasks modify the same file, they must be sequenced, not parallelized.

### 4. STATUS File Tracking

Each issue gets a `STATUS-{issue}.md` file with YAML frontmatter tracking phase, agent assignment, and PR linkage. Phases: `not-started`, `in-progress`, `blocked`, `complete`.

### 5. Delegate to Claude Code Agents

Prefer spawning Claude Code agents over doing implementation work directly. The orchestrating agent should plan, coordinate, and merge -- not implement. Always spawn from the monorepo root for full skills and context access.

## Workflow

### Creating a Feature

1. Create a proposal in `docs/features/proposed/{feature-name}/proposal.md`
2. Set frontmatter status to `captured`, refine to `draft`, then `ready`
3. Run proposal review (Opus-tier) when `ready`
4. On approval, move folder to `docs/features/active/` and create `spec.md`
5. Create parent GitHub issue with sub-issues per component
6. Plan waves based on dependencies and file isolation
7. Launch agents, monitor STATUS files, merge PRs
8. On completion, move folder to `docs/features/complete/`

### Launching Agents

```bash
# Single agent for an issue
lushx agent spawn feature --repo {repo} --issue {issue-number}

# Parallel agents (wave) -- ONLY when targeting DIFFERENT files
lushx agent wave --repo {repo} --issues {issue1},{issue2}

# Check agent status
lush agent status

# Close a session
lush agent close issue-{number}
```

### Merging and Sequencing

```bash
# Merge completed agent PRs
gh pr merge {pr-number} -R lushly-dev/{repo} --squash --delete-branch

# Pull before launching next wave
git pull origin main
```

## Checklist

Before launching a wave:

- [ ] All issues have clear specs linked in the body
- [ ] Dependency graph is mapped (parent issue documents it)
- [ ] File overlap analysis confirms no parallel conflicts
- [ ] STATUS files are initialized for each issue
- [ ] Previous wave PRs are merged and main is updated
- [ ] Agents are spawned from monorepo root for full context

Before completing a feature:

- [ ] All sub-issue PRs are merged
- [ ] All STATUS files show phase `complete`
- [ ] Feature folder moved to `docs/features/complete/`
- [ ] Parent GitHub issue is closed
- [ ] README tables updated if applicable

## When to Escalate

- **Cross-repo dependencies** -- Features spanning multiple repositories need coordinated planning
- **Merge conflicts** -- Wave PRs conflicting with each other require manual rebase
- **Agent failures** -- Agents stuck or producing invalid output need human intervention
- **File isolation violations** -- Discovered shared-file conflicts after wave launch
- **Blocked dependencies** -- External blockers preventing wave progression
