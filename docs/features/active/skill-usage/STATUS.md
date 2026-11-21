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

- **A merge looks like a change.** A turn's checkpoint lists every file the turn left changed
  in the checkout, so a session that merged `main` appeared to change each gate file anyone
  had changed. Of 159 checkpoints that listed a gate file, 153 were of a turn that moved the
  checkout to other commits. Those turns are not read.
- **Making a branch can move the checkout too.** `git switch -C fix origin/main` starts the
  branch somewhere else. Counting it as harmless let three delegated tasks through as "loaded
  first"; a new branch now counts as a move when a start point follows its name.
- **What is left is small and trustworthy.** 6 sessions changed a gate file themselves, and 2
  had loaded the gate skill first.
- **Gate files are not edited with the edit tools.** No file-edit item in the store touches
  one, so every one of those six is known only from the end of its turn.
- **Most merged changes are unknown from one machine.** Of 55 merged changes to a gate file,
  45 had no session on this machine, 8 had a linked session but no change recorded outside a
  turn that moved the checkout, 1 had no pull request number, and 1 could be judged (it had
  loaded the skill). Collection on every machine is what raises that.
- **A long-lived thread is linked to many pull requests.** Judged as one, a coordinator that
  changed a gate file once answered for every pull request it had linked. Each link has a
  time (all 554 in the store do), so a session is judged one pull request at a time.
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
