# Test effectiveness

Maintainers can see what each check observed and what it cost, follow a defect a reviewer found
to the check that would have caught it, see how often review reported what a check caught, and
see afterwards whether a change to the checks did what it was meant to. Nothing in the record
claims a cause that the evidence does not hold. A session writes three things it does not write
today, each from a fixed list: a finding's class and disposition, the decision about its check,
and a line on a fix commit that says how the bug was found.

Proposed 2026-11-24, from the owner's request the same day, and active since then: progress is
in [STATUS.md](STATUS.md). It was revised twice before it was approved, after an independent
review ([The review](#the-review)) and after its jobs were walked ([Jobs](#jobs)). It extends
the test integrity epic ([#1387](https://github.com/lushly-dev/afd/issues/1387)), whose
test-change report it adds to.

Words used here:

- A **check** is one step of one job of one workflow (in `umbel.yml`, the step `Format` of the
  job GitHub shows as `Umbel (fmt, clippy, test)`), or the command `pnpm verify` runs in its
  place. A step that runs a group of commands is one check for each: `ci.yml`'s `Quality gate`
  step runs the 20 commands of `pnpm check`.
- A **fix commit** is a commit of type `fix` on `main`. It is an entry in an inventory, not a
  count of bugs: one can hold five, and one can answer a check that did its job.
- An **escape** is one defect with evidence that it was on `main`: an issue labelled `type:bug`
  or `type:security` that a merged change closes.
- A **finding** is a defect a reviewer reported before merge and the author accepted.
- A **catch** is a failure with evidence that the check stopped a defect ([What changed after a
  failure](#what-changed-after-a-failure)).

## The problem

The repository runs many checks on every change and cannot say what any of them is worth.
Measured on 2026-11-24, and reproduced by the reviewer from the same sources:

| Workflow, on pull requests, 17 to 23 Nov | Runs | Wall hours | Failed |
| --- | ---: | ---: | ---: |
| Loam | 895 | 206 | 50 |
| Specimen | 623 | 95 | 35 |
| Loam desktop | 762 | 92 | 34 |
| CI (the TypeScript gate) | 1,301 | 65 | 36 |
| Conformance | 686 | 56 | 35 |
| Umbel | 318 | 47 | 15 |
| Botcore factory | 420 | 41 | 2 |
| Loam plugins | 147 | 35 | 0 |
| Rust | 96 | 12 | 0 |

- **A failure has no meaning attached.** All pull-request workflows but the verdict completed
  8,237 runs in about 800 wall hours: 5,680 passed, 313 failed, 1,315 were cancelled and 929
  ended `action_required` and tested nothing. In the merge queue, 25 runs failed in 23 of 363
  groups, 15 of them Loam's. Nothing says which failure stopped a defect. Thirty runs passed on
  a later attempt of the same commit (26 after failing, 4 after being cancelled), which shows
  the order of events and not why.
- **A quiet check has no meaning either.** Loam plugins and Rust did not fail once. That reads
  the same whether a check tests nothing or agents fix what it finds before they push.
- **Local results are thrown away.** `pnpm verify` holds each step's result and seconds, prints
  them and keeps only a record of a full pass (`scripts/affected.mjs`,
  `scripts/verify-record.mjs`). Session transcripts on one machine show at least 43 failed
  steps in 22 sessions over three weeks. That figure cannot be reproduced from the repository
  and is an undercount: a detached run's output is not in a transcript.
- **What got through is on `main` and nobody reads it.** Of 449 commits merged that week, 124
  were fix commits, and about 117 of them touch a test path as well as source. That does not
  show that each test detects its bug, and the 124 are not 124 bugs:
  [one](https://github.com/lushly-dev/afd/commit/39b8c2af6) answers a type error the TypeScript
  check caught on a dependency update,
  [one](https://github.com/lushly-dev/afd/commit/caf26585f) closes five issues, and [a `feat`
  commit](https://github.com/lushly-dev/afd/commit/4b2b8959b) carries fixes that the type does
  not show.
- **What reviewers find is prose.** Each pull request's Review section describes the findings;
  the review record (`scripts/review-record.mjs`) keeps two counts, `fixed` and `deferred`.
  Nothing joins a finding to the checks that had run on the code the reviewer read, so a test
  that missed a defect and a test that had not run yet look the same.

Method: the Actions runs API for `pull_request`, `merge_group` and `schedule` events by
creation time in UTC, with run ids kept once; wall hours are creation to last update, capped at
six hours, so they include queue time and are not billed minutes. Commits:
`git log origin/main` without merges. A test path is a `tests` or `test` directory, a `.test.`,
`.spec.` or `.scenario.` name, or a Python or C-style test file name.

## Goals

- For each check: how often it ran and in which event, what it cost, how often it failed, and
  what is known about each failure.
- For a defect a reviewer found: whether the checks had run on the code it read, the check that
  was added for it with the proof that the check fails without the fix, or the recorded reason
  that no check was added.
- For a check's failures on a state reviewers had read: how many a reviewer had reported, so a
  check is weighed against what review alone would have let through.
- For each change made on this evidence (a check added, a trigger narrowed, a suite moved, or a
  decision to leave things as they are): what happened afterwards.
- The same numbers for two periods side by side, so the question can be asked again when the
  models change.

## Non-goals

- **No cause read from a file list.** The record says what changed between a failure and a
  pass. It calls that a catch only where a named test failed, stood unchanged and passed after
  the source changed.
- **No recommendation from silence.** A check that never failed is reported as quiet, with how
  much of its use was observed. The report can put the costliest checks first for a person to
  read. Nothing proposes to move or remove one.
- **No session's word taken for more than it is.** The words a session writes (a finding's
  class and disposition, a decision, how a bug was found) come from fixed lists and are refused
  where they are written when they are not on the list. They are that session's account, as the
  Review section's counts are now. A proof counts as run only where the proof script's own line
  is in a machine's record.
- **No collection that runs code.** Collecting reads GitHub, git and the records. Only the
  proof script runs a test, and a session runs it.
- **No command output, test output or file contents in the record.** Paths, digests, names of
  checks and tests, durations and counts only.
- **No new gate on a number**, which would be met by checking less.
- **No hosted service.** A file on each machine and a shared folder, as [skill
  usage](../skill-usage/skill-usage.proposal.md) does it.

## Jobs

Each job but the last is a file in [scenarios/](scenarios/). The data is invented. Nothing is
built, so the files are checked and not run. Once built, the same files run against a prepared
repository, a recorded set of API answers and a record, so that the expectations are not
written twice.

| Job | When | Phase |
| --- | --- | --- |
| [see-what-ran-and-what-failed](scenarios/01-see-what-ran-and-what-failed.scenario.yaml) | I ask what the checks cost, and want each check's runs by how they ended, its minutes and its failures, the costliest first and the quiet ones marked | 1 |
| [see-the-fix-commits](scenarios/02-see-the-fix-commits.scenario.yaml) | I ask where bugs reach `main`, and want the fix commits and the escapes they close, by area, without one being taken for the other | 1 |
| [never-a-silent-zero](scenarios/03-never-a-silent-zero.scenario.yaml) | Nothing was collected, a source could not be read or was read in part, or a check was never observed, and the report must say so | 1 |
| [follow-a-finding-to-a-check](scenarios/04-follow-a-finding-to-a-check.scenario.yaml) | A reviewer found a defect, and I want to know whether the checks had run on it, which check was added and whether that check is shown failing without the fix | 2 |
| [decline-a-check-with-a-reason](scenarios/05-decline-a-check-with-a-reason.scenario.yaml) | A finding needs no new check, and I want that recorded so a later session that meets the same proposal finds the answer | 2 |
| [find-where-a-check-would-help](scenarios/11-find-where-a-check-would-help.scenario.yaml) | Defects of one class keep getting through in one area, past the checks in review or onto `main`, and I want that place shown with its examples | 2 |
| [count-a-catch-only-on-evidence](scenarios/06-count-a-catch-only-on-evidence.scenario.yaml) | A check failed and later passed, and I want each failure labelled by what the evidence shows, without a cause it cannot show | 3 |
| [weigh-a-check-against-review](scenarios/10-weigh-a-check-against-review.scenario.yaml) | I weigh a check, and want what it caught beside what it ran on and missed, and whether reviewers had reported its catches on the states they read | 3 |
| [replay-a-narrower-trigger](scenarios/07-replay-a-narrower-trigger.scenario.yaml) | I propose a narrower trigger or a move to daily, and want the runs it would have saved and the failures it would have delayed, in CI and locally | 4 |
| [see-whether-a-change-worked](scenarios/08-see-whether-a-change-worked.scenario.yaml) | I changed a check or its trigger, and want to see whether the defect came back and whether the work was saved, and which decisions are due another look | 4 |
| [compare-two-periods](scenarios/09-compare-two-periods.scenario.yaml) | The models changed, and I want the same numbers before and after, check by check, with how much of each is attributed | 5 |
| see-a-new-test-fail (no scenario: a section of a report, not a command) | A branch adds test cases, and I want each shown failing against the code before the change, so a test that cannot fail is seen when it is added | 6 |

**What writing them changed.** `follow-a-finding-to-a-check` could not end at a count of
classes, so a finding carries the state it was made on, what the checks had done there, and a
decision. `decline-a-check-with-a-reason` made "no check" a recorded outcome.
`replay-a-narrower-trigger` replaced a list of filters that "never pay": the runs a broad
filter caused are not the runs a narrowing would save, so the proposed change itself is
replayed over the history. `see-whether-a-change-worked` needed decisions to be kept somewhere
a later report can read.

**What a scenario cannot express here.** Time passing (the fixture carries both ends). The
owner's approval, which is a pull request left open for him and not a command. What a session
writes outside the commands: the findings it records, the proof it runs and the decision files
it commits are scripts and files, and the fixture holds their results. That the record holds no
output or contents (a test searches the files for a canary). Refusals that need a state of the
machine and not an input: `NO_WORKSPACE`, `SOURCE_UNREADABLE`, `SERVICE_UNAVAILABLE`,
`RECORD_UNAVAILABLE` and `CONFLICT`. Scale: a week is about 17,000 workflow runs.

**Walked by.** The first draft's jobs were compared with a list one reader drafted from the
owner's words before it read the plan (GPT-6.2 Astra at high effort, on another provider); what
that found is under [The review](#the-review). The revision added jobs and a command, so on
2026-11-24 the paths were walked by three fresh readers, one for each seat of the jobs-first
rule (Claude Opus 5.5 at high effort), and walked again by three more after the first walk's
fixes added a job.

What the first walk changed:

- **Jobs that stopped at detection.** A finding left `open` could never be closed, a wrong
  class could not be corrected, a contradicted decision stayed contradicted and a date to look
  again had no reader. Decisions are now files that can settle or correct a finding, restore a
  move and replace one another, and the report lists what is open and what is due.
- **The owner's question about review had no job.** `weigh-a-check-against-review` is new: a
  check's catch on a state reviewers had read is compared with what they reported.
- **A quiet check was in no scenario,** and neither was the report's order. Both are in job 01.
- **The proof depended on the order of a session's work** and could be typed by hand. The
  reviewed state is now kept, so a proof can be run whatever was fixed first, and one that no
  machine's record holds is reported as `claimed`.
- **The busiest workflow was one check.** `Quality gate` is 20 commands. A check now goes down
  to the command.
- **Collecting was a single call of unknown length** on an allowance every session shares. It
  is now scheduled, limited and resumable.
- **A trigger could be narrowed by a session that did not know the rule.** A script in
  `pnpm check` now fails that pull request without its decision entry.
- **An escape had no class,** so "what came later" could not be grouped. The `Found-by:` line
  carries it.
- **Lists had no bound and the host cuts long answers.** Every list has a limit, an order and a
  count of what it left out.

What the second walk changed:

- **The plan misread three things that exist.** `scripts/review-record.mjs` cannot hold
  findings, so a script of its own does. The commit hook would have asked every commit of a
  branch for a `Found-by:` line, so the fold asks the one that lands. The scheduled-failure
  tracker cannot read a decision, so a contradiction is read from the runs.
- **The proof swapped files under a working agent.** It now runs in a worktree of its own, once
  for each check, and handles a test that lives in a source file.
- **The owner's hold had three ways round it:** a factory cell, a job kept to the schedule by a
  condition and not a trigger, and a workflow with no schedule to move to. The lane holds the
  first and the folder's check refuses the other two.
- **A check's misses were counted only by class.** The row for a check now holds them beside
  its catches, and the review counts cover catches only, not every failure.
- **Where a new kind of check would help was the last clause of another job,** and a class that
  escaped with no review finding never showed. `find-where-a-check-would-help` is new.
- **A deferred finding had no place,** and a declined one came back without its files, so the
  next session could not tell whether it was the same proposal. Both are recorded.
- **The measures command served no job** and is cut ([Measures](#measures)).
- **Nothing said how a machine starts collecting,** or that the allowance is the account's.

That fix added a job again, so one more reader walked all three seats (Claude Opus 5.5 at high
effort). It asked for no new job or command, so the walking ended there. It corrected more of
what the plan said about things that exist: where the class list can live, what `ci-ok` can
run, that `pnpm verify` keeps no hook summary yet, that a new worktree needs its dependencies,
and that the lane's hold is narrower than the plan assumed. It also found that a decision could
never be `contradicted` as defined, since a scheduled run has no unmoved base, that an earlier
answer older than the window was not found, and that a check proposed for a class was never
shown failing on the examples it was proposed for. All are fixed above.

Declined, and why. Running `pnpm verify` before review, so that every finding has its checks'
state: nearly every review leads to a fix, so it would run the local gate twice on nearly every
pull request, and the proof's own run answers for the check that matters. Having the collector
run proofs again: collecting must not run code from a pull request. Running the proof in the
session's working tree, which is cheaper: an agent edits there and its commands are cut off by
time limits. A label only the owner can set as proof of his approval: sessions act under his
account. Admitting the commands to a managed host's catalog now
([Surface](#the-record-and-the-commands)). Moving the merge-queue view and the documents filter
out of the plan: each serves the cost half of the owner's question.

**For the owner.** The jobs were drafted by an agent. Cutting, adding and ranking them is the
owner's, with the decisions under [For the owner to decide](#for-the-owner-to-decide).

## Design

### Three kinds of statement, kept apart

1. **Observations:** what ran, how it ended, how long it took, what merged, what differed
   between two states. Derived from GitHub, git and `pnpm verify`.
2. **Links:** evidence that ties a failure, a defect and its correction. A named test that
   failed, was not edited and passed after the source changed. An issue a merged change closes.
   A check shown failing on the state a reviewer read.
3. **Decisions and their results:** a change someone made on this evidence, what it was
   expected to do and what happened afterwards.

The report never promotes one kind to the next. A rate is given only over observations, a catch
is counted only from a link, and a recommendation is never produced: the report answers a
question about a proposed change.

### Runs and checks

A run is read from the Actions API with its event (`pull_request`, `merge_group`, `schedule`,
`push`, `workflow_dispatch`), its attempt, the revision it tested and that revision's base (a
pull request tests a merge ref, whose base moves). Jobs and steps are read with their own
conclusions and times. Runs of other events (`workflow_run`, `issues`, `dynamic`) are kept,
given no rows, and named with their counts in the coverage.

- **A check is the workflow, the job with its matrix leg, the step and, inside a step that runs
  a group, the command.** It is written
  `umbel.yml / Umbel (fmt, clippy, test) (ubuntu-latest) / Format`, or
  `ci.yml / TypeScript (Node 26.x) / Quality gate / boundaries` for one command of a group. The
  job is named as GitHub names it, leg included, so a leg that runs only daily is not confused
  with the one that runs on pull requests. A step goes by its name in the workflow file, or by
  its command where it has none. Every row of a report carries this id, and the `check` input
  takes it as written. A job that calls a workflow of the repository is named as GitHub names
  it, `<caller> / <job of the called workflow>`. Where an expression decides the matrix (as in
  `ci.yml`), the file cannot say which legs there are: the legs known are the job names the
  record has seen, and until one is seen the job is listed once under its name in the file.
- **A group is split by what the hook runner reports.** A group step is a step whose command
  comes down, through the root `package.json` scripts, to `lefthook run <group>`; `pnpm check`
  is Lefthook's `check` group. The step is then not a check itself: each command of the group
  in `lefthook.yml` is. Lefthook ends a run with each command's result and time. When the jobs
  of an attempt are read and a group step failed, that job's log is read once (one counted
  request), and of its closing summary each command's name, result and seconds are kept and
  nothing else: a name only where the group has it at the default branch's tip, so no line of
  the log reaches the record. A summary that cannot be read is said to be so, and its
  commands' results are unknown, never guessed. Where a step passed, its commands passed with
  it, and their seconds are known only where its summary was read: in CI as the collection's
  allowance permits, since those logs are what a collection reads last, and locally once
  `pnpm verify` keeps that summary, which it passes straight through today (phase 2). A command
  a read summary does not name did not run. The coverage gives the share of group steps whose
  summary was read.
- **A step that did not run is not a run of that check.** A job that fails at its linter has a
  failed lint step and steps that never ran; those, and any step GitHub marks skipped for
  whatever reason, are counted as `not-run`, apart. A passed attempt in which a step was
  skipped keeps its conclusions for that reason. A job's time outside its steps is kept as the
  job's overhead.
- **A check that ran and never failed is marked `quiet`,** with its local runs and failures
  beside it and what the record cannot see. Quiet in CI is not quiet: the checks agents satisfy
  before they push fail locally. Where local runs were not collected the row says `absent`, not
  zero.
- **A check's id is its names,** so a renamed step or a changed matrix value is a new check.
  Its row gives what it was called before where a decision file says so ([Decisions and what
  came of them](#decisions-and-what-came-of-them)).
- **How a run ended is never merged.** Passed, failed, cancelled, `action_required` and skipped
  workflow runs are counted apart, and a rate says which of them it is over. A run that ended
  `action_required` ran no step, so it is in the workflow's totals and in no check's.
- **A local step maps to a check only where the generator says so.** `pnpm ci:sync` builds the
  local suites from the workflows and rewrites some commands on the way
  (`scripts/sync-ci.mjs`). It will write the job and step each local step came from into
  `scripts/affected/suites.generated.mjs`; a local step with no such origin is its own check.
- **One run is one event on every machine.** A run's id and attempt are GitHub's, so two
  machines that collect the same run keep it once. A local invocation has an id of its own. A
  validation the factory lane starts is the `pnpm verify` invocation it ran, so the lane's own
  records are not a source, and a push that reuses a verify record ran nothing and writes
  nothing.

### Fix commits and escapes

Every `fix` commit and every revert on the default branch is read once into an inventory,
reverts counted apart: the packages that own its files, as `scripts/affected/scope.mjs`
resolves them (with `repository` for files none owns, and `several` with each unit named when a
commit's files belong to more than one), the test paths it touches as the test-discovery check
tells them (so a Rust test inside a source file counts), and the issues it closes.

- **An escape is counted per closed issue labelled `type:bug` or `type:security`,** not per
  commit. The issues are those the commit's message closes and those its pull request closes
  (GitHub's `closingIssuesReferences`, read through the number that ends the subject): of the
  124 fix commits of 17 to 23 Nov, 68 carry no closing word of their own. A fix commit that
  closes none is `unconfirmed`: it may be a bug, a planned change or the answer to a check that
  worked. Labels and pull requests are read from GitHub, so without it the commits are read and
  the escapes are not: the source is `partly` read and says so.
- **Age is the age of the last edit.** The lines a fix replaces are blamed at its parent, and
  the newest of them is reported as that, with the share of commits it could be read for. It is
  not called the age of the bug, and nothing is inferred from it.
- **How it was found, and its class** (phase 2) is a `Found-by:` trailer on the commit that
  lands: the channel (`review`, `check`, `daily`, `use`, `sweep` or `unknown`), the class from
  the findings' list below, and the issue where the line is about one, as in
  `Found-by: use contract #123`. An escape then has a class, so findings and escapes can be
  grouped together. The line is asked for where the landed commit is made and checked, not on
  every commit of a branch: `pnpm branch:squash`, on every path including a branch that is
  already one commit, and `ci-ok` refuse a `fix` subject without it, with the two lists, so a
  missing line is never read as `unknown`. `ci-ok` runs the base's copy of a short list of
  scripts, so a rule reaches it in two steps: the script first, its place in `ci-ok` after. A
  branch's own `fix` commits that answer its review carry none. Commits from before the rule's
  date are `absent`, counted apart. The fold keeps lines that differ, so a commit that closes
  several issues carries one for each. A wrong line cannot be changed on `main`; a decision
  file corrects it.
- **A revert** is a commit whose subject begins `Revert "`; the repository's commit types have
  none of their own. Reverts are counted apart and need no line.
- Fixes that travel inside a `feat` commit are not seen, and the report says so.

### A finding, the checks on its state, and a decision

This is the part the owner asked for first, so it is built before anything about tiers.

A reviewer's line gains a class from a fixed list: `logic`, `contract`, `parity`, `claim`,
`security`, `concurrency`, `interface`, `other`. The brief `prepare-pr` gives a reviewer asks
for it at the end of each finding's line. It is not written into `review-code`, which is
generated from Botcore and seeded into other repositories. A reviewer's request for a test
where behaviour is new is not a defect and has no class: it is recorded as `missing-test` and
counted apart from the findings, so that asking for tests does not read as finding bugs.

The session records each finding with a script and not in prose. `scripts/review-record.mjs`
cannot be that script: it serves lane mode, refuses a checkout with uncommitted work, replaces
its whole file on each write and keeps two counts. A script beside it, `scripts/findings.mjs`,
does five things in every mode, on a tree that is not committed yet:

- `snapshot` keeps the tree a reviewer is about to read and returns its id.
- `add` reads a reviewer's report as it was returned. A finding's file and line come from the
  report's own line format and its class from the word the brief asked for, so the session
  types only the disposition. A line it cannot read, or a word that is not on a list, is
  refused there, with the list. A second pass adds to the first and replaces nothing.
- `amend` corrects or withdraws a finding before the pull request is opened, as a newer line
  for the same finding.
- `prove` runs the proof below and writes its result beside the finding.
- `render` prints the fenced block for the pull request's Review section, and `check-body`
  checks a body before it is sent.

The dispositions are the three model routing already counts, `valid`, `overlap` (the other
reviewer found it too) and `noise`, and `declined` for an improvement the author skipped with
its reason. Nothing is carried in a session's memory or typed twice. A pull request with a
Review section has the block, which is one line when there were no findings. `prepare-pr` runs
`check-body` before `gh pr create`, because `ci.yml` starts again whenever a body is edited;
the factory lane runs it on the body it is about to post; and `ci-ok` runs it on pull requests
opened after the rule's date. It refuses a section without a block, or a block that does not
parse, and prints the form. A pull request with no Review section (a release's, Dependabot's)
needs none and is counted as unreviewed in the coverage.

For each `valid` finding the record then holds, without asking anyone:

- **The state the reviewer read.** Review comes before the commit in `prepare-pr`, so that
  state is usually no commit. Before a reviewer starts, `snapshot` writes that tree's objects
  into the repository through a temporary index and records the tree's id: no ref, and no
  change to the index or the working tree, so what `prepare-pr` already compares before and
  after a review is undisturbed. The state can then be rebuilt later in the session, whatever
  has been fixed since, for as long as git keeps unreferenced objects (two weeks by default).
  `pnpm verify` records the same kind of id for what it ran on. A CI run's is the tree it
  tested, which for a pull request is the merge ref: it equals a reviewed tree only when the
  branch already holds the base's tip.
- **What the checks had done on it.** For the files the finding names, the checks that own
  them, each as `passed`, `failed`, `not-run` or `unknown` on exactly that tree. Two things can
  answer. A `pnpm verify` line on the same tree answers for every check it planned. Review
  comes before the full `pnpm verify` in `prepare-pr`, so often there is none; the proof below
  then answers for the check the new test belongs to, because it runs that check's existing
  cases on the reviewed state beside the added ones. What neither covers is `not-run`, which is
  neither a miss nor a gap in the record. `passed` is the miss: a check ran on the defect and
  did not see it. `failed` is the other case, a defect both review and a check saw.
- **The decision.** `check-added`, with the check and its proof; `no-check`, with a reason from
  a short list (`covered` by a named check, `judgment`, `one-off`); `deferred`, with the issue
  it was filed as, which is how the review record's `deferred` count is kept today; or `open`.
  A deferred finding is a known defect that merged. When its issue closes it is an escape found
  by `review`, and the report shows the two as one.

**The proof** is run by the script and not composed by the session. It never touches the
session's working tree, where an agent may be editing or a command may be cut off by a time
limit. It makes a temporary worktree of the reviewed state, installs its dependencies as any
new worktree needs, adds the check, runs the check there as `pnpm verify` would run it for
those files, the build included, so that a stale build cannot pass for the defect, and removes
the worktree. Every removal of a worktree here goes through botcore's `disk-*` commands, and
none of them can take this one today: it sits on a commit no branch holds, which they treat as
work to keep. Phase 2 teaches them to remove a worktree the proof made, and the proof calls
that, also for one left behind by a run that was cut off. The session can go on with its fixes
meanwhile, in any order. The check added is one of two things: the test files as they are now,
or a named command (a lint rule, a gate script) that must exit non-zero on the reviewed state.
That is the rule `maintain-gates` sets for any gate: watch it fail.

- **One run for each check, not for each finding.** All of a review's findings whose tests
  belong to one check are proven in one run, so five findings in one unit cost one build.
- **Only the failure is run.** That the same cases pass after the fix is read from the
  `pnpm verify` line on the final tree, which runs them anyway.
- **Tests that live in a source file** (267 Rust files hold a test module) are added as cases:
  the added cases are applied to the reviewed file by themselves. Where they cannot be applied
  apart from the fix, the result is `could-not-replay` and says why.

The result is `failed-as-expected` (the added cases fail, or the command does),
`passed-without-the-change` (the check does not see the defect), `failed-otherwise` (a setup
error or a missing name, which proves nothing) or `could-not-replay` (the reviewed state's
objects are gone, it does not build, or the cases cannot be told from the fix). The factory
already tells failing test names from a log for Vitest, Playwright, pytest, cargo, CTest,
node's runner and TAP (`botcore_factory/failures.py`). That reader moves into botcore's core,
where the factory, these commands and the proof all call it; core cannot import a plugin. The
proof calls it and does not copy it, so it needs `uv`, as `pnpm verify` does for the Python
suites.

The script writes its result in two places: the worktree's findings record, from which the
block is rendered, and a line in the machine's own record with the tree id, the names of the
cases or the command, and the result. The collector compares them. A proof the block claims and
no machine's record holds is `claimed`, apart from `recorded`. A finding counts as
`check-added` only with a `recorded` `failed-as-expected`; with anything else it is
`check-unproven`. A `covered` reason is proven the same way, by the named check failing on the
reviewed state.

**Settling a finding later.** A finding left `open`, or recorded with the wrong class or
disposition, is settled by a decision file that names the pull request and the finding
([Decisions and what came of them](#decisions-and-what-came-of-them)). The newest statement
wins, and the report gives an open finding's age. A merged pull request's block is kept as the
collector first reads it after the merge; a body edited later is reported as a warning and does
not replace it.

**The report by class** gives each class its findings, the share the checks had `passed`, the
decisions, and the escapes of that class in the window, whether or not a reviewer ever reported
one. The classes that got through most come first: findings the checks had passed, plus
escapes. Asked for one class, its rows are that class by area, and it lists the findings and
escapes themselves with their files, lines and pull request. It can be narrowed to an area, a
check, a decision or one pull request.

That is how the earlier answer is found: before a session adds a test for a finding,
`prepare-pr` has it read the decisions already recorded for the area, with the files and lines
each was about, so a test declined once is not written the next time a reviewer asks for it,
unless there is new evidence. An earlier answer is found however old it is: `days` bounds the
counts, not the decisions. It is also how a place for a new kind of check is found. A class
that keeps getting through in one area, with checks `passed` or with no finding at all, is
where one more example test is not working. Which kind of check to try is a person's or an
agent's proposal, recorded as a `check-added` decision for that class and area. The proof is
run for it too, against the examples it was proposed for: a finding's reviewed state while it
is still kept, and the commit before an escape's fix. The record shows where, whether the new
check fails on those examples, and afterwards whether the class stopped getting through.

The population is merged, reviewed pull requests, and the report says so: a finding on a change
that was abandoned is not in it.

### What changed after a failure

For a check that failed and later passed on the same pull request or branch, the two states are
compared and the difference is recorded as facts:

| Recorded | Meaning |
| --- | --- |
| `source`, `tests`, `new_tests`, `dependencies`, `other` | How many files of each kind differ in the branch's own change. A test is `new` when the branch adds it |
| `base` | `same` or `moved`, by the revision each run tested against |
| `context` | `same` or `differs`: the runner's system and image in CI, the machine locally |
| `tests_failed`, `tests_passed_later` | The named tests that failed, and whether those names pass in the later run, where the runner's output names them |
| `test_changes` | What the test-change report lists between the two states: deleted, skipped, loosened |

Labels are read from the facts and say no more than they do:

- `confirmed-catch`: named tests failed, their files did not change, a source file the check's
  own filters cover did, the base and the context are the same, and the same names pass. It
  needs the failing tests' names, which exist where a log is read: in CI, and for the runs the
  factory lane makes, which reads its log with the same reader and writes the names into the
  run's line. `pnpm verify` by itself keeps no output, so its failures name no test.
- `likely-catch`: source changed and one of the conditions above is unknown.
- `tests-changed`: no source changed and tests did. With `test_changes` it reads
  `tests-weakened`, which is the reviewer's business and never upkeep.
- `repeat-passed`: nothing differs. It is not called a flake.
- `base-moved`: the base differs between the two runs. No other label is given, because a file
  both `main` and the branch edited differs for either reason.
- `mixed`: anything else, with its counts.
- `unresolved` after 14 days with no pass, and `superseded` when the pull request closed or
  merged without one. Neither says why.

A streak of failures is one event with its attempts. The state of a branch is the set of files
that differ from the base its run tested against, each with git's digest of its contents, and
the tree id above names the whole of it. Asked for one check, the report lists its failures,
each with its runs, pull request, label and facts, so one can be read at its source. A failure
with no pass after it is listed too.

Locally, `pnpm verify` appends one line per invocation to a file outside the tree, in botcore's
state folder: the project, branch, base, head, the state and its tree id, and its whole plan,
every step with its result and seconds. It stops at the first failure unless told to keep
going, so the steps after a failure are written as `not-run`, not left out. Passes are recorded
too. `pnpm verify` writes the line itself. A line that cannot be written never fails it; it
prints why.

### A check weighed against review

The owner asked whether the models are good enough that a test is no longer needed. Two things
in the record bear on that without anyone's opinion.

**What review did with the same state.** A catch on a state reviewers had read is compared with
what they reported. Only catches are sorted this way, confirmed or likely; a failure that
passed again unchanged says nothing about review. The state counts as read when it is the
reviewed tree, or a later one that differs from it in no file the check covers, so the defect
was already there to be found. Each such catch is one of:

- `review-reported`: a `valid` finding of that review names a file the correcting change
  touches.
- `review-missed`: none does.

A catch on any other state is `not-reviewed` and says nothing about review. In `prepare-pr` the
full `pnpm verify` comes after review, so its catches are of the first two kinds wherever the
review's fixes did not touch what the check covers, and so are CI's on the pushed head.

The report by check gives the three counts beside the catches, by reviewer model where the
Review section names one. The same row gives the other side from the findings: how many valid
findings the check had run on and passed. So one row holds what a check caught, what it missed,
and what review did with its catches. A check whose catches review keeps reporting is one that
review covers. A check with `review-missed` catches is one that review does not replace.
Neither moves a check: the first is evidence a person may bring to a replay.

**What a check catches as the authors change.** By period ([Two periods and the
models](#two-periods-and-the-models)), the report gives a check's catches per 100 changes that
ran it. A check that stops catching when the authoring models change is where "is this test
still needed" has something to rest on.

What this does not show is whether a reviewer would have reported a defect that a check caught
before any review. Only giving reviewers that state without the failure would, which costs
reviewer allowance for each one and is the owner's to decide ([For the owner to
decide](#for-the-owner-to-decide)).

### Replaying a proposed change

A trigger is narrowed and a suite is moved by a person's proposal, and the proposal is tested
against the history before anyone decides. `gate-outcome-replay` takes a workflow and one of
three things: the path filters it would have (in the syntax the `queue` job reads), the events
a job would run on, or `from_branch`, which reads the proposed triggers from the working tree's
generated workflows and compares them with `origin/main`'s, so what is replayed is what the
pull request changes and nothing is typed. It answers over the window: the runs that would not
have started, their minutes, the failures among them with their labels, and the checks that
would still have run on those changes. For the failures it would have delayed it says how many
another check also failed on the same revision, which is the evidence the owner's rule for
retiring a test asks for. It replays against each run's own changed paths and the job gates of
the workflow as it was then, both kept by the collection, so a replay reads only the record.
The changed paths of a head come from GitHub, one request for each head and counted in the
collection's allowance; a head GitHub no longer has is one that cannot be replayed. It gives
its figures for the runs it could replay, with the number it considered and the number it could
not replay beside them; when more than one run in ten could not be replayed it gives no totals.

Beside the CI figures it gives what the record holds of the same check locally, its runs and
failures in `pnpm verify`, with a warning when the check failed locally and never in CI. A
check that agents satisfy before they push looks quiet in CI, and moving it would move those
catches too. It also names every decision already recorded on the target, and with
`decision_out` it writes the draft of a decision file holding its inputs and figures, so the
evidence is not copied by hand.

So the question is never "which filter never pays". It is "what would this narrowing have
skipped, and what would we have learned later". The change itself is then made where the
filters come from, `scripts/ci/workflow-graph.mjs` and `pnpm ci:sync`, not in a workflow file.

### New tests are seen failing

A test that cannot fail is the plainest test for its own sake, and the door is the cheapest
place to stop it. The proof used for a finding's check is the same for any test a branch adds:
the added test cases (cases, not files: most fixes add cases to a file that exists) are run
against the base's source by the same script, and each is `failed-as-expected`,
`passed-without-the-change`, `failed-otherwise` or `could-not-replay`. The result is a section
of the test-change report (`report-test-changes.mjs`) for the reviewer, who reads
`passed-without-the-change` as it reads a loosened test today: some are right, such as a test
that pins behaviour before a refactor, and each needs its reason. It stays a report and is not
a command.

### Decisions and what came of them

Every change made on this evidence is a file in `scripts/policy/gate-decisions/`, one file for
each decision so that two branches never edit the same line, written in the pull request that
makes the change. An entry has its kind, its target (a check, a workflow's trigger, a class in
an area, one finding of one pull request, or one fix commit), the evidence it rested on (for a
trigger or a tier, the replay's inputs and figures as `gate-outcome-replay` wrote them), what
it is expected to do, the date to look again and, where it replaces an earlier entry, that
entry's id. No entry is written by hand: `scripts/gate-decisions.mjs` writes one from its lists
and checks the folder, and a replay's `decision_out` writes through it.

The kinds are `check-added` (a check for a class in an area, beyond one finding's test),
`finding` (settles or corrects one finding), `found-by` (corrects a fix commit's line),
`trigger-narrowed`, `moved-to-daily`, `kept`, `restored` (undoes a move or a narrowing) and, if
the owner allows it, `retired`. `kept` is a decision too: it records that a check was examined
and left alone, with the reason, so the evidence is not walked again until it changes. "Daily"
is the workflow's own schedule, which the entry names.

The report by decision gives each one what came after: for a check added, findings and escapes
of that class in that area; for a trigger or a tier, the runs and minutes saved against the
replay's figure, and every failure of the moved check wherever it still runs. A decision is:

- `holding` until something says otherwise, and `kept` for that kind.
- `contradicted` when the moved check fails in a scheduled run and does not pass on another
  attempt at the same commit. It is not asked to be a catch: a scheduled run tests `main`'s
  moving tip, so the pass that follows always has a moved base. It is read from the runs
  collected, not from the scheduled-failure tracker, which watches ten of the workflows and
  keeps one issue for each.
- `superseded` when a later entry replaces it, as a `restored` entry does the move it undoes.

Whatever its state, a decision is marked `due` once its date to look again has passed. A triage
pass (`triage-issues`) reads the contradicted and the due ones and files an issue under the
epic for each that has none, so it is picked up as work. A replay names the entries already on
its target, so a check that was `kept` is not walked again without new evidence.

Restoring a check is an ordinary pull request with its `restored` entry. Nothing restores one
by itself, and no check fails on unrelated pull requests because a decision has aged.

**A change to the checks cannot land unrecorded.** The folder's check runs in `pnpm check` and
reads the workflow files themselves, not only the parts that are generated: their events, their
path filters, and the conditions on the event that jobs and steps carry, which is how a job is
kept to the daily run today. Against the base, a pull request fails when it:

- removes an event, narrows a path filter or adds such a condition, with no entry for it;
- has an entry of a narrowing kind that does not say who approved it, when and how;
- moves a job to a schedule its workflow does not have (Specimen and Loam plugins, among
  others, have none today; a replay of such a move says so);
- renames or removes a check that an entry names, without the entry saying what it is now
  called or being replaced.

The report lists changes of these kinds already on `main` that have no entry.

**Who approves.** A pull request that narrows a trigger, moves a suite or retires a test is not
the session's to enqueue. Phase 4 adds that case to `prepare-pr`'s step 9, which today leaves a
pull request open for the owner for publishing, a held UI change and a change to the factory's
measures: the pull request stays open with the replay's output in its body. A factory cell
never reaches step 9. The lane today holds only the factory's own improvement branches when
they change a gate; phase 4 widens that hold to any branch that adds an entry of a narrowing
kind, released by the owner as that one is (`measure-approve`). The owner's answer may come by
direct message or, for a trigger or a tier, through Focus as `AGENTS.md` allows; taking a job
out of what the merge queue waits for is a merge-queue switch and needs his direct message.
Sessions act under the owner's account, so no label or review can prove who approved. The
entry's approval is the session's statement, in the diff the reviewers read. An entry of any
other kind is the session's own, like the test it comes with.

**What exists today.** Checks run on pull requests and queue groups, daily, on pushes to `main`
and by hand, and a few jobs are registered as pull-request-only
(`scripts/merge-group-contract.mjs`). "Moved to daily" means off the pull-request and queue
events and on the schedule. The collection covers all five events and says which a figure is
from.

### Two periods and the models

The owner's question about models is answered first by comparing periods, which needs no claim
about who wrote what: `gate-outcome-report` takes a second window and gives every figure for
both, with the mix of work in each (changes by unit and by commit type) so a quieter week is
not read as a better model. By check, that is its runs, failures, catches and review counts in
each window.

Attribution is added where it holds. A change is `authored by` a model only when the
skill-usage record ties its pull request to exactly one session that was not a reviewer or a
session that only repaired and merged it; otherwise it is `mixed` or `unknown`. Reviewer models
come from the Review section. Totals count a change once, and every figure by model gives the
share of changes it could attribute.

### Measures

There is no measures command here. An earlier draft had one, and two walks found that no job
needed it: a Health measures file is read by the dashboard's trend, which needs dated reports
kept over time, and that is step 8 of #1387 and is not built. The comparison of two periods
answers the owner's question meanwhile. When the dated history exists, a producer writes these
figures as a measures file, as #1387's other producers do, with the report's sample rules: a
value that rests on too few observations is left out, and every direction is `neutral`. That is
a line in #1387's plan, not a command of this feature.

### The record and the commands

Events are lines of a file in botcore's state folder, appended and never rewritten, each with
an id and the version of the rules that made it. A fact learned late (a pass that arrives after
a report, a rebuilt collection) is appended as a newer line for the same id, and a reader keeps
one line for each id, so an event is never counted twice: the one made by the newer rules, then
the one that holds what the other could not read (a line that could not read an attempt's
steps or a summary never displaces one that did), then for a run the one GitHub updated last,
then the one written later, and last the machine whose name sorts later. Machines share
records through the folder skill usage already uses, by the same rules.

**Size.** A week is about 17,000 workflow runs. A run that passed is one line holding the
seconds of its jobs, steps and group commands; their names are kept once for each version of
the workflow. A run that did not pass also keeps each step's conclusion. Lines older than 180
days are folded into one line for each check and day. Findings, escapes, pairs, proofs and
decisions are small and are kept whole. A `rebuild` keeps a fact whose source no longer
answers, such as a log GitHub has expired, and marks it as no longer readable.

**Collecting.** A report never needs a collection first, except the first on a machine. The
hourly job botcore installs (`disk-setup`), whose last step collects skill usage, gains a step
for this collection, and every answer says how old each source is. The machine's botcore
settings name the repository and the checkout the collection reads; it fetches the default
branch itself. The job runs the botcore that is installed, so a machine starts collecting when
it has the release that carries these commands, and cutting that release is the maintainer's.

A collection first reads what the shared folder holds and asks GitHub only for the rest: the
lists of runs, then the jobs and steps of runs that did not pass, with the log of a job whose
group step failed, then of the others, newest first, then the logs of jobs whose group step
passed, then the changed paths of each head. GitHub's hourly allowance belongs to the account,
so every machine and every session draws on the same one. A collection stops at its own limit
(`requests`, 1,000 unless given) or when the account's remaining allowance falls to half,
whichever comes first. The source is then `partly` read with how far it got, and the next
collection goes on from there. A source is `read` while runs in its window are still going:
those runs are in no count, are named in the report's warnings, and are counted when a later
collection sees them end. A first collection of sixty days therefore takes several days,
and until it ends the coverage says what share of runs have their steps.

**Surface.** The commands are botcore's, beside `skill-usage-*`, and are served as those are:
by the command line and the local server. Each command's help names its inputs and their lists,
every refusal's suggestion names the next call, and a docs topic of their own names every
field. The command line cannot print a docs topic today, although a skill already tells agents
to ask it for one; phase 1 adds that. The commands are not admitted to a managed host's catalog
here, for the reason skill usage gave: an entry needs a reviewed policy. So that admission
later is a declaration and not a redesign, a read stays a read. `gate-outcome-report` only
inspects. `gate-outcome-replay` inspects, runs git for `from_branch` and writes one file for
`decision_out`. `gate-outcome-collect` runs `gh` and git and writes the record.

| Command | Input | Result | Refuses with |
| --- | --- | --- | --- |
| `gate-outcome-collect` | `since_days`, `sources` (`ci`, `main`, `reviews`, `runs`), `requests`, `rebuild` | `machine`, per source `status` (`read`, `partly`, `absent`) with `why`, `found`, `added` and, when `partly`, `reached`; `pairs`, `unresolved`, `superseded`, `requests_used` | `VALIDATION_ERROR`, `NO_WORKSPACE`, `SOURCE_UNREADABLE`, `SERVICE_UNAVAILABLE`, `RECORD_UNAVAILABLE`, `CONFLICT` |
| `gate-outcome-report` | `days`, `ending_days_ago`, `compare_ending_days_ago`, `by` (`workflow`, `check`, `area`, `class`, `decision`), the filters `where`, `workflow`, `check`, `area`, `finding_class`, `decision`, `pull_request`, `due`, then `sort` and `limit` | `window`, `totals`, `rows`, `examples` when a filter narrows the answer, `not_observed`, `undecided`, `coverage`, `machines`, `warnings`, `more`; with a second window, `compare` | `VALIDATION_ERROR`, `INVALID_INPUT`, `NOT_COLLECTED`, `NO_WORKSPACE`, `RECORD_UNAVAILABLE` |
| `gate-outcome-replay` | `days`, `workflow`, `job`, one of `paths`, `events` or `from_branch`, and `decision_out` | `proposed`, `runs_considered`, `runs_skipped`, `minutes`, `failures` with labels and how many another check also failed, `still_ran`, `not_replayed`, `local`, `decisions`, `warnings`; with `decision_out`, `written` | `VALIDATION_ERROR`, `INVALID_INPUT`, `NOT_COLLECTED`, `NO_WORKSPACE`, `RECORD_UNAVAILABLE` |

**Bounds.** `limit` is 25 unless given and at most 200. It applies to each list of an answer by
itself, and `more` says how many each list left out. Rows come in a stated order: for checks
and workflows `sort` is `minutes` (the default), `failed` or `runs`, largest first; areas come
by fix commits, classes by what got through, decisions newest first. `days` is 1 to 365. The
local server cuts an answer at 100,000 characters and an agent's harness sets aside a long one,
and both surfaces print indented JSON today. So a test measures the widest answer at the
default and at the largest limit on a real week's record, as each surface prints it, and the
limits are lowered if either is over.

**Refusals** follow the contract's two codes. A value outside a fixed list (`by`, `where`,
`sources`, `sort`, `finding_class`, `decision`) or outside a range is `VALIDATION_ERROR`, and
the command gives the list. What a schema cannot describe is `INVALID_INPUT`: a check, area or
workflow that is not known, refused with the closest names and the number known, since listing
hundreds of checks would not help; a filter that does not go with `by`, refused with those that
do; a path filter the queue job could not read; two proposals in one replay. A `by` value or a
filter that no piece has built yet is refused with what is built. `where` is one of the five
events or `local`. The filters are `where` and `workflow` with `workflow`; `where`, `workflow`
and `check` with `check`; `area` with `area`; `finding_class`, `area`, `check`, `decision` and
`pull_request` with `class`; `check`, `area` and `due` with `decision`. A managed host would
refuse a listed value itself, before the command, with the same code and a less specific
suggestion; making it name the values is the host's change.

**What is known and what was observed.** The checks known come from the workflows and the hook
groups at the default branch's tip, read through git, not from whatever branch the caller is
on. The generated local suites join them in phase 2, when the generator names the job and
step each local step came from. What was observed comes from the record. So a check can be
listed as not observed before anything about CI has been collected.

GitHub is read through `gh`. Without it, a collection reads what it can: `ci` and `reviews` are
`absent` and `main` is `partly` read, each with the reason. One that asks for only `ci` or
`reviews` is refused with `SERVICE_UNAVAILABLE`, and one started while another runs with
`CONFLICT`: the contract's own codes, where one fits. By workflow, the report gives wall hours
as [The problem](#the-problem) measures them and, for the queue, the groups and how many had a
failure.

**A verdict workflow** judges the others (`ci-ok.yml` fails when any workflow did), so counted
like the rest it counts one failure twice. Nothing in a run says that a workflow is one, so a
repository names its verdict workflows in botcore's configuration (`botcore.toml`), and
nothing is guessed. A named one keeps its own row, marked; the totals and the queue's groups
with a failure leave it out and say which workflows they left out. With none named, every
workflow is counted alike.

**Coverage** is part of every answer: which sources and events the figures rest on and how old
each is, the runs of other events, the share of runs with their steps, the share of group
steps whose summary was read, the share of failures with named tests, the share of proofs
that are `recorded`, the pull requests with no Review section, the share of changes
attributed, and what is known not to be seen.

## Guardrails

- **Policy is in the repository, data is not.** The label rules, the findings script with its
  proof and body check, and the decisions script are gate scripts and change by the
  `maintain-gates` rules. Each new refusal applies from the date its rule lands, to pull
  requests opened and commits made after it, so no branch in flight is caught by it. Of the
  decision kinds, only `trigger-narrowed`, `moved-to-daily` and `retired` wait for the owner.
  The record on a machine cannot be protected by a path and is treated as data: a figure says
  which machines it is from.
- **Counts come with their denominators,** and no rate is given on fewer than 20 runs or 10
  findings. The row says `too-few` and gives the count. The same rule applies to a replay.
- **A source that was not read is named,** and a window a source does not cover, or covers in
  part, is reported as that, never as zero.
- **Nothing here moves or removes a check.** A person proposes, the replay answers, the owner
  approves, and the report shows what followed.
- **A quiet history is not a case for moving a check** whose failures agents fix before they
  push, or whose one failure would cost more than its runs. The replay shows the first. The
  second is the owner's judgment, which is why he approves each move.

## Limits

- **A pull-request run's base is known only while its pull request is open.** GitHub drops a
  pull-request run's link to its pull request once the pull request closes, so a run's base
  is known for queue runs, from the group's branch, and for pull-request runs collected while
  the pull request was open.
- **A group's commands are those at the default branch's tip.** Where a group step passed
  and its summary was not read, each command the group has now is counted as passed with it,
  one added since included; a summary that was read says what ran.
- **Work before `pnpm verify` is not seen.** An agent that runs one package's tests, fixes what
  fails and only then runs `pnpm verify` leaves nothing in the record. Local figures are a
  floor, and a quiet check is reported with that said.
- **A catch is confirmed only where a log names the failing tests:** in CI while the log can
  still be read, and in the factory lane's runs. Any other local pair is `likely-catch` at
  best.
- **A break made and mended between two daily runs** is seen by neither.
- **A reviewer's class is a judgment** from a fixed list, checked for form and not for truth. A
  `recorded` proof was run on the session's machine and cannot be run again elsewhere. A check
  proposed for a class is a hypothesis until it is shown failing.
- **A reviewer's miss is seen only where a check failed on a state it had read,** or when it
  comes back as an escape. `review-reported` rests on a file that both a finding and the
  correction name, which can agree by chance in a large file.
- **A proof costs a build.** Each check a review's findings add tests to is built and run once
  more, in a worktree of its own. A session on a machine outside the shared folder, such as a
  cloud session, can leave only `claimed` proofs.
- **An approval is a statement.** Sessions act under the owner's account, so the record cannot
  show that he approved, only that an entry says so.
- **An escape's class and channel are the fixing session's account,** as a finding's are.

## Phases

1. **What ran and what merged.** Runs, jobs and steps from GitHub, collected by a step of the
   hourly job within the account's allowance; the failing command of a group step; the record's
   size and its folding; the inventory of fix commits and the escapes they close; a docs topic
   the command line can print. No change to any check. One step is the owner's: the botcore
   release that carries the commands, installed on each machine.
2. **Findings to checks.** The class in the reviewer's brief; `scripts/findings.mjs` with its
   snapshot, findings, proof, block and body check; its place in `prepare-pr` (the snapshot
   before review, the earlier decisions read before a test is added, the body checked before
   the pull request is opened) and in the lane, which checks the body it posts; the disk
   commands removing the proof's worktree; `pnpm verify` recording its plan, its results and
   the hook group's summary; the `Found-by:` line in the fold and `ci-ok`; decision files for a
   finding, a fix commit's line and a check added for a class, with the report by decision for
   those; the report by class.
3. **What changed after a failure, and what review did.** Pairs and their facts for local and
   CI failures; the failing-test reader in botcore's core, used for CI and for the lane's runs;
   `review-reported` and `review-missed`; a check's misses beside its catches; every machine.
4. **Replay and decisions.** `gate-outcome-replay`; the decision kinds for triggers and tiers
   and the check that a narrowing has its entry; the owner's case in `prepare-pr`'s step 9 and
   the lane's hold; `triage-issues` reading what is contradicted and what is due.
5. **Two periods and the models.** The second window, the mix of work, attribution and its
   coverage.
6. **Every added test.** The proof of phase 2 for the test cases any branch adds, as a section
   of the test-change report.

Not planned here, and named so that they are not assumed: a mutation-testing pilot, which waits
for the record to show a gap it would close; a record of which single test failed across all
runs; a measures file, which waits for #1387's dated history; and giving reviewers a state a
check failed on to see whether they report the defect, which is the owner's to decide.

## Exit criteria

Every scenario tagged `slice` passes for phase 1, and each other after its phase. Also:

- **Phase 1.** For the week of 17 to 23 Nov, the report by workflow gives the nine table rows
  and the queue's groups above from a clean collection (runs and failures exactly, wall hours
  within 1%), and counts each way a run ended apart. A collection held to 200 requests ends
  `partly`, and the next one goes on without reading a run twice. A failed `Quality gate` step
  has its failing command named. The size of that week's record and of the widest answers is
  measured and written in the status file. The hourly job has collected on one machine for a
  week without a session asking.
- **Phase 2.** The `valid` findings in pull requests merged after the block lands are walked to
  the end in order, at least ten of them and until one is `check-added` with a `recorded`
  `failed-as-expected` and one is `no-check` with its reason. Each has the tree id of its
  reviewed state, what the checks had done, a disposition and a decision. The body's check is
  seen refusing a Review section with no block and a block that does not parse, and a proof
  typed into a block is reported `claimed`. On a planted branch with two findings whose fixes
  are made before their tests are written, both proofs are `failed-as-expected`, one of them
  for a test inside a Rust source file, and the session's working tree is not touched. The fold
  refuses a `fix` subject without its `Found-by:` line.
- **Phase 3.** Every fifth pair in the record, the mixed and unresolved ones included, is read
  by someone who does not see its labels and decides from the logs and the pull request what
  happened and whether a reviewer had reported it. The agreement is reported per label. A label
  that disagrees in more than one case in ten is narrowed or removed before the phase closes.
- **Phase 4.** One real proposal is replayed and decided. "Kept as it is" is an accepted
  result. Three planted pull requests fail the folder's check: one that narrows a path filter
  with no entry, one that keeps a job to the schedule by a condition with no entry, and one
  that renames a check an entry names. A planted cell branch with a narrowing entry is held by
  the lane. Separately, on a planted decision and a planted scheduled failure that fails again
  on a second attempt, the report marks the decision contradicted, a triage pass files its
  issue, and the restoring pull request passes with its `restored` entry.
- **Phase 5.** One comparison across a date on which model routing changed, by class and by
  check, with the models of each window and the share of changes attributed stated beside every
  figure by model.
- **Phase 6.** For twenty merged changes that add test cases, the section names each added case
  and its result, and a planted test that asserts nothing is reported as
  `passed-without-the-change`.
- The record of a real machine holds no command output or file contents (checked by search).

## For the owner to decide

1. **The jobs:** cut, add and rank them. Recommended: all twelve, in the order of the phases.
   On 2026-11-24 the owner told the session to go on with the recommended tasks and changed
   nothing in the list, so the jobs are built in that order. He can still cut or reorder the
   later ones.
2. **Retiring a test.** The request raises removing a test that is no longer needed, and this
   plan stops at moving one to daily. Recommended: allow removal as the owner's decision, on
   one of two proofs. Either every confirmed catch of the test in the record was also failed by
   another check on the same revision, which the replay counts, or the test is shown unable to
   fail. Review reporting everything a check caught supports moving it to daily, where a
   failure still shows, and not removing it.
3. **Who approves a narrower trigger or a move to daily.** Recommended: the owner, each time,
   on the replay's output.
4. **What every session does that it does not do today.** It records each finding through a
   script, runs the proof for a check it adds, which costs one more build of that check, and
   ends the commit that lands a fix with a `Found-by:` line, which the fold refuses to go
   without. Recommended: accept all three.
5. **Whether the report may point.** It lists checks with the costliest first and marks the
   quiet ones, with what it could not see. It never says which to move. Recommended: keep it to
   that. The first draft's rule for nominating checks would have named a gate that agents
   satisfy before they push.
6. **Whether to give reviewers a failing state to test them.** For a catch no reviewer had the
   chance to report, the only evidence that review would have stopped it is to hand reviewers
   that state without the failure and see what they say, which spends reviewer allowance on
   each one. Recommended: not yet. Phase 3 shows what share of catches fall on a state review
   had read; if that share is too small to weigh a check, plan it then.

Not asked here: step 10 of #1387 (coverage ratchets and the defect sweep) stays as planned. An
earlier draft recommended replacing the ratchets; nothing measured yet shows what they cost.

## The review

GPT-6.2 Astra at high effort reviewed the first draft on 2026-11-24 and reproduced its workflow
table. Its verdict was to revise, with twelve blockers. What changed, the main ones first:

- **Causes read from file changes.** The first draft labelled a failure by which files changed
  and ranked suites by the labels. The record now keeps facts, and a catch needs a named test
  that stood unchanged.
- **Findings were not joined to the checks that had run.** They now carry the reviewed state
  and what the checks had done on it, and each ends in a decision with its proof.
- **Fix commits were counted as bugs,** and a bug's age was read from blame with a 30-day rule
  for platform changes. Escapes are now counted per closed issue, the age is called the age of
  the last edit, and the rule is gone.
- **Workflow, job, step and command were used as one thing.** A check now has all four, and
  runs are counted by how they ended.
- **A failure was paired with the next pass regardless of what was tested.** Pairs now carry
  the tested base and context, and a moved base is reported apart.
- **The owner's hold and the automatic restore did not exist as described,** and the candidate
  rule (200 runs, no catch, above-median cost) could nominate a check that guards a rare
  failure. Both are gone: the plan proposes nothing, replays a person's proposal, and names
  `prepare-pr` as the approval path.
- **Models were taken from sessions linked to a pull request.** Periods are compared first, and
  attribution is given only where one authoring session is known.
- **Trigger figures were the runs a filter caused,** not what a narrowing would save. Replay
  replaces them.
- **The measures example broke the plan's own sample rule** and marked a gameable number as
  better when higher. Sample rules now apply to the file and every direction is neutral.
- **The exits could be met by the wrong build.** Each now names an observable result, and two
  of them accept "no change".

- **The report on new tests looked only at new files.** Of 118 fix commits that touch a test
  path, 88 add no test file. It now reads added test cases and tells an expected failure from a
  broken setup.

Declined: nothing. Deferred, as the reviewer suggested: the mutation pilot and any change to
#1387's coverage plan.

A second pass (Claude Opus 5.5 at high effort) checked the revision against those findings and
found five more things, all taken: the state a reviewer reads is usually not a commit, so it is
now named by a tree id and its proof is run on the session's machine; `pnpm verify` records its
runs in phase 2, where the findings need them; a local failure names no test, so only a CI pair
can be a confirmed catch; a confirmed catch also needs the same context and a source change the
check covers; and only three kinds of decision wait for the owner, not every entry.

The walk of the jobs came after both passes and is under [Jobs](#jobs). Where it changed a
point above (the proof no longer depends on the order of a session's work, the lane's runs name
their failing tests, and the measures command is cut), the design has the current rule.

## Not yet known

- How many failures have named tests in a log that can still be read.
- How many findings a week the Review sections hold, and how many name the files they concern.
- Whether a workflow's past versions can be read reliably enough for replay to rebuild its job
  gates.
- Whether Lefthook's closing summary can be read reliably enough to split a group step, in a CI
  log and locally.
- How many requests a day the collection needs once it has caught up, and how large a week's
  record is.
- What a proof costs in the heavy units, and so how many minutes a pull request with findings
  gains.
- How often a `pnpm verify` line exists for a reviewed tree, and so how often the checks' state
  on a finding is known beyond the check its test was added to.
- What share of catches fall on a state reviewers had read.
- What share of changes one authoring session can be named for.