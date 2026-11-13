# Design Decisions: variants, choices and a review that asks only what gates cannot settle

## Status

- **State:** scaffold. Written 2026-11-13 against `main` at `e5d683a8`. It states the problem,
  what exists and draft jobs. It has no design, no drafted commands and no scenario files yet.
  [STATUS.md](STATUS.md) tracks progress.
- **Verified:** nothing first-hand except the `specimen-diff` fault in
  [follow-ups](STATUS.md#follow-ups-not-yet-issues). [What exists today](#2-what-exists-today)
  comes from a survey another agent made on 2026-11-13 at `e5d683a8`; each claim names its file.
- **Next:** the owner cuts, adds and ranks the [jobs](#3-jobs-draft). Commands are then drafted
  against the ranked jobs and written as scenarios. Ranking before drafting is the order chosen
  here; the [jobs-first guide](../../../../.claude/skills/afd/references/jobs-first.md) ranks
  after the scenarios and the walks, which still follow.

| Field | Value |
| --- | --- |
| Epic | [#1108](https://github.com/lushly-dev/afd/issues/1108) |
| Units likely touched | `foundations/specimen`, `integrations/specimen-afd`, `foundations/violet`, `integrations/violet-afd`, `endpoints/loam` (its design record) |
| Related | [Patterns](../patterns/patterns.proposal.md) (epic [#1073](https://github.com/lushly-dev/afd/issues/1073)), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md), [Pointing](../pointing/pointing.proposal.md), [Scales](../scales/scales.proposal.md), [Specimens status](../../active/specimens/STATUS.md) |
| Rank among the four | First. It is where a person's time goes |

## 1. Problem

When a person and an agent iterate on an interface, generating a version is cheap. Choosing
between versions, and being sure the chosen one is right, is where the person's time goes.
The stack has almost nothing for either.

1. **Variants have no home.** The owner's practice is to render comparable versions in the
   browser and keep the old ones until one is chosen. Today that means ad hoc switches and page
   copies. No tool groups several renderings as alternatives to one another.
2. **A choice loses its reason.** Loam keeps its reasons in prose, in `design.md`'s history and
   `decisions.md`. Violet has a `reason` on every operation, but nothing reads it, Loam writes it
   as null, and `changes.impact` drops it. A later agent cannot find why something is the way it
   is before changing it.
3. **Review gives everything equal weight.** Gates already settle contrast, target size, token
   use and most of accessibility. What they cannot settle (axe's incomplete checks, a capture
   with insufficient evidence, a theme that contradicts its declaration, "the shell recedes") is
   reported and then sent nowhere. The person reviewing sees all or nothing.

## 2. What exists today

### Specimen

- **Review page** (`foundations/specimen/src/browser/page.ts`, built by `specimen-build`). It is
  an index grouped by title, with a text filter kept in `?q=` (lines 476 to 500). It shows no
  results: no accessibility, theme, diff, coverage or profile outcome, and no screenshots. A
  preview URL carries theme, viewport, locale, motion and checkpoint (lines 166 to 180). It
  neither ranks nor filters by outcome.
- **`specimen-diff`** (`src/diff.ts:247-296`) compares two observations across DOM, the
  accessibility snapshot, axe findings, layout, styles, state and events. It answers `changed`,
  `no-change-observed` or `insufficient-evidence` with the differences and limitations, and
  refuses captures whose browser, checkpoint, context or capture version differ (lines 35 to 71).
  It does not require both sides to be the same specimen, so two variants rendered under the
  same conditions can already be compared. It does no pixel comparison: a visual requirement
  answers `insufficient-evidence` (lines 274 to 286).
- **`specimen-matrix`** (`src/bench-runtime.ts:713-797`) captures one specimen across context
  axes (theme, viewport, container, locale, motion), up to 64 cells, and diffs each against the
  first. It has no axis for arguments or variants and takes one id.
- **`specimen-a11y`** reports `incompleteChecks`, which the README describes as what "a person
  must" decide. They never affect the status, and nothing routes them to a person.
- **`specimen-themes`** compares pixels between themes and reports `follows`, `declared`,
  `pinned`, `undeclared`, `contradicted` or `unavailable`; a declaration can carry a one-line
  reason.
- **Person-in-the-loop signals** exist in small places: `specimen-suggest`'s placeholders fail
  until a person replaces them, and coverage waivers need a reason. There is no approval or
  sign-off field in any output.
- **The Specimen proposal** requires "a human review surface"
  (`docs/features/proposed/specimens/specimens.proposal.md:71`). Only the index exists.

### Violet

- **`reason`** is optional on all five token operations and stored on every operation record
  (`foundations/violet/packages/core/src/types/operation.ts:19-99`). Only `node.get`,
  `nodes.graph` and `audit.list` return it. No rule reads it.
- **`changes.impact`** (`integrations/violet-afd/src/commands/changes/impact.ts:510-600`) applies
  up to 50 changes to a read-only overlay and reports before and after per node, effects, and
  violations introduced or cleared, with the commands to apply them. Its change schema has no
  `reason`, so the apply commands it returns lose one.
- **History is linear.** There is no branch, fork or draft. A node of type `experiment` ("A/B
  test variant", `types/node.ts:13`) inherits like any other node, and nothing compares two.

### Loam

- **Records:** `endpoints/loam/docs/design.md` has a dated history (lines 561 to 755) with
  decisions and measured reasons, and `docs/decisions.md` has D1 to D113, superseded entries
  kept. Rejected alternatives survive only as prose (D22). No visual variants, screenshots or
  before-and-after pairs are kept.
- **Violet's `reason` is null:** `endpoints/loam/packages/theme/src/tree/index.ts:87` writes every
  operation with `reason: null`.
- **The design checklist** (`.claude/skills/loam-design/references/checklist.md`): items 1 and 6,
  and parts of 3 and 4, are checked in CI (`.github/workflows/loam.yml:133-153`). The states
  table, the theme evidence (run by hand), the fixture path, the design record diff, the
  reduced-motion line and "correct in light, dark and high contrast" are left to a person in the
  pull request.

### Elsewhere

- AFD's `CommandResult.alternatives` (`packages/core/src/metadata.ts:154-165`) carries
  `{data, reason}` for an alternative not chosen. It is generic, not for designs.
- The [Ideas proposal](../../active/ideas/ideas.proposal.md) plans an operation log with a reason
  per change, framings that inherit rather than copy, and standing that "only a person" gives.
  It is not implemented, and its engine is to be shared with Violet.

## 3. Jobs (draft)

Drafted from the discussion of 2026-11-12, for the owner to cut, add and rank. Each will become
one scenario file once commands are drafted.

1. **Compare like with like.** When I am unsure between directions, I want several variants of
   the same screen or component rendered side by side under the same conditions, so that I
   compare the designs and not the setups.
2. **Keep what was not chosen.** When I choose one variant, I want the others kept and
   retrievable until I discard them, so that I can go back.
3. **Record the choice with its reason.** When I choose, I want the choice, the reason and the
   evidence it rested on recorded together, so that a later agent or I can find why.
4. **Be told before undoing a decision.** When an agent is about to change something a decision
   covers, I want it shown the decision and its reason first, so that decisions are not undone
   silently.
5. **Review only what needs eyes.** When I review a change, I want to see only what no gate
   settled, before and after, so that my attention goes where a machine cannot.
6. **Turn an incomplete check into a question.** When a check cannot decide (axe's incomplete
   checks, insufficient evidence, a contradicted theme), I want it put to me as a question, so
   that it is not buried in a report.
7. **Refuse a misleading comparison.** When two variants were captured under different
   conditions, I want the comparison refused with the difference named, so that I never compare
   a theme change and call it a design change.
8. **Stay quiet about what is settled.** When a gate has settled something, I want it left out
   of my review, so that the review stays short.

## 4. Starting points

Not a design: where each job would most likely build on what exists.

- **Variant sets (jobs 1, 2, 7):** `specimen-diff` already compares two specimens under the same
  conditions and refuses different ones. A variant set could be several specimen ids, or one
  specimen with an argument axis added to `specimen-matrix`.
- **Decisions (jobs 3, 4):** a structured record that names the variants, the one chosen, the
  reason and the captures. Violet's `reason` covers token changes only; Loam's `decisions.md`
  covers any decision but is prose. Where the record lives is the first open question.
- **Review (jobs 5, 6, 8):** classify each difference from `specimen-diff` and each gate outcome
  as settled or open, and show only the open ones on the review page, with the two captures.
  `incompleteChecks`, `insufficient-evidence` and `contradicted` are the first inputs.
- **Pointing** would let a person mark an element during review; see
  [Pointing](../pointing/pointing.proposal.md). The review works without it.

## 5. Open questions

1. **Where decisions live.** Files in the repository beside the code (reviewable in a pull
   request), Violet operations (tokens only), or an Umbel plugin (searchable across projects).
2. **Whether a decision binds.** Does a decision become a gate an agent cannot pass without
   asking, or only something it is shown?
3. **What a variant is.** Arguments of one component, two specimens, or two whole screens in a
   job's state. The last needs [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md).
4. **Pixels.** Whether a visual comparison is needed beside the structured channels, given that
   `specimen-diff` does none today.
5. **Relation to Ideas.** Whether decisions share the Ideas engine's reasoned operation log and
   its notion of standing a person gives.

## 6. Out of scope

- A/B measurement with users. Loam lists it as out of scope (`endpoints/loam/docs/architecture.md:208`).
- Drawing tools. The rendered screen is the medium.
