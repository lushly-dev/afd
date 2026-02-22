---
name: do-hotfix
source: botcore
description: >
  Create a hotfix branch from the latest release tag, apply a minimal targeted fix, verify with quality gates, and fast-track through commit and PR. Enforces scope discipline — hotfixes are minimal fixes only, no refactoring or features. Delegates to do-commit and do-pr for the landing steps. Use for emergency or urgent production fixes.

version: 1.0.0
triggers:
  - do hotfix
  - hotfix
  - emergency fix
  - urgent fix
  - patch fix
  - production fix
  - critical bug
argument-hint: issue or description
portable: true
user-invocable: true
---

# Do Hotfix

Create and land an emergency fix from the latest release — minimal scope, fast-tracked.

## Workflow

### Step 1: Branch from Latest Release

Find the latest release tag and create a hotfix branch:

```bash
# Find latest tag
git describe --tags --abbrev=0
# Example output: v1.2.3

# Create hotfix branch
git checkout -b hotfix/<description> v1.2.3
```

If no tags exist, branch from `main` instead.

Name the branch descriptively: `hotfix/fix-auth-crash`, `hotfix/issue-42`.

### Step 2: Scope Guard

**Hotfix = minimal targeted fix only.** Before making changes, remind:

- Fix the specific bug. Nothing else.
- No refactoring adjacent code
- No adding features, "while we're here" changes
- No dependency upgrades (unless the dependency IS the bug)
- No formatting/style changes outside the fix

If the fix requires broader changes, it's not a hotfix — it's a regular feature branch.

### Step 3: Implement Fix

The user/agent implements the actual fix. This is the one step that requires judgment and coding — the rest is process.

Keep the diff as small as possible.

### Step 4: Verify

Run the quality gate in quick mode to ensure nothing breaks:

```bash
python {skill-dir}/../do-commit/scripts/quality_gate.py
```

Additionally:
- Verify the specific bug is fixed (reproduce → confirm fix)
- Check that no existing tests broke
- Add a regression test for the bug if feasible

### Step 5: Fast-Track Commit

Delegate to `do-commit` in **quick mode** — quality gate already ran, so this is just the commit step.

Suggested commit message format:
```
fix(<scope>): <description>

Fixes #<issue>
```

### Step 6: Fast-Track PR

Delegate to `do-pr` with the `hotfix` label:

```bash
gh pr create --title "fix: <description>" --label hotfix --base main
```

In the PR description, emphasize:
- What broke (symptoms)
- Root cause
- What the fix does
- How it was verified

### Step 7: Post-Merge

After the hotfix PR is merged:

1. If the fix should be included in an active release branch, cherry-pick:
   ```bash
   git checkout release/X.Y
   git cherry-pick <hotfix-commit>
   ```
2. Consider a patch release — delegate to `do-release patch` if urgent
3. Delete the hotfix branch

## Reference

See `manage-git` skill for hotfix branching strategy details.
