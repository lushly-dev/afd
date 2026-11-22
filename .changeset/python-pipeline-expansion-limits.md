---
"afd-python": patch
---

### Fixed

- **Pipeline step inputs are bounded as in TypeScript** ([#1722](https://github.com/lushly-dev/afd/issues/1722); `spec/pipeline-variables.md`, "Limits"). Before, Python checked only the depth of the template. A step input that repeated a reference to a large value expanded it in full each time, so a small request could build an arbitrarily large input.
  - **Engines:** `execute_pipeline`, `afd-pipe` and `DirectClient.pipe` now fail the step with `VALIDATION_ERROR` (`retryable: false`, `details: {"stepIndex", "limit"}`) without running its command in these cases:
    - a value copied into the input nests deeper than 64 levels;
    - the resolved input exceeds 100,000 values;
    - it exceeds 16 MiB of string and key characters, counted in UTF-16 code units.
  - **What is charged:** only a repeated expansion of the same referenced value is charged for its contents, so one large step output still flows through `$prev`.
  - **Deep or circular step data:** before, step data nested 255 levels or deeper, or circular, could not be converted to JSON, so a reference to it resolved as absent and the step ran without it. Such data is now still viewed, as TypeScript sees it: a reference may pass through it, and copying more than 64 levels of it, or a cycle, into a step input fails on `depth`.
  - **Up-front approvals:** a step input over the limits is not resolved for approval; the step fails when it runs.
- **Referenced values in a resolved step input are copies:** a handler that mutates its input no longer changes another step's data.

### Added

- **`afd.core.pipeline_variables`:** adds `MAX_RESOLVED_NODES`, `MAX_RESOLVED_CHARS` and `PipelineResolutionLimitError`, a `ValueError` whose `limit` is `"depth"`, `"nodes"` or `"chars"`. `resolve_variables` and `resolve_input` raise it.
