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

### Sessions outside T3 Code, and the rollout, 2026-11-21 (#1820, #1819)

- **Most skill loads before November never passed through T3 Code.** Of 708 Claude Code
  sessions on the MacBook Air, 338 were started by the Claude desktop app and 44 from the
  command line; T3 Code started 326. Of 734 Skill tool calls in their transcripts, 529 came
  from the desktop app's sessions, between March and October, and none of those was in the
  record.
- **T3 Code's calls are told exactly.** Every session T3 Code started holds a tool call
  whose id T3 Code's store holds too, and no other does. The id is the same in both places
  (`toolu_…`, which the record keeps as `claude:toolu_…`). Run over T3 Code's own sessions,
  the transcript reader gave the 1,328 loads the store gave, by id, skill and kind.
- **A file is not a session.** 192 files beside the transcripts are subagents', as older
  versions wrote them: every row names the session it worked for. 380 tool calls are in two
  transcripts, copied when a session was continued. 7 transcripts name two programs.
  Reading a file as a session gave 192 sessions too many and 28 loads written twice, which
  the first review found; a row is now the session's it names.
- **What reading them added.** 3,055 events from 415 sessions, beside T3 Code's 3,180 from
  527: 1,623 file reads, 705 Skill tool calls, 536 shell reads, 138 changes to a skill's
  files and 53 typed commands. 2,639 are Lushly's; 72 ran in a folder that is gone and
  leads to no repository.
- **Cost.** The transcripts are 3.2 GB. The first collection takes about a minute with a
  full read of T3 Code's store, and the next about 4 seconds: only a transcript that changed
  is opened.
- **Codex logs are not worth reading yet.** 208 of 213 across the Air and Random name T3
  Code as what started them; 5 came from the Codex desktop app (#1891).
- **The rollout.** The Air and Random run the merged build, installed from git by commit as
  the disk commands were. Each is named in its settings (`air`, `random`), its record was
  rebuilt, and its hourly job collects. Hero was switched off. No shared folder is named
  yet, so each record is still read alone.

### Across machines, what review found, 2026-11-21 (#1818)

- **A miss needs the whole record.** With several machines, the session that opened a pull
  request and the load that answers for it can be on different ones: a thread moved between
  machines, a task delegated to another. Both first reviewers reproduced a load turning into
  a miss when one machine's copy was skipped, stale or away. So no change is a miss until
  every machine has collected past the change's merge. The first fix stopped waiting for a
  machine silent for a day, and the next review made a miss out of that too: a machine is
  now left out only when the owner names it as switched off.
- **A sync delivers files one at a time.** A machine's state names its other files by digest,
  and a reader parses the bytes it checked: checking and then reading again let a sync land
  in between.
- **A moved thread is not read from its start** by a collection that continues from the last
  one, for up to a week. A thread that is new to a machine and older than the last collection
  now makes that collection read everything.
- **Collection must not stand in front of the disk work.** It ran first with no time limit,
  and a wrong machine name refused the whole settings file. It now runs after the disk work,
  for at most five minutes, and its settings are checked where they are used.
- **Two machines can take one name.** The hostname is the default, and a shared drive does
  not tell `Bench` from `bench`. Names are lower case, each record has an id, and a folder
  that holds another record is not written over.

### Missed triggers, first reading, 2026-11-21 (#1817)

Measured on the MacBook Air over 30 days with the rule Lushly's instructions state (the gate
skill for `lefthook.yml`, `ci.yml` and `scripts/check-*.mjs`), before Lushly declares it.

- **The reading.** 55 merged changes touched a gate file. 45 had no session on this machine,
  1 had no pull request number, and 3 had only sessions that attached themselves to a pull
  request something else had opened. Of the 6 that could be judged, the session that opened
  the pull request had loaded the gate skill in 2 and never loaded it before the merge in 4.
  Over 90 days it is the same 6, out of 168. Each of the six was checked by hand against the
  store: the opener's own `gh pr create`, and every thread of its family for a read of the
  skill.
- **T3 Code says who opened a pull request.** A link's `source` is `created` on the thread
  that opened it and `agent` on one that attached itself later: 406 and 151 of the store's
  557 links. No pull request has two openers, and 48 have none on this machine.
- **A fleet's changes cannot be judged yet.** Lushly's merge lane, a script, opens a cell's
  pull request, so no thread opened it: 127 of Lushly's 137 delegated tasks with a checkout of
  their own opened none, where 73 of AFD's 123 did. Most of Lushly's gate changes come from
  cells (#1887).
- **What a session changed cannot be read from its turns.** A turn's checkpoint lists every
  file the turn left changed in the checkout. A merge of `main` makes a session appear to
  change each gate file anyone had changed: 29 of the 34 turns that left a gate file changed
  had moved the checkout. Filtering those turns out by the command that moved them failed
  three reviews running, each finding another way a checkout moves: `fnm exec … -- git merge`,
  a merge that stopped on a conflict, `git switch -C fix origin/main`, the merge lane's
  `handoff --sync`, and a shared checkout that other sessions move between a session's turns.
  Of the 5 changes that survived every filter, 4 were still not the session's own.
- **Nor from its branch.** A thread keeps only the branch it is on now: 267 of the 293 pull
  requests a person's thread opened came from another branch than the thread's. What a branch
  did tie was the tasks a session sends to review its work, which share its branch: 58 of
  them, against 6 tasks with their own checkout. Counting every linked session as well made
  2 of 6 reported misses name a session that had only repaired and merged the change.
- **So the report uses what is recorded outright:** which session opened a pull request,
  when, and when it loaded the skill. It judges 6 changes where the turn-by-turn design could
  honestly judge 1.
- **Gate files are not edited with the edit tools.** No file-edit item in the store touches
  one of Lushly's, so the exact moment of such a change is not on record at all.
- **A long-lived thread is linked to many pull requests,** each with a time (all 557 links in
  the store carry one), so each is judged by its own.
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

- `skill-usage-triggers` and `[[skills.required]]` (#1817): merged in #1888.

## Phase 3. Every machine

- Collection with the hourly job, and one report across machines (#1818): merged in #1889.

- Rollout to the Air, Random and Hero (#1819): the Air and Random collect hourly since 2026-11-21 (see Findings); Hero, and the shared folder on all three, to come.

## Phase 4. Provider logs

- Claude Code's transcripts as a source (#1820): merged in #1892.

## Later

- Codex session logs as a source (#1891): not started; 5 of 213 logs measured are outside T3 Code.

- Whether a loaded skill prevents the mistakes it names (#1829): needs its design first.

- Judging a change whose pull request a script opened, as a fleet's merge lane does (#1887): needs its design first.

- Size and the quiet list for skills kept outside a project's skill folders (#1830): not started.

- PowerShell quoting in the shell reader (#1847): with the rollout, against a real Windows record.
