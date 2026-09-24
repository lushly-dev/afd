---
'@lushly-dev/afd-core': minor
---

The registry's `executeStream()` now honors `StreamOptions.timeout`, which it used to ignore. The timeout is a deadline for the whole stream: when it passes, the command's `signal` aborts and the stream ends with a `STREAM_TIMEOUT` error chunk (recoverable, with `resumeFrom` when it stops between data chunks), even if the command ignores the signal. A caller abort is still reported as `STREAM_ABORTED`, and an invalid timeout (negative, NaN or infinite) yields a single `VALIDATION_ERROR` chunk without running the command. The core `executeStream()` takes the deadline as a new `timeout` option (`StreamExecutorOptions`).
