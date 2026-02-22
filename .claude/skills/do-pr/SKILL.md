---
name: do-pr
source: botcore
description: >
  Push branch and create a pull request with structured description, linked issues, and review configuration. Verifies branch readiness, generates PR description from commits and diff, and creates the PR via CLI or API. Use when ready to submit work for review.

version: 1.0.0
triggers:
  - do pr
  - create pr
  - submit pr
  - push
  - ship
  - ship it
  - open pr
  - ready for review
portable: true
user-invocable: true
---

# Do PR

Push a branch and create a pull request with a structured description.

## Workflow

### Step 1: Pre-Flight

Check readiness before pushing:

1. **Uncommitted changes?** — If the working tree is dirty, suggest running `do-commit` first
2. **On main/master?** — Error. Never create a PR from the default branch. Create a feature branch first.
3. **Commits exist?** — Verify the branch has commits ahead of the default branch (`git log main..HEAD --oneline`)

### Step 2: Branch Check

Evaluate branch state for a clean PR:

| Check | Action |
|-------|--------|
| Behind remote default branch | Suggest rebase: `git fetch origin && git rebase origin/main` |
| >5 commits ahead | Suggest squashing: `git rebase -i main` to consolidate |
| WIP/fixup commits | Suggest cleaning up with interactive rebase |
| Merge commits | Suggest rebasing to linearize history |

These are suggestions, not blockers — the user decides.

### Step 3: Push

```bash
git push -u origin <current-branch>
```

If the branch already has an upstream, a simple `git push` suffices.

### Step 4: PR Description

Generate a structured PR description using the template in [pr-template.md](references/pr-template.md):

1. Collect commit messages: `git log main..HEAD --format="%s%n%b"`
2. Get diff summary: `git diff main..HEAD --stat`
3. Fill the template sections:
   - **What** — Summarize changes from commits and diff
   - **Why** — Link to issue (detect from branch name patterns like `feature/123-desc` or commit messages with `#123`)
   - **How** — Key technical decisions from commit bodies
   - **Testing** — What was tested (detect from test file changes)
   - **Checklist** — Standard items

### Step 5: Create PR

Use GitHub CLI or GitHub MCP tools:

```bash
gh pr create --title "<title>" --body "<description>" --base main
```

Add labels based on changed files:
- Test files changed → `tests`
- Docs changed → `documentation`
- Dependency files changed → `dependencies`
- `*.spec.md` or `*.proposal.md` → `spec`

Link to issue if detected from branch name or commits.

### Step 6: Post-Create

After PR is created:

1. Print the PR URL
2. If CODEOWNERS file exists, suggest reviewers based on changed file paths
3. Remind: "Watch CI status — fix any failures promptly"
4. If the PR is a draft (`--draft`), remind to mark ready when CI passes
