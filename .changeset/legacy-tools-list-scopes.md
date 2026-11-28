---
"@lushly-dev/afd-server": patch
---

The legacy lane's `tools/list` refusal on `/message` now sends the same `{ code, suggestion, scopes }` as the modern lane's, so a client of a host's own layer that runs no `preDispatchCheck` still gets the scopes to step up to (#2778).
