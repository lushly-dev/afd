# Patterns: status

Read this before the [proposal](patterns.proposal.md). It records exactly what is done and what is
not, so an agent never has to scan the code to learn what is current. It follows the shape of the
[Component Briefs status](../../complete/component-briefs/STATUS.md).

## How to keep this file

- "Done" means merged to `main` with evidence linked. Anything else is "in progress" or "open",
  with what remains spelled out.
- Record how you verified it, the command or check, and the absolute date.
- Write down follow-ups that are not yet issues, with the date and who raised them. Link the issue
  when one exists.
- Never delete history. Mark an entry superseded and point to what replaced it.

## Status block

- **State:** proposed. A first draft, written 2026-11-12 against `main` at `d152f3dc`. Committed
  for discussion; not reviewed, not approved.
- **Epic:** [#1073](https://github.com/lushly-dev/afd/issues/1073). Its checklist mirrors the steps
  below; this file stays the source of truth.
- **Done:** the proposal; nine jobs as scenario files; the three scenario checks.
- **Not done:** everything else. Nothing is implemented and nothing is measured. See
  [What is not done](#what-is-not-done).
- **Last verified:** 2026-11-12, the scenario checks below, with the tools built in this worktree at
  `d152f3dc` on Node 26.
- **Follow-ups:** the [table below](#follow-ups-not-yet-issues).

## Steps

| Step | State | Evidence |
| --- | --- | --- |
| Draft the proposal | Done 2026-11-12 | [`patterns.proposal.md`](patterns.proposal.md) |
| Write the jobs as scenarios | Done 2026-11-12 | [`scenarios/`](scenarios/), nine files, 28 steps |
| Check the scenarios | Done 2026-11-12 | [How the jobs were checked](#how-the-jobs-were-checked) |
| Save as a proposal and open the epic | Done 2026-11-12 | Epic [#1073](https://github.com/lushly-dev/afd/issues/1073) |
| Walk the paths with readers who did not write them | Not started | Three seats, as [jobs first](../../../../.claude/skills/afd/references/jobs-first.md#walking-the-paths) describes |
| Independent review of the proposal | Not started | |
| The owner cuts, adds and ranks the jobs, and answers the proposal's section 12 | Not started | |
| Phase 0, steps 0.1 to 0.5 | Not started; needs the owner's go | Proposal, section 9 |
| Phases A to D | Not started; each needs phase 0's decision | Proposal, section 9 |

## What is not done

- **No reader has walked the jobs.** The checks show that the drafted commands can express each job
  once. They do not show that the jobs are the right ones.
- **No one has reviewed the proposal.** Its design section is one author's draft.
- **Every claim about what a gate can read is unproven.** The proposal's section 5.2 says which
  parts exist today. Whether focus can be read from a capture was not checked in the source.
- **Nothing in it is measured.** Phase 0 exists to measure it.
- **The owner has decided nothing here.** The seven decisions in the proposal's section 12 are open.

## How the jobs were checked

Run 2026-11-12 in this worktree at `d152f3dc`, after `pnpm install --frozen-lockfile` and
`pnpm -F "@lushly-dev/afd-cli..." build` on Node 26.

```text
$ node packages/cli/dist/bin.js scenario validate docs/features/proposed/patterns/scenarios
✓ All 9 scenario(s) are valid!

$ (the dry-run and coverage script from jobs-first.md, run in packages/testing)
dry run: 9 files, 0 with errors
{"totalScenarios":9,"totalSteps":28,
 "commands":{"tested":9,"known":11,"untested":["specimen-pack","specimen-pack-export"],"coverage":81.8…},
 "errors":{"tested":3,"known":5,"untested":["TARGET_NOT_FOUND","PATTERN_AMBIGUOUS"],"coverage":60},
 "jobs":{"count":9,…}}
not drafted: []
```

The known commands given to the script were the eleven in the proposal's section 6, and the known
errors its five error codes. What the two untested commands and two untested errors mean is in the
proposal's [Jobs](patterns.proposal.md#4-jobs) section.

## What was read to write it

Read on `main` at `d152f3dc`, 2026-11-12:

- Specimen: `README.md`, `docs/pack-format.md` (version 1), `schema/guide/*.schema.json`,
  `src/types.ts` (targets, scenario steps, expectations, `ElementObservation`, the coverage and
  suggest shapes) and `src/pack-types.ts`.
- Component Briefs: the proposal's sections 1 to 8, `prototype.md` and `STATUS.md`, including what
  step C4 found.
- Umbel: the `components` plugin specification's sections 5, 6 and 8.
- FAST-AF: the combobox guide, `src/shared.guide.json` and the button's stories.
- Loam: the chrome's and the notes app's specimen modules, and the design skill.
- AFD: `jobs-first.md` and the scenario parser's allowed keys.

Not read first-hand: FAST-AF's runtime, Violet's engine and Loam's design record. What the proposal
says of them comes from surveys other agents made on 2026-11-12 at `d7b2bb1f`.

## Follow-ups not yet issues

| Date | Raised by | Follow-up | Status |
| --- | --- | --- | --- |
| 2026-11-12 | First draft | Sizes named by position (`xs` to `xl`) are hard to extend and seldom say what a size is for. A separate proposal could state a scale as a Violet constraint, name tokens by purpose and derive one size from another; Violet refuses a reference with a transform today (`NOT_IMPLEMENTED`). Raised with the owner, who dislikes position names; out of this proposal's scope | Moved 2026-11-13 to the [Scales](../scales/scales.proposal.md) proposal |
| 2026-11-12 | First draft | Loam's screen specimens set up state with a stub client, separately from the scenario files that assert the same commands. Specimen's application-command runner (T11) would let one scenario drive a screen to a state. The proposal lists it under Later | Moved 2026-11-13 to the [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md) proposal. Correction: Loam has no scenario files; its job tests are Vitest |
| 2026-11-12 | First draft | The [design-to-code proposal](../design-to-code/00-overview.md) assumes designs are authored in a drawing tool. This proposal assumes the rendered screen is the medium. Whether to retire or rewrite that proposal is the owner's call | Open |
| 2026-11-12 | First draft | `violet-elements`' README still tells a reader to run Storybook, and its one performance baseline names a story that no longer exists. Found while surveying; not this proposal's work | Open; worth an issue |

## Session log

| Date | Session | What changed |
| --- | --- | --- |
| 2026-11-12 | First draft | A discussion with the owner on how interfaces are built when agents do the building led to this proposal: components stay; guidance, requirements and gates are separated from a component's code; a working region can be saved as a reference; reuse is by instance or by copy. The proposal, nine scenario files and this file were written, and the scenario checks run. Then committed as a proposal, and epic #1073 opened |
