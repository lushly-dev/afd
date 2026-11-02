# T06 full runner and operational checks

**State, 2026-11-01:** in progress.

- Step 1, exact agreement on both consumers' full retained suites, is implemented on branch `lush/specimens-t06-full-suites`.

The remaining steps are listed [below](#remaining-steps).

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

| Consumer | Storybook, 2 workers | Specimen, one story at a time | Per story |
| --- | --- | --- | --- |
| Lushly | 112 s | 599 s | 686 ms |
| FAST-AF | 14 s | 157 s | 385 ms |

Specimen is 5 to 11 times slower over a full suite in this shape. Each story pays for a fresh browser context, the page's load and axe's fetch, while Storybook shares a page across a file's stories and runs two workers. How the time divides is not measured yet. These are single timings on a shared host, not a [T04](resource-budget-validation.md)-style measurement. Step 2 owns worker limits, and T08's qualifying pairs have to carry this.

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

## Remaining steps

1. ~~Exact agreement on both consumers' full suites.~~ Implemented on branch.
2. **`specimen-run` over a filter,** with worker limits, the once-only retry and flake identities keyed by file and title, and the per-story cost above.
3. **`specimen-a11y`:** checkpoints, incomplete checks and scoped exceptions.
4. **`specimen-profile`:** browser metrics and ready-checkpoint timing, and baseline comparison.
5. **`specimen-matrix` and declared event history.**
6. **CEM and story typechecks, scaffold output,** and verified index links and budgets.
