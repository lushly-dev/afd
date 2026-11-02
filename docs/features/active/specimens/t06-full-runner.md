# T06 full runner and operational checks

**State, 2026-11-01:** in progress.

- Step 1, exact agreement on both consumers' full retained suites, is done and merged in [#674](https://github.com/lushly-dev/afd/pull/674).
- Step 2, suites with filters, worker limits and the once-only retry, is done and merged in [#676](https://github.com/lushly-dev/afd/pull/676).
- Step 3, `specimen-a11y` and native accessibility exceptions, is done and merged in [#679](https://github.com/lushly-dev/afd/pull/679).
- Step 4, `specimen-profile` and baselines, is done and merged in [#681](https://github.com/lushly-dev/afd/pull/681).
- Step 5, `specimen-matrix` and declared event history, is done and merged in [#682](https://github.com/lushly-dev/afd/pull/682).
- Step 6, budgets, the review page and the consumer's tooling, is implemented on branch `lush/specimens-t06-operations`.

The remaining step is listed [below](#remaining-steps).

T06's acceptance comes from the [implementation plan](implementation.md#ordered-implementation-queue): run, accessibility, profile, declared event history and the required context and matrix behaviour over the common lifecycle, with retained plays and helpers, axe policy and exceptions, and ready-checkpoint metrics. CEM and typechecks, scaffold output, flake identities, retry and worker limits are preserved. Exact discovered sets and pass, fail and skip categories MUST agree, and index links and budgets MUST be verified.

## Step 1: the full suites through both runners

`foundations/specimen/experiments/run-retained.mjs --mode full` runs every retained story of one consumer through its own Storybook Vitest config and then through Specimen, on a snapshot prepared as [T05 step 5](t05-compatibility.md#step-5-the-consumers-stories-through-both-runners) describes. Every story must end the same way in both, for the same kind of reason, and every identity must equal the consumer's own `storybook index`.

Two consecutive passes on the same sources agree exactly:

| Consumer | Stories and identities | Storybook | Specimen | Plays run / none | Accessibility (`error` policy) | Disagreements |
| --- | --- | --- | --- | --- | --- | --- |
| Lushly `0eede7f0` | 873 / 873 | 873 passed | 873 passed | 774 / 99 | Every story passed axe | 0 |
| FAST-AF `24e4eb86` | 407 / 407 | 407 passed | 407 passed | 187 / 220 | Every story passed axe | 0 |

Neither consumer has a skipped or failing story, so the deliberately failing categories rest on the `compat/` fixtures in CI, which T05 step 2 records. Storybook here is each consumer's own: Chromium 153 and axe-core 4.13.0 for Lushly, Chromium 145 and axe-core 4.11.1 for FAST-AF. Specimen runs Chromium 156 and axe-core 4.13.0 ([G12](STATUS.md)).

### What the first pass found

The first pass agreed on 1,239 of 1,280 stories. Storybook passed all 1,280, and every identity already matched. The 41 differences had five causes:

| Stories | What Specimen did | Cause | Now |
| --- | --- | --- | --- |
| 21 Lushly | Play failed: `expected null not to be null` | The play reaches for Vitest's real keyboard through `vitest/browser`, which Specimen did not offer | [A real keyboard](#the-real-keyboard) |
| 15 Lushly | Deadline exceeded | Specimen waited for every custom element in the tree to be defined; a component can define one only on intent | [A bounded wait](#elements-defined-on-intent) |
| 2 FAST-AF, 1 Lushly | Axe failed `color-contrast` | The check saw a later state than Storybook's | [Where a play and a check start](#where-a-play-and-a-check-start) |
| 1 Lushly | Play failed on a stale DOM | The same timing, plus promises Storybook lets settle | The same |
| 1 Lushly | Play failed: an iframe got a 404 | Storybook's `staticDirs` | [Static directories](#static-directories) |

### Where a play and a check start

Storybook's runner renders, plays and checks in one chain. When a play starts, a component's promises have settled and no frame has passed since the render. A FAST element writes its attributes and DOM on its next animation frame, so at that point its DOM has not caught up. That decides what a play or an axe check sees.

Specimen differed in two ways, measured with a timeline inside Lushly's Notes Follow View:

- Its play could start before the component's promises settled. `waitFor` then fell back to polling, and a frame passed while it waited.
- It called the page twice, once to mount and once to run, and imported axe after the render. Each gave a due frame its chance to run. Chromium posts a task for every dynamic `import()`, and axe was a real 586 KB fetch in each story's fresh browser context.

A retained run now follows Storybook's order:

- The story runtime and axe load before the render.
- `mountAndRun` is one call: render, 32 microtask turns, play, accessibility check, then the frame.
- The turns stand in for the awaits in Storybook's render phases. A task here would not do: when a frame is due, Chromium runs it first.
- The page asks for `instrument=true`. Storybook's helpers instrument themselves only inside an iframe, as under Vitest, unless the URL asks.

`compat/` pins this in both runners in CI: a `Next Frame` story's play checks that a component's state has settled from its promise chain and that its DOM has not been written, then that one frame later it has.

### Finding: Storybook's check can miss a component's rendered state

On a story with no play, Storybook's axe runs before a FAST component has applied its args. At that moment FAST-AF's disabled switch has no `disabled` attribute and full opacity. T06 requires exact agreement, so Specimen now checks at the same moment and inherits this blind spot. This is recorded, not silent.

The evidence of what it hides:

- Specimen's earlier check, which ran after a frame, found 3 failures in 1,280 stories, all `color-contrast` on disabled text: FAST-AF's switch (3.17:1) and listbox (2.44:1 and 3.63:1), and Lushly's settings surface (3.03:1).
- FAST-AF's Storybook, patched in a throwaway copy to wait one frame before its check and running axe-core 4.13.0, fails exactly its two and passes the other 405.

These may be false positives. WCAG 1.4.3 exempts inactive controls, but axe recognises a disabled custom element only through `aria-disabled`. Whether to offer a settled check as a stricter option after cutover is open ([follow-up](STATUS.md)).

One difference remains. Storybook shares a page across a file's stories, so a file's first story fetches axe and can let a frame through, and its later stories do not. Specimen gives every story a fresh page with axe already loaded, so it always takes the no-frame path. The suites above agree regardless.

### The real keyboard

Lushly's keyboard journeys use `userEvent.keyboard` from `vitest/browser` for trusted events and the browser's own focus navigation. A story's bundle now resolves `vitest/browser` to a stand-in (`src/browser/vitest-browser.ts`) that calls the host through a CDP binding while the play runs:

- `host/src/keyboard.rs` reads testing-library's key syntax as Vitest does: `{Enter}`, `[KeyA]`, `{Shift>}`, `{/Shift}`, `{a>3/}` and escaped brackets.
- It sends each key as Playwright does, with the US layout, modifiers, `ControlOrMeta` and macOS editing commands. Text outside the layout is inserted. A held key stays held between calls.
- The tables in `host/src/keyboard_data.json` are generated from playwright-core 1.63.0 (Apache-2.0) and `@vitest/browser` 4.1.12 (MIT).
- The stand-in offers `userEvent.keyboard` only; any other method throws an error naming it.
- On a page without the host, such as a static preview, `userEvent` is undefined, as Lushly's helper finds it outside Vitest.

### Elements defined on intent

`lushly-plant-detail` holds `lushly-plant-quality` undefined until its disclosure opens, so waiting for that tag never ended. A retained story now waits at most 250 ms for its tags; Storybook does not wait at all. Each tag still undefined is recorded on the capture: `Custom element <x> was still undefined when captured.` A native specimen still waits for its elements.

### Static directories

`staticDirs` in the configuration is Storybook's option: a path served at `/`, or `{ from, to }`. The host serves these at the page's origin, and each file a render loads is recorded with its digest as `static:<path>:<digest>`. With renders in parallel, a file counts as loaded by every render in progress, since its URL has no render token. A static build copies the directories into its output.

### Smaller changes

- A deadline now names the phase, and for a run the stage: `Specimen deadline exceeded after 10000ms while running the accessibility check`, or `…with a script blocking the page` when the page cannot answer.
- Each axe violation now carries `details`, axe's explanation per target, such as the contrast it measured.
- The packed-artifact check removes its consumers after a passing run. Each run was leaving about 254 MB by `du` in the temporary directory.

### Speed

[Step 2](#step-2-suites) measures and closes most of this. The figures at this step:

| Consumer | Storybook, 2 workers | Specimen, one story at a time | Per story |
| --- | --- | --- | --- |
| Lushly | 112 s | 599 s | 686 ms |
| FAST-AF | 14 s | 157 s | 385 ms |

Specimen is 5 to 11 times slower over a full suite in this shape. Each story pays for a fresh browser context, the page's load and axe's fetch, while Storybook shares a page across a file's stories and runs two workers. These are single timings on a shared host, not a [T04](resource-budget-validation.md)-style measurement.

### Evidence

Local evidence is in `~/.cache/afd-specimens/t06-20261101/evidence/`. It is ignored, local and not publication evidence. Raw Vitest reports there are gzip-compressed; `axe413` holds the patched Storybook's report.

| File | SHA-256 |
| --- | --- |
| `lushly-full-1/retained.json` (first pass) | `f19a30c8cb7708fdeea48690000f80eea525f933934c6b7a8207b7cf1eb56b31` |
| `fast-af-full-1/retained.json` (first pass) | `695907f1a29b7abd049d305bfb99b3194b3768bb882eaf11ff39a0ecfacf6c74` |
| `lushly-full-2/retained.json` | `cf4ba879e13521f795f09a0ccecbd901718e5cd49e89ad6e687d866093f13fe6` |
| `fast-af-full-2/retained.json` | `8d23c0661f09f8e35c070de5732bd00a58329afe2b0760d71143e6349931342f` |
| `lushly-full-3/retained.json` | `2633770c02defcf9beb7932ccb919fad9b89601707d401a82625f8531758e886` |
| `fast-af-full-3/retained.json` | `e5424e9864b5fbb24bb398d589604b4513403d7ed23304f17481614820c81246` |
| `axe413/report.json`, before compression | `c22f7c8974df380cb3acb43db6de6340cb4e0d4232fa8e7c4c9016f26ebe15b9` |

## Step 2: suites

`bench.runSuite()`, `specimen-run` without an `id` and `specimen run` without an `ID` run many retained stories against one snapshot of the sources. The [README](../../../../foundations/specimen/README.md#suites) documents the options.

### The rules

| Obligation | What a suite does |
| --- | --- |
| Filter | `ids`, `file`, `tags`, `match`; every condition given must hold, and matching nothing is an error |
| Worker limit | `workers`, defaulting to `test.workers` in the configuration, then 2, Lushly's cap |
| Once-only retry | With `retry`, up to `flakeCap` failures (default 2, Lushly's `FLAKE_CAP`) rerun once, one at a time. More failures than that are not retried: they cannot pass as flakes |
| Classification | As Lushly's `classifyRerun`: `passed-with-flake` only when every retried story passes, otherwise `failed-after-retry` |
| Flake identity | `storybook:<file>::<name>`, Lushly's exact key, so its records stay valid. Vitest's titles here are flat: no ancestors, the story's name |
| Deadline | 15,000 ms per story, or `test.timeoutMs`: Vitest's browser `testTimeout`, which neither consumer overrides. Specimen's was 10,000 ms |
| Exit status | `specimen run` exits 1 when the stories failed, for one story or a suite; the command itself still succeeded |

Lushly's flake ledger, stage plan and issue filing stay Lushly's; [T08](implementation.md#ordered-implementation-queue) points them at this output.

### Where the time went

Instrumenting a 59-story Lushly sample, one at a time, at 546 ms per story:

| Step | Mean |
| --- | --- |
| Checking the bundle's sources | 208 ms |
| Play and accessibility check | 110 ms |
| Story modules and axe | 86 ms |
| Capture | 81 ms |
| Opening the page | 51 ms |
| The rest | About 10 ms |

The largest item was a bug. The source check takes 2.6 ms for 1,272 files; the other 205 ms was a **full rebuild of the bundle on every render on macOS**. The bundle's own generated entry sits in a temporary directory that the code skips by path prefix, but module ids are resolved (`/private/var/…`) and the configured path is not (`/var/…`, a symlink). So the entry looked like a source written during the build, and the generation was always stale. The comparison now uses the resolved path.

[T04](resource-budget-validation.md)'s macOS figures included that rebuild for its smaller wrappers, so they overstate warm-render cost. They were not remeasured; its gate passed regardless. Linux has no such symlink under `/tmp`.

Three more changes:

- A suite keeps a capture only of failures by default, since it costs more than some stories' runs. `capture` can ask for all or none.
- Workers really do run at once: a suite is one bench operation with its own pool, since `run` is serialized.
- A retained story no longer asks its page to dispose. It has nothing to dispose in the page, Storybook has no such step, and the context closes next. On a heavy story, a busy page could not answer within the 1 s budget, which failed stories that had passed.

### Results

Single runs, one at a time on the same 59-story sample, went from 546 ms to 342 ms per story on Lushly.

| Consumer | Storybook, 2 workers | Specimen before, 1 at a time | Specimen, 2 workers | Specimen, 4 workers |
| --- | --- | --- | --- | --- |
| Lushly | 112 s | 599 s | 161 s | 129 s (load about 13) |
| FAST-AF | 14 s | 157 s | 41 s | 48 s (load about 13) |

The first two columns come from the end of step 1, and the 2-worker runs from a quieter period (load 4 to 9). A later pair under load of about 13 took 166–173 s against 209–228 s on Lushly, and 19–20 s against 74–82 s on FAST-AF. These are single timings on a shared host. Lushly is now within about 1.4 times Storybook's wall clock, and FAST-AF about 3 to 4 times. Each Specimen story still has a fresh browser context, a fresh page load and its own fetch of axe, while Storybook shares a page across a file's stories. Whether to narrow that further is open.

Three more passes of both suites through both runners, using this API with two workers, agreed on every story and every identity. In the second, on Lushly, both runners failed the same one story. The third ran on the final code, with the 15 s deadline, under load of about 9: 873 of 873 and 407 of 407 passed in both, in 169 s against Storybook's 107 s on Lushly and 58 s against 19 s on FAST-AF.

### Finding: a load-sensitive story in the incumbent

`lushly-site-site-surface--hover-rim` is heavy: the site surface's stories took 4 to 8 s each in Storybook under load. In that pass, under load of about 14, its Storybook test ran 16.6 s and failed its deadline, and Specimen's stopped with a script blocking the page. Its 4-worker run failed the same story in the accessibility check. This is the flake the once-only retry is for, and T08's qualifying pairs will have to carry it. The deadline in those runs was still 10 s on Specimen's side, shorter than Storybook's 15 s; it now matches.

### Evidence

| File, in `~/.cache/afd-specimens/t06-20261101/evidence/` | SHA-256 |
| --- | --- |
| `lushly-suite-4/retained.json` | `ad71c09855ed57dbf80777a645f29a595fd787b5fcd9bf35647402c0c05c8c47` |
| `fast-af-suite-4/retained.json` | `8dce1751ce3b59dd8b27b0148fa977859781ca0e7188dda69d8e620bc88c0fd1` |
| `lushly-suite-5/retained.json` | `ae83a2743cf0f73a9a56b52d6b46163a7ae61b5d8f3cf1a14d447807ca11770f` |
| `fast-af-suite-5/retained.json` | `8ab78b352279e89bc795b280777e0e16afab3923fc57442d27fcfa96a697a129` |
| `lushly-suite-6/retained.json`, the final code | `80c924a7cc0b75b3f71989c3e4fc93c7c8641f62f3af96301fda532bed6760a6` |
| `fast-af-suite-6/retained.json`, the final code | `91738286787e13fd1774ab8db2b9651710466f9327bd8d31a6e59328b6e019c7` |

## Step 3: `specimen-a11y`

`bench.a11y()`, `specimen-a11y` and `specimen a11y [ID]` run axe at a checkpoint, on one entry or those a filter selects. The [README](../../../../foundations/specimen/README.md#check-accessibility) documents the surface.

What the consumers need here is narrow. T01's inventories record no per-story accessibility overrides in either consumer, and no story file sets `a11y`: every story takes the project's `test: 'error'`. So retained stories keep their effective policy through this path, exactly as `run` applies it, and the new work is the proposal's native contract:

| Obligation | What it does |
| --- | --- |
| A check at a checkpoint | Native: any scenario checkpoint, defaulting to its end. Retained: `after-run`, with the play first, or `mount`. A play that fails stops the run, so the report says `not-run` and names the failure |
| Incomplete checks | `incompleteChecks` lists what axe could not decide, per target, without passing or failing it. `run` had only a count |
| Scoped exceptions | `a11y.exceptions` on a native specimen excuses one rule on one target and what is inside it, through shadow roots. The same rule elsewhere still fails, as does another rule on that target |
| Reasons in reports | An exclusion without a reason, or an exception without a target, fails the specimen. Each report lists its exceptions, their reasons and what they excused |
| Disabled checks | `a11y.disabled` requires a reason, and the report says `not-run` with it |
| Native policy cannot override a story | The `a11y` field exists only on native specimens. A retained story's report always has `exceptions: []` |

An exception that excused nothing reports `matched: []` rather than failing, so a stale one is visible without breaking anything. Whether a stale exception should fail belongs with T07's rule retirement.

The proposal says "axe and available schema checks". No schema source declares a check, so there are none to run; T07's coverage is where such obligations arrive.

The capture also tells the truth now. `channels.a11y.axe` was the literal `'not-run'` even when `run` had just run axe. It now records the outcome, the channel's completeness is `complete` when a check ran, and `diffObservations` reports a change in the rules and targets axe found. An unrun check on either side is a limitation, not a difference. `CAPTURE_VERSION` moves to `0.3`.

Failure fixtures are in `fixtures/accessibility/` and `compat/failing/`, tested by `src/a11y.test.ts` in CI.

## Step 4: `specimen-profile`

`bench.profile()`, `specimen-profile` and `specimen profile [ID]` measure entries at a checkpoint, and `bench.recordBaseline()`, `specimen-baseline` and `specimen baseline ID` record the results. The [README](../../../../foundations/specimen/README.md#profile) documents the surface.

The incumbent here is FAST-AF's Fastbot plugin, `fastaf_profile_story` and its siblings, over Storybook's iframe, and the rules are ported from it:

| Obligation | What Specimen does |
| --- | --- |
| Metrics | First contentful paint, DOMContentLoaded, load, elements, custom elements, shadow hosts, requests, transfer size, heap and console counts. New: `readyMs`, navigation start to the checkpoint, and `captureMs`. `violetElements` is left out as consumer-specific |
| Runs | Medians over 1 to 7 fresh browser contexts, default 3, one at a time |
| Flags | Fastbot's codes and thresholds: paint over 1,600 and 2,500 ms, elements over 450 and 700, shadow hosts over 35, console messages |
| Tolerances | Fastbot's: paint and heap 1.2 times the baseline, elements and transfer 1.15, requests 1.1 |
| Budgets | An absolute budget failing is an error, and always applies. Console counts hold to the budget, or else the baseline |
| Baseline format | FAST-AF's `story-performance-baselines.jsonc`, extended with `runner`, `checkpoint`, `browser` and `source`, so a record says where it came from |

Differences from Fastbot:

- **The ready checkpoint is explicit.** `mount` waits for the specimen's readiness, fonts and a frame, and any scenario checkpoint can be profiled instead. Fastbot waits on Storybook's page.
- **Metric compatibility is checked.** A baseline from another page, viewport, checkpoint or browser is `not-comparable`, with its reason, and never reads as a regression or a pass. The proposal requires this: new baselines are dated and attributable to the page cutover.
- **A recording replacing a Storybook baseline says so in its notes,** and keeps budgets a person set.
- **Heap comes from CDP's `Runtime.getHeapUsage`,** not `performance.memory`, which Chromium quantizes.
- **No trace capture or screenshots.** `render` takes screenshots, and Fastbot's optional trace is not ported. Fastbot's suite validator maps to `profile()` without an id or filter.

A retained story loads axe only when a check will run, so a profile at `mount` does not count its bytes. At `after-run`, its play and check are part of what is measured.

### Findings on the consumers

**FAST-AF's only recorded baseline is orphaned.** It names `foundations-violet-foundations--reference-kit-lab`, and that story's id is now under `foundations-overview--…`, so it has compared against nothing since the rename. `profile()` reports it in `orphanedBaselines`. Lushly has no story performance baselines, and neither consumer's hooks, CI or scripts call the profile validators. So no gate relies on a profile comparison today, and recording new baselines at cutover loses nothing.

**`lushly-site-site-surface--hover-rim` is heavy after it is ready.** Ready in 183 ms, its capture took 5.1 s in one run and over 10 s in another. It's the story both runners failed under load in step 2, and this suggests where its time goes, though not why.

Real measurements at `mount` on this host, under load of about 9, with Chromium 156. These illustrate the output; they are not baselines:

| Story | First paint | Ready | Elements | Shadow hosts | Requests | Transfer | Heap | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `foundations-overview--overview` | 184 ms | 165 ms | 1,593 | 0 | 19 | 3.2 MB | 6.4 MB | Large DOM, console warnings |
| `components-listbox--disabled` | 160 ms | 150 ms | 60 | 5 | 12 | 2.6 MB | 5.8 MB | Console warnings |
| `lushly-detail-plant-detail--all-fields` | 188 ms | 408 ms | 371 | 47 | 33 | 5.3 MB | 8.8 MB | Many shadow hosts, console warnings |

Each page's bundle is unminified, as under a development server, so transfer sizes are larger than a build's.

## Step 5: `specimen-matrix` and declared events

The [README](../../../../foundations/specimen/README.md#declare-events) documents both. Neither has an incumbent to agree with: Storybook has no matrix, and no retained story declares events, so these are the proposal's native contract, tested on fixtures in `fixtures/events/`.

### Declared events

| Obligation | What it does |
| --- | --- |
| Declared types and targets | `events` on a native specimen. "There is no promise to capture every possible event": nothing else is observed |
| Listeners before insertion | The mount root's listener is installed before the specimen is rendered |
| Relevant roots and targets | A document-level listener cannot see a non-composed event. A declared target, and its open shadow root, get their own listeners once the target exists, and a fixture proves a non-composed event inside a shadow root is seen |
| Ordered history | Type, target, step interval, composed, bubbling, trusted and a `CustomEvent`'s `detail`, with functions and nodes described rather than serialized |
| An expectation states its interval | `expect` must name an earlier step in `since`. Fixtures prove an earlier event, or the same event on another target, cannot satisfy it |
| Missing observation surfaces first | An expectation of an undeclared event fails validation, before anything runs. A target that never resolved makes the channel `partial`, with its name |

Two limits, recorded in the output rather than hidden:

- An event of a declared type before its target exists is kept with `target: null`, since it cannot be ruled out. A fixture shows a click on another button recorded this way, ahead of the target appearing.
- A non-composed event inside a target's shadow tree, fired during mount before the target is bound, is not seen. Nothing can listen there yet.

Schema and plugin event declarations, which the proposal says may supplement these, are not read yet. Retained stories declare none, so their channel is `not-requested`. `channels.events` replaces the old `EVENT_CAPTURE_NOT_IMPLEMENTED` reason, and `CAPTURE_VERSION` moves to `0.4`.

### The matrix

| Obligation | What it does |
| --- | --- |
| One isolated capture per cell | Each combination is its own capture in its own browser context, run in the worker pool. At most 64 cells; more is an error that says how many |
| Comparable cells diff against the first | `diffObservations`, allowing differences on the requested axes only. Fixtures show a theme changing styles but not the DOM, and a viewport changing the DOM |
| Unavailable cells stay visible | A cell that fails to capture is `unavailable` with its reason, and is not an error. If it would have been the first, the first captured cell becomes the comparison |

A cell the comparison refuses, because a story settled a context of its own, reports `insufficient-evidence` with the reason.

Each request parser now has a test that it agrees with its public Zod schema on the same inputs, as the configuration's already did. Those tests found two real disagreements in this step, now fixed: the matrix schema accepted any theme string that the bench then refused, and the parser ignored a non-boolean `observations`.

## Step 6: budgets, the review page and the consumer's tooling

The build was measured for the first time on both consumers' full story sets. Lushly's failed the total once it was counted honestly, so the design changed. Linking every story then found two bugs in the review page.

### Budgets

Every figure is minified UTF-8 JavaScript from a real `bench.build` of the whole retained set, read from `specimen-build.json`. Each category is its own chunk, so these are exact bytes, not shares of a mixed chunk.

| Category | Ceiling | FAST-AF `24e4eb86` (407) | Lushly `0eede7f0` (873) |
| --- | --- | --- | --- |
| Shell, with capture code | 50,000 | 41,332 | 41,332 |
| Interaction support | 600,000 | 492,831 | 590,228 |
| Accessibility | 650,000 | 586,666 | 586,666 |
| **Total** | **1,300,000** | **1,120,829** | **1,218,226** |
| Reported only: catalog | None | 217,978 | 598,043 |
| Reported only: incumbent | None | 167,524 | 143,391 |
| Reported only: consumer | None | 1,981,853 | 3,772,575 |

Three accounting errors had hidden the real position, each corrected here:

- **The catalog was in the shell.** The generated list of stories sat in the entry chunk, so a real consumer's build failed at 254,667 bytes against 50,000. It is now its own chunk and the shell no longer grows with the story count. A test holds that.
- **A play's helpers counted as consumer code.** [T05](t05-compatibility.md#budgets) reasoned that `storybook/test` is the consumer's own import during the overlap. The proposal names those helpers as interaction support and says built-in bench dependencies must not be relabeled consumer code, so that reasoning was wrong. They are now counted as interaction support however a story imports them.
- **The capture normalizer sat outside the shell.** T05 gave its 154,389 bytes a category of their own and left G06 open on whether they belonged under the shell ceiling. The proposal's shell row already answers that: "reusable capture code included".

Counted correctly, Lushly's total was 1,368,628, over by 68,628. The proposal says that a budget that cannot be met requires a design revision, and that excluding a dependency is not a pass. So the design changed: the normalizer no longer carries parse5.

**The normalizer is now a scan of 140 lines, and parse5 is gone from the package's dependencies.** A capture's DOM is the browser's own serialization, so it does not need a tree built: `normalizeDom` finds the start tags and template scopes, sorts attributes and renames generated ids. The shell grew about 3,500 bytes in this step, the scan included. `experiments/check-normalizer.mjs` holds it to the parse5 version on every story's real capture:

| | FAST-AF | Lushly |
| --- | --- | --- |
| Stories, each with a capture | 407 | 873 |
| Raw DOM | 3,218,324 bytes | 29,007,115 bytes |
| With a serialized shadow root | 393 | 872 |
| Byte-identical to parse5 | 407 | 870 |
| Page's value equal to Node's | 407 | 873 |

The three that differ, all Lushly's, differ in one way: Chromium writes `<` and `>` in an attribute as `&lt;` and `&gt;`, the scan keeps them, and parse5's serializer did not. Those three become byte-identical once both are unescaped. Two deliberate differences follow from building no tree, each with a test:

- A structure a parser would repair, such as a table row with no `tbody`, stays as the DOM had it. None of the 1,280 captures has one.
- The parse5 version mangled a `textarea` holding a leading newline and an escaped character, cutting `\n&lt;i&gt;` to `;i&gt;`. The scan keeps it.

Comparison still derives normalized DOM from raw every time, so a stored value is never trusted. `NORMALIZATION_VERSION` is now 0.2, so a capture from before this step is refused with a request to recapture.

**What is still open on budgets:**

- **The rest of Storybook is reported, not counted.** This is a judgment for the owner to check. `incumbent` is the framework a consumer's preview imports (`@storybook/web-components-vite`), not a dependency of Specimen, and it goes at cutover. If it were counted, interaction support would be 660,355 and 733,619, over the 600,000 ceiling, and Lushly's total would be 1,361,617, over 1,300,000. T08 has to measure this again when a native helper entry replaces `storybook/test`.
- **Lushly's interaction support has 9,772 bytes of headroom.** A larger `storybook/test` would fail its build, which is what the ceiling is for.
- **A retained story with no helpers still loads them during the overlap.** The preview imports the framework, which shares modules with the helpers. Few stories could avoid it: all 79 of FAST-AF's story files import helpers, and 144 of Lushly's 150. A native specimen loads none of this, and a test holds that.

### The review page

`experiments/check-index.mjs` opens a static build as a reviewer would, over a plain server with no Vite and no host, and follows every link in Chromium. Requests to other origins are blocked and not counted.

| | FAST-AF | Lushly |
| --- | --- | --- |
| Entries in the manifest, links in the index | 407, 407 | 873, 873 |
| Story modules the index loads | 0 | 0 |
| Theme and viewport controls on the index | Present | Present |
| Links that open, with no error shown | 407 | 873 |
| Cases that load another story's module | 0 | 0 |
| Cases with a page error | 0 | 0 |
| Cases with a local URL that fails | 0 | 1, the consumer's own |
| Every 20th, opened at another viewport | 21 of 21 | 44 of 44 |
| Those with a dark scheme, or the page's notice that it cannot give one | 21 of 21 | 44 of 44 |
| Those with a play, run at `checkpoint=after-run` | 9 of 9 pass | 38 of 41 pass |
| Every 20th, reopened to the same DOM | 15 of 21 | 11 of 44 |

The build now also meets three parts of the proposal it did not:

- **The manifest lists the cases.** `specimen-build.json` gains `entries`, each case's identity and link, alongside `total`, `categories`, `reported` and `chunks`, so the build can be read without running it.
- **A link can carry a checkpoint.** `checkpoint=after-run` runs a retained story's play in the preview. Any other named checkpoint needs the host's real input, so the page shows the mount and says so, naming the `specimen render` command that reaches it. A play has 15 seconds.
- **The frame says when it is ready,** with `data-specimen-preview="ready"` on its root element.

Following the links found two bugs, both fixed:

- **A retained story's error was invisible.** Its mount replaces the `<main>` root with a `<div>`, and the alert went into the detached element. A failing play or render looked like a page that never finished.
- **The static build bundled the real `vitest/browser`.** Specimen's plugin ran after Vite's resolver, so the stand-in only worked under the host. A play importing it failed with Vitest's "only inside the Browser Mode" error instead of finding `userEvent` undefined.

Findings on the consumers:

- **Lushly's one failed URL is its own.** Its field-notes pages reference `/field-notes/assets/context.js`, which is not in its tree at this snapshot.
- **Lushly's canvas follows the browser's color scheme.** A dark link gives a light canvas on 43 of the 44 sampled stories, because a static page cannot emulate `prefers-color-scheme`. The page already says so in its notice, and the host's render of the same story is dark. The same links on FAST-AF show dark.
- **Three sampled plays failed in a headless preview.** Both of Lushly's keyboard journeys assert that a real keyboard exists when `navigator.webdriver` is set, and show that message in the frame. The third, `lushly-site-pressure-facts--saved-refresh-error`, failed an assertion on this pass and passed on the one before, so it varies in the preview. Not investigated further: all three pass under the host, where every suite decision is made.

**Reopening a link does not always give the same DOM,** and this matters beyond the preview. FAST writes a marker into its template comments, chosen with `Math.random` once per page load. So two host renders of an unchanged FAST story report `dom` as changed, and `specimen-diff` and `specimen-matrix` inherit that. The proposal requires a declared baseline for randomness, and [T03's record](driver-context-validation.md#provenance-fields) assigns that to T06. It was not done, so it is step 7 below.

### The consumer's tooling

`experiments/check-scaffold.mjs` runs Lushly's own commands on a throwaway copy-on-write clone of its snapshot:

| Step | Result |
| --- | --- |
| `check:cem` | Passes |
| Story typecheck (`tsc -p .storybook/tsconfig.json`, 2,315 files with 150 story files) | Passes before and after the scaffold |
| The same typecheck with a wrong argument type added to the new story | Fails with TS2322, as it should |
| `component:new shared/lushly-specimen-probe`, then `cem:analyze` | Writes the component, its story and the manifest entry |
| Identity of the new story | `lushly-shared-specimen-probe--overview` under `storybook index` and Specimen |
| `validate` on the new story | No issues |
| The story under Storybook's Vitest and under Specimen | Passes in both; under Specimen its play ran and axe passed |

Specimen edits nothing in a consumer, so its typecheck and CEM check are unaffected, and this confirms that. FAST-AF has no story typecheck script of its own. Its `tsconfig.json` covers its 79 story files with no errors in them, and reports 7 in one Playwright spec (`violet-segmented-control.spec.ts`), which predate this work.

`validate` gains a manifest check: `COMPONENT_NOT_IN_MANIFEST`, a warning when a story's `component` is not in the configured manifest. FAST-AF has none. Lushly has 5, on `violet-button` and `violet-text-field`, which come from a package its manifest does not cover, so it is a warning and not an error.

T08 needs this recorded: these stories' types and helpers still come from Storybook (`Meta` and `StoryObj` from `@storybook/web-components-vite`, `expect` and `fn` from `storybook/test`). Removing Storybook needs a native helper entry and types first. A Specimen-native generator is T07's `specimen-suggest`.

## Remaining steps

1. ~~Exact agreement on both consumers' full suites.~~ Merged in #674.
2. ~~`specimen-run` over a filter, with worker limits, the once-only retry and flake identities.~~ Merged in #676.
3. ~~`specimen-a11y`: checkpoints, incomplete checks and scoped exceptions.~~ Merged in #679.
4. ~~`specimen-profile`: browser metrics and ready-checkpoint timing, and baseline comparison.~~ Merged in #681.
5. ~~`specimen-matrix` and declared event history.~~ Merged in #682.
6. ~~CEM and story typechecks, scaffold output, and verified index links and budgets.~~ Implemented on branch.
7. **The declared baseline and the rest of the capture manifest.** Seed `Math.random` so an unchanged FAST story compares as unchanged, and record clock, randomness, storage and fixtures in `manifest.checkpoint.baseline`. [T03](driver-context-validation.md#provenance-fields) also defined fields the proposal's envelope requires and that never landed: the bench and plugin versions, driver, platform, pixel ratio, resources, action mode and readiness outcome.
