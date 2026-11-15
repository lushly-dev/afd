# Agent-First Design: status

Read this before the [proposal](agent-first-design.proposal.md). It records exactly what is done
and what is not, so an agent never has to scan the code to learn what is current. It follows the
shape of the [Patterns status](../patterns/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** scaffold with a design direction. Written 2026-11-14 against `545316f2`.
  One independent reader reviewed it. The owner has answered eight of its twelve questions and
  not approved the whole.
- **Epic:** none. Opening one is the owner's call.
- **Done:** the problem, what exists today, the model, thirteen draft jobs as sentences with the
  rank the owner confirmed, a design direction, the amendments it implies for other documents,
  phases, twelve questions for the owner with eight answered, and an independent review in two
  passes.
- **In progress:** the [bench specification](bench.md), step 0.0 of phase 0, drafted
  2026-11-14 and merged in #1234. On 2026-11-15 the owner decided its domain, its model and
  budget, and its bare arm, and an independent reader reviewed it. Its rules for "go" are not
  confirmed. Nothing in it is built.
- **In progress:** the seed library's
  [jobs and drafted commands](bench/seed-library.md), drafted 2026-11-15 and merged in
  #1236: seventeen jobs as scenario files and twenty-four commands. The scenario checks
  pass, three readers walked the paths and a fourth reviewed the result. On 2026-11-15 the
  owner decided three of its design points; the list of jobs as a whole is still open.
- **In progress:** each bench screen's [task](bench/tasks/README.md) and the results that
  force its states, drafted 2026-11-15, reviewed in two passes and merged in #1238.
- **In progress:** the seed library's application, built 2026-11-15 in
  [`packages/examples/seed-library`](../../../../packages/examples/seed-library/README.md) on
  `feat/seed-library-example` and not merged: the twenty-four commands with their schemas,
  an in-memory store, and tests that run all seventeen jobs (113 of 113 steps pass) and check
  the 74 results against the commands' output schemas. No reader but its author has reviewed it.
- **Not done:** for the proposal's own thirteen jobs, drafted commands, scenario files, the
  three scenario checks and reader walks; the owner's remaining answers; moving each part
  into the proposal that owns it; and everything in the phases. See
  [What is not done](#what-is-not-done).
- **Blocked on:** the owner confirming the bench's rules for "go". That is due before the
  first run of step 0.1 and does not hold up building the bench, whose domain and budget the
  owner approved. Before any session of phase 0 runs, the bench's commands, fixtures, checks,
  planted faults, persona cards, reference build and runner are written, and the four pilots
  give what a session takes. Questions 4, 8, 9 and 10 of the proposal are open and block
  nothing yet.
- **Order:** the owner answers the direction and ranks the draft jobs before commands are
  drafted, as the [Scales scaffold](../scales/STATUS.md) does. The
  [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md) puts the owner's
  ranking after the scenarios and the reader walks, and they still follow.
- **Last verified:** 2026-11-15, the link check, the scenario checks on the seed library's
  jobs, the check of the bench's tasks and results, the reviews below, and the seed library's
  tests, `pnpm check` and `pnpm verify` on the built application.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, model, draft jobs, design direction | Done 2026-11-14, merged in #1223 | [`agent-first-design.proposal.md`](agent-first-design.proposal.md) |
| Open the epic | Not started; the owner's call | |
| The owner answers the proposal's section 9 | In progress. Answered 2026-11-14: questions 1, 2, 3, 5, 6, 11 and 12, and the todo example in question 7. Answered 2026-11-15: the bench's domain in 7 and the budget in 12. Open: 4, 8, 9 and 10 | Proposal, section 9 |
| Move each part into the proposal that owns it | Not started. Ready to move: customizing a default (5.1) and who owns the result-state patterns (5.2) into Patterns; the panel's provisional answer and the triggers (5.5) into Design Decisions | Question 1 |
| Draft the commands against the ranked jobs | Not started. The rank is confirmed; this is phase A's, after phase 0's decision | |
| Write each job as a scenario and run the checks | Not started | [Jobs first](../../../../.claude/skills/afd/references/jobs-first.md) |
| Walk the paths with readers who did not write them | Not started | Three seats, as jobs first describes |
| Independent review of the proposal | Done 2026-11-14: one broad pass and one pass on its blockers | [How it was checked](#how-it-was-checked) |
| Phase 0, step 0.0: the bench's specification | In progress. The specification is written, and merged in #1234. Drafted 2026-11-14 with a recommended domain, 209 sessions and an estimate of about $260 at list prices, used as a measure of size. The owner decided three of its points on 2026-11-15: a seed library; Opus 5.5 at `medium` on a second machine's subscription allowance, no more than a fifth of a week's allowance in any one week; and a bare arm in step 0.1. An independent reader reviewed it the same day. The rules for "go" are proposed and not confirmed. The commands, fixtures, checks, planted faults and persona cards are not written | [`bench.md`](bench.md) |
| The bench: its jobs and drafted commands | In progress. Drafted 2026-11-15: 17 jobs as scenario files in 113 steps, and 24 commands. The parse, dry-run and coverage checks pass. Three readers walked the paths, and an independent reviewer read the result and walked the two commands their findings added. Merged in #1236. The owner decided three of its design points on 2026-11-15 | [`bench/seed-library.md`](bench/seed-library.md) |
| The bench: the task for each screen and its result fixtures | In progress. Drafted 2026-11-15: four tasks, 50 states and 74 results, checked against the drafted commands, the States table and the fixtures, and reviewed in two passes. Merged in #1238 | [`bench/tasks/`](bench/tasks/README.md) |
| The bench: the application and its schemas | In progress. Built 2026-11-15 on `feat/seed-library-example`, not merged: 24 commands with zod input and output schemas, an in-memory store, the approval hook and the steward's middleware. Its tests run the 17 jobs, 113 of 113 steps passing, two of them over MCP with confirmations enforced, and check the 74 results against the output schemas | [`packages/examples/seed-library`](../../../../packages/examples/seed-library/README.md) |
| The bench: schemas, the application, the held material and the runner | Not started (2026-11-15: the schemas and the application moved to the row above; the held material and the runner are not started) | [`bench.md`](bench.md) |
| Phase 0, steps 0.1 to 0.6 | Not started. Each waits on the bench being built, the pilots, and the owner confirming the rules for "go" | Proposal, section 7 |
| Phases A to D | Not started; each needs phase 0's decision | Proposal, section 7 |

## What is not done

- **No commands are drafted and no job is a scenario file for the proposal's own thirteen
  jobs.** They are sentences, and nothing shows that commands can express them. The seed
  library's seventeen jobs are a different list: the bench's application, not this proposal's
  product.
- **The bench is mostly a specification.** Its application is built and not merged
  (2026-11-15); its checks, planted faults, persona cards, reference build and runner are not.
  Its cost per session rests on two assumptions that pilot sessions are meant to replace. Its rules for "go" are proposed
  and not confirmed.
- **No reader has walked the proposal's jobs.** There are no commands to walk. The design
  direction is one session's draft, written with the owner in conversation and reviewed
  once.
- **Nothing in it is measured.** Phase 0 exists to measure it. Its claim that a default pattern
  set or a skill improves an agent's screens is untested, and Component Briefs' prototype is
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
    step 0.1.

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
  (`endpoints/botcore/src/botcore/commands/cdp/diagnostics.py:716`). It had no independent
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

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-14 | First draft | A structured recovery on `CommandError` (a command, its input and a label) beside the prose `suggestion`, so an interface can render a button and an agent can call it. A contract change in four languages. The sources also disagree on whether a suggestion is written for a person or names a command | Open; its own proposal if the owner wants it |
| 2026-11-14 | First draft | The confidence bands in `packages/core/src/result.ts:63` say 0.9 or more is "auto-apply safe". Whether a result applies by itself should depend on whether it can be undone. The Python, Rust and C++ copies were not checked | Open; proposal section 5.3 |
| 2026-11-14 | First draft | The whitepaper uses dotted command names such as `document.create`, against the `domain-action` naming rule | Open; worth an issue |
| 2026-11-14 | The owner | The todo example is out of date and should be updated; it is a reference only until then | Open |
| 2026-11-14 | First draft | A newcomer copies skills with `npx degit` (`README.md:457`), which records no version and gives no notice of changes. Botcore's seeded skills carry both | Open; proposal sections 2 and 5.6 |
| 2026-11-14 | First draft | Specimen does not observe animation, so no motion rule can be a gate. A rule about duration or easing stays `authored` | Open |
| 2026-11-14 | Bench specification | No forced-colours emulation exists in Specimen or in Botcore's `cdp_emulate`, so no persona can be held to that modality | Open |
| 2026-11-14 | Bench specification | A screen reader's live announcements are not captured as they are spoken; the bench reads them from the accessibility tree | Open |
| 2026-11-15 | The seed library's jobs | The approval middleware caps a hold at 24 hours (`packages/server/src/approval.ts:234`). An application whose approver answers later has to let its own record outlive the hold, and then the `expiresAt` in the refusal is not the one that matters. The bench ties the two and accepts a day | Open |
| 2026-11-15 | Specimen's host on the second machine | Specimen's `build:host` script runs `cargo build --release --locked --target-dir target`, which overrides `CARGO_TARGET_DIR`, so the host cannot be built onto another drive through the documented command. `--target-dir "${CARGO_TARGET_DIR:-target}"` would honour it. Specimen is an imported unit, so the change needs a provenance record | Closed 2026-11-15, not changed. A fix was written and worked on the second machine, and review withdrew it: the pin is deliberate (`3ee8c66b`), worktrees often share one `CARGO_TARGET_DIR`, where the last host built would serve every worktree, and Loam's status says not to set it for Specimen's host. Cargo's `build-dir` already puts the intermediate files on the external drive there; the binary in the checkout is 13 MB |
| 2026-11-15 | Specimen's host on the second machine | On a fresh install Specimen's suite fails in `src/bench-worker.test.ts` until `pnpm -F "@lushly-dev/specimen-cli..." build` has run. CI builds first; the README's paragraph on `test:browser` does not say so | Closed 2026-11-15: the paragraph says so (#1237) |
| 2026-11-15 | The bench's result fixtures | A command's `confirmPrompt` is a fixed string on its definition, so a confirmation cannot name what it is about: which variety is retired, which date's requests are removed. A screen shows the record beside it | Open |
| 2026-11-15 | The bench's result fixtures | The approval middleware's suggestion on a hold also says "the application retries the same call once it has recorded the approval" (`packages/server/src/approval.ts:491`). An application that makes the approved thing another way, as the bench's `request-decide` does, cannot correct that half either | Open |
| 2026-11-15 | Independent review of the seed library's jobs | No default pattern covers the approver's side of an approval: the list of held calls, with approve and decline. The proposal's section 5.2 has the requester's side only | Open |
| 2026-11-15 | The seed library's jobs, the calling-agent walk | The approval middleware's refusal says "Ask the user to approve" (`packages/server/src/approval.ts:495`). Where the approver is somebody other than the user at the client, as a steward is to a desk volunteer, that sends the caller to the wrong person; the application can only add to the text through `summary` | Open |
| 2026-11-15 | The seed library's jobs | A scenario cannot assert `warnings`, `alternatives`, `sources`, `plan`, `undoCommand` or `undoArgs`, the fields five of the ten default patterns render. The first three are a known limit in the jobs-first guide; the last three are not listed there | Open |
| 2026-11-15 | The seed library's application | The scenario runner resolves a step reference only in `input` (`packages/testing/src/runner/scenario-runner.ts:308`), but `scenario validate` and the dry run accept one inside `expect` without a word, and it is then compared as literal text. Three of the seed library's steps were written that way and passed every check until they ran. Either the runner resolves them in `expect` too, or validation refuses them, and the jobs-first guide says which | Open; worth an issue |
| 2026-11-15 | Independent review of the bench specification | Botcore's `cdp_emulate` takes `user_agent` and `cpu_throttle`, reports them as emulated with "(requires CDP)" and applies neither (`endpoints/botcore/src/botcore/commands/cdp/diagnostics.py:745`) | Open |

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
| 2026-11-15 | Bench specification, the owner's second reply | The owner accepted three recommendations: no more than a fifth of the second machine's weekly allowance in any one week, the seed library, and a bare arm in step 0.1. The owner noted that another session runs on that machine, and asked for a commit and a pull request after an independent review. The review found that the files claimed more approval than the owner gave, that a figure from Component Briefs was misattributed, and that several rules for "go" could not be computed. The six blockers and the improvements were fixed. A second pass found one more place that called scoring settled and ten smaller points, and those were fixed too. The rules for "go" stay unconfirmed |
| 2026-11-15 | After the merge of #1234 | The owner said to start the bench. The seed library's jobs and commands were drafted jobs first: 17 jobs as scenario files across the four screens and 22 commands, with two fixtures of invented data. Writing them changed the sketch: asking the steward is a held `loan-create` and not a command of its own, every mutation with a way back got its command, and warnings now arise on the held-back screen. Three readers then walked the paths, and their findings added two commands, gave donations a way back, and stopped the design leaning on the host for things it does not do. The scenario checks pass on the result. A read-only check of the second machine's tools was started |
| 2026-11-15 | Specimen's host on the second machine | At the owner's word, a session on the second machine built Specimen's host with its Rust output on the machine's external drive, as the owner asked. The host rendered a specimen and Specimen's suite passed, so the bench can score builds there. Two follow-ups are recorded: the build script ignores `CARGO_TARGET_DIR`, and the suite needs the TypeScript build first |
| 2026-11-15 | Specimen's build script | The owner agreed to make `build:host` honour `CARGO_TARGET_DIR`. The fix worked on the second machine, and an independent review then found that it undoes a deliberate pin and lets worktrees that share a target directory use each other's host. It was withdrawn: the machine's cargo `build-dir` setting already keeps the build's bulk on the external drive. Specimen's README now says its suite needs the TypeScript build first |
| 2026-11-15 | The bench's tasks | The owner accepted three design points of the seed library: approval as a held loan, job 16, and the approval request off T4. Each screen's task and the results that force its states were drafted, 50 states and 74 results, after a review found that the first version hinted at the design, let the bare arm read the states, and could not mount a whole screen. `bench.md` now says what each arm reads. The owner allowed fixes and merges on green without asking |
| 2026-11-15 | The seed library's application | The application was built in `packages/examples/seed-library` from the drafted commands: 24 commands with schemas, an in-memory store with a fixed clock and counter ids, the approval hook that records a held loan as a request, and the steward's middleware. The scenario files moved beside it. All 113 steps pass, jobs 12 and 16 over MCP with confirmations enforced; three steps that compared with an earlier step inside `expect` now name ids. The 74 results pass the output schemas unchanged. `seed-library.md` records what building it settled. Not merged |
