---
"afd-spec": patch
---

[`command-metadata.md`](./command-metadata.md) adds app-to-app calls (Loam phase 5 step 0b, D30,
[#884](https://github.com/lushly-dev/afd/issues/884)): `expose.apps`, default `false`, is a
command's declaration that another app may call it; `apps` is an interface a host's trusted code
names for an app's call; and the registry takes a host predicate, `callGrant(command, context)`,
over the caller's grants. A call with the `apps` interface runs only when the command exists, sets
`expose.apps` and the predicate returns `true`; every other one, invalid input included, gets one
fixed `CALL_NOT_GRANTED` refusal before lookup and validation. `CALL_NOT_GRANTED` joins
[`error-codes.md`](./error-codes.md)'s catalog and `vectors/error-codes.json` (49 codes), with its
constant in all four languages, and D4 gains an `apps` row. [`plugin-manifest.md`](./plugin-manifest.md)
adds core version 2, [`plugin-manifest.core.v2.json`](./plugin-manifest.core.v2.json): version 1 with
`expose.apps` defined, defaulting to `false` in every profile; both profiles stay on version 1. New
vector file [`vectors/app-calls.json`](./vectors/app-calls.json), with a documented gap for Python
and C++ ([#1513](https://github.com/lushly-dev/afd/issues/1513)). Additive, so the version stays:
nothing changes for a call that does not name the `apps` interface.
