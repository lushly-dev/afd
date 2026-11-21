# Skill usage: status

Epic: [#1806](https://github.com/lushly-dev/afd/issues/1806). File new work for this area as its sub-issue.

Read this before the [proposal](skill-usage.proposal.md). Active since 2026-11-21.

## How to keep this file

- A pull request edits the line of the piece it builds and no other. Pieces sit under their
  phase, with a blank line between them, so two branches don't conflict on adjacent lines.
- No sentence says which pieces are done or next: read the piece lines.
- Findings get a dated section under [Findings](#findings), newest first. Never delete one; mark it
  superseded and point to what replaced it.

## Findings

### Missed triggers, first reading, 2026-11-21 (#1817)

Measured on the MacBook Air over 30 days with the rule Lushly's instructions state (the gate
skill for `lefthook.yml`, `ci.yml` and `scripts/check-*.mjs`), before Lushly declares it.

- **The reading.** 55 merged changes touched a gate file. 45 had no session on this machine
  and 1 had no pull request number. Of the 9 that could be judged, 3 were published by a
  session that had loaded the gate skill and 6 by sessions that never loaded it before the
  merge. One long session that published twelve pull requests accounts for four of the six.
- **What a session changed cannot be read from its turns.** A turn's checkpoint lists every
  file the turn left changed in the checkout. A merge of `main` makes a session appear to
  change each gate file anyone had changed: 29 of the 34 turns that left a gate file changed
  had moved the checkout. Filtering those turns out by the command that moved them failed
  three reviews running, each finding another way a checkout moves: `fnm exec … -- git merge`,
  a merge that stopped on a conflict, `git switch -C fix origin/main`, the merge lane's
  `handoff --sync`, and a shared checkout that other sessions move between a session's turns.
  Of the 5 changes that survived every filter, 4 were still not the session's own.
- **So the report uses what is recorded outright:** which session published a pull request,
  when, and when it loaded the skill. It judged 9 changes where the turn-by-turn design could
  honestly judge 1.
- **Gate files are not edited with the edit tools.** No file-edit item in the store touches
  one, so the exact moment of such a change is not on record at all.
- **A long-lived thread is linked to many pull requests,** each with a time (all 554 links in
  the store carry one), so each is judged by its own.
- **In a fleet a script publishes the change.** The session that made it is then known only
  by the branch it worked on, which the record keeps as a hash.
- **Which skill a repository requires is its own decision.** AFD's instructions send a change
  to CI or a hook to `gates.md`, a reference file of another skill, not to `maintain-gates`;
  declaring that skill required here would have reported every session as a miss. AFD declares
  none in this pull request.
- **Lushly cannot declare its rule yet.** Its tooling runs a released botcore, and an older
  botcore refuses a setting it does not know. It waits for the release (#1692).

### First collections, 2026-11-21 (#1819)

- **MacBook Air:** 3,060 loads, 60 skill edits and 509 sessions from a store that goes back
  to August.
- **Random:** 1,335 loads, 105 skill edits and 241 sessions, run from the merge commit with
  `uvx` so the installed botcore was not replaced. Its record names the machine `mac`, from its
  hostname: a machine needs a way to name itself before records are read together (#1818).

### First readings on the MacBook Air, 2026-11-21 (#1815, #1816)

- **Most loads are not the Skill tool.** Over 30 days T3 Code's store showed 2,469 skill loads:
  Codex shell reads 1,226, Claude shell reads 628, Claude file-tool reads 478, the Skill tool
  137. A hook declared in a skill would have seen the last group only.
- **The session is the unit.** Counted by top-level thread, one fleet foreman hid forty cells.
  A session is a thread a person started or a task delegated to its own agent.
- **Renames are in git.** `git log --diff-filter=R` over the skill files found every rename of
  a skill folder in Lushly and AFD (`do-prepare-pr` to `prepare-pr` and the rest), so the report
  needs no rename table for a repository's own skills.
- **A typed skill is `$name` in T3 Code**, not `/name`. In 45 of 52 typed requests no tool or
  shell load of the skill followed: the harness had put the skill in context itself. So a
  typed request is a load unless a tool load follows within ten minutes.
- **Reviewers load a skill from the base** with `git show <revision>:<path>`, which prints the
  skill as that revision holds it. Counting it took the store's all-time shell reads from 1,896
  to 2,311.
- **Writing a skill looks like use, and so does auditing the skills.** In Lushly's last 30
  days, 6 sessions changed a skill they had read; the report counts them as authoring it.
- **A dozen skills in a session is ordinary work.** 16 sessions loaded twelve or more
  different skills within half an hour: at most 20 names, and at most 16 of the 31 the
  checkout holds. Every one was a delegated task with its reviewers, none an audit. So an
  audit is two thirds of the skills a checkout holds (21 of 31) in half an hour, and no
  session met it.
- **A script handed to a shell keeps its own here-documents.** Dropping them from the outer
  command took the terminator and left the inner one open, which lost every read after it in
  ten real commands.
- **A session's model is its latest setting**, so it is taken from the run a load happened
  in. A subagent's thread has no runs and cannot switch, so its own setting is used.
- **The denominator.** The store held 506 sessions; in Lushly's last 30 days 227 of 260
  loaded at least one skill, and `review-code-lushly` was used by 147 of them.
- **A subagent or delegated task is its own thread**, whose `lineage` in the thread's payload
  names its parent and its root.
- **A first missed-trigger reading, by hand:** 54 merged Lushly pull requests changed a gate
  file. Nine had a linked thread on the machine measured, and in two of those nine the linked
  thread had loaded the gate skill. Loads in delegated tasks were not counted, so it is a
  floor, and the 45 with no thread there are why collection runs on every machine.

## Phase 1. Collect and report

- `skill-usage-collect` and the record, from T3 Code's store (#1815): merged in #1859.

- `skill-usage-report` (#1816): merged in #1859.

## Phase 2. Missed triggers

- `skill-usage-triggers` and `[[skills.required]]` (#1817): in this pull request.

## Phase 3. Every machine

- Collection with the hourly job, and one report across machines (#1818): not started.

- Rollout to the Air, Random and Hero (#1819): first collections run by hand on the Air and Random on 2026-11-21 (see Findings); Hero and the schedule to come.

## Phase 4. Provider logs

- Claude Code transcripts and Codex rollouts as sources (#1820): not started.

## Later

- Whether a loaded skill prevents the mistakes it names (#1829): needs its design first.

- Size and the quiet list for skills kept outside a project's skill folders (#1830): not started.

- PowerShell quoting in the shell reader (#1847): with the rollout, against a real Windows record.
