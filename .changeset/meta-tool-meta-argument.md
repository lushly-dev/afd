---
"@lushly-dev/afd-server": minor
---

Add the meta-tools' `meta` argument (`spec/context-fields.md`, "Clients that cannot set `_meta`", #466). `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover` and `afd-detail` advertise an optional `meta` object whose keys are `dev.afd/context` and the declared context fields' `_meta` keys. The server removes it from the arguments and applies those keys as if the request had sent them in `_meta`, on `/mcp` in both eras, over stdio and on `/message`; other keys are dropped. A key sent both in `_meta` and in `meta` must agree, or the call fails with `VALIDATION_ERROR` naming the key. A direct registry with a tool surface applies it too, with the `activeContext` call option and the declared fields' values on the call context standing for `_meta`.
