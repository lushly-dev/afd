# Agent-First Design: status

Read this before the [proposal](agent-first-design.proposal.md). It records exactly what is done
and what is not, so an agent never has to scan the code to learn what is current. It follows the
shape of the [Patterns status](../../active/patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked, or, for what the bench keeps outside the
  repository until phase 0 ends, finished with its record or hash named here. Anything else is
  "in progress" or "open", with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** scaffold with a design direction. Written 2026-11-14 against `545316f2`.
  One independent reader reviewed it. The owner has answered nine of its thirteen questions and
  not approved the whole. Amended 2026-11-16 with section 5.10, where the result-state work and
  interface state live, which the owner decided as question 13.
- **Epic:** none for this proposal; opening one is the owner's call.
  [#1385](https://github.com/lushly-dev/afd/issues/1385) carries the code of the proposal's
  section 5.10.
- **Done:** the problem, what exists today, the model, thirteen draft jobs as sentences with the
  rank the owner confirmed, a design direction, the amendments it implies for other documents,
  phases, thirteen questions for the owner with nine answered, and an independent review in two
  passes.
- **In progress:** the [bench specification](bench.md), step 0.0 of phase 0, drafted
  2026-11-14 and merged in #1234. On 2026-11-15 the owner decided its domain, its model and
  budget, and its bare arm, and an independent reader reviewed it. The owner confirmed its rules
  for "go" on 2026-11-21. Its application, held material and reference build are built; its
  runner is written but for arm 2's statements and arm 3's skill. Its pilots, step 0.1 (ended at
  its first fifteen builds by the owner's decision) and steps 0.3 and 0.4 have run
  ([Step 0.1](#step-01), [Steps 0.3 and 0.4](#steps-03-and-04)); steps 0.2 and 0.5 are deferred.
- **In progress:** the seed library's
  [jobs and drafted commands](bench/seed-library.md), drafted 2026-11-15 and merged in
  #1236: seventeen jobs as scenario files and twenty-four commands. The scenario checks
  pass, three readers walked the paths and a fourth reviewed the result. On 2026-11-15 the
  owner decided three of its design points; the list of jobs as a whole is still open.
- **In progress:** each bench screen's [task](bench/tasks/README.md) and the results that
  force its states, drafted 2026-11-15, reviewed in two passes and merged in #1238.
- **In progress:** the seed library's application, built 2026-11-15 in
  [`packages/examples/seed-library`](../../../../packages/examples/seed-library/README.md) on
  `feat/seed-library-example` and merged in #1239: the twenty-four commands with their schemas,
  an in-memory store, and tests that run all seventeen jobs (113 of 113 steps pass) and check
  the 74 results against the commands' output schemas. An independent reviewer read it in two
  passes.
- **Done:** the bench's held material, written 2026-11-15 and kept outside the repository on
  the second machine's external drive, as the owner decided. Its first stage, the checks and
  the two held-back jobs, was frozen on 2026-11-15; the SHA-256 of its manifest is
  `6e2a2d7d7daeb8326ef32f7dbae8f405ec40f59bf6cd2604732b822c396cdb31`. Its second stage, the
  faults with their proofs, the persona cards and the walk scripts, was frozen on 2026-11-18,
  before any walk; the SHA-256 of its manifest is
  `e293ce7f690b09ecb8af1cd76a957ef25b16ebccc4744cc035a4f9996c3853c4` ([bench.md](bench.md#status)).
- **In progress:** the bench's runner, written 2026-11-15 and kept, like the held material,
  outside the repository on the second machine's external drive, as a local repository with no
  remote: its code that matches the checks shows how builds are scored. It sets up each
  session, runs it, checks its tool calls for leaks, keeps the budget and scores the story file
  through Specimen. Its walks and readers were written on 2026-11-18, and its reports of steps
  0.1 to 0.4 and step 0.2's statistics on 2026-11-21. Its pinned commit has
  moved four times as `main` gained what the bench uses, last to `f4eeba0c` on 2026-11-18; at
  each move the checks were confirmed to stand and the reference build was scored again. See
  [the runner](#the-runner).
- **Done:** the bench's reference build, built 2026-11-15 and kept beside the runner, outside
  the repository, since it answers every task. It passes all 308 checks and runs each screen's
  jobs end to end. Three models reviewed it, then a panel of five lenses in four rounds, with
  three more checking the fixes, and the owner looked at every state; the owner approved it on 2026-11-18, and on 2026-11-24
  looked again at the screenshot page made on 2026-11-16 and marked none. A copy of it holds
  the twelve faults, each proved present there and absent from the clean build. See
  [the reference build](#the-reference-build).
- **Not done:** for the proposal's own thirteen jobs, drafted commands, scenario files, the
  three scenario checks and reader walks; the owner's remaining answers; moving each part
  into the proposal that owns it; steps 0.2, 0.5 and 0.6 of phase 0, and phases A to D. See
  [What is not done](#what-is-not-done).
- **Blocked on:** the owner's step 0.6 decision (go, go with changes, or stop) after the walk
  tuning and confirmation rerun of 2026-11-24 ([Steps 0.3 and 0.4](#steps-03-and-04)), including
  whether the blind pairwise report comparison counts for step 0.4's rule and whether steps 0.2
  and 0.5 remain deferred. Every session needs the owner's word, since it spends the owner's
  allowance. Questions 4, 8, 9 and 10 of the proposal are open and block nothing yet.
- **Order:** the owner answers the direction and ranks the draft jobs before commands are
  drafted, as the [Scales scaffold](../../active/scales/STATUS.md) does. The
  [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md) puts the owner's
  ranking after the scenarios and the reader walks, and they still follow.
- **Last verified:** 2026-11-24 for the reference build at `f4eeba0c` (308 of 308 checks on the
  rebuilt scoring checkout), step 0.1's first fifteen builds and their report, steps 0.3 and 0.4
  (both builds proved, the walks' reports and the independent sample check), and the tuned runner
  (54 unit tests, a full dry run of the confirmation batch, both builds proved, and both frozen
  manifests verified unchanged; [Steps 0.3 and 0.4](#steps-03-and-04)).
  2026-11-18 for the reference build at `f4eeba0c` (308 of 308 checks, its
  scripted browser runs clean), the twelve faults' proofs on both builds, three runs each, and the stage 2
  manifest. 2026-11-16 for section 5.10 and the two facts it added to section 2: the
  link check and an independent review, below. Otherwise 2026-11-15, the runner's tests and dry runs on the second machine, the
  reference build's 308 checks, its runs end to end and its reviews, the link check, the scenario checks on the seed library's jobs, the check of the bench's tasks
  and results, the reviews below, and the seed library's tests, `pnpm check` and `pnpm verify`
  on the built application, and the held-back jobs run against it.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, model, draft jobs, design direction | Done 2026-11-14, merged in #1223 | [`agent-first-design.proposal.md`](agent-first-design.proposal.md) |
| Open the epic | Not started; the owner's call | |
| The owner answers the proposal's section 9 | In progress. Answered 2026-11-14: questions 1, 2, 3, 5, 6, 11 and 12, and the todo example in question 7. Answered 2026-11-15: the bench's domain in 7 and the budget in 12. Answered 2026-11-16: question 13. Open: 4, 8, 9 and 10 | Proposal, section 9 |
| Amend with where the parts live (5.10) | Done 2026-11-16, merged in #1386: the owner's test for the component layer, the layer map, two facts in section 2 and question 13. Its code changes are [epic #1385](https://github.com/lushly-dev/afd/issues/1385)'s | Proposal, sections 2 and 5.10 |
| Amend with the screen an agent sees (5.10) | Done 2026-11-24, merged in #2466: a row in the layer map for an agent seeing and filling what is on the screen, the owner's answer under question 13, and UI SDK as a published design to compare. Open: where its code goes, in `afd-view-state` or in a layer of its own, and how much of the screen an agent sees. [#2275](https://github.com/lushly-dev/afd/issues/2275)'s scope covers neither until its approach or a new sub-issue under [epic #1385](https://github.com/lushly-dev/afd/issues/1385) says so. Superseded on what is open by the row below | Proposal, sections 5.10 and 9 |
| Record the owner's clarification, and point 5.10 at the Controls proposal | Done 2026-11-24, merged in #2480: the owner's reply is quoted under question 13. The session reads it as a case for a designed path in place of a workaround, naming no layer, so the [Controls proposal](../../active/controls/controls.proposal.md) places the code and puts how much of the screen an agent sees to the owner as its question 4 | Proposal, sections 5.10 and 9 |
| Point 5.10 at the approved Controls proposal | Done 2026-11-24, merged in #2493: the owner approved [Controls](../../active/controls/STATUS.md), which moved to `active/`; the 5.10 row names its phase issues, which replace #2275, and question 13 records the approval | Proposal, sections 5.10 and 9 |
| Move each part into the proposal that owns it | Not started. Ready to move: customizing a default (5.1) and who owns the result-state patterns (5.2) into Patterns; the panel's provisional answer and the triggers (5.5) into Design Decisions | Question 1 |
| Draft the commands against the ranked jobs | Not started. The rank is confirmed; this is phase A's, after phase 0's decision | |
| Write each job as a scenario and run the checks | Not started | [Jobs first](../../../../.claude/skills/afd/references/jobs-first.md) |
| Walk the paths with readers who did not write them | Not started | Three seats, as jobs first describes |
| Independent review of the proposal | Done 2026-11-14: one broad pass and one pass on its blockers | [How it was checked](#how-it-was-checked) |
| Phase 0, step 0.0: the bench's specification | In progress. The specification is written, and merged in #1234. Drafted 2026-11-14 with a recommended domain, 209 sessions and an estimate of about $260 at list prices, used as a measure of size. The owner decided three of its points on 2026-11-15: a seed library; Opus 5.5 at `medium` on a second machine's subscription allowance, no more than a fifth of a week's allowance in any one week; and a bare arm in step 0.1. An independent reader reviewed it the same day. The owner confirmed the rules for "go" and the reading of a path for step 0.4 on 2026-11-21, as proposed, with step 0.3's "a persona of that modality" read as one persona alone | [`bench.md`](bench.md) |
| The bench: its jobs and drafted commands | In progress. Drafted 2026-11-15: 17 jobs as scenario files in 113 steps, and 24 commands. The parse, dry-run and coverage checks pass. Three readers walked the paths, and an independent reviewer read the result and walked the two commands their findings added. Merged in #1236. The owner decided three of its design points on 2026-11-15 | [`bench/seed-library.md`](bench/seed-library.md) |
| The bench: the task for each screen and its result fixtures | In progress. Drafted 2026-11-15: four tasks, 50 states and 74 results, checked against the drafted commands, the States table and the fixtures, and reviewed in two passes. Merged in #1238 | [`bench/tasks/`](bench/tasks/README.md) |
| The bench: the application and its schemas | In progress. Built 2026-11-15 on `feat/seed-library-example`, merged in #1239: 24 commands with zod input and output schemas, an in-memory store, the approval hook and the steward's middleware. Its tests run the 17 jobs, 113 of 113 steps passing, two of them over MCP with confirmations enforced, and check the 74 results against the output schemas | [`packages/examples/seed-library`](../../../../packages/examples/seed-library/README.md) |
| The bench: the held material | Done. Written 2026-11-15 outside the repository and reviewed in two passes. Stage 1, the checks (308 over 50 states) and the two held-back jobs, frozen 2026-11-15, its manifest's SHA-256 `6e2a2d7d7daeb8326ef32f7dbae8f405ec40f59bf6cd2604732b822c396cdb31`. Stage 2, the twelve faults with their proofs, five persona cards and four walk scripts, settled against the reference build after the owner's look, reviewed once more and frozen 2026-11-18, its manifest's SHA-256 `e293ce7f690b09ecb8af1cd76a957ef25b16ebccc4744cc035a4f9996c3853c4` | [`bench.md`](bench.md#status) |
| The bench: the runner | In progress. Written 2026-11-15 outside the repository, on the second machine's external drive, as the owner decided for the held material, and approved in its design by the owner the same day. Session setup, the `claude -p` session, the leak check, the budget and scoring the checks are written and tested without a model session, and two smoke sessions ran, the second inside the sandbox with the narrowed tools. Recorded in #1253. Walks, the reading of a path and the readers written 2026-11-18 and tested without a model session. Each step's report from 0.1 to 0.4 and step 0.2's statistics written 2026-11-21 and tested on invented runs. Not written: arm 2's statements and arm 3's skill | [The runner](#the-runner) |
| The bench: the reference build | Done. Built 2026-11-15 outside the repository, on the second machine's external drive, kept there like the held material because it answers every task, T4 included; the session sandbox refuses it. All four screens, one story per state and the running app with its journal. It passes all 308 checks and every walked job runs end to end. Three reviewers of different models reviewed it, then a five-lens panel in four rounds, with three more checking the fixes; the owner looked at every state on 2026-11-16 and approved the result on 2026-11-18. The twelve faults are planted in a copy, each with its proof run on both builds. On 2026-11-21, by the owner's decision after a pilot walk, a refusal's feedback was corrected in both builds, with every proof and check run again ([The pilots](#the-pilots)). On 2026-11-24 the owner looked again at the screenshot page made on 2026-11-16 and marked none | [The reference build](#the-reference-build) |
| The bench: the pilots | Done 2026-11-21, except the conversion, which step 0.1's first fifteen builds did not give either ([Step 0.1](#step-01)). Run at the owner's word: two builds and two walks, $3.67 at list prices, and on 2026-11-21 the bare build's reader. No leak, and no session over twice its line. The weekly figure was not read first. Their records are the runner's ledger and run folders and the held folder's notes on stage 2, committed with the record after phase 0 | [The pilots](#the-pilots) |
| Phase 0, step 0.1 | Done 2026-11-24 at its first fifteen of 45 builds, by the owner's decision: the builds ran on 2026-11-21 at the owner's word and were scored on 2026-11-24 with the five bare builds' readers. Both arms pass nine checks in ten; the owner approved the builds and ended the step there, since the process is what phase 0 proves | [Step 0.1](#step-01) |
| Phase 0, steps 0.2 and 0.5 | Deferred by the owner on 2026-11-24: at arm 0's 92 to 95 %, a perfect arm 2 gains 5 to 8 points, short of step 0.2's 15, and step 0.5 builds on step 0.2's arm 2 | [Step 0.1](#step-01) |
| Phase 0, step 0.3 | Done 2026-11-24, met: the panel found 12 of 12 planted faults, each modality's own persona 3 of 3; an independent reviewer, by the owner's decision, judged 20 of 20 matches right and 23 of 30 other findings real | [Steps 0.3 and 0.4](#steps-03-and-04) |
| Phase 0, step 0.4 | Done 2026-11-24, not met on the original journal-path rule (3 of 13 pairs worse in both seeded walks); tuned 2026-11-24 with a blind pairwise report comparison (4 of 4 fault-meeting and 1 of 1 no-fault on a 15-walk confirmation rerun; 12 of 13 fault-meeting and 6 of 7 no-fault on the 60 original walks, awaiting owner confirmation) | [Steps 0.3 and 0.4](#steps-03-and-04) |
| Phase 0, step 0.6 | Not started: the owner's decision (go, go with changes, or stop), including whether the tuned report comparison counts for step 0.4 and whether steps 0.2 and 0.5 stay deferred | Proposal, section 7 |
| Phases A to D | Not started; each needs phase 0's decision | Proposal, section 7 |

## What is not done

- **No commands are drafted and no job is a scenario file for the proposal's own thirteen
  jobs.** They are sentences, and nothing shows that commands can express them. The seed
  library's seventeen jobs are a different list: the bench's application, not this proposal's
  product.
- **The bench is built but for arm 2's statements and arm 3's skill, and steps 0.2, 0.5 and 0.6
  have not run.** Its pilots, step 0.1's first fifteen builds and steps 0.3 and 0.4 have. Its application is built and merged in #1239 (2026-11-15). Outside the repository, its
  held material is written and frozen, its reference build is approved and a copy of it holds
  the faults, and its runner is written, its reports and statistics included (2026-11-21). The pilots and
  the first fifteen builds measured what a session costs at list prices, not what share of the
  allowance that is. The owner confirmed its rules for "go" on 2026-11-21.
- **No reader has walked the proposal's jobs.** There are no commands to walk. The design
  direction is one session's draft, written with the owner in conversation and reviewed
  once.
- **Little in it is measured.** Phase 0 exists to measure it. Step 0.3 showed a persona panel
  finds planted faults (12 of 12) and step 0.1 that agents build screens passing nine checks in
  ten without a default pattern set; its claim that a default pattern set or a skill improves an
  agent's screens is untested, and Component Briefs' prototype is
  evidence that added context alone does not.
- **Copying a default is not designed.** A record of source on a pattern file, the comparison
  by statement id, the source as it was, and how a product's screens are held to a copied
  pattern are named in the proposal's section 5.1 and nothing more.
- **The owner's decisions here,** on 2026-11-14 unless dated:
  - the todo example is not the bench's base;
  - question 1: this document is the frame, and each part moves to the proposal that owns it;
  - question 2: a default is customized by copying it, not by layering, and an unchanged
    default is named at a version;
  - question 3: AFD owns the result-state patterns;
  - question 5: a panel may answer a review item provisionally, never the author of the change
    and never for release;
  - question 6: the five triggers, a panel of five, and a person asked on a 3 to 2 split;
  - question 11: the rank of the jobs as proposed, with job 3 merged into job 2, job 11 folded
    into job 10, job 13 deferred and job 15 added;
  - question 12: phase 0 runs;
  - on 2026-11-15, for the seed library's jobs: asking the steward is a held `loan-create`;
    job 16 stays; and the approval request is off the held-back screen, recorded as a limit;
  - on 2026-11-15, for the bench: a seed library as its domain; Opus 5.5 at `medium`; its
    sessions run on a second machine of the owner's and draw on that machine's subscription
    allowance, no more than a fifth of a week's allowance in any one week; and a bare arm in
    step 0.1;
  - on 2026-11-15, for the bench's held material: it is kept in a private folder on the second
    machine's external drive, outside every checkout, until the last run; and it is written
    first, then the runner, then the reference build;
  - on 2026-11-15, for the bench's runner: its design as proposed, with a session's tree a
    plain export of the pinned commit and not a git worktree; building Umbel's components
    server on the second machine for the brief every arm has; and one smoke session;
  - on 2026-11-15, after the runner was recorded in #1253: a second smoke session; the open
    question on how the runner reads one kind of control, settled as recommended; removing the
    six neighbouring proposals from every arm's tree; and the allowance week's reset, read from
    the owner's screenshot;
  - on 2026-11-16, question 13: the test for the component layer ("just because something can
    go into FAST-AF, should it?"), the amendment that adds the proposal's section 5.10, and the
    plan as epic #1385, started the same day. Three of its calls stay open to change until their
    step starts;
  - on 2026-11-20, for the bench: the four pilots under a cap of $15 at list prices;
  - on 2026-11-21, for the bench: the bare pilot's reader; a cap of $50 at list prices for step
    0.1's first fifteen builds, which measure the share of the allowance; and correcting a
    refusal's feedback in the reference build and its seeded copy;
  - on 2026-11-24, an addition to question 13: an agent inside an application sees and fills
    what is on the screen, with no actions declared by components. Where its code goes, and how
    much of the screen an agent sees, stay open;
  - on 2026-11-24, clarifying that answer: the sentence about shoehorning made a case for a
    designed path in place of a workaround (a command that sets values, and code in the
    interface that applies them);
  - on 2026-11-24, after steps 0.3 and 0.4: agreed to tune the walks (tell each persona the
    application's date, require an ending line, and judge step 0.4 by whether a persona's report
    names the trouble) and rerun 10 to 15 walks for a few dollars to confirm the changes.

## How it was checked

Run 2026-11-14 in this worktree at `545316f2`, and the links again after merging `main` at
`dd080235`, which moved Component Briefs to `complete/`.

- **Claims about the repository** in the proposal's section 2 were read first-hand in this
  session, each from the file it names. The exceptions are listed under "Not verified" in the
  proposal's status.
- **Links:** a throwaway Node script resolved every relative link in the proposal and in this
  file against the working tree, and every anchor against the target file's headings. Run
  over the proposal, this file and `docs/features/README.md`, it reported 148 links checked and
  0 broken. External URLs
  were not checked; there are none.
- **The verify plan:** `pnpm verify --list --files` on the three changed files printed "no
  packages affected" and "no path-filtered workflow is triggered", so there was no gate to run.
  The change is two new Markdown files and one row in `docs/features/README.md`.
- **Independent review:** a fresh read-only reviewer on Claude Opus 5.5 at `high`, briefed as
  `review-code` describes, read the three files against the tree after the merge of `dd080235`.
  It reproduced the counts and the link check and found every citation it checked in section 2
  accurate. It raised four blockers and eleven improvements, all traced by reading:
  - *Blockers, fixed:* two places still treated question 1 as open; section 5.8 read as
    writing statements from the public skills, against 5.2; job 3 and section 5.6 read as an
    automatic substitution, against copying; phases A to D had no exit.
  - *Improvements, taken:* statement ids are unique within a library
    (`foundations/specimen/docs/pack-format.md:202`), so the open point was closed; "copied
    pattern" is now a separate term from Patterns' copy, and the gap in how a product's screens
    are held to one is named; a step that writes the bench (0.0); what the panel walks; the
    conflict with Design Decisions' recommendation 7; the difference from Scales; five small
    corrections in sections 2 and 5; and a claim about models marked as a hypothesis.
  - *Not checked by the reviewer:* the content of the six public skills, and that
    `violet-elements` has no component bound to a result beyond its folder names.
- **Second pass:** a second fresh reviewer, on the same model and effort, checked only that the
  four blockers were fixed and that the owner's decisions were recorded consistently. It
  approved, and raised six small wording points, all taken: "entries" for a reference's lines so
  they are not read as pattern statements, the phase A, B and C exits, and a count in this file.
- **Not run:** `botcore skill-lint` and the `docs_*` checks. No skill was changed.
- **The bench specification, 2026-11-14 at `fd0781e4`:** its figures from Component Briefs
  were read from the prototype record, its session counts were added up twice, and the same
  link script was run over the three files in this folder and the features index: 167 links
  checked and 0 broken. Read first-hand for it: that Specimen does not support Windows
  (`foundations/specimen/README.md:499`), that `wsl.exe -l` on the author's machine reports no
  Linux subsystem, and that Botcore's `cdp_emulate` has no option for forced colours
  (`endpoints/botcore/src/botcore/commands/cdp/diagnostics.py:172`). It had no independent
  review then (superseded by the review of 2026-11-15 below).
- **The bench specification, 2026-11-15:** read first-hand through T3 Code, that the owner's
  second machine answers, is an Apple silicon Mac and has a checkout of this repository, and
  from Specimen's README that a host exists for that platform. Not checked: that the host
  builds there, that the `claude` command there is signed in, and what share of a week's
  allowance a session takes. The link script was run again over the same four files.
- **The second machine's tools, 2026-11-15:** a read-only session there, started through T3
  Code outside any checkout, ran a handful of commands and reported them. The `claude`
  command is signed in to a subscription; a headless call on Opus 5.5 at `medium` ran with
  no API key set and reported its cost at list prices, about $0.11 for a one-word answer.
  The pinned Rust toolchain, a Node 26, `pnpm`, `uv` and Playwright's headless shell are
  installed. No command prints the weekly usage figure.
- **Specimen's host on the second machine, 2026-11-15 at `2fc5c6fe`:** a session there, in a
  checkout of its own, built the host with `cargo build --release --locked` and the target
  directory on the external drive (2 min 4 s, a 13.3 MB binary). With
  `SPECIMEN_HOST_BINARY` set to it, `src/baseline.test.ts` passed, 5 of 5. Specimen's suite
  first failed 9 tests in `src/bench-worker.test.ts` ("Compiled Specimen worker is missing");
  after `pnpm -F "@lushly-dev/specimen-cli..." build` it passed: 558 passed and 1 skipped,
  and the reference driver's suite 18 of 18. Nothing was committed.
- **The bench's tasks and results, 2026-11-15:** a throwaway script, not kept, parsed every
  result and compared it with the drafted commands table and the States table (`data` keys,
  list entries, statuses, row and member shapes, refusal codes) and with the fixtures' ids. It
  also checked that every task names only results that exist, that every result is mounted by
  a state, and that no task mentions patterns, arms or the bench specification. Planted
  faults failed it. Its last run printed "74 result files, 50 states, 24 commands, 74 mounted"
  and "No problems found". The link script reported no broken link. An independent reviewer
  on Claude Opus 5.5 read the first version (53 states, 49 results) and raised three
  blockers: each task named the pattern of each state, which hints at the design
  and tells arm 2 what to apply; nothing kept the bare arm from reading the states in the
  scenario files and the design document, so `bench.md` now says what each arm reads; and a
  single result could not make a whole screen, so each state names every result its story
  mounts. A focused second pass found the first and third fixed and the second in part: the
  scenario files' headers and two sentences the bare arm reads still named the bench, the
  statements or the confirmation steps. Those were moved or reworded, and it raised a T3 ask
  its story could not show and a request id from the wrong data, both fixed.
- **The seed library's jobs, 2026-11-15 at `dfb153b2`:** after
  `pnpm -F "@lushly-dev/afd-cli..." build`, the three checks the jobs-first guide names were
  run on `bench/scenarios`, and run again after the walks changed the files.
  `scenario validate` printed "All 17 scenario(s) are valid!". The dry run with fixtures
  resolved found no error in 17 files and 113 steps. The coverage report showed 24 of 24
  drafted commands used, none undrafted, and 10 of 12 error codes shown; the other two,
  `SERVICE_UNAVAILABLE` and `FORBIDDEN`, need a failing service and a second actor, which a
  scenario cannot express.
- **The walks, 2026-11-15:** three fresh read-only readers on Claude Opus 5.5, one in each
  seat the jobs-first guide names, read the first version of the jobs, with 22 commands.
  Their findings added two commands, changed fourteen scenarios and reworded three jobs; what
  was taken and what was declined is in
  [the seed library's jobs](bench/seed-library.md#what-the-walks-changed). The host
  behaviour one reader cited was read again in `packages/server/src/approval.ts` before it
  was acted on.
- **Independent review of the seed library's jobs, 2026-11-15:** a fresh read-only reviewer
  on Claude Opus 5.5, asked for at `high` and unable to see the effort it ran at, read the
  document, the 17 scenario files and both fixtures. It ran the three checks itself and got
  the figures above, walked every count in all 113 steps against the fixtures and found them
  right, and found every command, field and refusal in the scenarios in the commands table.
  It raised four blockers, all fixed: the document did not say which surface and actor each
  caller uses, so the confirmation steps and the rule that only a person decides could not
  both hold; the twenty-four hours was called a limit of the host where it is this design's
  choice; the approval request on T4 named no command that declares `approval`; and the two
  added commands broke the rule that everything else has a way back. Of its improvements,
  eight refusals gained a `suggestion` assertion, the statuses were listed, and
  `variety-retire` became the steward's. One was declined: marking `donation-cancel`
  destructive. The fixes were read back by the author; no second pass was run.
- **Independent review of the bench specification, 2026-11-15:** a fresh read-only reviewer on
  Claude Opus 5.5, asked for at `high`, briefed as `review-code` describes and given the
  owner's words as the only source for a decision, read the three files in this folder and
  the features index against the tree after the merge of `8da5804b`. It reproduced the
  session counts, the dollar sums and the link check, and found the jobs table and the rank
  table in agreement. It raised six blockers and a list of improvements, all traced by
  reading:
  - *Blockers, fixed:* the files said the owner had approved the bench and ruled on four
    points, where the owner had answered three questions; the session log still called the
    cap open; a figure from Component Briefs was given as a test on checks, where it was a
    test on median tokens; step 0.2's rule could be set after the builds it is compared with
    were seen; the proposal did not carry the bare arm, and gave arm 0 nothing where the
    bench gives it the components brief.
  - *Improvements, taken:* the rules for steps 0.3, 0.4 and 0.5 restated so that they can be
    computed, with 0.5 raised from 8 to 10 of 12 pairs; T4 reported and no longer part of a
    rule; the cap applied inside a step; the separation of held material stated as not a
    wall; the command sketch marked incomplete and the jobs-first order corrected; an
    unmarked assumption about tokens marked; `cdp_emulate` described as taking two options
    it does not apply.
  - *Second pass:* a second fresh reviewer on Claude Opus 5.5, asked for at `high` and
    reporting that it ran at low effort, checked each item against the fixes. It found five
    blockers fixed and one in part: the session log still called the question of where to
    score settled. It rechecked the session counts, the dollar sums, the chance of 10 of 12
    pairs and the links (174 checked, 0 broken). It raised ten smaller points, among them a
    blind sample counted for two arms where step 0.1 has three, and a rule for step 0.4 that
    did not say which of two walks it used. The author fixed all eleven and read them back.
    No third pass was run.

- **The seed library's application, 2026-11-15, on `feat/seed-library-example` from
  `03f68dc2`:** on Node 26.13.1, Windows 11.
  - `pnpm -F @afd/example-seed-library test`: 3 files, 115 tests passed. The scenario test
    runs fifteen jobs in process as the test actor and jobs 12 and 16 over MCP (the individual
    tool strategy, `confirmations: 'enforce'`, `createContext` giving a human steward); it
    checks every successful result against its command's output schema and reports "113 of 113
    scenario steps passed". The results test passed for all 74 files, with no result or schema
    changed. Three steps first failed: they compared with an earlier step's result inside
    `expect`, which the runner never resolves, and now name the ids the fixture's counters
    give ([What a scenario could not express](bench/seed-library.md#what-a-scenario-could-not-express)).
  - `node packages/cli/dist/bin.js scenario validate packages/examples/seed-library/scenarios`:
    "All 17 scenario(s) are valid!".
  - `afd validate`'s listing check and `--surface`, run from a throwaway script against the
    library's MCP handler without `afd connect`, which would overwrite the CLI's saved
    server: 27 tools, 0 errors and 0 warnings, so no `MISSING_APPROVAL_POLICY`; under the
    grouped strategy, 8 tools and none either. Surface: 0 errors, 30 warnings (25
    `schema-overlap` between commands that take the same `id`, or `memberId` and
    `varietyId`, as the design names them, and 5 `schema-complexity`) and 7 infos.
  - `npx biome check --write packages/examples/seed-library`, `pnpm check:boundaries`
    (examples are outside `architecture.json`'s scope) and `pnpm check`: all passed, the
    last over all 50 packages because `pnpm-workspace.yaml` changed.
  - `pnpm verify --keep-going`: 47 passed and 10 failed, each a platform failure on Windows
    in code this change does not touch: Specimen's five suites and Loam's `test:browser` and
    `test:mounted` (the Rust hosts use Unix-only APIs and do not compile: "cannot find unix
    in os"); Loam's `test:hosted` (POSIX file modes, "expected 438 to be 448", and
    `ps -o rss=`); `hosted-fixtures` (a SIGTERM test reads a null exit code, "null !== 1");
    and the C++ todo conformance run (MSVC writes the server to `build/release/Debug/`, and
    the runner looks in `build/release/`). Linux CI runs those.
  - Not run: a review by anyone but the author, and a check that the results follow one
    another. A throwaway script ran each result's `$input` from the fixture's start: 34
    of the 73 single-command results matched in `data` or error code, and the other 39 record
    a later state or a list that cannot be read.
- **The bench's held material, 2026-11-15:** written outside the repository from the tasks,
  results and application at `7c64d460`. What was checked can be said here without its
  content:
  - A script parsed the four check files, compiled every pattern and counted 308 checks; it
    also ran the patterns that had been wrong against sample text (below).
  - The two held-back jobs ran against the application from source through the package's own
    harness, 10 of 10 steps, and `afd scenario validate` found both valid. A temporary test
    file was used and deleted; nothing was committed.
  - *Independent review, first pass:* five blockers, by kind: a miscount behind step 0.4's
    rule, a fault whose proof also held on a clean build, faults that could reach personas of
    another modality, a matching rule that counted some text twice, and a persona with no way
    to read a page. Among the improvements: checks that a screen could pass without showing the
    state's point, checks too narrow for fair wordings, walk scripts that gave steps, persona
    stances that named what to look for, and held-back jobs that were not fair tests. All were
    fixed: the jobs were replaced, and the faults, cards and walks became a second stage,
    frozen once the reference build exists.
  - *Second pass, on stage 1 only:* two blockers, both in checks that could never pass or that
    passed on the wrong state, from an escaping mistake in a fix script and a pattern that was
    too broad. Both were fixed and the repaired patterns tested, and the matching rules were
    made exact.
  - *Placing it:* a task on the second machine fetched the packed folder over the private
    network from a one-file server on this machine, limited to that machine's address and a
    random path, and stopped after one request. There the archive's hash matched, every file of
    the manifest checked out, and the folder is readable by its owner only. The working copy on
    this machine was then deleted, so that folder is the only one.
  - *A review of this record* found that its first wording of the reviews above gave away
    details of three checks, and that "What is not done" was stale. Both were fixed.
- **Review of the seed library's application, 2026-11-15:** an independent reviewer found one
  blocker and seven improvements, all fixed the same day. *Blocker:* a DirectClient whose
  `onApprovalNeeded` approved the hold lent rare seed past the steward, and left the request
  waiting; `loan-create` now refuses rare seed with `FORBIDDEN`, naming `request-list` and
  `request-decide`, with a DirectClient test. *Improvements:* the steward check no longer
  treats the test actor as the steward, and the scenarios run as a steward actor (superseding
  "as the test actor" in the entry above); `request-reopen` refuses while another request for
  the pair waits; a hold for a call with no actor says why it was held; the undo tests check the
  state came back; the README and `serve.ts` say the server has no authentication, and
  `start` now listens on 127.0.0.1; a citation; and the root README's examples table.
  `scripts/affected/scope.mjs` now maps the bench's `results/` and `tasks/` to the package:
  `pnpm verify --list --files` on a result and a task printed "no packages affected" before
  and "1 of 50 packages ... @afd/example-seed-library" after. Rerun: the package's tests (3
  files, 119 tests, 113 of 113 steps), `node --test scripts/affected.test.mjs` (18 passed),
  `pnpm check` and the link check.
- **The amendment of 2026-11-16** (section 5.10, two facts in section 2, question 13), on a
  branch from `main` at `a67433d7`:
  - *Claims:* section 2's new facts were read first-hand from the files they cite. The Lushly
    lines come from reading that private repository the same day and name none of its paths.
  - *Links:* the same throwaway script, over the proposal and this file, found no broken link or
    anchor.
  - *The verify plan:* `pnpm verify --list` printed "no packages affected" and "no
    path-filtered workflow is triggered".
  - *Independent review:* a fresh read-only reviewer on Claude Opus 5.5 at `high`, briefed as
    `review-code` describes. *Blockers, both fixed:* section 2 said the runtime's confirmation
    never reads `confirmPrompt` (it reads its own entry's, not AFD's) and that neither
    application reads `undoCommand` (Loam's editor does, once); and section 5.10 stated the
    owner's three open calls as settled. *Improvements, all taken:* a first question, whether an
    application should use a part at all, so "lives nowhere" follows from the rule; the boundary
    rule stated as AFD's family, since AFD's own packages are foundations too; the
    command-declared-by-components point tied to the honesty check's own words; Specimen's
    FAST-AF plugin named as the one user of `@command`; the view-state row marked as proposed,
    with the two applications' current wiring as its evidence; the epic lines; the order of the
    decisions; and this entry.
- **The amendment of 2026-11-24** (a row and a subsection in section 5.10, an addition to
  question 13), on a branch from `main` at `8c2e1e2a`:
  - *Claims about UI SDK:* each quotation and figure in the subsection was found by a text
    search in the downloaded copy of its documentation for agents, and the version and the
    first publication date were read from the npm registry. Nothing in the subsection rests on
    a summary.
  - *Claims about AFD:* that `violet-elements`' npm package leaves out its pack was read from
    the `files` list of its `package.json`; Loam's three hints from section 11 of its phase 5
    specification, and that its projection is not started from Loam's status file.
  - *The owner's answer* is quoted whole in question 13, after the question and its stated
    confidence, also quoted.
  - *Links:* a throwaway script resolved every relative link and anchor in the proposal and in
    this file, and found none broken.
  - *The verify plan:* `pnpm verify --list --files` on both files printed "no packages
    affected" and "no path-filtered workflow is triggered".
  - *Independent review:* two fresh read-only reviewers on one brief, Claude Opus 5.5 at
    `high` and Gemini 4 Neon at `high`, given the question, the owner's reply and the
    downloaded documentation. Both said revise. *Blockers, all fixed:* the subsection said
    nothing runs without the component on the screen, where a step opens a closed tab or
    section to reach one; it gave every package a skill, where only `@ui-sdk/core` carries
    one; a quotation ended on a full stop the source does not have, and left out the
    arguments the bridge does check; the open point was worded three ways, as commands
    inside `afd-view-state` only, and its code was assigned to #2275, whose scope covers
    neither the reading nor the filling; and this file's row said "not merged".
    *Improvements taken:* that the `agent` key is optional and experimental; what `allow`
    does with a confirmation's text; "registered" components and the snapshot's limit; that
    its history can undo an agent's changes; "a published design close to" in place of "the
    nearest"; Loam's projection stated as specified and not started; the paragraph on what
    is out of scope moved above the subsection and extended to the new row; how much of the
    screen an agent sees named as open; the question quoted as it was put; this decision in
    the list of the owner's decisions and in the proposal's section 6; and that the
    documentation carries no version number. *Not taken:* an entry in "Last verified" and
    the additions first made to the State line and to the row for the owner's answers, which
    are lines every pull request to this file would edit; this entry and the step's own row
    carry them.
- **The amendment of 2026-11-24, later** (the owner's clarification under question 13, and
  the 5.10 row and section 6 pointed at the Controls proposal), on a branch from `main` at
  `8347a597`:
  - *The owner's clarification* is quoted whole in question 13, and what the session reads
    into it is marked as the session's.
  - *Links:* the throwaway script, over the proposal and this file, found none broken.
  - *Review:* with the Controls proposal, in its pull request.

## The runner

Written 2026-11-15 against `4a77c273` on the second machine, in a local repository on its
external drive with no remote. It is committed to this repository with the held material after
the last run of phase 0. What it does, without its check matching:

- **A session's tree** is a plain export with a fresh one-commit history and none of the
  repository's, from the pinned commit, not a git worktree, whose history would let `git show`
  read every screen's task and this folder without a path outside the tree. The export loses
  this folder except the files the arm reads ([bench.md](bench.md#what-a-session-is-given)),
  the other screens' scenario files (all of them for the bare arm), the seed library's tests,
  which read every task and result, and the features index's row for this proposal, and a
  tooling test that names the tasks; the builder's extract is written at its path. A guard
  fails the setup if another screen's file or name, a held file's name or a mention of the
  bench in the extract is left. The session's folder has an opaque name, because a session sees
  its working directory.
- **A build session** is `claude -p` on Opus 5.5 at `medium`, streaming JSON, six built-in tools
  (read, search, write, edit and an allowlist of shell commands), no skills or commands, and a
  strict MCP configuration that holds only Umbel's components brief. Arm 1 is given its
  plugin's `SKILL.md` as a file to read and follow, since the Skill tool is off for every arm.
- **A wall and a check.** Each session runs inside a macOS sandbox profile that refuses reads
  of the held folder, the runner, every other checkout of the repository and its git directory,
  the parts of the scoring checkout that name the bench, other sessions' folders, and saved
  transcripts and scratch of other sessions on the machine. The leak check then searches every
  tool call's input, and every tool result, for the held folder's path and its files' names,
  and every file path, shell path and path in written content for one outside the session's
  tree and its own material. A run with one is thrown out, its cost kept in the ledger, and run
  again, at most twice; a third stops the runs.
- **The budget** enters each session in a ledger at its most, twice its line, before it starts,
  and at its reported cost at list prices when it ends; a session that reports no cost stays at
  its most. No session starts that could take the week's spend past the cap, a dollar figure set
  from the pilots, which has no default. On 2026-11-21 the owner set it at $50 at list prices in
  all for step 0.1's first fifteen builds. They were to give the share of the allowance a dollar
  takes, after which the cap becomes the fifth of a week, converted; they did not
  ([Step 0.1](#step-01)), so the cap stays a dollar figure the owner sets. A session that reports more than twice
  its line, or no cost, stops the runs. One runner runs at a time. The week starts at the
  allowance's own reset, read from the owner's screenshot on 2026-11-15 and corrected to 04:00
  on 2026-11-21. The owner confirmed on 2026-11-15 that the weekly figure is the share left. The
  plan was to read it before and after step 0.1's first fifteen builds; it was not read after
  them (nor before the pilots), so no reading yet gives the conversion.
- **Scoring** loads the checks only after stage 1's manifest verifies, refuses a control
  character and compiles every pattern. A story's mount, console and settled accessibility
  check come from Specimen's own run. What Specimen's capture does not carry, the runner
  reads from a second render of the story, from Specimen's static build in the Chromium
  Specimen pins, in UTC and `en-US`; each verdict notes any role and name the two renders do
  not share. Where the frozen rules leave a choice, the runner records the choice it took,
  applied to every arm alike, and those are committed with the record. One, put to the owner,
  was settled on 2026-11-15 as recommended. The bare arm is never told the states' names, so
  its builds are matched to states by its reader and not scored by name.
- **Animation settled.** A story is rendered for its checks with Specimen's `motion: 'settled'`.
  Without it, the accessibility check after the story settles could sample a component's entry
  animation inside a shadow root part-way and report a contrast failure that is not there once
  it ends; a story failed three times in three without it and passed three times in three with
  it (2026-11-15). Every arm is rendered the same way.
- **Neighbouring proposals,** Patterns, Design Decisions, Screens from Jobs, Pointing, Scales
  and Component Briefs, discuss result states and design review. As first written, the runner
  left them in every arm's tree and counted reads of them. The owner decided on 2026-11-15 to
  remove them, with their rows in the features index, so that arm 0 has nothing beyond the
  brief; the guard fails a setup that leaves one, and the runner still counts any attempt to
  read one.
- **Checked on 2026-11-15** on the second machine, with no building session: stage 1's manifest
  verified and the 308 checks loaded; 23 unit tests passed; an invented story scored against
  invented checks through Specimen gave the expected verdict on all 38; dry runs with a
  stand-in for `claude`, inside the sandbox, ran clean on three screens and the three arms that
  are ready and threw out and reran four planted leaks; a story file with no stories passed
  none of T1's checks; and the sandbox refused each place it closes and served the components
  brief. Umbel's components server and Specimen's host were built for the pinned commit, their
  Rust intermediates on the external drive.
- **Independent review, 2026-11-15:** a fresh reviewer on Claude Opus 5.5 read the runner
  against the frozen rules, this folder's specification and Specimen, and reproduced its
  findings by running the code. Two blockers: the probe read some page text differently from
  how a person reads it, which scored real screens wrongly both ways; and the leak check could
  be passed by a script the session wrote, a path in another case, a shell variable or a
  relative pattern. Both were fixed, the second with the sandbox as a wall under the check. Of
  eight improvements, seven were taken: false positives that would throw out honest runs, the
  budget's reserve and its unknown costs, the bare arm's builds kept out of scoring by name, a
  gap in the accessibility check, content naming other screens, the pinned plugin's hashes, and
  smaller choices; the eighth became a question for the owner. A focused second pass by the
  same reviewer found seven fixed, three fixed in part and no new blocker; the three parts were
  then closed, the widest by walling off the rest of the scoring checkout that names the
  bench's jobs and results.
- **The smoke session,** at the owner's word: one `claude -p` call with the runner's flags,
  asked for a word in a file, reported $0.055 at list prices, with the components server
  connected and a clean leak check. Its tool list showed that a headless session also had
  messaging to other sessions on the machine, schedules, worktrees and the built-in skills,
  among them one for design, which would have reached every arm; the runner now names its
  tools and turns skills off.
- **A second smoke session,** at the owner's word on 2026-11-15, ran with those flags inside the
  sandbox. Its first attempt stopped before reaching the model, because the profile hid a
  folder Claude Code needs; such folders now stay visible with every other session's entries in
  them refused, and a session that never reaches the model is entered in the ledger at $0. The
  second attempt had the six tools and the components server's tools and nothing else, called
  the brief directly, had its read of a planted file in another session's folder refused and
  found by the leak check, and reported $0.119 at list prices.
- **Walks and readers,** written 2026-11-18 with no model session. A walk's only tools are an
  MCP server of the runner's on Playwright, not Botcore's `cdp_*` commands, which keep no window
  size from one call to the next and cannot click without naming an element. Each modality
  perceives and acts as its card says; the screen reader keeps a reading cursor over the
  accessibility tree, with browse and forms modes, and hears live regions as they change, in the
  page and, since 2026-11-21, inside components' shadow roots. Looking is free, a screen
  reader's reading moves included; acting counts toward the cap. The reading of a path for step
  0.4 counts each command once. The readers have no tools and answer in JSON. A script did every
  walked job through every modality's tools: on the clean build all 16 finish with a clean path,
  in at most 19 actions of 60; on the seeded build each fault stops only its own modality's
  script. Before walking, the runner proves each build with the faults' proofs. An independent
  reviewer on Claude Opus 5.5 found one blocker (typing could carry a key press a pointer
  persona does not have) and seven improvements; all were fixed and a focused pass confirmed
  them. Where the tools depart from the frozen cards is recorded beside them in the held folder.
- **The reports and statistics,** written 2026-11-21 and tested on invented runs: each step's
  report from 0.1 to 0.4, step 0.2's permutation test (arm labels shuffled within each screen,
  exact when there are few arrangements), and step 0.1's question of whether fifteen runs
  resolve 15 points, simulated from an arm's own runs. None decides "go"; each sets the figures
  beside its rule for the owner.
- **Not written:** arm 2's
  statements and their wiring into the brief, which Umbel can now serve (#1394); and arm 3's
  skill.

## The pilots

Run 2026-11-20 on the second machine, at the owner's word, under a cap of $15; none counts in a
result. Costs are at list prices, as each session reports them.

| Session | Cost | Turns | Time | Result |
| --- | --- | --- | --- | --- |
| Build, arm 0, T1 | $1.40 | 19 | 4 min | 78 of 83 checks |
| Build, bare arm, T2 | $1.66 | 27 | 6 min | 8 of T2's 13 states have a story, by its reader the next day (ruling 3's question); 28 of 83 checks, as a diagnostic |
| Walk, a pointer persona, T1, clean build | $0.17 | 9 | 21 s | Job done, clean path, 7 actions of 60 |
| Walk, the screen-reader persona, T4, clean build | $0.44 | 141 | 2.5 min | Job done, clean path, 8 actions of 60; its reading moves are free, so most turns are not actions |
| Reader of the bare build, 2026-11-21 | $0.18 | | | 8 of the build's 14 stories matched to a state; a fifth session outside the 209 |

- **The two builds are not comparable:** different screens and arms. Each is one run, and
  neither counts in a result.
- **Against the budget's lines:** the builds averaged $1.53 against a line of $1.50, one above
  it and one below; a walk came in at a tenth to a third of its $1.50, so the walks' line is
  high; the reader at about a third of its $0.50. No session reported more than twice its line,
  and the leak check found nothing.
- **A departure from the Budget: no conversion.** [bench.md](bench.md#budget) has the weekly
  figure read before and after the pilots. It was not read before them, so whether they moved
  it is unknown, and they do not give the share of the allowance a dollar at list price takes.
  In its place the owner agreed on 2026-11-21 to apply the Budget's fallback: step 0.1's first
  fifteen builds are the measurement, under a cap of $50 at list prices, with the figure read
  before and after them, and the runs pause there for the owner. (It was not read after them;
  see [Step 0.1](#step-01).)
- **A walk's path and its report are separate:** the path is read from the application's
  journal, so a walk can finish its job with a clean path while its persona reports trouble on
  the way.
- **The runner, fixed after them:** a walk's ending was read from only the start of the
  persona's last message, so two walks that ended "Done." read as unsaid; and scoring every run
  took walks for builds. Both fixed, the two records read again.
- **The screen reader, widened after them:** the pilot walks heard live regions in the page
  only. On 2026-11-21 the walks' screen reader began hearing them inside every shadow root,
  open or closed, and reading text through slots. Checked on an invented page with an open
  root, a closed root and slotted text, which the old observer fails and the new one passes;
  the scripted walks still finish 16 of 16 on the clean build and 9 of 16 on the seeded one.
- **The reference build, changed after them** at the owner's word: the pointer persona took a
  refusal's feedback for a success. The feedback was corrected in the reference build and in
  the seeded copy, beneath its fault commits, which are unchanged. On 2026-11-21 every fault's
  proof ran three times on each build with the results of the freeze, the reference build
  passed 308 of 308, and the scripted walks finished as before. Stage 2 lets a pilot walk change
  the runner, the cap or the budget's figures; this change to the build is the owner's, and the
  frozen files are as they were.
- **Found outside the runner:** the scoring checkout's two Rust builds at `f4eeba0c`,
  Specimen's host and Umbel's components server, were deleted on 2026-11-20 after the pilots,
  by something other than the runner, and were rebuilt from the locked sources on 2026-11-21.
  The runner now refuses to start build sessions or score when either is missing. It happened
  again on 2026-11-23, and the cause was found on 2026-11-24 ([Step 0.1](#step-01)).
- **Issue [#1699](https://github.com/lushly-dev/afd/issues/1699),** filed at the owner's word on
  2026-11-20: a browser app with AFD's approval middleware is blank when opened over plain HTTP
  from another device on the network. The owner's look at the reference build from a phone met
  it; the walks serve the build on the machine itself and are not affected.

## Step 0.1

The first fifteen of its 45 builds ran on 2026-11-21 on the second machine, at the owner's word,
under a cap of $50 at list prices: arms 0 and 1 and the bare arm, T1 to T3, in turn, so that
each screen and arm had its first run before any had a second. T1 and T2 have two runs an arm,
T3 one. The runs then paused for the owner, as the Budget says. On 2026-11-24 the builds were
scored, a reader ran for each bare build at the owner's word, and the runner wrote the step's
report. Shares are of a screen's checks passed; a bare build is scored on how many of the task's
states have a story, by its reader (ruling 3), with its checks only as a diagnostic.

| Arm | T1, 83 checks, 14 states | T2, 83 checks, 13 states | T3, 62 checks, 10 states | Mean share | Cost |
| --- | --- | --- | --- | --- | --- |
| Arm 0 | 100.0 %, 97.6 % | 98.8 %, 97.6 % | 80.6 % | 94.9 % | $7.68 |
| Arm 1 | 98.8 %, 90.4 % | 85.5 %, 97.6 % | 83.9 % | 91.2 % | $8.11 |
| Bare, states with a story | 12, 13 | 9, 9 | 10 | | $7.72 |
| Bare, checks as a diagnostic | 59.0 %, 65.1 % | 38.6 %, 30.1 % | 61.3 % | | |

- **Both arms already pass nine checks in ten.** Step 0.1's row in the
  [rules for "go"](bench.md#rules-for-go) leaves it to the owner whether to go on when arms 0
  and 1 do, since a default then has little to fix (decided 2026-11-24: the step ends here,
  below). The mean in the table is over runs, so T3's
  one run weighs half what T1's or T2's two do; averaged by screen, arm 0 is at 92.5 % and arm 1
  at 90.0 %, on the line. The rule reads the whole step; these are the first five runs an arm.
  T3 is where both fall short.
- **Whether fifteen runs resolve 15 points:** the report's simulation says they do, for both
  arms, in every simulated study, and the figure answers nothing yet. It adds the gain to a
  share and caps it at 100 %, so arm 0's T1 and T2 runs, at 97.6 to 100 %, take a simulated gain
  of at most 2.4 points, not 15, and T3's single run an arm has no spread at all. The ceiling is a separate question
  from power: at arm 0's mean of 94.9 % over runs, or 92.5 % by screen, a perfect arm 2 could
  gain 5.1 to 7.5 points, short of the 15 that step 0.2's rule asks. Once each arm has five
  runs a screen, the two means agree.
- **Cost:** the fifteen counted builds $23.51, $1.26 to $1.83 each, a mean of $1.57 against a
  line of $1.50, none past twice it. Two more builds cost about $2.16 and count in nothing. One
  was cut off when the program hosting the runs restarted; it never ended, so it reported no
  cost, and about $0.60 is an estimate. The Budget says a session that reports no cost stops
  the runs; the session running the builds read that as not meeting a session the runner
  itself lost, and restarted the runs at once without asking the owner, so the reading was the
  owner's to confirm (superseded: the owner accepted it on 2026-11-24, below). The runner's own ledger rule counts such a session at its maximum,
  $3.00, which would put the week at $28.93 rather than $26.53, still under the cap. One was
  thrown out by the leak check, at $1.56: a shell command named the session's own folder,
  above its tree, and Claude Code refused it, so nothing was read. Each was run again. The five
  readers cost $0.86, none past twice their line, $26.53 in all that week with the estimate.
- **No conversion, a second time.** The builds began just after the second machine's weekly
  reset, so the weekly figure stood at a full week before them. It was not read when they
  ended, and other sessions on that machine used the allowance in the days before anyone
  looked, so the fifteen builds do not give the share of the allowance a dollar takes. How to
  measure it was the owner's (superseded: on 2026-11-24 the owner decided not to measure it
  again for now, below).
- **The scoring checkout, stripped again.** On 2026-11-23 the scoring checkout lost its
  packages and builds as well, and on 2026-11-24 the cause of both losses was found: Botcore's disk cleaner,
  run by other sessions on the second machine, strips build output from linked worktrees, which
  the scoring checkouts are. The checkout was rebuilt from the locked sources on 2026-11-24 and
  scores the reference build 308 of 308, and it is now kept from every `disk-*` action with
  `botcore disk-keep`.
- **The owner's look, again,** on 2026-11-24: every state on the reference build's screenshot
  page looked right, none marked. That page was made on 2026-11-16, before the theme changed with
  the pin and before the refusal change of 2026-11-21; the owner approved the build on a phone
  on 2026-11-18, before that change. Its screenshots were taken again from the current build.
- **The owner's decisions after it,** on 2026-11-24: the step ends at its first fifteen
  builds, which are approved ("more interested in that we have proven the process than these
  specific pages"; "the agents did a good job of making it very shippable. Tuning is just on
  top"); the weekly figure is not measured again for now, so caps stay dollar figures the owner
  sets; the reading that the no-cost stop does not meet a build cut off from outside is
  accepted, and that build counts at its $3.00 maximum, putting the week at $28.93 before the
  walks; and steps 0.2 and 0.5 wait until after the walks.
- **Records:** the runner's ledger, run folders and report, committed with the record after
  phase 0.

## Steps 0.3 and 0.4

Run on 2026-11-24 on the second machine at the owner's word, under $50 for the batch, after a
dry run of all of it with a stand-in for the model: five personas (two pointer, keyboard only,
screen reader, low vision) walked each screen's job twice on the seeded build and once on the
clean one, 60 walks, then a reader matched each seeded walk's findings to the planted faults,
40 readers. Both builds were proved first: the seeded one carries all twelve faults, the clean
one none. The walks cost $16.28 (none over $0.56) and the readers $1.92, $18.20 in all, with no
stop, throw-out or error; the week stood at $47.13. The owner's aim for the panel, given that
day: to catch the 85 to 95 % case and anything blocking, with people's feedback over time for
the rest, not to replace human review.

- **Step 0.3, met.** The panel found 12 of the 12 planted faults (the rule asks 8), 12 in its
  first walks alone and 11 in its second. Each modality's own persona found all 3 faults aimed
  at it, so two of three is met by one persona alone, as confirmed, and by the modality's
  personas together.
- **Its check, by an independent reviewer.** On 2026-11-24 the owner delegated the sample
  check to an independent reviewer on GPT-6.2 Astra, in place of making it by hand. Astra at
  `high`, a model family apart from the readers' (Claude Opus 5.5), judged from each walk's screenshots, or what
  the screen reader said, and the persona's report, seeing the readers' reasons for the 20
  matches (so those may lean on them) and not for the 30 other findings: 20 of the 20 sampled matches right, and 23
  of the 30 sampled other findings real (the rule asks half). Three of those 23 are planted
  faults the readers had not matched. Five
  of the seven not real compared the application's fixed clock, set years ahead, with the
  persona's own date. The material went to that machine outside any checkout and was removed
  after.
- **Step 0.4, not met.** Of the 13 persona and job pairs that meet a fault, 3 had a path worse
  than the clean one in both seeded walks (the rule asks three quarters); all 7 pairs that meet
  none stayed within the seeded walks' own spread. A likely reason, not shown: the path is read
  from the application's journal and counts only commands, and each fault leaves a way past, as
  designed, so a persona can report a fault (step 0.3) and still send the clean walk's
  commands. The unfinished clean walks on T2, below, also
  leave those pairs no room to be worse.
- **A gap in the clean build.** On T2, three of the five personas left the job unfinished on the
  clean build as well, at the same point, and their reports name what the screen does not
  explain there. It is recorded with the held material, and the reference build is left as the
  walks measured it.
- **What to tune,** from the walks: tell a persona the application's date, since its fixed clock
  made most of the findings that were not real; five walks ended without the word that says
  whether the job was done; the readers missed three findings that were a fault's consequences;
  and step 0.4 needs a measure that sees trouble a persona works around, such as whether a persona's report
  names it.
- **Walk tuning and confirmation rerun (2026-11-24):** the owner agreed ("Agree") to tune the
  walks (tell each persona the application's date, require every persona to say whether it
  finished, and judge step 0.4 by whether a persona's report names the trouble) and rerun 10 to
  15 walks for a few dollars to confirm the changes. The runner was updated without editing any
  frozen stage 2 file (both manifests verify unchanged):
  - *Prompt and ending parser:* each walk prompt now states the application's fixed date from
    the fixture (`9 March 2030`) and asks for `Done.` or `Stopped, because ...` on a separate
    last line after findings. In the same update, the session also widened the ending parser to
    recognise a verdict placed before findings (all five walks counted as unsaid in the 60
    original walks had stated their verdict at the top of their final message).
  - *Fault reader (session addition):* from "What to tune" above, the session also updated step
    0.3's fault reader to match a finding that describes a direct consequence of meeting a
    planted problem. That change was not part of the owner's "Agree" and is for the owner to
    confirm; step 0.3's 12-of-12 result did not depend on it.
  - *Blind pairwise report comparison for step 0.4:* to implement the report-based measure the
    owner agreed to, the runner compares each seeded walk against its pair's clean walk in
    deterministic randomized order, with neither build named and no faults shown, weighing
    completion, observed obstacles (including trouble worked around) and extra steps, and
    judging which walk met worse trouble or whether both were the same. Step 0.4's report now
    shows both the original journal-path rule and this comparison side by side; whether it counts
    for step 0.4's rule is for the owner to confirm at step 0.6.
  - *Confirmation rerun:* 15 walks across 5 persona-and-screen pairs covering all five personas,
    all four modalities and all four screens (four fault-meeting pairs that had all failed the
    path-only rule in the 60 original walks, plus one no-fault pair; two seeded and one clean
    each), 10 fault readers and 10 blind comparisons, after 54 unit tests and a full dry run
    passed and both builds were proved. Because the owner agreed to "a few dollars" without
    naming a figure, the session set a weekly cap of $58 ($10.87 above the $47.13 already spent).
    Cost: $5.43 ($4.48 walks, $0.50 readers, $0.45 comparisons). Results: 15 of 15 walks ended
    on the last line with `Done.` or `Stopped` (0 unsaid); 0 of 15 walks and 0 of 29 other
    findings reported clock or date mismatches; every fault aimed at those pairs was found in
    both seeded walks; in the rerun, the blind report comparison judged seeded worse in both
    walks for 4 of 4 fault-meeting pairs (8 of 8 calls, while the path-only rule caught 1 of 4)
    and not worse in both for 1 of 1 no-fault pair (1 same, 1 clean).
- **Re-evaluating the 60 original walks (run by the session without separate sign-off):** under
  the same $58 cap, the session also ran 40 blind pairwise comparisons across all 20 pairs of
  the 60 original walks, costing $1.79 (bringing the week to $54.35). That extra batch went
  beyond the 10-to-15-walk rerun the owner agreed to, and is noted here for the owner to accept
  or reject. Fault-meeting pairs: 12 of 13 (92.3 %) judged seeded worse in both walks (25 of 26
  individual calls seeded, 1 same, 0 clean; the one pair not worse in both includes the single
  walk that missed its fault in step 0.3). No-fault pairs: 6 of 7 not worse in both (2 seeded,
  5 same, 7 clean); the one exception came from the single clean walk stopping earlier than both
  seeded walks and missing a pre-existing issue present on both builds, showing baseline
  variance when a pair has only one clean walk.
- **Records:** the runner's ledger, walk folders, reports and the reviewer's check, committed
  with the record after phase 0.

## The reference build

Built 2026-11-15 against `4a77c273` on the second machine, in a local repository on its external
drive with no remote, beside the runner and the held material. The owner approved its design the
same day. It is committed with the record after the last run of phase 0. What can be said here,
without its screens:

- **What it is:** the four screens of the seed library, built with `violet-elements`, and one
  story per state of each task, mounting the task's results: 14, 13, 10 and 13 stories. The
  screens run the commands in the page through a DirectClient, as the volunteer or the steward,
  with the journal middleware recording every command, failures included, and a batch recorded
  as one entry with its inner calls. A small server on the loopback address serves it and writes
  the journal; a walk opens it on the screen and starting state its script names.
- **Scored by the runner,** as a session's build is: all 308 checks pass. Building it found two
  problems outside it, recorded as follow-ups: an accessibility check that can sample a
  component part-way through its entry animation, and an alert component that shows a cross
  for every tone at first.
- **Run end to end** in Chromium: one job per screen, as a walk will run it, and the screen's
  other jobs; the journal shows no page error and every command recorded.
- **Reviewed by three models on one brief,** none shown the checks: Codex (GPT-6.1 Sol, at high
  reasoning effort), Claude Opus 5.5 and Claude Fable 5.2 (at their default effort). A fresh
  verifier, on Claude Opus 5.5, checked every finding against the code and screenshots: of 32
  distinct issues, 28 were real, 3 partly and 1 not. The screens' builders fixed the 30 that
  needed a change; one partly real issue needed none in this app. A focused second pass found
  28 fixed, 2 in part and 5 new problems the fixes made, one a blocker; the two partial fixes
  were finished and the five problems fixed, and both were checked.
- **What the reviewers' comparison suggests,** at the owner's request:

  | | Codex | Opus 5.5 | Fable 5.2 |
  | --- | --- | --- | --- |
  | Distinct issues raised | 12 | 19 | 22 |
  | Real or partly real | 12 | 18 | 22 |
  | Real issues no other reviewer raised | 3 | 4 | 7 |
  | Share of the 31 real issues covered | 39 % | 58 % | 71 % |
  | Blockers the verifier also rated blockers | 2 of 6 | 3 of 4 | 3 of 3 |

  All three found the seven largest. Codex's three issues of its own were bugs in data and state
  that neither Claude reviewer found; it rated severity higher than the verifier did. Fable
  covered the most and rated severity as the verifier did; Opus overlapped Fable most. This is
  one build reviewed once by each, at unmatched effort, with a verifier of the same model as one
  reviewer and the same family as two, who knew which reviewer wrote which finding: it suggests that a second family adds findings and that Fable 5.2 is the
  broader Claude reviewer here, and it shows neither.
- **Reviewed again by a panel of five lenses** from 2026-11-15 to 2026-11-16: jobs and ease,
  accessibility, design system, visual design and content. In round 1 Claude Fable 5.2 held
  every lens; from round 2 it kept the visual lens and Claude Opus 5.5 took the other four. Each
  round's reports were merged and checked by a verifier on Claude Opus 5.5, who reproduced every
  blocker in a browser, and the fixes were made on Claude Opus 5.5:

  | Round | Reports | Items once merged | Blockers | Major | Polish | Confirmed | Partly real | Not real |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | 1 | 5 | 72, from 96 findings | 5 | 41 | 26 | 67 | 5 | 3 |
  | 2 | 5 | 71 | 3 | 20 | 48 | 69 | 2 | 2 |
  | 3 | 5 | 57 | 2 | 17 | 38 | 56 | 1 | 0 |
  | 4 | 4 | 30, from 25 findings and 5 notes | 4 | 11 | 15 | 24 findings and the 5 notes | 1 | 1 further note |

  The severity columns count the merged items; the verdict columns count what the verifier
  judged, and an item judged not real was dropped before the merge. Of round 4's eleven notes,
  five became items and one was not real; the rest repeated a finding or a decision, or were
  Violet's own problems. Rounds 5 to 7 checked the
  fixes with four reviewers, then two and two, and round 8 fixed what round 7 found. Most of
  what rounds 3 to 7 found was in how a screen behaves under repeated presses.
- **The owner's look,** on 2026-11-16: all 50 states, 11 marked for a change, 1 marked right and
  38 left as they were. Round 9 answered the 11 in two steps, the layout on Claude Fable 5.2 and the words
  and an accessibility check on Claude Opus 5.5, rewording 46 of the 50 states. One note asked
  for a command the seed library does not have, to add a variety at intake; the owner decided
  it waits until after phase 0 ([#1380](https://github.com/lushly-dev/afd/issues/1380)). The owner
  looked again, on a phone, and approved the build on 2026-11-18.
- **Scored again at each new pin:** 308 of 308 at `c3884d85`, `3ea05bb6`, `42473ccc` and
  `f4eeba0c`, the last with AFD's Refined theme as Violet's default, with every one of the
  build's own scripted runs in a browser clean (no model session).
- **Seeded with the twelve faults** on 2026-11-18, in a copy of the build with one commit for
  each fault, three aimed at each modality. Eight of the twelve were reworded to fit the build
  as it is. Each fault is aimed at one modality and leaves the others a way past it. Before the freeze an
  independent reader on Claude Opus 5.5 ran the proofs and probed both builds. It found three
  blockers (two faults that showed less than their rows said, and one a keyboard user could see
  past) and five improvements, and all were taken. Each proof then ran three times on each
  build: absent from the clean build and present in the seeded one, all twelve, every time.
- **Changed after approval** on 2026-11-21, by the owner's decision after a pilot walk: a
  refusal's feedback corrected in both builds, every proof and check run again
  ([The pilots](#the-pilots)).
- **Not done:** the walks of phase 0. The build and its seeded copy are committed with the
  record after the last run of phase 0.

## What was read to write it

Read at `545316f2`, 2026-11-14:

- **AFD:** the `afd` skill and its references `jobs-first.md`, `command-schema.md`,
  `command-trust-config.md`, `philosophy.md` and `telemetry.md`; `packages/core/src/result.ts`
  and `errors.ts`; `spec/journal.md` and the names of the fixtures in `spec/wire`;
  `packages/view-state/README.md`; the whitepaper's sections 2, 4, 6 and 8; the root README's
  getting-started lines.
- **Proposals:** Patterns and its status in full; Design Decisions' status, sections 1 to 3, 5,
  6.5 to 6.8, 12 and 13; Screens from Jobs' status, sections 1 and 2 in part, and its stated
  limit; Pointing's status and sections 1 and 2 in part; Scales and its status; the Component
  Briefs prototype record's result and consequences; the Agent Engine research's evidence table.
- **Skills and operations:** `manage-skills`, `manage-documentation`, `loam-design` (principles
  and files), `afd-site-design` (head), the components guide, the skills audit of 2026-11-03 and
  the model-routing document's caveat.
- **Units:** the Specimen README (capabilities, hosts, limits), the Violet foundation and core
  READMEs, the Umbel README and the `components` plugin README, the names of `violet-elements`'
  components, and the export names in Loam's `apps.specimens.ts`.

Not read first-hand: Specimen's, Violet's and Umbel's source; Loam's design record; the todo
example beyond a text search of its TypeScript backend; the Python, Rust and C++ result types.

Read from outside the repository, for ideas only: six public design skills at their default
branches on 2026-11-14, and the owner's earlier design-engine brainstorm with its application
specification. No text, identifier or data from the brainstorm is in the proposal.

Read on 2026-11-24, for the amendment of that day:

- **UI SDK, from outside the repository:** the plain-text copy of its documentation for agents
  (`https://ui-sdk.dev/docs/agents/llms.txt`, 98,191 bytes) and its documentation index, and
  the npm registry's record of `@ui-sdk/core` for its versions and dates. Its other sections
  were read through a summarising reader and are quoted nowhere in the proposal. It was not
  installed or run, and its source was not read.
- **AFD:** epic #1385 and its sub-issues #1157, #2275 and #2278; `packages/view-state/README.md`;
  the FAST-AF foundation's and `violet-elements`' READMEs; section 11 of Loam's phase 5
  specification and the line for its step 15 in Loam's status file.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-14 | First draft | A structured recovery on `CommandError` (a command, its input and a label) beside the prose `suggestion`, so an interface can render a button and an agent can call it. A contract change in four languages. The sources also disagree on whether a suggestion is written for a person or names a command | Open; its own proposal if the owner wants it |
| 2026-11-14 | First draft | The confidence bands in `packages/core/src/result.ts:63` say 0.9 or more is "auto-apply safe". Whether a result applies by itself should depend on whether it can be undone. The Python, Rust and C++ copies were not checked | Open; proposal section 5.3 |
| 2026-11-14 | First draft | The whitepaper uses dotted command names such as `document.create`, against the `domain-action` naming rule | Open; worth an issue |
| 2026-11-14 | The owner | The todo example is out of date and should be updated; it is a reference only until then | Open |
| 2026-11-14 | First draft | A newcomer copies skills with `npx degit` (`README.md:457`), which records no version and gives no notice of changes. Botcore's seeded skills carry both | Open; proposal sections 2 and 5.6 |
| 2026-11-14 | First draft | Specimen does not observe animation, so no motion rule can be a gate. A rule about duration or easing stays `authored` | Open |
| 2026-11-14 | Bench specification | No forced-colours emulation exists in Specimen or in Botcore's `cdp_emulate`, so no persona can be held to that modality | Open. Since 2026-11-18 the walks run on Playwright, which can emulate them in Chromium; scoring through Specimen still cannot |
| 2026-11-14 | Bench specification | A screen reader's live announcements are not captured as they are spoken; the bench reads them from the accessibility tree | Superseded 2026-11-18: the walks hear live regions by watching them change, still an approximation; since 2026-11-21 inside components' shadow roots too ([The runner](#the-runner)) |
| 2026-11-15 | The seed library's jobs | The approval middleware caps a hold at 24 hours (`packages/server/src/approval.ts:234`). An application whose approver answers later has to let its own record outlive the hold, and then the `expiresAt` in the refusal is not the one that matters. The bench ties the two and accepts a day | Open |
| 2026-11-15 | Specimen's host on the second machine | Specimen's `build:host` script runs `cargo build --release --locked --target-dir target`, which overrides `CARGO_TARGET_DIR`, so the host cannot be built onto another drive through the documented command. `--target-dir "${CARGO_TARGET_DIR:-target}"` would honour it. Specimen is an imported unit, so the change needs a provenance record | Closed 2026-11-15, not changed. A fix was written and worked on the second machine, and review withdrew it: the pin is deliberate (`3ee8c66b`), worktrees often share one `CARGO_TARGET_DIR`, where the last host built would serve every worktree, and Loam's status says not to set it for Specimen's host. Cargo's `build-dir` already puts the intermediate files on the external drive there; the binary in the checkout is 13 MB |
| 2026-11-15 | Specimen's host on the second machine | On a fresh install Specimen's suite fails in `src/bench-worker.test.ts` until `pnpm -F "@lushly-dev/specimen-cli..." build` has run. CI builds first; the README's paragraph on `test:browser` does not say so | Closed 2026-11-15: the paragraph says so (#1237) |
| 2026-11-15 | The bench's result fixtures | A command's `confirmPrompt` is a fixed string on its definition, so a confirmation cannot name what it is about: which variety is retired, which date's requests are removed. A screen shows the record beside it | Open |
| 2026-11-15 | The bench's result fixtures | The approval middleware's suggestion on a hold also says "the application retries the same call once it has recorded the approval" (`packages/server/src/approval.ts:491`). An application that makes the approved thing another way, as the bench's `request-decide` does, cannot correct that half either | Open |
| 2026-11-15 | Independent review of the seed library's jobs | No default pattern covers the approver's side of an approval: the list of held calls, with approve and decline. The proposal's section 5.2 has the requester's side only | Open |
| 2026-11-15 | The seed library's jobs, the calling-agent walk | The approval middleware's refusal says "Ask the user to approve" (`packages/server/src/approval.ts:495`). Where the approver is somebody other than the user at the client, as a steward is to a desk volunteer, that sends the caller to the wrong person; the application can only add to the text through `summary` | Open |
| 2026-11-15 | The seed library's jobs | A scenario cannot assert `warnings`, `alternatives`, `sources`, `plan`, `undoCommand` or `undoArgs`, the fields five of the ten default patterns render. The first three are a known limit in the jobs-first guide; the last three are not listed there | Open |
| 2026-11-15 | The seed library's application | The scenario runner resolves a step reference only in `input` (`packages/testing/src/runner/scenario-runner.ts:308`), but `scenario validate` and the dry run accept one inside `expect` without a word, and it is then compared as literal text. Three of the seed library's steps were written that way and passed every check until they ran. Either the runner resolves them in `expect` too, or validation refuses them, and the jobs-first guide says which | Open; worth an issue |
| 2026-11-15 | Independent review of the bench specification | Botcore's `cdp_emulate` takes `user_agent` and `cpu_throttle`, reports them as emulated with "(requires CDP)" and applies neither (`endpoints/botcore/src/botcore/commands/cdp/diagnostics.py:201`) | Open |
| 2026-11-15 | The bench's runner | Specimen's capture records each element's role, name and focus but not everything the checks read, so the runner renders each story a second time. A capture channel for the rest would let it render once; what it needs is recorded with the runner | Open |
| 2026-11-15 | Independent review of the bench's runner | One way a build can render a control is scored strictly until the owner decides how the frozen checks read it. The question, which would give away a check, is kept with the held material and put to the owner directly | Closed 2026-11-15: the owner settled it as recommended, and the runner records the reading with the held material |
| 2026-11-15 | The bench's reference build | `violet-alert` registers its tone icons in `connectedCallback` after `super.connectedCallback()` has rendered its template, so the first alert of each tone shows the icon registry's fallback, a cross (`foundations/fast-af/packages/violet-elements/src/alert/violet-alert.ts`). Registering before rendering fixes it. Violet is an imported unit, so the change needs a provenance record | Open; worth an issue |
| 2026-11-15 | The bench's reference build | Specimen's settled accessibility check can run while a component's entry animation inside a shadow root is still under way, and report a colour-contrast violation that is gone once it ends: a story of a dialog failed it three times in three and passed three times in three with `motion: 'settled'`. Either the settled check should wait for animations in shadow roots, or settledAccessibility should imply settled motion | Open; worth an issue |
| 2026-11-15 | The bench's runner, the smoke session | Proposals that discuss result states and design review (Patterns, Design Decisions, Screens from Jobs, Pointing, Scales, Component Briefs) are in every arm's tree. The runner counts reads of them; whether to remove them is the owner's call | Closed 2026-11-15: the owner decided to remove them from every arm's tree, and the runner does |
| 2026-11-21 | The pilots | The scoring checkout's Rust builds (Specimen's host, Umbel's components server) were deleted on 2026-11-20 by something other than the runner; the cause is unknown. The runner now refuses to start build sessions or score without them | Closed 2026-11-24: Botcore's disk cleaner, run by other sessions on the second machine, strips build output from linked worktrees, which the scoring checkouts are. The checkout in use is now kept with `botcore disk-keep` |
| 2026-11-24 | Step 0.1 | The leak check throws out a build whose shell command names the session's own folder, the one above its tree, though Claude Code refuses the change of directory and nothing is read: one build of the first fifteen, $1.56, went that way | Closed 2026-11-24, not changed: that folder also holds the session's server configuration and sandbox profile, so the check is right to count it. A throw-out for this cause counts toward the runner's limit like any other: a run thrown out a third time stops the runs |
| 2026-11-24 | Steps 0.3 and 0.4 | A persona is not told the application's date, so it compares the fixed clock with its own and reports dates as wrong: five of the seven findings judged not real in the sample. The persona prompt could name the date. Changing it is a change to the walks, for the owner | Closed 2026-11-24: by the owner's decision, the runner's walk prompt now gives the fixture's date (`9 March 2030`) without editing frozen stage 2 files; 0 of 15 rerun walks and 0 of 29 other findings reported clock mismatches |
| 2026-11-24 | Steps 0.3 and 0.4 | Step 0.4's path, read from the journal, counts only commands and may not show trouble a persona reports but works around, a likely reason its rule was not met (3 of 13). A measure that does, such as whether a persona's report names the trouble, is the owner's to choose | In progress: the owner agreed on 2026-11-24 to judge step 0.4 by whether a persona's report names the trouble; the runner implements a blind pairwise report comparison reported beside the journal-path rule (4 of 4 fault-meeting and 1 of 1 no-fault on the 15-walk rerun; 12 of 13 and 6 of 7 on the 60 original walks). Whether it counts for step 0.4's rule waits for step 0.6 |
| 2026-11-24 | The comparison with UI SDK | UI SDK's benchmark task is public (`benchmarks/agent` in `vercel-labs/ui`): one settings screen, where its bridge took 2 tool calls and 21.8k tokens. No AFD application has been measured on it, so that commands need fewer calls than a bridge is reasoning, not a result. Running the task against an AFD application through its commands would measure it | Open; the owner's call |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-14 | First draft | A discussion with the owner that began as a new design skill. Six public design skills were compared. A self-review found that the first plan had ignored the five design proposals and the skills audit, and it was redone against them. The owner then set the direction: AFD fixes the architecture, Violet included, and ships defaults a product can customize, replace or add to; the aim is to change how applications are built with agents, not to fit older toolchains; guidance may start as a skill and move into Umbel, as copy voice will; agents and simulated users review early, and a person reviews the final change and decides when agents split. The owner's earlier brainstorm supplied the persona panel, the decision card and the rule that a panel gives coverage, not votes. The proposal and this file were written and the links checked |
| 2026-11-14 | First draft, continued | The owner answered question 1: agreed. On question 2 the owner said a pattern is a copy, and that something managed centrally would be a component. No ruling yet |
| 2026-11-14 | First draft, continued | The owner ruled on question 2: copying, because a person or an agent can look at what changed upstream and take it after review, where layering could change a product unexpectedly. Section 5.1 was rewritten around copying, and the lines that depended on layering were changed: two draft jobs, the decision card, sections 5.6 and 5.7, the Patterns amendment, phases A and D and one risk. The first draft's layering recommendation is kept in 5.1 as considered and dropped |
| 2026-11-14 | First draft, continued | The owner ruled on the point question 2 left open: a product that changes nothing names the defaults at a version, and does not copy the whole set |
| 2026-11-14 | First draft, continued | The owner asked for it to be committed and merged, and answered questions 3, 5, 6 and 12: agreed, agreed, agreed, and run phase 0. The owner asked for a proposed rank of the jobs, which is in the proposal's section 4 and not yet confirmed. `main` was merged at `dd080235`, which moved Component Briefs to `complete/`, and two paths were corrected. An independent review raised four blockers and eleven improvements; all four blockers and the improvements were applied |
| 2026-11-14 | After the merge of #1223 | The owner confirmed the rank of the jobs as proposed. Section 4 of the proposal now carries it: job 3 merged into job 2, job 11 folded into job 10, job 13 deferred and job 15 added, with the numbers kept. The bench specification was drafted as step 0.0 of phase 0: a seed library, four screens of which one is held back from whoever writes the statements, 209 sessions, an estimate of about $260 at list prices with a proposed cap of $400, rules for "go", and four points for the owner. Checking it settled one point the proposal had left unverified: Botcore cannot emulate forced colours |
| 2026-11-15 | Bench specification, after the owner's reply | The owner decided that the bench's sessions run on a second machine, on its subscription allowance, and take a small share of a week's allowance. That machine is an Apple silicon Mac, which Specimen supports, so scoring runs there too and the question of where to score is settled (superseded: it was not a ruling of the owner's, and it holds only once Specimen's host builds there; see item 4 of For the owner in the bench specification). The budget's cap became a share of the week, proposed at a fifth and open (superseded by the next row, where the owner accepted the fifth), with the pilots measuring what a session takes. A section on when the bench runs was added: phase 0 once, and afterwards only on a named event |
| 2026-11-15 | Bench specification, the owner's second reply | The owner accepted three recommendations: no more than a fifth of the second machine's weekly allowance in any one week, the seed library, and a bare arm in step 0.1. The owner noted that another session runs on that machine, and asked for a commit and a pull request after an independent review. The review found that the files claimed more approval than the owner gave, that a figure from Component Briefs was misattributed, and that several rules for "go" could not be computed. The six blockers and the improvements were fixed. A second pass found one more place that called scoring settled and ten smaller points, and those were fixed too. The rules for "go" stay unconfirmed (superseded: confirmed on 2026-11-21, in the row of that date) |
| 2026-11-15 | After the merge of #1234 | The owner said to start the bench. The seed library's jobs and commands were drafted jobs first: 17 jobs as scenario files across the four screens and 22 commands, with two fixtures of invented data. Writing them changed the sketch: asking the steward is a held `loan-create` and not a command of its own, every mutation with a way back got its command, and warnings now arise on the held-back screen. Three readers then walked the paths, and their findings added two commands, gave donations a way back, and stopped the design leaning on the host for things it does not do. The scenario checks pass on the result. A read-only check of the second machine's tools was started |
| 2026-11-15 | Specimen's host on the second machine | At the owner's word, a session on the second machine built Specimen's host with its Rust output on the machine's external drive, as the owner asked. The host rendered a specimen and Specimen's suite passed, so the bench can score builds there. Two follow-ups are recorded: the build script ignores `CARGO_TARGET_DIR`, and the suite needs the TypeScript build first |
| 2026-11-15 | Specimen's build script | The owner agreed to make `build:host` honour `CARGO_TARGET_DIR`. The fix worked on the second machine, and an independent review then found that it undoes a deliberate pin and lets worktrees that share a target directory use each other's host. It was withdrawn: the machine's cargo `build-dir` setting already keeps the build's bulk on the external drive. Specimen's README now says its suite needs the TypeScript build first |
| 2026-11-15 | The bench's tasks | The owner accepted three design points of the seed library: approval as a held loan, job 16, and the approval request off T4. Each screen's task and the results that force its states were drafted, 50 states and 74 results, after a review found that the first version hinted at the design, let the bare arm read the states, and could not mount a whole screen. `bench.md` now says what each arm reads. The owner allowed fixes and merges on green without asking |
| 2026-11-15 | The seed library's application | The application was built in `packages/examples/seed-library` from the drafted commands: 24 commands with schemas, an in-memory store with a fixed clock and counter ids, the approval hook that records a held loan as a request, and the steward's middleware. The scenario files moved beside it. All 113 steps pass, jobs 12 and 16 over MCP with confirmations enforced; three steps that compared with an earlier step inside `expect` now name ids. The 74 results pass the output schemas unchanged. `seed-library.md` records what building it settled. Not merged |
| 2026-11-15 | The seed library's application, after review | An independent review found that a DirectClient approving its own hold could lend rare seed; `loan-create` now refuses rare seed, which leaves only through `request-decide`. The test actor is no longer the steward, a reopened request cannot make a second waiting one, and the bench's results and tasks now select the package's tests. Not merged |
| 2026-11-15 | The bench's held material | The owner agreed to keep the held material in a private folder on the second machine's external drive and to write it before the runner and the reference build. It was written outside the repository: checks for every state, twelve faults, five persona cards, a walk script for each screen and two held-back jobs. Two reviews changed it: the faults, cards and walks now wait to be frozen until the reference build exists, the held-back jobs were replaced, and the checks were tightened. The checks and the held-back jobs were frozen, their manifest's hash recorded here, and the folder placed on the second machine. `bench.md` now proposes how step 0.4 reads a path |
| 2026-11-15 | The bench's runner | The owner approved the runner's design, building Umbel's components server on the second machine, and one smoke session. The runner was written there outside the repository, as the held material is: a session's tree is a plain export with a fresh one-commit history and none of the repository's, pruned to what its arm reads, in a folder with an opaque name; the leak check, the budget's ledger and gate, and the scoring of the checks through Specimen with a second render for what its capture lacks. The smoke session cost $0.055 and showed a headless session's default tools reach other sessions and built-in skills, so the runner now names six tools and turns skills off. An independent review found two blockers, in how the probe read some page text and in what the leak check missed, both fixed, the second with a sandbox under every session, and eight improvements, seven taken and one put to the owner. Walks, readers and statistics are not written |
| 2026-11-15 | The bench's runner, the owner's decisions | The owner agreed with the four recommendations put after #1253: a second smoke session, which ran and cost $0.119 once the sandbox let Claude Code start; the open question on reading one kind of control, settled; the neighbouring proposals removed from every arm's tree; and the week's reset taken from the owner's screenshot |
| 2026-11-15 | The bench's reference build | The owner approved the reference build's design and a reviewer of another model family, and asked whether that reviewer adds new insight and how Opus 5.5 compares with Fable 5.2. The build was written outside the repository: four screens, their stories and the running app with its journal, passing all 308 checks and running each walked job end to end. Three reviewers (Codex, Opus 5.5, Fable 5.2) reviewed it on one brief; a verifier checked their findings, the 30 that needed a change were fixed, and a second pass checked the fixes. The runner now renders stories with animation settled. The comparison is in the reference build's section. It waits for the owner's look (superseded: the owner looked on 2026-11-16 and approved the build on 2026-11-18, in the rows below) |
| 2026-11-16 | Where the parts live | A review of what FAST-AF added for AFD found its command layer and trust fields unused, and that Loam and Lushly render results in the application and build the same pieces themselves. The owner set the test for the component layer, asked for the plan as epic #1385 and for this amendment: section 5.10 places each part (presentation in `violet-elements` with plain properties, normalisation in AFD's browser client, wording in the application, interface state in `afd-view-state`), section 2 gains the two facts, and question 13 records the decision. Nothing was built |
| 2026-11-16 | The reference build's panel and the owner's look | A panel of five lenses reviewed the reference build in rounds 1 to 4, and fewer reviewers checked the fixes in rounds 5 to 7; round 8 fixed what round 7 found. Most of it was how a screen behaves under repeated presses. The pinned commit moved to `c3884d85`. The owner looked at all 50 states and marked 11, and round 9 answered them. Counts are in the reference build's section; nothing here quotes the screens |
| 2026-11-17 | Arm 2's delivery, and a variety at intake | The owner agreed to land arm 2's delivery before step 0.1 (#1394): a consumer profile's statements are served once in every brief for that consumer, never shed, with briefs byte for byte unchanged when none is set. The pinned commit moved to `3ea05bb6`. The owner decided the bench gains no command to add a variety in phase 0 (#1380) |
| 2026-11-18 | The faults, and the freeze of stage 2 | The pinned commit moved to `42473ccc`, then to `f4eeba0c` with AFD's Refined theme as Violet's default; the checks stand and the reference build passes all 308 at each. The owner looked at it again on a phone and approved it. The twelve faults were planted in a copy, eight reworded to fit the build, and each proof ran three times on both builds with the expected result every time. An independent reviewer read the faults, proofs and walks, stage 2 was frozen, and its manifest's hash recorded here. `bench.md` now says stage 2 was frozen before any walk, the pilots' included, as the held material's own record says. Recorded in #1574 |
| 2026-11-20 | The pilots | On 2026-11-18 the runner's walks and readers were written and reviewed with no model session, the walks on a server of the runner's on Playwright rather than Botcore's `cdp_*` commands. The owner gave the word for the four pilots under a cap of $15, and for filing #1699, which the owner's phone look had met. The two builds and two walks ran for $3.67 at list prices with no leak; a build costs about its line and a walk far less. The weekly figure was not read first, so step 0.1's first fifteen builds give the conversion (superseded: they did not; see the 2026-11-24 row). Three runner changes followed: two faults fixed, and the screen reader hearing live regions inside shadow roots. On 2026-11-21 the owner agreed to run the bare build's reader ($0.18), to cap the first fifteen builds at $50, and to correct a refusal's feedback in the reference build, done in both builds with every proof and check as before. Recorded in #1811 |
| 2026-11-21 | The rules for "go", and step 0.1's first fifteen builds | The owner confirmed the rules for "go" and the reading of a path for step 0.4 as proposed, reading step 0.3's "a persona of that modality" as one persona alone, and gave the word for the first fifteen builds under a cap of $50. The runner's reports of steps 0.1 to 0.4 and step 0.2's statistics were written and tested on invented runs. The allowance week's reset was corrected to 04:00. The builds ran after the reset for $25.67 at list prices, one cut off and one thrown out among them, and paused for the owner |
| 2026-11-24 | Step 0.1's first fifteen builds, scored | The owner looked again at the reference build's screenshot page made on 2026-11-16 and marked none. The scoring checkout was found stripped a second time, by Botcore's disk cleaner, which also explains 2026-11-20; it was rebuilt, scores the reference build 308 of 308, and is kept from the cleaner. The builds were scored, the five bare builds' readers ran at the owner's word for $0.86, and the step's report was written. Both arms pass nine checks in ten, which puts whether to go on to the owner, and the weekly figure was not read when the builds ended, so they give no conversion (superseded: the owner decided on 2026-11-24, in the Steps 0.3 and 0.4 row) |
| 2026-11-24 | The screen an agent sees | The owner asked how UI SDK's concepts align with AFD's FAST-AF components. Its documentation was read: a core of interface behaviours with five renderers, and a bridge through which an agent reads and changes the components on a page. The bridge is close to what `fast-element`'s command layer was before #1398, and to what epic #1385's step 8 plans for `afd-view-state`. Asked whether an agent inside an application should see and fill what is on the screen, the owner agreed, with no actions declared by components. Section 5.10 gains the row and UI SDK as a published design to compare, and question 13 the answer in the owner's words. Where its code goes, in `afd-view-state` or in a layer of its own, and how much of the screen an agent sees, stay open. Two independent reviewers found five blockers, all fixed. Nothing was built |
| 2026-11-24 | The owner's clarification | Asked which layer the answer of that day had meant, the owner said it was a case for a designed path, a system built to let an agent edit controls and their content, over a workaround of a command that sets values and code in the interface that applies them. Question 13 gains the reply, and the 5.10 row and section 6 now point at the [Controls proposal](../../active/controls/controls.proposal.md), written the same day, which places the code and carries what is still the owner's to decide |
| 2026-11-24 | Steps 0.3 and 0.4 | The owner ended step 0.1 at its fifteen approved builds, decided not to measure the weekly figure again for now, counted the cut-off build at its maximum, and deferred steps 0.2 and 0.5. At the owner's word the 60 walks and 40 readers ran for $18.20 after a clean dry run. Step 0.3 is met: 12 of 12 faults found; an independent reviewer on GPT-6.2 Astra, by the owner's decision, judged 20 of 20 matches right and 23 of 30 other findings real. Step 0.4 is not met, 3 of 13; its path counts only commands and likely misses trouble a persona works around. What to tune is recorded |
| 2026-11-24 | Walk tuning and step 0.4 rerun | The owner agreed to tune the walks (fixture date, ending line, report-based measure for step 0.4) and rerun 10 to 15 walks; the session also updated the ending parser and the fault reader's consequence matching, without touching frozen stage 2 files. The 15-walk rerun ($5.43, under a $58 weekly cap) gave 15 of 15 last-line endings, 0 clock mismatches, every aimed fault found in both walks, and 4 of 4 fault-meeting plus 1 of 1 no-fault on the blind pairwise report comparison. Without separate sign-off, the session also ran 40 blind comparisons on the 60 original walks ($1.79; week $54.35), scoring 12 of 13 fault-meeting and 6 of 7 no-fault ([Steps 0.3 and 0.4](#steps-03-and-04)) |
