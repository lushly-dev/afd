# Fleet runbook

Detail for [`run-fleet`](../SKILL.md). `factory` is the plugin's command line, run from the
repository root (`uv run --frozen --project endpoints/botcore/plugins/botcore-factory factory call
...`); a cell uses `factory-cell`, which offers only `lane-status`, `issue-check` and
`lane-enqueue`. The first `uv run` in a worktree builds that worktree's own plugin environment.

## The cell brief

```
Complete issue(s) #<n>: <acceptance>. Route: <model/effort>.
First: git fetch origin '+refs/heads/main:refs/remotes/origin/main', then
git switch -c <branch> origin/main, and start-session. The lane has claimed the issues;
never claim, push, open a PR, run the full pnpm verify or merge: the lane does.
Own the work without phase approvals: implementation, independent review as prepare-pr's
step 2 says, two reviewers first, one per provider (wait for them in this turn: a turn that ends reads as the cell finishing),
and repairs. Then run prepare-pr in lane mode: it records the review with
scripts/review-record.mjs and enqueues with a title and body through factory-cell. End your
turn once the branch is queued (or held); you are resumed only if it is ejected.
Run the tests you changed, not whole suites or reproduction loops: the lane's validation shares
this host. A new or rebased worktree needs `pnpm install --frozen-lockfile` (start-session runs it)
and a build of the packages your tests and the pre-queue typecheck import before they pass:
lane-enqueue's lint stage fails without it. A flake you cannot reproduce in one run becomes a needs:repro issue.
Under needs:approach, post your approach on the issue and proceed; needs:ux gets screenshots.
Others share the repository; never revert their work.
Read .claude/skills/start-session/SKILL.md and .claude/skills/prepare-pr/SKILL.md (a skill
listing may be truncated).
Report the branch, the enqueue result, follow-up issues and anything left undone.
```

A cell whose worktree is still being prepared ten minutes after it started never will be:
`task_cancel` it, `lane-drop` it and start it again. If `delegate_task`'s worktree isolation
fails, say so in the report; never create a cell's checkout in the shell.

## Events

When `main` moves under a validated branch, the lane advances the branch to the new `main` without validating it again if `main`'s changes touch no shared input, merge cleanly and share no unit with the branch (a `base-advanced` record; `lane-report` counts them as `baseAdvances`); otherwise it validates again (a `rerun` record, `main-moved`, whose `detail` says why). After `lane.maxBaseReruns` such reruns of one attempt (default 2), a move that merges cleanly and touches none of the adapter's `revalidate_paths` (lockfiles, dependency manifests, toolchain pins such as `.nvmrc`; workflow and CI gate changes do not stop it) advances it anyway (a `base-advanced` record with `reason` `rerun-limit`; `lane-report` counts `rerunLimitAdvances`): the PR's `ci-ok`, run on the merge ref, stands in for the local validation, and the merge is watched on `main` like any other advance. A move after the push merges on the `ci-ok` of the older `main` (`checkBase` in the records), so a `main-broken` naming such a PR is the first place to look. A validated branch behind the front that gives its slot to it keeps its validation (a `slot-released` record; its checkout waits in `kept-<branch>-<hash>` beside the slots), and the same base checks decide at the front whether it runs again. None of these raises an event, and none needs you.

Where `main` takes merges only through GitHub's merge queue, the lane's merge request queues the pull request instead of merging it. Its entry in `lane-status` then reads `merge-queued` (with `mergeQueue`: GitHub's `state` and `position`) for the minutes the queue takes, and nothing behind it is pushed meanwhile. This too raises no event and needs nothing: `merged` comes when it lands, with `through the merge queue` in its detail. `lane-drop` and `lane-enqueue` refuse such a branch as `MERGE_QUEUED`: GitHub locks its branch and would merge it after the lane forgot it. To stop one, remove it from the queue on GitHub, `lane-resume` the lane if it is paused, and wait for its `ejected` event (a minute or two) before `lane-drop`. A branch that still holds a merge of `main` an older lane authored as `botcore-factory` is ejected with that name in a `Co-authored-by:` line: its cell rebuilds the branch without that merge commit.

`lane-wait` returns open events this consumer has not seen. Reading one leaves it open. An event
stays in `lane-status`'s `openEvents` until the action that answers it (a re-enqueue or drop
answers `ejected`, `lane-resume` answers `lane-error`, a new `cell-register` answers
`queue-room`) or `event-resolve` records your decision. At pickup, open `merged` and `queue-room`
events need nothing beyond `canStartCell`. An open `queue-empty` is not repeated
until it is resolved.

| Event | Act |
|---|---|
| Cell ended, branch queued | Nothing. Start another cell if `canStartCell` |
| Cell ended without queueing | The lane cannot see this; T3 Code tells you. If its thread has a run in progress (`t3_thread_read`), it resumed itself, as a cell does when a background reviewer returns: wait. Otherwise answer a question about the work; access or authority goes to the owner. Otherwise `lane-drop` it with the reason |
| Cell reports `GATE_EDIT_IN_REPAIR` | A diagnosis on the stronger route, never a looser check. If the gate edit is the right repair, `gate-allow` it with the reason, your `session` (it needs your live lease) and the `head` the cell's refusal names, and resume the cell to enqueue that head again; a later commit needs a new `gate-allow`. A repair the lane holds as `gate-change` with "its repair after …" reasons is the same case: `gate-allow` the held head, then the cell enqueues again, at the back of the queue |
| `ejected` | Resume the cell's thread (`t3_thread_send`) with the reason, detail and `logPath`. It repairs and enqueues again, at the front. An event with `excused` (a `conflict` with a moved `main`, or the push, PR or merge plumbing) does not count toward `cells.maxEjections`, so nothing stops a loop of them: when `lane-status` shows `ejections` growing with no counted ones (a branch never rebased, or one GitHub refuses as empty), diagnose it as a second counted ejection |
| `ejected` after the merge queue | The pull request left GitHub's queue unmerged. `ci-failed` whose detail names the commit the merge queue built: `ci-ok` failed on the branch's commit rebased onto `main` and whatever was queued ahead; it counts, and the cell repairs it as any failed check. If the detail quotes a `Co-authored-by:` line, the code is not at fault: the commit carries it, and `ci-ok` refuses it. Resume the cell to take the line out of its messages and enqueue again. The lane's fold drops such lines, but keeps a branch that already is one commit on `main` as it is; if every cell is ejected so, the agent harness on that machine adds the line to its commits (its commit attribution setting), which is the owner's to fix. `merge-failed` whose detail says it left the merge queue (a conflict there, or someone removed it) is excused: resume the cell to enqueue again, and ask the owner first if a person took it out |
| `ejected` by a known flake | A failure the diagnosis finds on `main` too or names in an open flake issue (such as #1408) is not the branch's: `ejection-excuse {"branch", "reason": "<the issue>", "session"}` so it stops counting, then resume the cell as for any ejection |
| `ejected` with `review-unverified` | `main`'s verifier refused the review the cell's own copy accepted, or the cell's worktree moved or is gone. Resume the cell to record its review of the head again with `main`'s `scripts/review-record.mjs` and enqueue again. A change to `review_evidence` or the verifier binds only once it is on `main` and the lane restarts |
| `ejected` with `node-missing` | The branch's own `.nvmrc` names a Node the lane host lacks (or an alias), or the branch deletes or blanks `.nvmrc` (resume the cell to restore `main`'s; the lane validates no branch without a pinned Node, so removing `.nvmrc` on purpose is the owner's change to `main`). If the bump is not the issue's point, resume the cell to keep `main`'s `.nvmrc`. If it is, installing that Node on the lane host is the owner's: ask, then `ejection-excuse` the ejection and resume the cell to enqueue again. `main`'s own `.nvmrc` missing its Node pauses the lane as a `lane-error` instead |
| Second counted ejection of one branch | A diagnosis on the stronger route first, then resume the cell with it (`lane-status` shows `countedEjections`) |
| `ejection-limit` | The branch's own failures reached `cells.maxEjections`. If the last one was a known flake, `ejection-excuse` it, which answers this, and resume the cell. Otherwise `lane-drop` it, put the diagnosis on the issue and label it `needs:decision` for the owner (`cell-park` is not built yet) |
| `merged`, `queue-room` | Start a cell if `canStartCell` |
| `main-broken` | The lane has paused. With `reason` `unchecked-merge`, a check failed on `main` after a merge the lane advanced past a moved `main` without validating it again (an unrelated move, or one past `lane.maxBaseReruns`); `suspects` are those PRs, the first places to look. `lane-drop` or leave queued what a broken `main` would eject. File a `priority:1` issue naming the merge at fault, labelled `status:planned` and one `execution:*` so it is dispatchable, and start a cell on it; reverting is that cell's work (`lane-revert` is not built yet). Then `lane-resume` and `event-resolve` it, so the next foreman does not file it again |
| `merged-without-check` | Check that PR's required check; if it failed, treat it as `main-broken`; otherwise `event-resolve {"id": "<event id>", "note": "Required check passed"}` |
| `lane-error` | Fix what the detail names (network, `gh` sign-in, the lane's checkout), then `lane-resume`. One that says a pull request has waited in the merge queue past `lane.checkTimeoutMinutes` left it queued: read the queue on GitHub (a stuck or long queue is the owner's to clear), then `lane-resume`, which starts the wait again. Only a sign-in goes to the owner |
| `lane-stopped` | Read the end of `lane.log` in the lane's state directory, then `lane-start` and `event-resolve` it |
| `queue-empty` | Run `triage-issues`; if a cell can start, start it and then `event-resolve` this; otherwise leave it open (resolving it with nothing to start makes the lane say it again) and finish or wait for a reset |

## Plans

`cell-register` assigns a Claude plan while `cells.claudeOnly` is on (keep it on until
[#2371](https://github.com/lushly-dev/afd/issues/2371) adds Google/Antigravity plan selection,
since turning it off today also admits Codex plans; model routing admits Neon and Opus for cells
and keeps OpenAI/Codex plans for review), and among those the plan whose room below `plans.ceiling` most needs spending before its
reset: the highest `pace`, room over the days to the reset, so each plan is spent by its own reset
(10% left with four days to go, 2.5 a day, waits behind 100% left with five, 20 a day).
`plan-list` shows each plan's use, `pace` and `next`. With no Claude plan, `lane-status` says so
and `cell-register` refuses `NO_CLAUDE_PLAN`: ask the owner to sign in to Claude on the lane host.
When every Claude plan is at its ceiling, start nothing and report the next reset: a cell
that hits a usage limit stalls while holding its claim. Dials (`dial-get`, `dial-set`),
`lane-pause` and choosing the lane host are the owner's.

## Host notes

- **`random`** also runs Lushly's script lane, whose lock this lane cannot see. Start AFD's lane
  only while Lushly's is idle: `node scripts/merge-lane.mjs status --json` in the Lushly checkout
  shows `running` and its queue. This note goes with [#1309](https://github.com/lushly-dev/afd/issues/1309).
