# Whole-process resource validation

Status: macOS recorder implemented and both real consumer resource jobs passed locally on 2026-10-28. This extends the [native consumer pilot](consumer-validation.md). It does not establish retained-CSF parity, incumbent resource savings or concurrent agent capacity.

## Scope and method

The [resource driver](../../../../packages/specimen/experiments/README.md#whole-process-resource-pilot) wraps each real consumer probe in a separate job, one at a time. The attributable family includes the Node/Vite coordinator and its Chromium/helper descendants. Source snapshots, dependency limitations, consumer readbacks and behavior assertions remain those of the native probes. Existing consumer checkouts are unchanged.

Sampling uses macOS `proc_pid_rusage` V4 for process-accounted physical footprint, RSS and CPU counters. Mach CPU counters are converted using the runtime timebase with 128-bit arithmetic. Final `wait4` user/system CPU totals include descendants reaped through the root; sampled own-process attribution never adds those rolled-up totals again. This follows [XNU's child accounting](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exit.c) and [rusage implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c).

Memory peaks are sums of simultaneous samples, not sums of individual process lifetime peaks. They are process-accounted footprint and RSS, not a deduplicated measurement of physical system RAM. Per-role CPU is a sampled lower bound; short-lived children can disappear between samples, and children detached/reparented before discovery can escape attribution. Collection completeness and these measurement limits are separate report fields.

Baseline, warm-idle and post-close observation windows are one second each. The sample interval is 100 ms with 500 ms post-root grace. One job is admitted only with two logical cores of observed headroom and at least 25% in the OS free-memory query. The target family has a 2 GiB sampled-footprint limit and 120-second workload timeout. These limits do not establish a safe agent-session count. Existing host workloads and swap/compression changes remain explicitly outside exclusive attribution.

The observer's CPU and footprint are reported separately. The external Node controller and native compilation/guard setup are also outside target totals. The recorder binds its implementation hashes before/after execution and saves source, binary and compiler identities. Each probe retains its original source revisions, installed package information, wrapper identities and separate capture provenance.

## Calibration and source review

The persisted calibration checks a CPU-bounded parent/child workload, a touched 64 MiB allocation, three short-lived children, final reaped-child totals, and agreement between sampled child CPU and independently reported Node CPU seconds. A separate native fixture verifies rejection of mismatched parent unique IDs, unverified ancestry and stale audit-token versions, plus exact-token termination/reaping. An injected root-enrollment failure must leave the workload unexecuted.

The pure resource suite contains 23 tests covering simultaneous peaks, PID reuse, CPU double-counting, missing data, overflow/enrollment failures, role changes across exec, phase bounds, reserves and a controller that ignores termination. Together with the original 71 tests, the package has 94 tests. Native calibration and guards run separately on supported macOS rather than silently passing on other platforms. The final source passed the full TypeScript `pnpm check` gate: all nine stages, exit 0 in 38.65 seconds; its log is retained with the final resource artifacts.

Independent source review found four issues, all corrected: non-atomic PID-only cleanup, failed root enrollment allowing untracked execution, overflow being dropped from the summary, and an unbounded controller shutdown. The reviewer also confirmed the Mach conversion and exact-identity ancestry correction. Cleanup uses [XNU's audit-token signal path](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c), retaining exact identity through signaling. The final focused review reported no remaining P1/P2 findings.

Initial instrumented probes exposed legitimate exits between BSD and usage reads; those are now recorded as sampling loss. Failed reads for still-live selected identities and failed whole enumeration remain collection errors. Protected/non-target scan failures are diagnostic and distinct from target measurement failures.

## Final measurements

The final admitted run used Node 24.21.0, Chromium 156.0.8078.4, Darwin 27.0.0/arm64 and an Apple M5 host with ten logical cores and 24 GiB RAM. FAST-AF source remained clean at `e9abdf25516401221183821e81b0e02cd7e1c498`; Lushly remained clean at `70d482217259e53c865d05518980c22bfcd876f5`. Both jobs passed the native behavior assertions with no collector read failures, tracking overflow, resource-limit termination, or owned survivors before/after cleanup. Measurement source digests were unchanged throughout the run.

| Consumer job | Successful renders / asserted captures | Waited job CPU, core-seconds | Sampled peak footprint, MiB | Sampled peak RSS, MiB | Warm-idle median footprint, MiB | Post-close median footprint, MiB |
| --- | --- | --- | --- | --- | --- | --- |
| FAST-AF | 20 / 9 | 8.116 | 521.90 | 788.84 | 422.57 | 383.18 |
| Lushly | 18 / 7 | 8.292 | 561.78 | 834.22 | 431.85 | 391.65 |

The job CPU totals include source preparation, startup, the asserted captures, repeat capture, five warm and five cold representative renders, 100 offline diffs, idle windows, artifact writing and cleanup. These are mixed workflow costs, not individual case CPU measurements. The one-second post-close window follows closure of the warm bench while its Node coordinator is still alive; it does not describe a surviving process after job exit. Baseline-idle footprint was approximately 132.20 MiB in each job.

The Node/Vite coordinator's own sampled peak footprint was 446.07 MiB for FAST-AF and 483.45 MiB for Lushly. The Chromium executable family's own sampled peaks were 87.11 and 89.04 MiB. These maxima occur independently and must not be summed into a purported simultaneous peak. Headless Chromium subprocess names do not distinguish all renderer/GPU roles, so their measurements are grouped by executable family. Node/Vite includes native bundler work as well as JavaScript; this breakdown alone does not attribute cost to TypeScript or predict a Rust rewrite's savings.

The native observer used 0.1002 and 0.0764 CPU seconds respectively, approximately 1.23% and 0.92% of target waited CPU. Its sampled/self-accounted footprint was about 1.5 MiB. The separate Node controller reported approximately 55–60 MiB RSS at readback; this is not included in target memory and is not a physical-footprint measurement. Host swap use did not increase across either job; compressor usage fell, but concurrent background activity prevents exclusive attribution.

Calibration's 64 MiB allocation produced an 80.22 MiB observed child footprint including its runtime. Sampled child CPU was 0.183911 seconds against an independent 0.184447-second receipt; final waited CPU was 0.480406 seconds against 0.471997 seconds reported by the root and four children. Only one of three short-lived children was seen by sampling, demonstrating why final waited accounting and sampled attribution remain distinct. All seven kernel identity/ancestry guards and the fail-closed enrollment negative check passed.

Local ignored evidence: `test-results/specimens-resources-final-admitted/resource-report.json`, `calibration.json`, and each consumer's `resources.json`, `processes.jsonl`, `phases.jsonl`, `controller-stop.json`, and retained native probe artifacts. The collector/compiler identities and before/after source digests are included. Earlier pilots remain separate evidence; `test-results/specimens-resources-final/` records an attempted run held before launch when all ten host cores were busy. No resource reserve was overridden.

## Acceptance boundary

The next comparison requires frozen current consumer dependencies/assets and the actual incumbent Storybook/Vitest path with equivalent checks. Full-suite resource comparison waits for retained-CSF parity. The retained Node/Vite footprint makes coordinator loading, cache lifetime and heap retention useful next profiling targets; one-second retention does not establish a leak. Rust and lifecycle/cache changes remain candidates for measured improvements. Concurrent capacity and long-duration repeated-batch growth remain unmeasured.
