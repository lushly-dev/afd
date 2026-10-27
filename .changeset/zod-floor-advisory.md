---
'@lushly-dev/afd-server': patch
'@lushly-dev/afd-view-state': patch
---

Require `zod` `^4.6.6`, so installs can no longer resolve a Zod affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion while validating oversized constrained collections).
