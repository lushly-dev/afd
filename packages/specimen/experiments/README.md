# Real consumer probes

These opt-in experiments mount actual FAST-AF and Lushly component source through native Specimens wrappers. They exercise form state, slots, controlled selection, scoped themes and responsive layout without changing either consumer checkout. They do not execute retained CSF stories, Storybook plays, axe or a pixel comparator.

Build the package, then run from the AFD root with the repository's Node version:

```sh
pnpm -F @lushly-dev/specimen build
node packages/specimen/experiments/run-consumers.mjs \
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
node packages/specimen/experiments/run-resources.mjs \
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
node packages/specimen/experiments/run-heap-profile.mjs \
  --fast-af /path/to/clean/fast-af \
  --lushly /path/to/clean/lushly \
  --isolation process \
  --batches 3 \
  --out /path/to/empty-heap-evidence
```

The driver samples the coordinator's main V8 isolate before/after API import, during three real capture batches, after closing each bench while retaining its public handle, and after releasing all handles. Natural post-close and explicit diagnostic-GC checkpoints are separate. It records V8 heap spaces/code statistics, Node memory counters, active resources, weak handle liveness and raw `.heapprofile.json` allocation samples. It does not take full heap snapshots or identify dominator paths. Allocation self sizes are statistical surviving allocation estimates, not proof of which object retains them; native memory and worker isolates are outside this profile. Use the surrounding process-family metrics for total resource cost.

The same admission and family limits apply; these instrumented/GC runs are separate from ordinary CPU/memory acceptance. Production cleanup never forces GC. `--consumer fast-af|lushly`, `--api`, `--isolation` and per-consumer source paths allow bounded repeat runs. An admission hold remains a failed/held receipt; retry only the held consumer after headroom returns. See [heap lifetime validation](../../../docs/features/active/specimens/heap-lifetime-validation.md) for findings and the CPU/memory tradeoff.
