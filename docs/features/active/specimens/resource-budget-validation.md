# Workstream 0 resource and budget gate (T04)

Status: recorded on 2026-11-01. The incumbent and candidate ran on one quiet host, from one frozen snapshot per consumer. Both loaded the same recorded fonts and ran on the incumbent's own Chromium build. Every build and load budget passes. Against the [baseline policy](../../../../foundations/specimen/experiments/inputs/baseline-policy.json), Specimen passes active peak memory and both latency guardrails by wide margins in both consumers. It also passes CPU per verified case for Lushly. It **fails CPU per verified case for FAST-AF and post-close footprint for both consumers**, in its default in-process mode and its isolated worker alike. Workstream 0's exit therefore does not pass as declared. The proposal's response, revising the architecture or limits or keeping the existing harness, needs the owner's decision; [options](#decision-needed) are listed below.

## Conditions

| Item | Value |
| --- | --- |
| Host | `random`: Mac16,10, Apple M4 (4 performance and 6 efficiency cores), 24 GiB, macOS 27.0.1 (26A434), Node 24.21.0. Shared with other agent sessions over Tailscale |
| Code | AFD `f71d22d8` (clean); compiled `dist` digest `ec509da0…db4a` (72 files) |
| Inputs | Lushly `b8906b75` and FAST-AF `24e4eb86`, each the T01 snapshot. Freeze manifests recorded on `random` show 0 missing and 0 modified tracked files and installs equal to lockfiles. Snapshot digests are `d64b97fc…` and `3510653f…`, byte-identical to the recording Mac's copies. Lushly's snapshot also includes the builds of `@lushly/core`, `@lushly/site-renderer` and `@lushly/weather`, which its own `type-check:storybook` builds before Storybook; without them its Vite dependency scan fails and skips pre-bundling |
| Browser | Each pair ran on the incumbent's own headless Chromium: 153.0.8010.12 for Lushly and 145.0.7632.6 for FAST-AF. The candidate used `executablePath`, and every candidate capture recorded that version |
| Fonts | Both consumers' preview-head Google Fonts were recorded on 2026-10-31 and matched T01's digests (Lushly 7/7 files, FAST-AF 143/143, both stylesheets). A server in the driver process, outside both measured families, served them to both runners. No job requested an unrecorded font, and nothing loaded live |
| Gate | `quiet.mjs` passed at 01:39:45 UTC after a ten-minute window. Each job waited for a 20-second settle, and all 12 settles were quiet |
| Probe band | Each probe is the fastest of three runs. The quietest was 0.399 s, the limit 0.439 s, and all 24 probes fell between 0.399 and 0.412 s |
| Limits | One job at a time; two-core and 25% memory admission; 120-second workload limit. The candidate's family limit is 2 GiB; the incumbent's is 4 GiB (see [policy revisions](#policy-revisions-before-any-verdict)) |

## What each side ran

Per consumer, a nested ABBA of six jobs under `run-resources.mjs`: incumbent, in-process candidate, isolated candidate, isolated candidate, in-process candidate, incumbent. Each job took the policy's five cold and five warm samples.

| | Incumbent | Candidate |
| --- | --- | --- |
| Work | `vitest run` with the consumer's own Storybook config over the story files for the wrapper components: FAST-AF button, text field, alert and theme (19 stories, 7 with plays); Lushly empty state, tier badge, view tabs and section frame (8 stories, 5 with plays) | The [native wrappers](consumer-validation.md) for the same components: FAST-AF 9 and Lushly 7 verified captures, a repeat and 100 comparisons |
| Cold sample | A new Vitest process after removing the snapshot's Storybook and Vite caches | A new Node process that creates a bench, renders the first case and closes (`cold-sample.mjs`) |
| Warm sample | An immediate rerun of the selection | A render in the already primed bench |
| Verified cases per job | Every passing story test: 190 (FAST-AF) and 80 (Lushly) | Every successful render: 20 and 18 |
| Checks that add work | Storybook rendering, plays with Testing Library input, axe on every story (`a11y.test: 'error'`), Vitest's reporter | Structured DOM, ARIA, layout, style and live-state capture; Playwright input; no plays and no axe |

The two sides do different checks, and their jobs have different shapes. The incumbent spreads each process start across a whole story selection. Each candidate cold sample is a process start for one case. Every incumbent and candidate story or case passed in every sample.

## Results

| Criterion (candidate ÷ incumbent median) | Limit | Lushly in-process | Lushly isolated | FAST-AF in-process | FAST-AF isolated |
| --- | --- | --- | --- | --- | --- |
| CPU per verified case | ≤ 1 | 0.511, passes | 0.586, passes | **1.624, fails** | **1.860, fails** |
| Active peak footprint | ≤ 1 | 0.292, passes | 0.256, passes | 0.375, passes | 0.304, passes |
| Post-close footprint | ≤ 1 | **6.694, fails** | **2.430, fails** | **9.163, fails** | **1.601, fails** |
| Cold startup latency | ≤ 1.25 | 0.110, passes | 0.126, passes | 0.179, passes | 0.208, passes |
| Warm render latency | ≤ 1.25 | 0.042, passes | 0.038, passes | 0.053, passes | 0.053, passes |

Medians per job:

| Consumer / path | CPU core-seconds | Cases | CPU per case | Peak MiB | Post-close MiB | Cold ms | Warm ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lushly incumbent | 99.32, 100.06 | 80 | 1.246 | 2,384, 2,305 | 57 | 5,317 | 5,051 |
| Lushly candidate | 11.48, 11.43 | 18 | 0.636 | 686, 683 | 382 | 582 | 211 |
| Lushly candidate, isolated | 13.20, 13.09 | 18 | 0.730 | 602, 601 | 139 | 672 | 191 |
| FAST-AF incumbent | 57.98, 58.20 | 190 | 0.306 | 1,668, 1,654 | 37 | 3,077 | 2,998 |
| FAST-AF candidate | 10.14, 9.73 | 20 | 0.497 | 593, 652 | 341 | 551 | 160 |
| FAST-AF candidate, isolated | 11.38, 11.37 | 20 | 0.569 | 507, 503 | 60 | 640 | 159 |

Cold and warm latency are as the policy defines them. An incumbent sample is a run of 8 or 19 stories, and a candidate sample is one render, so neither latency is per case.

**Repeatability.** Five sessions on 2026-10-31 and 2026-11-01 agree within about 1.5% on every job's CPU; for example, the FAST-AF incumbent ran at 57.98–58.79 core-seconds in all ten of its jobs. Sessions 1–4 supplied no verdict, because their probes left the band (see below). Their values match session 5's.

## Where the cost goes

Sampled phase CPU is a lower bound on each phase, and it explains the CPU-per-case results:

| Sampled CPU | FAST-AF | Lushly |
| --- | --- | --- |
| Incumbent warm run, per story | 0.25 s | 1.00 s |
| Incumbent cold run, per story | 0.30 s | 1.31 s |
| Candidate warm render, per case | 0.11 s | 0.22 s |
| Candidate cold sample, per single-case process | 0.66 s | 0.77 s |

- **A warm render costs less in both consumers.** FAST-AF's CPU failure comes from job shape: five cold samples, each a Node process, a Vite server and a browser for one case, against incumbent cold runs that spread their start over 19 stories. Lushly's stories cost about four times FAST-AF's per story, which hides the same effect there.
- **Post-close memory is a real difference.** Each candidate job starts at about 34 MiB. After everything closes, the in-process candidate keeps 280–350 MiB more, because a closed in-process bench does not unload the imported Vite, Playwright and runtime modules (a documented limit). The isolated worker keeps about 25 MiB (FAST-AF) and 105 MiB (Lushly) more in the coordinator. An incumbent job ends at 36–57 MiB: only the measuring harness's own process remains once Vitest exits.
- **Peak memory strongly favours the candidate.** The incumbent's Storybook and Vitest browser path peaked at 1.65–2.6 GB. It exceeded the original 2 GiB family limit in a Lushly smoke run, so the incumbent job was measured under a 4 GiB limit.

## Build and load budgets

`run-budgets.mjs` built each wrapper project with Specimen's static build and loaded every case in Chromium. It also sized two prototypes from each consumer's own installs. The helpers prototype bundles the five functions retained plays import from `storybook/test`: `expect`, `waitFor`, `userEvent`, `fn` and `within`. The axe prototype bundles axe-core's own minified build with a minimal runner. Prototypes are built fully minified, as the shell is.

| Minified JS bytes | FAST-AF | Lushly | Budget | Result |
| --- | --- | --- | --- | --- |
| Shell (delivered) | 24,320 (8,473 gzip) | 24,521 (8,548 gzip) | 50,000 | passes |
| Helpers (prototype, `storybook/test` 10.3.1 / 10.6.2) | 486,032 (119,461 gzip) | 585,145 (130,197 gzip) | 600,000 | passes; Lushly within 2.5% |
| Axe (prototype, axe-core 4.11.1 / 4.13.0) | 553,608 (149,220 gzip) | 572,916 (154,787 gzip) | 650,000 | passes |
| Total | 1,063,960 | 1,182,582 | 1,300,000 | passes |

Each case actually loaded 141,130 (FAST-AF) and 138,490 (Lushly) bytes of JavaScript: the 24 KB shell and the wrapper's component code. That is 33,986 and 36,655 bytes gzip, or 29,661 and 32,517 brotli. Every case shares one wrapper module, so the cases in a consumer load identical bytes. The prototypes size categories Specimen does not ship yet. They show that the retained helper and axe code fits its budget; they are not the T05/T06 integrations, and a different helper set must be measured again.

## Measurement findings

- **Detached launches slowed the probe.** In sessions 1 and 2 the driver ran detached (`nohup`), and inside every incumbent job its probes read about 0.67 s against about 0.42 s on a quiet host. Detached resource-runner jobs without the driver reproduced this, and attached runs did not. The jobs' own CPU differed by only 1–3%. Sessions 3–5 ran over a live SSH session. The mechanism was not identified.
- **Single probes were bimodal.** Attached sessions still showed occasional single probes at 0.664–0.678 s, even straight after a quiet window. These form a discrete second value about 1.6× the first. Real contention in the [load pair](cpu-attribution-validation.md#controlled-synthetic-load-pair) produced intermediate values (0.54–0.57 s). The probe is half a second of single-threaded work; this is consistent with macOS placing it on an efficiency core. The probe now reports the fastest of three runs, and session 5 had no out-of-band probe.
- **Another session's work held the gate for hours.** Agents on `random` ran Lushly browser tests, then a worktree cleanup with a Python process at full CPU. The gate waited for both, as designed.

## Policy revisions before any verdict

The policy allows revisions before the T04 comparison runs, with the reason recorded. No comparison had produced a verdict when these were made:

| Revision | Reason |
| --- | --- |
| `hostCondition` (owner-confirmed): pairs count only with every probe ≤ 1.10× the session's quietest | T02's cross-session evidence ([record](cpu-attribution-validation.md)) |
| `limits.incumbentFamilyFootprintBytes`: 4 GiB for incumbent representative jobs | The incumbent's own path reached 2.0 GB (FAST-AF) and exceeded 2 GiB (Lushly) in smoke runs; the 2 GiB limit would have stopped the baseline itself. Its peak remains an outcome |
| `hostCondition.probe`: each probe is the fastest of three runs | Single runs were bimodal on Apple silicon (above); the 1.10 band is unchanged |

## Workstream 0 exit

| Exit criterion | State |
| --- | --- |
| Honesty-check cases | Covered by executable native fixtures (`feasibility.test.ts`, `drivers.test.ts`), with unsupported evidence returning `insufficient-evidence`, and by the original milestone's five-case capture-only agent interpretation. A separate versioned baseline/faulty/corrected fixture manifest is not maintained, and T04 did not repeat the agent interpretation |
| Known unavailable evidence labelled | Pass (G05; T03) |
| Cross-driver viewport probe | Pass ([T03](driver-context-validation.md)) |
| Build budgets | Pass, with prototypes for the helper and axe categories (above) |
| Whole-process CPU/memory baseline and host headroom | Recorded (above; admission and gate receipts in each job) |
| Predeclared tolerances | **Do not pass**: CPU per verified case (FAST-AF) and post-close footprint (both consumers, both modes) |

## Decision needed

The proposal's [risk table](../../proposed/specimens/specimens.proposal.md#remaining-risks-and-decisions) says that when measured costs do not justify replacement, work stops at workstream 0 and the architecture or limits are revised, or the existing harness is kept with the observation tooling. Options:

1. **Revise the post-close architecture, then remeasure.** Make the isolated worker the default for long-lived hosts, or have agents use the one-shot CLI, whose process exits like Vitest's. Then find and cut the coordinator's remaining 25–105 MiB. This keeps the criteria unchanged.
2. **Revise the CPU-per-case definition to equivalent job shapes.** The criterion assumes equivalent verified work. The jobs measured here have different shapes: the incumbent runs 19 stories per process start, while the candidate's cold samples run one case each. A revised comparison would measure single-case invocations and suite-scale warm throughput separately on both sides. Retained stories through the compatibility adapter (T05) would make the case sets identical.
3. **Accept the measured trade-off.** Peak memory is 62–75% lower, cold latency is 79–89% lower and warm-render CPU is lower in both consumers. The cost is more retained memory after close, and more CPU per case on FAST-AF's mixed job shape. The tolerances would be revised to say so.
4. **Stop at workstream 0.** Keep Storybook, and keep Specimen's observation tooling as an addition.

The recommendation is 1 and 2 together: an architecture fix for retained memory, and a like-for-like CPU comparison, before T05 builds on the result.

## Evidence

Local, ignored evidence is in `test-results/specimens-t04-20261031/` in the recording worktree: `random/pairs-1` through `random/pairs-5`, `random/diagnostics`, `random/manifests`, `fonts/` and `budgets/`. The snapshots and the measurement checkout are on `random` under `~/.cache/afd-specimens/`.

| File | SHA-256 |
| --- | --- |
| `random/pairs-5/study.json` (the verdict session) | `1571da720f388d21ca8d75b7509326f00f82110666a09d7289c3eaaafb182772` |
| `random/pairs-4/study.json` | `a4511ad1bc0fc3469ad70ce72adb7911ba5faed83981428bcbb475625ce7062f` |
| `random/pairs-3/study.json` | `b008421171ac297e4b6499e4540a88362174c0da15cb58fdad9c5b634068b86f` |
| `random/pairs-2/study.json` | `7d3214b40ed77018094d74b26da581bf5ea7085b0edacd3fea0d252541a2cead` |
| `random/pairs-1/study.json` | `a623ac814deccae9c9efa45826bcd3316e476fb64d15d27ab1c17ce376501e48` |
| `budgets/budgets.json` | `73abb8a8d3d5fb20737296063eccb50dc88a525a34287b21159ed4e445c0fa87` |
| `random/manifests/fast-af.json` | `fbebbd83e82dbe5aa7f4a3e38d8c74549562e05021566e279e2d6d51abaf742d` |
| `random/manifests/lushly.json` | `659a48643acb7e6b8fa506f691ff152059e7843c59cf4e3bd6565487418f5403` |
| `fonts/fast-af/remote-fonts.json` | `ac9869134b143c56c60f10d82a15227747c0a022b234ad168123c51a135e0ee2` |
| `fonts/lushly/remote-fonts.json` | `b141e3f1b42a4e4c8ff0df6e6d0255ee939ac7a086e02ece0389b5444fdd102e` |

Sessions 1–3 ran at `ccf5cb8e`, session 4 at `eb68380e` (adding the settle step) and session 5 at `f71d22d8` (adding the three-run probe). Only the driver and the probe changed between them; the measured runner, workload and fixture code did not.

## Limits

- One host and one verdict session, with two repetitions per cell; the four earlier sessions agree but were held.
- The representative selections are four components per consumer, not the retained suites. The checks differ (above), and the incumbent includes axe and plays that the candidate does not run.
- The budget prototypes are not delivered integrations.
- Sampled phase CPU is a lower bound and does not add up to each job's waited CPU.
- The detached-launch probe effect was not explained, only avoided.
