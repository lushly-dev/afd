# CPU and memory after the monorepo update

Status: fourteen ordinary consumer jobs passed locally on 2026-10-30, verifying 832 captures. Isolated reuse retains close-time memory recovery and saves CPU against per-round restarts. CPU is higher than the historical studies; changed consumer inputs and shared-host variation prevent attributing that increase to the repository consolidation.

## Workload and identities

This reruns the [worker-reuse study](worker-reuse-validation.md) after merging `origin/main` at `40b6a7cc32d8b755ec74abef8135099e51181314` into the profiling branch (`59dcf590`). The measured revision is `71505dc6`: the merge plus one fixture compatibility change. FAST-AF source now imports `@lushly-dev/fast-element`; the fixture links that identity and its former `@microsoft/fast-element` alias to the same physical runtime. Wrapper source, requests and behavioral assertions are unchanged. No product runtime or native collector code changes in this rerun.

FAST-AF comes from this checkout's `foundations/fast-af`, including the upstream reconciliation through `5e64a6a5`. Its installed runtime is `@lushly-dev/fast-element` 3.0.1. Lushly uses the same clean component-source snapshot at `70d482217259e53c865d05518980c22bfcd876f5` as the earlier study, with its existing installed dependency links. The linked Lushly Violet component build has advanced: 63 selected files changed and 18 were added. The selected Lushly application sources and linked FAST runtime are byte-identical to the earlier study. FAST-AF selected component source and runtime bytes also changed. `historical-input-delta.json` lists the exact paths and hashes.

The native bench uses Node 24.21.0, Vite 8.3.0 and Playwright 1.64.0, with existing Chromium 156. Native tooling endpoint hashes match the earlier study. All eighteen compiled native JavaScript files match the valid cached-map candidate from the [CPU hotspot study](cpu-hotspot-validation.md); all six browser maps resolve their original TypeScript sources. These checks avoid the earlier flat-copy source-map mismatch. The preliminary flat-copy cohort and diagnostic profiles supply no comparison rows here.

The matrix repeats the prior fourteen-cell plan serially: one-round in-process and isolated controls for both consumers; two ten-round reuse pairs with reversed order (FAST-AF ABBA, Lushly BAAB); and one isolated restart-per-round control per consumer. Each round verifies the same nine FAST-AF or seven Lushly requests across four components. Every render uses a fresh browser context. First/final-round artifacts, observation retention, checkpoints and verification are unchanged.

Ordinary jobs have no inspector preload or forced GC. Existing admission reserves two logical cores and at least 25% in `memory_pressure -Q`'s free-memory measure. Sampling remains 100 ms; idle windows one second; exit grace 500 ms; limits 120 seconds and 2 GiB per family. One attempt was held for CPU headroom before launching a workload; it passed on retry with the same reserves. Admitted pre-job free memory was 37–43%, and sampled pre-job host CPU use was 3.78–7.04 logical cores on the ten-core host. This is admission evidence, not an exclusive-machine benchmark.

## Current whole-job measurements

CPU is authoritative waited root/reaped-descendant CPU, including preparation, verification, artifacts, idle windows and cleanup. Footprint is the simultaneous sampled sum of process-accounted `phys_footprint`, not deduplicated physical RAM. Reuse columns show repetitions 1 / 2. The four small controls are retained in `analysis.json`; the larger workloads below are the primary comparisons.

| Consumer / policy | Verified captures per job | CPU, core-seconds | CPU per capture, seconds | Peak family footprint, MiB | Post-close median footprint, MiB |
| --- | --- | --- | --- | --- | --- |
| FAST-AF in-process reuse | 90 | 47.325 / 44.570 | 0.526 / 0.495 | 488.40 / 477.82 | 391.37 / 358.15 |
| FAST-AF isolated reuse | 90 | 56.315 / 56.423 | 0.626 / 0.627 | 521.18 / 505.97 | 43.26 / 43.12 |
| FAST-AF isolated restart each round | 90 | 72.441 | 0.805 | 492.40 | 40.63 |
| Lushly in-process reuse | 70 | 39.982 / 42.605 | 0.571 / 0.609 | 487.50 / 480.57 | 340.35 / 339.65 |
| Lushly isolated reuse | 70 | 53.135 / 55.715 | 0.759 / 0.796 | 521.76 / 545.41 | 38.55 / 38.37 |
| Lushly isolated restart each round | 70 | 69.098 | 0.987 | 487.92 | 38.18 |

Against the current in-process pairs, isolated reuse uses **19.00% / 26.60% more CPU for FAST-AF** and **32.90% / 30.77% more for Lushly**. Closing the isolated worker reduces the remaining coordinator footprint by **87.96–88.95% for FAST-AF** and **88.67–88.70% for Lushly**. Both current consumers consistently favor in-process reuse for CPU and isolated close for retained memory.

Against the current restart controls, worker reuse uses **22.11–22.26% less CPU for FAST-AF** and **19.37–23.10% less for Lushly**. Reused workers have higher active peaks than the restart controls. Post-close recovery works for both lifetime policies; the benefit arrives when the worker closes.

## Comparison with the historical results

The following rows compare medians of the two reuse repetitions in the original worker-reuse study with the two current repetitions. These are historical comparisons across changed inputs and times, not contemporaneous controlled estimates of monorepo overhead. Two samples do not establish statistical significance.

| Consumer / policy | Previous median CPU, core-seconds | Current median CPU, core-seconds | Observed CPU change | Median active peak, previous → current MiB | Median post-close footprint, previous → current MiB |
| --- | --- | --- | --- | --- | --- |
| FAST-AF in-process reuse | 39.687 | 45.947 | +15.78% | 496.51 → 483.11 | 403.43 → 374.76 |
| FAST-AF isolated reuse | 49.574 | 56.369 | +13.71% | 546.16 → 513.57 | 43.12 → 43.19 |
| Lushly in-process reuse | 31.620 | 41.294 | +30.60% | 517.61 → 484.04 | 426.99 → 340.00 |
| Lushly isolated reuse | 30.041 | 54.425 | +81.17% | 541.52 → 533.58 | 38.97 → 38.46 |

The newer, valid cached-map FAST-AF comparison is the closer native-runtime baseline: its isolated CPU was **49.114 / 53.028** core-seconds, versus **56.315 / 56.423** now, an observed **10.37% increase in the two-run median**. Median active peak falls **4.97%**, from **540.43 to 513.57 MiB**; median post-close footprint changes from **42.71 to 43.19 MiB**. Native compiled code is unchanged, while FAST-AF consumer source/runtime inputs have changed. This does not show that the cached-map optimization stopped working.

Lushly has no corresponding post-cache historical CPU cohort. Relative to the original reuse study, its isolated median rises **81.17%** and its in-process median rises **30.60%**. The unchanged application-source snapshot does not freeze its linked dependency build: the Violet package bytes changed. This substantial observed increase warrants a follow-up with frozen dependency inputs and warm worker/coordinator profiles; these measurements alone do not identify the cause.

The single restart controls also rise versus their historical values: FAST-AF **55.421 → 72.441** core-seconds (**30.71%**), Lushly **48.688 → 69.098** (**41.92%**). A single control supplies no variance estimate.

## Open-runtime lifetime

Each cell is the family footprint median during an open-bench idle checkpoint. Current-round observations have been released before sampling.

| Isolated policy | Round 1, MiB | Round 5, MiB | Round 10, MiB |
| --- | --- | --- | --- |
| FAST-AF reuse, repetition 1 | 414.8 | 461.3 | 432.1 |
| FAST-AF reuse, repetition 2 | 429.8 | 443.5 | 425.1 |
| FAST-AF restart each round | 422.9 | 423.8 | 418.3 |
| Lushly reuse, repetition 1 | 440.2 | 457.7 | 474.1 |
| Lushly reuse, repetition 2 | 431.8 | 471.8 | 470.8 |
| Lushly restart each round | 431.3 | 435.5 | 427.2 |

The FAST-AF reuse checkpoints fluctuate rather than growing monotonically. Lushly's round-ten medians remain approximately 34–39 MiB above round one. Ten rounds do not establish a plateau or leak. An open isolated worker still carries the runtime caches; close-time recovery is a separate result.

## Verification and evidence

All fourteen completed jobs have 832 successful renders and 832 verified captures, with 32 expected bench starts matching 32 creates and closes. Independent process-family counts are one observed Node identity for in-process reuse, two for isolated reuse, and eleven for ten-round isolated restarts. Every completed collection reports complete status, no resource-limit termination, no collection issues and no owned survivors before or after native cleanup. The held admission remains a separate failed receipt and contributes no performance ratios.

Compiled API and measurement hashes are unchanged before/after each job and match across the matrix. Consumer provenance matches within each consumer. Selected endpoint manifests match before/after the entire study, including native source/output, the Node binary, selected consumer files, linked runtime packages and native Vite/Playwright. This scope excludes nested dependency directories, generated caches and symlinks; it does not freeze every transitive dependency or establish lockfile-to-install equivalence. Existing omitted Storybook font assets, bounded component coverage, shared-host effects and unavailable broader consumer parity remain limitations.

Local evidence is `test-results/specimens-monorepo-20261030/`: `study.mjs` and its recorded SHA-256, `study.json`, `inputs-before.json`, `inputs-after.json`, `historical-input-delta.json`, each job's raw resource/probe/process/phase receipts, `analyze.mjs`, `analysis.json`, and `verify-and-compare.py` with `comparison.json`. The verifier reads the historical raw CPU receipts, excludes held/diagnostic jobs, checks exact capture/lifecycle counts, and calculates the displayed comparisons. These are local execution receipts, not hosted CI or publication evidence.

To repeat the larger current workloads from a clean checkout after building the native package:

```sh
fnm exec --using=24.21.0 -- node foundations/specimen/experiments/run-resources.mjs \
  --consumer fast-af --fast-af foundations/fast-af \
  --workload batches --batches 10 --lifetime reuse --isolation process \
  --out /path/to/empty-fast-af-evidence
```

For Lushly, select `--consumer lushly --lushly /path/to/clean/lushly`. Use `--isolation in-process` for the in-process control or `--lifetime batch --isolation process` for restarts; repeat reuse pairs with reversed ordering. Hold source and installed dependency identities fixed within each comparison. The experimental source-copy probes do not execute retained CSF stories, Storybook plays, axe or pixel comparison.

Keep in-process execution as the default and isolated reuse opt-in when recovery on explicit close is valuable. This rerun supplies no concurrency-capacity, automatic worker-recycling or publication decision.
