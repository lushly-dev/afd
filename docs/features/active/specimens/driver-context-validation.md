# Driver context and lifecycle validation (T03)

Status: recorded locally on 2026-10-31. Three drivers render the same probe through the same browser runtime: the bench (the CLI, API and AFD commands), the static index's iframe preview, and a reference driver in Vitest browser mode. They give a specimen the same viewport, `innerWidth`, width media queries, viewport and container units, container queries, theme and `lang` in every tested context. The static preview cannot emulate `prefers-color-scheme`, `prefers-reduced-motion` or `navigator.language`. It now labels each difference, as does every capture taken there. Genuine `TrustedHTML` is now readable, so every FAST-AF and Lushly pilot capture reports complete DOM. The owner chose the font and browser condition for comparison pairs, and T04 implements it. Clock and random-source control is not implemented.

## Drivers and probe

Every driver mounts through `window.__specimen` (`src/browser/index.ts`): it applies the context, mounts, waits for readiness and disposes. What differs is what each driver does around that runtime.

| Driver | Sizing | Media and locale | Document per case |
| --- | --- | --- | --- |
| Bench: `render`, the CLI and `specimen-render` | Playwright context viewport | Playwright context `colorScheme`, `reducedMotion` and `locale`; device scale factor 1 | A fresh browser context per render |
| Static index preview | An iframe sized to the viewport | None: an iframe cannot change them | A fresh document per navigation, with the origin's storage kept |
| Reference: the runtime in Vitest browser mode (`vitest.reference.config.ts`) | `page.viewport`, the call the Storybook Vitest addon makes | A driver command calls Playwright `page.emulateMedia`. Passing `null` turns emulation off rather than restoring the provider's options, so the driver restores them explicitly. Locale is a provider option, fixed for the run | One document for every case in a file |

All three ran Chromium 156.0.8078.4 from Playwright 1.64.0, with Vitest 4.1.12, on Node 24.21.0.

The `ContextProbe` fixture (`fixtures/context.stories.ts`) writes 16 values into `data-report` once mounted. They are `innerWidth`/`innerHeight`, `(max-width: 600px)`, `100vw`/`100vh` box sizes, `rem`, `100cqw` inside an inline-size container, a `@container (max-width: 400px)` query, computed `color-scheme`, the theme attribute, both media preferences, `lang`, `navigator.language`, the `Intl` default locale and `devicePixelRatio`. `fixtures/context-matrix.ts` defines three contexts and the report each one requires:

| Context | Viewport | Container | Theme | Locale | Reduced motion |
| --- | --- | --- | --- | --- | --- |
| phone | 375×667 | 320 | dark | fr-FR | reduce |
| desktop | 1280×720 | none | light | en-US | no-preference |
| incumbent | 1200×900, the Storybook addon's default | 480 | dark | en-US | no-preference |

Added 2026-11-01 for Loam's decision D53: a fourth context, `contrast` (1024×768, container 360×400, the `high-contrast` theme, en-US, reduce), and a 17th probe value, `(prefers-contrast: more)`. High contrast is the light color scheme with `prefers-contrast: more`; the bench and the reference driver emulate both, and the static preview labels `prefers-contrast` as it labels the other media. The results and test counts below are T03's.

## Results

The static preview ran in a browser set to light, no-preference and en-US, as a viewer's would be.

| Values | Bench | Static preview | Reference |
| --- | --- | --- | --- |
| Viewport, `innerWidth`, width query, `vw`/`vh`, `rem`, device pixel ratio | Agree in all three contexts | Agree | Agree |
| Container width, `cqw` and container query | Agree | Agree | Agree once the driver reproduces the bench page's 8px body margin (below) |
| Computed `color-scheme`, theme attribute, `lang` | Agree | Agree | Agree |
| `prefers-color-scheme`, `prefers-reduced-motion` | Agree | The viewer's values; labelled | Agree with the driver's media command. Without it they are the provider's values, as in the consumers' Storybook runs |
| `navigator.language`, `Intl` locale | Agree | The viewer's values; labelled | The run's provider locale; the fr-FR case is labelled |

`src/drivers.test.ts` (12 tests) runs the bench and static rows, and checks which mismatches the static preview reports, not only how many. `reference/drivers.test.ts` (11 tests) runs the reference row.

**Mismatch labels.** At capture, the runtime compares what the document observes with the requested context. Each difference becomes a `Context mismatch` limitation, which makes a bench capture's layout and styles partial. A comparison involving that capture therefore returns `insufficient-evidence` rather than crediting a context it did not have. The bench emulates every axis, so the `MisreportedLanguage` fixture triggers this path by overriding `navigator.language`, as a `navigator.webdriver`-style shortcut overrides a driver's context. The static index also shows a notice above the preview naming the values that follow the viewer's browser; it compares locales the same canonical way as the capture. Apart from that fixture, no bench capture produced a mismatch, in the tests or in either consumer pilot below.

**The page is part of the context.** Vitest's test document has no body margin; the bench page keeps the browser's 8px. Unconstrained layout is therefore 16px wider in Vitest unless the driver reproduces the bench page's baseline. The reference driver does so. Retained stories add another layer: both consumers declare Storybook's `layout: 'padded'`. Whether the addon applies that padding in Vitest mode has not been measured. T05 MUST measure the incumbent's actual page baseline before comparing unconstrained layout.

## Incumbent context, from the frozen snapshots

Both consumers' [frozen snapshots](frozen-inputs-inventory.md) use `@storybook/addon-vitest` 10.6.2 with Vitest's Playwright provider. Comparison pairs MUST match these conditions explicitly:

| Axis | Incumbent behaviour | Specimen default |
| --- | --- | --- |
| Viewport | The `responsive` viewport resolves to the addon's 1200×900 default in both consumers | 1280×720 |
| Theme | Decorators set `color-scheme` and attributes (Lushly `data-lushly-storybook-theme`, FAST-AF's Violet preset); media is not emulated | The theme attribute and `color-scheme`, plus emulated `prefers-color-scheme` |
| Motion | Lushly suppresses transitions and motion tokens whenever `navigator.webdriver` is set; FAST-AF does not | `natural`; `settled` must be requested |
| Locale and media preferences | The provider's defaults | en-US, no-preference |

Lushly's pairs therefore compare against `motion: 'settled'`, declared, rather than inheriting the `navigator.webdriver` shortcut the proposal forbids.

## Lifecycle, isolation and failure ownership

| Behaviour | Bench | Static preview | Reference |
| --- | --- | --- | --- |
| Storage, custom-element registry, globals, clock and random patches, portals left by the previous case | All absent | Only `localStorage` and `sessionStorage` persist | Only portals are removed. The registry, globals, patches and storage persist, as in any shared-document Vitest run |
| A case's own clock and random source (`FixedClock`) | Applied for that case; the next case is clean | Not tested | Restored by the case's disposer |
| Readiness never settles; disposer throws | The deadline expires, the disposer runs, and the error lists the render failure first and the disposal failure second; the bench stays usable | Not applicable | Not tested: the mount would never return |
| Readiness rejects, or disposal throws | Reported; the bench stays usable (existing `feasibility.test.ts` and `lifecycle.test.ts`) | Not applicable | Reported; the runtime stays usable |

The runtime resets document attributes, the mount root, nodes added to `head` and `body`, and motion mode. It deliberately keeps HTML-construction limitations for the document's lifetime, because a detached closed root parsed by one case could be adopted by a later one. In a shared document, one case that builds declarative shadow markup therefore makes every later capture's DOM partial; the reference suite shows this. Neither driver controls time or randomness. A case that needs a fixed clock owns that mock through its render and disposer. Only the bench's fresh context guarantees that nothing else carries over. A Vitest-based runner MUST therefore reset registrations, globals and storage itself or run one case per document.

## Evidence limits

| Case | Supported scope now | Retained limit and test |
| --- | --- | --- |
| `TrustedHTML` | Genuine `TrustedHTML` assigned to `innerHTML` or passed to `setHTMLUnsafe` (both tested) is read with the native stringifier; the other observed construction APIs, including `document.write`, use the same read untested. That stringifier is captured before specimen modules load and checks its receiver, so no user code runs | Markup that declares a shadow root stays partial. Any other object stays opaque, and its `toString` runs only once, during the browser's own conversion. `trusted-markup`, `trusted-declarative-closed` and `spoofed-markup` |
| Closed roots | None | Imperative and declarative closed roots make DOM partial (`closed`, `declarative-closed`) |
| Raster content | None | Canvas, image, video and iframe content is a limitation; `requireVisual` returns `insufficient-evidence` (`canvas`) |
| Animation | `motion: 'settled'` gives complete, repeatable layout and styles | Natural animation on the element or an ancestor is partial and compares as `insufficient-evidence` (`animated`, `body-animated`, `html-animated`) |
| Pseudo-elements | Computed styles | Geometry is a limitation |

**Consumer pilots.** `run-consumers.mjs` ran the authored native wrappers on two frozen snapshots, one sample each: upstream FAST-AF `e9abdf25` (T02's historical input) and Lushly `b8906b75` (T01's snapshot). FAST-AF's current T01 snapshot, `24e4eb86`, was not rerun. The before runs loaded the cached `cdfbbfb7` build through `SPECIMEN_BENCH_API`; its native source equals #525's. The after runs loaded this change's build. Each report's `apiPath` names the build it loaded. Its `afd.status` records this working tree for both runs, so it does not describe the before build.

| Consumer | Captures | DOM complete, before → after | Repeat comparison, before → after | Layout and styles |
| --- | --- | --- | --- | --- |
| FAST-AF | 9 | 0 → 9 | `insufficient-evidence` → `no-change-observed` | Unchanged: 7 complete, 2 partial |
| Lushly | 7 | 0 → 7 | `insufficient-evidence` → `no-change-observed` | Unchanged: 6 complete, 1 partial |

Before the change, every capture was partial for one reason: FAST's and Lit's `TrustedHTML` assignments could not be inspected. Reports are under `test-results/specimens-t03-20261031/`, which Git ignores.

## Provenance fields

Capture 0.1 records the source revision, dirty state and loaded-resource digest; the lockfile digest; the browser name and version; the requested context; and the checkpoint name. The proposal's remaining manifest fields are defined below. The capture schema is strict, so adding them is a capture-version change that every consumer of the schema sees.

| Field | Definition | Owner |
| --- | --- | --- |
| `manifest.capturedUtc` | ISO time at which the capture was read | Capture 0.2 |
| `manifest.bench` | Native package name and version, plus each plugin's name and version (none yet) | Capture 0.2 |
| `manifest.browser.platform` | OS and architecture, plus the executable path's digest when `executablePath` selects a non-bundled build | T04 pairs; capture 0.2 |
| `manifest.driver` | `bench`, `static` or `vitest`, plus the axes that driver emulates | Capture 0.2 |
| `manifest.context.observed` | The values the document observed (the runtime's `viewport` record: size, width query, both media preferences, language, pixel ratio) and any mismatch reasons | Computed now; exported in capture 0.2 |
| `manifest.context.pixelRatio` | Requested device pixel ratio; the bench fixes 1 | Capture 0.2 |
| `manifest.context.resources` | The font and remote-resource snapshot served (manifest digest), each loaded font's family, status and digest, and any request blocked | T04, with the font condition below |
| `manifest.checkpoint.actionMode` | `playwright` real input now; a Testing Library mode later | Capture 0.2 |
| `manifest.checkpoint.ready` | Readiness steps applied (upgrade, declared ready hook, fonts, next frame), deadline and outcome | Capture 0.2 |
| `manifest.checkpoint.baseline` | Clock (`real` or fixed instant), random source (`native` or seeded), initial storage and fixture digest | Requires clock and random control; T06 |
| Violet snapshot and name-map ids | As in the proposal | T09 |

## Comparison condition (G01, G12)

The owner chose the following on 2026-10-31:

- **Fonts.** Both runners receive the same recorded copies of the Google Fonts stylesheets and font files, served by request interception. The bench routes requests through Playwright; the incumbent's Vitest provider gets a setup command that routes its context. Any other remote request is blocked and recorded. T01 recorded the font files' digests but not their bytes, so T04 first stores the bytes, then serves them. A pair that loads live fonts is invalid.
- **Browser.** Each pair runs on the incumbent's Chromium build: 153 for Lushly (Playwright 1.63.0) and 145 for FAST-AF (1.58.2). The bench already accepts `executablePath`. Specimen's Playwright 1.64.0 may not fully support those older builds; T04 records any protocol limit it meets, and that limit qualifies the pair.
- **Context.** 1200×900, light, en-US, no-preference and device pixel ratio 1. Motion is `settled` for Lushly and `natural` for FAST-AF.

## Changes in this task

- `src/browser/capture.ts` and `src/browser/index.ts` record the observed media, language and pixel ratio and add `Context mismatch` limitations; `src/bench-runtime.ts` makes layout and styles partial for them.
- `src/browser/html-observation.ts` reads genuine `TrustedHTML`.
- `src/browser/page.ts` carries `container`, `locale`, `reducedMotion` and `motion` in the static index URL and shows the context notice. `src/schema.ts` rejects a requested locale that is not a BCP 47 tag, such as `en_US`, which Playwright used to accept and normalize. Saved captures keep their recorded locale and still parse.
- `endpoints/specimen-cli` adds `--locale`, `--reduced-motion` and `--motion` to `render`.
- New fixtures and suites: `fixtures/context.stories.ts`, `fixtures/context-matrix.ts`, `fixtures/serve-static.ts` (moved from the feasibility suite), `src/drivers.test.ts`, `reference/drivers.test.ts`, `reference/provider.ts` and `vitest.reference.config.ts`. `test:browser` runs the reference suite after the native suite. `@vitest/browser-playwright` 4.1.12 is a new development dependency. Vitest and its coverage provider move from 4.1.11 to 4.1.12, versions the lockfile already held for FAST-AF.

## Not established

- Retained stories through the incumbent runner. The reference driver runs Specimen's runtime in the incumbent's harness. It is not the Storybook addon, its decorators or its play execution, and not the T05 compatibility adapter.
- The incumbent browser builds and recorded fonts. All three drivers here used Chromium 156 with no remote fonts.
- Clock and random-source control, and the capture 0.2 fields above.
- Media emulation in the static index. It is labelled, not solved.
