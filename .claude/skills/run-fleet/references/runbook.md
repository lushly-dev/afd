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
Own the work without phase approvals: implementation, an independent review on your own
provider's routes, and repairs. Then run prepare-pr in lane mode: it records the review with
scripts/review-record.mjs and enqueues with a title and body through factory-cell. End your
turn once the branch is queued (or held); you are resumed only if it is ejected.
Run the tests you changed, not whole suites or reproduction loops: the lane's validation shares
this host. A flake you cannot reproduce in one run becomes a needs:repro issue.
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

`lane-wait` returns events this consumer has not seen; reading one does not answer it. An event
stays in `lane-status`'s `openEvents` until the action that answers it (a re-enqueue or drop
answers `ejected`, `lane-resume` answers `lane-error`, a new `cell-register` answers
`queue-room`) or `event-resolve` records your decision. At pickup, open `merged` and `queue-room`
events need nothing beyond `canStartCell`. An open `queue-empty` is not repeated
until it is resolved.

| Event | Act |
|---|---|
| Cell ended, branch queued | Nothing. Start another cell if `canStartCell` |
| Cell ended without queueing | The lane cannot see this; T3 Code tells you. Answer a question about the work; access or authority goes to the owner. Otherwise `lane-drop` it with the reason |
| Cell reports `GATE_EDIT_IN_REPAIR` | A diagnosis on the stronger route, never a looser check. If the gate edit is the right repair, `gate-allow` it with the reason and resume the cell to enqueue again |
| `ejected` | Resume the cell's thread (`t3_thread_send`) with the reason, detail and `logPath`. It repairs and enqueues again, at the front |
| Second ejection of one branch | A diagnosis on the stronger route first, then resume the cell with it |
| `ejection-limit` | `lane-drop` it, put the diagnosis on the issue and label it `needs:decision` for the owner (`cell-park` is not built yet) |
| `merged`, `queue-room` | Start a cell if `canStartCell` |
| `main-broken` | The lane has paused. `lane-drop` or leave queued what a broken `main` would eject. File a `priority:1` issue naming the merge at fault, labelled `status:planned` and one `execution:*` so it is dispatchable, and start a cell on it; reverting is that cell's work (`lane-revert` is not built yet). Then `lane-resume` and `event-resolve` it, so the next foreman does not file it again |
| `merged-without-check` | Check that PR's required check; if it failed, treat it as `main-broken`; otherwise `event-resolve` |
| `lane-error` | Fix what the detail names (network, `gh` sign-in, the lane's checkout), then `lane-resume`. Only a sign-in goes to the owner |
| `lane-stopped` | Read the end of `lane.log` in the lane's state directory, then `lane-start` and `event-resolve` it |
| `queue-empty` | Run `triage-issues`; if a cell can start, start it and then `event-resolve` this; otherwise leave it open (resolving it with nothing to start makes the lane say it again) and finish or wait for a reset |

## Plans

`cell-register` assigns the plan with the most room below `plans.ceiling`; `plan-list` shows each
plan's use. When every plan is at its ceiling, start nothing and report the next reset: a cell
that hits a usage limit stalls while holding its claim. Dials (`dial-get`, `dial-set`),
`lane-pause` and choosing the lane host are the owner's.

## Host notes

- **`random`** also runs Lushly's script lane, whose lock this lane cannot see. Start AFD's lane
  only while Lushly's is idle: `node scripts/merge-lane.mjs status --json` in the Lushly checkout
  shows `running` and its queue. This note goes with [#1309](https://github.com/lushly-dev/afd/issues/1309).
