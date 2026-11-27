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
fail every hour; and for the triggers report, a checkout whose configuration does not parse
(`CONFIG_INVALID`) or that does not say which branch is its default (`GIT_FAILED`), and a
record with a damaged line (`RECORD_DAMAGED`) (pytest makes each state). Scale: a
real store of 160,000 items reads in about 20 seconds, measured, not asserted.

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
2. **Claude Code's transcripts**, for what never ran under T3 Code: a session started in the
   Claude desktop app or from the command line. Claude Code writes each session as a file of
   JSON lines under `~/.claude/projects/`, and each subagent in a file beside it.
   - **What T3 Code ran is left to T3 Code's store**, which knows more of it: the thread, its
     lineage, its pull requests. A tool call is T3 Code's when the harness's own id of the
     call is one T3 Code recorded: in its store, read from the same snapshot as its loads,
     or on an event the record already holds, since the store may have dropped the thread.
     So is every call of that session whose row names the same program as such a call, or
     names T3 Code itself: the store misses a call now and then, and a missed call is no
     session of its own, nor counted. A session nothing of which is left is not counted
     here. One continued in another program keeps, as a session of its own, what it did
     there.
   - **A row belongs to the session it names.** A subagent's file is its session's wherever
     it lies: in the session's folder, or, as older versions wrote it, beside the transcript
     under a name of its own. Rows copied into a session that was continued from another
     belong to the other, whose own transcript has them.
   - **Only a transcript that changed is read again**, by each of its files' size and last
     change; and one whose call has since turned up as T3 Code's. Only lines that can hold a
     tool call, its result or a typed command are parsed.
   - **A load leaves the record only when its call is read again and is no longer one**: it
     shows another skill, or it has become T3 Code's, which also takes it out as soon as T3
     Code's own event for the call is there. Its session goes with it when nothing of it is
     left. A call that is no longer in a transcript, because Claude Code cleared the file or
     part of it, keeps what was collected of it: that is what the record is for. A
     transcript that cannot be read whole is left as it was and tried again.
   - **The same loads count**, by the same rules: the Skill tool, a file read, a shell read,
     a change to a skill's files, and a command a person typed, which Claude Code writes as
     a message of `<command-name>/name</command-name>` and `<command-message>` tags, when
     the name is a skill. A call counts once its result came back without an error. A
     subagent's load is its session's.
   - **A session is filed under the repository it ran in**: its main checkout, never a
     worktree, whose folder is often named after a branch. A worktree that is gone is found
     through the nearest folder still there. A folder in no repository is `unknown`: a
     session can run anywhere, and a folder's name is not the record's to keep. A session
     stays in the project it was first filed under, wherever its folder leads later.
   - **Only what is shaped like an id or a name is kept**: a call's id, a row's, a session's
     and a model's name go into the record whole, so one that is not shaped like one is
     dropped with what it belongs to.
   - Such a session has no pull request on record, so the triggers report cannot judge a
     change it opened.

Codex writes session logs too. They are not read: on the two machines measured, 208 of 213
name T3 Code as what started them
([#1891](https://github.com/lushly-dev/afd/issues/1891)).

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
- **Reading the skills.** One session loading two thirds or more of the skills a project
  holds ([what a project holds](#what-a-project-holds)), and at least twelve of them, within
  thirty minutes is an audit, a rename or a listing. The report leaves those loads out of
  every skill's count, so an audit done within about half an hour cannot empty the `quiet`
  list. Only skills the project holds count toward the bar.
  The bar is a share because a working session with its reviewers loads a dozen and more in
  that time: on the machine first measured, up to 16 of the 31 the checkout held, against a
  bar of 21. It is decided before any filter, so a filter never changes a skill's count.

### Sessions

Collection also writes `sessions.json`: every session T3 Code holds, whether or not it loaded
a skill, with its root, the session it came from (the one that delegated it, or the one it
was forked from), agent, harness, project, first and last activity and the pull requests T3
Code linked to it or its subagents: `owner/name#number`, when, and whether the session opened
the pull request or attached itself to one that existed. No title and no branch name is kept.
It is the denominator of every share, and it says which session opened which pull request. It
is written from the first collection, since T3 Code does not keep its threads for ever.

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
default branch (`git log <branch> --diff-filter=R`), the branch whose skills the report
lists, so a skill folder renamed in one commit keeps one identity with nothing to configure.
Botcore's own rename table covers the skills it ships. A name the project still holds is
never renamed.

### What a project holds

A report lists a project's skills, sizes them and names them as the project's default branch
has them, never as a folder lies. A checkout left on a branch eleven days old held 21 skills
where another machine's held 27, four of them under names since changed, and the two
machines gave different totals from one record
([#1904](https://github.com/lushly-dev/afd/issues/1904)).

- **At each collection** a machine reads, in each folder of a project, the tip of its
  default branch. The branch is named first: the one the remote calls its default
  (`origin/HEAD`), else `main`, else `master`, so that no other branch speaks for it however
  new. Then, of the remote's copy and the checkout's own, the one ahead: a checkout that was
  not fetched has the remote's behind, one that was not pushed has it ahead. Ahead is the
  one the other leads to, whatever their times (git keeps a commit's time to the second, and
  a clock that runs behind dates a commit before its parent); the newer only where neither
  leads to the other, and of two as new the remote's.
- **From that one commit** it reads the `SKILL.md` files and the renames in its history,
  out of git's objects. The branch checked out, work under way and files not yet added play
  no part, and every machine that has the commit says the same of it. Only names a load can
  be recorded under are listed. A front matter that cannot be read does not stop the read:
  the skill is listed by its first paragraph.
- **A folder that is no repository**, or names no such branch, is read as it lies, files
  not in git and all.
- **A repository git could not read that hour** (it did not answer in time, a ref is
  broken, git refuses the folder) keeps the commit it has on record, through a rebuild
  too. With none on record it is read as it lies, whatever stopped git, and git is asked
  again the next hour. That is all there is to know of a folder another account owns,
  where git refuses every command for good; for a first collection that only timed out it
  lists unmerged work for an hour. An account with no commit is older than any commit, so
  it never takes the place of one
  ([#2051](https://github.com/lushly-dev/afd/issues/2051)).
- **Each folder's account is kept by folder**, on the machine only. A folder whose volume
  is away still speaks through what it said last, so an older clone that does answer never
  takes the project back. A folder read again replaces its own account, whatever it now
  says. A branch that has not moved is not read again; `--rebuild` reads every folder again.
- **A folder that was removed says nothing more**, so the skills of a checkout that is gone
  leave `quiet` and lose their sizes
  ([#2123](https://github.com/lushly-dev/afd/issues/2123),
  [#2245](https://github.com/lushly-dev/afd/issues/2245)). When a folder is read, the
  machine records what it is kept on: its volume's mount point and the volume's own
  identifier (or its device number where the system gives no identifier), as its links
  resolve, or inside a cloud drive's folder (`Library/CloudStorage/<drive>`) that drive's
  own folder. A folder known not to be there, on storage that is there (the same volume
  mounted at the same place, its root looked at and not only named, since Windows calls
  every drive letter a mount point), was removed, and its account is dropped. A volume
  known by its identifier is still recognised when it comes back under another device
  number, and another disk at the same mount point is not; where only a device number was
  recorded, a volume that comes back under another number is taken as away, which only
  waits. Where that storage is away too, or nothing was recorded of it (an account an
  earlier botcore wrote), it may only be away: it keeps speaking for thirty days from when
  it was first found missing, and no longer. A folder the user may not look at, or one of
  another system (a copied store's), is never taken as gone.
- **A project left with no folder holds nothing.** Its loads are still counted, under the
  names its skills last had. With no list there is no audit bar, so a burst of reads that
  was left out as an audit counts as use again (see Limits).
- **The record keeps** the newest of them: each skill's size and listing characters, the
  renames, and the commit with its time. A machine shares that with its record, and only
  what a collection could have written: a commit and a time that are ones, names a skill's
  folder can have, and counts.
- **A report reads no checkout.** For each project it takes the account read from the newest
  commit, among every machine's, by the commit's time; one read from a folder as it lay is
  older than any commit, and of two as new the first machine's by name. A skill's name now
  is read with the list it is looked up in: where two machines' histories say otherwise of
  an old name, the one whose list is used has the last word. So every machine lists the same
  skills, with the same sizes, under the same names, whatever its own checkout is at, once
  each runs this botcore and their records have synced.
- **The triggers report** runs in a checkout, so it also reads that checkout's default
  branch, and uses it where it is newer than the record's.

### Commands

| Command | Input | Result | Refuses with |
| --- | --- | --- | --- |
| `skill-usage-collect` | `since_days`, `t3_store` with `machine`, `rebuild` | `machine`, `added`, `events`, `sessions`, and per source `status` (`read`, `absent`, `off`), `since`, `scanned`, `found`, `added` | `INVALID_INPUT`, `SOURCE_NOT_FOUND`, `SOURCE_SCHEMA_CHANGED`, `SOURCE_UNREADABLE`, `RECORD_UNAVAILABLE`, `COLLECT_RUNNING` |
| `skill-usage-report` | `days`, `ending_days_ago`, `project`, `harness`, `skill`, `agent`, `limit` | `window`, `totals`, `skills` (per skill: `sessions`, `of_sessions`, `share`, `loads`, `typed_sessions`, `harnesses`, `models`, `machines`, `agents`, `paths`, `last_used`, `also_loaded_as`, `authoring_sessions`, `size_bytes`, `max_context_bytes`, `listing_chars`), `more`, `quiet`, `record`, `warnings` | `INVALID_INPUT`, `NOT_COLLECTED`, `RECORD_UNAVAILABLE` |
| `skill-usage-triggers` | `days`, `repo` | `project`, and per required skill `changes`, `loaded`, `missed`, `unknown` with `unknown_why`, `rate`, and `misses` naming each change and its sessions | `NO_REQUIRED_SKILLS`, `NOT_COLLECTED`, `NO_WORKSPACE`, `CONFIG_INVALID`, `GIT_FAILED`, `RECORD_DAMAGED`, `RECORD_UNAVAILABLE`, `INVALID_INPUT` |

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

The report uses only what is known for certain:

- **Which merged changes touched those paths**, from git: every path a change touched, both
  sides of a rename, on the branch the checkout says is the default, never the checked-out
  commit. A path is matched as git writes it, by case, on every system.
- **Which pull request a change is**, from its subject on the default branch: the ` (#n)` a
  forge's squash merge ends it with, or `Merge pull request #n`. A queue that rebases lands a
  commit as written, so there the number must already be in the subject: AFD's
  `pnpm branch:squash` ends it with the pull request's number
  ([#2023](https://github.com/lushly-dev/afd/issues/2023)). T3 Code's store does not say
  which commit a pull request merged as, so nothing else on the machine ties the two.
- **Which session opened a change's pull request, and when**, from the record. T3 Code marks
  the link on the thread that opened a pull request apart from the link on a thread that
  attached itself to one that existed, to repair, review or merge it. In the store first
  measured no pull request has two openers.
- **When that session loaded the skill**, itself or through a subagent, from the record,
  whichever project the harness filed the session under. A load by another task under the
  same root does not count: forty cells of one fleet are forty sessions.

A change is **loaded** when the session that opened its pull request had loaded the skill by
then. `loaded_by_subagent` counts those where only a subagent of the session had: a subagent
may be the reviewer, not the agent that made the change. A change is **missed** when the
session never loaded the skill before the change merged, and names the session, so that it
can be opened. Otherwise it is unknown, never a miss:

- it names no pull request, or one that another change on the branch names too
  (`no_pull_request`);
- no session on a collected machine is linked to its pull request (`no_session`);
- no session linked to it is known to have opened it (`opened_elsewhere`): a script, a person
  or a session on a machine not collected did, or its link does not say. A change a fleet's
  merge lane publishes is judged instead by the sessions its commit names: the lane writes a
  `Factory-session: sha256:<24 hex>` trailer for each thread that worked on the cell, and the
  commit's author time stands for when the cell handed it over (a queue that rebases keeps
  it; one that squashes writes a later one, so a load in between counts as before). One whose
  trailers name no session on record is `no_session`, and one with a trailer no record holds
  is never a miss. A cell registered before the lane kept its threads names none
  ([#1887](https://github.com/lushly-dev/afd/issues/1887));
- the record does not place the opening before the merge (`no_link_time`);
- the session loaded the skill only after it opened the pull request (`after_opening`): at
  review, or for a later push. The record cannot say which;
- the session never loaded it, but the skill may have reached the change another way
  (`possibly_loaded`): a task the session delegated loaded it and may have made the change, a
  fork carries the conversation of the session it came from, which had loaded it or
  delegated a task that did, or the record holds an event of a kind this botcore does not
  know. A sibling's load is none of these, nor the load of the session that delegated the
  opener;
- the record does not reach the change's merge on every machine (`incomplete_record`): a
  machine last collected before the change merged, a machine's copy in the shared folder is
  not whole, or the shared folder was not there. A load made on another machine, or since
  this one last collected, is a load all the same, so until every machine has collected past
  the merge the change waits, and the report names the machines it waits for. Every machine
  with a record is waited for, however long it has been silent: it may have been working
  all the while with its collection stopped. A machine the owner knows is switched off is
  named in `skill_usage_away`, in the settings of the machine the report is read on, and is
  then not waited for. This machine is always waited for: it can collect.

A load's time is its machine's and a merge's is the forge's. A load up to five minutes after
the merge may have come before it, and is no ground for a miss.

A record with a line it cannot read judges nothing: a lost load would make a miss. Nothing is
collected for the rules, so a rule declared today judges the record as it stands. A record an
earlier botcore wrote does not say who opened a pull request: the report says how many links
do not, and collecting again records it. The report also names the branch it read and that
branch's newest change, since a checkout that was not fetched ends early.

A load inside an audit of the skills counts here, though the usage report leaves it out: a
session that read every skill had still read this one.

**What was tried and dropped.** Two ways of tying a session to a change by inference.

*By its turns.* The first design judged each session by its first change to a required path,
read from what T3 Code records of a turn: the files a turn left changed. A checkout is moved
under a session by merges, sync scripts and other sessions sharing it, and a moved file looks
like a changed one. Three rounds of review each found another way: a merge through `fnm exec`,
a merge that stopped on a conflict, a branch started somewhere else, a repository's own sync
script, a shared checkout moved between a session's turns. On the machine first measured, 4 of
the 5 changes that survived every filter were still not the session's own.

*By its branch.* The second design counted every session linked to a pull request, and every
session on the branch it came from. A thread keeps only the branch it is on now: 267 of the
293 pull requests that a person's thread opened came from another branch than the one the
thread is on. The tasks a session sends to review its work share its branch, and they are
what a branch tied: 58 of them, against 6 tasks with a checkout of their own. And the 171
tasks with their own checkout that opened no pull request, a fleet's cells among them, have
no link that names their branch at all. Two of the six misses that design reported named a
session that had only repaired and merged the change.

The declaration is the one source of which skill a change requires. A repository whose
instruction file also lists required skills checks that list against it. Which skills a
repository requires is that repository's decision: this one declares none yet.

### Every machine

Collection runs inside botcore's hourly job, the one `disk-setup` installs, every hour
whether or not a reclaim is due. It runs after the disk work, in a thread the job waits
for while it reports progress (reading the store, transcripts and checkouts) and leaves
behind after five minutes of silence, so that nothing a harness's store or a shared drive
does can fail, delay or hold the disk work, while a slow read on a busy machine still
finishes (#2160). Left, the collection stops at its next step and writes nothing more. Nor does the disk work hold collection: collection waits for it only while it is
working, and a disk step that waits (for a drive, or for the owner's answer to the system)
is left behind. The job keeps when collection last worked and since when it has
not. `disk-status`, which a session's preflight reads, warns of a failure at once and calls
it a problem once it has failed for a day: the record cannot be refilled once T3 Code has
dropped the threads.

A machine says three things in its machine settings (`disk.toml`):

```toml
skill_usage_machine = "random"              # its name in the record
skill_usage_shared = "~/Shared/skill-usage"  # a folder every machine can see, as a full path
skill_usage_collect = false                 # only to turn the hourly collection off
skill_usage_away = ["hero"]                 # machines a triggers report read here does not wait for
```

A name is a folder's name on every system: lower case (a shared drive does not tell `Bench`
from `bench`), with no name Windows keeps for a device. `disk-setup` writes the machine's
hostname down as its name once, since a hostname changes with the network. A name or a folder
that cannot be used stops the collection and never the disk work.

The shared folder is any folder every machine can see, whether a synced drive or a checkout.
After each collection a machine writes its record to a folder of its own name there:

- **What it understood, not its files as they lie.** Its events and sessions are written
  again from what was read, with the fields this module writes and no other. A line that
  could not be read stays on the machine, and the state says how many there are. Of its
  state it shares when it collected, under which rules, and each project's renamed skills
  and the skills it holds, so that a reader lists a project's skills by their names now
  whatever its own checkout is at, or with none. Never its folders.
- **Only what changed**, so a sync has little to send, and the state last. The state names
  the other two files by their digests.
- **Only its own folder.** Each record has an id. A folder that holds another record under
  the same name is not written over: two machines that took one name would each hide the
  other. Nor is the machine's own record, where the shared folder was pointed at it.

The usage report and the triggers report read this machine's record and every other machine's
folder, each event and session once, and the same whichever machine reads. A thread moved
between machines is one session: the later entry's fields, each kept from the earlier where
the later does not know it, every pull request either saw, and of two times for one opening
the earlier. A thread moved to a machine is read there from its start.

Both reports name a machine whose collection is over a day old. A sync delivers files one at
a time, and a machine's new sessions read with its old events would show a session that
opened a pull request and loaded nothing. So a copy is parsed from the very bytes whose
digests were checked, and one whose files are not those its state names is not read, and is
named. So is a folder that cannot be read or is not a machine's, and an empty one that
bears a machine's name: a sync makes a folder before it fills it. While any is named, and
while the shared folder is not there, the triggers report calls no change a miss. A
machine's record with a line that cannot be read is named too, and the triggers report then
judges nothing, as it does for this machine's.

The folder holds session ids, project names and pull request numbers, so it must be private.
Botcore does not sync it and never creates it: a folder that is not there is a drive or a
sync that is away, so the collection says so and the record stays whole on the machine.

The hourly job must be able to read the folder, which is not the same as a terminal being
able to. On macOS a cloud drive that fetches files on demand serves them through the system,
and the system asks the owner at the screen before a scheduled program reads them; the read
waits for the answer. The record is written before it is shared, so after such a run the job
says which of the two did not happen: `this machine's record was collected, but the shared
folder did not answer`, with the folder and what to allow. A drive that keeps local copies is a plain
folder, and nothing is asked. Make the folder on one machine and let it sync: two machines
that each make it get two folders of one name.

A machine renamed after it has collected keeps its old name on the events it wrote. Run
`skill-usage-collect --rebuild` on it and remove its old folder from the shared one; events
whose threads T3 Code has dropped keep the old name. A machine whose state was lost begins a
new id and still writes its folder, since everything in the folder is in its record. One
whose record was started again from less is a new record: remove its old folder from the
shared one, which it will not write over.

A collection cut short leaves its last line unfinished. The next one sees to it before it
writes. A line that stops part way through an event is taken off: the collection that died
never saved how far it had got, so that event is read again, and no report meets a line it
cannot read. A line that holds a whole event and lacks only its end is closed, since that
event is known already and would not be collected again.

The first collection on each machine is run by hand as soon as phase 1 merges, without waiting
for the schedule.

## Limits

- **A skill not merged.** One that is only on a topic branch, or kept out of git in a
  repository (ignored, or not yet added), is counted with no size and is not in the `quiet`
  list until it is on the default branch. A rename is known once it is merged.
- **Which machine's list.** Between machines the newer commit is the one with the later
  time, since a reader may have no checkout to ask which leads to which. A machine whose
  newest commit was dated by a clock that runs behind loses to one that has not fetched it,
  until the next merge. Every reader still agrees.
- **A folder name no load is recorded under** (one with a space, or that begins with `_`
  or a dot) is not a listed skill.
- **A project first named while git could not read its origin** is moved to `owner/name`
  once git answers for that folder, and its recorded events and sessions on that machine are
  refiled under `owner/name` ([#2052](https://github.com/lushly-dev/afd/issues/2052)).
- **Skills outside a project's skill folders.** Size, context cost and the `quiet` list come
  from `.claude/skills`, `.agents/skills`, `.codex/skills`, plus any `[skills].extra_dirs`
  (and custom `source_dir`) declared in the project's `botcore.toml` / `pyproject.toml` on
  its default branch, with `[skills.aliases]` folding canonical and exported names together
  ([#1830](https://github.com/lushly-dev/afd/issues/1830)). A skill folder or `SKILL.md` that
  is a link is not followed in a commit. Personal skill folders (`~/.claude/skills`,
  `~/.agents/skills`, `~/.codex/skills`, plus `skill_usage_dirs` in `disk.toml`) supply sizes
  and appear in `quiet` under `project: "external"` when unused across all projects. A
  `file_read` or `shell_read` of a `SKILL.md` outside those folders records its path locally
  (never shared) and shares its size and listing characters. A skill loaded only through the
  `Skill` tool or a typed name from an unlisted plugin folder has no file path to measure.
- **Cost is a ceiling.** A skill read in three parts counts three whole files.
- **Reads the parser does not know.** A file printed by a script (`python -c`, `xargs cat`) is
  not counted.
- **Two skills merged into one** are not a rename: their histories stay apart.
- **An audit the rule does not see.** One that takes longer than about 45 minutes (so that
  no half hour holds two thirds of the skills), one of a project that holds fewer than twelve
  skills, and one of a project no machine has a folder of all count as use.
- **A machine that has not synced.** Each machine's numbers end at its last collection that
  reached the shared folder; the report gives that time for every machine.
- **A machine named as away.** `skill_usage_away` is the owner's word that a machine was
  switched off. If it was working, a load it holds is not in the record, and a change may be
  called a miss until its record arrives.
- **A machine that has never shared.** One with no folder in the shared one, because it
  never collected or names no shared folder, is not known to the others and is not waited
  for. A load only it holds is not in the record.
- **A load two machines give to different sessions** is counted for both: once more than it
  happened in the usage report, and never as a miss.
- **What the triggers report cannot tell.** Whether the skill was still in the agent's
  context when it made the change: a long session that loaded it days before counts as
  loaded. Whether the load came before the change or at its review: both come before the
  pull request is opened, and a reviewer that is a subagent loads for its session. One
  repository's skill from another's of the same name, for a session the harness filed under
  another project. Any change whose pull request a script opened, unless its commit names the
  sessions that made it, as a fleet's merge lane does
  ([#1887](https://github.com/lushly-dev/afd/issues/1887)). And who made a change, where the
  session that opened its pull request did not: a miss says that the opener never loaded the
  skill. A session that resumed a parked branch, one that published the work of a thread it
  launched (T3 Code records no tie between the two), and one whose task ran on a machine not
  collected are each judged as the opener they are.
- **A copied store.** `--t3-store` with another machine's store names its projects by folder,
  since their checkouts are not here; each machine collecting its own store has no such gap.
- **Windows and Linux** are covered by tests of the recognition and paths, and are first
  exercised on a real machine in the rollout.

## Phases

1. **Collect and report** from T3 Code's store.
2. **Missed triggers.**
3. **Every machine:** the schedule, the shared folder, and the rollout.
4. **Claude Code's transcripts** for sessions outside T3 Code.

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
- A session that edits a skill, and one that reads most of a project's skills in one
  sitting, are not use. The plan guarded against a false zero and not against a false load.
- The report gives a share of sessions, splits by model and machine, takes `skill`, `agent`
  and `limit`, and refuses a project, harness or skill the record has never seen.
- A skill's listing cost sits beside its body cost.
- Each event carries the version of the rules that recognised it, and a rebuild replaces
  older readings.
- The commands' documentation topic names every input, field and refusal, and says "usage"
  where a model looks first.

**Accepted, for a later phase.**

- Missed triggers count a load only by the session that opened the change's pull request, by
  the time it opened it, and name the session that missed (phase 2).
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
- *Counting twelve skills in a session as an audit.* The first rule built for the walk's
  finding did that, and on the real record every session it removed was a fleet cell doing
  ordinary work. The rule is now a share of the project's skills within thirty minutes.

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
