# Native consumer validation

Status: exploratory native consumer pilot passed locally on 2026-10-28. Complete workstream 0 and retained-CSF parity remain open. Native milestone checkpoint: `f1bc4488f3b83d74aedc5099a12188a46cb9ba15`.

## Exercised source

| Consumer | Clean source revision | Actual component cases |
| --- | --- | --- |
| FAST-AF | `e9abdf25516401221183821e81b0e02cd7e1c498` | Slotted Violet button, required form-associated text field, scoped theme, responsive dismissible alert |
| Lushly | `70d482217259e53c865d05518980c22bfcd876f5` | Garden tier badge with nested Violet badge, controlled view tabs, themed empty state, responsive section frame |

The [opt-in driver](../../../../packages/specimen/experiments/README.md) copied selected source paths into neutral temporary projects and linked the consumers' existing installed dependencies. Both original checkouts had identical clean revision/status readbacks before and after execution. The probes used local component fixtures and made no consumer installations or source/config changes.

Sixteen requested behavior captures passed assertions with zero browser console errors. FAST-AF proved real open shadow content, a slotted label, native required validity, FAST host value, ElementInternals form association and actual FormData before/after filling; scoped panel/button colors; a three-to-two-column alert media query at a real mobile viewport; and a dismiss event. Lushly proved nested badge shadow content, Weather-to-Zone controlled selection and panel visibility after a real click, different computed light/dark colors, and real narrow/wide geometry with container-based padding.

These are explicitly authored native wrappers around real source, rather than imports of retained CSF definitions. They do not establish decorator/args/global/loader/play policy preservation, axe execution, event history, token provenance, screenshot parity or suite equivalence. Repeat captures had zero observed structured differences, but both comparisons correctly returned `insufficient-evidence`: FAST passes non-string HTML through `innerHTML`, which current instrumentation conservatively marks as potentially opaque declarative shadow content. Supporting branded TrustedHTML without changing native coercion semantics remains a follow-up. The pilot must not be reported as complete DOM or visual equality.

Lushly's installed graph differs from current manifests: examples include Storybook 10.5.10 versus 10.6.0, Vite 8.2.1 versus the declared newer range, and an older repaired Violet tarball. Its external Storybook fonts were omitted, using fallbacks. Runtime tooling was AFD's Node 24.21.0 / Vite 8.3.0 / Playwright 1.64.0 and Chromium 156.0.8078.4, rather than the incumbent consumer test runner. A current frozen consumer installation and typography policy are required before acceptance or an incumbent performance comparison.

## Corrections discovered by consumers

The first pilot captured a native input value before FAST's queued update had propagated to form data, and captured Lushly tab markup before its selected state rendered. Supported actions now await one animation-frame boundary before the next action/checkpoint. A regression failed under the old behavior and passes after the correction, checking click, fill, named checkpoints and `after-run`. This includes callbacks already queued for the next frame and their microtasks; it does not settle later frames, network work or animations.

Cold Lushly runs then revealed Vite dependency discovery sending a full page reload into an active capture. Instrumented reproduction failed in four of ten cold runs; explicit optimizer roots alone still allowed a reload. Programmatic benches now disable HMR and scan the actual runtime/specimen roots; the default interactive server retains HMR. A forced-reload regression fails under the prior behavior and passes with the correction. Ten subsequent cold Lushly captures passed. Render failures and disposal failures are also retained together, rather than cleanup replacing the original error.

The final package suite contains 71 passing tests, including these browser regressions. Independent source review found and closed two experiment-driver issues: failed checkout readback could abort receipt generation, and in-repository copied projects inherited unrelated AFD Git/lock identities. A missing-root negative probe now saves failure receipts and an aggregate report. Final source review found no additional actionable issues in the bounded lifecycle changes.

## Pilot timing and Rust decision

Five cold and five warm renders per consumer sampled the small button/badge case, with one worker on a shared Apple M5 host. Cold totals include new Vite bench/cache and Chromium startup; warm samples retain the primed bench/browser but use fresh contexts. OS/package caches remain warm. These are descriptive pilot observations without a recorded incumbent baseline or fixed acceptance tolerances.

| Representative case | Warm render median (range), ms | Cold startup + render median (range), ms | Offline structured diff median, ms |
| --- | --- | --- | --- |
| FAST-AF button, 12 observed elements | 231.41 (230.24–269.73) | 388.77 (377.88–399.95) | 0.387 |
| Lushly tier badge, 10 observed elements | 267.40 (249.13–296.54) | 428.07 (418.94–531.50) | 0.286 |

Offline diff medians use 100 repeated comparisons. Rendering and offline comparison are different operations, so these figures are not a CPU breakdown or an Amdahl speedup estimate. Shared host workloads were present; Node RSS excludes Chromium. Loaded JavaScript bytes, total browser memory and matched incumbent suite timings remain unmeasured.

Keep the browser lifecycle and test orchestration in TypeScript for now. The observed small offline diffs do not justify a native rewrite; the correctness problems were frame scheduling and dependency discovery. Rust is a candidate for future CPU-heavy pixel comparison, large-capture normalization or report aggregation if profiles show material end-to-end savings. Preserve a narrow data contract and account for native/WASM packaging and boundary overhead before adopting it. Specimens already obtains native tooling through [Vite 8's Rust-based Rolldown bundler](https://vite.dev/blog/announcing-vite8). Its retained-browser/fresh-context model follows [Playwright's isolation design](https://playwright.dev/docs/browser-contexts).

## Evidence and next acceptance work

Local ignored evidence is under `test-results/specimens-consumers-final/`: `report.json`, per-consumer receipts/provenance, raw captures, repeat comparisons and retained source snapshots. Captures execute outside ancestor Git/lockfile discovery; their raw source revision and dependency identity are unavailable, with original consumer identities recorded separately. Declared lock hashes and installed versions are separate evidence, rather than a claim that installed dependencies match their locks. Initial failed pilots remain under `specimens-consumers-pilot-1/` and `specimens-consumers-pilot-2/`; the missing-root check is under `specimens-consumers-missing-root/`.

Next: establish frozen consumer dependency/asset conditions and incumbent baselines/tolerances, exercise retained CSF semantics through the compatibility adapter, add deliberate failure/detection pairs, and measure loaded bytes/browser memory plus matched full-suite costs. Cross-driver viewport/context parity and the proposal's full coverage/replacement gates remain required before Storybook retirement.
