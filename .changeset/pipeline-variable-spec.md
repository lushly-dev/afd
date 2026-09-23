---
'@lushly-dev/afd-core': patch
'@lushly-dev/afd-client': patch
'@lushly-dev/afd-server': patch
---

Pipeline variable references now follow `spec/pipeline-variables.md` in `executePipeline`, `afd-pipe` and `DirectClient.pipe`.

**Behavior change: `$input` is the request's own `input`.** `PipelineRequest` has a new optional `input` field (any JSON value, checked in request preflight), and `$input` / `$input.<path>` resolve only to it. Before, `$input` resolved to the executor's context: for `DirectClient.pipe` that was the caller's whole call context, so a step could copy trace IDs, auth or any custom context value into a command input. The context still reaches every command, but no reference can read it. Pass pipeline data as `pipe({ input, steps })`. `PipelineContext.pipelineInput` is now typed `unknown`.

Other changes:

- Only whole strings of the reference forms resolve. Other `$` strings such as `$9.99` or `$HOME` used to become `undefined` and are now passed through unchanged; `$$` escapes a literal `$` (`"$$prev"` becomes `"$prev"`); strings over 1024 characters are literals.
- Paths follow only own keys of plain JSON objects and in-bounds array indices. `constructor.constructor` no longer reaches `Function`, and `__`-prefixed segments, prototype properties, getters and array `length` never resolve.
- An unresolved reference is omitted from an object and becomes `null` in an array. In `when` conditions it is absent: `$exists` is false and `$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` are false (`$ne` against a missing field used to be true). A condition operand that is not a reference is absent too.
- Step inputs or a request `input` nested deeper than 64 levels are rejected with `VALIDATION_ERROR` before any step runs, instead of throwing `RangeError`. Condition evaluation and reference resolution run inside the per-step error handling.
- Step data is copied with `structuredClone` when it is recorded and when a reference resolves it, so a handler that mutates its input no longer changes an earlier step's recorded data.
- Resolution moved to a new `pipeline-variables` module; the public exports are unchanged. The `afd-pipe` tool schema documents `input` and the reference syntax.
