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
  Counted by session (a thread a person started, or a delegated task), Lushly had 199 sessions
  and 1,948 loads in 30 days.
- **Renames are in git.** `git log --diff-filter=R` over the skill files found every rename of
  a skill folder in Lushly and AFD (`do-prepare-pr` to `prepare-pr` and the rest), so the report
  needs no rename table for a repository's own skills.
- **A typed skill is `$name` in T3 Code**, not `/name`.
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
