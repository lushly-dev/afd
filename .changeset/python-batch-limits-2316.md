---
"afd-python": patch
---

### Fixed

- **`check_batch_limits`** (`afd.core.batch`): deduplicated `too_long` and `less_than_equal` issue formatting with `afd.server.batch_execution.batch_problems` via a shared `batch_limit_problems` helper, handled finite integral float `options.parallelism` values (such as `17.0`) in raw dict inputs consistently with `BatchOptions`, and added direct unit tests ([#2316](https://github.com/lushly-dev/afd/issues/2316)).
