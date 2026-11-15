# Node/Vite heap and cache lifetime

Status: diagnostic profiling and a lazy runtime implementation, 2026-10-28. This extends the [whole-process resource pilot](resource-validation.md). The useful memory recovery boundary is an optional owned process; repeated worker startup has a measurable CPU cost.

## Question and method

The prior ordinary jobs retained roughly 383–392 MiB of process-accounted footprint after closing their browser/Vite benches while the Node coordinator remained alive. A short idle window cannot distinguish a leak from imported modules, native runtime state or allocator high-water behavior.

The new [diagnostic driver](../../../../foundations/specimen/experiments/README.md#diagnostic-heap-lifetime) uses Node's inspector allocation sampler at 32 KiB intervals, V8 heap/space/code statistics, Node memory counters and active-resource readback. Each consumer runs three full capture batches. Closed public bench handles remain strongly held until a final release checkpoint. Natural post-close samples and explicit diagnostic GC are separate; production cleanup never forces GC. No full heap snapshots were taken.

These profiles cover the coordinator's main isolate. Allocation stacks identify where sampled surviving objects were allocated, not their retainers or dominators. They exclude untracked native allocations and other isolates/processes. The surrounding calibrated macOS family recorder measures aggregate footprint, RSS and waited CPU separately. Instrumented/GC runs do not serve as ordinary CPU/latency acceptance.

## Baseline findings

The initial profiles used the committed `c9f728ad` implementation and the original clean FAST-AF/Lushly sources. Values below are Node coordinator heap-used / RSS in MiB, not process-family footprint.

| Checkpoint | FAST-AF heap / RSS | Lushly heap / RSS |
| --- | --- | --- |
| Before API import, diagnostic GC | 4.71 / 50.75 | 4.71 / 50.78 |
| After API import, diagnostic GC | 48.88 / 138.50 | 48.84 / 137.98 |
| Third closed batch, natural | 74.56 / 398.97 | 75.78 / 362.33 |
| Third closed batch, diagnostic GC | 62.00 / 250.75 | 64.05 / 276.56 |
| Closed handles released, diagnostic GC | 61.99 / 250.80 | 63.74 / 276.50 |

Weak bench liveness changed from three to zero after releasing the handles, but live heap fell only 0.01/0.31 MiB. Retained public handles therefore did not explain most measured residual. Import alone added about 44 MiB of live heap. After use, code/metadata, large-object space and external counters remained above the pre-import baseline; RSS was substantially larger than live heap.

Sampled surviving self sizes after handle release included approximately 19.01/17.75 MiB at Playwright callsites, 15.86/15.66 MiB at filesystem read/decoding callsites and 1.92/3.85 MiB at Vite callsites. Read/decoding allocations may include module source strings; they are not measurements of native filesystem memory. Inspector itself contributed about 2.3–2.5 MiB of sampled state. None of these groupings establishes an exact retainer path or apportions native RSS.

Installed Vite 8.3 closes sockets, watchers and environments through `server.close()`, but its server objects retain configuration/module graphs while reachable. Invalidating transformed modules does not unload Vite/Playwright's Node module cache or native runtime. The measured handle-release result limits the likely benefit of merely clearing public bench references. No unsupported mutation of Vite's internal caches was introduced.

## Implementation

The public bench now loads/validates its manifest without importing Vite or Playwright. Rendering/building initializes a backend lazily; metadata-only jobs avoid that baseline. Accepted operations on one bench execute serially. Close rejects new operations, drains accepted work, awaits backend cleanup and clears backend/configuration references.

The default backend stays in process and uses the original bounded `chromium.launch()` path. Long-lived SDK/MCP hosts can explicitly choose `runtimeIsolation: 'process'`. That mode starts one private persistent Node worker on first use, keeps captures in fresh browser contexts and waits for worker exit on close. Exiting the worker releases its module graph, bundler/native state and allocator pages together. Reusing a bench amortizes runtime startup; many short-lived isolated benches repeat that cost.

The worker runs compiled JavaScript without inherited loaders, uses bounded IPC requests and serializes nested aggregate failures. It receives the already validated configuration snapshot. Build paths resolve in the caller before crossing the process boundary. Normal close awaits browser/server cleanup and worker exit. Abort bypasses queued render work so a hung operation cannot block cleanup indefinitely.

Independent source review identified relative build-path drift and Chromium orphan risk during active render/startup. Both were corrected with executable regressions. Process mode uses Playwright's public BrowserServer kill API and an orderly worker-exit watchdog. Installed Playwright 1.64 does not enforce its supplied `launchServer` timeout; the worker watchdog must run before the host's ultimate termination timers so Playwright's registered exit hook can clean up a partially launched browser. Default in-process execution uses `chromium.launch`, whose launch timeout is enforced, and never installs worker exit behavior.

Cleanup tests verify owned Chrome PID/process-group disappearance after a stopped active browser and after a stopped pre-handshake executable, before public close can hide a survivor. They validate a responsive worker event loop. A stopped/blocked worker requiring SIGKILL can still leave descendants and must remain a forced-abort failure. Windows cleanup has not been empirically validated on this macOS host.

Final process-mode allocation diagnostics passed three batches for each real consumer (27 FAST-AF and 21 Lushly verified captures). Coordinator heap/RSS after API import was 9.53 / 62.95 MiB and 9.53 / 62.73 MiB, compared with roughly 48.9 / 138 MiB in the original eager implementation. Metadata loading is shared by both new modes; heavy runtime allocations move to the worker only in process mode.

After the third closed batch, natural coordinator heap/RSS was 11.74 / 66.00 MiB and 11.34 / 58.05 MiB. After releasing handles and diagnostic GC it was 10.38 / 64.19 MiB and 10.01 / 56.17 MiB. Weak handle liveness went from three to zero; active resources were empty at those checkpoints. Compiled API and profiling-source hashes matched before/after, and surrounding family collections completed without issues. These coordinator-only values do not measure active worker memory; the ordinary family comparison below includes it.

## Ordinary resource comparison

The comparison uses the same mixed native workflow: asserted captures, repeat capture, five warm representative renders, five cold benches, 100 offline diffs, one-second idle windows, artifacts and cleanup. There is no forced GC or inspector sampling. FAST-AF completes 20 renders / 9 asserted captures; Lushly completes 18 / 7. All modes use the same browser and existing installed dependency graph.

The frozen baseline API is a compiled copy of `c9f728ad`. Both candidate modes bind compiled JavaScript hashes before/after each job. The consumer source revisions are FAST-AF `e9abdf25516401221183821e81b0e02cd7e1c498` and Lushly `70d482217259e53c865d05518980c22bfcd876f5`. Other work dirtied the original Lushly checkout during this experiment, so later runs use a clean sparse local clone of that same commit with the existing dependency links. The original edits were preserved. Lockfile hashes do not prove installed dependency parity, and omitted external Storybook fonts remain a limitation.

| Implementation / consumer | Waited CPU, core-seconds | Peak family footprint, MiB | Post-close median footprint, MiB |
| --- | --- | --- | --- |
| Frozen baseline / FAST-AF | 10.21 | 472.01 | 363.94 |
| Frozen baseline / Lushly | 7.91 | 565.00 | 388.44 |
| Initial isolated candidate / FAST-AF | 22.97 | 492.53 | 51.26 |
| Initial isolated candidate / Lushly | 22.26 | 517.98 | 49.52 |

The initial isolated candidate cut post-close footprint by about 86–87%, but used 2.25–2.82 times the historical baseline CPU in this workflow with six runtime startups. That result changed the implementation choice: isolation is opt-in, and the lazy in-process backend remains the default.

Final validation also found higher CPU in the new default than in the historical baseline. Both browser and Node sampled CPU rose, while source/dependency provenance and workflow counts remained equal. Host conditions had changed: free-memory measure fell from approximately 49–51% to 33–37%, compression/swap grew and background load increased. This cannot by itself explain an increase in actual CPU seconds. A fresh frozen-baseline control was therefore run alongside the final modes:

| Final comparison / consumer | Waited CPU, core-seconds | Peak family footprint, MiB | Post-close median footprint, MiB |
| --- | --- | --- | --- |
| Contemporary frozen baseline / FAST-AF | 15.33 | 536.00 | 375.18 |
| Contemporary frozen baseline / Lushly | 15.63 | 565.97 | 383.93 |
| Lazy in-process default / FAST-AF | 15.37 | 438.95 | 336.71 |
| Lazy in-process default / Lushly | 14.58 | 511.18 | 355.94 |
| Explicit process isolation / FAST-AF | 21.01 | 498.83 | 52.16 |
| Explicit process isolation / Lushly | 22.45 | 520.25 | 50.04 |

All six individual jobs passed behavior assertions and complete collection with unchanged compiled API hashes and no owned survivors. The fresh control establishes that the historical CPU increase is also present in the unchanged implementation; it does not isolate which host factor caused it. Against that control, default CPU was approximately equal for FAST-AF and 7% lower for Lushly, while post-close footprint fell about 10%/7%. Metadata-only baseline-idle footprint was about 34 MiB with lazy loading. It still retains hundreds of MiB after runtime use.

Explicit isolation used about 37%/44% more CPU than the contemporary control and reduced post-close footprint about 86%/87%. Active peaks are not consistently better than the default. Historical and contemporary CPU ratios differ materially, so neither ratio is a universal multiplier. These are single sequential jobs on a shared host, without confidence intervals or a demonstrated safe concurrency count. Reusing one worker across many captures should amortize startup, but a long-lived-worker policy still needs its own measurement.

## Receipts and remaining work

Local ignored baseline allocation evidence: `test-results/specimens-heap-baseline/heap-profile-report.json` and per-checkpoint raw profiles. Ordinary frozen baseline receipts: FAST-AF under `test-results/specimens-retention-baseline-frozen/`, Lushly under `test-results/specimens-retention-baseline-lushly/`. The initial isolated candidate receipt is `test-results/specimens-retention-candidate/resource-report.json`; its preliminary FAST-AF allocation profile is under `test-results/specimens-heap-candidate/`.

Final ordinary receipts: both default jobs under `test-results/specimens-retention-final-in-process-retry/`; FAST-AF process job under `test-results/specimens-retention-final-process/`; standalone Lushly process job under `test-results/specimens-retention-final-process-lushly/`; both contemporary frozen controls under `test-results/specimens-retention-baseline-contemporary/`. Each directory retains calibration, raw process/phase records and consumer source/capture readbacks.

Final diagnostic receipt: `test-results/specimens-heap-final-process/heap-profile-report.json` with both consumer jobs passed, raw per-checkpoint profiles, native process observations and implementation hashes. The package suite has 108 passing tests, including both backend modes and cleanup regressions. Browser-only code and worker-entry execution are outside the parent V8 coverage process; runtime behavior is also asserted directly by the original Chromium feasibility suite, with no coverage exclusions added for this change.

The final source passed `fnm exec --using=24 -- pnpm check`: all nine TypeScript gate stages, exit 0 in 110.29 seconds. Local log: `test-results/specimens-heap-pnpm-check.log`. This is local repository validation; hosted CI, package release and consumer cutover are separate outcomes.

Held admissions and failed source preparation remain separate receipts. The second consumer was held in some aggregate attempts when CPU reserve was unavailable; its later standalone pass does not turn the original aggregate into a pass. No admission guard was overridden.

These observations support lazy loading and optional process containment. They do not establish absence of smaller leaks, a long-run memory plateau, Rust rewrite savings, current incumbent savings, retained-CSF compatibility or consumer migration safety. Follow-up [reused-worker batch measurements](worker-reuse-validation.md) now compare up to 90/70 verified captures against in-process and per-round restart controls. Equivalent incumbent checks and frozen current dependencies/assets remain necessary before selecting broader concurrency or migration policy.
