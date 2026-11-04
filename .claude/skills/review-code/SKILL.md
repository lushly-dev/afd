---
name: review-code
source: botcore
description: >
  Reviews a diff, pull request, spec or proposal as a fresh, read-only reviewer
  and reports evidence-backed BLOCKER, IMPROVEMENT and PRAISE findings. Use when
  self-reviewing before a commit, reviewing a PR, briefing an independent
  reviewer, or reviewing a spec or proposal.
version: 2.0.0
portable: true
---

<!-- Generated from skills/exports.json; edit the canonical code-reviewer skill. -->

# Code reviewer

A reviewer is useful only if it judges the artifact, not the story behind it. A repository's own review workflow or reviewer profile (lanes, pass limits, tool limits, output format) takes precedence; this skill is the method inside it. A lane that may not run commands reads instead, and says which findings it traced rather than ran.

## Brief a fresh reviewer

The fresh-agent rule: the reviewer gets the artifact, what it must satisfy, and a read-only repository. Nothing else.

- **Give** the diff or file path, the acceptance criteria or spec, and the base commit SHA, using absolute paths: a subagent may start in another worktree, and a reviewer left to find the base may read a stale checkout.
- **Withhold** your reasoning, dead ends and drafts; they lead the reviewer into the blind spots it exists to catch.
- **Delete the previous review before a fresh re-review**, and don't quote it: prior findings anchor the reviewer on old fixes instead of the current artifact. A focused pass that only verifies named blockers is the exception; say that is its whole scope.
- The reviewer reports and never edits; the author fixes.

## Modes

- **Self-review** (no argument): read `git diff origin/main...HEAD` (or the real base), `git diff HEAD` and any untracked files in `git status`. You share the author's blind spots, so this is a first pass, not a substitute for a fresh reviewer.
- **PR review** (`#N` or a branch): read the intent with `gh pr view N`, then `gh pr diff N`. Check the diff matches the description, including unmentioned breaking changes. Return the review to the user; post it with `gh pr review N --comment --body-file <file>` only when asked.
- **Spec or proposal:** judge by the table below.

## Verify against the repository

Ground each finding in something you read or ran, not in memory of how an API usually behaves.

- Read around each change: callers, tests, and any existing helper it duplicates.
- Confirm every API, signature, import, path and command the artifact uses exists in the repository or its installed dependencies. Spec code samples that don't match the real library API are the most common spec blocker.
- Look up external docs only when a finding depends on third-party behaviour you can't check locally; reviewers often have no web access. Say what you couldn't verify.
- Say whether each finding was executed or traced by reading. A risk with no supported path to failure is a question, not a blocker. Drop findings the code already handles.

## What to judge

| Artifact | Judge | Leave alone |
|---|---|---|
| Proposal | The problem is real, the approach solves it, nothing existing already does it, each phase has an exit | Implementation detail |
| Spec or plan | Implements the approved approach; checkable tasks; concrete test plan; edge and error cases | Whether the feature should exist; other approaches unless this one is broken |
| Code | Correctness, security, tests for new behaviour, performance, conventions, docs for changed public surface, scope | Untouched code, future features, restyling to taste |

**Phased delivery is normal.** Don't flag phasing itself; flag a phase that leaves the product broken or a contract half-changed, and deferred work the plan doesn't name.

**Specs hold interfaces:** signatures, types, schemas, diagrams and usage examples a few lines long. An implementation body (handler logic, a component, test code) is a BLOCKER, because whoever implements the spec copies it instead of designing; keep illustrative blocks to a few lines.

## Classify and report

| Label | Meaning |
|---|---|
| BLOCKER | Must fix before merge: a demonstrated bug, security or data-loss hole, broken contract or unmigrated breaking change, untested new behaviour, unmet acceptance criterion. |
| IMPROVEMENT | Worth doing, doesn't block: reuse, docs, types, duplication, polish (say when minor). |
| PRAISE | A specific pattern worth keeping or copying. Optional. |

Severity follows impact, not how easy the fix is. Report every finding you can support; the author decides what to act on. Blockers first, one line each:

```text
BLOCKER src/store.ts:42 — what is wrong and its impact. Evidence: what you read or ran. Fix: the smallest change.
```

End with a verdict: approve, or revise with the blockers listed. Return the review in your reply or on the PR, not as a file in the working tree, where it gets committed or anchors the next reviewer.

The author fixes every blocker, decides each improvement (recording why one is skipped), and re-reviews as above.
