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
- **Writing a skill and auditing the skills look like use.** In Lushly's last 30 days, 6
  sessions changed a skill they had read and 19 loaded twelve or more skills. The report leaves
  both out of a skill's count.
- **A session's model is its latest setting**, so it is taken from the run a load happened
  in. A subagent's thread has no runs and cannot switch, so its own setting is used.
- **The denominator.** The store held 503 sessions; in Lushly's last 30 days 206 of 260
  loaded at least one skill.
- **A subagent or delegated task is its own thread**, whose `lineage` in the thread's payload
  names its parent and its root.
- **A first missed-trigger reading, by hand:** 54 merged Lushly pull requests changed a gate
  file. Nine had a linked thread on the machine measured, and in two of those nine the linked
  thread had loaded the gate skill. Loads in delegated tasks were not counted, so it is a
  floor, and the 45 with no thread there are why collection runs on every machine.

## Phase 1. Collect and report

- `skill-usage-collect` and the record, from T3 Code's store (#1815): in this pull request.

- `skill-usage-report` (#1816): in this pull request.

## Phase 2. Missed triggers

- `skill-usage-triggers` and `[[skills.required]]` (#1817): not started.

## Phase 3. Every machine

- Collection with the hourly job, and one report across machines (#1818): not started.

- Rollout to the Air, Random and Hero (#1819): not started.

## Phase 4. Provider logs

- Claude Code transcripts and Codex rollouts as sources (#1820): not started.

## Later

- Whether a loaded skill prevents the mistakes it names (#1829): needs its design first.

- Size and the quiet list for skills kept outside a project's skill folders (#1830): not started.
