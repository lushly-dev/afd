---
'@lushly-dev/afd-core': patch
'@lushly-dev/afd-server': patch
---

`PipelineStep.stream` and `PipelineOptions.onProgress` were validated and documented but never used. Both are now `@deprecated` as not implemented, and `executePipeline()` (so `afd-pipe` and `DirectClient.pipe`) rejects a step with `stream: true` the way it rejects `options.parallel`: that step fails with `UNSUPPORTED_OPTION` and every other step is `skipped`, before any command runs. `stream: false` is still accepted, and `onProgress` is accepted but never called. The docs for `executeStream()`, the registry's `executeStream()`, `StreamableCommand` and the server's `/stream` endpoint now say that streaming is not incremental: the handler runs to completion and its result is then sent as chunks (one per array item).
