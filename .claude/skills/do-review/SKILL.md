---
name: do-review
source: botcore
description: >
  Review code changes — either self-review your own uncommitted work or review an incoming pull request. Routes on argument: no args for self-review, PR reference for PR review. Delegates to the review-code skill for methodology and structured feedback. Use when reviewing changes before committing or reviewing a PR.

version: 1.0.0
triggers:
  - do review
  - review changes
  - review pr
  - self review
  - code review
  - check my changes
  - review my work
argument-hint: 'PR #number | (no args for self-review)'
portable: true
user-invocable: true
---

# Do Review

Review code changes with structured feedback. Two modes based on argument.

## Mode Selection

| Invocation | Mode | What happens |
|------------|------|-------------|
| `/do-review` | Self-review | Review your own uncommitted/staged changes |
| `/do-review #42` | PR review | Review pull request #42 |
| `/do-review feature-branch` | PR review | Review PR for the named branch |

## Self-Review Mode

Review your own changes before committing. A natural precursor to `do-commit`.

### Step 1: Gather Changes

```bash
# Staged changes
git diff --cached

# All uncommitted changes
git diff

# Changed files list
git diff --name-only
```

### Step 2: Structured Review

Review the diff against these dimensions (from the `review-code` skill):

| Dimension | What to check |
|-----------|---------------|
| **Correctness** | Does the code do what it's supposed to? Edge cases handled? |
| **Security** | Injection risks, secrets, auth gaps, input validation |
| **Testing** | Are changes covered by tests? Missing test cases? |
| **Performance** | N+1 queries, unnecessary computation, missing pagination |
| **Readability** | Clear naming, appropriate comments, consistent style |
| **Documentation** | Public APIs documented? README/CHANGELOG current? |

### Step 3: Output

Produce structured feedback using BLOCKER/IMPROVEMENT/PRAISE classification:

- **BLOCKER** — Must fix before committing (bugs, security issues, missing tests for critical paths)
- **IMPROVEMENT** — Should fix, but not a dealbreaker (naming, style, minor refactors)
- **PRAISE** — Good patterns worth highlighting (clean abstractions, thorough tests)

Format:
```
## Self-Review Summary

### Blockers (N)
- [BLOCKER] file.ts:42 — Description of issue

### Improvements (N)
- [IMPROVEMENT] file.ts:15 — Suggestion

### Praise (N)
- [PRAISE] file.ts:80 — What's good about it
```

If no blockers found, indicate the changes are ready for `do-commit`.

## PR Review Mode

Review an incoming pull request with research-grounded analysis.

### Step 1: Fetch PR Context

```bash
# Get PR diff
gh pr diff <number>

# Get PR description and metadata
gh pr view <number>

# Get changed files
gh pr diff <number> --name-only
```

Or use GitHub MCP tools to fetch PR details.

### Step 2: Research-Grounded Review

Follow the `review-code` skill's Fresh Agent pattern:

1. **Codebase verification** — Read the actual codebase around changed areas, don't rely only on the diff
2. **API validation** — Verify function signatures, types, and imports are correct
3. **Generator-Critic loop** — Generate initial review, then critique your own findings for false positives

### Step 3: Multi-Dimension Checklist

Apply the same dimensions as self-review (correctness, security, testing, performance, readability, documentation) but with deeper analysis since this is someone else's code.

Additional PR-specific checks:
- Does the PR description accurately reflect the changes?
- Is the scope appropriate (single concern, not too large)?
- Are there breaking changes not mentioned?

### Step 4: Output

Same BLOCKER/IMPROVEMENT/PRAISE format. Output locally by default — the user can paste it into the PR or use it as a reference.

If the user wants to post directly:
```bash
gh pr review <number> --comment --body "<review>"
```
