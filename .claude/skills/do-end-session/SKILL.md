---
name: do-end-session
description: >
  Closes an AFD session so it can be archived without losing work: checks each PR
  landed by content, files untracked findings, captures knowledge and deletes
  surviving remote branches last. Use when wrapping up ("end session", "close out",
  "safe to archive?"); `check` is read-only, `park` pauses.
argument-hint: check | park
---

# Do End Session

The goal: nothing durable exists only in this transcript, and nothing unlanded is
lost when the harness reclaims the worktree.

## Modes

- **`check`:** the audit only. Read-only apart from `git fetch`: no issues, edits,
  merges or deletions.
- **Full** (no argument): audit, land, capture, clean up, report.
- **`park`:** audit, capture, then report with a resume pointer.

Order is the safety property: cleanup comes last because an earlier phase may still
need the branch. Never remove the local branch or the worktree; the harness owns
both.

## 1. Audit

```bash
git status --short
git fetch origin '+refs/heads/main:refs/remotes/origin/main'
git ls-remote --heads origin <branch>        # empty: never pushed, or deleted on merge
# only when it exists:
git fetch origin "+refs/heads/<branch>:refs/remotes/origin/<branch>"
git log --oneline "origin/<branch>..HEAD"    # unpushed commits
gh pr list --state all --head <branch> --json number,headRefName,url \
  --jq '.[] | select(.headRefName == "<branch>")'   # keep the select
gh api repos/lushly-dev/afd/pulls/<n> --jq .merged  # per PR
```

Read `.merged`, not `.state`, which is `closed` for merged and abandoned alike. A
missing remote branch is not "nothing unpushed": head branches are deleted on merge,
but a never-pushed or hand-deleted branch looks the same, so resolve it through
`.merged` and the content check. That check settles every ambiguous signal ("0
commits ahead", a squash merge): after the fetch, run do-init-afd's landing check;
a diff of the branch's files against `origin/main` that is empty, or shows only
other PRs' later changes, means landed.

Then the part no script can do: **sweep this session's conversation** for problems
raised but never fixed, filed or carried by a PR: deferred review findings, flaky
tests, parity gaps between the language ports, surprising behavior, "we should
probably…" asides. List them before touching anything.

## 2. Land the work

Every session PR ends merged, or closed with a recorded reason.

- **Check for supersession before waiting.** A parallel session may have landed an
  equivalent change; close a redundant PR as superseded.
- **Red CI** goes back through `do-prepare-pr`, which owns push and update.
- **Merge only when the user authorized it**, through `do-prepare-pr`'s merge step.
  `main` has no required checks, so bind the merge to the head whose checks you
  verified: `gh pr merge <n> --squash --match-head-commit <sha>`, with the full
  40-character SHA (a short one is rejected).
- **A wait that would block the close-out indefinitely** switches to `park`.

**Park** describes a stopped owner, not merely unfinished work. Finish or stop this
session's own background waits and child processes before reporting parked, and
never stop another session's. A session still running or awaiting live CI is in
flight, not parked. A draft awaiting human validation can close out as not ready,
naming the PR, who validates it and what they check.

## 3. Capture

- **Untracked findings** become GitHub issues (`gh issue create`) or an explicit
  decline; "not worth tracking" is a recorded verdict, not a skipped step. File
  parity gaps against the Language Parity Closure plan
  (`docs/features/active/parity-closure/`).
- **Durable knowledge** goes to its owner: repository conventions to the owning
  skill under `.claude/skills/` (`.codex/skills` mirrors it; a Botcore projection is
  edited at its canonical source, per AGENTS.md), cross-session facts to memory.
  Capture only what a future session cannot cheaply re-derive.
- **Close the task.** Verify that the PR itself updated the `docs/features/` plan or
  moved it to `complete/`; don't assume it. Close or comment on the claimed issue if
  the PR did not close it.
- **Close-out edits ship through a new PR.** Never push onto an already-merged
  branch; those commits would not reach `main`.

## 4. Clean up: last, and confirmed

Only when every PR is merged or explicitly abandoned and a fresh re-read shows a
clean tree, no unpushed commits and no open session PRs. State you could not check
blocks like known unpushed work. `remote ref does not exist` is the expected end
state after a merge, not a failure. For a surviving remote branch, confirm with the
user, then `git push origin --delete <branch>`. Never delete `main`, a
`changeset-release/*` branch, or any branch whose content has not landed.

## Report

End every mode with this layout; the status is the literal last line:

```markdown
## Session close: <title>

- Verified at: <UTC time of the final PR and branch re-read>
- Pull requests: #N merged | #N closed (<reason>) | none
- Issues filed: #N <title> | none
- Knowledge captured: <skill, doc or memory> | none
- Task/plan: <issue closed, plan moved> | n/a
- Remote branches: deleted | auto-deleted | retained (<why>)
- Left behind: <known items needing nothing from the reader> | none

**Follow-ups:** <numbered items needing the user> | none

**Ready to archive** | **Not ready to archive: <reason>** | **Not ready to archive: parked, resume at <next action>**
```

Keep every row (`none` or `n/a`; a missing row reads as unchecked). PR state is
volatile: take the final read after the last piece of work, just before writing.
When you cannot re-read, claim the act ("pushed at 14:02Z"), not the state.
