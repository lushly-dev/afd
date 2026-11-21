# Skill usage

Maintainers can see which skills agents load, how often, on which harness and machine, and
whether a skill the repository marks as required was loaded before the work it covers. Nothing
is added to the skills and no agent is asked to report.

Progress is in [STATUS.md](STATUS.md). Active since 2026-11-21.

## The problem

A skill is a file an agent may or may not load. Nobody could say which skills were loaded, by
which harness, or whether a skill written for a kind of change was in front of the agent that
made the change. Skills were trimmed, renamed and rewritten without a measure of use.

The obvious instrument is a hook declared in the skill. Measured on one machine over 30 days,
it would have seen about 6% of loads:

| Harness | How the skill was loaded | Loads |
| --- | --- | --- |
| Codex | Shell read of `SKILL.md` | 1,226 |
| Claude | Shell read of `SKILL.md` | 628 |
| Claude | File tool read of `SKILL.md` | 478 |
| Claude | Skill tool | 137 |

A hook in a skill's frontmatter runs only when the skill is invoked through the Skill tool.
Codex has no Skill tool, and reviewers and subagents read the file directly. The harnesses
already record every one of these loads, so the usage record is derived from what they write.

## Goals

- Usage per skill: the sessions that used it, by harness, model, agent and machine.
- The first measure of effect: for a change that needed a skill, whether a session that
  produced the change loaded it (the missed-trigger rate).
- The skills nothing loads, and what each skill costs in context.
- One identity for a skill across a rename, with nothing to configure.
- Every development machine, on macOS, Windows and Linux.

## Non-goals

- No hook in a skill, and no report written by an agent. A live hook is added only if live
  numbers are wanted.
- No prompt, command, argument or file contents in the record, ever.
- No hosted service. The record is a file on each machine.
- Usage does not show that a skill helped: skills are loaded on the harder tasks. Effect needs
  the measures under [Later](#later).

## Jobs

- When I decide what to trim or delete, I want to see which skills nothing loaded and what the
  loaded ones cost in context, so that I cut by evidence.
- When I rewrite a skill's description, I want to see whether more sessions load it afterwards,
  so that I know the rewrite worked.
- When a repository says a skill is required for a kind of change, I want to see the merged
  changes of that kind that no session loaded the skill for, so that I can fix the trigger.
- When I work on three machines with two harnesses, I want one report, so that a session on
  another machine is not invisible.
- When a harness changes how it records its threads, I want collection to say so and keep what
  it has, so that a silent zero is never read as "nobody uses skills".
- The record must stay quiet about what was said: a load is recorded, the conversation is not.

These commands read another program's files on the machine they run on, which the scenario
runner's fixtures cannot stand in for, so the jobs are exercised by the pytest cases in
`endpoints/botcore/tests/test_skill_usage*.py` against a store built to T3 Code's shape,
as the disk commands' jobs are.

## Design

### Sources

1. **T3 Code's store**, `statev2.sqlite` in its user data folder (`~/.t3/userdata/` on every
   platform). It records each tool call, shell command and message of the threads it runs, for
   each provider, with the thread, its parent and root, the project, the model and the linked
   pull requests. One reader covers Claude and Codex. It is another program's internal schema:
   it is opened read-only, the tables and columns the reader uses are checked first, and a
   change is reported as `SOURCE_SCHEMA_CHANGED` with nothing lost.
2. **Provider logs**, for a session that never ran under T3 Code: Claude Code transcripts and
   Codex rollouts. An event's id is the harness's own id for the tool call, so a load both
   sources show is one event.

### A load

| Path | What counts |
| --- | --- |
| `skill_tool` | The harness's Skill tool, by its `skill` input |
| `file_read` | A file-reading tool whose path ends in `skills/<name>/SKILL.md` |
| `shell_read` | A shell command that prints that file: `cat`, `sed -n`, `head`, `tail`, `nl`, `less`, `more`, `bat`, `type`, `Get-Content`, and `git show <revision>:<path>`, which is how a reviewer loads a skill from the base |
| `typed` | A message that opens with `$name` or `/name`, when the name is a skill |

A search, a diff, a listing, an edit or a redirect into the file names it without loading it,
and is not counted. A typed name counts only when the record already knows it as a skill, the
same read shows it loaded another way, or the project's checkout holds it; a message one agent
wrote for another is not typed by anyone. The text a load is recognised in is read and
discarded.

### The event

One line of `events.jsonl` in botcore's state folder (`~/.local/state/botcore/skill-usage/`,
`%LOCALAPPDATA%\botcore\skill-usage\` on Windows): `id`, `at`, `skill`, `path`, `harness`,
`source`, `thread`, `root`, `agent`, `project`, `machine`, `model`.

- **`thread` is the session**: a thread a person started, or a task delegated to its own agent.
  A subagent's load counts under the session it works for. `root` is the thread a person
  started, which ties a delegated task to the work that started it.
- **`agent`** is `main`, `delegate` or `subagent`.
- **`project`** is the folder name of the project's workspace root.
- The file is appended to and never rewritten. A reader keeps each id once, so two collections
  that overlap are harmless. Collecting is what makes the record durable: the harness may
  compact or delete what it recorded.
- A collection continues from the last one, re-reading a day, and reads everything again once
  a week: a thread moved to this machine from another can be older than the last collection.

### Identity across a rename

`skill-usage-collect` reads the renames of `SKILL.md` files from each project's git history
(`git log --diff-filter=R`), so a skill folder renamed in one commit keeps one identity with
nothing to configure. Botcore's own rename table covers the skills it ships. A name the checkout
still holds is never renamed.

### Commands

| Command | Does |
| --- | --- |
| `skill-usage-collect` | Adds the loads recorded since the last collection to this machine's record. Idempotent. |
| `skill-usage-report` | Read-only. Per skill: sessions, loads, sessions where the person asked for it, harness, agent, path, last use, context cost; the skills a checkout holds that nothing loaded. |
| `skill-usage-triggers` | Read-only. For each required skill, the merged changes that matched its paths, and whether a session that produced each loaded the skill. |

The unit of the report is a session that used a skill. A skill read three times in one session,
in parts, is one use; `loads` counts the reads, which is what context cost multiplies.

### Missed triggers

A repository declares which paths require which skill, in its botcore configuration:

```toml
[[skills.required]]
skill = "gate-discipline"
paths = ["lefthook.yml", ".github/workflows/ci.yml", "scripts/check-*.mjs"]
```

For each change merged to the default branch in the window whose files match, the report finds
the sessions tied to that change's pull request (the linked thread, and every session under the
same root) and says whether one of them loaded the skill before the merge. The diff side comes
from git, the load side from the record, and the tie between them from the pull requests T3
Code links to a thread, which collection copies into the record. A change with no session on
any collected machine is reported as unknown, never as a miss.

### Every machine

Collection runs with botcore's hourly job. A machine may name a shared folder, any folder
every machine can see, whether a synced drive or a checkout; collection then also writes its
record there under the machine's name, and a report reads every machine's. Botcore does not
sync the folder.

## Phases

1. **Collect and report** from T3 Code's store.
2. **Missed triggers.**
3. **Every machine:** the schedule, the shared folder, and the rollout.
4. **Provider logs** for sessions outside T3 Code.

## Exit criteria

- On each development machine the hourly job collects, and `skill-usage-report` shows loads
  from every machine.
- `skill-usage-triggers` reports a rate for at least one required skill of one repository, with
  the unknown share stated.
- A changed T3 Code store produces `SOURCE_SCHEMA_CHANGED`, and the record is intact.
- The record of a real machine holds no prompt, command or file contents (checked by search).

## Later

- **Trap rate.** A skill names one or two checkable mistakes; compare how often they happen
  with and without the skill loaded.
- **Before and after an edit.** The version of a skill file in force at a load is derivable
  from the load's time and the file's history.
- **Replay.** Rerun merged work with and without a skill and grade blind. This is the measure
  that shows cause; usage says which skills are worth the replay.
- **Depth.** Which of a skill's reference files are read after it.

## Not yet known

- How long T3 Code keeps what it records. The oldest items on the machine first measured were
  three and a half months old, and its raw event table was already empty.
