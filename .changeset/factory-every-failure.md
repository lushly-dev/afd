---
"lushly-botcore": patch
---

### Fixed

- **A Factory lane ejection lists every failing test, not only the first** (lushly-dev/afd#1607). A change that broke tests in several binaries or suites cost one ejection per failure found. The lane now reads the failing tests from everything the validation job wrote to its log, not the 200-line tail it keeps for `detail`, so a failure early in a long run is not lost. It reads cargo (each `... FAILED` test with its crate and binary, doc-tests included), vitest (with the `pnpm -r` package and any browser project), pytest's `FAILED` and `ERROR` summary, node:test's list of failing tests, TAP, CTest and Playwright's list reporter. The `ejected` event's `lines` end with a count and up to 50 of them; the `ejected` record keeps up to 5,000 as `failures`, with the total as `failureCount`. A suite that failed without naming a test, such as a lint, is still named only by its summary row. The runner must run to the end for this to help: AFD's lane now validates with `pnpm verify --keep-going`, its local `cargo test` steps run with `--no-fail-fast` and its multi-package test steps with `pnpm --no-bail`.
