---
"afd-spec": patch
---

[`plugin-manifest.md`](./plugin-manifest.md) and both core schemas
([`plugin-manifest.core.v1.json`](./plugin-manifest.core.v1.json),
[`plugin-manifest.core.v2.json`](./plugin-manifest.core.v2.json)) add `"non-human"` to `approval`
on commands and mounted tools (K3, C7, [#1329](https://github.com/lushly-dev/afd/issues/1329)).
`"non-human"` maps to a conditional AFD approval policy that lets a direct `Human` caller run
without holding and holds every other caller (agents, services, scripts, tests, agents acting
`on_behalf_of` a human, and absent actors). Additive, so the contract version stays: existing
manifests and profiles that restrict `approval` (such as Loam's `["none"]`) are unchanged.
