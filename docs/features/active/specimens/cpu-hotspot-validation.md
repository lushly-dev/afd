# Warm Node CPU profiling and cached sourcemaps

Status: confirmed warm sourcemap hotspot reduced and four primary ordinary 90-capture comparison jobs passed locally, 2026-10-29.

## Scope and identities

The [worker-reuse study](worker-reuse-validation.md) found a remaining FAST-AF CPU premium after startup. This investigation profiles the coordinator and warmed isolated worker in the same ten-round, 90-capture FAST-AF workload. Every round verifies all nine existing descriptor requests. The sample covers rounds 2–10, after the first complete round warms the runtime: 81 captures within the 90-capture job.

Main imported the previous `ceaa5156` baseline through #476 while this branch was idle, moving native code into `foundations/specimen` and separating AFD/CLI units. Initial profiles preserve the original package layout and compiled baseline. Source readback established that the native bench, worker, Vite, browser runtime and experimental drivers were byte-identical in the import. Primary confirmation profiles and ordinary comparisons use base `e868c9401eae13bdb9af4263dff5e6ef5c39f920`, with baseline/candidate snapshots retaining both `src/` and `dist/`. All six browser-map relative sources resolve; both browser source and compiled trees are byte-identical across variants. The baseline was built before the fix, and the old package tree was not merged back into main.

All jobs use Node 24.21.0, Vite 8.3.0 and Playwright 1.64.0 with the existing Chromium. FAST-AF remains clean at `e9abdf25516401221183821e81b0e02cd7e1c498`, with the same source-copy wrapper and installed dependency links. Compiled JavaScript and measurement source hashes are bound before/after each job. The ordinary matrix also hashes selected consumer source/runtime/tooling files and the Node executable before/after; this is a declared endpoint scope, not a frozen transitive installation.

## Diagnostic method

The opt-in `--cpu-profile` resource-runner flag injects a Node preload into the coordinator and compiled worker through `NODE_OPTIONS`. Both main isolates use inspector CPU sampling at 1,000 microseconds. The worker keeps its normal `execArgv: []`; no product IPC operation or public bench option was added.

After round one, the driver identifies the coordinator PID and its direct worker PID/PPID from atomic ready receipts. A shared nonce binds start and stop markers. Both profilers must acknowledge start before round two; both must stop and flush their `.cpuprofile` files before the bench closes. Errors or missing acknowledgements fail the run. A Node-only process fixture verifies actual preload inheritance, both barriers, identities, sampled frames, atomic output and bounded cleanup. Its process-group fallback makes that fixture POSIX-only.

Profiles also include checkpoint-idle windows and profiler/barrier work. They cover main V8 isolates, excluding Chromium, native/background work and other isolates. Sample/time-delta weights are wall-sampling estimates, not authoritative CPU seconds. Ancestry categories overlap; their totals must not be added. Ordinary acceptance runs omit the profiling flag, preload and forced GC, and retain authoritative whole-family waited CPU accounting.

Existing admission, one-job execution, two-core/25%-free-memory reserves, 2-GiB footprint limit, 100-ms process sampling, one-second idle windows, 500-ms exit grace and 120-second workload timeout are unchanged. Held attempts and a discarded inline diagnostic whose metadata changed during collection remain separate receipts.

## Findings and selected fix

The initial valid isolated and in-process profiles did not reproduce a meaningful instrumented whole-job CPU gap: 57.127 versus 57.072 core-seconds. Coordinator child-process IPC parsing contributed only about 20 ms of self sampling. Playwright's extra remote/WebSocket path was visible, but the data did not establish it as the dominant avoidable cost.

The largest grouped self hotspot was Vite's repeated fallback sourcemap generation. Installed `vite/dist/node/chunks/node.js` showed the response path `viteTransformMiddleware → send$1 → generateMap → generateDecodedMap → addUneditedChunk`. When transformed JavaScript lacks a map, `send$1` synthesizes a high-resolution fallback map for each response, even when transformed code is cached. The worker's initial sourcemap ancestry weight was about 2.07 seconds; in-process weight was about 2.84 seconds. This is a common hotspot, not evidence of an isolation-specific regression.

The candidate adds a serve-only post-transform hook for unchanged physical JavaScript without existing source-map references. It obtains the fallback map through Vite's public plugin context and lets Vite retain it in the existing transform cache. Vite discards a returned map when code is unchanged, so the hook appends one trailing newline. JavaScript execution is preserved, while response bytes and their recorded source digest truthfully change.

Guards check the original file, current code and map source/content. Existing TypeScript mappings, external maps, inline maps and earlier code transforms are left alone. No separate response cache, private cache mutation, disabled map output or new dependency was introduced. Normal Vite invalidation and server close govern the map's lifetime. The build plugin/output path and worker transport/shutdown code are unchanged.

HTTP regressions cover both automated and interactive servers: repeated responses stay stable and share one cached transform; source edits replace code and maps; expressions execute the same result before/after caching; map entries point to the original source; and capture provenance changes after a real source edit. Separate fixtures preserve TypeScript, external and inline map content/mappings.

## Profile confirmation in the current layout

Both current-layout diagnostic jobs pass 90/90 captures and profile the same 81 warmed captures. Values below are worker weighted wall-sampling milliseconds, not CPU totals:

| Measurement | Baseline | Candidate | Observed reduction |
| --- | --- | --- | --- |
| `addUneditedChunk` self | 1,056.282 | 3.458 | 99.67% |
| Sourcemap ancestry union | 1,842.185 | 277.258 | 84.95% |
| `send$1` ancestry union | 2,315.102 | 728.469 | 68.53% |

These rows overlap. The remaining 3.458 ms still follows the same fallback path; profiles contain no request/module IDs, so they cannot identify every guard miss. Instrumented whole-job waited CPU is 54.520 versus 50.546 seconds; that diagnostic comparison is not ordinary acceptance. Playwright WebSocket-message sampling remains similar, 936.252 versus 945.216 ms, supporting a map-specific change rather than a transport claim.

## Ordinary comparison and validation

The primary ordinary plan uses two isolated before/after pairs in ABBA order, all with 90 captures, one reused bench, no inspector preload and no forced GC. Consumer verification and first/last artifact retention are identical. Both snapshot roots have equal lengths and retain the relative source/map layout. No phase-level sampling estimate is subtracted from whole-job CPU. Map caching can trade earlier computation and cached map memory for less repeated work, so active peaks and post-close footprint remain required outcomes.

| Ordinary job | Waited CPU, core-seconds | CPU per verified capture, seconds | Peak family footprint, MiB | Post-close median footprint, MiB |
| --- | --- | --- | --- | --- |
| Isolated baseline, repetition 1 | 53.885 | 0.599 | 536.51 | 42.79 |
| Isolated candidate, repetition 1 | 49.114 | 0.546 | 538.41 | 42.88 |
| Isolated candidate, repetition 2 | 53.028 | 0.589 | 542.44 | 42.54 |
| Isolated baseline, repetition 2 | 54.777 | 0.609 | 548.07 | 42.82 |

Isolated candidate CPU was **8.85% / 3.19% lower** than its paired baselines. This is a small shared-host pilot, not a universal savings estimate or a significance claim. The isolated baseline/candidate ranges overlap; browser CPU also varied. The profiles establish the specific hotspot reduction without turning sampled attribution into an authoritative total.

Isolated active peaks changed **+0.36% / −1.03%**, so the data does not show a consistent peak-memory improvement. Post-close footprint remained **42.54–42.88 MiB** across all four jobs. The isolated close-time recovery benefit remains, while retaining an open worker still incurs its full active footprint. Default isolation and worker lifetime policies are unchanged.

All four primary ordinary jobs passed **360 successful renders and 360 verified captures**, with one bench create/close per job, complete collection, unchanged API/measurement hashes within each run, matching consumer provenance and no owned survivors before or after native cleanup. Snapshot source/compiled hashes matched before/after and an independent final readback; selected endpoint inputs remained unchanged across the initial and corrected studies. Only `vite.js` differs in compiled JavaScript. Ordinary job totals include startup, verification, artifacts, idle windows and cleanup.

Validation on Node 24.21.0:

- `pnpm test:specimen` passed: 100 native tests, including both browser-cleanup regressions and the new source-map/HTTP/profiler checks, plus 12 packed-artifact consumer checks. Integration/CLI unit suites are also included in the repository gate.
- `pnpm check` passed all eleven current TypeScript gate stages in 266.67 seconds, including browser-free coverage, boundaries, skills and provenance tooling. Imported upstream identities and quarantine state remain intact; only post-import adaptation records change.
- Final rebuilt candidate JavaScript is checked against the measured API identities. No worker transport, shutdown deadline, process-family collector or concurrency policy changed.

Local gate logs: `test-results/specimens-cpu-20261029/specimen-check.log` and `pnpm-check.log`. These are local receipts, not hosted CI or package-publication evidence.

Local evidence is under `test-results/specimens-cpu-20261029/`: the two preserved legacy profiles, `main-baseline-api/`, `profile-main-baseline/`, `profile-main-candidate/`, raw profiler identity/nonce receipts, process/phase records and the ordinary study receipts. `analysis/analyze_profiles.py` and `analysis/main-map-profile-summary.json` reproduce the current-layout profile grouping and retain raw-profile hashes/source locators.

The earlier six-job `ordinary-study.json` cohort and its flat-copy profiles are retained as preliminary evidence only. Its baseline copy did not preserve relative paths to internal browser TypeScript map sources, while the workspace candidate did. It is excluded from the final performance claims. The correction adds no product-code change.

Primary evidence is `recheck/study.json` and `recheck/run.py`: two layout-preserving diagnostic jobs and four ordinary ABBA jobs, with both complete `base/` and `test/` source/output snapshots. `recheck/analysis/corrected-profile-summary.json`, `fixture-and-ordinary-summary.json` and their analysis scripts bind raw-profile hashes, fixture identities and final pair calculations. `recheck/endpoint-inputs-final.json` verifies selected endpoint content still matches the initial study's pre-run manifest. Two held recheck attempts remain separate. No reserve was overridden.

This remains a bounded native-component pilot. Shared-host variation, limited repetitions, sampled/non-deduplicated memory, unavailable broader consumer parity and existing asset/dependency limitations remain explicit. Imported units stay quarantined; source changes do not authorize publishing them.
