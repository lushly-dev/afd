# Workstream 0 resource and budget gate (T04)

Status: recorded on 2026-11-01 from one verdict session, session 6. The incumbent and the candidate ran on one quiet host and one frozen snapshot per consumer, both on the incumbent's own headless Chromium, with the same recorded fonts. Every build and load budget passes.

Against the [baseline policy](../../../../foundations/specimen/experiments/inputs/baseline-policy.json), Specimen passes active peak memory and both latency guardrails, as the policy defines them. It also passes CPU per verified case for Lushly, when every successful render counts as a case. It **fails CPU per verified case for FAST-AF and post-close footprint for both consumers**, in its in-process default and in its isolated worker. Workstream 0's exit therefore does not pass as declared. The proposal's response is either to revise the architecture or limits, or to keep the existing harness. That needs the owner's [decision](#decision-needed).

## Conditions

| Item | Value |
| --- | --- |
| Host | `random`: Mac16,10, Apple M4 (4 performance and 6 efficiency cores), 24 GiB, macOS 27.0.1 (26A434), Node 24.21.0. The host is shared with other agent sessions over Tailscale |
| Code | AFD `94756d59`, clean; the compiled `dist` digest covers all 72 files (`ec509da0…db4a`) |
| Inputs | Lushly `b8906b75` and FAST-AF `24e4eb86`, each its T01 snapshot. The freeze manifests were recorded on `random`: 0 tracked files missing or modified, and every install matches its lockfile. Snapshot digests are `d64b97fc…` and `3510653f…`, byte-identical to the recording Mac's copies. Lushly's snapshot also contains `@lushly/core`, `@lushly/site-renderer` and `@lushly/weather` builds, which its own `type-check:storybook` builds first; without them its Vite dependency scan fails and skips pre-bundling. The driver read every snapshot back unchanged before the session and after each job, outside the measured jobs |
| Browser | Each pair used the incumbent's own build: Chromium 153.0.8010.12 for Lushly and 145.0.7632.6 for FAST-AF. The incumbent ran with `--browser.headless --browser.ui=false`; the candidate's build came from `executablePath`. The recorder saw `chrome-headless-shell` as the only browser in every job on both sides, and every candidate capture recorded the expected version |
| Fonts | The preview-head Google Fonts were recorded on 2026-10-31 and matched T01's digests: Lushly 7/7 files, FAST-AF 143/143, and both stylesheets. The incumbent's test page links and the candidate's wrapper linked the same copies, served from 127.0.0.1 by the driver, outside both measured families. Every font request a runner made was for a recorded copy. Other network traffic was neither blocked nor recorded |
| Host condition | `quiet.mjs` passed at 03:01:38 UTC after a ten-minute window. Each job then waited for a 20-second settle, and all 12 were quiet. Each job's single-run probes fell between 0.409 and 0.421 s, against a limit of 0.450 s |
| Limits | One job at a time, with two cores and 25% memory reserved by admission and a 120-second workload limit. Family memory limits are 2 GiB for the candidate and 4 GiB for the incumbent ([revisions](#policy-revisions)) |

## What each side ran

Per consumer, the pair driver `run-t04-pairs.mjs` ran a nested ABBA of six jobs, each under `run-resources.mjs`: incumbent, in-process candidate, isolated candidate, isolated candidate, in-process candidate, incumbent. Each job took the policy's five cold and five warm samples.

| | Incumbent | Candidate |
| --- | --- | --- |
| Work | `vitest run` with the consumer's own Storybook config, over the story files for the wrapper components. FAST-AF: button, text field, alert and theme, 19 stories (7 with plays). Lushly: empty state, tier badge, view tabs and section frame, 8 stories (5 with plays) | The [native wrappers](consumer-validation.md) for the same components: FAST-AF 9 and Lushly 7 asserted captures, plus a repeat and 100 comparisons |
| Cold sample | A new Vitest process, after removing the snapshot's Storybook and Vite caches | A new Node process that creates a bench, renders the first case and closes (`cold-sample.mjs`) |
| Warm sample | An immediate rerun of the selection | A render in the bench primed by the asserted captures |
| Verified cases per job | Every passing story test: 190 for FAST-AF, 80 for Lushly | Every successful render: 20 and 18. Only 9 and 7 of these are asserted captures; the rest check for console errors |
| Checks that add work | Storybook rendering, plays with Testing Library input, axe on every story (`a11y.test: 'error'`), Vitest's reporter | Structured DOM, ARIA, layout, style and live-state capture, with Playwright input; no plays, no axe |
| Outside the job | The snapshot readback (done by the driver) | Copying the wrapper project and the snapshot readback (done by the driver) |

The two sides do different checks. The incumbent spreads each process start across its whole selection, while each candidate cold sample is a process start for one case. Every story and every case passed in every sample.

## Results

| Criterion (candidate ÷ incumbent median) | Limit | Lushly in-process | Lushly isolated | FAST-AF in-process | FAST-AF isolated |
| --- | --- | --- | --- | --- | --- |
| CPU per verified case | ≤ 1 | 0.501, passes | 0.593, passes | **1.405, fails** | **1.663, fails** |
| Active peak footprint | ≤ 1 | 0.326, passes | 0.261, passes | 0.370, passes | 0.283, passes |
| Post-close footprint | ≤ 1 | **10.593, fails** | **1.579, fails** | **11.225, fails** | **1.690, fails** |
| Cold startup latency | ≤ 1.25 | 0.123, passes | 0.140, passes | 0.241, passes | 0.272, passes |
| Warm render latency | ≤ 1.25 | 0.048, passes | 0.044, passes | 0.074, passes | 0.074, passes |

| Consumer / path | CPU core-seconds | Cases | CPU per case | Peak MiB | Post-close MiB | Cold ms | Warm ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lushly incumbent | 87.30, 87.74 | 80 | 1.094 | 1,994, 1,953 | 32, 32 | 4,724 | 4,386 |
| Lushly candidate | 9.84, 9.91 | 18 | 0.549 | 641, 647 | 331, 344 | 580 | 210 |
| Lushly candidate, isolated | 11.63, 11.72 | 18 | 0.649 | 520, 510 | 50, 50 | 660 | 191 |
| FAST-AF incumbent | 61.42, 61.18 | 190 | 0.323 | 1,689, 1,686 | 30, 31 | 2,342 | 2,242 |
| FAST-AF candidate | 9.11, 9.02 | 20 | 0.453 | 645, 606 | 364, 321 | 565 | 166 |
| FAST-AF candidate, isolated | 10.75, 10.71 | 20 | 0.537 | 482, 472 | 52, 51 | 638 | 166 |

Repetitions agree within 1% on CPU and 7% on peak footprint, inside the policy's 10% rules.

**What the verdicts depend on.** Two definitions decide the pass/fail picture:

- **Latency is per sample, as the policy defines it.** An incumbent sample is a run of 8 or 19 stories, and a candidate sample is one render. Per story, the incumbent's cold run takes 590 ms (Lushly) and 123 ms (FAST-AF), against the candidate's 580 ms in-process and 660 ms isolated (Lushly), and 565 ms and 638 ms (FAST-AF). Its warm run takes 548 and 118 ms, against 210/191 ms and 166/166 ms. Per case, FAST-AF would fail the 1.25 guardrail: cold at 4.6× in-process and 5.2× isolated, and warm at 1.41× in both modes. Lushly stays within it.
- **Every successful render counts as a verified case.** Counting only the candidate's asserted captures (9 and 7 per job) gives these core-seconds per case:
  - FAST-AF: 1.01 in-process and 1.19 isolated, or 3.1× and 3.7× the incumbent.
  - Lushly: 1.41 and 1.67, or 1.29× and 1.52× the incumbent.

  On that definition, Lushly's CPU result fails as well as FAST-AF's.

## Where the cost goes

Per-process attribution assigns each process's CPU to the phase in which the process was first seen. It is sampled every 100 ms, so it is a lower bound (84.6 of 87.3 core-seconds for Lushly's incumbent, 8.2 of 9.1 for FAST-AF's candidate):

| Session 6, per process | FAST-AF | Lushly |
| --- | --- | --- |
| Incumbent warm run, per story | 0.28 s | 0.91 s |
| Incumbent cold run, per story | 0.33–0.34 s (6.3–6.5 s per run) | 1.20 s (9.6 s per run) |
| In-process candidate outside cold samples, per render (job process plus renders; upper value includes the unattributed CPU) | 0.26–0.33 s | 0.34–0.40 s |
| Candidate cold sample: a fresh process for one case (in-process / isolated) | 0.84 / 0.96–0.97 s | 0.95 / 1.06–1.07 s |

- **Lushly:** the candidate costs less, cold or warm, per render.
- **FAST-AF:** outside the cold samples, the candidate's per-render cost is not clearly different from the incumbent's warm per-story cost. Its failure comes from the five cold samples. Each pays for a Node process, a Vite server and a browser to render one case, while an incumbent cold run spreads that start over 19 stories. FAST-AF's stories are also cheap, about a third of Lushly's per story.
- **Post-close memory is a real difference.** Each harness starts at its own baseline: 23 MiB for the incumbent's, and 34 MiB for the candidate's, which imports the Specimen API and fixtures. After every bench or Vitest process has closed, the incumbent's has grown by 7–9 MiB. The isolated candidate's coordinator has grown by 16–18 MiB. The in-process candidate keeps 287–330 MiB more, because a closed in-process bench does not unload Vite, Playwright or the runtime, which is a documented limit. The candidate fails both on the policy's absolute footprint and on growth from baseline.
- **Peak memory strongly favours the candidate.** The incumbent's Storybook and Vitest path peaked at 1,686–1,994 MiB. In a headed smoke run it exceeded the original 2 GiB limit, so incumbent jobs ran under a 4 GiB limit.

## Build and load budgets

`run-budgets.mjs` ran on `random` at `94756d59`. It built each wrapper project with Specimen's static build and loaded every case in Chromium. It also sized two prototypes from the consumer's own installs:

- **Helpers:** the five functions retained plays import from `storybook/test`: `expect`, `waitFor`, `userEvent`, `fn` and `within`.
- **Axe:** axe-core's own minified build with a minimal runner.

Both prototypes are fully minified, as the shell is.

| Minified JS bytes | FAST-AF | Lushly | Budget | Result |
| --- | --- | --- | --- | --- |
| Shell (delivered) | 24,320 (8,473 gzip) | 24,521 (8,548 gzip) | 50,000 | passes |
| Helpers (prototype, `storybook/test` 10.3.1 / 10.6.2) | 486,032 (119,461 gzip) | 585,145 (130,197 gzip) | 600,000 | passes; Lushly within 2.5% |
| Axe (prototype, axe-core 4.11.1 / 4.13.0) | 553,608 (149,220 gzip) | 572,916 (154,787 gzip) | 650,000 | passes |
| Total | 1,063,960 | 1,182,582 | 1,300,000 | passes |

Each case actually loaded 141,130 (FAST-AF) and 138,490 (Lushly) bytes of JavaScript. That is 33,986 and 36,655 bytes gzip, or 29,661 and 32,517 brotli: the 24 KB shell plus the wrapper's component code, which every case in a consumer shares. The prototypes size categories Specimen does not ship yet, so they show only that the retained helper and axe code fits. They are not the T05/T06 integrations, which must be measured again.

## Sessions and measurement findings

| Session | Commit | Incumbent | Outcome |
| --- | --- | --- | --- |
| 1, 2 | `ccf5cb8e` | Headed | Detached; probes in every incumbent job read about 0.67 s, so every comparison was held |
| 3 | `ccf5cb8e` | Headed | Attached; Lushly in band, FAST-AF held by two probes |
| 4 | `eb68380e` | Headed | Attached with settle; each consumer held by one probe |
| 5 | `f71d22d8` | Headed | Fastest-of-three probe; in band, but invalid as a verdict (below) |
| 6 | `94756d59` | Headless | Attached, single-run probes, every probe in band; the verdict session |

Sessions 1–5 are kept as evidence but superseded, for two reasons. First, Vitest is headless only under CI, so they ran the incumbent in headed Chrome for Testing. That serialized test files (ignoring Lushly's `maxWorkers: 2`), opened the UI, and added a GPU process to Lushly's runs. Second, the candidate's harness copied the wrapper project inside the measured job, which raised its post-close footprint by up to about 90 MiB. That copy and the snapshot readbacks inside the jobs also added 6–14% to the candidate's CPU. Session 6 fixes both and moves both sides' readbacks outside the jobs. As a result its candidate figures are lower than sessions 1–5's: CPU by 6–14%, and isolated post-close from 135–140 to 50–52 MiB. The verdict pattern is unchanged. Sessions 1–5 ran from `lush/specimens-t04-pairs-sessions-1-5`.

- **Slow probes came with the headed incumbent.** In sessions 3–5, 10 of 40 probe readings in incumbent jobs were 0.655–0.674 s, against none of 80 in candidate jobs. In the detached sessions all 16 incumbent-job probes were slow and all 32 candidate-job probes were normal. With the incumbent headless, session 6 had none. The headed browser's processes are the likely cause, but this was not isolated, and the detached effect was not retested headless. Incumbent job CPU differed by only about 1.5% between slow-probe and normal-probe sessions.
- **The probe revision was withdrawn.** A fastest-of-three probe was briefly adopted, on the theory of random efficiency-core placement. The incumbent-only pattern contradicts that theory, so session 6 used the policy's single-run probe.
- **Another session's work held the gate.** Agents on `random` ran Lushly browser tests and then a worktree cleanup. Sessions 1 and 2 waited 45 and 69 minutes for a quiet window, sessions 3–5 about 10, and session 6 24. Session 6's kept gate samples show no other session's processes, so they do not confirm what kept it busy.

## Policy revisions

The policy allows revisions before the T04 comparison runs, with the reason recorded:

| Revision | When | Reason |
| --- | --- | --- |
| `hostCondition`, owner-confirmed: a pair counts only when every probe is ≤ 1.10× the session's quietest | Round 1, #558 | T02's cross-session evidence ([record](cpu-attribution-validation.md)) |
| `limits.incumbentFamilyFootprintBytes`: 4 GiB for incumbent representative jobs | Before session 1 | A headed smoke run of the incumbent's own path reached 2.0 GB (FAST-AF) and exceeded 2 GiB (Lushly). At 2 GiB the limit would have stopped the baseline itself. The peak remains an outcome |

The fastest-of-three probe was a third revision. It came after session 3 had produced valid Lushly verdicts (CPU per case passing, post-close failing), after sessions 1–4 had computed held ratios, and after a one-sample diagnostic run had computed verdicts. It has been withdrawn. The policy's probe text now says "one run before and one after every job", which clarifies the original rule without changing it.

## Workstream 0 exit

| Exit criterion | State |
| --- | --- |
| Honesty-check cases | Covered by the executable native fixtures (`feasibility.test.ts`, `drivers.test.ts`), where unsupported evidence returns `insufficient-evidence`, and by the original milestone's five-case capture-only agent interpretation. There is no separate versioned baseline/faulty/corrected fixture manifest, and T04 did not repeat the agent interpretation |
| Known unavailable evidence labelled | Yes (G05; T03) |
| Cross-driver viewport probe | Passes ([T03](driver-context-validation.md)) |
| Build budgets | Pass, with prototypes for the helper and axe categories |
| Whole-process CPU and memory baseline and host headroom | Recorded (above; admission, gate and settle receipts are in each job) |
| Predeclared tolerances | **Do not pass**: CPU per verified case (FAST-AF) and post-close footprint (both consumers, both modes). Lushly's CPU pass depends on counting every render as a case, and the latency passes depend on the per-sample definition |

## Decision needed

The proposal's [risk table](../../proposed/specimens/specimens.proposal.md#remaining-risks-and-decisions) covers measured costs that do not justify replacement: stop at workstream 0, then either revise the architecture or limits, or keep the existing harness with the observation tooling. The options:

1. **Change the architecture for retained memory, then remeasure under the unchanged criteria.** The isolated worker already brings post-close growth to 16–18 MiB, against the incumbent's 7–9 MiB. Making it the default for long-lived hosts, or directing agents to the one-shot CLI, and then trimming the coordinator might close the gap. Neither has been measured.
2. **Define CPU per case and latency for matched job shapes, then measure again.** On the policy's definitions, FAST-AF fails CPU per case; per case it would also fail latency, and counting only asserted captures would fail Lushly's CPU as well. Changing a definition after seeing these results must not rescue a verdict. Any new definition would apply prospectively to both sides and need a fresh measurement: single-case invocations against suite-scale warm runs, or retained stories through the T05 adapter, so the case sets are the same.
3. **Accept the measured trade-off and revise the tolerances.** The candidate's gains are 63–74% lower peak memory, much lower per-sample latency, and lower CPU for Lushly when every render counts as a case. Its costs are more memory retained after close, and more CPU per case on FAST-AF's cheap stories (and, on the asserted-capture count, on Lushly's too).
4. **Stop at workstream 0.** Keep Storybook, and keep Specimen's observation tooling as an addition.

These are the owner's choices. Option 1 is the only one that keeps today's criteria. Options 2 and 3 change what success means and need explicit approval.

**Decision, 2026-10-31:** the owner chose option 1, as rounds of optimization under the unchanged criteria, with Rust welcome where it gives the better outcome. The rounds and their measurements are in the [T04 optimization record](t04-optimization.md). This record's verdict stands for the runtime it measured. With the native host, the [verdict session](t04-optimization.md#verdict-session) of 2026-11-01 passes every criterion for both consumers under the unchanged policy.

## Evidence

The evidence is local and ignored, under `test-results/specimens-t04-20261031/` in the recording worktree: `random/pairs-6` (the verdict session), `random/budgets-6`, `random/pairs-1` to `random/pairs-5`, `random/diagnostics`, `random/manifests` and `fonts/`. The snapshots and the measurement checkout are on `random` under `~/.cache/afd-specimens/`.

| File | SHA-256 |
| --- | --- |
| `random/pairs-6/study.json` | `4487b132d2764cc89d5520545be9fa50413a8a995cc29c1b01bf99e7e327147b` |
| `random/budgets-6/budgets.json` | `cc461a9610b42e41822ce62069dd35b3b34261c8804ccb9cf7ab0aca69e93bbd` |
| `random/pairs-5/study.json` | `1571da720f388d21ca8d75b7509326f00f82110666a09d7289c3eaaafb182772` |
| `random/pairs-4/study.json` | `a4511ad1bc0fc3469ad70ce72adb7911ba5faed83981428bcbb475625ce7062f` |
| `random/pairs-3/study.json` | `b008421171ac297e4b6499e4540a88362174c0da15cb58fdad9c5b634068b86f` |
| `random/pairs-2/study.json` | `7d3214b40ed77018094d74b26da581bf5ea7085b0edacd3fea0d252541a2cead` |
| `random/pairs-1/study.json` | `a623ac814deccae9c9efa45826bcd3316e476fb64d15d27ab1c17ce376501e48` |
| `random/manifests/fast-af.json` | `fbebbd83e82dbe5aa7f4a3e38d8c74549562e05021566e279e2d6d51abaf742d` |
| `random/manifests/lushly.json` | `659a48643acb7e6b8fa506f691ff152059e7843c59cf4e3bd6565487418f5403` |
| `fonts/fast-af/remote-fonts.json` | `ac9869134b143c56c60f10d82a15227747c0a022b234ad168123c51a135e0ee2` |
| `fonts/lushly/remote-fonts.json` | `b141e3f1b42a4e4c8ff0df6e6d0255ee939ac7a086e02ece0389b5444fdd102e` |

## Limits

- One host and one verdict session, with two repetitions per cell. The superseded sessions measured a headed incumbent and a heavier candidate harness; they share the verdict pattern, not the figures.
- The representative selections are four components per consumer, not the retained suites. The checks differ: the incumbent runs axe and plays, which the candidate does not.
- The budget prototypes are not delivered integrations.
- Attributed CPU is sampled and a lower bound.
- The headed-incumbent probe effect was avoided, not explained.
