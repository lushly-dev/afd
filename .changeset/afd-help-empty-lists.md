---
"@lushly-dev/afd-server": patch
---

`afd-help` in the `full` format leaves out `tags` and `examples` when a command declares them as empty lists, as `afd-detail` already does (#1480).
