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

### Three machines, one record, and a checkout that is gone, 2026-11-22 (#1819, #2123)

- **Hero shares the folder.** Its cloud drive's desktop app was installed; the drive is a
  virtual one there. Its scheduled task runs in the signed-in session, so it sees the drive,
  and wrote the shared copy by itself.
- **The same report on all three.** 247 skills, 7,996 loads, 1,039 sessions that used one of
  1,553 seen, 159 skills in `quiet`, no warnings: the same on the Air, Random and Hero, and
  entry for entry on the two Macs.
- **A removed checkout's skills would have stayed for ever (#2123).** A folder that is not
  there kept its last account, so that a volume that is away still speaks. Hero's two
  obsolete checkouts put 58 skills in every machine's report, 48 of them in `quiet`, and
  removing the folders would not have taken them out. A folder now says nothing more once
  it is known to be removed: it is not there, and what it was kept on when last read is.
  One that may only be away keeps its account for thirty days.
- **A path alone does not say which.** The first rule read it from the folder above; review
  showed a mount point left as an empty folder, a link to a checkout on a volume that is
  away, a cloud drive signed out and a folder the user may not look at each taken as
  removed. What a folder is kept on is recorded while it can be read.

### Main's subjects lost their pull request numbers, 2026-11-22 (#2023)

- **AFD's merge queue rebases since 2026-11-22 (#1809).** It lands a pull request's commit as
  written, where a squash merge ended the subject with ` (#n)`. The triggers report reads a
  change's pull request from that, so a change merged since reads `no_pull_request`: of the
  32 commits merged in the first day, 25 end with no number.
- **A number written by hand is often an issue's.** Of the 7 that end with one, 2 name
  their pull request and 5 name an issue, which the report reads as a pull request no
  session opened.
- **Nothing else on a machine ties a commit to its pull request.** T3 Code's link to a pull
  request holds when it merged, its head branch and, where it was watched, its last head,
  and not the commit it merged as, which the queue makes anew.
- **The number goes in the commit (the owner, 2026-11-22).** `pnpm branch:squash` ends the
  subject with the number of the branch's open pull request, so the fold after opening one
  writes it. That covers a branch published through `prepare-pr`.
- **The commits merged without one stay as they are read now.**
- **Not done: the fleet lane.** It folds and validates a branch before it opens the pull
  request, and merges exactly the commit it validated. Giving that commit its number means a
  new commit after the pull request is open.
- **Not covered: a pull request a tool opens.** A release's (`chore: release packages`) and
  Dependabot's are not folded, and land without a number.

### Two machines agree, and a folder git refuses, 2026-11-22 (#1904, #1819, #2051, #2052)

- **The two Macs give the same report.** With #2050 on both, the 30-day report read on each
  from the shared record is the same entry for entry: 175 skills, 4,722 loads, 691 sessions
  that used one, 103 skills in `quiet`, no warnings. Before the update, from one record, the
  Air gave 174 skills and 4,692 loads with 101 in `quiet`; Random gave 177 and 4,672 with 9,
  and an audit session the Air did not see.
- **A report read before a copy has synced still differs** by what has not arrived: the
  first comparison was 30 seconds early and differed by one machine's last six loads.
- **Hero runs the same build.** Its scheduled task ran in 30 seconds and is healthy. Five of
  its nine projects have an account read from a commit (27, 31, 9, 1 and 1 skills); two
  have no skills folder.
- **Git refuses two of Hero's folders (#2051).** Another account owns them, and git stops
  at `detected dubious ownership` for every command. With #2050 such a project held no
  skills: Hero's `quiet` list went from 66 entries to 18. A repository git could not read,
  with no commit on record, is now read as it lies.
- **Such a project keeps its folder's name (#2052).** It was named when git could not read
  its origin, and a name is given once. Making those folders the owner's own, or naming
  them in git's `safe.directory`, is the owner's; it brings back the skill list from the
  default branch, and leaves the loads under the folder's name, apart from the same
  repository's on the other machines.
- **Not done.** Hero has no shared folder: the cloud drive's desktop app is not installed
  there.

### One list of a project's skills, and Hero, 2026-11-22 (#1904, #1819)

- **Why the totals differed (#1904).** A report took a project's skills from the folder on
  the machine that read it. Random's folder of one repository was on a branch eleven days
  old. The Air has one too: its folder of another repository is 73 commits behind the
  remote, and holds 11 skills where the default branch has 14.
- **What a project holds is now in the record.** A collection reads the skills at the tip
  of each project's default branch from git, and shares them; a report reads the record and
  no checkout. On the Air, for its nine projects, the read takes about a second, and for
  eight of them it agrees with the folder; the ninth is the one above. No project there
  keeps a skill out of git.
- **A probe that calls the commands outside the test folder reads the real machine.** The
  tests' isolation (no shared folder, no transcripts) is in `tests/conftest.py`. A
  reviewer's probe under `/tmp` collected this machine's Claude Code transcripts as a machine
  named `bench` and wrote them to the real shared folder, where every report would have
  counted those loads twice. The folder was moved out within minutes. A probe sets
  `BOTCORE_SKILL_USAGE_STATE`, `BOTCORE_SKILL_USAGE_SHARED`, `BOTCORE_SKILL_USAGE_T3_STORE`
  and `BOTCORE_SKILL_USAGE_CLAUDE_DIR` itself.
- **The collection ran out of its five minutes on both Macs in one hour** (08:40 UTC), both
  while reading T3 Code's store, with load averages of 10 to 26 from other work. By hand a
  collection on the Air took 20 seconds minutes later and added what was missed.
- **Hero collects (#1819).** Its first collection read 3,822 events (3,303 loads, 519 edits)
  from 427 sessions, 3,812 of them from T3 Code's store. Its scheduled task ran the job in
  17 seconds. Over 30 days on that machine alone: 3,057 loads of 115 skills in 294 sessions,
  of 427 seen; by harness codex 2,076, claude 754, antigravity 227.
- **No skill name on Hero looks misread** (no quote, backslash, `$`, space, `.md` or more
  than 60 characters). That does not show no load was lost to PowerShell quoting (#1847): a
  lost load leaves no name.
- **Not done.** Hero has no shared folder: the cloud drive's desktop app is not installed
  there, which is the owner's to do. Its numbers are not in the other machines' reports.

### The shared folder on two machines, 2026-11-21 (#1819, #1903, #1904)

The Air and Random name one shared folder, in a cloud drive (Google Drive for desktop). Each
writes its own folder there and reads the other's.

- **Sync.** A folder made on one machine reached the other in about 20 seconds, and a
  machine's copy (3.2 MB of events) in 10 to 30, with the same digests on both sides.
- **First reading across two machines.** One record of 7,923 events and 1,203 sessions. Over
  30 days: 4,311 loads of 171 skills in 592 sessions, of 954 sessions seen.
- **The totals differ a little by machine (#1904).** Random gave 4,291 loads of 174 skills
  from the same record. Its checkout of one repository was on a branch eleven days old, with
  21 skills where the Air's holds 27, four of them under names since changed. A checkout that
  still holds an old name keeps it, and the audit rule counts two thirds of what the checkout
  holds: 14 there, 18 on the Air.
- **macOS asks before a scheduled program reads a cloud drive's folder (#1903).** Random's
  drive fetches files on demand. Its scheduled collection wrote the machine's record, then
  waited at the shared folder until its five minutes were up, and said only that it had not
  finished; run from a terminal it wrote the shared copy in seconds. The system log has the
  question, for the job's Python and the drive. After it was allowed, a program started by
  the scheduler wrote to the drive. The Air's drive keeps local copies, a plain folder, and
  nothing was asked.
- **The same question for an external volume stopped the whole job** (#1902, in the disk
  hygiene status): no collection for as long as the disk work waited. The job now leaves a
  disk step that waits, and says of a shared folder that does not answer that the record was
  collected.
- **Since.** Random's question for the external volume was answered about three hours after
  its job stalled. The run that had been waiting finished, and the next reclaimed on that
  volume, collected and wrote the shared copy.
- **Not done.** Hero.

### Rollout readings, 2026-11-21 (#1819)

Both machines run the build of all four phases (commit `a30d79879`), installed from git by
commit, and collect every hour.

- **MacBook Air (`air`):** 6,248 events from 911 sessions. Claude Code's transcripts gave
  3,055 of them, from 712 transcripts. Over a year, 653 of the 911 sessions used a skill:
  4,024 loads by Claude and 1,797 by Codex, across 203 skills.
- **Random (`random`):** 1,996 events from 334 sessions. Its transcripts gave 555, from 297.
  Over a year, 212 of its 364 sessions used a skill: 1,060 loads by Claude and 444 by Codex,
  across 101 skills.
- **Not done.** Hero was switched off. No shared folder is named, so each record is read on
  its own machine, and the triggers report sees one machine's sessions.

### Sessions outside T3 Code, and the rollout, 2026-11-21 (#1820, #1819)

- **Most skill loads before November never passed through T3 Code.** Of 708 Claude Code
  sessions on the MacBook Air, 338 were started by the Claude desktop app and 44 from the
  command line; T3 Code started 326. Of 734 Skill tool calls in their transcripts, 529 came
  from the desktop app's sessions, between March and October, and none of those was in the
  record.
- **T3 Code's calls are told by their ids, and its sessions by the program.** Every session
  T3 Code started holds a tool call whose id T3 Code's store holds too, and no other does.
  The id is the same in both places (`toolu_…`, which the record keeps as
  `claude:toolu_…`). But the store misses a call now and then: in 32 older sessions it
  lacked 1 to 22 of 40 to 2,822. So a call is also T3 Code's when its row names the program
  that made a call the store holds. Run over T3 Code's own sessions, the transcript reader
  gave the 1,333 loads the store gave, by id, skill and kind, and 12 the store missed.
- **A file is not a session.** 192 files beside the transcripts are subagents', as older
  versions wrote them: every row names the session it worked for. 380 tool calls are in two
  transcripts, copied when a session was continued. 7 transcripts name two programs.
  Reading a file as a session gave 192 sessions too many and 28 loads written twice, which
  the first review found; a row is now the session's it names.
- **A record keeps what was collected.** The first fix replaced what a transcript gave with
  what it gives now, and the next review erased a load with it by clearing a subagent's
  file. A load now leaves only when its call is read again and is no longer one.
- **What reading them added.** 3,055 events from 381 sessions, beside T3 Code's 3,193 from
  529: 1,623 file reads, 705 Skill tool calls, 536 shell reads, 138 changes to a skill's
  files and 53 typed commands. 2,639 are Lushly's; 72 ran in a folder that is gone and
  leads to no repository.
- **Cost.** The transcripts are 3.2 GB. The first collection, with a full read of T3 Code's
  store, took 40 seconds on an idle machine and 78 on a busy one; the next took 4 and 13.
  Only a transcript that changed is opened.
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

- Rollout to the Air, Random and Hero (#1819): done 2026-11-22. All three collect hourly, run the same build and share one folder (see Findings).

- A shared folder the hourly job cannot read (#1903): merged in #1923.

## Phase 4. Provider logs

- Claude Code's transcripts as a source (#1820): merged in #1893.

## Later

- Codex session logs as a source (#1891): not started; 5 of 213 logs measured are outside T3 Code.

- The same totals whichever machine reads, when checkouts differ (#1904): merged in #2050.

- A repository git refuses lists the skills its folder holds (#2051): merged in #2053.

- A project first seen while git could not read its origin keeps its folder name (#2052): merged in #2337.

- A change's pull request under a queue that rebases (#2023): `pnpm branch:squash` merged in #2088; the fleet lane waits for #1887, to be done with it (the owner, 2026-11-22).

- A removed checkout's skills leave the reports (#2123): merged in #2152.

- Whether a loaded skill prevents the mistakes it names (#1829): needs its design first.

- Judging a change whose pull request a script opened, as a fleet's merge lane does (#1887): needs its design first.

- Size and the quiet list for skills kept outside a project's skill folders (#1830): merged in #2519.

- PowerShell quoting in the shell reader (#1847): merged in #2222.

- Know a folder's volume by its identifier, not its device number (#2245): merged in #2282.
