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
  2026-11-14. On 2026-11-15 the owner decided its domain, its model and budget, and its bare
  arm, and an independent reader reviewed it. Its rules for "go" are not confirmed. Nothing
  in it is built.
- **Not done:** drafted commands, scenario files, the three scenario checks, reader walks, the
  owner's remaining answers, moving each part into the proposal that owns it, and everything in
  the phases. See
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
- **Last verified:** 2026-11-15, the link check and the review of the bench specification
  below.
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
| Phase 0, step 0.0: the bench's specification | In progress. Drafted 2026-11-14 with a recommended domain, 209 sessions and an estimate of about $260 at list prices, used as a measure of size. The owner decided three of its points on 2026-11-15: a seed library; Opus 5.5 at `medium` on a second machine's subscription allowance, no more than a fifth of a week's allowance in any one week; and a bare arm in step 0.1. An independent reader reviewed it the same day. The rules for "go" are proposed and not confirmed. The commands, fixtures, checks, planted faults and persona cards are not written | [`bench.md`](bench.md) |
| Phase 0, steps 0.1 to 0.6 | Not started. Each waits on the bench being built, the pilots, and the owner confirming the rules for "go" | Proposal, section 7 |
| Phases A to D | Not started; each needs phase 0's decision | Proposal, section 7 |

## What is not done

- **No commands are drafted and no job is a scenario file.** The thirteen jobs are sentences.
  Nothing shows that commands can express them.
- **The bench is a specification only.** Nothing in it is built, and its cost per session rests
  on two assumptions that pilot sessions are meant to replace. Its rules for "go" are proposed
  and not confirmed.
- **No reader has walked it.** There are no commands to walk. The design direction is one
  session's draft, written with the owner in conversation and reviewed once.
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
  (`endpoints/botcore/src/botcore/commands/cdp/diagnostics.py:716`). It has had no independent
  review.
- **The bench specification, 2026-11-15:** read first-hand through T3 Code, that the owner's
  second machine answers, is an Apple silicon Mac and has a checkout of this repository, and
  from Specimen's README that a host exists for that platform. Not checked: that the host
  builds there, that the `claude` command there is signed in, and what share of a week's
  allowance a session takes. The link script was run again over the same four files.
- **Independent review of the bench specification, 2026-11-15:** REVIEWTEXT

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
| 2026-11-15 | Bench specification, after the owner's reply | The owner decided that the bench's sessions run on a second machine, on its subscription allowance, and take a small share of a week's allowance. That machine is an Apple silicon Mac, which Specimen supports, so scoring runs there too and the question of where to score is settled. The budget's cap became a share of the week, proposed at a fifth and open (superseded by the next row, where the owner accepted the fifth), with the pilots measuring what a session takes. A section on when the bench runs was added: phase 0 once, and afterwards only on a named event |
| 2026-11-15 | Bench specification, the owner's second reply | The owner accepted three recommendations: no more than a fifth of the second machine's weekly allowance in any one week, the seed library, and a bare arm in step 0.1. The owner noted that another session runs on that machine, and asked for a commit and a pull request after an independent review. The review found that the files claimed more approval than the owner gave, that a figure from Component Briefs was misattributed, and that several rules for "go" could not be computed. All were fixed, and the rules for "go" stay unconfirmed |
