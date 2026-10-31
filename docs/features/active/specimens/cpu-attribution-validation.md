# CPU increase attribution (T02)

Status: recorded locally on 2026-10-31. The best-supported explanation for the CPU increase in the [2026-10-30 monorepo rerun](monorepo-resource-validation.md) is host contention. Same-session comparisons show that changing consumer inputs made no measurable difference for Lushly. The native code was unchanged from the rerun. On a quiet host the same native build and current inputs cost **43–51% less** than the rerun, and a job run under unplanned contention from other host activity reproduced the rerun's Lushly value. A fixed-work probe tracked job CPU. A [controlled synthetic-load pair](#controlled-synthetic-load-pair) on a quiet host then raised job CPU by 21–25% for identical verified work, with every probe outside the load in band, so contention is now directly shown to raise this workload's CPU. No optimization is selected.

## Question and design

G02 recorded higher CPU in the 2026-10-30 rerun than in earlier studies: FAST-AF isolated was +10.37% against the cached-map cohort, and Lushly isolated was +81.17% against the original reuse cohort. Those baselines differed in age, inputs and host conditions. T02 separates those factors with same-session comparisons on [T01's frozen inputs](frozen-inputs-inventory.md).

| Factor | How it was controlled |
| --- | --- |
| Consumer inputs | Historical and current inputs ran ABBA in the same session on one native build. Historical inputs: Lushly `70d48221` and upstream FAST-AF `e9abdf25`, the revisions of the original reuse study. Current inputs: Lushly `b8906b75` (T01 snapshot) and AFD `cdfbbfb7` `foundations/fast-af`, as in the rerun. Every input is either a `git archive` snapshot outside any repository or a clean detached checkout, installed from its own lockfile. Freeze manifests record 0 missing and 0 modified tracked files for each, and the installed lock equals the lockfile. |
| Native code | One compiled API for every job (`dist/index.js` SHA-256 `c6d84a63…b628`). `foundations/specimen/src` is byte-identical between #517 (`459f8965`) and `cdfbbfb7`. #517's rerun record states its compiled JavaScript matched the cached-map candidate merged there. The rerun's own hash receipts are not retained here, so equality rests on source identity. |
| Host condition | A fixed-work probe ran in a separate process before and after each job: single-threaded hashing and JSON round trips, with an identical digest every time. Pre-job host CPU use and free memory were also recorded. A bounded synthetic background load (five busy-loop processes outside the job's family) was planned as a direct test. |

On a contended host, identical work takes more CPU seconds, so the probe shows when receipts ran under different host conditions. It is a covariate, not a correction factor.

Everything else is unchanged: the 90/70-capture ten-round reused-worker workload, ordinary jobs with no profiler or forced GC, two-core / 25%-free-memory admission, the 2-GiB family limit, the 120-second timeout and 100-ms sampling. The [baseline policy](../../../../foundations/specimen/experiments/inputs/baseline-policy.json)'s 10% repeatability and 5% noise-floor tolerances decide which cells may supply ratios.

## Same-session input comparison

The 16 ordinary jobs ran between 08:45 and 08:53 UTC. Every one passed: 1,280 verified captures, 16 bench creates and 16 closes, complete collections, no held attempts and no owned survivors. Before each job the host had 0.83–3.32 busy logical cores and 60–62% free memory. Probe values before and after jobs ranged over 0.417–0.749 CPU seconds.

The policy holds cells whose repetitions spread more than 10%. The table also applies the probe band proposed below: a job is outside the band when its before or after probe exceeds 1.10× the session's quietest probe (0.417 s), that is 0.459 s.

| Consumer / policy | Historical inputs, core-seconds | Current inputs, core-seconds | Median change | Jobs outside the probe band | Verdict |
| --- | --- | --- | --- | --- | --- |
| Lushly isolated reuse | 26.985 / 26.221 | 27.220 / 26.334 | +0.65% | none | No measurable difference |
| Lushly in-process reuse | 22.054 / 21.679 | 22.267 / 21.766 | +0.69% | none | No measurable difference |
| FAST-AF isolated reuse | 30.233 / 32.281 | 29.782 / 33.502 | +1.23% | one current job (after-probe 0.543) | Held: current repetitions spread 12.49% |
| FAST-AF in-process reuse | 31.104 / 34.178 | 27.458 / 25.229 | −19.29% | both historical jobs (after-probes 0.749, 0.479) and one current job (before-probe 0.559) | Held for host noise |

Repetitions are listed in run order; each cell's two jobs ran in ABBA positions.

Lushly is the clean comparison: all eight of its jobs fall inside the probe band, and changing its inputs, including the vendored Violet build behind G01, made no measurable difference in either isolation mode. FAST-AF's cells are not usable as input evidence. The isolated cell fails the repeatability limit, and the in-process −19.29% coincides with probe excursions on three of its four jobs. FAST-AF's input effect is therefore unmeasured, not shown to be zero or negative.

Active peaks were 495–550 MiB in every cell. Post-close footprint was 38.5–43.8 MiB for isolated jobs and 407–415 MiB in process, which matches the earlier recovery result.

## Host contention is the best-supported explanation

The same native build and current inputs, measured on a quiet host, compared with the 2026-10-30 rerun medians:

| Consumer / policy | 2026-10-30 rerun median | 2026-10-31 quiet median | Change |
| --- | --- | --- | --- |
| Lushly isolated reuse | 54.425 | 26.777 | −50.80% |
| Lushly in-process reuse | 41.294 | 22.017 | −46.68% |
| FAST-AF isolated reuse | 56.369 | 31.642 | −43.87% |
| FAST-AF in-process reuse | 45.947 | 26.343 | −42.67% |

This table is itself a cross-session comparison, the kind the decision below says needs a host-condition control. The rerun recorded no probe. Its only host evidence is admission state: 3.78–7.04 busy cores and 37–43% free memory, against 0.83–3.32 busy cores and 60–62% free memory here. CPU contention and memory pressure both differ, and these data do not separate them.

The planned synthetic-load test ran into contention from unrelated host activity. Of 27 attempts, 22 were held for CPU headroom, one load job failed in its calibration step, and four completed:

| Job | Host before, busy cores | Probe before / after, CPU seconds | Job CPU, core-seconds |
| --- | --- | --- | --- |
| Lushly isolated, no synthetic load | 5.62 | 0.946 / 0.945 | **53.727** |
| FAST-AF isolated, no synthetic load | 5.69 | 0.784 / 0.666 | **51.450** |
| FAST-AF isolated, five synthetic load processes | 5.70 | 0.435 / 0.466 (0.665 while loaded) | **45.983** |
| FAST-AF isolated, no synthetic load, after the host quietened | 1.58 | 0.454 / 0.433 | 31.312 |

- Under unplanned contention, unchanged Lushly work cost 53.727 core-seconds, essentially the rerun's 54.425 and 2.0× the quiet 26.777, with the probe at 2.3× its quiet value.
- The one completed synthetic-load job cost 47% more than the quiet job that followed it, and the probe measured during that load rose by about 50%. Its pre-job probe was quiet, though, and it cost less than the contended no-load job. Busy cores alone predict the probe poorly: two jobs admitted at about 5.7 busy cores had pre-job probes of 0.435 and 0.784.
- Across completed no-load isolated jobs, job CPU correlates with the mean of each job's two probes: Pearson r = 0.999 for Lushly (5 jobs) and 0.960 for FAST-AF (6 jobs). Each coefficient is dominated by its one or two contended jobs and pools historical and current inputs. This is consistent with contention, not proof of it.

The probe contains no Specimen, Vite, Playwright or browser code, yet it inflates on the same order as the jobs. That points to a host-level effect on the CPU seconds that identical work consumes on this M5 host (4 performance and 6 efficiency cores), rather than a Specimen-specific cost. These data cannot identify the mechanism (core placement, frequency or shared caches). `powermetrics` would require elevated privileges and was not run.

## Controlled synthetic-load pair

The direct test ran later on 2026-10-31, on a second Mac, `random`: a Mac16,10 with an Apple M4 (10 logical cores, 4 performance and 6 efficiency) and 24 GiB of memory, running macOS 27.0.1 (26A434) and Node 24.21.0. AFD was a clean checkout at `79c99962`, and the compiled API had the same SHA-256 as the T02 jobs (`c6d84a63…b628`). The inputs were Lushly's T01 snapshot `b8906b75`, bound by its T02 manifest, and AFD's own `foundations/fast-af` at `79c99962`.

The pair started only after [`resources/quiet.mjs`](../../../../foundations/specimen/experiments/resources/quiet.mjs) had seen ten consecutive minutes with at most 1.5 busy cores, at least 25% free memory and no test, browser or build process from another session. Another agent's Lushly browser tests had kept the host busy for about 20 minutes before that. [`run-load-pair.mjs`](../../../../foundations/specimen/experiments/run-load-pair.mjs) then ran each consumer ABBA. The loaded jobs ran beside five busy-loop processes outside the job's family, started two seconds before the job. Everything else matched T02's isolated-reuse cell: ten reused-worker batches, ordinary jobs, unchanged admission and limits.

| Consumer | Verified captures per job | No load, core-seconds | Five busy loops, core-seconds | Median change |
| --- | --- | --- | --- | --- |
| Lushly isolated reuse | 70 | 26.724, 26.601 | 33.345, 33.393 | **+25.2%** |
| FAST-AF isolated reuse | 90 | 28.883, 29.172 | 35.214, 34.950 | **+20.9%** |

All eight jobs passed at the first attempt, with no held admissions. Every before and after probe was within the [baseline policy](../../../../foundations/specimen/experiments/inputs/baseline-policy.json)'s new band: the quietest probe was 0.407 s and the limit 0.448 s. Probes taken during the load rose to 0.544–0.566 s. Repetitions agree within 1.0%, well inside the 10% repeatability tolerance. Peak footprint did not move: 604–613 MiB for Lushly and 511–521 MiB for FAST-AF.

The unloaded values match T02's quiet M5 medians closely (26.66 against 26.78 for Lushly, 29.03 against 31.64 for FAST-AF), but they come from a different host and are not a cross-host comparison. The load used here made five of ten cores busy. T02's larger cross-session differences are consistent with heavier or different contention, and this pair does not reproduce their size.

## Warmed profiles

Four diagnostic jobs ran with `--cpu-profile` on the current inputs: isolated and in-process for each consumer. Their probes ranged over 0.424–0.536 s, so three of the four jobs ran partly outside the proposed band. Profiles cover rounds 2–10, which is 81 FAST-AF or 63 Lushly warmed captures. Values are self-time wall-sampling estimates for each main isolate, not CPU totals, and these single profiles carry no variance. The categories group self time, so they do not overlap.

| Profile | Busy / sampled, ms | Playwright | Node internals | Native / builtin | Vite | GC | Specimen |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lushly isolated worker | 6,475 / 15,517 | 2,772 | 1,509 | 1,162 | 358 | 274 | 22 |
| Lushly isolated coordinator | 617 / 15,505 | 0 | 282 | 31 | 0 | 0 | 1 |
| Lushly in-process coordinator | 4,063 / 14,746 | 1,480 | 1,100 | 671 | 263 | 164 | 8 |
| FAST-AF isolated worker | 7,189 / 18,516 | 3,344 | 1,576 | 1,218 | 355 | 276 | 22 |
| FAST-AF isolated coordinator | 698 / 18,520 | 0 | 347 | 43 | 0 | 0 | 0 |
| FAST-AF in-process coordinator | 6,972 / 19,752 | 2,970 | 1,986 | 901 | 375 | 189 | 23 |

- **Isolated coordinators are about 96% idle.** Isolation moves work into the worker rather than duplicating it in the coordinator.
- **Playwright's client is the largest Node self-time category,** at 36–47% of busy time in every busy isolate. Its largest single frame is in `playwright-core/lib/coreBundle.js`.
- **`defaultPrepareStackTrace`** (Node error-stack preparation) costs 162–524 ms in each busy profile. This is consistent with per-call stack capture, but the profiles do not name the caller.
- **Vite stays at 263–375 ms.** The cached fallback-map fix from #517 still holds.
- **Specimen's own code is under 25 ms.**

Playwright per-call overhead is therefore the main remaining Node cost. It is a lead for later resource work. It is not the cause of the increase, and no change is made here.

## Decision and consequences for comparisons

- **G02:** the increase is attributed to host contention as the best-supported explanation. Changing Lushly's inputs had no measurable effect, the native source is unchanged, and FAST-AF's input effect remains unmeasured. No language or runtime change is indicated.
- **Closed:** the controlled synthetic-load pair. Five busy loops on a quiet host raised CPU for identical verified work by 25.2% (Lushly) and 20.9% (FAST-AF), with every outside probe in band.
- **Cross-session CPU needs a control.** Whole-job CPU from different sessions MUST NOT be compared without a host-condition control. Admission's two-core reserve admitted jobs at 5.6 busy cores whose CPU doubled. Cross-session deltas in the [worker-reuse](worker-reuse-validation.md) and [monorepo](monorepo-resource-validation.md) records are therefore host-sensitive. Their within-session ABBA comparisons remain the meaningful ones.
- **The probe is now part of the resource runner.** `run-resources.mjs` records `speedProbe.before` and `speedProbe.after` around every job, and `speedProbeComplete` marks a probe that failed. The runner's probe uses the same work as the study driver's, but it has so far run only in smoke jobs.
- **Confirmed by the owner on 2026-10-31 and now in the baseline policy (`hostCondition`):** a comparison pair supplies a ratio only when each job's before and after probes fall within 1.10× of the session's quietest probe. Otherwise the pair is held, like a repeatability failure. Measurements also start only after the quiet-window gate passes; that gate is a precondition, not evidence.

## Evidence

Local evidence is in `test-results/specimens-cpu-20261031/` in the recording worktree. Snapshots and manifests are in `~/.cache/afd-specimens/t02-20261031/`, alongside T01's in `~/.cache/afd-specimens/t01-20261031/`. Both are ignored, local and not publication evidence. Each job directory keeps its resource, probe, process and phase receipts.

| File | SHA-256 |
| --- | --- |
| `study.mjs` (driver: smoke, full, load and profile plans) | `c075c8ee47336a32783d0b34902830b3ef86d8964cc3e356ce961b4c996cf39f` |
| `analyze.mjs` | `04913b18f57ad95d5baae021ca45b5b49267f89979831ced0b710bf34a4ae8bf` |
| `profiles.mjs` | `8f7f5302aafa64bab819946e4453343c2918b990c1fa8aaa2fea5baefe1008ea` |
| `full/study.json` | `c71eeaf26075fdc1b03f4ceaea7281b902afad900e7e5c55642f43140dcf8cee` |
| `full/analysis.json` | `314db8378685d88df63bbeddbc095ab2fbeb0ca90408f9272b4a314c33bda76e` |
| `load/study.json` | `7c308d111353f41cb2e9ff4364e81d605f41bae37a3a61440ab28e7b22771270` |
| `profile/study.json` | `526ee7d66d4b6ef0afd10f04882d2dc7e4c666c9c5bd01e18c7cba1708ec5ef7` |
| `profile-summary.json` | `18bdd96f17ae8a8c49f31f50a8e3c9e3ccd20da27d5ff78944d59bc864df4c52` |
| Load pair: `specimens-t04-20261031/random/load-pair-1/study.json` | `c3857c0e55e0b32e94643052b209cc090ebf1d87c6059a0efffa3a84a9647ffc` |
| Load pair: `specimens-t04-20261031/random/quiet.jsonl` (the gate's samples) | `63282a5fe3dcc81a4c751e0a244019a8464ea8c9ec6ccd4e25e270f63af072e5` |
| `run-load-pair.mjs` at `79c99962` | `66f921a7755e3b683d5d41622cbbbfe99fe333da13e969d56105bc136d1d5985` |

The measured jobs ran on `cdfbbfb7` plus an earlier form of this change's frozen-snapshot support, which trusted the manifest's recorded file lists. After review, the committed support also re-hashes the snapshot on every read, against a content digest that new manifests record. The T02 manifests were re-recorded with that digest under `manifests/`, and the hardened path passed a smoke job. The digest covers every snapshot file outside `node_modules`; installed dependencies are bound once, by freeze time's lockfile agreement and package digests, and are not re-hashed on each read. Each report's `implementationBefore` and `implementationAfter` digests record the measurement code that actually ran.

## Limits

- Two repetitions per cell on a shared host. The contended T02 jobs were not planned. The controlled pair used one load level on a second host, so it shows the direction and order of the effect, not the size of T02's cross-session differences.
- The correlation uses few jobs and depends on one or two contended points per consumer.
- The probe shows that host conditions differ. It does not measure the job's own scheduling and does not correct job CPU.
- The profiles are single diagnostic runs. Their timing is sampled wall time in Node main isolates only, excluding Chromium.
- Native wrappers exercise eight components, not retained stories. Incumbent comparisons remain T04.
