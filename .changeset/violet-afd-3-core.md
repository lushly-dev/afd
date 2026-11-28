---
"@lushly-dev/violet-afd": patch
---

`@lushly-dev/violet-afd` now accepts AFD 3 as well as AFD 2: its `@lushly-dev/afd-core` dependency widens from `^2.2.0` to `^2.2.0 || ^3.0.0`, so an application on either major still shares one AFD core with the integration (#2885).
