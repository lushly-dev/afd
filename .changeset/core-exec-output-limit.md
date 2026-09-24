---
'@lushly-dev/afd-core': minor
---

`exec()` from `@lushly-dev/afd-core/platform` no longer buffers child output without a bound. A new `maxOutputBytes` option (default `DEFAULT_MAX_OUTPUT_BYTES`, 10 MiB) caps what is captured from each of stdout and stderr. When either stream exceeds it, the process is killed with `SIGKILL` and the result has the new `errorCode` `ExecErrorCode.OUTPUT_LIMIT_EXCEEDED`, with the output captured up to the limit (a multibyte character cut by the limit is dropped). An invalid `maxOutputBytes` returns `SPAWN_FAILED` without spawning. Output is now decoded from raw bytes with a `StringDecoder`, so multibyte characters split across chunks stay intact as before.
