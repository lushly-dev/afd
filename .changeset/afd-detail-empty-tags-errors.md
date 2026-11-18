---
"@lushly-dev/afd-server": patch
---

`afd-detail` leaves out `tags` and `errors` when a command declares them as empty lists, as it already does for `requires`, `examples`, `contexts` and `scopes` (#1420).
