# Design Decisions: variants, choices and a review that asks only what gates cannot settle

## Status

- **State:** active (approved 2026-11-22). Promoted from `proposed/` after a three-pass owner
  walkthrough (Q1–Q19) against `main` at `dbc84611`. Wire contracts live here and in
  [`scenarios/`](scenarios/) (no separate `spec.md`). Nothing is implemented yet; work happens in
  phased sub-issues [#2209](https://github.com/lushly-dev/afd/issues/2209)–[#2214](https://github.com/lushly-dev/afd/issues/2214)
  tracked in [STATUS.md](STATUS.md).
- **Verified:**
  - [What exists today](#2-what-exists-today) was read first-hand on 2026-11-13 at `f7ecbd43` and
    re-checked on 2026-11-22 at `dbc84611`.
  - All ten jobs are written as scenario files and pass the three checks
    ([STATUS](STATUS.md#how-the-jobs-were-checked)).
  - One fresh reader walked the draft from all three seats ([section 4](#4-what-the-walk-and-the-review-changed)).
  - One independent reviewer read this draft beside Screens from Jobs and Pointing on 2026-11-13,
    running scenarios against the runner.
  - Owner walkthrough (Q1–Q19) and two-model independent review completed 2026-11-22
    ([section 12](#12-owner-decisions-2026-11-22), [STATUS](STATUS.md#the-review)).
- **Not verified:**
  - Nothing in [Design](#6-design) is implemented yet; Phases 1–6 track delivery.

| Field | Value |
| --- | --- |
| Epic | [#1108](https://github.com/lushly-dev/afd/issues/1108) |
| Units touched | `foundations/specimen` (capture sets, comparison, review, the review pages), `integrations/specimen-afd` (the commands), `endpoints/specimen-cli`, `endpoints/specimen-server` (`#1320`); later `integrations/violet-afd`, `endpoints/umbel`, and `endpoints/loam` |
| Related | [Patterns](../patterns/patterns.proposal.md) (epic [#1073](https://github.com/lushly-dev/afd/issues/1073)), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md) (epic [#1109](https://github.com/lushly-dev/afd/issues/1109)), [Pointing](../pointing/pointing.proposal.md) (epic [#1110](https://github.com/lushly-dev/afd/issues/1110)), [Scales](../scales/scales.proposal.md) (epic [#1111](https://github.com/lushly-dev/afd/issues/1111)), [Specimens status](../../complete/specimens/STATUS.md) |
| Rank among the four | First. It is where a person's time goes |

## 1. Problem

When a person and an agent iterate on an interface, generating a version is cheap. The person's
time goes on choosing between versions and on being sure the chosen one is right, and the stack
has almost nothing for either.

1. **Variants have no home.** The owner's practice is to render comparable versions in the
   browser and keep the old ones until one is chosen. Today that means ad hoc switches and copies
   of pages. No tool groups several renderings as alternatives to one another.
2. **A choice loses its reason.**
   - Loam keeps its reasons in prose, in `design.md`'s history and in `decisions.md`.
   - Violet has a `reason` on every operation, but nothing reads it, Loam's DTCG import stamps
     every operation with the generic placeholder `'Imported from JSON'` instead of a human
     reason, and `changes.impact` drops it.
   - So a later agent cannot find why something is the way it is before changing it.
3. **Review gives everything equal weight.** Gates already settle contrast, target size, token
   use and most of accessibility. What they cannot settle is reported and then sent nowhere:
   - axe's incomplete checks;
   - a capture with insufficient evidence;
   - a theme that contradicts its declaration;
   - a judgement such as "the shell recedes".

   The person reviewing sees all or nothing.

**Goal.**

- A person compares variants captured under the same conditions and records a choice with its
  reason.
- An agent is told before it changes what that choice covers.
- A review shows the person only what no gate settled, and an answer given once settles that
  question until the page changes.

## 2. What exists today

### Specimen

- **The review page** (`foundations/specimen/src/browser/page.ts`, built by `specimen-build`) is
  an index grouped by title, with a text filter kept in `?q=` (lines 490 to 518).
  - It shows no results: no accessibility, theme, diff, coverage or profile outcome, and no
    screenshots.
  - A preview URL carries the theme, viewport, locale, motion and checkpoint (lines 167 to 184).
- **`specimen-diff`** (`src/diff.ts:247-296`) compares two observations across these channels:
  the DOM, the accessibility snapshot, axe findings, events, layout, styles and state.
  - It answers `changed`, `no-change-observed` or `insufficient-evidence`, with the differences
    and limitations.
  - It refuses captures whose browser, checkpoint, context or capture version differ (lines 35
    to 71). The refusal is an untyped `Error` reported as `SPECIMEN_DIFF_FAILED`
    (`integrations/specimen-afd/src/commands.ts:271`). Only the message names what differed.
  - It does not require both sides to be the same specimen.
  - The command's input is two whole observations (`commands.ts:139-146`). The CLI reads them
    from capture files (`endpoints/specimen-cli/src/cli.ts:298-302,330-331`). An agent calling
    over MCP would have to carry both observations as input.
  - It does no pixel comparison: a visual requirement answers `insufficient-evidence` (lines
    274 to 286).
  - Its output schema includes the `events` channel (`commands.ts:147-154`, fixed in
    [#1919](https://github.com/lushly-dev/afd/pull/1919) /
    [#1131](https://github.com/lushly-dev/afd/issues/1131)).
- **`specimen-render`** returns one whole observation and runs no axe. It captures without the
  accessibility option (`src/bench-runtime.ts:684-687`, option at line 255), so for native
  specimens the observation's axe channel is `'not-run'` (line 333).
  - Axe runs in `specimen-a11y`, in `specimen-run` on retained stories
    (`bench-runtime.ts:277,587-596`), and during `packBuild` (`bench-runtime.ts:950`).
  - The CLI writes `--output` to a file and still prints the whole result to stdout
    (`cli.ts:549`).
- **`specimen-list`** takes no filter (`commands.ts:285`) and returns every entry.
- **`specimen-matrix`** (`src/bench-runtime.ts:718-804`) captures one specimen across context
  axes, up to 64 cells, and diffs each cell against the first. It has no axis for variants.
- **`specimen-a11y`** reports `incompleteChecks`, which the README describes as what "a person
  must" decide (`foundations/specimen/README.md:201`). They never affect the status.
- **`specimen-themes`** compares pixels between themes. It reports `follows`, `declared`,
  `pinned`, `undeclared`, `contradicted` or `unavailable` (`schema.ts:711-718`).
- **Command hosting runs every call as a script.**
  - `endpoints/specimen-server` ([#1320](https://github.com/lushly-dev/afd/pull/1320)) hosts the
    19 MCP-exposed commands over stdio, wrapping `@modelcontextprotocol/sdk`'s `McpServer`
    directly (`endpoints/specimen-server/src/server.ts`) rather than `@lushly-dev/afd-server`.
  - Both the CLI and `endpoints/specimen-server` call `executeSpecimenCommand`, which hardcodes
    `{ actor: { kind: 'script' } }` (`integrations/specimen-afd/src/commands.ts:611`).
  - Nothing in Specimen currently enforces `confirmations: 'require-human'` or distinguishes a
    person's accepted elicitation from a script call.
- **The Specimen proposal** requires "a human review surface"
  (`docs/features/complete/specimens/specimens.proposal.md:71`). Only the index exists.

### AFD

- **Confirmation & actors.** A command can declare `confirmPrompt` (`spec/command-metadata.md`).
  - A server built with `confirmations: 'require-human'` runs such a command over MCP or HTTP
    only after the person accepts an elicitation (`packages/server/src/server-types.ts:245-261`).
  - It is off by default.
  - In-process calls (`server.execute`, DirectClient) are never gated.
  - AFD's `ActorKind` (`packages/core/src/actor.ts:10`) uses `'human' | 'agent' | 'service' | 'script' | 'test'`,
    and MCP calls default to `{ kind: 'agent' }` (`packages/server/src/server-types.ts:212`).
- **`CommandResult.alternatives`** (`packages/core/src/metadata.ts:154-165`) carries
  `{data, reason}` for an alternative not chosen. It is generic.

### Violet

- **`reason`** is optional on all five token operations and stored on every operation record
  (`foundations/violet/packages/core/src/types/operation.ts:19-99`). No rule reads it.
- **`changes.impact`** previews up to 50 changes and returns the commands that would apply them.
  Its change schema has no `reason`, so those commands lose one.
- **History is linear.** A node of type `experiment` ("A/B test variant", `types/node.ts:13`)
  inherits like any other node.

### Loam

- **Records.** `endpoints/loam/docs/design.md` has a dated history from line 601, and
  `endpoints/loam/docs/decisions.md` holds D1 to D164 (`decisions.md:179`) with superseded
  entries kept. Rejected alternatives survive only as prose, as with D22's rejected names. No
  screenshots or before-and-after pairs are kept.
- **Violet's `reason` carries no human rationale:** `endpoints/loam/packages/theme/src/tree/index.ts`
  imports committed DTCG JSON files from `endpoints/loam/packages/theme/tree/` via `import.tree`
  (`integrations/violet-afd/src/commands/import/tree.ts:368-371` → `import/json.ts:222`), which
  stamps every operation with the generic placeholder `'Imported from JSON'`.
- **The component checklist** (`.claude/skills/loam-design/references/checklist.md`).
  - CI runs item 1 (the token lint) and item 6 (axe).
  - A person checks the rest in the pull request, including "correct in light, dark and high
    contrast".
- **Screen specimens:** 142 at `dbc84611` (`134` in
  `endpoints/loam/packages/chrome/specimens/specimen.config.json` + `8` in
  `endpoints/loam/apps/notes/specimens/specimen.config.json`), so a capture of every screen is
  about that many observations.

## 3. Jobs

Each job is a scenario file in [`scenarios/`](scenarios/), written against the contracts in
[section 7](#7-command-contracts). The data is invented: a toolbar with density variants, an empty
list, a button and an editor screen. On 2026-11-22 the owner confirmed all ten jobs and split them
into **Slice 1** (`slice-1`: Jobs 1, 3, 4, 5, 6, 7, 8, 10) and **Slice 2** (`slice-2`: Jobs 2, 9)
([section 12](#12-owner-decisions-2026-11-22)).

| # | Job | Sentence | Slice |
| --- | --- | --- | --- |
| 1 | `compare-like-with-like` | When I am unsure between directions, I want several variants captured side by side under one context and checkpoint, with each one's checks, so that I compare the designs and not the setups | Slice 1 |
| 2 | `keep-what-was-not-chosen` | When I have chosen one variant, I want the others kept and retrievable until I discard them, so that I can go back to one without rebuilding it | Slice 2 |
| 3 | `record-the-choice` | When I choose a variant, I want the choice, the reason and the captures it rested on recorded together and written beside the code, so that a later agent or I can find why it is the way it is | Slice 1 |
| 4 | `be-told-before-undoing` | When an agent is about to change something a decision covers, I want it shown the decision and its reason first, and the change put to me in review if it goes ahead, where accepting it replaces the old decision, so that a decision is never undone silently or left stale | Slice 1 |
| 5 | `review-only-what-needs-eyes` | When I review a change, I want to see only what no gate settled, grouped by cause, each with its before and after captures, so that my attention goes where a machine cannot decide | Slice 1 |
| 6 | `turn-a-check-into-a-question` | When a check cannot decide, I want it put to me as a question I can answer once with a reason, so that it is neither buried in a report nor asked again while nothing changes | Slice 1 |
| 7 | `refuse-a-misleading-comparison` | When two captures or sets were made under different conditions, I want the comparison refused with the difference named, so that I never take a theme change for a design change | Slice 1 |
| 8 | `stay-quiet-about-what-is-settled` | When the gates and earlier answers have settled everything in a change, I want the review to say so in one line and list nothing, so that a review with nothing to judge costs me nothing | Slice 1 |
| 9 | `reverse-a-decision` | When I change my mind about a choice or a discard, I want to reverse it with a reason, even when the original comparison is gone, so that a decision is never a one-way door and the reason an agent finds is the current one | Slice 2 |
| 10 | `capture-a-baseline` | When I start reviewing a project, I want its specimens captured once, with their checks, into a labelled set that answers with ids and counts only, so that a review has something to compare against without filling the agent's context | Slice 1 |

Job 7 is the refusal and job 8 is the quiet one. Other jobs also contain refusals:

- discarding the chosen variant (2);
- choosing without a reason, or a variant that failed a gate (3);
- accepting the undoing of a decision without replacing it (4);
- answering an item no review raised (6);
- restoring a variant whose code is gone (9).

**What writing them changed.**

- **Captures became saved and addressed.** Over MCP, `specimen-diff` would have the agent carry
  both observations. So sets are saved, and `specimen-diff` accepts `{ set, id }` on either side.
- **The incompatibility refusal became typed.** Job 7 needs to know which condition differed, so
  `CAPTURES_INCOMPARABLE` names the field in its message.
- **An answer to a review question became a decision.** A decision already has a question,
  options, a choice, a reason and evidence. So `decision-record` takes review `items`, and there
  is no separate store of answers.
- **Review carries the decisions**, so the person sees them even when the agent did not call
  `decision-check`.
- **Two refusals were added:**
  - `CHOSEN_VARIANT`: a decision must keep a chosen variant.
  - `VARIANT_UNAVAILABLE`: a variant is never shown in another theme than the one asked for.
- **`decision-open` was cut.** A comparison set is enough before the choice.
- **List assertions became dotted index paths.** Plain arrays under `expect.data` are compared
  whole and object arrays require exact length
  (`packages/testing/src/runner/evaluator.ts:182-184,197-220,459-462`), so a partial list would
  have failed.
- **Expectations use no step references.** The runner resolves `${{ steps[N] }}` in `input` only
  (`packages/testing/src/runner/scenario-runner.ts:345`), so a generated id is asserted with
  `matches` and a fixture value is written literally.

## 4. What the walk and the review changed

One fresh reader walked the first draft on 2026-11-13 from all three seats: the person, the job
list and the calling agent. The verdict was revise, with four blockers and ten improvements. Each
was taken back to the jobs and the scenarios.

| Finding | Change |
| --- | --- |
| Nothing cleared a `changed` item, so one intended token change opened an item per specimen on every review | Changes are grouped by cause, a person answers a group once, and an accepted undo of a decision needs `supersedes` (`SUPERSEDE_REQUIRED`). Shown in job 4 |
| Set ids (`compare-<n>`, labels) were neither unique nor durable, and evidence lived only in `.specimen/` | Set ids are content-addressed. A label is a local pointer. Recording a decision writes its evidence's screenshots and manifest under `specimens/` ([6.4](#64-decisions-are-files-in-the-repository)) |
| Saved sets had no axe results: `specimen-render` captures with axe `'not-run'` | Sets are captured with axe by default. The fixtures now record what such a capture holds, including the incomplete check |
| Building sets one `render` at a time floods the agent's context, about 250 calls of 10k to 50k tokens for Loam | `specimen-capture` captures many specimens and returns ids and counts only. `render { save }` was dropped. Exit criterion 1 now covers it |
| No way to make the first `main` set, list decisions, find undecided comparisons, or see subjects gone stale | Job 10 and `specimen-capture`, which records the revision and whether the checkout was dirty. `decision-list` returns current decisions with their stale globs, and comparisons nobody decided. `DECISION_NOT_FOUND` points to it |
| `compare` ran no gates, so a failing variant could be chosen | Comparisons run axe. `CHOSEN_FAILS_GATE` refuses choosing a variant that failed |
| Kept, unchosen variants raised review items | Left out of the review, and counted as `settled.kept` |
| Things going wrong: superseding needed a set that may be gone; a discard could not be undone; reviewing mixed contexts was not refused; slugs could collide | Superseding carries the old evidence (job 9). `decision-restore` with `EXPORT_MISSING` (job 9). `specimen-review` refuses mixed contexts (job 7). Random ids ([5](#5-shared-conventions)) |
| A review listed as a read could not resolve item ids | Item ids describe themselves: kind, cause or specimen, member scope, and the two set ids. The review stays a read |
| Confirmation already exists in AFD but was not named; the CLI always runs as a script | Named ([6.6](#66-who-decides)), and the proposal says plainly that the CLI cannot give a person's answer |
| `SPECIMEN_NOT_FOUND` pointed to an unfiltered `specimen-list` (20k to 40k tokens on Loam) | The suggestion names the nearest ids |
| The claim that carrying captures is a problem everywhere was wrong; the CLI reads files | Corrected in section 2 |
| What a model must know without a skill | Written into descriptions and results ([6.7](#67-what-a-model-is-told)) |
| Job 2 stopped short of its "so that"; reversal had no job | Job 2 goes back to a kept variant. Reversal is job 9 |

Declined: none.

The independent review of 2026-11-13 read the three drafts together and ran scenarios against
the runner. The coordinator set conventions across the three drafts ([section 5](#5-shared-conventions)).

| Finding | Change |
| --- | --- |
| Blocker: the runner resolves step references in `input` only, so three expectations compared a literal `${{ … }}` string | Rewritten as `matches` or fixture literals. A check now scans every `expect` for references ([STATUS](STATUS.md#how-the-jobs-were-checked)) |
| A review answer became a current decision on the whole specimen, so any later change to it would need `SUPERSEDE_REQUIRED` | An answer is its own kind, scoped to its item's cause or check and fingerprint. It has no subjects, `decision-check` never returns it, and it stops matching when the content changes ([6.4](#64-decisions-are-files-in-the-repository)) |
| Superseding a variant choice by accepting a review item left a record that was half choice, half answer | Accepting an item that names a choice writes a choice: same variants, chosen, kept and discarded, the after set as evidence, and the item under `answers`. `options` never appear on a choice |
| The default subjects were not stated | `subjects.specimens` defaults to the chosen variant; a decision may name more |
| A section reference and a field name were out of step | Fixed: `open.0.decision.decision` matched `decisions.0.decision` (expanded to `decisions` array in the 2026-11-22 walkthrough) |

The three-pass owner walkthrough (Q1–Q19) and two-model independent review on 2026-11-22
tightened the contracts without adding jobs or commands:

- Promoted Jobs 6 and 8 into Slice 1 (`slice-1`), leaving Jobs 2 and 9 in Slice 2 (`slice-2`).
- Aligned the shared base-32 id alphabet to Crockford base-32 (`[0-9a-hjkmnp-tv-z]{12}`) with
  Pointing §4.0.
- Expanded the capture content hash to include all diff- and review-relevant normalized inputs
  (events, element scroll dimensions, channel completeness, loaded fonts, and axe incomplete checks).
- Locked `open[].cause` as a structured object (`{ channel, target?, property?, left?, right? }`),
  `settled.answered` as a count of settled review items, `kept`-before-`blocking` precedence, and
  self-describing member-scope hashes on `changed` item ids so filtered reviews never settle unseen
  specimens.
- Routed matching-fingerprint `chosen: 'reject'` answers to `blocking` (`kind: 'rejected'`, with
  `reason`), covered by new steps in Scenario 06, and kept `slug?`/`question?` optional on Mode 3
  for Screens from Jobs compatibility.
- Preserved independent choices when one review item touches multiple choices (writing one
  successor choice per superseded choice), swapped old→new `chosen` in `subjects.specimens` on
  variant reversal (verified in Scenario 09 with exact subjects and removed local comparison set),
  and defined `decidedBy: { kind: 'person' }` as deriving from accepted MCP human elicitation
  independently of AFD's invoking `ActorKind` (`'agent'`).
- Refreshed §2 baseline facts and line numbers against `dbc84611` and fixed fixture consistency in
  `decided.json`.

## 5. Shared conventions

Confirmed by the owner across Design Decisions ([#1108](https://github.com/lushly-dev/afd/issues/1108)),
Screens from Jobs ([#1109](https://github.com/lushly-dev/afd/issues/1109)), and Pointing
([#1110](https://github.com/lushly-dev/afd/issues/1110)) on 2026-11-21 and 2026-11-22 (Q1).

- **Content-addressed ids for captured data.** A set is `set-` and 12 hex digits
  ([6.2](#62-capture-sets) lists exactly what is hashed).
- **Random ids for records that people or agents write.**
  - Decisions are `dec-` and 12 lowercase Crockford base-32 characters (`[0-9a-hjkmnp-tv-z]{12}`,
    aligned with [Pointing §4.0](../pointing/pointing.proposal.md)), such as `dec-q7k2m4xab3na`.
    Pointing's notes and points take `note-` and `pt-` in the same form.
  - A slug is kept as a field for readability, never as the id, so two branches cannot collide on
    the same slug and date.
- **Records that are written to the repository** live under `specimens/`:
  `specimens/decisions/<id>.json`, evidence screenshots under `specimens/evidence/<set id>/`, and
  Pointing's `specimens/notes/<id>.json`.
  - A command writes these files and never runs `git commit`. They reach `main` in the pull
    request like any other change.
- **Local data** (sets, runs and points) lives under `.specimen/`, which the root `.gitignore`
  ignores. Confirmed on 2026-11-21; [#1132](https://github.com/lushly-dev/afd/issues/1132) added
  the entry.
- **One review system, this one.**
  - A Screens from Jobs run saves its captures as an ordinary set, keyed `<id>/<step>` (the job
    specimen's unique id plus step number).
  - `specimen-review` compares those sets like any other and groups changes by cause (largest
    group first, specimen id as tie-breaker).
  - Accepting a change is answering a review item, which needs a person's confirmation
    ([6.6](#66-who-decides)).
  - Screens from Jobs therefore drops its own accept and diff commands and its committed
    baseline.
- **Job specimens.**
  - Until the Screens from Jobs runner exists, `specimen-capture` with no ids skips job
    specimens and reports how many it skipped. Its result names `specimen-job-run`.
  - Once that runner lands, `specimen-capture` runs job specimens through it.
- **Pattern gate cases (amended 2026-11-22 for [Patterns](../patterns/spec.md), #1073).**
  - `specimen-capture` with no explicit `ids` (and no `filter` explicitly selecting `kind: 'gate'`)
    skips synthesized Pattern gate cases (`<case>--gate--<gate>`, `kind: 'gate'`) and reports how
    many it skipped in `skipped.gates` (with `skipped.gatesNext: 'specimen-run'` when non-zero;
    `skipped.next` stays `'specimen-job-run'` for skipped job specimens). Gate cases are behavioral
    pass/fail tests rather than visual review captures; callers who explicitly pass a gate id in
    `ids` or request `filter.kind` including `'gate'` still capture them.
- **One host.** Phase 5 extends existing `endpoints/specimen-server`
  ([#1320](https://github.com/lushly-dev/afd/pull/1320)) with `confirmations: 'require-human'`;
  the other two proposals use the same host.
- **Mutations.** Every command that writes files is declared a mutation.

## 6. Design

### 6.1 Variants are specimens

A variant is a specimen. Each direction is its own specimen export, such as `Dense`, `Airy` and
`Grouped` in one module, which is how the owner already keeps comparable versions. Whole screens
are specimens too. A screen in a job's state is driven by
[Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md).

### 6.2 Capture sets

`specimen-capture { ids? | filter?, context?, checkpoint?, label?, axe? }` captures many
specimens in one context and checkpoint into a set under `.specimen/sets/`. A Screens from Jobs
run writes the same kind of set, keyed `<id>/<step>`.

- **Axe runs by default,** as `specimen-a11y` runs it.
- **The result holds ids and counts only.** No observation is returned. It gives:
  - the set id and its label;
  - the revision, and whether the checkout was dirty;
  - counts: `captured`, `unavailable`, and `axe` (`passed`, `failed`, `incomplete`, where
    `incomplete` is orthogonal to `passed`/`failed` — a capture with zero violations and at least
    one incomplete check counts in both `passed` and `incomplete`);
  - the unavailable ids, with their reasons;
  - `skipped`.
- **A set id is content-addressed:** `set-` and the first 12 hex digits of a SHA-256 over a
  canonical JSON of the following.
  - **What is hashed:**
    - the context (theme, viewport, container, locale, reduced motion and motion);
    - the checkpoint's name, action mode and baseline;
    - the browser's name and version;
    - the capture and normalization versions;
    - whether axe ran;
    - for each capture, sorted by key: its key and its content hash.
  - **A capture's content hash is new, since Specimen has none today.** It hashes every normalized
    observation input that affects `specimen-diff` or `specimen-review` outcomes:
    - normalized DOM (`normalizeDom(channels.dom.raw)`);
    - accessibility snapshot (`channels.a11y.snapshot`);
    - axe result (`status`, sorted `violations` `[rule, impact, targets]`, and sorted
      `incompleteChecks` `[rule, targets]`);
    - normalized event history (`eventHistory` when `completeness.events.status` is neither
      `'not-requested'` nor `'unsupported'`, so event-only changes always produce distinct set ids);
    - normalized elements (`tag`, `attributes`, `box`, `scroll`, `styles`, `state`,
      `accessibility`);
    - channel `completeness` (status, scope, reasons, which drive `insufficient-evidence`);
    - loaded font identities (`manifest.context.resources.fonts`, which affect diff limitations).
  - **What is not hashed:**
    - timestamps, elapsed times and ready deadlines;
    - screenshot bytes, whose pixels are not reproducible;
    - the revision and whether the tree was dirty. These are recorded beside the set, and a set
      captured again at another revision adds that revision to its list (`revisions`).
  - **The same checkout captured twice gives the same id** (job 10), and parallel branches cannot
    collide.
  - **Pages see the real clock** (`baseline.clock: 'real'`, `foundations/specimen/src/types.ts:633`).
    A specimen that renders the time therefore hashes differently on every capture until it is
    given a fixed clock. The review reports such a specimen as `changed`, with the clock-driven
    difference.
- **Job specimens and Pattern gate cases are skipped** when no `ids` (and no `filter` selecting
  `kind: 'gate'`) are given: `skipped.jobs` counts job specimens (`skipped.next: 'specimen-job-run'`,
  until Screens from Jobs' runner exists) and `skipped.gates` counts synthesized Pattern gate cases
  (`<case>--gate--<gate>`, `skipped.gatesNext: 'specimen-run'`; amended 2026-11-22 for
  [Patterns](../patterns/spec.md)).
- **A label** (`main`, `branch`) is a local pointer to a set id. It is not a git ref. A set is
  captured from the working tree, so to capture `main`, run it in a checkout of `main`. The set
  records the revision and whether the tree was dirty, and the review shows both.
- **`specimen-diff`** accepts `{ set, id }` on either side, as well as an observation. Different
  conditions are refused with `CAPTURES_INCOMPARABLE`, typed. `allowContextDifferences` still
  lets an intended difference through.

### 6.3 Comparison

`specimen-compare { ids, context?, checkpoint? }` captures two to eight variants, with axe, into
a set of kind `compare`, and diffs each against the first.

- **Each capture reports its axe status and `violations` (array of axe rule id strings),** so a
  failing variant is visible before it is chosen.
- **It refuses an unknown id before capturing anything** (`SPECIMEN_NOT_FOUND`), and the
  suggestion names the nearest ids.
- **It refuses a variant whose declared themes exclude the requested one**
  (`VARIANT_UNAVAILABLE`).
- **`page`** links to `compare.html?set=`, which shows the screenshots side by side with the
  structured differences.
- **Variants differ in mechanism** (amended 2026-11-24 for
  [Agent-First Design](../agent-first-design/spec.md#42-amendment-to-design-decisions-docsfeaturesactivedesign-decisionsdesign-decisionsproposalmd)):
  `specimen-compare` variants should differ in how they solve the problem, not only in styling
  density.

No pixel comparison is added.

### 6.4 Decisions are files in the repository

A decision is one JSON file, `specimens/decisions/<id>.json`, with a random Crockford base-32 id
`dec-<12>` ([section 5](#5-shared-conventions)). A decision is one of two kinds.

**A choice** picks one of several variants.

- **Fields:**
  - `kind: choice`, `slug`, `question` and `status` (`current` or `superseded`).
  - `variants`, `chosen`, `kept`, `discarded`, and `discardedAt` (the revision at which each was
    discarded).
  - `reason`, which is required.
  - `evidence`: the set id and the evidence directory.
  - `subjects`: `specimens`, `files` (globs) and `tokens`. `subjects.specimens` defaults to the
    chosen variant, and a decision may name more, such as the screens that show it.
  - `answers`: present when the choice came from accepting review items.
  - `supersedes` (the prior choice id it replaced), `decidedAt`, and `decidedBy`
    (`{ kind: 'person' | 'script' | 'test' }`, extended with `panel` on provisional Mode 3 review
    answers in [Amendment: Agent-First Design Phase A](#amendment-agent-first-design-phase-a-approved-2026-11-24);
    see [6.6](#66-who-decides)).
- **Discard and restore** apply to a choice only (Slice 2, Phase 6).
  - `decision-discard` moves variants from kept to discarded, and names the exports that can now
    be deleted and the revision.
  - `decision-restore` moves them back while their export exists. Otherwise it refuses with
    `EXPORT_MISSING` and names the revision to recover the export from.

**An answer** settles or rejects one or more review items that name no choice (or rejects an item
that names a choice, without replacing the choice).

- **Fields:** `kind: answer`, optional `slug` and `question` (derived from the item when omitted),
  `chosen` (`accept` or `reject`), `reason`, `decidedAt` and `decidedBy`, and `answers`. Each
  answer entry gives the item, the specimen/member scope, the cause or check, and the fingerprint
  of what it looked at.
- **No subjects.** An answer is not returned by `decision-check`, never triggers
  `SUPERSEDE_REQUIRED`, and does not guard its specimen.
- **It applies only to the same item on the same content.** An `accept` settles the item while the
  fingerprint matches; a `reject` holds it in `blocking` (`kind: 'rejected'`) with the owner's
  `reason` until the content changes. Once the content changes, the answer matches nothing and
  stays as history.

**Accepting an item that names one or more choices** writes one successor choice per superseded
choice, never an answer and never merging distinct choices into one record.

- `decision-record { items, chosen: accept, supersedes, reason }` refuses without `supersedes`
  covering every choice named on the accepted items (`SUPERSEDE_REQUIRED`). `supersedes` accepts
  a single decision id or an array of ids (`string | string[]`).
- For each superseded choice, `decision-record` writes one new `choice` file that preserves that
  choice's own `slug`, `question`, `variants`, `chosen`, `kept`, `discarded` and `subjects`, sets
  `supersedes` to that old id, takes the after set as its evidence and the new reason, and lists
  the accepted items under `answers`.
- Each old choice becomes `superseded`. Discard, restore and `decision-check` then continue
  working independently for every superseded choice. `options` never appear on a choice.

**Superseding by choice** (job 9) needs no local comparison set: the new choice carries the old
one's committed evidence unless given a new one, and inherits `slug`, `question` and `variants`
when omitted. When superseding to a different `chosen` variant without explicit `subjects`, the
new choice swaps the old `chosen` for the new `chosen` in `subjects.specimens` (preserving any
extra subjects such as screens that embed it), so the newly chosen variant is guarded and the old
one moves cleanly to `kept`. `decision-check` returns current choices only.

**What is written to the repository:**

- The decision file(s).
- Under `specimens/evidence/<set id>/`: each evidence capture's screenshot, and a manifest of its
  key, content hash, context, checkpoint, revision and axe status.
- The command writes these files and never commits them.
- Full observations stay in `.specimen/`. A decision's evidence therefore survives a merge and a
  clean checkout as screenshots and hashes, not as observations that can be diffed again.

**`decision-list`** returns the current choices sorted by `decision` id ascending. For each, it
gives the subject globs that match no file (`stale`), and the comparison sets that no decision
cites (`undecided`).

### 6.5 Review

`specimen-review { before, after, ids? }` is a read. `before` and `after` are set ids or labels.
It refuses sets captured under different conditions (`CAPTURES_INCOMPARABLE`) and a label or id
with no set (`CAPTURE_SET_NOT_FOUND`). When `ids` is given, it matches exact specimen ids and
`<id>/<step>` capture-key prefixes for job specimens.

**Precedence:** kept unchosen variants of current choices are excluded first (`settled.kept`),
even if a kept variant fails axe (so a kept failing variant like `toolbar--grouped` never blocks
a review).

| Outcome | Where it goes |
| --- | --- |
| A kept, unchosen variant of a current decision | Left out first, counted as `settled.kept` (captures/specimens) |
| axe passed with nothing incomplete, or diff `no-change-observed` | Settled, counted as `settled.unchanged` (captures/specimens) |
| diff `changed` | Open, `changed`. Grouped by exact cause `{ channel, target?, property?, left?, right? }`. Carries `decisions: Array<{ decision, reason }>` (empty when no current choice matches the group's shown members) |
| axe `incompleteChecks` in the after set | Open, `incomplete-check`, one per specimen and check |
| diff `insufficient-evidence` | Open, `insufficient-evidence`, with the limitation |
| axe failed, capture unavailable, or a matching-fingerprint `reject` answer | Blocking: for the agent to fix (`kind: 'axe-failed' \| 'unavailable' \| 'rejected'`; `'rejected'` carries the owner's `reason`), never an open question and never counted as settled |
| An open item that an `accept` answer, or a choice's `answers`, settled with a matching fingerprint | Settled, counted as `settled.answered` (**review items**, 1 per settled cause group or check item) |

- **Job sets.** A Screens from Jobs set is compared like any other, step by step, and its
  changes group by cause the same way. That proposal keeps no review, accept or diff of its own.
- **Item ids describe themselves, including member scope,** so the review is not stored and a
  filtered review can never authorize unseen specimens:
  - `changed:<cause-hash>:<members-hash>:<before-set>..<after-set>` where `<members-hash>` is a
    short SHA-256 digest over the sorted capture keys shown in that item's `ids`.
  - `check:<specimen>:<check>:<before-set>..<after-set>`.
  - `decision-record` recomputes the review from the two sets and the item's member scope, refuses
    any item they do not raise (`REVIEW_ITEM_NOT_FOUND`), checks `SUPERSEDE_REQUIRED` only against
    choices touching those shown members, and records those exact members so an unfiltered review
    still shows any unseen specimens that share the cause.
- **Answers.** `decision-record { items, chosen, reason }` answers one or more items with
  `accept` or `reject`.
  - Accepting an item whose `decisions` is non-empty needs `supersedes` covering every listed
    choice (`SUPERSEDE_REQUIRED`), and writes one successor `choice` per superseded choice
    ([6.4](#64-decisions-are-files-in-the-repository)). Any other answer (including
    `chosen: 'reject'`) writes an `answer`.
  - Either way, the record stores a fingerprint of what each item looked at: the cause, member
    keys, and before/after values, or the check's target content. While the fingerprint matches,
    an `accept` counts the item as `settled.answered` (1 per settled review item), and a `reject`
    routes it to `blocking` (`kind: 'rejected'`, carrying `reason`) so the review never goes quiet
    until the content changes.
- **An open `changed` item names every choice touching its shown members** as
  `decisions: Array<{ decision, reason }>`, matching the `decision` field `decision-check`
  returns.
- **Order:** groups by cause (largest group first, with specimen id as tie-breaker), then
  insufficient evidence, then checks, each by specimen id.
- **`page`** links to `review.html?before=&after=`, which shows open items and blocking
  rejections, and badges any answer with `decidedBy: { kind: 'script' }`.
- **Theme outcomes** join once sets are captured across themes. They are not in Slice 1.

### 6.6 Who decides

- **Commands that need a person's confirmation.**
  - **`decision-record`** *(amended 2026-11-24 for
    [Agent-First Design](#amendment-agent-first-design-phase-a-approved-2026-11-24))*: declares
    static `confirmationMode: 'host-verified'` with `HumanRelay` over MCP
    (`spec/command-metadata.md:40,145-158`). Because `host-verified` never sends form elicitation
    regardless of `confirmations`, MCP calls to `decision-record` are confirmed exclusively via
    `HumanRelay` (`CONFIRMATION_REQUIRED` / `CONFIRMATION_DECLINED`), superseding the earlier
    form-elicitation provenance rule for `decision-record`. Provisional panel Mode 3 settlements
    run in-process from `panel-review` via `DirectRegistry` (`spec/command-metadata.md:158`).
  - **`decision-discard` and `decision-restore`** retain `confirmPrompt` under
    `confirmations: 'require-human'` on `endpoints/specimen-server`
    ([#1320](https://github.com/lushly-dev/afd/pull/1320)), deriving `decidedBy: { kind: 'person' }`
    from accepted human elicitation.
  - Phase 5 ([#2213](https://github.com/lushly-dev/afd/issues/2213)) wires both paths on
    `endpoints/specimen-server` (`HumanRelay` host-verified confirmation for `decision-record`
    and `confirmations: 'require-human'` for `decision-discard`/`decision-restore`). It remains
    the single host shared with Screens from Jobs and Pointing.
- **The CLI runs as a script.** It records `decidedBy: { kind: 'script' }`. CLI answers settle
  local review-triage items for solo-owner terminal workflows, and `review.html` badges them
  visibly as `script` (owner decision Q7). Under the 2026-11-24 Agent-First Design amendment,
  release cards, guidance approvals, `design-release` and `panel-calibrate` outside MCP require
  interactive review-page or CLI human confirmation
  (`decidedBy: { kind: 'person', channel: 'review-page' | 'cli' }`, refusing `script`/agent
  actors with `PERSON_REQUIRED`).
- **Scenarios cannot show any of this,** because every step runs as one test actor
  (`decidedBy: { kind: 'test' }`).

### 6.7 What a model is told

An agent may have no skill installed, so the commands carry what it must know:

| Where | It says |
| --- | --- |
| `specimen-capture` description | A label is a local name for a set, not a git ref; capture `main` from a checkout of `main` |
| `specimen-review` description and `CAPTURE_SET_NOT_FOUND` | Both sets must exist; `specimen-capture` makes them |
| `decision-check` description | Call it with the files, specimens or tokens you are about to change, before editing |
| `specimen-review` result, each open item | These are questions for the person; show them, and do not answer them yourself |
| `DECISION_NOT_FOUND` and `decision-check` description | `decision-list` gives every current decision id |

### 6.8 Finding decisions before a change

`decision-check { files?, specimens?, tokens? }` returns each current choice whose subjects match,
with its choice, reason and what matched. It returns an empty list when nothing matches. It
informs and does not block (owner decision Q3).

## 7. Command contracts

Wire contracts are locked here and in [`scenarios/`](scenarios/) (no separate `spec.md`; owner
decision Q14). Every command lives in `integrations/specimen-afd`, with its logic in
`foundations/specimen`, and is exposed by both `endpoints/specimen-cli` and
`endpoints/specimen-server` in the phase that implements it.

| Command | New | Input | Result |
| --- | --- | --- | --- |
| `specimen-capture` | Yes, mutation (writes a set) | `ids` or `filter`, `context`, `checkpoint`, `label`, `axe` (default `true`) | `set`, `label`, `revision`, `dirty`, `counts` (`captured`, `unavailable`, `axe.passed`, `axe.failed`, `axe.incomplete` — `incomplete` orthogonal to `passed`/`failed`), `unavailable` (`id`, `reason`), `skipped` (`jobs`, `gates`, `next`, `gatesNext`) |
| `specimen-compare` | Yes, mutation (writes a set) | `ids` (2 to 8), `context`, `checkpoint` | `set`, `context`, `checkpoint`, `captures` (`id`, `status`, `axe`, `violations: string[]`, `screenshot`), `differences` (`id`, `against`, `status`, `channels`), `page` |
| `specimen-diff` | Extended | `left` and `right` each an observation or `{ set, id }`, `allowContextDifferences`, `requireVisual` | As today (`events` channel already landed in `#1919`) |
| `specimen-review` | Yes, read | `before`, `after` (set ids or labels), `ids` (exact specimen ids or `<id>` job prefixes) | `before` and `after` (`set`, `label`, `revision`, `dirty`), `open` (sub-shapes below), `blocking` (sub-shapes below), `settled` (`unchanged` captures, `kept` captures, `answered` review items), `page` |
| `decision-record` | Yes, mutation (writes files), `confirmationMode: 'host-verified'` over MCP *(amended 2026-11-24; see [§12 amendment](#amendment-agent-first-design-phase-a-approved-2026-11-24))* | Three input modes (below) plus card mode; always `chosen`, `reason` | Single decision: `decision`, `kind`, `path`, `chosen`, `kept`, `supersedes`, `answers`, `evidence`, `evidenceDir`, `subjects`; multi-choice supersede (`supersedes` array length ≥ 2) or batch `cards`: `{ decisions: Array<SingleDecisionResult> }` |
| `decision-get` | Yes, read | `decision` | The record, with `evidence.captures` |
| `decision-list` | Yes, read | none | `decisions`, current choices sorted by `decision` id ascending (`decision`, `question`, `chosen`, `stale`); `undecided` (`set`, `ids`) |
| `decision-check` | Yes, read | `files`, `specimens`, `tokens` | `decisions`, current choices only (`decision`, `question`, `chosen`, `reason`, `supersedes`, `matched`) |
| `decision-discard` | Yes, mutation (writes files), `confirmPrompt` (Slice 2) | `decision`, `variants` | `discarded`, `kept`, `exports` (`module`, `exportName`), `revision` |
| `decision-restore` | Yes, mutation (writes files), `confirmPrompt` (Slice 2) | `decision`, `variants` | `kept`, `discarded` |

**`specimen-review` element sub-shapes:**

- **`open[]`:** `{ item` (member-scoped id; see [6.5](#65-review))`, kind: 'changed' | 'incomplete-check' | 'insufficient-evidence', ids: string[], cause?: { channel, target?, property?, left?, right? }, check?: string, limitation?: string, question: string, options: ['accept', 'reject'], captures: Array<{ key: string, before?: string, after: string }>, decisions: Array<{ decision: string, reason: string }> }`.
- **`blocking[]`:** `{ kind: 'axe-failed' | 'unavailable' | 'rejected', ids: string[], item?: string, reason?: string, violations?: string[] }`.

**`decision-record` input modes (Q14):**

1. **New choice (`set`):** requires `slug`, `question`, `set`, `chosen` (a variant id in `set`
   whose axe check did not fail), `reason`; optional `subjects` (`subjects.specimens` defaults to
   `[chosen]`).
2. **Supersede choice (`supersedes: string | string[]`):** requires `supersedes`, `chosen`,
   `reason`; optional `set`, `items`, `slug`, `question`, `subjects`. Inherits `slug`, `question`
   and `variants` from the superseded choice when omitted. When `items` is given with
   `chosen: 'accept'`, writes one successor `choice` per superseded id (preserving each choice's
   own `variants`, `chosen`, `kept`, `discarded` and `subjects`, taking the after set as evidence
   and recording `items` under `answers`). When changing `chosen` to another variant on a single
   choice without explicit `subjects`, swaps old `chosen` → new `chosen` in `subjects.specimens`
   while preserving extra subjects.
3. **Review answer (`items` without `supersedes`):** requires `items`, `chosen` (`'accept'` or
   `'reject'`), `reason`; optional `slug` and `question` (derives `question` from the review item
   when omitted); omits `subjects`. Refuses with `SUPERSEDE_REQUIRED` when `chosen === 'accept'`
   and any item has a non-empty `decisions` list.

| Error | From | Recovery the suggestion names |
| --- | --- | --- |
| `SPECIMEN_NOT_FOUND` | `specimen-compare`, `specimen-capture` | The nearest ids |
| `VARIANT_UNAVAILABLE` | `specimen-compare` | The themes the variant declares |
| `CAPTURES_INCOMPARABLE` | `specimen-diff`, `specimen-review` | Capture both under the same conditions with `specimen-capture`, or pass `allowContextDifferences` |
| `CAPTURE_SET_NOT_FOUND` | `specimen-review`, `specimen-diff`, `decision-record` | `specimen-capture` with the label; labels are not git refs |
| `REASON_REQUIRED` | `decision-record` | Give the reason the choice rests on |
| `VARIANT_NOT_FOUND` | `decision-record`, `decision-discard`, `decision-restore` | The decision's variants, by id |
| `CHOSEN_FAILS_GATE` | `decision-record` | Fix the variant and compare again with `specimen-compare` |
| `SUPERSEDE_REQUIRED` | `decision-record` | Pass `supersedes` with the choice(s) the item names, and a new reason |
| `REVIEW_ITEM_NOT_FOUND` | `decision-record` | `specimen-review` for the items the two sets raise |
| `DECISION_NOT_FOUND` | `decision-get`, `decision-record`, `decision-discard`, `decision-restore` | `decision-list` |
| `CHOSEN_VARIANT` | `decision-discard` | `decision-record` with `supersedes` to change the choice |
| `EXPORT_MISSING` | `decision-restore` | Recover the export from the revision it was discarded at, then restore |

Every command is used by a scenario, and every error is shown by one.

## 8. Phases

Work is delivered in six phased sub-issues under [#1108](https://github.com/lushly-dev/afd/issues/1108).
CLI (`endpoints/specimen-cli`) and MCP (`endpoints/specimen-server`) wiring ships inside each
phase so no command lands half-wired. Prior prerequisites `.specimen/` in `.gitignore`
([#1132](https://github.com/lushly-dev/afd/issues/1132)) and `events` in `specimen-diff`
([#1919](https://github.com/lushly-dev/afd/pull/1919)) are already merged.

- **Slice 1 (Jobs 1, 3, 4, 5, 6, 7, 8, 10):**
  1. **Capture sets & typed diff ([#2209](https://github.com/lushly-dev/afd/issues/2209), unblocked; unblocks Screens from Jobs Phase 2 [#2037](https://github.com/lushly-dev/afd/issues/2037)).**
     Per-capture content hash (covering DOM, a11y, axe, events, element box/scroll/styles/state,
     channel completeness, and fonts), `specimen-capture` (content-addressed `set-`, labels, axe
     default on with orthogonal `incomplete`, `skipped.jobs` + `skipped.gates`, ids/counts only),
     `specimen-diff` `{ set, id }` + typed `CAPTURES_INCOMPARABLE`, CLI + `specimen-server` wiring.
  2. **Side-by-side comparison ([#2210](https://github.com/lushly-dev/afd/issues/2210), blocked on [#2209](https://github.com/lushly-dev/afd/issues/2209)).**
     `specimen-compare` with axe, `SPECIMEN_NOT_FOUND` / `VARIANT_UNAVAILABLE`, `compare.html?set=`
     with a browser test, CLI + `specimen-server` wiring.
  3. **Decision records & pre-edit check ([#2211](https://github.com/lushly-dev/afd/issues/2211), blocked on [#2209](https://github.com/lushly-dev/afd/issues/2209) and [#2210](https://github.com/lushly-dev/afd/issues/2210)).**
     `decision-record` (three input modes, one successor choice per superseded choice on
     `supersedes: string[]`, old→new `chosen` swap in `subjects.specimens`), `decision-get`,
     `decision-list` (sorted by id ascending), `decision-check`, `specimens/decisions/` +
     `specimens/evidence/` storage, CLI + `specimen-server` wiring. Phase 3 tests cover
     `decision-list`, `DECISION_NOT_FOUND`, and two-choice supersession ahead of Slice 2.
  4. **Review of unsettled items ([#2212](https://github.com/lushly-dev/afd/issues/2212), blocked on [#2211](https://github.com/lushly-dev/afd/issues/2211)).**
     `specimen-review` (largest-first cause grouping, structured `cause`, member-scoped item ids,
     `decisions[]`, `kept`-before-`blocking`, `accept` → `settled.answered` [items], `reject` →
     `blocking` `rejected` with `reason`, `incomplete-check`/`insufficient-evidence`),
     `decision-record` `items` mode + fingerprints, `review.html?before=&after=` (with script-actor
     badge) + browser test, CLI + `specimen-server` wiring.
  5. **Host-verified & human-elicited confirmations ([#2213](https://github.com/lushly-dev/afd/issues/2213), blocked on [#2211](https://github.com/lushly-dev/afd/issues/2211); runs in parallel with [#2212](https://github.com/lushly-dev/afd/issues/2212); Phases 4 + 5 unblock Screens from Jobs Phase 5b [#2040](https://github.com/lushly-dev/afd/issues/2040)).**
     *(Scope updated 2026-11-24 by [Agent-First Design Phase A](#amendment-agent-first-design-phase-a-approved-2026-11-24)):*
     wire static `confirmationMode: 'host-verified'` + `HumanRelay` on `decision-record` (and
     `confirmations: 'require-human'` for `decision-discard`/`decision-restore`) into
     `endpoints/specimen-server` ([#1320](https://github.com/lushly-dev/afd/pull/1320)) so
     host-verified confirmation records `decidedBy: { kind: 'person' }` even for agent-originated
     MCP calls, verified by an end-to-end `HumanRelay` confirmation test.
- **Slice 2 (Jobs 2, 9):**
  6. **Variant lifecycle: discard & restore ([#2214](https://github.com/lushly-dev/afd/issues/2214), blocked on [#2211](https://github.com/lushly-dev/afd/issues/2211) and [#2213](https://github.com/lushly-dev/afd/issues/2213)).**
     `decision-discard` (`CHOSEN_VARIANT`), `decision-restore` (`EXPORT_MISSING`), `confirmPrompt`,
     CLI + `specimen-server` wiring.

**Later (unscheduled):**

- Theme outcomes in `specimen-review` (once multi-theme sets exist).
- Violet carrying `reason` through `changes.impact`.
- Umbel indexing `specimens/decisions/` files.

## 9. Exit criteria

Exit is gated per slice:

- **Slice 1 exit (Phases 1–5, [#2209](https://github.com/lushly-dev/afd/issues/2209)–[#2213](https://github.com/lushly-dev/afd/issues/2213)):**
  every scenario tagged `slice-1` (Jobs 1, 3, 4, 5, 6, 7, 8 and 10) passes against the built
  commands (plus Phase 3 unit/integration tests for `decision-list`, `DECISION_NOT_FOUND`, and
  two-choice supersession), plus all five criteria below:
  1. **No observation enters the agent's context.**
     - A `specimen-capture` of Loam's full screen-specimen manifest at the tested revision (142
       entries at `dbc84611`: 134 chrome + 8 notes) returns under 4 KB.
     - A comparison of three variants, from the call to the page, returns no observation.
     - Neither prints an observation to stdout on the CLI.
  2. **Quiet when nothing changed.** A review of Loam's chrome against an unchanged `main` lists
     0 open and 0 blocking items.
  3. **One question per cause.** A token change that moves ~20 specimens opens one item;
     accepting settles it while unchanged, and rejecting moves it to `blocking` (`kind: 'rejected'`)
     with its `reason` until the content changes.
  4. **Fewer review items & evidence footprint.** Record before/after review-item counts and the
     `specimens/evidence/` byte size on one real pull request.
  5. **Pages & host-verified confirmation verified.** Browser tests verify `compare.html` and
     `review.html` (including the `script`-actor badge), and an end-to-end MCP test on
     `endpoints/specimen-server` proves an agent-originated MCP call to `decision-record`
     confirmed through `HumanRelay` (`confirmationMode: 'host-verified'`, amended 2026-11-24)
     records `decidedBy: { kind: 'person' }` while CLI triage records `{ kind: 'script' }`.
- **Slice 2 exit (Phase 6, [#2214](https://github.com/lushly-dev/afd/issues/2214)):**
  every scenario tagged `slice-2` (Jobs 2 and 9) passes against the built commands.

Scenarios cannot show whether a person decides faster. Criterion 4 is the first measure of it.

## 10. What scenarios cannot show

- **A person, as opposed to an agent, giving an answer.** Every step runs as one test actor
  ([6.6](#66-who-decides)); covered by Slice 1 exit criterion 5.
- **An agent choosing to call `decision-check`.** Job 4 shows the review naming the decision
  instead.
- **The pages** (`compare.html`, `review.html`). They are for a person, and are covered by browser
  tests in Slice 1 exit criterion 5.
- **Warnings and an error's `details`.** The condition `CAPTURES_INCOMPARABLE` names is asserted
  through its message.

## 11. Risks and open points

| Risk or open point | Response |
| --- | --- |
| An agent answers its own review question over MCP | `confirmationMode: 'host-verified'` with `HumanRelay` on `decision-record` (and `confirmPrompt` with `confirmations: 'require-human'` on `decision-discard`/`decision-restore`) on `endpoints/specimen-server` (Phase 5, amended 2026-11-24) |
| A shell-capable agent calls `specimen-cli` directly to record a `{ kind: 'script' }` answer | Accepted trade-off for solo-owner terminal workflows (Q7); `review.html` badges script answers visibly, and a future repo config flag can restrict settlement to `person` only |
| Written screenshots grow the repository | Only the evidence of recorded choices is written, not every set. Measure `specimens/evidence/` size on a real PR at Slice 1 exit |
| A specimen that shows the time never hashes the same | Reported as `changed` with the clock difference; the fix is a fixed clock (`pin.clock` in Screens from Jobs) for that specimen |
| Grouping by cause groups too much or too little | A cause is an exact match on channel, target, property and values. Measure on Loam's token changes |
| A set captured from a dirty tree is used as `main` | The set records `dirty`, and the review shows it |
| An answer goes stale when the page changes | Its fingerprint stops matching and the item is asked again |
| Comparing variants needs each written as a specimen | That is the owner's practice now. Arguments as an axis of `specimen-matrix` are the alternative |

## 12. Owner decisions (2026-11-22)

Confirmed by the owner in a three-pass walkthrough on 2026-11-22 (Q1–Q19):

1. **Shared conventions (Q1):** Confirmed all [section 5](#5-shared-conventions) conventions
   aligned with [#1109](https://github.com/lushly-dev/afd/issues/1109) and
   [#1110](https://github.com/lushly-dev/afd/issues/1110) (`set-` content-addressed ids, random
   Crockford base-32 `dec-` ids, committed `specimens/`, gitignored `.specimen/` `#1132`, single
   review system with `<id>/<step>` job keys and largest-first cause sorting, `skipped.jobs` +
   `skipped.gates`, extending `endpoints/specimen-server`, file-writing commands as mutations).
2. **Decision storage (Q2):** Committed JSON in `specimens/decisions/<id>.json` with decided
   screenshots + manifest in `specimens/evidence/<set id>/`; full observations stay in `.specimen/`.
3. **Enforcement model (Q3):** Inform, do not block (`decision-check` + review item `decisions[]`
   + `SUPERSEDE_REQUIRED`).
4. **Variant identity (Q4):** A variant is a Specimen id (separate specimen exports).
5. **Pixel comparison (Q5):** No pixel diff; side-by-side screenshots + structured `specimen-diff`
   channels.
6. **Two-kind decision model & scope (Q6):** Keep `choice` vs. fingerprint-scoped `answer` (no
   subjects on answers; accepting an item touching choices writes one successor `choice` per
   superseded choice) and out of scope boundaries.
7. **CLI script answers (Q7):** CLI answers (`decidedBy: { kind: 'script' }`) settle review items
   and are visibly badged on `review.html`.
8. **MCP host confirmation wiring (Q8):** Extend existing `endpoints/specimen-server` (`#1320`) in
   Phase 5 (`#2213`) with `confirmations: 'require-human'`, deriving `decidedBy: { kind: 'person' }`
   from accepted human elicitation regardless of invoking MCP actor. *(Amended 2026-11-24 for
   `decision-record` by [Agent-First Design Phase A](#amendment-agent-first-design-phase-a-approved-2026-11-24)
   below: upgraded to static `confirmationMode: 'host-verified'` + `HumanRelay`.)*
9. **Relation to Ideas (Q9):** Keep separate for now while preserving append-only records,
   required `reason` and `supersedes`.
10. **Job ranking & slices (Q10):** Keep all ten jobs; Slice 1 (`slice-1`) = Jobs 1, 3, 4, 5, 6,
    7, 8, 10 (with `decision-list` in Phase 3); Slice 2 (`slice-2`) = Jobs 2, 9.
11. **Rejected review answers (Q11):** Matching-fingerprint `chosen: 'reject'` items route to
    `blocking` (`kind: 'rejected'`, with `reason`), not `settled.answered`.
12. **Supersede default subjects (Q12):** Superseding a choice to another `chosen` variant without
    explicit `subjects` swaps old `chosen` → new `chosen` in `subjects.specimens` (keeping extra
    subjects).
13. **Multi-decision cause groups (Q13):** `specimen-review` exposes
    `decisions: Array<{ decision, reason }>` on `changed` items, and `decision-record` accepts
    `supersedes: string | string[]` (writing one successor choice per superseded choice).
14. **Wire contracts (Q14):** Lock contracts directly in [section 7](#7-command-contracts) and
    [`scenarios/`](scenarios/) with no separate `spec.md` (`decision-record` 3 input modes with
    optional `slug`/`question` on Mode 3, structured `cause`, `settled.answered` item unit,
    orthogonal `counts.axe.incomplete`, `skipped.gates: 0` in Scenario 10, `violations: string[]`,
    `events` already landed in `#1919`).
15. **Verification bar (Q15):** Run scenario checks + fresh pre-PR independent review rather than a
    second three-seat walk.
16. **Phases, exit criteria, sub-issues & promotion (Q16–Q19):** Approved the 6-phase plan
    ([#2209](https://github.com/lushly-dev/afd/issues/2209)–[#2214](https://github.com/lushly-dev/afd/issues/2214)),
    per-slice exit criteria (including page browser tests, MCP elicitation test, and evidence-size
    measurement), promotion to `docs/features/active/design-decisions/`, and shipping the promotion
    PR.

### Amendment: Agent-First Design Phase A (approved 2026-11-24)

Approved by the owner on 2026-11-24 at [Agent-First Design](../agent-first-design/spec.md#42-amendment-to-design-decisions-docsfeaturesactivedesign-decisionsdesign-decisionsproposalmd) Phase A exit (Epic [#2544](https://github.com/lushly-dev/afd/issues/2544)). Full wire contracts live in [`../agent-first-design/spec.md`](../agent-first-design/spec.md):

1. **Provisional panel answers (`decidedBy.kind: 'panel'`):** `decidedBy` adds `{ kind: 'panel', reviewers: string[], split: string }`, valid only on Mode 3 (`items: string[]`) with `provisional: true` and `panel: { reviewers, split }` for non-release, non-guidance, non-escalated review items (refused with `AUTHOR_CANNOT_DECIDE`, verified against `ctx.actor.id`/change author, if authored by the caller, or `PERSON_REQUIRED` on card/release/guidance approval).
2. **Q7 resolution & static `confirmationMode: 'host-verified'`:** Keeps CLI `decidedBy: { kind: 'script' }` answers for solo local review triage (Q7), while upgrading `decision-record` (alongside new `design-release` and `panel-calibrate`) to static `confirmationMode: 'host-verified'` with `HumanRelay` (`spec/command-metadata.md:40,145-158`) over MCP (`HumanRelay` returns `CONFIRMATION_REQUIRED` when unavailable and `CONFIRMATION_DECLINED` when declined, distinct from approval middleware's `APPROVAL_REQUIRED`/`APPROVAL_UNAVAILABLE` and handler-level `PERSON_REQUIRED`). Provisional panel Mode 3 settlements run in-process from `panel-review` via `DirectRegistry` (`spec/command-metadata.md:158`). Outside MCP, release cards, guidance approvals, `design-release` and `panel-calibrate` require interactive review-page or CLI confirmation (`decidedBy: { kind: 'person', channel: 'review-page' | 'cli' }`, refusing `script`/agent actors with `PERSON_REQUIRED`).
3. **Decision card mode, `design-card-list`, `design-release` and `decision-list` filters:** Adds card mode to `decision-record`: single `card` returns `{ decision, chosen, refusalScope?, regressionAccepted?, meantToFix?, superseded?, appliedPatterns? }` and batch `cards` (restricted to non-regression cards reviewed together on `page`) returns `{ decisions: Array<...> }`; supports `chosen: 'approve' | 'request-changes' | 'reject' | 'defer'`, `refusalScope`, `regressionAccepted`, `meantToFix`, `supersedes` + `remediation`, enforces `CARD_NOT_FOUND`, `REFUSAL_SCOPE_REQUIRED`, `REGRESSION_ACK_REQUIRED`, `UPSTREAM_CHANGED`, and `REFUSED_AS_UNSAFE` (which also closes the re-proposed card as `rejected`), and atomically applies approved pattern fork/merge updates. Adds `design-card-list`, `design-release` (writing append-only `specimens/releases/<release>.json` manifests, preserving Q9's append-only decisions), and `decision-list` filters (`kind`, `released`, `limit`, `after`).
4. **Variants differ in mechanism:** Applied in [section 6.3](#63-comparison).

## 13. Out of scope

- A/B measurement with users. Loam lists it as out of scope
  (`endpoints/loam/docs/architecture.md:210`).
- Drawing tools. The rendered screen is the medium.
- Pixel comparison (owner decision Q5).
