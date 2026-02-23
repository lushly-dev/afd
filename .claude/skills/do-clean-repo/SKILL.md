---
name: do-clean-repo
source: botcore
description: >
  Periodic deep cleanup of repository-level cruft — stale branches, orphaned worktrees, dead test files, agent artifacts, dangling configs, and build output. Confirms destructive actions before executing. Use when a repo feels cluttered or before major milestones.

version: 1.0.0
triggers:
  - do clean repo
  - clean repo
  - repo cleanup
  - prune branches
  - stale branches
  - orphaned worktrees
  - dead tests
  - repo hygiene
  - repo maintenance
argument-hint: scan | full
portable: true
user-invocable: true
---

# Do Clean Repo

Periodic deep cleanup of repository-level cruft that accumulates over time.

This is distinct from `do-commit` Step 2 (which cleans temp files before a specific commit) and `manage-environment` (which covers dev tooling hygiene). This skill targets the repo itself — git state, orphaned files, and structural rot.

## Bot Commands

This skill is distributed via botcore. The bot provides commands that can assist with several cleanup steps — use them to automate detection. The bot name varies per project.

| Command | What it does | Used in |
|---------|-------------|--------|
| `dev_dead_code` | Finds unused functions, variables, imports (vulture/knip/cargo-udeps) | Step 3 |
| `dev_unused_deps` | Finds declared but unused dependencies | Step 10 |
| `dev_check_size` | Identifies oversized source files | General hygiene |
| `docs_lint` | Finds broken internal links in markdown files | Step 7 |
| `info_workspace` | Lists workspace packages and structure | Context gathering |
| `info_scripts` | Lists scripts across all packages | Step 7 |

Call these via MCP tools or CLI when available. If the bot is not installed, the manual steps below still work.

## Modes

| Mode | What runs | When to use |
|------|-----------|-------------|
| **scan** (default) | Detect and report — no deletions | See what needs attention |
| **full** | Detect, confirm, then clean | Periodic maintenance |

**Critical rule**: Never delete anything without confirming with the user first. Present findings, get approval, then act.

## Workflow

### Step 1: Stale Git Branches

Branches that have been merged or whose remote counterpart is gone.

#### Detect

```bash
# Fetch and prune remote-tracking refs
git fetch --prune

# Local branches already merged into main
git branch --merged main | grep -v "main\|master\|\*"

# Local branches whose remote is gone
git branch -vv | grep ': gone]'

# Remote branches merged into main
git branch -r --merged main | grep -v "main\|master\|HEAD"
```

#### Clean (after confirmation)

```bash
# Delete a merged local branch
git branch -d <branch-name>

# Delete a remote branch
git push origin --delete <branch-name>
```

**Never delete**: the current branch, `main`, `master`, or any branch with unmerged work.

### Step 2: Orphaned Worktrees

Worktrees for branches that no longer exist, or with broken links.

#### Detect

```bash
# List all worktrees
git worktree list

# Find worktrees with missing branches or broken paths
git worktree list --porcelain | grep -A2 "worktree"
```

Check each worktree:
- Does the branch still exist? (`git branch --list <branch>`)
- Does the directory still exist on disk?
- Is there uncommitted work in the worktree?

#### Clean (after confirmation)

```bash
# Remove a specific worktree
git worktree remove <path>

# Prune worktree metadata for directories already deleted
git worktree prune
```

**Never remove** a worktree with uncommitted changes without explicit user approval.

### Step 3: Dead Test Files

Test files for source code that has been removed or renamed.

#### Detect

Run `dev_dead_code` — it finds unused functions and imports, which often surface tests importing deleted modules. For deeper test-specific checks, cross-reference test files against source:

| Test file pattern | Expected source |
|-------------------|----------------|
| `test_foo.py` | `foo.py` or `foo/` in source tree |
| `foo.test.ts` | `foo.ts` in source tree |
| `foo.spec.ts` | `foo.ts` in source tree |
| `tests/test_bar.py` | `src/**/bar.py` |

```bash
# List all test files
find . -name "*.test.ts" -o -name "*.spec.ts" -o -name "test_*.py" | sort

# Cross-reference against source files
# For each test file, check if the module it imports still exists
```

Signs of a dead test:
- Imports a module that no longer exists
- Describes a function/class that was removed
- Hasn't been modified since the source file was deleted (check `git log`)
- Fails with `ModuleNotFoundError` or `Cannot find module`

#### Clean (after confirmation)

Delete the test file and remove any related fixtures or test data that are no longer referenced elsewhere.

### Step 4: Agent Artifacts

Files left behind by agent workflows that are no longer needed.

| Pattern | What it is | Safe to remove? |
|---------|-----------|-----------------|
| `*.plan.md` | Agent planning docs | Yes, if work is complete |
| `*.review.md` | Agent review output | Yes, if PR is merged |
| `STATUS-*.md` | Agent status tracking | Yes, if feature is complete |
| `nul` | Windows null device artifact | Always |
| `*.tmp`, `*.log` | Temporary/debug files | Usually |
| `.aider*` | Aider session files | Yes, if session is done |

**Check before deleting**: Verify the associated feature/PR is actually complete. A `STATUS-42.md` for an open issue should stay.

### Step 5: Build Output Not in .gitignore

Build artifacts that are tracked or unignored.

#### Detect

```bash
# Check if common build dirs are gitignored
for dir in dist build coverage .tsbuildinfo __pycache__ .pytest_cache .ruff_cache node_modules; do
  git check-ignore -q "$dir" 2>/dev/null || echo "NOT IGNORED: $dir"
done

# Find tracked build output
git ls-files | grep -E "(dist/|build/|coverage/|__pycache__/|\.tsbuildinfo)"
```

#### Clean

Add missing entries to `.gitignore`, then remove from tracking:

```bash
echo "dist/" >> .gitignore
git rm -r --cached dist/
```

### Step 6: Empty Directories

Directories left behind after file moves or deletes. Git doesn't track empty directories, but they can linger on disk.

```bash
# Find empty directories (excluding .git)
find . -type d -empty -not -path "./.git/*"
```

Remove empty directories that serve no purpose. Some may be intentional (e.g., with a `.gitkeep`) — leave those.

### Step 7: Orphaned Config Files

Config files for tools no longer in use. Run `info_scripts` to see what tools are actually referenced across packages.

| Config file | Tool | Check if still used |
|-------------|------|-------------------|
| `.eslintrc*` | ESLint | Is ESLint in devDependencies? |
| `.prettierrc*` | Prettier | Is Prettier in devDependencies? |
| `jest.config.*` | Jest | Is Jest in devDependencies? |
| `.babelrc*` | Babel | Is Babel in devDependencies? |
| `tslint.json` | TSLint | Deprecated — never needed |
| `.travis.yml` | Travis CI | Is the project using Travis? |

If the tool isn't installed and isn't referenced in CI, the config is orphaned.

### Step 8: Stale Tags

Tags pointing to squash-merged commits or deleted branches.

```bash
# List tags not reachable from main
git tag | while read tag; do
  git merge-base --is-ancestor "$tag" main 2>/dev/null || echo "UNREACHABLE: $tag"
done

# List tags with no corresponding changelog entry
git tag -l "v*" | sort -V
```

Only clean tags that are clearly stale (e.g., `wip-*`, `temp-*`). Version tags should generally be preserved.

### Step 9: Git Maintenance

General repo health checks.

```bash
# Verify object database integrity
git fsck --no-dangling

# Garbage collect and compress
git gc --auto

# Check repo size
git count-objects -vH
```

### Step 10: Lockfile Hygiene

Check for conflicting or stale lockfiles. Run `dev_unused_deps` to also catch declared dependencies that are no longer imported.

| Issue | Detection | Fix |
|-------|-----------|-----|
| Multiple lockfiles | Both `package-lock.json` and `pnpm-lock.yaml` exist | Remove the one not matching the project's package manager |
| Lockfile not committed | `git ls-files <lockfile>` returns nothing | `git add <lockfile>` |
| Lockfile desync | `pnpm install --frozen-lockfile` fails | Regenerate lockfile |

### Step 11: Report

Summarize findings and actions:

```
Repo cleanup complete:
- Branches: Deleted 3 merged local branches, 2 gone remote-tracking refs
- Worktrees: Pruned 1 orphaned worktree (old-feature)
- Dead tests: Removed test_legacy_api.py (source deleted in v1.2.0)
- Artifacts: Removed 2 plan files, 1 nul file
- Build output: Added coverage/ to .gitignore
- Config: Removed .eslintrc.json (migrated to Biome)
- Git health: gc completed, repo size 45M
```

## When to Run

- Before major releases or milestones
- After completing a large feature with multiple worktrees/branches
- When the repo feels cluttered or `git branch` output is overwhelming
- Periodically (monthly or quarterly) as preventive maintenance
- After onboarding to a new repo to understand its state

## When to Escalate

- Large binary files in git history inflating repo size — needs `git filter-repo` or BFG
- Submodule cleanup — complex dependency implications
- Monorepo with hundreds of packages — needs targeted approach per workspace
- Protected branches that can't be deleted remotely — needs admin access
