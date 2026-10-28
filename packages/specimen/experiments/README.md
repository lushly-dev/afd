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
