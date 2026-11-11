---
'@lushly-dev/afd-auth': patch
---

`BetterAuthAdapter.refresh()` no longer resolves as if the session was kept when a newer session fetch replaced its own and the provider is unreachable. It waits for the newer fetch and reports that answer.
