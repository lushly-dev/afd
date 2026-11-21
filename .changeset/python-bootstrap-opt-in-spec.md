---
"afd-spec": patch
---

[`tool-strategies.md`](./tool-strategies.md) records Python's bootstrap tools as opt-in (parity decision D5, [#542](https://github.com/lushly-dev/afd/issues/542)): `create_server(..., bootstrap=True)` registers `afd-help`, `afd-docs` and `afd-schema`, as TypeScript's `bootstrap: true`, and Python's default `server/discover` instructions now add the bootstrap sentence only then. The implementation table and the vector notes no longer say Python always registers them. The contract itself is unchanged.
