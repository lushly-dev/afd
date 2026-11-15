# T04 optimization rounds

**Verdict, 2026-11-01:** with the native host, Specimen passes every T04 criterion for both consumers, in-process and isolated, in a paired session on `random` with every probe in band and no held cell ([below](#verdict-session)). Post-close footprint is parity within the policy's noise floor, not a reduction, except on Lushly's isolated path.

T04's first verdict session did not pass as declared: Specimen failed CPU per verified case for FAST-AF and post-close footprint for both consumers ([record](resource-budget-validation.md)). The owner chose the first [revision option](resource-budget-validation.md#decision-needed) on 2026-10-31: change the architecture, then remeasure under the unchanged criteria.

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

- **Bundling.** Rolldown 1.2.16 bundles the bench page and a lazy chunk per case. Vite's import forms are kept: `.css` imports inject a style element, `?inline` and `?raw` import strings, `?url` resolves to a served file, and a stylesheet's relative `@import`s and `url()`s resolve against it. So are Vite's development `define`s and the `development` resolve condition. A module that fails to bundle fails only its specimens, as under Vite's development server.
- **Serving.** Generations are held in memory and served on 127.0.0.1 under a per-render path. The host returns `file:digest` for each file a render loaded, for the source digest.
- **Chromium.** The host drives the headless shell over CDP through `--remote-debugging-pipe`, in its own process group. Pages get what Playwright 1.64 gives them:
  - its launch switches;
  - `Page.setFontFamilies` with its per-platform defaults;
  - device metrics, screen orientation, locale and `Accept-Language` without a user-agent override;
  - focus emulation, and media emulation with the same four features.
- **Input.** Actions use real input after Playwright's actionability checks, ported from its injected script: retargeting, visibility, native and ARIA disabled state, readonly state, one-frame stability and the hit-target check across shadow roots and slots. Roles come from Chromium's tree. Click points are clipped to the viewport, and Playwright's retry intervals apply. Fill checks visible, enabled and editable, then follows Playwright's fill. Selector targets are CSS matched across open shadow roots (`src/browser/locate.ts`, Playwright's CSS semantics, with `:scope` as the mount root); Playwright-only selector syntax is rejected. Role targets query Chromium's accessibility tree, with ARIA's `img` mapped to Chromium's `image` and names compared after Playwright's whitespace normalization.
- **Messages.** Console, log and page-error text follow Playwright's formatting.
- **Bounds.** Each render is bounded by its deadline from context creation to capture; disposal and closing the context are each bounded by at most a second more. Bundling and Chromium's startup (bounded at 10 seconds) come first, as the Playwright runtime's bundle step and launch did. Close waits for accepted renders and then stops the browser group, even one that never finished its handshake. End of input kills the group at once.
- **Ownership.** Chromium inherits only its CDP pipe, so a killed host's browser sees the pipe close and exits. The host kills the browser's group before reaping it, so the group id cannot have been reused. Node kills the group only after an unexpected host exit, and fails a request the host does not answer in time.

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
- **Top-level throws.** Oxc's dead-code pass, in Rolldown 1.2.16, removes a declaration that follows an unconditional top-level `throw` but keeps its export, so the module fails to link instead of throwing its own error. The host runs each such `throw` in a function called in its place, after a `;` so the call cannot join the previous line, and awaited when the `throw` awaits. A test fixture depends on this behavior.
- **Build and platform requirements.** Building the host needs Rust (rustup installs the pinned 1.98.0). The host supports macOS and Linux, not Windows. Prebuilt hosts are not packaged.

### Independent review

An independent review of `941a66c2` found defects that are fixed on the branch, each with a regression test where it can be exercised:

- **Ownership.** Chromium inherited every pipe descriptor, so it outlived a killed host. It also could be reaped before its group was killed, and Node killed the group even after a clean close.
- **Fidelity.** These differed from Playwright:
  - native disabled state for form-associated custom elements, and `aria-disabled` inheritance and roles;
  - viewport clipping of click points;
  - fill's states;
  - `img` role targets and name normalization;
  - console events arriving with the last reply;
  - number and error-name text;
  - YAML quoting of numeric-looking and C1-control text;
  - screenshot formats and directories.
- **Bundling.** `?raw` imports failed, and one broken module failed every specimen. The throw guard could join a previous line or break an `await`, and an edit made during a build went unnoticed.
- **Protocol.** A lone surrogate dropped a message, sends after the browser exited waited for their timeout, and message scanning was quadratic.

### Preview paired session

This session ran on `random` at `941a66c2`, before the review's fixes, so it is a preview and not the verdict. It took place on 2026-11-01: the quiet gate passed at 08:25 UTC, and 12 jobs (nested ABBA per consumer) finished by 08:36. Every probe was in band, between 0.410 and 0.421 s against a limit of 0.450 s. The host binary's digest is `d0d51d57…`. Ratios are candidate over incumbent, with the in-process and isolated paths given as ranges.

| Criterion | FAST-AF | Lushly (held) |
| --- | --- | --- |
| CPU per verified case (≤ 1) | 0.561–0.583, passes | 0.177–0.184 |
| Active peak footprint (≤ 1) | 0.079–0.088, passes | 0.066–0.073 |
| Post-close footprint (≤ 1) | 0.997–1.018, passes: no measurable difference | 0.920–0.933 |
| Cold startup latency (≤ 1.25) | 0.111–0.123, passes | 0.053–0.058 |
| Warm render latency (≤ 1.25) | 0.051, passes | 0.032 |

- **Lushly is held.** The incumbent's own two peaks differed by 13.26%, beyond the policy's 10% repeatability rule, so no Lushly ratio counts.
- **Post-close footprint.** Candidate jobs left 30.4–31.5 MiB after close; incumbent jobs left 30.7–33.4 MiB.
- **Build budgets.** These still pass after the runtime change. The shell is 25,958 and 26,159 bytes against 50,000, and the totals 1,065,598 and 1,184,220 against 1,300,000.

The verdict session runs on the fixed commit.

### Local diagnostic sessions

These are on the recording Mac, 2026-11-01, `run-t04-pairs.mjs --paths candidate,candidate-isolated --skip-quiet`. They are not a verdict: the quiet gate was skipped and nothing was paired with the incumbent. Footprints read about 8 MiB higher on this Mac than on `random`. In the T04 smoke session's incumbent jobs here, which were not valid comparisons themselves, FAST-AF's post-close footprint was 38.9–39.0 MiB, against 30–31 MiB on `random`.

| Consumer / path | CPU per case | Peak MiB | Post-close MiB | Cold ms | Warm ms |
| --- | --- | --- | --- | --- | --- |
| FAST-AF in-process | 0.187–0.191 | 134 | 31.5–31.7 | 283 | 133–134 |
| FAST-AF isolated | 0.195 | 149–151 | 30.8–31.1 | 301 | 133 |
| Lushly in-process | 0.196–0.199 | 132–133 | 30.9–31.0 | 275 | 158–159 |
| Lushly isolated | 0.204–0.207 | 150 | 30.4–30.8 | 301–302 | 142–158 |

Before the Node side was trimmed (host rendering, with Zod and parse5 still in the caller), post-close was 51–52 MiB on both paths. Peak was 157–194 MiB, and CPU per case was 0.183–0.207.

## Verdict session

This is the paired session under the unchanged policy, on `random` at `542d5e74`, the reviewed and fixed host. The tree was clean, and the host binary's digest is `9bd6e996…`. The session ran on 2026-11-01: the quiet gate passed at 09:24:57 UTC after its ten-minute window, and the 12 jobs (nested ABBA per consumer, five cold and five warm samples each) finished at 09:35:09. Every job passed, with every probe between 0.410 and 0.420 s against a limit of 0.451 s. No cell was held, so both sides met the 10% CPU and peak repeatability rules. Both sides ran the incumbent's headless Chromium with the recorded fonts, on Node 24.21.0.

Ratios are candidate over incumbent, with in-process and isolated given as a range:

| Criterion | Limit | FAST-AF | Lushly |
| --- | --- | --- | --- |
| CPU per verified case | ≤ 1 | 0.651–0.675, passes | 0.203–0.211, passes |
| Active peak footprint | ≤ 1 | 0.079–0.088, passes | 0.066–0.072, passes |
| Post-close footprint | ≤ 1 | 0.997–1.011, passes: no measurable difference | 0.867 isolated, passes; 0.957 in-process, passes: no measurable difference |
| Cold startup latency | ≤ 1.25 | 0.111–0.121, passes | 0.054–0.060, passes |
| Warm render latency | ≤ 1.25 | 0.058, passes | 0.036–0.038, passes |

The same ratios in absolute terms, as candidate against incumbent medians:

| Consumer | CPU per case | Peak | Post-close | Cold | Warm |
| --- | --- | --- | --- | --- | --- |
| FAST-AF | 0.212–0.220 / 0.326 core-s | 135–149 / 1,700 MiB | 30.9–31.3 / 31.0 MiB | 267–292 / 2,405 ms | 132–133 / 2,299 ms |
| Lushly | 0.224–0.232 / 1.099 core-s | 131–144 / 1,988 MiB | 28.0–30.9 / 32.3 MiB | 254–285 / 4,721 ms | 158–166 / 4,383 ms |

Build budgets pass:
- Shell: 26,505 and 26,706 bytes, against 50,000.
- Helper prototype: 486,032 and 585,145, against 600,000.
- Axe prototype: 553,608 and 572,916, against 650,000.
- Totals: 1,066,145 and 1,184,767, against 1,300,000.

Limits of this verdict:

- **Post-close is parity.** On three of the four paths it is within the 5% noise floor, which the policy reports as no measurable difference. Only Lushly's isolated path is measurably lower.
- **Cross-session CPU.** Candidate CPU per job was 13–16% higher than in the preview session an hour earlier: FAST-AF 4.24–4.42 against 3.66–3.81 core-seconds, and Lushly 4.00–4.17 against 3.49–3.64. The review's fixes add per-action checks, but most renders take no action, and the incumbent's CPU barely moved. The cause is not isolated. G02's rule that cross-session CPU ratios need a host-condition control applies, and this verdict compares within one session.
- **Merge commit.** The commit merged to main also carries main's unrelated changes (`cfd73572`). Specimen's resolved Playwright, Vite, parse5 and Zod versions and the host's locked crates are unchanged by them.
- **Measured scope.** The verdict covers T04's representative jobs on this host. The equivalence evidence G03 names (retained stories and full suites) remains T05–T08's.

## Evidence

Evidence is local and ignored, under `test-results/specimens-t04-optimize/` in the recording worktree:
- `r0-local` and `r1-local`: traces and profiles.
- `r1-random`: the round 1 session.
- `r2-local`: the round 2 local sessions, with `fast-af-before-lean` from before the Node side was trimmed.
- `r2-random-preview`: the preview session, with its budgets.
- `r2-random-verdict`: the verdict session, with its budgets.
