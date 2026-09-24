---
'@lushly-dev/afd-server': patch
---

Tool `_meta` now includes `destructive` when a command sets it, so `afd validate --execute` and other clients can skip destructive tools as well as mutations.
