---
'@lushly-dev/afd-server': minor
---

`createRetryMiddleware` now backs off exponentially, as its documentation said, instead of linearly: retry `n` backs off `min(maxDelay, retryDelay * 2 ** (n - 1))`. New options: `maxDelay` caps each backoff (default 5000 ms) and `jitter` (default `true`) randomizes each wait to between half and all of the backoff; pass `jitter: false` for exact waits. The wait now ends when `context.signal` aborts, and the middleware then returns the last failure without retrying, so a disconnected client or an expired batch deadline no longer keeps a command retrying. Invalid options (a negative or fractional `maxRetries`, a negative or NaN `retryDelay`, a negative or infinite `maxDelay`) throw when the middleware is created; a negative `maxRetries` used to skip the command and return `RETRY_EXHAUSTED`, which is no longer produced.
