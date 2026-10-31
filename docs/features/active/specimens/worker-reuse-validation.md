# Isolated-worker reuse

Status: fourteen completed real consumer jobs passed locally, verifying 832 captures, 2026-10-28. Reuse preserved the post-close memory benefit and used less CPU than the per-round restart controls. This follows the [heap/cache lifetime study](heap-lifetime-validation.md), whose cold-heavy workflow showed substantial post-close memory recovery and a repeated-worker startup CPU cost.

The [updated monorepo rerun](monorepo-resource-validation.md) repeats this matrix after the FAST-AF import and upstream reconciliation, retaining the historical results below for comparison.

## Question and controls

The question is whether one isolated runtime can process a larger capture batch while approaching in-process CPU cost and retaining the memory recovery benefit when closed. These are two separate outcomes: an open worker still owns Vite/Playwright caches, and closing it releases those caches. A worker kept open indefinitely does not provide the post-close benefit.

The new [batch workload](../../../../foundations/specimen/experiments/README.md#reused-worker-batches) renders the complete existing FAST-AF or Lushly descriptor each round: nine or seven verified captures across four components per consumer. One round and ten rounds provide 9/90 or 7/70 captures. This increases capture count and lifetime, not the number of distinct component implementations, story coverage or consumer-suite parity.

Each job prepares the copied project once. Reuse holds one bench/browser through every round; the restart control creates/closes a bench/browser after each round. Every individual capture gets a fresh context and the same requests/assertions. Only the current round's observations are held in memory, with raw artifacts written for the first and final rounds. There are no warmup-only captures, inspector samples, forced GC or offline comparison loops.

The completed matrix has fourteen serial jobs: one-round in-process/isolated controls for both consumers; two ten-round pairs per consumer with order reversed (ABBA for FAST-AF, BAAB for Lushly); and one ten-round isolated restart control per consumer. Small jobs established that the workload fit before escalation. Failed or held attempts remain separate; only completed jobs with matching workflow/input identities supply comparative ratios.

The calibrated macOS recorder, 100-ms sampling, one-second baseline/checkpoint/post-close windows, 500-ms exit grace, two-core/25%-free-memory admission, 2-GiB family-footprint limit and 120-second workload timeout are unchanged. Observer compilation/calibration and external input hashing are outside target job totals. Waited job CPU includes preparation, captures/assertions, phase/artifact writing, snapshot copying and cleanup. Sampled per-phase CPU is a lower bound and is not subtracted from authoritative waited totals.

Open-bench checkpoints follow rounds 1, 5 and 10, after the current observation scope returns and before any restart-policy close. Both reuse and restart controls therefore sample an open runtime at the checkpoint. Their one-second sampled footprint trend does not establish a leak or long-run plateau. Post-close windows have no live public bench references. Process-accounted footprint/RSS sums are not deduplicated physical RAM.

Source and compiled API identities remain those of the prior study: FAST-AF `e9abdf25516401221183821e81b0e02cd7e1c498`, clean Lushly clone `70d482217259e53c865d05518980c22bfcd876f5`, and runtime implementation `f446a87195ceacb68d064a2eb9bfe57e9529700b`. The driver binds compiled API and measurement source hashes before/after each job. External endpoint hashes cover selected source paths, linked FAST/Lushly runtime packages and Vite/Playwright packages, excluding nested dependency directories, generated caches and symlinks. That explicit scope is not a frozen transitive dependency installation. Existing installed-version mismatches and omitted external Storybook fonts remain limitations.

## Results

All values below are ordinary whole-job measurements without diagnostic GC. CPU is authoritative waited job CPU, including workflow overhead. Footprint is the simultaneous sampled process-accounted sum. Paired reuse columns list repetitions 1 / 2; restart controls ran once.

| Consumer / ten-round policy | Verified captures per job | CPU, core-seconds | CPU per verified capture, seconds | Peak footprint, MiB | Post-close median footprint, MiB |
| --- | --- | --- | --- | --- | --- |
| FAST-AF in-process reuse | 90 | 37.339 / 42.035 | 0.415 / 0.467 | 496.31 / 496.72 | 403.82 / 403.04 |
| FAST-AF isolated reuse | 90 | 50.567 / 48.581 | 0.562 / 0.540 | 544.30 / 548.02 | 43.04 / 43.19 |
| FAST-AF isolated restart each round | 90 | 55.421 | 0.616 | 487.20 | 43.54 |
| Lushly in-process reuse | 70 | 36.958 / 26.281 | 0.528 / 0.375 | 525.52 / 509.70 | 435.29 / 418.68 |
| Lushly isolated reuse | 70 | 30.409 / 29.672 | 0.434 / 0.424 | 549.91 / 533.13 | 39.18 / 38.77 |
| Lushly isolated restart each round | 70 | 48.688 | 0.696 | 493.56 | 38.60 |

Compared with the restart controls, reused workers used **8.76–12.34% less CPU for FAST-AF** and **37.54–39.06% less CPU for Lushly**. Both reuse and restart policies recover runtime memory at final close. Reuse jobs made exactly one bench and had two observed Node processes including the coordinator. Restart jobs made ten benches and had eleven observed Node identities. In-process jobs had one bench and one observed Node identity. These independent counts corroborate that the requested lifetime policies executed.

Against the paired in-process controls, FAST-AF isolated reuse still used **35.43% / 15.57% more CPU**. Lushly isolated reuse used **17.72% less / 12.90% more CPU**, so it does not establish a stable CPU winner. Post-close footprint consistently fell **89.28–89.34% for FAST-AF** and **90.74–91.00% for Lushly**. Those savings describe the still-alive coordinator after worker exit, not an open worker's cost.

The one-round controls were FAST-AF 7.728 seconds in process versus 9.961 isolated, and Lushly 5.092 versus 5.430. The ten-round jobs improve amortized end-to-end CPU per capture, but preparation and artifact costs are also shared. Comparing their absolute per-capture values across times does not isolate worker startup or remove shared-host effects.

Open-runtime checkpoint medians show the accumulation that reuse permits:

| Isolated policy | Round 1 footprint, MiB | Round 5 footprint, MiB | Round 10 footprint, MiB |
| --- | --- | --- | --- |
| FAST-AF reuse, repetition 1 | 428.3 | 467.9 | 496.6 |
| FAST-AF reuse, repetition 2 | 432.1 | 486.1 | 490.8 |
| FAST-AF restart each round | 434.4 | 428.2 | 429.4 |
| Lushly reuse, repetition 1 | 437.7 | 493.4 | 499.0 |
| Lushly reuse, repetition 2 | 433.7 | 471.2 | 486.8 |
| Lushly restart each round | 418.2 | 440.5 | 430.2 |

Each checkpoint contains 9–10 samples. Round-ten reused-worker medians remained about 53–68 MiB above round one. Some later intervals grew only slightly, but ten rounds do not establish a plateau. Reused-worker peaks were higher than both the restart controls and paired in-process jobs; all stayed below the unchanged 2-GiB limit. There is no demonstrated active-memory saving from retaining the worker.

## CPU attribution and decision

FAST-AF's CPU premium persisted after the first round. For rounds 2–10, sampled batch CPU lower bounds were 25.03 / 27.71 seconds in process and 35.85 / 34.62 isolated. Sampled Node role CPU for the full jobs was 10.18 / 11.67 in process versus 19.70 / 18.69 isolated. Browser CPU was 23.35 / 26.37 versus 26.47 / 25.78. These counters support examining the Node runtime/coordination path; they do not identify IPC, serialization, WebSocket transport or another specific cause.

Lushly's Node role CPU was also higher with isolation in both pairs, but browser CPU varied enough to reverse the whole-job ranking. Role/phase counters are sampled lower bounds and must not be added to or subtracted from waited totals. The `batch` phase encloses `render`, so their CPU counters overlap.

The supported policy is to reuse an opt-in isolated bench across related captures and explicitly close it at the end of a run. This amortizes startup relative to restarting each round and retains memory recovery on close. Keep in-process execution as the default: FAST-AF has a remaining measured CPU premium, Lushly ordering is inconsistent, and active peaks are higher with isolation. The follow-up [warm Node CPU investigation](cpu-hotspot-validation.md) identified repeated Vite fallback-map generation and tested cached maps, without changing worker transport or shutdown. Long-lived worker recycling, concurrent capacity and a broader component suite still require separate evidence.

## Review and evidence

Independent source review found no actionable P1/P2 in the new driver/wrapper. It confirmed full verification per batch, strict render/lifecycle totals, checkpoint placement and bounded observation retention. The review was read-only; the real guarded jobs provide execution evidence. Native collector and product runtime code are unchanged.

Independent numerical readback verified all fourteen completed rows: 832 successful renders equaled 832 verified captures; 32 expected bench starts equaled 32 creates and closes. Consumer provenance matched within each consumer, compiled API hashes matched across jobs and before/after each job, measurement implementation hashes remained stable, and selected input content manifests matched before/after the matrix. Every completed family collection reported no issues, no resource-limit termination and no owned survivors after cleanup.

The final source passed `fnm exec --using=24 -- pnpm check`: all nine TypeScript gate stages, exit 0 in 75.55 seconds. Local log: `test-results/specimens-worker-reuse-admitted/pnpm-check.log`. The final rebuilt API still matches every measured job's hashes. The existing 108 Specimens tests remain passing; the opt-in benchmark's 832 real verified captures are additional execution evidence, separate from the package test count. No Rust, Python, C++ or native collector source changed.

The final local study is `test-results/specimens-worker-reuse-admitted/`: `study.json`, `inputs-before.json`, `inputs-after.json`, `analysis.json`, `study.mjs` (the exact local orchestration plan/hash), `analyze.mjs`, and each job's resource/probe/raw process/phase receipts. The study includes eleven failed/held admission attempts alongside the fourteen completed jobs. The initial separate study under `test-results/specimens-worker-reuse/` was held three times before its first workload could start; it remains failed/held. No reserve was overridden, and no ratios use failed attempts.

There are only two reuse repetitions and one restart control per consumer, on a shared host whose background load changed materially. Reversed ordering exposes sensitivity but does not establish statistical significance. The existing dependency/assets, structured-observation, non-deduplicated memory, sampled attribution and retained-CSF boundaries remain in force. No consumer Storybook configuration, product runtime, worker default or native collector was changed.
