# Frozen inputs and retained-story inventory (T01)

Status: recorded locally on 2026-10-31 for both consumers. Source bytes, installed graphs and generated inputs are bound to their snapshots. Remote fonts, browsers and the host are recorded, and the baseline policy is embedded in each manifest. Storybook's own index and a static annotation pass enumerate every retained story. The owner confirmed the policy's numeric tolerances on 2026-10-31, before any comparison. Remote fonts and per-runner browsers remain unfrozen runtime conditions.

## Accepted revisions

| Consumer | Revision | Why this snapshot |
| --- | --- | --- |
| Lushly | [`b8906b7549dbadab5312122b01a9d277fdfc4690`](https://github.com/lushly-dev/lushly/commit/b8906b7549dbadab5312122b01a9d277fdfc4690), `origin/main` fetched 2026-10-31, committed 2026-10-30T23:04:31-07:00 | Current accepted main. Lushly now commits its FAST and Violet builds as vendored tarballs, so one commit binds the Violet bytes that drifted under the earlier `70d48221` studies (G01). That earlier linked build is not recoverable and is not reused. |
| FAST-AF incumbent | [`24e4eb86774fdb8b476b6140dd7507e3fcd4f6c8`](https://github.com/lushly-dev/fast-af/commit/24e4eb86774fdb8b476b6140dd7507e3fcd4f6c8), upstream `origin/main` fetched 2026-10-31 | Storybook configuration, its Vitest project, Fastbot and the CI Storybook scope were not imported into AFD and remain upstream. The 79 story files there are byte-identical to AFD's `foundations/fast-af/packages/violet-elements` at `7c94e223`; one `.spec.ts` differs as a recorded AFD adaptation. Since the reconciled `5e64a6a5`, upstream has changed only documentation and the Fastbot CI job's runner image (#240, #241). |
| Candidate | AFD `7c94e22303494c012be128af522f364ac0af7d3b` plus this change's experiment tools | Native Specimen code is unchanged from `459f8965` (#517). |

AFD has no runner for the FAST-AF stories it now owns: the incumbent interaction/axe suite for those files runs only in the upstream repository against its frozen copy. Lushly consumes Violet from its vendored `0.1.0-repaired-d5e6eaf-grid-cell-hints` tarball, not from AFD's `foundations/fast-af` source.

## Snapshot and binding method

Each snapshot is a `git archive` of the pinned commit, extracted outside every repository to `~/.cache/afd-specimens/t01-20261031/<consumer>`, then installed with its own declared pnpm (`corepack pnpm install --frozen-lockfile`, `CI=1`) and prepared with the consumer's pre-Storybook scripts. Neither original checkout was modified; the developer Lushly checkout had unrelated uncommitted work and was used only for read-only `git` access.

| Check | Lushly | FAST-AF |
| --- | --- | --- |
| Tracked files matching the Git tree by blob id, executable bit and symlink text | 5,822 / 5,822; 0 missing, 0 modified | 2,699 / 2,699; 0 missing, 0 modified |
| Package manager | pnpm 10.32.1 | pnpm 9.1.0 |
| Installed `lock.yaml` equals `pnpm-lock.yaml` | Yes, `6509d876…8138` | Yes, `a477fa92…e408` |
| Virtual-store entries | 747 | 1,575 |
| Install result | Exit 0; root `prepare` skips Git hooks outside a worktree; one workspace bin warning (`@lushly/server` CLI not yet built) | Dependencies installed; root `prepare` (`lefthook install`) failed outside a Git repository, after all dependency lifecycle scripts ran |
| Preparation | `pnpm cem:analyze`, `pnpm --filter @lushly/web prebuild` | `theme:violet`, `icons:violet`, `cem:violet`, fast-element `build:tsc` |
| Generated inputs, hashed | 123: `custom-elements.json` and 122 generated field-notes files | 232 fast-element `dist` files; regenerated theme, icons and the committed CEM are byte-identical to the tree |

Two complete recordings of each manifest, including fetched font bytes, were identical apart from timestamps. Two independent `storybook index` runs produced identical indexes, and the inventory is byte-identical across both.

### Selected installed packages

| Package | Lushly | FAST-AF |
| --- | --- | --- |
| `storybook` and the four `@storybook/*` addons/framework | 10.6.2 | 10.3.1 |
| `vitest` / `@vitest/browser-playwright` | 4.1.12 / 4.1.12 | 4.1.12 / 4.1.12 |
| `playwright` / `playwright-core` | 1.63.0 / 1.63.0 | 1.58.2 / 1.58.2 |
| `vite` | 8.3.3 | 8.3.5 |
| `axe-core` (via `@storybook/addon-a11y`) | 4.13.0 | 4.11.1 |
| `@lushly-dev/fast-element` | 3.0.1 from vendored tarball | 3.0.1 workspace source |
| `@lushly-dev/violet-elements` | 0.1.0 from vendored tarball | workspace source |

Every selected package also records its resolved location and a whole-directory content digest. Lushly's three vendored tarballs are hashed individually.

### Browsers, host and candidate tooling

| Runner | Playwright | Chromium |
| --- | --- | --- |
| Lushly incumbent | 1.63.0 | 153.0.8010.12, r1243, present |
| FAST-AF incumbent | 1.58.2 (CI image `mcr.microsoft.com/playwright:v1.58.2-noble`) | 145.0.7632.6, r1208, present |
| Specimen candidate | 1.64.0 | 156.0.8078.4, r1248, present |

All three runners use different Chromium builds. An incumbent/candidate comparison on its own runner's browser would include a browser-version difference. T03/T04 MUST either run each pair on one build or report the browser as an uncontrolled difference (G12).

The host is a Mac17,4 with an Apple M5: 10 logical cores (4 performance, 6 efficiency) and 24 GiB of memory, running macOS 27.0.1 (26A434), kernel 27.0.0. Node is 24.21.0, with the binary's SHA-256 `e4b5a3af…e79b` recorded. The candidate uses Vite 8.3.0 and TypeScript 5.9.3.

### Assets and fonts

| Asset | Lushly | FAST-AF | State |
| --- | --- | --- | --- |
| Storybook `staticDirs` | `apps/web/public/site` (64 files, 4,440,534 bytes); `apps/web/public/field-notes` (122 generated files, 9,706,790 bytes) | None | Bound by content digest |
| Google Fonts stylesheet from `preview-head.html` | 1 stylesheet, 7,062 bytes; 18 font files, 432,216 bytes | 1 stylesheet, 103,220 bytes; 244 font files, 4,991,768 bytes | Fetched 2026-10-31 with a Chromium 156 user agent and hashed; **not frozen at runtime** |

Both incumbents load these fonts from the network on every run, and Google may vary the CSS by user agent; the manifest records the agent used. The earlier native pilots omitted them. T03/T04 MUST choose one condition for both runners, either serving the recorded copies or blocking the fonts in both, and record it.

## Retained-story inventory

Discovered identities and tags come from each consumer's own `storybook index` at the pinned snapshot. The static CSF pass reads every indexed file. Index exports and readable exports agree in both consumers, with 0 mismatches.

| Measure | Lushly | FAST-AF |
| --- | --- | --- |
| Story files / docs entries | 147 / 111 | 79 / 79 |
| Stories (all tagged `test`, none excluded or skipped) | 858 | 407 |
| Effective play: story / meta / unknown | 746 / 8 / 5 | 187 / 0 / 0 |
| Smoke-only: tested, not skipped, no play | 99 | 220 |
| Files with no play | 5 | 0 |
| Play declarations in source / files declaring one | 748 / 142 | 188 / 79 |
| Render source: meta / story / unresolved | 801 / 50 / 7 | 307 / 100 / 0 |
| Explicit story names / explicit CSF ids | 305 / 0 | 3 / 0 |
| Story-level decorators; loaders, `beforeEach`, `afterEach`, `mount` | 1; none | 0; none |
| Play context read | `canvasElement` 753, `args` 1, `step` 1 | `canvasElement` 187, `args` 6 |
| `storybook/test` imports by file: `expect` / `waitFor` / `userEvent` / `fn` / `within` | 141 / 80 / 52 / 22 / 1 | 79 / 37 / 36 / 6 / 4 |
| Files using jest-dom matchers | 8 | 1 (`toBeVisible`) |
| Unresolved annotations / stories | 8 / 7 | 2 / 2 |
| Stories whose effective a11y and globals are unresolved | 7 | 0 |

The proposal's 2026-10-28 source counts were 116 Lushly files with 614 plays, and 67 FAST-AF files with 143 plays. They are historical and MUST NOT be compared with the effective story counts above.

### Effective policies

- **Selection:** both `storybookTest()` calls set no `tags` option, so the defaults include `test` with no exclusions or skips. Every indexed story is tested. No story or meta uses a negated or skip tag.
- **Accessibility:** both previews set `parameters.a11y.test = 'error'`. Parameters and globals are key-merged project → meta → story, as Storybook merges them. No readable meta or story overrides the policy; Lushly's 7 unreadable stories could, and remain unresolved, so no per-story exceptions exist for FAST-AF's Fastbot exception check to document.
- **Context:** both previews apply a project decorator that reads `globals.theme`; preview `initialGlobals` are not modelled, so the counts are meta/story overrides only. Lushly also disables motion when `navigator.webdriver` is set. Two Lushly stories override globals: `lushly-settings-display-settings--time-of-day-without-place` sets `theme: 'dark'`, and `lushly-backstage-catalog-workbench-staff-attribution--phone` sets `viewport: { value: 'mobile1' }`. Lushly's preview defines only a `responsive` viewport option, so whether `mobile1` takes effect needs runtime confirmation in T03.
- **Workers:** Lushly's Storybook project caps Vitest at two workers. FAST-AF uses the Vitest default.

### Index tags are not a play inventory

`lushly-shell-app-header--small-phone` spreads `...Narrow` and therefore runs `Narrow`'s play at runtime. Storybook's static indexer does not follow spreads, so the story lacks the `play-fn` tag. The annotation pass resolves same-file constants, spreads and `Story.field` references, and counts it with a play. Play presence MUST come from annotations, not from index tags.

### Dynamic annotations kept explicit

The reading cannot resolve these. When a story is unreadable, or spreads something unreadable, meta values do not stand in for it. Any field the story does not set itself, including play, render, a11y and globals, is recorded as unresolved, never as inherited or smoke-only. Two of Lushly's seven stories (`SouthernMorningLight`, `HoverRim`) define their own play beside the opaque spread; the other five have unknown plays. FAST-AF's two Gantt stories have only unreadable `args` and no play.

| Consumer | File | Exports and reason |
| --- | --- | --- |
| Lushly | `lushly-site-surface.stories.ts` | `MorningLight`, `EveningLight`, `NightLight`, `Dusk`, `Moonset`: built by a local `lightStory(...)` factory. `SouthernMorningLight` spreads the factory's result and adds its own play |
| Lushly | `lushly-site-surface-hover.stories.ts` | Meta `render: base.render` and `HoverRim`'s `...LargeGarden`: imported annotations; `HoverRim` adds its own play |
| FAST-AF | `violet-gantt.stories.ts` | `ThousandRows`, `TenThousandRows`: generated `args`; play known absent |

T05 MUST either evaluate these through the compatibility adapter or fail validation for them; they MUST NOT disappear silently.

## Operational obligations

Each listed file is present and hashed in the manifest. These obligations MUST survive any replacement (T06–T08):

| Consumer | Obligation | Source |
| --- | --- | --- |
| Lushly | `check:storybook`: CEM check, story typecheck, Storybook Vitest run, static build and bundle budget | `package.json`, `scripts/check-storybook-bundle.mjs` |
| Lushly | Browser iteration with the two-worker cap and host evidence | `scripts/run-browser-iteration.mjs`, `scripts/storybook-browser-dependencies.mjs`, `scripts/storybook-selection-config.mjs`, `vitest.storybook.config.ts` |
| Lushly | Final validation: exclusive Storybook stage, once-only retry, flake identities `storybook:<file>::<titles>` and the worker-cap test | `scripts/final-validation-plan.mjs`, `scripts/run-final-storybook.mjs`, `scripts/final-validation-flakes.mjs`, `scripts/final-validation-workers.test.mjs` |
| Lushly | CI selection on `.storybook` paths; component scaffold emitting a story with a play assertion; generated CEM | `scripts/ci-selection.test.mjs`, `scripts/create-lushly-component.mjs`, `custom-elements-manifest.config.js`, `scripts/normalize-custom-elements.mjs` |
| FAST-AF | CI v3 Storybook scope: `test-storybook`, then `build-storybook`, in the Playwright 1.58.2 container | `.github/workflows/ci.yml`, `scripts/check-v3.mjs` |
| FAST-AF | Hooks: `fastbot:validate` on pre-commit; `fastbot:test` and `build-storybook` on pre-push | `lefthook.yml` |
| FAST-AF | Fastbot story contract, a11y policy/exception checks and story performance validation; recorded performance baselines; committed CEM | `plugins/fastbot-fast-af/src/fastbot_fast_af/{commands,plugin}.py`, `packages/violet-elements/story-performance-baselines.jsonc`, `packages/violet-elements/custom-elements.json` |

## Declared baseline policy

[`baseline-policy.json`](../../../../foundations/specimen/experiments/inputs/baseline-policy.json) (SHA-256 `30858de5…f592`) is recorded inside each manifest. It keeps the existing admission rules (one job, two reserved logical cores, 25% free memory), the 2-GiB family and 120-second job limits, and the 100 ms / 1 s / 500 ms sampling windows. It also states the cold/warm cache definitions for both runners, five cold and five warm samples, and the four build budgets. The new numeric tolerances it declares are:

- **Repeatability:** two repetitions of one cell within 10% CPU and 10% peak footprint, or the cell is held.
- **Noise floor:** a 5% median difference is reported as no measurable difference.
- **Acceptance:** candidate CPU per verified case and its active and post-close footprints at most the incumbent's. Cold startup and warm render latency at most 1.25× the incumbent's, as a guardrail.

T01 proposed these values and the owner confirmed them on 2026-10-31. Any revision MUST happen before T04 evaluates a candidate and MUST be recorded with its reason.

## Reproduce

```sh
# Snapshot outside every repository, then install and prepare with the consumer's own scripts.
git -C /path/to/lushly archive <revision> | tar -x -C /path/to/snapshot/lushly
(cd /path/to/snapshot/lushly && CI=1 corepack pnpm install --frozen-lockfile \
  && corepack pnpm cem:analyze && corepack pnpm --filter @lushly/web prebuild)
(cd /path/to/snapshot/lushly && node_modules/.bin/storybook index -c .storybook -o /path/to/evidence/lushly-index.json)

node foundations/specimen/experiments/inputs/inventory.mjs --consumer lushly \
  --root /path/to/snapshot/lushly --index /path/to/evidence/lushly-index.json \
  --project '{"a11y":{"test":"error"},"includeTags":["test"],"excludeTags":[],"skipTags":[]}' \
  --out /path/to/evidence/lushly-inventory.json
node foundations/specimen/experiments/inputs/freeze.mjs --consumer lushly \
  --snapshot /path/to/snapshot/lushly --repo /path/to/lushly --revision <revision> \
  --fetch-remote --out /path/to/evidence/lushly-inputs.json
```

FAST-AF uses `--consumer fast-af`, the upstream checkout and its four preparation scripts from [`consumers.json`](../../../../foundations/specimen/experiments/inputs/consumers.json).

## Evidence

Local evidence is in `test-results/specimens-inputs-20261031/` in the recording worktree, and the prepared snapshots are in `~/.cache/afd-specimens/t01-20261031/`. Both are ignored, local and not publication evidence.

| File | SHA-256 |
| --- | --- |
| `lushly-index.json` | `2d66faf5180652755600db38d5ee9712faef0ef7900ba9ceb4ed7833e2d849f2` |
| `lushly-inventory.json` | `3a81791b32b59f475400c7ad277e8d758ba236a207d31b31d5fe8fb65b7310fa` |
| `lushly-inputs.json` | `0293dab614bebf1b349c02d75a50c58e39a386d14ebe3310e3c134328aa8a5b7` |
| `fast-af-index.json` | `99308c4dab555b6bf2dd83ac8bf932fb32ede4c5fe709f0ce49df0d460adcf06` |
| `fast-af-inventory.json` | `c87eb99cef10a2cc97c477ab4bd4ac11ad4ca6b18755d6a56b96ac4f25325e89` |
| `fast-af-inputs.json` | `6cb79d82b0bbb0c1a04d2292ea8dfb1ce9cf122d239716878019764efb9b4bde` |

The install and preparation logs are retained beside them.

## Limits

- The inventory is static. It does not run plays, axe or renders, and it does not evaluate preview code. The project policy is passed in from the configurations read above. Runtime confirmation of effective context belongs to T03, and incumbent outcomes belong to T04/T05.
- The manifests bind the selected packages and the complete virtual-store entry list, not every transitive file's bytes. Lockfile-to-install agreement rests on pnpm's installed `lock.yaml`.
- Fonts and the per-runner browsers are recorded, not controlled. Browser presence is Playwright's installation marker, not a binary digest. Lockfile agreement compares pnpm's installed `lock.yaml`, not installed bytes. The host is shared and was not reserved, and no measurement ran in this task.
