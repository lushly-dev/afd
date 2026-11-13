# Design Decisions: variants, choices and a review that asks only what gates cannot settle

## Status

- **State:** draft. Scaffolded on 2026-11-13 against `main` at `e5d683a8`. Filled in the same day
  against `f7ecbd43`, then revised after one walk and one independent review. Nothing is
  implemented.
  [STATUS.md](STATUS.md) tracks progress.
- **Verified:**
  - [What exists today](#2-what-exists-today) was re-read first-hand on 2026-11-13 at
    `f7ecbd43`, including what the walk cited.
  - The ten jobs are written as scenario files and pass the three checks
    ([STATUS](STATUS.md#how-the-jobs-were-checked)).
  - One fresh reader walked the draft from all three seats ([section 4](#4-what-the-walk-and-the-review-changed)).
  - One independent reviewer read this draft beside the other two. The reviewer ran scenarios
    against the runner, which is how the expectation fault in section 4 was found.
- **Not verified:**
  - Everything in [Design](#6-design). It is a draft to write jobs against.
  - The revision has not been walked again.
  - The [shared conventions](#5-shared-conventions-the-owners-to-confirm) are the coordinator's
    and await the owner.
  - The owner has not cut, added or ranked the jobs.

| Field | Value |
| --- | --- |
| Epic | [#1108](https://github.com/lushly-dev/afd/issues/1108) |
| Units likely touched | `foundations/specimen` (capture sets, comparison, review, the review pages), `integrations/specimen-afd` (the commands), `endpoints/specimen-cli` (and an MCP host for it); later `integrations/violet-afd` and `endpoints/loam` |
| Related | [Patterns](../patterns/patterns.proposal.md) (epic [#1073](https://github.com/lushly-dev/afd/issues/1073)), [Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md), [Pointing](../pointing/pointing.proposal.md), [Scales](../scales/scales.proposal.md), [Specimens status](../../active/specimens/STATUS.md) |
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
   - Violet has a `reason` on every operation, but nothing reads it, Loam writes it as null and
     `changes.impact` drops it.
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
  an index grouped by title, with a text filter kept in `?q=` (lines 476 to 500).
  - It shows no results: no accessibility, theme, diff, coverage or profile outcome, and no
    screenshots.
  - A preview URL carries the theme, viewport, locale, motion and checkpoint (lines 166 to 180).
- **`specimen-diff`** (`src/diff.ts:247-296`) compares two observations across these channels:
  the DOM, the accessibility snapshot, axe findings, events, layout, styles and state.
  - It answers `changed`, `no-change-observed` or `insufficient-evidence`, with the differences
    and limitations.
  - It refuses captures whose browser, checkpoint, context or capture version differ (lines 35
    to 71). The refusal is an untyped `Error` reported as `SPECIMEN_DIFF_FAILED`
    (`integrations/specimen-afd/src/commands.ts:230`). Only the message names what differed.
  - It does not require both sides to be the same specimen.
  - The command's input is two whole observations (`commands.ts:138-145`). The CLI reads them
    from capture files (`endpoints/specimen-cli/src/cli.ts:298-302,330-331`). An agent calling
    over MCP would have to carry both observations as input.
  - It does no pixel comparison: a visual requirement answers `insufficient-evidence` (lines
    274 to 286).
  - Its output schema leaves out the `events` channel (`commands.ts:152`) that `diff.ts:267`
    reports, and the result is parsed against that schema (`commands.ts:197`).
- **`specimen-render`** returns one whole observation and runs no axe. It captures without the
  accessibility option (`src/bench-runtime.ts:678-680`, option at line 255), so the
  observation's axe channel is `'not-run'` (line 333).
  - Only `specimen-a11y` runs axe.
  - The CLI writes `--output` to a file and still prints the whole result to stdout
    (`cli.ts:549`).
- **`specimen-list`** takes no filter (`commands.ts:244`) and returns every entry.
- **`specimen-matrix`** (`src/bench-runtime.ts:712-798`) captures one specimen across context
  axes, up to 64 cells, and diffs each cell against the first. It has no axis for variants.
- **`specimen-a11y`** reports `incompleteChecks`, which the README describes as what "a person
  must" decide (`foundations/specimen/README.md:201`). They never affect the status.
- **`specimen-themes`** compares pixels between themes. It reports `follows`, `declared`,
  `pinned`, `undeclared`, `contradicted` or `unavailable` (`schema.ts:711-718`).
- **The commands run as a script.**
  - The commands declare `expose: { mcp: true }`, but no MCP server hosts them.
  - `executeSpecimenCommand` runs every call as `{ kind: 'script' }` (`commands.ts:570`).
  - Nothing in Specimen can tell a person's answer from an agent's.
- **The Specimen proposal** requires "a human review surface"
  (`docs/features/proposed/specimens/specimens.proposal.md:71`). Only the index exists.

### AFD

- **Confirmation.** A command can declare `confirmPrompt` (`spec/command-metadata.md`).
  - A server built with `confirmations: 'require-human'` runs such a command over MCP or HTTP
    only after the person accepts an elicitation (`packages/server/src/server-types.ts:225-241`).
  - It is off by default.
  - In-process calls (`server.execute`, DirectClient) are never gated.
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

- **Records.** `endpoints/loam/docs/design.md` has a dated history from line 561, and
  `docs/decisions.md` holds D1 to D115 with superseded entries kept. Rejected alternatives
  survive only as prose, as with D22's rejected names. No screenshots or before-and-after pairs
  are kept.
- **Violet's `reason` is null:** `endpoints/loam/packages/theme/src/tree/index.ts:87`.
- **The component checklist** (`.claude/skills/loam-design/references/checklist.md`).
  - CI runs item 1 (the token lint) and item 6 (axe).
  - A person checks the rest in the pull request, including "correct in light, dark and high
    contrast".
- **Screen specimens:** 123, so a capture of every screen is about that many observations.

## 3. Jobs

Each job is a scenario file in [`scenarios/`](scenarios/), written against the drafted commands in
[section 7](#7-drafted-commands). The data is invented: a toolbar with density variants, an empty
list, a button and an editor screen. The owner cuts, adds and ranks the jobs
([For the owner](#12-for-the-owner)). The slice column is a proposal until then.

| # | Job | Sentence | Slice |
| --- | --- | --- | --- |
| 1 | `compare-like-with-like` | When I am unsure between directions, I want several variants captured side by side under one context and checkpoint, with each one's checks, so that I compare the designs and not the setups | yes |
| 2 | `keep-what-was-not-chosen` | When I have chosen one variant, I want the others kept and retrievable until I discard them, so that I can go back to one without rebuilding it | no |
| 3 | `record-the-choice` | When I choose a variant, I want the choice, the reason and the captures it rested on recorded together and written beside the code, so that a later agent or I can find why it is the way it is | yes |
| 4 | `be-told-before-undoing` | When an agent is about to change something a decision covers, I want it shown the decision and its reason first, and the change put to me in review if it goes ahead, where accepting it replaces the old decision, so that a decision is never undone silently or left stale | yes |
| 5 | `review-only-what-needs-eyes` | When I review a change, I want to see only what no gate settled, grouped by cause, each with its before and after captures, so that my attention goes where a machine cannot decide | yes |
| 6 | `turn-a-check-into-a-question` | When a check cannot decide, I want it put to me as a question I can answer once with a reason, so that it is neither buried in a report nor asked again while nothing changes | no |
| 7 | `refuse-a-misleading-comparison` | When two captures or sets were made under different conditions, I want the comparison refused with the difference named, so that I never take a theme change for a design change | yes |
| 8 | `stay-quiet-about-what-is-settled` | When the gates and earlier answers have settled everything in a change, I want the review to say so in one line and list nothing, so that a review with nothing to judge costs me nothing | no |
| 9 | `reverse-a-decision` | When I change my mind about a choice or a discard, I want to reverse it with a reason, even when the original comparison is gone, so that a decision is never a one-way door and the reason an agent finds is the current one | no |
| 10 | `capture-a-baseline` | When I start reviewing a project, I want its specimens captured once, with their checks, into a labelled set that answers with ids and counts only, so that a review has something to compare against without filling the agent's context | yes |

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
- **Review carries the decision**, so the person sees it even when the agent did not call
  `decision-check`.
- **Two refusals were added:**
  - `CHOSEN_VARIANT`: a decision must keep a chosen variant.
  - `VARIANT_UNAVAILABLE`: a variant is never shown in another theme than the one asked for.
- **`decision-open` was cut.** A comparison set is enough before the choice.
- **List assertions became dotted index paths.** A list under `expect.data` is compared whole
  (`packages/testing/src/runner/evaluator.ts:432`), so a partial list would have failed.
- **Expectations use no step references.** The runner resolves `${{ steps[N] }}` in `input` only
  (`packages/testing/src/runner/scenario-runner.ts:308`), so a generated id is asserted with
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
| Things going wrong: superseding needed a set that may be gone; a discard could not be undone; reviewing mixed contexts was not refused; slugs could collide | Superseding carries the old evidence (job 9). `decision-restore` with `EXPORT_MISSING` (job 9). `specimen-review` refuses mixed contexts (job 7). Random ids ([5](#5-shared-conventions-the-owners-to-confirm)) |
| A review listed as a read could not resolve item ids | Item ids describe themselves: kind, cause or specimen, and the two set ids. The review stays a read |
| Confirmation already exists in AFD but was not named; the CLI always runs as a script | Named ([6.6](#66-who-decides)), and the proposal says plainly that the CLI cannot give a person's answer |
| `SPECIMEN_NOT_FOUND` pointed to an unfiltered `specimen-list` (20k to 40k tokens on Loam) | The suggestion names the nearest ids |
| The claim that carrying captures is a problem everywhere was wrong; the CLI reads files | Corrected in section 2 |
| What a model must know without a skill | Written into descriptions and results ([6.7](#67-what-a-model-is-told)) |
| Job 2 stopped short of its "so that"; reversal had no job | Job 2 goes back to a kept variant. Reversal is job 9 |

Declined: none.

The independent review of 2026-11-13 read the three drafts together and ran scenarios against
the runner. The coordinator set conventions across the three drafts ([section 5](#5-shared-conventions-the-owners-to-confirm)).

| Finding | Change |
| --- | --- |
| Blocker: the runner resolves step references in `input` only, so three expectations compared a literal `${{ … }}` string | Rewritten as `matches` or fixture literals. A check now scans every `expect` for references ([STATUS](STATUS.md#how-the-jobs-were-checked)) |
| A review answer became a current decision on the whole specimen, so any later change to it would need `SUPERSEDE_REQUIRED` | An answer is its own kind, scoped to its item's cause or check and fingerprint. It has no subjects, `decision-check` never returns it, and it stops matching when the content changes ([6.4](#64-decisions-are-files-in-the-repository)) |
| Superseding a variant choice by accepting a review item left a record that was half choice, half answer | Accepting an item that names a choice writes a choice: same variants, chosen, kept and discarded, the after set as evidence, and the item under `answers`. `options` never appear on a choice |
| The default subjects were not stated | `subjects.specimens` defaults to the chosen variant; a decision may name more |
| A section reference and a field name were out of step | Fixed: `open.0.decision.decision` matches `decisions.0.decision` |

Not yet done: a second walk of the revision.

## 5. Shared conventions (the owner's to confirm)

The coordinator set these across Design Decisions, Screens from Jobs and Pointing on 2026-11-13.
They are the owner's to confirm.

- **Content-addressed ids for captured data.** A set is `set-` and 12 hex digits
  ([6.2](#62-capture-sets) lists exactly what is hashed).
- **Random ids for records that people or agents write.**
  - Decisions are `dec-` and 12 base32 characters, such as `dec-q7k2m4xab3na`. Pointing's
    notes and points take `note-` and `pt-` in the same form.
  - A slug is kept as a field for readability, never as the id, so two branches cannot collide on
    the same slug and date.
- **Records that are written to the repository** live under `specimens/`:
  `specimens/decisions/<id>.json`, evidence screenshots under `specimens/evidence/<set id>/`, and
  Pointing's `specimens/notes/<id>.json`.
  - A command writes these files and never runs `git commit`. They reach `main` in the pull
    request like any other change.
- **Local data** (sets, runs and points) lives under `.specimen/`. `.specimen/` is not in
  `.gitignore` today, so phase 1 must add it.
- **One review system, this one.**
  - A Screens from Jobs run saves its captures as an ordinary set, keyed `<job>/<step>`.
  - `specimen-review` compares those sets like any other and groups changes by cause.
  - Accepting a change is answering a review item, which needs a person's confirmation
    ([6.6](#66-who-decides)).
  - Screens from Jobs therefore drops its own accept and diff commands and its committed
    baseline.
- **Job specimens.**
  - Until the Screens from Jobs runner exists, `specimen-capture` with no ids skips job
    specimens and reports how many it skipped. Its result names `specimen-job-run`.
  - Once that runner lands, `specimen-capture` runs job specimens through it.
- **One host.** Phase 5's Specimen MCP host is the host the other two proposals refer to.
- **Mutations.** Every command that writes files is declared a mutation.

## 6. Design

### 6.1 Variants are specimens

A variant is a specimen. Each direction is its own specimen export, such as `Dense`, `Airy` and
`Grouped` in one module, which is how the owner already keeps comparable versions. Whole screens
are specimens too. A screen in a job's state waits for
[Screens from Jobs](../screens-from-jobs/screens-from-jobs.proposal.md).

### 6.2 Capture sets

`specimen-capture { ids? | filter?, context?, checkpoint?, label?, axe? }` captures many
specimens in one context and checkpoint into a set under `.specimen/sets/`. A Screens from Jobs
run writes the same kind of set, keyed `<job>/<step>`.

- **Axe runs by default,** as `specimen-a11y` runs it.
- **The result holds ids and counts only.** No observation is returned. It gives:
  - the set id and its label;
  - the revision, and whether the checkout was dirty;
  - counts: captured, unavailable, and axe passed, failed and incomplete;
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
  - **A capture's content hash is new, since Specimen has none today.** It is a SHA-256 over the
    normalized DOM, the accessibility snapshot, the axe findings (rule, impact and targets), and
    each element's box, styles and state.
  - **What is not hashed:**
    - timestamps, elapsed times and ready deadlines;
    - screenshot bytes, whose pixels are not reproducible;
    - the revision and whether the tree was dirty. These are recorded beside the set, and a set
      captured again at another revision adds that revision to its list.
  - **The same checkout captured twice gives the same id** (job 10), and parallel branches cannot
    collide.
  - **Pages see the real clock** (`baseline.clock: 'real'`, `foundations/specimen/src/types.ts:633`).
    A specimen that renders the time therefore hashes differently on every capture until it is
    given a fixed clock. The review reports such a specimen as `changed`, with the clock-driven
    difference.
- **Job specimens are skipped** when no ids are given, until Screens from Jobs' runner exists.
  `skipped.jobs` counts them and names `specimen-job-run`.
- **A label** (`main`, `branch`) is a local pointer to a set id. It is not a git ref. A set is
  captured from the working tree, so to capture `main`, run it in a checkout of `main`. The set
  records the revision and whether the tree was dirty, and the review shows both.
- **`specimen-diff`** accepts `{ set, id }` on either side, as well as an observation. Different
  conditions are refused with `CAPTURES_INCOMPARABLE`, typed. `allowContextDifferences` still
  lets an intended difference through.

### 6.3 Comparison

`specimen-compare { ids, context?, checkpoint? }` captures two to eight variants, with axe, into
a set of kind `compare`, and diffs each against the first.

- **Each capture reports its axe status and violations,** so a failing variant is visible before
  it is chosen.
- **It refuses an unknown id before capturing anything** (`SPECIMEN_NOT_FOUND`), and the
  suggestion names the nearest ids.
- **It refuses a variant whose declared themes exclude the requested one**
  (`VARIANT_UNAVAILABLE`).
- **`page`** links to `compare.html?set=`, which shows the screenshots side by side with the
  structured differences.

No pixel comparison is added.

### 6.4 Decisions are files in the repository

A decision is one JSON file, `specimens/decisions/<id>.json`, with a random id
`dec-<12 base32>` ([section 5](#5-shared-conventions-the-owners-to-confirm)). A decision is one
of two kinds.

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
  - `supersedes`, `decidedAt`, and `decidedBy` (`{ kind }`, from the call's actor).
- **Discard and restore** apply to a choice only.
  - `decision-discard` moves variants from kept to discarded, and names the exports that can now
    be deleted and the revision.
  - `decision-restore` moves them back while their export exists. Otherwise it refuses with
    `EXPORT_MISSING` and names the revision to recover the export from.

**An answer** settles one or more review items that name no choice.

- **Fields:** `kind: answer`, `chosen` (`accept` or `reject`), `reason`, `decidedAt` and
  `decidedBy`, and `answers`. Each answer gives the item, the specimen, the cause or check, and
  the fingerprint of what it looked at.
- **No subjects.** An answer is not returned by `decision-check`, never triggers
  `SUPERSEDE_REQUIRED`, and does not guard its specimen.
- **It settles only the same item on the same content.** A later change to that specimen raises
  new items. Once the content changes, the answer matches nothing and stays as history.

**Accepting an item that names a choice** writes a choice, never an answer.

- `decision-record { items, chosen: accept, supersedes, reason }` refuses without `supersedes`
  (`SUPERSEDE_REQUIRED`).
- The new choice keeps the old one's variants, chosen, kept, discarded and subjects. It takes the
  after set as its evidence and the new reason, and lists the items under `answers`.
- The old choice becomes `superseded`. Discard and restore then work on the new choice as on any
  other. `options` never appear on a choice.

**Superseding by choice** (job 9) needs no comparison set: the new choice carries the old one's
evidence unless it is given a new one. `decision-check` returns current choices only.

**What is written to the repository:**

- The decision file.
- Under `specimens/evidence/<set id>/`: each evidence capture's screenshot, and a manifest of its
  key, content hash, context, checkpoint, revision and axe status.
- The command writes these files and never commits them.
- Full observations stay in `.specimen/`. A decision's evidence therefore survives a merge and a
  clean checkout as screenshots and hashes, not as observations that can be diffed again.

**`decision-list`** returns the current choices. For each, it gives the subject globs that match
no file (`stale`), and the comparison sets that no decision cites (`undecided`).

### 6.5 Review

`specimen-review { before, after, ids? }` is a read. `before` and `after` are set ids or labels.
It refuses sets captured under different conditions (`CAPTURES_INCOMPARABLE`) and a label or id
with no set (`CAPTURE_SET_NOT_FOUND`).

| Outcome | Where it goes |
| --- | --- |
| axe passed with nothing incomplete, or diff `no-change-observed` | Settled, counted as `unchanged` |
| A kept, unchosen variant of a current decision | Left out, counted as `kept` |
| diff `changed` | Open, `changed`. Grouped by cause: specimens whose differences are the same (channel, target, property, before and after) form one item. Carries `decision` when a subject of a current decision matches |
| axe `incompleteChecks` in the after set | Open, `incomplete-check`, one per specimen and check |
| diff `insufficient-evidence` | Open, `insufficient-evidence`, with the limitation |
| axe failed, or a capture unavailable | Blocking: for the agent to fix, not a question for the person |
| An open item that an answer, or a choice's `answers`, settled with a matching fingerprint | Settled, counted as `answered` |

- **Job sets.** A Screens from Jobs set is compared like any other, step by step, and its
  changes group by cause the same way. That proposal keeps no review, accept or diff of its own.
- **Item ids describe themselves,** so the review is not stored:
  `changed:<cause>:<before set>..<after set>`, `check:<specimen>:<check>:<before>..<after>`.
  `decision-record` recomputes the review from the two sets. It refuses an item they do not
  raise (`REVIEW_ITEM_NOT_FOUND`).
- **Answers.** `decision-record { items, chosen, reason }` answers one or more items with
  `accept` or `reject`.
  - Accepting an item that names a choice needs `supersedes` (`SUPERSEDE_REQUIRED`), and writes
    a choice ([6.4](#64-decisions-are-files-in-the-repository)). Any other answer writes an
    answer.
  - Either way, the record stores a fingerprint of what each item looked at: the cause and its
    before and after values, or the check's target content. While it matches, later reviews
    count the item as `answered`.
- **An open `changed` item names the choice it touches** as `decision: { decision, reason }`,
  the same `decision` field that `decision-check` returns.
- **Order:** groups by cause, then insufficient evidence, then checks, each by specimen id.
- **`page`** links to `review.html?before=&after=`, which shows only the open items.
- **Theme outcomes** join once sets are captured across themes. They are not in the first slice.

### 6.6 Who decides

- **Commands that need a person's confirmation.** `decision-record`, `decision-discard` and
  `decision-restore` declare a `confirmPrompt` that names the decision and the choice.
  - The Specimen MCP host, which does not exist yet and is part of this proposal, runs with
    `confirmations: 'require-human'`. It is the host that Screens from Jobs and Pointing refer
    to.
  - A decision recorded there has `decidedBy: { kind: 'person' }` only when the person accepted
    the elicitation.
- **The CLI cannot give a person's answer.** It runs every call as a script, and AFD gates no
  in-process call. A decision recorded from the CLI says `decidedBy: { kind: 'script' }`, and the
  review page marks it.
  - Whether a script's answer settles a review item is [question 7](#12-for-the-owner).
- **Scenarios cannot show any of this,** because every step runs as one test actor.

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

`decision-check { files?, specimens?, tokens? }` returns each current decision whose subjects
match, with its choice, reason and what matched. It returns an empty list when nothing matches.
It informs and does not block ([recommendation 3](#12-for-the-owner)).

## 7. Drafted commands

Names, inputs and results are a draft to write jobs against. The exact contracts follow approval.
Every command lives in `integrations/specimen-afd`, with its logic in `foundations/specimen`.

| Command | New | Input | Result |
| --- | --- | --- | --- |
| `specimen-capture` | Yes, mutation (writes a set) | `ids` or `filter`, `context`, `checkpoint`, `label`, `axe` (default on) | `set`, `label`, `revision`, `dirty`, `counts` (`captured`, `unavailable`, `axe.passed`, `axe.failed`, `axe.incomplete`), `unavailable` (`id`, `reason`), `skipped` (`jobs`, `next`) |
| `specimen-compare` | Yes, mutation (writes a set) | `ids` (2 to 8), `context`, `checkpoint` | `set`, `context`, `checkpoint`, `captures` (`id`, `status`, `axe`, `violations`, `screenshot`), `differences` (`id`, `against`, `status`, `channels`), `page` |
| `specimen-diff` | Extended | `left` and `right` each an observation or `{ set, id }` | As today; `events` added to the output schema |
| `specimen-review` | Yes, read | `before`, `after` (set ids or labels), `ids` | `before` and `after` (`set`, `label`, `revision`, `dirty`), `open` (`item`, `kind`, `ids`, `cause` or `check`, `question`, `options`, `captures`, `decision` as `{ decision, reason }`), `blocking`, `settled` (`unchanged`, `kept`, `answered`), `page` |
| `decision-record` | Yes, mutation (writes files), `confirmPrompt` | `question`, `slug`, and `set`, `items` or `supersedes` (`items` may go with `supersedes`); `chosen`, `reason`, `subjects` | `decision`, `kind`, `path`, `chosen`, `kept`, `supersedes`, `answers`, `evidence`, `evidenceDir`, `subjects` |
| `decision-get` | Yes, read | `decision` | The record, with `evidence.captures` |
| `decision-list` | Yes, read | none | `decisions`, current choices (`decision`, `question`, `chosen`, `stale`); `undecided` (`set`, `ids`) |
| `decision-check` | Yes, read | `files`, `specimens`, `tokens` | `decisions`, current choices only (`decision`, `question`, `chosen`, `reason`, `supersedes`, `matched`) |
| `decision-discard` | Yes, mutation (writes files), `confirmPrompt` | `decision`, `variants` | `discarded`, `kept`, `exports` (`module`, `exportName`), `revision` |
| `decision-restore` | Yes, mutation (writes files), `confirmPrompt` | `decision`, `variants` | `kept`, `discarded` |

| Error | From | Recovery the suggestion names |
| --- | --- | --- |
| `SPECIMEN_NOT_FOUND` | `specimen-compare`, `specimen-capture` | The nearest ids |
| `VARIANT_UNAVAILABLE` | `specimen-compare` | The themes the variant declares |
| `CAPTURES_INCOMPARABLE` | `specimen-diff`, `specimen-review` | Capture both under the same conditions with `specimen-capture`, or pass `allowContextDifferences` |
| `CAPTURE_SET_NOT_FOUND` | `specimen-review`, `specimen-diff` | `specimen-capture` with the label; labels are not git refs |
| `REASON_REQUIRED` | `decision-record` | Give the reason the choice rests on |
| `VARIANT_NOT_FOUND` | `decision-record`, `decision-discard`, `decision-restore` | The decision's variants, by id |
| `CHOSEN_FAILS_GATE` | `decision-record` | Fix the variant and compare again with `specimen-compare` |
| `SUPERSEDE_REQUIRED` | `decision-record` | Pass `supersedes` with the choice the item names, and a new reason |
| `REVIEW_ITEM_NOT_FOUND` | `decision-record` | `specimen-review` for the items the two sets raise |
| `DECISION_NOT_FOUND` | `decision-get`, `decision-discard`, `decision-restore` | `decision-list` |
| `CHOSEN_VARIANT` | `decision-discard` | `decision-record` with `supersedes` to change the choice |
| `EXPORT_MISSING` | `decision-restore` | Recover the export from the revision it was discarded at, then restore |

Every command is used by a scenario, and every error is shown by one.

## 8. Phases

The slice is the six scenarios tagged `slice`: jobs 1, 3, 4, 5, 7 and 10. It is tentative until
the owner ranks the jobs.

1. **Capture sets.**
   - `.specimen/` added to `.gitignore`.
   - A content hash per capture, then `specimen-capture` with content-addressed set ids, labels,
     axe, and the job-specimen skip.
   - `specimen-diff` accepts `{ set, id }`, and `CAPTURES_INCOMPARABLE` is typed.
   - `events` goes into `specimen-diff`'s output schema.
2. **Comparison.** `specimen-compare` with axe, and `compare.html`.
3. **Decisions.**
   - `decision-record`, `decision-get`, `decision-list` and `decision-check`.
   - The file format, the evidence written under `specimens/`, choices and answers, and
     superseding.
4. **Review.** `specimen-review` over axe and the diff, grouping by cause, answers to items and
   `review.html`.
5. **A person's answer.** The Specimen MCP host with `confirmations: 'require-human'`.

**Later:**

- `decision-discard` and `decision-restore` (jobs 2 and 9).
- Theme outcomes in the review.
- Violet carrying `reason` through `changes.impact`.
- Umbel indexing decision files.

## 9. Exit criteria

Exit starts from the jobs: **every scenario tagged `slice` passes** against the built commands,
and then every other scenario. Then:

1. **No observation enters the agent's context.**
   - A `specimen-capture` of Loam's 123 screen specimens returns under 4 KB.
   - A comparison of three variants, from the call to the page, returns no observation.
   - Neither prints an observation to stdout on the CLI.
2. **Quiet when nothing changed.** A review of Loam's chrome against an unchanged `main` lists
   nothing open.
3. **One question per cause.** A token change that moves 20 specimens opens one item, and is not
   asked again after it is answered.
4. **Fewer review items.** The number of review items a person sees on a real pull request is
   recorded before and after the slice.

Scenarios cannot show whether a person decides faster. Criterion 4 is the first measure of it.

## 10. What scenarios cannot show

- **A person, as opposed to an agent, giving an answer.** Every step runs as one test actor
  ([6.6](#66-who-decides)).
- **An agent choosing to call `decision-check`.** Job 4 shows the review naming the decision
  instead.
- **The pages** (`compare.html`, `review.html`). They are for a person, and need their own checks.
- **Warnings and an error's `details`.** The condition `CAPTURES_INCOMPARABLE` names is asserted
  through its message.

## 11. Risks and open points

| Risk or open point | Response |
| --- | --- |
| An agent answers its own review question | `confirmPrompt` with `require-human` on the MCP host. The CLI's answers are marked as a script's ([question 7](#12-for-the-owner)) |
| Written screenshots grow the repository | Only the evidence of recorded choices is written, not every set. Measure the size after the slice |
| A specimen that shows the time never hashes the same | Reported as `changed` with the clock difference; the fix is a fixed clock for that specimen |
| Grouping by cause groups too much or too little | A cause is an exact match on channel, target, property and values. Measure on Loam's token changes |
| A set captured from a dirty tree is used as `main` | The set records `dirty`, and the review shows it |
| An answer goes stale when the page changes | Its fingerprint stops matching and the item is asked again |
| Comparing variants needs each written as a specimen | That is the owner's practice now. Arguments as an axis of `specimen-matrix` are the alternative |

## 12. For the owner

Each recommendation is for the owner to decide.

1. **The jobs.** Cut, add and rank the ten. The ranking decides the slice.
2. **Where decisions live.** *Recommendation: files in the repository, with the decided evidence
   written beside them under `specimens/`.* They are reviewed in the pull request that makes the change, versioned
   with the code they describe, and need no server. Violet covers tokens only. Umbel would put a
   server between an agent and the reason, but can index the files later.
3. **Whether a decision binds.** *Recommendation: it informs and does not block.*
   `decision-check`, the decision named on review items and `SUPERSEDE_REQUIRED` together stop a
   silent undo, without a refactor of a decided file asking the person.
4. **What a variant is.** *Recommendation: a specimen id* ([6.1](#61-variants-are-specimens)).
5. **Pixels.** *Recommendation: screenshots side by side, and no pixel diff.* Revisit if a visible
   change is missed in practice.
6. **Relation to Ideas.** *Recommendation: do not share the engine yet.* Decisions keep the
   properties the Ideas log needs (append-only, a reason on every entry, superseding).
7. **Answers given through the CLI.** *Recommendation: they settle review items, and the page
   marks them as a script's.* This suits one owner at a terminal; a team would require the MCP
   host's confirmation.
8. **A Specimen MCP host.** *Recommendation: add one as phase 5,* since a person's answer needs
   it. The other two proposals use the same host.
9. **The shared conventions** in [section 5](#5-shared-conventions-the-owners-to-confirm): ids,
   storage, one review system, job specimens, one host.

## 13. Out of scope

- A/B measurement with users. Loam lists it as out of scope
  (`endpoints/loam/docs/architecture.md:208`).
- Drawing tools. The rendered screen is the medium.
- Pixel comparison ([recommendation 5](#12-for-the-owner)).
