---
"@lushly-dev/afd-server": patch
---

`createJournalMiddleware` appends concurrent calls in the order they finished. Each call's context digest is asynchronous, and it could complete out of order, so two calls that returned together were appended in either order and a replay of the journal could diverge. A call now takes its turn when its command returns, and appends after the call before it.
