---
'@lushly-dev/afd-view-state': patch
---

Fix the persistence flush race. Flushes are now single-flight: each is chained after the previous one, so writes never overlap and the last state scheduled is the last one written, whatever order the network completes requests in; a flush requested during another runs afterwards for the state that changed meanwhile. `destroy()` and `flush()` wait for in-flight writes. A failed update falls back to create only when the record does not exist (an HTTP 404, a 404 `status`, a `*NOT_FOUND` code, or `adapter.get()` returning null), instead of on any error.
