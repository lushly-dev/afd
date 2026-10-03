---
name: do-end-session
description: >
  Close out an AFD session so it can be archived without losing work: verify every
  PR landed (by content, not commit identity), file issues for findings raised but
  never tracked, capture durable knowledge into skills, docs or memory, clean up
  surviving remote branches last, and emit an archive-readiness report. `check`
  audits read-only; `park` pauses unfinished work with a resume pointer. Third stage
  of the session loop (do-init-afd → do-prepare-pr → do-end-session). Use when
  ending, closing out, or wrapping up a session, or asking whether a session is safe
  to archive. Triggers: end session, close out, wrap up, session done, ready to
  archive, park session.
argument-hint: check | park
---

# Do End Session

Closes the loop `do-init-afd` opened. The goal: nothing durable exists only in this
session's transcript, and nothing unlanded is lost when the worktree is reclaimed.

## Modes

| Argument | Mode | What runs |
|---|---|---|
| `check` | **Audit** | Phase 1 only. Read-only apart from `git fetch`; no issue creation, doc edits, or branch deletion. |
| _(none)_ | **Full** | Audit → land → capture → verify → clean up → report. |
| `park` | **Park** | Audit → capture → report with an explicit resume pointer. |

**Ordering is the safety property.** Cleanup is last, because an earlier phase may
still need the branch. Never remove the local branch or the worktree itself; the
harness owns those.

## 1. Audit

Machine state, from commands:

```bash
git status --short
git fetch origin '+refs/heads/main:refs/remotes/origin/main'
git rev-parse --verify -q "origin/<branch>"            # no output: never pushed (a stale ref can outlive a deleted branch)
git log --oneline "origin/<branch>..HEAD"              # unpushed commits (only if the ref exists)
gh pr list --state all --head <branch> --json number,state,headRefName,url \
  --jq '.[] | select(.headRefName == "<branch>")'        # the select is load-bearing
```

Read `.merged` per PR (`gh api repos/lushly-dev/afd/pulls/<n> --jq .merged`). The
REST `.state` is `closed` for merged and abandoned alike. For any ambiguity (branch
auto-deleted, "0 commits ahead"), the content-based landing check in `do-init-afd`
is authoritative. A missing `origin/<branch>` is not "nothing unpushed": resolve
it through the PR's `.merged` and the content check before moving on.

Then the part no script can do: **sweep this session's conversation** for problems
raised but never fixed, filed, or carried by a PR. That includes deferred review
findings, flaky tests, parity gaps between TypeScript and the Python, Rust or C++
ports, surprising behavior, and "we should probably…" asides. List them before
touching anything.

## 2. Land the work

Every session PR reaches merged, or is closed with a recorded reason.

- **Check for supersession before waiting.** A parallel session may have landed an
  equivalent change; close redundant PRs as superseded instead of babysitting them.
- If CI is red, fix it through the normal loop (`do-prepare-pr` owns push and
  update).
- Merge only when the user authorized it, following `do-prepare-pr` step 9.
- If a wait would block the close-out indefinitely, switch to `park` with a resume
  pointer instead.

`park` describes a stopped owner, not merely unfinished work. Finish or stop this
session's own background waits and child processes before reporting parked; never
stop another session's processes. A session still running or awaiting live CI is in
flight, not parked. A draft awaiting human validation can close out as not ready,
naming the PR, who validates it, and what they check.

## 3. Capture

- **Untracked findings → issues or an explicit decline.** Findings worth acting on
  become GitHub issues (`gh issue create`); "not worth tracking" is a recorded
  verdict, not a skipped step. Parity gaps go against the matching
  `docs/features/active/*-parity` effort when one exists.
- **Durable knowledge → the owning skill, doc, or memory.** Repo conventions go to
  the owning skill under `.claude/skills/` (Codex reads the same directory through
  `.codex/skills`). Cross-session facts go to memory. Capture only what a future
  session cannot cheaply re-derive.
- **Close the task.** Verify the `docs/features/` plan was updated or moved to
  `complete/` in the PR itself; don't assume it. Close or comment on the claimed
  issue if the PR did not close it.
- Repository edits made during close-out ship through a new PR. Never push doc
  edits onto an already-merged branch.

## 4. Verify nothing is left behind

Re-check: clean tree, no unpushed commits, no open session PRs. Unverifiable state
blocks the same as known-unpushed work; "could not check" is not "nothing to lose".
For squash-merged branches, verify by content diff, not by branch SHA.

## 5. Clean up: last, and confirmed

Only after every PR is merged or explicitly abandoned. The repo deletes head
branches on merge, so `remote ref does not exist` is the desired end state, not a
failure. For a remote branch that survived, confirm with the user, then
`git push origin --delete <branch>`. Never delete `main`, a `changeset-release/*`
branch, or any branch whose content has not landed.

## The close-out report

End every mode with exactly this layout; the status is the literal last line:

```markdown
## Session close — <session title>

- Verified at: <UTC timestamp of the final PR/branch re-read — state expires; re-read immediately before composing this>
- Pull requests: #N merged | #N closed (<reason>) | none
- Issues filed: #N <title> | none
- Knowledge captured: <skill/doc/memory touched> | none
- Task/plan: <issue closed / plan moved / n/a>
- Remote branches: <deleted / auto-deleted / retained (why)>
- Left behind: <knowingly-not-done items needing nothing from the reader> | none

**Follow-ups:** <numbered items needing the user's action> | none

**Ready to archive** | **Not ready to archive: <specific reason>** | **Not ready to archive: parked — resume at <next action>**
```

Every row is always present (`none` or `n/a` rather than omitted; a missing row
reads as unchecked). PR state is volatile: take the final read after the last piece
of work, immediately before composing the report, and stamp `Verified at` from that
read. When re-reading is impossible, claim the act ("pushed at 14:02Z"), not the
state ("PR is ready").

## Workflow chain

`do-init-afd` → build → `do-prepare-pr` → `do-end-session`. Use `check` anytime to
ask "is this session safe to archive?" without changing anything.
