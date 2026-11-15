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

- **State:** scaffold with a design direction. Written 2026-11-14 against `545316f2`. Not
  committed, not reviewed, not approved.
- **Epic:** none. Opening one is the owner's call.
- **Done:** the problem, what exists today, the model, fourteen draft jobs as sentences, a design
  direction, the amendments it implies for other documents, phases and twelve questions for the
  owner.
- **Not done:** drafted commands, scenario files, the three scenario checks, reader walks, an
  independent review, the owner's answers and everything in the phases. See
  [What is not done](#what-is-not-done).
- **Blocked on:** the owner's ranking of the draft jobs (question 11) and the questions in
  section 9 that are still open. Questions 1 and 2 were answered on 2026-11-14: this document
  stays the frame and each part moves into the proposal that owns it; a default pattern is
  customized by copying it, patterns are not layered, and an unchanged default is named at a
  version.
- **Order:** the owner answers the direction and ranks the draft jobs before commands are
  drafted, as the [Scales scaffold](../scales/STATUS.md) does. The
  [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md) puts the owner's
  ranking after the scenarios and the reader walks, and they still follow.
- **Last verified:** 2026-11-14, the link check below.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Scaffold: problem, what exists, model, draft jobs, design direction | Done 2026-11-14 | [`agent-first-design.proposal.md`](agent-first-design.proposal.md) |
| Open the epic | Not started; the owner's call | |
| The owner answers the proposal's section 9 | Not started; blocks everything below | Proposal, section 9 |
| Draft the commands against the ranked jobs | Not started | |
| Write each job as a scenario and run the checks | Not started | [Jobs first](../../../../.claude/skills/afd/references/jobs-first.md) |
| Walk the paths with readers who did not write them | Not started | Three seats, as jobs first describes |
| Independent review of the proposal | Not started | |
| Phase 0, steps 0.1 to 0.6 | Not started; needs the owner's go | Proposal, section 7 |
| Phases A to D | Not started; each needs phase 0's decision | Proposal, section 7 |

## What is not done

- **No commands are drafted and no job is a scenario file.** The fourteen jobs are sentences.
  Nothing shows that commands can express them.
- **No reader has walked it and no one has reviewed it.** The design direction is one session's
  draft, written with the owner in conversation.
- **Nothing in it is measured.** Phase 0 exists to measure it. Its claim that a default pattern
  set or a skill improves an agent's screens is untested, and Component Briefs' prototype is
  evidence that added context alone does not.
- **Copying a default is not designed.** Provenance on a pattern file, the comparison by
  statement id and the rule for ids in a copy are named in the proposal's section 5.1 and
  nothing more. Whether Patterns' refusal of a repeated id holds per library or per space was
  not checked.
- **The owner has decided three things here**, all on 2026-11-14: the todo example is not the
  bench's base; question 1 (this document is the frame, and each part moves to the proposal that
  owns it); and question 2 (copying, not layering, with an unchanged default named at a version). The
  other questions in section 9 are open.

## How it was checked

Run 2026-11-14 in this worktree at `545316f2`.

- **Claims about the repository** in the proposal's section 2 were read first-hand in this
  session, each from the file it names. The exceptions are listed under "Not verified" in the
  proposal's status.
- **Links:** a throwaway Node script resolved every relative link in the proposal and in this
  file against the working tree, and every anchor against the target file's headings. Run
  over the proposal, this file and `docs/features/README.md`, it reported 138 links checked and
  0 broken. External URLs
  were not checked; there are none.
- **The verify plan:** `pnpm verify --list --files` on the three changed files printed "no
  packages affected" and "no path-filtered workflow is triggered", so there was no gate to run.
  The change is two new Markdown files and one row in `docs/features/README.md`.
- **Not run:** `botcore skill-lint` and the `docs_*` checks. No skill was changed.

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

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-14 | First draft | A discussion with the owner that began as a new design skill. Six public design skills were compared. A self-review found that the first plan had ignored the five design proposals and the skills audit, and it was redone against them. The owner then set the direction: AFD fixes the architecture, Violet included, and ships defaults a product can customize, replace or add to; the aim is to change how applications are built with agents, not to fit older toolchains; guidance may start as a skill and move into Umbel, as copy voice will; agents and simulated users review early, and a person reviews the final change and decides when agents split. The owner's earlier brainstorm supplied the persona panel, the decision card and the rule that a panel gives coverage, not votes. The proposal and this file were written and the links checked. Nothing was committed |
| 2026-11-14 | First draft, continued | The owner answered question 1: agreed. On question 2 the owner said a pattern is a copy, and that something managed centrally would be a component. No ruling yet |
| 2026-11-14 | First draft, continued | The owner ruled on question 2: copying, because a person or an agent can look at what changed upstream and take it after review, where layering could change a product unexpectedly. Section 5.1 was rewritten around copying, and the lines that depended on layering were changed: two draft jobs, the decision card, sections 5.6 and 5.7, the Patterns amendment, phases A and D and one risk. The first draft's layering recommendation is kept in 5.1 as considered and dropped |
| 2026-11-14 | First draft, continued | The owner ruled on the point question 2 left open: a product that changes nothing names the defaults at a version, and does not copy the whole set |
