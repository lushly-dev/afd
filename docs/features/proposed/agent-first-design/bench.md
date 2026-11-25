# Agent-First Design: the bench

The specification of the bench for phase 0 of the
[proposal](agent-first-design.proposal.md#phase-0-prove-it). It is step 0.0, which asks the
owner to approve the domain and the budget before any session runs. Read
[STATUS.md](STATUS.md) first.

## Status

- **State:** drafted 2026-11-14 against `fd0781e4`. The application is built (#1239), the held
  material is written and frozen, the runner is written, its reports and statistics included
  ([STATUS.md](STATUS.md#the-runner)), and the reference build is written,
  reviewed and approved by the owner, and a copy of it holds the faults
  ([STATUS.md](STATUS.md#the-reference-build)). The pilots, step 0.1's first fifteen builds and steps 0.3
  and 0.4 have run ([STATUS.md](STATUS.md#steps-03-and-04)).
- **Decided by the owner on 2026-11-15** ([For the owner](#for-the-owner)): the domain, the
  model, the bare arm, and the budget. The sessions run on a second machine of the owner's,
  draw on its subscription allowance and not on API billing, and take no more than a fifth
  of a week's allowance in any one week. Later the same day, with the runner: a session's
  tree is a plain export and not a worktree, and no arm reads the neighbouring proposals
  ([What a session is given](#what-a-session-is-given), [Runs](#runs)).
- **Confirmed by the owner on 2026-11-21:** the [rules for "go"](#rules-for-go) and how step
  0.4 reads a path, as proposed, with step 0.3's "a persona of that modality" read as one
  persona alone.
- **Decided by the owner on 2026-11-24,** after step 0.1's first fifteen builds: step 0.1
  ends there; the weekly figure is not measured again for now; steps 0.2 and 0.5 are deferred;
  and step 0.3's check of matches and findings is made by an independent reviewer of another
  model family in place of the owner ([STATUS.md](STATUS.md#step-01),
  [STATUS.md](STATUS.md#steps-03-and-04)).
- **Not approved:** the rest of this file. The owner was asked three questions, which cover the points above, and later ruled on the
  runner's points named there; nothing else here is the owner's.
- **Measured:** the cost and size of a page-building session, from the [Component Briefs
  prototype](../../complete/component-briefs/prototype.md). Everything else in [Budget](#budget)
  is an assumption, marked as one. Two pilot builds and two pilot walks measured a build and a
  walk on 2026-11-20, and a reader of the bare pilot build measured a reader
  ([STATUS.md](STATUS.md#the-pilots)). The Budget's lines stand as written, as first estimated.
  Step 0.1's first fifteen builds were to give the share of the allowance and did not: the
  figure was not read when they ended ([STATUS.md](STATUS.md#step-01)). The share is unknown.
- **Deliberately not in this file:** the planted faults, the checks, the persona cards, the
  walk scripts and the two jobs held back for the panel loop. A session that could read them
  would be scored on what it had read. They were written on 2026-11-15 and are kept in a
  folder of their own on the second machine's external drive, outside every checkout, as the
  owner decided. They are committed after the last run as the record, as Component Briefs did
  with its tasks and checks. This file gives their shape and their counts.
- **They are frozen in two stages.** The checks and the held-back jobs were frozen on
  2026-11-15, before any build. The faults, the persona cards and the walk scripts were frozen
  on 2026-11-18, before any walk, the pilots' included: a fault names elements of the reference
  build, so they waited for it and for the owner's look. Each fault was planted in a copy of the
  build and its proof run on both builds before the freeze. What the pilot walks show is
  recorded in a file of its own beside the frozen ones. It may change the runner, the walk's
  cap or the budget's figures; the frozen files stay as they were. Each stage has a manifest of SHA-256 hashes, and the hash of each
  manifest is in [STATUS.md](STATUS.md), so the record committed later can be checked against
  what the runs used.

## What it has to do

From the proposal's sections [5.2](agent-first-design.proposal.md#52-the-default-pattern-set),
[5.5](agent-first-design.proposal.md#55-review) and
[5.9](agent-first-design.proposal.md#59-the-bench):

- **Need every result-state pattern,** so each default has a screen that tests it.
- **State needs, not components.** Choosing components, layout and copy is what is judged.
- **Give a panel something to walk:** a running application with a journal, in a clean build
  and a build with planted faults.
- **Be unfamiliar.** The owner ruled out the todo example, and an invented domain keeps a
  private source's data out of a public repository.

## Domain

**A seed library,** chosen by the owner on 2026-11-15. A neighbourhood group lends packets of
vegetable and flower seed. Members borrow packets and return saved seed at the end of the
season. Volunteers take in donated packets, and a steward approves loans of rare varieties.

| Domain | For | Against |
| --- | --- | --- |
| A seed library, chosen | Every result state arises from the subject: seed runs out, ages, is rare, arrives in mixed batches with handwritten labels. A judge needs no expertise | None found |
| A tool library for a workshop | As easy to judge | It is a booking system. A model may have a stock layout for one, which would lift every arm and narrow the differences. A hypothesis, not a finding |
| A freezer inventory for laboratory samples | Unfamiliar to a model | Unfamiliar to the judge too. Telling a good screen from a bad one would take domain knowledge |

## The application

Four screens. Three are shown to whoever writes the first pattern statements. The fourth is
built only in step 0.2 and after, so it shows whether statements written from the faults on
three screens help on a screen they were not written from.

| Task | Screen | The user must be able to |
| --- | --- | --- |
| T1 | Lend a packet | Find a variety, lend a packet to a member, take a substitute or join the waiting list when it is out, ask the steward for a rare one, take the loan back |
| T2 | Take in a donation | Import a batch of packets, follow it, settle a label that matches several varieties, see why a match was made, deal with the rows that failed |
| T3 | A variety's page | See its lots and loans, record a return and take it back, see how well old seed is expected to germinate and on what evidence, retire the variety |
| T4, held back | The steward's requests | Approve or decline a request, approve several at once and deal with the ones that failed, take a decision back, remove a past season's closed requests |

Which task needs which pattern:

| Pattern (proposal, 5.2) | T1 | T2 | T3 | T4 |
| --- | --- | --- | --- | --- |
| An error with its recovery | Yes | Yes | Yes | Yes |
| An undo offer | Yes | Yes | Yes | Yes |
| A confirmation before a destructive command | | | Yes | Yes |
| An approval request | Yes | | | |
| Progress | | Yes | | Yes |
| A choice among alternatives | Yes | Yes | | |
| Warnings | Yes | Yes | Yes | Yes |
| Evidence for a result | | Yes | Yes | |
| A batch with some failures | | Yes | | Yes |
| An empty collection, a failed collection | Yes | | Yes | Yes |

- **A limit.** Alternatives, evidence and the approval request are not on T4, so a statement
  about them is tested only on a screen it may have been written from. The steward's screen
  shows held loans from the approver's side, which no default pattern covers.
- **What produces each pattern** is in
  [the seed library's jobs](bench/seed-library.md#where-each-pattern-arises). Writing the
  jobs put warnings on T2 and T4, an error with its recovery on T3 and an undo offer on T2,
  and took the approval request off T4. The first version of this table differed in those
  five cells.
- **The commands are the data contract.** Seventeen jobs and twenty-four drafted commands are
  in [the seed library's jobs](bench/seed-library.md), each job a scenario file written
  against the commands, in the order the `afd` skill's
  [guide](../../../../.claude/skills/afd/references/jobs-first.md) sets. Three readers
  walked them. The application is built, with their schemas.
- **A fixture of each result forces each state** of a screen. Each screen's task, its states
  and their results are drafted in [`bench/tasks/`](bench/tasks/README.md), 50 states and 74
  results across the four screens. A task lists the screen's states, so it is held material
  for the bare arm.
- **Where it lives:** [`packages/examples/seed-library`](../../../../packages/examples/seed-library/README.md),
  with the commands, their schemas, the in-memory store, and the scenario files and fixtures,
  which its tests run. It is kept after phase 0.

## What a session is given

- **Every session writes one story file** with a named story per state, from
  `violet-elements` where a component fits. What it reads to do so depends on its arm, and
  nothing it reads names a pattern or says which state shows one.
- **Arms 0 to 3 read four things,** the same for each arm on a screen:
  - the screen's task, from [`bench/tasks/`](bench/tasks/README.md): its jobs, commands,
    states with the results each story mounts and what the person must be able to do, and
    what counts as done;
  - the screen's results, its folder of [`bench/results/`](bench/results/);
  - the scenario files of the screen's jobs, with the fixtures they name;
  - **the builder's extract** of [the seed library's jobs](bench/seed-library.md): its
    sections "The library", "Outside the four screens", "Jobs", "Drafted commands" with its
    notes, "States", "What the application asks of the host" and "Who calls, and through
    what". The extract leaves out the opening paragraph and its pointer to this file, the
    "Jobs" section's lines about the bench around its table, and every other section: "Where
    each pattern arises", "What writing the jobs changed", "What the walks changed", "What a
    scenario could not express", "Checks", "Not done" and "For the owner".
- **No arm reads the neighbouring proposals.** Patterns, Design Decisions, Screens from Jobs,
  Pointing, Scales and Component Briefs discuss result states and design review, and Patterns
  is near what arm 2 adds. The owner decided on 2026-11-15 that the runner removes them from
  every arm's tree, so that arm 0 has nothing beyond the brief.
- **The bare arm reads two things** ([ruling 3](#for-the-owner)): the job sentences of its
  screen, as the rows of the "Jobs" table and not the scenario files, whose steps and header
  comments name most states; and the same extract without "States". It gets no task, no
  results and no list of states.
- **The runner makes the extract** from the seed library's file at the pinned commit and
  writes it at the same path, so the tasks' links to its sections resolve. It builds each
  session's tree with the files its arm reads and none of the rest of this feature's
  folder: not this file, not the proposal, not another screen's task or results. A session's
  tool calls are checked for a read of anything held back.
- **A known limit of the bare arm:** the commands table and its notes still say what a
  command returns and refuses, such as the error codes in "Refuses with" and that
  `donation-import` succeeds when some rows fail, so a session can infer some states from
  them.
- **Every arm has the components brief.** It is merged and is how a session works in this
  repository today, so "nothing" for arm 0 means nothing beyond it. Arms then differ only in
  what is added.
- **Arm 1's public skill** is Anthropic's frontend-design, one of the six public skills the
  proposal compared ([5.8](agent-first-design.proposal.md#58-the-skill)), chosen because it
  installs as a Claude Code plugin. A session has no Skill tool, so that no skill built into
  Claude Code reaches any arm, and arm 1 is given the plugin's `SKILL.md`, at a recorded version
  and hash, as a file to read and follow.
- **Arm 2's patterns do not exist yet.** Patterns is a proposal. Umbel's components plugin
  serves them: a consumer profile's statements go once into every brief for that consumer, and
  are never shed when a brief is cut to size (#1394). They are written after step 0.1, from the faults the owner
  names on T1 to T3 and from no other source, and the owner approves them before step 0.2.
- **Arm 3's skill** is a draft written for the run and deleted if step 0.5 says so.
- **A reference build** of the whole application, running on the commands with a journal, is
  made once, outside the arms, and the owner looks at it before faults are planted in a copy.
  Steps 0.3 and 0.4 walk those two builds.

## Scoring

Reported check by check, with what was measured, excluded and unmeasured. No single score
ranks the arms. Step 0.2's rule needs one number for a run, the share of its screen's checks
that the run passed, and that number is used for that rule and for step 0.5's and nowhere
else.

- **Checks on a build,** frozen before the first run and independent of any statement, so that
  arm 2 is not scored on rules written from arm 0's faults:
  - each state's story mounts with no console error;
  - each contract field the state carries reaches the screen, by role, name or text;
  - what the user must be able to do is an operable control with a name;
  - focus is where the state needs it;
  - Specimen's accessibility check.
- **Judgement:** the owner's blind choice between two builds of the same task.
- **Walks:** which planted faults a persona reported, what else it reported, and the path the
  journal recorded against the scenario's steps.
- **Statistics,** for step 0.2: each run's share of its screen's checks passed, the
  difference between the two arms' means, and a two-sided permutation test that shuffles the
  arm labels within each screen, because the screens have different checks.
- **What fifteen runs can show is not known.** Component Briefs ran a permutation test on
  median tokens, and with fifteen runs an arm, a saving of 22.5 % reached only p = 0.17.
  Nothing yet says how much runs of one arm differ on these checks. Step 0.1 shows that
  spread, and with it whether fifteen runs can resolve the difference step 0.2 asks for.

## Faults, personas and held-back jobs

- **Twelve planted faults** in the seeded build, three aimed at each modality. Each is one
  small change with a check that proves it is present.
- **Five persona cards,** the panel size the owner agreed. One for each modality in the
  proposal's table and a second sighted persona with a different stance, so that overlap
  between two reviewers of one modality is measured.
- **The runner enforces the modality** by the tools it exposes, through an MCP server of its own
  on Playwright; Botcore's `cdp_*` commands, first named here, keep no window size between calls
  and cannot click without naming an element. The screen-reader persona reads the accessibility
  tree with a reading cursor and hears what it says after each key press. Live announcements are
  heard by watching live regions change, in the page and inside components' shadow roots, which
  is an approximation of how a screen reader speaks them.
- **One model family in phase 0,** by choice. The five personas are Claude sessions, so that
  how many faults a panel finds is measured without a second thing varying. The overlap it
  reports is therefore within one family, and the proposal's point about reviewers of
  different families waits for phase C.
- **A walk script for each screen:** the job walked there, put as the person would meet it,
  and its starting state, without its steps. Four in all.
- **Two jobs held back for the panel loop** are written now and first used in phase C.

## Runs

| Step | Sessions | Count |
| --- | --- | --- |
| 0.1 | Builds: arms 0 and 1, T1 to T3, five runs each | 30 |
| 0.1 | Builds: a bare arm, T1 to T3, five runs each ([ruling 3](#for-the-owner)) | 15 |
| 0.2 | Builds: arm 2 on T1 to T3; arms 0 and 2 on T4 | 25 |
| 0.3, 0.4 | Walks: five personas, one job a screen, twice on the seeded build and once on the clean one | 60 |
| 0.3 | Readers: one per walk on the seeded build, matching its findings to the planted faults | 40 |
| 0.1 | Readers: one per bare build, matching its stories to the states | 15 |
| 0.5 | Builds: arm 3 on T1 to T4 | 20 |
| | Pilots, not counted in results: two builds and two walks | 4 |

Ninety builds, sixty walks, fifty-five readers and four pilots. A fifth pilot session, the bare
pilot build's reader, ran on 2026-11-21 outside these counts. Arm 4 is not run: the proposal's
phase 0 has no step for it.

- **How a session runs,** as in Component Briefs: `claude -p` with the model and effort pinned,
  no web tools and no subagents, in a tree of a commit that holds none of the held material,
  with each arm's material in a directory of its own. The tree is a plain export with a fresh
  one-commit history and none of the repository's, not a worktree, since `git show` in a
  worktree reads what the export leaves out; the owner approved this on 2026-11-15. A session
  has six built-in tools and a strict MCP configuration with the components brief alone: by
  default a headless session also has messaging to other sessions on the machine and the skills
  built into Claude Code. That is a build session; a walk has only its persona's tools, and a
  reader none.
- **A wall, and a check behind it.** Component Briefs recorded that a session can read any
  path on the machine. The held material is on the same machine, because scoring runs there.
  So each session runs inside a sandbox profile that refuses reads of the held material, the
  runner, every checkout of this repository but the scoring one, the parts of the scoring
  checkout that name the bench, and other sessions' folders and transcripts, and
  its tool calls are still searched for a path outside its tree and its own arm's directory.
  A run that tried one is thrown out and run again. The wall covers the places named; the
  search is what finds anything else.
- **Where:** a second machine of the owner's, an Apple silicon Mac reached through T3 Code,
  which has a checkout of this repository. Builds, walks and scoring all run there: Specimen
  has a host for that platform and none for Windows (`foundations/specimen/README.md:499`).
  Until Specimen's packages are released, the host is built from source.
- **Checked there on 2026-11-15,** by a read-only session outside any checkout: the `claude`
  command is signed in to a subscription, and a headless call ran on it with no API key set.
  The Rust toolchain this repository pins, a Node 26, `pnpm`, `uv` and Playwright's headless
  shell are installed. `claude` takes the model, the effort, a JSON result, a list of tools
  and a strict MCP configuration as options; it has no option for a number of turns.
- **Specimen's host builds and renders there,** checked on 2026-11-15 at `2fc5c6fe` in a
  checkout of its own. The release build took about two minutes on the pinned Rust 1.98.0.
  With `SPECIMEN_HOST_BINARY` pointing at it, the test that renders one specimen through the
  host passed, and so did Specimen's whole suite: 558 tests passed and 1 was skipped, and the
  reference driver's 18 passed.
- **Rust builds go on the machine's external drive,** as the owner asked; its internal disk
  is nearly full. Cargo's `build-dir` setting on that machine already puts a build's
  intermediate files there, about 650 MB for the host. Specimen's documented `build:host`
  leaves only the 13 MB binary in the checkout's `host/target`, so the bench uses it as it
  is. Specimen's suite needs the TypeScript packages built first, as CI builds them.
- **Model:** Claude Opus 5.5 at `medium`, the route for everyday work and for judgement about
  an interface. Component Briefs ran on Sonnet 5.5, which is no longer a route.

## Rules for "go"

Proposed with numbers as starting points, as the review triggers are, and confirmed by the owner
on 2026-11-21 as proposed, with one reading: in step 0.3, "a persona of that modality reports at
least 2" means one persona on its own, not the modality's personas together, so the pointer
modality's two personas' findings are not pooled for it: either pointer persona can meet
the two-fault threshold on its own. Every persona's findings count toward the panel's 8 of 12.

- **The owner confirms all of them before the first run of step 0.1,** and none changes after
  it. Step 0.2 compares arm 2 with the arm 0 builds of step 0.1, and step 0.5 compares arm 3
  with the arm 2 builds of step 0.2. A rule set after its comparison's first half has been
  seen proves little.
- **Arms that are compared run at one pinned commit.**

| Step | Go when |
| --- | --- |
| 0.1 | No rule. It records what goes wrong. If arms 0 and 1 pass nine checks in ten, there is little for a default to fix, and the owner decides whether to go on. If runs of one arm differ so much that fifteen cannot resolve 15 points, the owner chooses, before arm 2 runs, whether both arms get more runs |
| 0.2 | On T1 to T3, arm 2's mean share of checks passed is at least 15 points above arm 0's, at p < 0.05 by the test in [Scoring](#scoring). Arm 2's median tokens are no more than 20 % above arm 0's. T4 is reported beside it and is not part of the rule: five runs against five cannot resolve it |
| 0.3 | Of the 12 planted faults, the panel reports at least 8 in at least one of its two walks of the seeded build, and of the 3 aimed at each modality, a persona of that modality reports at least 2. The share found in a single walk is reported beside it. A reader matches findings to faults, and the owner checks 20 of those matches. At least half of a sample of the panel's other findings, up to 30, are real in the owner's judgement (on 2026-11-24 the owner delegated both the match check and the judgement of other findings to an independent reviewer of another model family; [STATUS.md](STATUS.md#steps-03-and-04)) |
| 0.4 | A persona and job pair meets a fault when its screen carries a fault aimed at its modality. A path is worse when the job's last command never ran, or when failed commands, repeated commands and commands outside the scenario's steps add up to more. In at least three quarters of the pairs that meet a fault, the path is worse than the clean one in both walks of the seeded build. In the pairs that meet none, if there are any, that total on a seeded walk differs from the clean walk's by no more than the two seeded walks' totals differ from each other |
| 0.5 | The owner, blind, prefers arm 3's build in at least 10 of 12 pairs with arm 2's, which chance alone gives about one time in fifty. The pairs are three a screen, each an arm 2 build and an arm 3 build of that screen drawn at random. Arm 3's mean share of checks passed is not below arm 2's. Otherwise the skill is not written |

**How step 0.4 reads a path,** proposed with its rule and confirmed with it on 2026-11-21. Each walked job has
a list of the scenario's steps, and the journal is read against it:

- **A read is free.** A query does not count as outside the steps, since screens load and
  search. A failed read counts as failed.
- **A refusal the steps expect is a step,** not a failed command, such as a loan refused
  because the seed has run out.
- **A batch is one command.** The journal is to record an `afd-batch` as one entry with its
  inner results, so deciding a set one at a time adds commands outside the steps.
- **A repeat** is a mutation of the same command on the same record as an earlier one in the
  walk, whatever its input, and an undo of an earlier mutation is one too, beyond what the
  steps themselves contain. A mutation's record is the one it names, or for a create the
  member and variety it is for. So a return recorded wrong, taken back and recorded again adds
  two.
- **A walk is capped** at 60 actions or 30 minutes, and one that reaches the cap or ends
  without saying it is done ends where its journal ends. The pilots check that the clean
  build's walks finish well inside the cap.

## Budget

| Line | Basis | Estimate |
| --- | --- | --- |
| A build session | Component Briefs measured about $0.25 a session on Sonnet 5.5 at `medium`, with a median of 309 000 to 517 000 tokens. Opus 5.5 lists at twice Sonnet 5.5's price for input, output and cache reads (list prices as of 2026-11-03), so about $0.50 for the same tokens. **Assumed:** Opus 5.5 at `medium` uses as many tokens as Sonnet 5.5 at `medium` did, and a screen with its states is three times a Component Briefs page | $1.50 |
| A walk | **Assumed** equal to a build. Nothing in this repository measured one when this was written, and screenshots add tokens. The pilots measured two, on 2026-11-20, far below it ([STATUS.md](STATUS.md#the-pilots)); the line is kept until the conversion is known | $1.50 |
| A reader | **Assumed** the size of a Component Briefs session | $0.50 |

| | Count | Cost |
| --- | --- | --- |
| Builds | 90 | $135 |
| Walks | 60 | $90 |
| Readers | 55 | $27.50 |
| Pilots | 4 | $6 |
| **Total** | **209** | **about $260** |

- **The dollars measure size, not spend.** The owner decided on 2026-11-15 that the sessions
  draw on a subscription allowance. Its conversion from tokens is not published
  ([model routing](../../../operations/model-routing.md#evidence)), so list prices stay here
  as the one unit that compares a build with a walk.
- **The cap is a share of the week's allowance** on the machine that runs the sessions: no
  more than a fifth of a week's allowance in any one week
  ([ruling 2](#for-the-owner)). The runner enters each session in a ledger at its most,
  twice its line, before it starts, and at its reported cost when it ends, and starts no
  session that could take the week past the cap, inside a step if it must: step 0.1 alone is
  60 sessions.
  Phase 0 also stops for the owner between steps, so it spreads over more than one week.
- **The pilots give the conversion.** The four pilots run first. The weekly figure in Claude
  Code's usage view is read before and after them, and each session's reported cost is
  recorded. No command prints the weekly figure, so a person reads it. (Not met: on 2026-11-20
  it was not read before the pilots, and the fallback below was applied by the owner's word,
  under a cap of $50 at list prices in all for those fifteen builds; see
  [STATUS.md](STATUS.md#the-pilots). Not met either: the fifteen builds began on 2026-11-21 just
  after the weekly reset, so the figure stood at a full week before them, but it was not read
  when they ended, and other sessions on the machine moved it before it was; see
  [STATUS.md](STATUS.md#step-01).) A session's result
  does carry its cost at list prices. That gives the share a dollar at list price takes, and
  from it the share each step will take, which comes back to the owner before step 0.1. If
  four pilots do not move a figure shown in whole percents, the runs pause after the first
  fifteen builds of step 0.1, which are then the measurement, and the estimate comes back to
  the owner there. If a pilot, or any later session, costs more than twice its line or
  reports no cost, the runs stop.
- **The weekly figure is shared.** Another session of the owner's runs on that machine, so
  the figure also moves for reasons that are not the bench. Each session's reported cost is
  the measure of the bench's own use, and the weekly figure only scales it.
- **A session has a floor.** On 2026-11-15 a headless call on Opus 5.5 that answered one
  word reported about $0.11 at list prices, nearly all of it for writing the system prompt
  to the cache. A second call on the runner's flags, on the same day, reported $0.055, writing
  less to the cache, so sessions started within the cache's hour may pay less. At $0.11, 209
  sessions pay about $22 before any work, inside the estimates above.
- **Not in the total:** writing the commands, the fixtures, the reference build, the runner
  and the statements, which are ordinary working sessions.
- **The owner's time,** which no session replaces: confirming the rules for "go"; naming the
  faults in a blind sample of 12 of step 0.1's builds, two each from arms 0 and 1 for each
  screen; approving the statements; looking at the reference build; checking 20 of the
  readers' matches and judging up to 30 findings in step 0.3 (delegated by the owner on
  2026-11-24 to an independent reviewer; [STATUS.md](STATUS.md#steps-03-and-04)); choosing between 12 pairs in
  step 0.5; the decision in step 0.6.

## When it runs

Phase 0 runs once. Its 209 sessions are five experiments, each answering one question, with
the owner's review between them. They are not the cost of a bench run.

After phase 0 the bench is kept, and it runs again only as follows. *Proposed; none of it is
built.*

- **The checks that need no model** can run whenever the bench's package changes, since they
  take no allowance: on the reference build each story mounts, each contract field reaches
  the screen, and Specimen's accessibility check passes. No workflow runs them. Adding one
  is a change to CI and is not proposed here.
- **Sessions run on a named event,** never on a schedule and never in CI. Each rerun is a
  subset with its own estimate, approved before it starts:

  | Event | Rerun | Size |
  | --- | --- | --- |
  | A default pattern's statements change | The screens that pattern is on, old statements against new, five runs each | 10 to 40 builds |
  | The model route changes | Arm 0 and the current defaults on all four screens, five runs each | 40 builds |
  | A persona card or the runner changes | The walks on the seeded build | Up to 40 walks and 40 readers |
  | Phase C's exit | The walks on the seeded build, and the panel loop on the two jobs held back for it | 40 walks and 40 readers, and what phase C sizes for the loop |

- **It wears out as evidence.** After the last run of phase 0 the faults and the checks are
  committed, and T4 is no longer held back from whoever writes statements. A later run can
  show that nothing got worse. A new claim that a default helps needs a screen that no
  statement was written from.

## What it does not test

- **The panel loop,** arm 4.
- **Reviewers of different model families.**
- **Forced colours.** Specimen does not emulate them, so no check covers them, and no persona
  card has them. (First given as Botcore's `cdp_emulate` not emulating them either; the walks no
  longer use it.)
- **Motion.** Specimen does not observe animation.
- **People.** Every finding from a persona is a hypothesis about a person.
- **A second design system.** Every build uses `violet-elements`.

## For the owner

The owner ruled on the first three on 2026-11-15. The fourth was not put to the owner, and
the owner confirmed the fifth on 2026-11-21.

1. **Domain.** **Decided: the seed library,** because every result state arises from the
   subject and a judge needs no expertise. The tool library was the fallback.
2. **Model, budget and cap.** **Decided: Opus 5.5 at `medium`, on the subscription allowance
   of a second machine, and no more than a fifth of a week's allowance in any one week.**
   The pilots run first to measure what a session takes. The session counts are firm. The
   size of a session rests on assumptions the pilots replace, and the fifth is a guess until
   the pilots give the conversion. Both come back to the owner before step 0.1, or after its
   first fifteen builds if the pilots do not move the weekly figure. (Neither gave it: the
   figure was not read before the pilots, nor when the fifteen builds ended; see
   [STATUS.md](STATUS.md#step-01).)
3. **The bare arm.** **Decided: step 0.1 has one.** The proposal's section 5.9 has every task
   list the screen's states. Phase 0 would then test how well each state is rendered, and
   not whether an agent leaves states undesigned when nobody lists them, which is half of
   the first-ranked job. The bare arm is given the jobs and the commands with no list of
   states and no fixtures, and is scored on one question: which states have a story. It is
   15 builds and 15 readers, in the total above.
4. **Where scoring runs.** **Not a ruling: it follows from the owner's choice of machine.**
   Specimen does not support Windows (`foundations/specimen/README.md:499`), and the machine
   this file was written on has no Linux subsystem installed. The machine that runs the
   sessions is an Apple silicon Mac, which Specimen supports, so the checks can run there too
   and nothing is installed here or added to CI. Specimen's host was built there and its
   suite passed on 2026-11-15.
5. **The rules for "go".** **Decided 2026-11-21: confirmed as proposed,** together with how
   step 0.4 reads a path, after the pilots and before the first run of step 0.1. Step 0.3's "a
   persona of that modality" is read as one persona alone.
