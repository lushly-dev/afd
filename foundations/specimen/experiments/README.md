# Real consumer probes

These opt-in experiments mount actual FAST-AF and Lushly component source through native Specimens wrappers. They exercise form state, slots, controlled selection, scoped themes and responsive layout without changing either consumer checkout. They do not execute retained CSF stories, Storybook plays, axe or a pixel comparator.

Build the package, then run from the AFD root with the repository's Node version:

```sh
pnpm -F @lushly-dev/specimen build
node foundations/specimen/experiments/run-consumers.mjs \
  --fast-af /path/to/fast-af \
  --lushly /path/to/lushly \
  --out /path/to/empty-evidence-directory \
  --samples 5
```

`--consumer fast-af` or `--consumer lushly` selects one consumer. Source roots default to `~/github/fast-af` and `~/github/lushly`; pass explicit roots elsewhere. Consumers must be clean and have the declared runtime dependency links installed. The script makes no installations and requires the same installed Chromium as the package tests.

The driver copies the descriptor's source paths into a canonical temporary directory outside Git, links the existing consumer dependencies, and generates a native manifest and wrapper. The original checkouts remain read-only. Temporary projects are copied into the evidence directory for inspection and removed from their execution location afterward. Run the driver again to regenerate an execution project; retained copies under another repository would inherit that repository's ancestor identities.

Each run saves raw observations, separate `capture-provenance.json` files, repeat comparisons, per-consumer receipts and an aggregate `report.json`. The separate provenance records the original consumer revision and clean state, declared manifest/lockfile hashes, installed package versions/link targets, and wrapper hash. Raw captures truthfully have unavailable Git/lock identities for the neutral copied project. Declared lock hashes do not establish that installed dependencies match the lockfile. Finite loaded-source digests remain part of the native captures.

Five cold samples create new Vite benches/cache directories and Chromium processes while retaining OS and package caches. Five warm samples reuse a primed bench/browser with a fresh context per render. Timing includes the public render operation; cold totals additionally include bench creation. Node CPU/RSS excludes Chromium, and is not total browser memory. The driver also measures 100 offline comparisons of a small repeated capture. Host load and process counts are recorded. These are pilot measurements, without an incumbent baseline or fixed acceptance tolerances, and cannot establish a speedup.

The four FAST-AF cases use the consumer's forked FAST runtime. The four Lushly cases reuse its existing theme frame and installed FAST/Violet graph. Lushly's current installed dependencies differ from its manifests, and external Storybook fonts are omitted, so its results remain exploratory. All cases assert measured browser state and reject browser console errors. Repeat differences and incomplete evidence remain visible in the receipts; passing scenario assertions do not mean complete visual equivalence or CSF compatibility.

See the [consumer validation record](../../../docs/features/active/specimens/consumer-validation.md) for results and outstanding acceptance work.

## Whole-process resource pilot

On macOS with Xcode command-line tools, wrap the same probes in the process-family recorder:

```sh
node foundations/specimen/experiments/run-resources.mjs \
  --fast-af /path/to/fast-af \
  --lushly /path/to/lushly \
  --out /path/to/empty-resource-evidence \
  --samples 5
```

The wrapper builds a small local C observer against `libproc` in the evidence directory. It calibrates reaped-child CPU accounting, sampled Mach CPU conversion and a touched 64 MiB child allocation, then checks exact process-identity signaling and failed root enrollment. It runs each consumer in a separate Node job, sequentially, with five cold/five warm samples and one-second baseline, warm-idle and post-close windows. It adds no package dependency or installed global binary. Other platforms return an explicit unsupported result. This is an experimental repository CLI, not the proposed public `specimen-profile` command.

Admission reserves two logical cores and requires at least 25% in macOS `memory_pressure -Q`'s free-memory measure. Each target family has a 2 GiB sampled-footprint limit and a 120-second workload timeout. The observer samples every 100 ms and watches for 500 ms after root exit. These are fixed pilot limits, not a demonstrated concurrency capacity. A held admission records its reason and launches no probe. Host-wide swap/compression deltas include other work and cannot be attributed solely to Specimens.

The target includes Node/Vite, browser descendants and observable helpers. Final `wait4` user/system time includes descendants reaped through the job root, capturing CPU from short-lived children missed by sampling. Sampled per-process CPU attribution remains a lower bound. Memory reports the simultaneous sum of process-accounted `phys_footprint` and, separately, RSS; these are sampled measures, not unique system RAM. Chromium executable names may not distinguish renderer/GPU roles, so ambiguous roles remain grouped by executable family. No job count is extrapolated from one worker.

Ownership follows verified PID/start/unique identities and matching kernel parent identities. Known descendants remain observable after reparenting; children reparented before observation can be missed. Cleanup uses kernel-checked audit PID/version identities, and a bounded controller fallback records missing final readback as unverified. Overflow, failed enrollment, missing measurements and surviving owned processes cannot become a successful complete collection. Explicit sampling loss remains visible.

Evidence includes `resource-report.json`, `calibration.json`, per-consumer `resources.json`, raw `processes.jsonl`, phase events, collector source/binary/compiler identities, controller stop records and the original native probe artifacts. Observer CPU/memory is reported separately from the target. The resource runner binds measurement source hashes before and after execution. Native collector/guard compilation is setup outside the target job totals; the controller is also outside the target process family.

Use `--isolation in-process` (default) or `--isolation process` to compare backend lifetime. `--api /absolute/path/to/index.js` selects a frozen compiled implementation; JavaScript hashes are checked before and after each job. Older APIs can ignore the new isolation option, so the requested mode alone does not prove backend support. The direct `run-consumers.mjs` equivalent is `SPECIMEN_BENCH_ISOLATION=process` and optionally `SPECIMEN_BENCH_API=/absolute/path/to/index.js`.

The pure resource tests run with the package suite. To run them alone:

```sh
pnpm -F @lushly-dev/specimen exec vitest run experiments/resources
```

See the [resource validation record](../../../docs/features/active/specimens/resource-validation.md) for measured results and remaining limits.

## Diagnostic heap lifetime

Run a separate, guarded allocation-sampling job:

```sh
node foundations/specimen/experiments/run-heap-profile.mjs \
  --fast-af /path/to/clean/fast-af \
  --lushly /path/to/clean/lushly \
  --isolation process \
  --batches 3 \
  --out /path/to/empty-heap-evidence
```

The driver samples the coordinator's main V8 isolate before/after API import, during three real capture batches, after closing each bench while retaining its public handle, and after releasing all handles. Natural post-close and explicit diagnostic-GC checkpoints are separate. It records V8 heap spaces/code statistics, Node memory counters, active resources, weak handle liveness and raw `.heapprofile.json` allocation samples. It does not take full heap snapshots or identify dominator paths. Allocation self sizes are statistical surviving allocation estimates, not proof of which object retains them; native memory and worker isolates are outside this profile. Use the surrounding process-family metrics for total resource cost.

The same admission and family limits apply; these instrumented/GC runs are separate from ordinary CPU/memory acceptance. Production cleanup never forces GC. `--consumer fast-af|lushly`, `--api`, `--isolation` and per-consumer source paths allow bounded repeat runs. An admission hold remains a failed/held receipt; retry only the held consumer after headroom returns. See [heap lifetime validation](../../../docs/features/active/specimens/heap-lifetime-validation.md) for findings and the CPU/memory tradeoff.

## Reused-worker batches

Run larger verified capture workloads through the same process-family recorder:

```sh
node foundations/specimen/experiments/run-resources.mjs \
  --consumer fast-af \
  --fast-af /path/to/clean/fast-af \
  --workload batches --batches 10 \
  --isolation process --lifetime reuse \
  --out /path/to/empty-batch-evidence
```

Use `--isolation in-process --lifetime reuse` for the in-process control, or `--isolation process --lifetime batch` to restart the worker after each complete batch. `--consumer lushly --lushly /path/to/clean/lushly` selects Lushly. The default resource workload remains the original mixed consumer probe; `--workload batches` selects this separate experiment.

Each batch runs every existing descriptor request in order and verifies all behavior assertions: nine FAST-AF or seven Lushly captures. `--batches 1..10` repeats those cases rather than discovering additional components or stories. Reuse holds one bench/browser across all batches; every capture still has a fresh browser context. Batch lifetime recreates the bench/browser after each round, while sharing the one copied project and process-wide OS/package caches.

Baseline, open-bench checkpoints after rounds 1/5/10, and post-close windows use the same one-second idle interval. Current-batch observation scope is released before each checkpoint; full artifacts are saved only for the first and final batch. Reports check actual bench create/close totals, successful renders, verified captures and source readback. The family collector independently records observed Node/browser identities and surviving owned processes.

Waited CPU and CPU per verified capture include preparation, verification, phase/artifact writing and cleanup. Coordinator-only Node counters in the batch receipt exclude the isolated worker/browser and must not replace the whole-family measurements. No inspector sampling, forced GC, cold representative samples or offline diff loops run in this workload. Existing 120-second/2-GiB limits and host admission remain unchanged; partial or held jobs do not supply valid comparison ratios.

See the [worker-reuse validation](../../../docs/features/active/specimens/worker-reuse-validation.md) for the paired experiment, open-worker memory trend and post-close cost.

For this monorepo's FAST-AF source, pass `--fast-af foundations/fast-af`. The fixture links both runtime package aliases to the same physical package. The [monorepo rerun](../../../docs/features/active/specimens/monorepo-resource-validation.md) compares the refreshed 90/70-capture workloads with prior CPU and memory results.

## Warm Node CPU profiles

Add `--cpu-profile` to the reused batch workload for a diagnostic run:

```sh
node foundations/specimen/experiments/run-resources.mjs \
  --consumer fast-af --fast-af /path/to/clean/fast-af \
  --workload batches --batches 10 --lifetime reuse --isolation process \
  --cpu-profile --out /path/to/empty-profile-evidence
```

Both Node main-isolate profilers start after round one warms the runtime, acknowledge a shared nonce before round two, and stop/flush after the final round before bench close. Ten rounds still execute 90 verified FAST-AF captures; the profiles cover the 81 warmed captures in rounds 2–10 plus checkpoint-idle/barrier work. In-process mode profiles only its coordinator. Profiling requires at least two rounds and `--lifetime reuse`.

The driver saves raw `.cpuprofile` files and atomic role/PID/PPID/nonce receipts under each consumer's `cpu-profiles/`. Workers inherit the explicit diagnostic preload through `NODE_OPTIONS` while retaining their ordinary empty `execArgv`. Missing acknowledgements, profiler errors or empty samples fail the run. Without the flag the preload and profiler are absent.

Inspector profile weights describe statistical wall sampling in each main isolate, excluding Chromium and native/background threads. Inclusive ancestry categories overlap. Keep these diagnostic runs separate from ordinary CPU/memory acceptance; rerun the same workload without the flag for waited process-family CPU, footprint and post-close measurements. See [CPU hotspot validation](../../../docs/features/active/specimens/cpu-hotspot-validation.md) for the confirmed sourcemap hotspot, cached-map change and matched measurements.

## Frozen inputs and story inventory

`inputs/` records what a comparison runs against before any measurement. Snapshot each consumer outside every repository (`git archive <revision>`), install it from its own lockfile with its declared pnpm, run the preparation scripts listed in [`inputs/consumers.json`](inputs/consumers.json), and generate Storybook's index with `node_modules/.bin/storybook index -c .storybook -o <evidence>/<consumer>-index.json`. Then:

```sh
node foundations/specimen/experiments/inputs/inventory.mjs --consumer lushly \
  --root /path/to/snapshot --index /path/to/lushly-index.json \
  --project '{"a11y":{"test":"error"},"includeTags":["test"],"excludeTags":[],"skipTags":[]}' \
  --out /path/to/lushly-inventory.json
node foundations/specimen/experiments/inputs/freeze.mjs --consumer lushly \
  --snapshot /path/to/snapshot --repo /path/to/lushly --revision <full-sha> \
  --fetch-remote --out /path/to/lushly-inputs.json
```

The inventory takes discovered identities and tags from Storybook's index. A static TypeScript reading of each story module (`inputs/csf.mjs`) adds plays, render sources, policy parameters, globals, decorators, lifecycle hooks and helper imports. Same-file constants, spreads and `Story.field` references resolve. Anything else is reported as unresolved, and its play presence as unknown. The project policy is passed explicitly because preview files execute code.

The manifest binds every snapshot file outside `node_modules` to the pinned Git tree by blob id, hashes generated files, checks pnpm's installed `lock.yaml` against the lockfile, and digests selected installed packages, vendored artifacts, static directories and obligation files. It also records the browsers each consumer's Playwright expects, the host and [`inputs/baseline-policy.json`](inputs/baseline-policy.json). `--fetch-remote` downloads and hashes the remote font stylesheets and files named in `preview-head.html`; runners still load them live. Neither tool installs, prepares or modifies anything. See [frozen inputs and inventory](../../../docs/features/active/specimens/frozen-inputs-inventory.md) for the T01 results.

## Frozen snapshots and the host-condition probe

The consumer runners normally require a clean Git checkout. To run against a T01 snapshot, which has no `.git`, list its manifest from `inputs/freeze.mjs` in `SPECIMEN_FROZEN_MANIFESTS` (paths separated by `:`). The manifest must name the snapshot root and record no missing or modified tracked files. Its revision then stands in for Git state, and drift is rejected:

```sh
SPECIMEN_FROZEN_MANIFESTS=/path/to/lushly-inputs.json \
node foundations/specimen/experiments/run-resources.mjs \
  --consumer lushly --lushly /path/to/snapshot \
  --workload batches --batches 10 --lifetime reuse --isolation process \
  --out /path/to/empty-evidence
```

Each resource report records `speedProbe.before` and `speedProbe.after`: fixed single-threaded work in a separate process, outside the measured family. On a contended host its CPU seconds rise along with job CPU. It shows when two receipts ran under different host conditions; it does not correct them. See the [CPU attribution record](../../../docs/features/active/specimens/cpu-attribution-validation.md): whole-job CPU from different sessions is not comparable without this control.
