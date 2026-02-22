# Git Worktrees and Parallel Development

Using git worktrees for multi-agent, multi-feature parallel development workflows.

## What Are Git Worktrees?

Git worktrees allow you to check out multiple branches simultaneously in separate directories, all sharing the same `.git` data. Each worktree has its own working directory and index, but commits, branches, and remotes are shared.

```
project/                    # Main worktree (main branch)
├── .git/                   # Shared git data
├── src/
└── ...

project-feat-auth/          # Linked worktree (feat/auth branch)
├── src/                    # Independent working directory
└── ...

project-hotfix/             # Linked worktree (hotfix/issue-123 branch)
├── src/                    # Independent working directory
└── ...
```

## Core Commands

### Create a Worktree

```bash
# Create a worktree for an existing branch:
git worktree add ../project-feat-auth feat/auth

# Create a worktree with a new branch:
git worktree add -b feat/new-feature ../project-new-feature main

# Create a detached worktree (for inspection/testing):
git worktree add --detach ../project-inspect HEAD~5
```

### List Worktrees

```bash
git worktree list
# Output:
# /path/to/project           abc1234 [main]
# /path/to/project-feat-auth def5678 [feat/auth]
# /path/to/project-hotfix    ghi9012 [hotfix/issue-123]
```

### Remove a Worktree

```bash
# Clean removal (checks for uncommitted changes):
git worktree remove ../project-feat-auth

# Force removal (discards uncommitted changes):
git worktree remove --force ../project-feat-auth

# Clean up stale worktree references:
git worktree prune
```

### Move a Worktree

```bash
git worktree move ../project-feat-auth ../new-location
```

## Key Constraints

1. **Each branch can only be checked out in one worktree** -- You cannot have two worktrees on the same branch
2. **Worktrees share the git object store** -- Commits made in any worktree are visible to all
3. **Worktrees share remotes** -- A `git fetch` in one worktree updates refs for all
4. **Worktrees have independent indexes** -- Staging in one does not affect others
5. **Lock files are per-worktree** -- Build artifacts, node_modules, etc. are independent

## Multi-Agent Parallel Development

### Architecture

Each AI agent runs in its own worktree, working on an independent branch. Agents do not interfere with each other because each worktree has its own working directory and index.

```
repo/                          # Main worktree (human developer)
├── .git/
└── src/

repo-agent-1/                  # Agent 1: feat/add-search
├── src/
└── (agent 1 working here)

repo-agent-2/                  # Agent 2: fix/auth-timeout
├── src/
└── (agent 2 working here)

repo-agent-3/                  # Agent 3: refactor/db-layer
├── src/
└── (agent 3 working here)
```

### Setup Script for Agent Worktrees

```bash
#!/bin/bash
# create-agent-worktree.sh
# Usage: ./create-agent-worktree.sh <branch-name> [base-branch]

BRANCH_NAME="$1"
BASE_BRANCH="${2:-main}"
WORKTREE_DIR="../$(basename $(pwd))-${BRANCH_NAME//\//-}"

# Ensure we have the latest base
git fetch origin "$BASE_BRANCH"

# Create worktree with new branch
git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" "origin/$BASE_BRANCH"

echo "Worktree created at: $WORKTREE_DIR"
echo "Branch: $BRANCH_NAME (based on $BASE_BRANCH)"
```

### Cleanup Script

```bash
#!/bin/bash
# cleanup-agent-worktrees.sh
# Remove all linked worktrees (keeps the main worktree)

git worktree list --porcelain | grep "^worktree " | tail -n +2 | while read -r line; do
  path="${line#worktree }"
  echo "Removing worktree: $path"
  git worktree remove "$path" 2>/dev/null || echo "  (has changes, skipping)"
done

git worktree prune
echo "Cleanup complete."
```

### Claude Code Worktree Integration

Claude Code natively supports worktrees for parallel agent work:

```bash
# Start Claude Code in a new worktree:
claude --worktree feat/add-search

# Or use the -w shorthand:
claude -w feat/add-search
```

Subagents can also use worktree isolation. Configure in a custom subagent by adding `isolation: worktree` to the agent's frontmatter. Each subagent gets its own worktree that is automatically cleaned up when the subagent finishes.

## Workflow Patterns

### Pattern 1: Feature Parallelism

Multiple independent features developed simultaneously:

```bash
# Human creates work items, agents execute in parallel
git worktree add -b feat/search ../repo-search main
git worktree add -b feat/notifications ../repo-notif main
git worktree add -b feat/analytics ../repo-analytics main

# Each agent works independently
# When done, each pushes and creates a PR
# Human reviews and merges
```

### Pattern 2: Exploration / Spike

Run multiple approaches to the same problem:

```bash
git worktree add -b spike/approach-a ../repo-spike-a main
git worktree add -b spike/approach-b ../repo-spike-b main

# Compare results, keep the better approach
# Delete the other worktree and branch
```

### Pattern 3: Hotfix While Developing

Fix a production issue without losing feature work in progress:

```bash
# Already working on a feature in the main worktree
git worktree add -b hotfix/critical-fix ../repo-hotfix main

# Fix, push, merge hotfix
# Return to feature work -- no stashing needed
git worktree remove ../repo-hotfix
```

### Pattern 4: Review Without Context Switch

Review a PR without disrupting your current work:

```bash
git worktree add ../repo-review origin/feat/pr-to-review
cd ../repo-review
# Review, test, comment
# Return to your work
cd ../repo
git worktree remove ../repo-review
```

## Performance Considerations

### Disk Space

Worktrees are lightweight because they share the `.git` object store. However, each worktree has its own:
- Working directory (source files)
- Build artifacts (node_modules, target/, dist/)
- IDE configuration (.idea/, .vscode/)

For a typical 500MB repository, each worktree adds roughly the size of the source files (excluding `.git`).

### Build Artifacts

Build artifacts are the biggest space consumer. Strategies:

1. **Shared cache** -- Tools like Turborepo and Nx cache build outputs in a shared location
2. **Selective install** -- Only install dependencies needed for the specific change
3. **Ignore artifacts** -- Ensure `.gitignore` covers all build outputs
4. **Periodic cleanup** -- Remove worktrees (and their artifacts) when no longer needed

### Large Repositories

For very large repos (multi-GB):

```bash
# Use sparse checkout in worktrees to check out only needed paths:
git worktree add --no-checkout ../repo-sparse feat/my-feature
cd ../repo-sparse
git sparse-checkout init --cone
git sparse-checkout set src/my-package tests/my-package
git checkout feat/my-feature
```

## Agentic Safety Rules for Worktrees

1. **Always create a new branch** -- Never check out an existing shared branch in a worktree
2. **Clean up after completion** -- Remove worktrees when the task is done
3. **Check for uncommitted changes before removal** -- Use `git worktree remove` (not `--force`) to catch unsaved work
4. **Do not modify the main worktree from a linked worktree** -- Each worktree is independent
5. **Coordinate branch naming** -- Use prefixes like `agent/` or `auto/` to distinguish agent branches
6. **Limit concurrent worktrees** -- Monitor disk space; 3-5 concurrent worktrees is a practical limit for most projects
