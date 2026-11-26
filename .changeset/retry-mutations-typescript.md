---
"@lushly-dev/afd-server": minor
---

**Fix (behaviour change): `createRetryMiddleware` no longer repeats a mutation** ([#2673](https://github.com/lushly-dev/afd/issues/2673)). It used to retry any command whose failure code was `TRANSIENT_ERROR` or `TIMEOUT`, so a handler that returned `TIMEOUT` after a downstream write could have that write applied twice. A command that declares `mutation: true` now runs once and its failure is returned. The middleware reads the declaration from the command the engine runs, never from its name, and a call whose declaration it cannot read (the middleware called directly, outside the engine) counts as a mutation. To restore the old behaviour, pass `retryMutations: true`, and only when every mutation it wraps is safe to repeat.
