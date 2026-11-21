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

- Usage per skill: the sessions that used it, out of the sessions there were, by harness,
  model, agent and machine.
- Whether a skill was there when it was needed: for a change that needed a skill, whether the
  session that made the change loaded it (the missed-trigger rate).
- The skills nothing uses, and what each skill costs in context.
- One identity for a skill across a rename, with nothing to configure.
- Every development machine, on macOS, Windows and Linux.

## Non-goals

- No hook in a skill, and no report written by an agent. A live hook is added only if live
  numbers are wanted.
- No prompt, command, argument or file contents in the record, ever.
- No hosted service. The record is a file on each machine.
- Neither usage nor the missed-trigger rate shows that a skill helped: skills are loaded on
  the harder tasks. Effect needs a design of its own
  ([#1829](https://github.com/lushly-dev/afd/issues/1829)) and the measures under
  [Later](#later).

## Jobs

Each job is a file in [scenarios/](scenarios/). The files are checked, not run: these commands
read another program's store on the machine they run on, which no scenario fixture can stand in
for, so each job's steps are run by the pytest cases in
`endpoints/botcore/tests/test_skill_usage.py` against a store built to T3 Code's shape.

| Job | When | Phase |
| --- | --- | --- |
| [cut-by-evidence](scenarios/01-cut-by-evidence.scenario.yaml) | I decide what to trim or delete, and want the skills nothing loaded and what the loaded ones cost | 1 |
| [see-a-rewrite-work](scenarios/02-see-a-rewrite-work.scenario.yaml) | I rewrite a skill's description, and want to see whether more sessions load it afterwards | 1 |
| [never-a-silent-zero](scenarios/03-never-a-silent-zero.scenario.yaml) | A harness changes how it records, or nothing was collected, and the commands must say so | 1 |
| [stay-quiet-about-what-was-said](scenarios/04-stay-quiet-about-what-was-said.scenario.yaml) | Loads are collected from my threads, and only the load may be recorded | 1 |
| [find-missed-triggers](scenarios/05-find-missed-triggers.scenario.yaml) | A repository requires a skill for a kind of change, and I want the merged changes no session loaded it for | 2 |
| [one-report-across-machines](scenarios/06-one-report-across-machines.scenario.yaml) | I work on three machines with two harnesses, and want one report | 3 |

**What writing them changed.** `see-a-rewrite-work` could not be written with a report that
only looked back from today, so the report takes `ending_days_ago`; and a count alone could
not show a rewrite working, so each skill has a share of the sessions there were.
`cut-by-evidence` needed a cost a reader would not mistake for exact: a skill read in parts is
counted whole, so the field is `max_context_bytes`. `never-a-silent-zero` needed a misspelled
filter to be refused: an empty report reads as nobody using a skill.

**What a scenario cannot express here.** That the record on disk holds no prompt or command
(pytest searches the files for a canary). Refusals and results that need a state of the
machine, not an input: `SOURCE_UNREADABLE`, `RECORD_UNAVAILABLE`, `COLLECT_RUNNING`, and a
machine with no T3 Code, which succeeds with nothing collected so that its schedule does not
fail every hour (pytest makes each state). Scale: a real store of 160,000 items reads in about
20 seconds, measured, not asserted.

**Walked by.** One reader who did not write the plan took the three seats of the jobs-first
rule. What it found and what changed is under [The walk](#the-walk).

**For the owner.** The jobs were drafted by an agent from the owner's request and three
decisions he made on 2026-11-21: derive the record instead of adding hooks, run it on every
machine, and make the missed-trigger rate the first measure of effect. Cutting, adding or
ranking the jobs is his; the phases below follow the order he agreed.

## Design

### Sources

1. **T3 Code's store**, `statev2.sqlite` in its user data folder (`~/.t3/userdata/` on every
   platform). It records each tool call, shell command and message of the threads it runs, for
   each provider, with the thread, its parent, the project, the model of each run and the
   linked pull requests. One reader covers Claude and Codex.
2. **Provider logs**, for a session that never ran under T3 Code: Claude Code transcripts and
   Codex rollouts. An event carries the harness's own id for the tool call (`native`), so a
   load both sources show is recognised as one.

T3 Code's store is another program's internal schema, not an interface:

- It is opened read-only, and everything is read from one snapshot, so a thread T3 Code writes
  during the read cannot be half-seen and misattributed.
- Before reading, the tables and columns used are checked; while reading, the fields used
  inside each kind of item. A change to any of them is `SOURCE_SCHEMA_CHANGED`, and what was
  collected before is kept. Items that match the query but carry none of the expected fields
  are a change, not "nobody loaded a skill".

### A load

| Path | What counts |
| --- | --- |
| `skill_tool` | The harness's Skill tool, by its `skill` input, when that input is a skill's name |
| `file_read` | A file-reading tool whose path is `…/skills/<name>/SKILL.md` |
| `shell_read` | A shell command that shows the agent that file: `cat`, `sed`, `head`, `tail`, `nl`, `less`, `more`, `bat`, `awk`, `type`, `Get-Content`, and `git show <revision>:<path>`, which is how a reviewer loads a skill from the base |
| `typed` | A message the person wrote that opens with `$name` or `/name`, when the name is a skill |

- A tool call or command counts once it completed. One that failed, was cancelled or is still
  running is not a load; a running one is picked up when it completes.
- A search, a diff, a listing, an edit or a redirect into the file names it without loading
  it. So does a read whose output goes to a file, a count, a digest or a search. Quoted text,
  comments and here-document bodies are data. The command is parsed, not pattern-matched: the
  shell that wraps it is unwrapped (`zsh -lc`, `pwsh -Command`, `cmd /c`, with a path or flags),
  and it is split into commands outside quotes.
- A typed name counts only when it is a skill: the record already knows it, the same read shows
  it loaded another way, or the project's checkout holds it. A message an agent or the system
  wrote is not typed by anyone.
- A `skill` input that is not shaped like a name is dropped, so a malformed call cannot put
  other text in the record. Claude Code's folder-scoped `<folder>:<skill>` loses the folder.

### What is not use

- **Writing a skill.** A completed change to any file under `…/skills/<name>/` is recorded as
  an `edit` event. A session that changed a skill's files read it as the subject of its work,
  so the report counts that session as authoring the skill, not using it.
- **Reading the skills.** A session that loads twelve or more of a project's skills is an
  audit, a rename or a listing. The report leaves it out of every skill's count, so one audit
  cannot empty the `quiet` list.

### Sessions

Collection also writes `sessions.json`: every session T3 Code holds, whether or not it loaded
a skill, with its root, agent, harness, project, first and last activity, and the pull
requests T3 Code linked to it (`owner/name#number`). It holds no title and no branch. It is
the denominator of every share, and what ties a session to the change it produced. It is
written from the first collection, since T3 Code does not keep its threads for ever.

### The event

One line of `events.jsonl` in botcore's state folder (`~/.local/state/botcore/skill-usage/`,
`%LOCALAPPDATA%\botcore\skill-usage\` on Windows): `id`, `at`, `skill`, `path`, `harness`,
`source`, `thread`, `root`, `agent`, `project`, `machine`, `model`, `native`, `v`.

- **`thread` is the session**: a thread a person started, a fork a person continued, or a task
  delegated to its own agent, on this machine or from another. A subagent's load counts under
  the session it works for.
- **`root`** is the thread a person started, which ties a delegated task to the work that
  started it. For a task delegated from another machine it is the delegating thread's id there,
  which that machine's record uses too.
- **`agent`** is `main`, `delegate` or `subagent`.
- **`project`** is `owner/name` from the origin of the project's checkout, so it is the same on
  every machine and for every clone. A project with no origin takes its folder's name, and a
  second unrelated folder of that name gets a suffix.
- **`model`** is the model of the run the load happened in. A session can switch models, so its
  current setting is never used for an earlier run; a subagent cannot, so its setting is.
- **`id`** is the store's own id for the recorded item plus the skill, so two items are never
  one event.
- **`v`** is the version of the recognition rules that produced the event. After an upgrade
  changes what counts as a load, `skill-usage-collect --rebuild` reads the store again and
  replaces what was recognised before in every item the store still holds; events whose
  items are gone are kept, and the report says when a record holds older events.
- The file is appended to and never rewritten. A reader keeps each id once. A line an
  interrupted write left unfinished is closed before the next append. One collection runs at a
  time.
- A collection continues from the last one of that store, re-reading a day, and reads
  everything again once a week: a thread moved to this machine can be older than the last
  collection.

### Identity across a rename

`skill-usage-collect` reads the renames of `SKILL.md` files from the history of each project's
checkout (`git log HEAD --diff-filter=R`), the checkout whose files the report lists, so a
skill folder renamed in one commit keeps one identity with nothing to configure. Botcore's own
rename table covers the skills it ships. A name the checkout still holds is never renamed.

### Commands

| Command | Input | Result | Refuses with |
| --- | --- | --- | --- |
| `skill-usage-collect` | `since_days`, `t3_store` with `machine`, `rebuild` | `machine`, `added`, `events`, `sessions`, and per source `status` (`read`, `absent`, `off`), `since`, `scanned`, `found`, `added` | `INVALID_INPUT`, `SOURCE_NOT_FOUND`, `SOURCE_SCHEMA_CHANGED`, `SOURCE_UNREADABLE`, `RECORD_UNAVAILABLE`, `COLLECT_RUNNING` |
| `skill-usage-report` | `days`, `ending_days_ago`, `project`, `harness`, `skill`, `agent`, `limit` | `window`, `totals`, `skills` (per skill: `sessions`, `of_sessions`, `share`, `loads`, `typed_sessions`, `harnesses`, `models`, `machines`, `agents`, `paths`, `last_used`, `also_loaded_as`, `authoring_sessions`, `size_bytes`, `max_context_bytes`, `listing_chars`), `more`, `quiet`, `record`, `warnings` | `INVALID_INPUT`, `NOT_COLLECTED`, `RECORD_UNAVAILABLE` |
| `skill-usage-triggers` | `days`, `repo` | `project`, and per required skill `changes`, `loaded`, `missed`, `unknown`, and `misses` naming each change and its sessions | `NO_REQUIRED_SKILLS`, `NOT_COLLECTED`, `RECORD_UNAVAILABLE` |

The unit of the report is a session that used a skill, out of the sessions the project had. A
skill read three times in one session, in parts, is one use; `loads` counts the reads.
`listing_chars` is what a skill adds to the skill listing of every session, used or not.

A project, harness or skill the record has never seen is refused with the values it has, never
answered with an empty report.

When a person names a skill, the harness either puts the skill in context itself or the agent
loads it with a tool. So a typed request is a load, unless a tool or shell load of that skill
follows within ten minutes in the same session: then that one is the load.

### Missed triggers

A repository declares which paths require which skill, in its botcore configuration:

```toml
[[skills.required]]
skill = "gate-discipline"
paths = ["lefthook.yml", ".github/workflows/ci.yml", "scripts/check-*.mjs"]
```

For each change merged to the default branch in the window whose files match, the report finds
the session that made it, by the pull request T3 Code linked to it, and says whether that
session or a subagent of it loaded the skill before the change's first commit. A load at
review time does not count, nor does a load by another task under the same root: forty cells
of one fleet are forty sessions. Each miss names its change and its sessions, so that the
session can be opened. The diff side comes from git, the load side from the record, and the
tie between them from `sessions.json`. A change with no session on any collected machine is
reported as unknown, never as a miss.

The declaration is the one source of which skill a change requires. A repository whose
instruction file also lists required skills checks that list against it.

### Every machine

Collection runs with botcore's hourly job, and a failure that lasts shows in that job's
status, where a session's preflight reads it: the record cannot be refilled once T3 Code has
dropped the threads. A machine may name a shared folder, any folder every machine can see,
whether a synced drive or a checkout; collection then also writes its record there under the
machine's name, and a report reads every machine's. The folder holds session ids, project
names and pull request numbers, so it must be private. Botcore does not sync it.

The first collection on each machine is run by hand as soon as phase 1 merges, without waiting
for the schedule.

## Limits

- **Skills outside a project's skill folders.** Size, context cost and the `quiet` list come
  from `.claude/skills`, `.agents/skills` and `.codex/skills` of the project's checkout. A load
  of a skill kept elsewhere (a person's own folder, a plugin, a repository's source folder for
  generated skills) is counted, with no size, and a canonical name and its exported name stay
  two skills ([#1830](https://github.com/lushly-dev/afd/issues/1830)).
- **Cost is a ceiling.** A skill read in three parts counts three whole files.
- **Reads the parser does not know.** A file printed by a script (`python -c`, `xargs cat`) is
  not counted.
- **Two skills merged into one** are not a rename: their histories stay apart.
- **A thread moved between machines** may be counted on both until phase 3 compares two
  machines' records.
- **A copied store.** `--t3-store` with another machine's store names its projects by folder,
  since their checkouts are not here; each machine collecting its own store has no such gap.
- **Windows and Linux** are covered by tests of the recognition and paths, and are first
  exercised on a real machine in the rollout.

## Phases

1. **Collect and report** from T3 Code's store.
2. **Missed triggers.**
3. **Every machine:** the schedule, the shared folder, and the rollout.
4. **Provider logs** for sessions outside T3 Code.

## Exit criteria

- Every scenario tagged `slice` passes as a pytest case, and after its phase so does each of
  the others.
- On each development machine the hourly job collects, and `skill-usage-report` shows loads
  from every machine.
- `skill-usage-triggers` reports a rate for at least one required skill of one repository, with
  the unknown share stated.
- The record of a real machine holds no prompt, command or file contents (checked by search).

## The walk

One reader took the three seats on 2026-11-21, before phase 1 merged, with the owner's request
in his words and without the author's conclusions.

**Accepted, and built in phase 1.**

- Every session is recorded with its pull requests from the first collection, whether or not
  it loaded a skill. Without it no share has a denominator, and phase 2 would have had nothing
  to tie a change to once T3 Code dropped the threads.
- A session that edits a skill, and one that reads most of a project's skills, are not use.
  The plan guarded against a false zero and not against a false load.
- The report gives a share of sessions, splits by model and machine, takes `skill`, `agent`
  and `limit`, and refuses a project, harness or skill the record has never seen.
- A skill's listing cost sits beside its body cost.
- Each event carries the version of the rules that recognised it, and a rebuild replaces
  older readings.
- The commands' documentation topic names every input, field and refusal, and says "usage"
  where a model looks first.

**Accepted, for a later phase.**

- Missed triggers count a load only by the session that made the change, before its first
  commit, and name the sessions that missed (phase 2).
- The first collection on each machine is run by hand as soon as phase 1 merges, and a lasting
  failure shows in the hourly job's status (phase 3).
- The shared folder must be private (phase 3).

**Declined, and why.**

- *Effect as a job with a phase in this plan.* The owner asked whether skills are effective,
  and nothing here answers that. It needs a design of its own (what a checkable mistake is,
  and how a session is observed for it without recording what was said), so it is
  [#1829](https://github.com/lushly-dev/afd/issues/1829) under the epic, and the missed-trigger
  rate is no longer called a measure of effect.
- *Admitting the commands to a managed host's catalog.* They are served by the command line
  and the local server, as the disk commands are. A catalog entry needs a reviewed policy for
  a command that runs git and writes under the home folder; nothing asks for it yet.
- *A filter for one root or one run.* The audit rule and the `agent` filter cover the cases
  found. A fleet's cells are sessions of their own, and are counted as such.

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
