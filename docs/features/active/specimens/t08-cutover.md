# T08 consumer cutover and distribution

**State, 2026-11-02:** in progress, on [the owner's decisions](#the-owners-decisions). Native helpers and types are done, and [AFD's FAST-AF stories now run here on Specimen](#afds-fast-af-stories), with no Storybook. Lushly has not changed, and nothing has been published.

T08's acceptance comes from the [implementation plan](implementation.md#ordered-implementation-queue): three consecutive qualifying full runner pairs on accepted consumer main snapshots with no migration change between them, normal consumer gates passing, review, scaffold and flake behaviour preserved, legacy Fluent exceptions accounted for, and exact rollback checkpoints. Package admission and main delivery go through their normal workflows.

## Where each requirement stands

| Requirement | State | Who |
| --- | --- | --- |
| Three consecutive pairs agree exactly | Rehearsed on both consumers, [below](#the-rehearsal) | Must be repeated on the accepted snapshots at cutover |
| Resource gate | **On a first measurement, full suites use more CPU than Storybook.** [The owner accepts that for now](#the-owners-decisions) | Done for now, stays open as a follow-up |
| Budgets | Met on both consumers, including Lushly's upgrade, and [lower on native helpers](#native-helpers-and-types) | Done, re-measured each change |
| Replacement gates | Every story rule has its evidence and retirement record ([T07](t07-coverage.md#retirement-records)). [`specimen contract` now gates AFD's stories](#afds-fast-af-stories) | Done here. Lushly has no story contract to replace |
| Native helpers and types | [Done](#native-helpers-and-types) | Done |
| Normal consumer gates, with no root Storybook | FAST-AF: [done here](#afds-fast-af-stories). Lushly: not started | Lushly's repository |
| Rollback checkpoints | Not started | At each consumer's cutover |
| Legacy Fluent exceptions | Not started | Lushly |
| Human review of the index | Links verified ([T06](t06-full-runner.md#the-review-page)); no person has reviewed it | **Owner** |
| Distribution | All Specimen units quarantined; the FAST-AF plugin is private | **Owner** |

## The rehearsal

`experiments/run-retained.mjs --mode full`, three consecutive times per consumer on one build of Specimen at `4a26cc0b`, with two workers, recorded fonts and no retries.

| | FAST-AF `24e4eb86` (upstream's head) | Lushly `309f46b5` (main on 2026-11-02) |
| --- | --- | --- |
| Discovered, indexed | 407, 407 | 880, 880 |
| Identity mismatches | 0, 0, 0 | 0, 0, 0 |
| Passed in both, disagreements | 407, 0, three times | 880, 0, three times |

Lushly's snapshot was refreshed for this, six commits past the one T06 used, and those brought Storybook 10.6.5, Playwright 1.64 and new stories. Parity held through the upgrade with no change to Specimen, and its budgets did not move: shell 45,329, interaction support 595,647, accessibility 586,666, total 1,227,642.

**These are not yet the qualifying runs.** They ran in AFD's harness on read-only snapshots, not through each consumer's authoritative validation path, and nobody has accepted these snapshots. Lushly's main moved six commits in a day, so the proposal's rule that relevant consumer changes invalidate evidence means qualification has to happen at cutover. This shows the work is ready for that, and is stable when repeated.

## Resources

The proposal says "the primary outcome MUST be lower resource cost for equivalent verified work". T04 passed on its representative wrapper components. Its full-suite figures remained open as G03, and this is the first measurement of them. Each side ran alone, once, under `/usr/bin/time -l`.

| | FAST-AF Storybook | FAST-AF Specimen | Lushly Storybook | Lushly Specimen |
| --- | --- | --- | --- | --- |
| Wall-clock | 12.1 s | 41.9 s | 83.3 s | 133.8 s |
| CPU, user and system | 67.8 s | 107.9 s | 211.1 s | 387.4 s |
| CPU per verified case | 0.167 s | 0.265 s | 0.240 s | 0.440 s |
| Largest single process | 1,007 MiB | 294 MiB | 2,244 MiB | 501 MiB |

| Specimen compared with Storybook | FAST-AF | Lushly | T04's criterion |
| --- | --- | --- | --- |
| CPU per verified case | 1.59× | 1.84× | At most 1× |
| Wall-clock | 3.46× | 1.61× | At most 1.25×, as a guardrail on startup and render |
| Largest single process | 0.29× | 0.22× | At most 1× |

**On this evidence, full suites would not meet T04's CPU criterion or its latency guardrail, while memory looks much better.** [The owner accepts the extra CPU for now.](#the-owners-decisions)

What this measurement is and is not:

- **It is one run per side on a shared host,** at a load around 5, and not T04's recorder, its calibrated host or its repetition policy. CPU time is less sensitive to load than wall-clock, but this is a first reading and not a verdict.
- **CPU includes the descendants each side waited for,** which should cover both browsers. The memory figure is the largest single process, not the footprint of the whole tree, so it may flatter either side.
- **The likely cause is known and not profiled.** Each story gets a fresh browser context, a page load and axe's parse, as the proposal's isolation rule asks, where Storybook shares a page across a file. T06 recorded the same gap in wall-clock.

## The owner's decisions

Made on 2026-11-02, in answer to this record's first version.

| Question | Decision | What follows |
| --- | --- | --- |
| Full suites use more CPU than Storybook | "Extra CPU is fine for now" | Cutover is not blocked on it. The proposal's resource goal stands, so the [figures above](#resources) stay on record as a follow-up |
| `violet-calendar`'s `Disabled` story | Fix it | In AFD's copy, since FAST-AF now lives here |
| Distribution | Once it works end to end, the docs mark it as a preview | Lifting quarantine and publishing are still separate, and still the owner's |
| Fastbot's adapter and rule retirement | Do it here: "FAST-AF moved into the AFD repo" | Fastbot itself was not imported, so `specimen contract` is the gate here, with no adapter to install |
| Lushly's migration | An issue for Lushbot | Filed once there is something to migrate to |
| Where AFD's FAST-AF stories run (G12) | The owner asked for a recommendation | Here, on Specimen, in AFD's FAST-AF gates. Upstream's Storybook configuration was never imported, and these stories are the ones AFD owns |
| Human review of the index | The owner reviews it when ready | On AFD's own stories, once they run here |

## Native helpers and types

Without these, Storybook could not be removed. `@lushly-dev/specimen/test` has `expect`, `fn`, `spyOn`, `userEvent`, `waitFor` and `within`. `@lushly-dev/specimen/types` adds `Meta`, `StoryObj` and what they need, and `@lushly-dev/specimen/preview` has `setCustomElementsManifest`. `specimen migrate --helpers` switches a story file's imports. The [README](../../../../foundations/specimen/README.md#helpers-and-types) describes them.

The proposal requires that "all plays and metadata MUST remain semantically equivalent". The helpers are the libraries `storybook/test` bundles, at the same versions, with its `expect` assembled the same way. Storybook's instrumentation is the one thing left out, and it was never in Specimen's runs, because it does nothing outside an iframe.

Each of these held:

| Check | Result |
| --- | --- |
| The same fixtures under both runners, in `compat/native/` | Same outcomes, passing and failing, including jest-dom matchers, spies, typing and `waitFor` timeouts. In CI |
| Every FAST-AF story `24e4eb86` on native helpers, on a throwaway copy | 407 of 407 passed, 0 identity mismatches |
| Every Lushly story `309f46b5` on native helpers, on a throwaway copy | 880 of 880 passed, 0 identity mismatches |
| Lushly's own `type-check:storybook` on native types | 0 errors, the same as with Storybook's |
| FAST-AF's 79 story files on native types | Clean. The only 2 errors are `?raw` imports, because that check had no Vite types |
| A packed install outside the workspace, with no Storybook installed | A story passes, a failing one fails, and the build has no Storybook code. In CI |

Each copy's Storybook side is the [rehearsal](#the-rehearsal) on the same snapshot, where every story passed. These were runs of the candidate alone, so they show the helpers keep every story passing. They are not qualifying pairs.

### What it did to the budgets

| Category | Ceiling | FAST-AF, was | FAST-AF, native | Lushly, was | Lushly, native |
| --- | --- | --- | --- | --- | --- |
| Shell | 50,000 | 45,329 | 45,329 | 45,329 | 45,329 |
| Interaction support | 600,000 | 498,250 | 457,025 | 595,647 | 457,541 |
| Accessibility | 650,000 | 586,666 | 586,666 | 586,666 | 586,666 |
| **Total** | **1,300,000** | **1,130,245** | **1,089,020** | **1,227,642** | **1,089,536** |

Lushly's 4,353 bytes of headroom are now 142,459, and the helpers now cost both consumers about the same. Storybook's code is gone from FAST-AF's build. Lushly's keeps 67,152 bytes of it, for the reason below.

**A project has to switch its stories together.** One carrying both sets of helpers is over the interaction ceiling, at about 854,000 bytes on the fixtures. The codemod switches every file at once, so this only catches a partial migration.

### What Lushly has beyond the codemod

The codemod reads story files. On Lushly's snapshot these also need attention:

- Three modules that are not stories import `storybook/test`: `lushly-scheduling-surface.story-queries.ts`, `season-narrow-story-fixture.ts` and `lushly-catalog-workbench.story-helpers.ts`.
- `frames.story-helpers.ts` imports `instrument` from `storybook/internal/instrumenter`, which is the 67,152 bytes above.
- `.storybook/preview.ts` calls `setCustomElementsManifest`.

## AFD's FAST-AF stories

These stories were frozen copies that nothing in AFD ran, since upstream's Storybook configuration and Fastbot were not imported. Now they run here, which answers G12.

| Piece | What it is |
| --- | --- |
| `specimen.config.json`, `specimen/preview.ts` | What upstream's Storybook preview gave every story, without what only its toolbar and addons read |
| The 79 story files | `specimen migrate --helpers --apply`, which changed exactly their two import lines |
| `pnpm test:stories` | Typechecks the stories, runs every one with its accessibility check, applies the story contract, and builds the review page within its budgets |
| The `stories` job in `specimen.yml` | Runs that when `violet-elements`, fast-element or Specimen changes |

`violet-elements` takes Specimen as a development dependency only, so its packed package is unchanged, and `check-boundaries` now treats `.stories.` files as it does `.spec.` files.

**Fastbot.** It was not imported, so there is no adapter to install here and no rule to delete. `specimen contract` is the gate, and it applies every rule Fastbot's story contract did. The adapter stays in `experiments/` for anyone still running Fastbot upstream.

| On AFD's stories | Result |
| --- | --- |
| Stories run | 407 of 407 passed |
| Story contract, `fastbot-parity@1` | 0 errors, 0 warnings, over 77 components and 79 story files |
| Budgets | Shell 45,329, interaction support 457,025, accessibility 586,666, total 1,089,020 |
| Storybook's code in the build | None |

The gate fails when it should: with the calendar bug below put back, the same run reports `MISSING_STATE_STORY` and exits 1.

### The calendar story

The [`Disabled` story that disabled nothing](t07-coverage.md#finding-a-disabled-story-that-disables-nothing) now passes `disabled` through, and its play asserts every inner button is disabled.

**Fixing the story found a real bug in the component.** A disabled calendar disabled only its 2 navigation buttons. Its 42 day buttons stayed enabled and focusable, doing nothing when pressed, and the whole calendar was dimmed, which failed axe's contrast check. `violet-calendar` now passes its `disabled` state into the grid, so every day button is really disabled, and the dimming on the root is gone, since disabled buttons already dim themselves. A spec covers disabling and re-enabling. An accessibility exception would have hidden this.

### Pairs on AFD's stories

`experiments/run-afd-pairs.mjs` compares the two runners on AFD's exact stories and components. AFD has no Storybook, so that side is an overlay outside the repository: upstream's Storybook configuration and dependencies, with AFD's `src`, tokens, manifest and built packages over them, and Storybook's helpers restored in each story. Specimen's side is AFD's own configuration. So the two sides share no helper code.

**A first dry run disagreed on one story, and the reason is already on record.** `components-switch--disabled` failed axe on a cold Storybook run, at 3.17:1 on disabled text, and passed on Specimen. This is [T06's finding](t06-full-runner.md#finding-storybooks-check-can-miss-a-components-rendered-state): both runners normally check before a FAST component applies its args, and a frame slipping through on a cold start shows the settled state. With warm caches, two more pairs agreed on all 407.

## What is left

- The qualifying pairs on AFD's main, once this is merged, and on Lushly's at its cutover.
- The docs marking Specimen as a preview.
- An issue for Lushbot, and the owner's review of the index.
- **For the owner, from T06:** because of that timing, AFD's gate cannot see this contrast problem on disabled text, in this story or in the listbox's two. [Whether to offer a settled check](STATUS.md) is still open.

T09 to T11 are optional additions and are not prerequisites for cutover.
