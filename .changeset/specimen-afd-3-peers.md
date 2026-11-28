---
"@lushly-dev/specimen-afd": patch
"@lushly-dev/specimen-cli": patch
---

`@lushly-dev/specimen-afd` now accepts AFD 3 and states its real AFD 2 minimum: its `@lushly-dev/afd-core` and `@lushly-dev/afd-server` peers change from `^2.2.0` to `^2.5.0 || ^3.0.0` (#2885). Installing it beside AFD 3.0.0 no longer fails with an unmet peer, and an AFD older than 2.5.0, which lacks the `AFD_OUTPUT_BUDGET_META_KEY` the integration imports, is now refused at install instead of failing at import. `@lushly-dev/specimen-cli` depends on the AFD core and server at the same `^2.5.0 || ^3.0.0`.
