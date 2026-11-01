# T04 optimization rounds

T04's verdict session did not pass as declared: Specimen failed CPU per verified case for FAST-AF and post-close footprint for both consumers ([record](resource-budget-validation.md)). The owner chose the first [revision option](resource-budget-validation.md#decision-needed) on 2026-10-31: change the architecture, then remeasure under the unchanged criteria.

> I think we should do rounds of optimization. First, make sure you have the necessary instrumentation, then keep refining until we match or improve.

> I am not concerned about cost of re-write at all, only the best outcome. So, we don't have to do it first, but don't hesitate to use Rust (or other methods) if the outcome will be better.

The policy, tolerances, probe gate, font and browser condition and the declared workload are unchanged, including the candidate's repeat and 100 comparisons. Candidate-only sessions on `random` are progress evidence, not verdicts. Only a full paired session with the incumbent, gated and in band, can pass the workstream 0 exit. T02 requires a language rewrite to have its own measured case, and this record is that case for the native host.

## Round 0: instrumentation

Committed as `c3a5d838`. The bench writes an opt-in span trace (`SPECIMEN_BENCH_TRACE`, `src/trace.ts`) with wall and CPU time per render step and Chromium's own task, script, layout and style totals. Cold samples record their stages. Each pair job attributes sampled CPU to process roles and phases (`resources/attribution.mjs`), and Node CPU profiles summarize by package (`resources/profile-summary.mjs`).

What it showed, locally on FAST-AF:

- Each render loaded 81 resources (2.27 MB) from Vite's development module graph, and Specimen read every body back over CDP to digest it.
- A cold sample's Node process used about 720 ms of CPU: 19% module loading, 18.5% Playwright, 11.8% Vite and 9% `node:path`.
- Building the whole bench bundle once, when warm, cost about 54 ms of CPU.
- A fresh browser context per render costs only about 21 ms of Chromium CPU, so per-render isolation stays.

## Round 1: prebuilt bundles

Committed as `de210501`. Automation renders load one in-memory Vite build of the bench, served from 127.0.0.1 under a per-render path, so the server records exactly which files a render loaded. A changed source file rebuilds the bundle before the next render. Each render loaded 3 resources, and warm Node CPU fell to 13–27 ms per render.

Candidate-only session on `random` at `de210501`, 2026-11-01 04:29–05:22 UTC: the quiet gate passed after its ten-minute window and every probe was in band (0.408–0.429 s).

| Consumer / path | CPU per case | Peak MiB | Post-close MiB | Cold ms | Warm ms |
| --- | --- | --- | --- | --- | --- |
| FAST-AF in-process | 0.287–0.292 | 442–460 | 212–219 | 442 | 111–112 |
| FAST-AF isolated | 0.313–0.314 | 327–333 | 52 | 519–534 | 132–134 |
| Lushly in-process | 0.310–0.311 | 450–456 | 215–221 | 447–451 | 158–159 |
| Lushly isolated | 0.334–0.335 | 319–320 | 50 | 508–509 | 159 |

Against session 6's incumbent (FAST-AF 0.323 and Lushly 1.094 core-seconds per case, post-close 30–33 MiB), CPU per case would now pass for both consumers, and post-close footprint still fails.

## Round 2: the native host

Rendering moved into `specimen-host`, a Rust binary (`foundations/specimen/host`):

- **Bundling.** Rolldown 1.2.16 bundles the bench page and a lazy chunk per case. `.css` imports inject a style element, as Vite's development server does. Vite's development `define`s and the `development` resolve condition are kept.
- **Serving.** Generations are held in memory and served on 127.0.0.1 under a per-render path. The host returns `file:digest` for each file a render loaded, for the source digest.
- **Chromium.** The host drives the headless shell over CDP through `--remote-debugging-pipe`, in its own process group. Pages get what Playwright 1.64 gives them:
  - its launch switches;
  - `Page.setFontFamilies` with its per-platform defaults;
  - device metrics, screen orientation, locale and `Accept-Language` without a user-agent override;
  - focus emulation, and media emulation with the same four features.
- **Input.** Actions use real input after Playwright's actionability checks. Click and hover wait until the target is visible, enabled, stable for one frame and the element receiving the pointer, with Playwright's retry intervals. Fill follows Playwright's fill. Selector targets match across open shadow roots (`src/browser/locate.ts`, Playwright's CSS semantics). Role targets query Chromium's accessibility tree.
- **Messages.** Console, log and page-error text follow Playwright's formatting.
- **Bounds.** Each render is bounded by its deadline from context creation to capture, and disposal by at most a second more. Close waits for accepted renders and then stops the browser group, even one that never finished its handshake. End of input kills the group at once. Node keeps the group id as a last-resort cleanup handle.

The Node API keeps its contract and becomes a thin client (`src/host.ts`, `src/bench-runtime.ts`):

- **Normalization in the page.** `normalizeDom` runs in the page, loaded lazily (`window.__specimen.normalize`), so the caller's process does not run parse5 for observations. Attribute names now sort in a fixed `en-US` collation instead of the process's or page's default locale. For an `en-US` process, the output is unchanged.
- **No Zod on the bench path.** Creating a bench and rendering validate with `src/validate.ts`, whose verdicts a differential test holds to the `./schema` Zod schemas. `./schema` still exports those schemas, and importing Zod costs about 9 MB resident.
- **Memoized comparison.** `diffObservations` still derives normalized DOM from raw DOM every time and never trusts a stored value. It keeps the 32 most recent results of that pure function, so comparing one baseline against many captures parses it once. Without this, the declared 100 comparisons drive parse5 into V8's optimizing compilers, which kept about 8 MB more resident in a local measurement. The comparison timings reported by `run-consumers.mjs` are therefore mostly cache hits from the second comparison on.
- **Vite only for builds.** `build()` and the interactive bench still use Vite.

### Fidelity

Every FAST-AF and Lushly wrapper capture, at `mount` and `after-run`, was rendered through both the round 1 runtime and the host on 2026-11-01:

- Raw DOM (and so normalized DOM), element observations and console channels were identical.
- The exceptions are FAST's random template-marker ids, which differ on every render, and samples the capture itself marks time-dependent because an animation was running.
- The page-side normalized DOM equals Node's `normalizeDom` for all 16 captures.

The full native suite, the reference driver, the integration and CLI suites and the 12 packed-artifact consumer checks pass.

Changes callers can see:

- **Capture version 0.2.** ARIA snapshots now come from Chromium's accessibility tree, in the indented YAML form of Playwright's snapshots. Chromium's own roles and names show through: an unnamed `<form>` is `form`, `img` is `image`, and text-field values follow the name. Version 0.1 captures are rejected by comparison, as any version change is.
- **Top-level throws.** Oxc's dead-code pass, in Rolldown 1.2.16, removes a declaration that follows an unconditional top-level `throw` but keeps its export, so the module fails to link instead of throwing its own error. The host runs each such `throw` in an arrow function called in its place. A test fixture depends on this behavior.
- **Build and platform requirements.** Building the host needs Rust (rustup installs the pinned 1.98.0). The host supports macOS and Linux, not Windows. Prebuilt hosts are not packaged.

### Local diagnostic sessions

These are on the recording Mac, 2026-11-01, `run-t04-pairs.mjs --paths candidate,candidate-isolated --skip-quiet`. They are not a verdict: the quiet gate was skipped and nothing was paired with the incumbent. Footprints read about 8 MiB higher on this Mac than on `random`. In the T04 smoke session's incumbent jobs here, which were not valid comparisons themselves, FAST-AF's post-close footprint was 38.9–39.0 MiB, against 30–31 MiB on `random`.

| Consumer / path | CPU per case | Peak MiB | Post-close MiB | Cold ms | Warm ms |
| --- | --- | --- | --- | --- | --- |
| FAST-AF in-process | 0.187–0.191 | 134 | 31.5–31.7 | 283 | 133–134 |
| FAST-AF isolated | 0.195 | 149–151 | 30.8–31.1 | 301 | 133 |
| Lushly in-process | 0.196–0.199 | 132–133 | 30.9–31.0 | 275 | 158–159 |
| Lushly isolated | 0.204–0.207 | 150 | 30.4–30.8 | 301–302 | 142–158 |

Before the Node side was trimmed (host rendering, with Zod and parse5 still in the caller), post-close was 51–52 MiB on both paths. Peak was 157–194 MiB, and CPU per case was 0.183–0.207.

## Next

A full paired session on `random`, with the incumbent, the quiet gate and the probe band, decides whether the workstream 0 exit now passes. Until then, the T04 verdict remains the one in the [resource and budget record](resource-budget-validation.md).

Evidence is local and ignored, under `test-results/specimens-t04-optimize/` in the recording worktree: `r0-local` and `r1-local` (traces and profiles), `r1-random` (the round 1 session) and `r2-local` (the round 2 sessions, with `fast-af-before-lean` before the Node side was trimmed).
