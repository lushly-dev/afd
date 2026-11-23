---
"afd-spec": patch
---

[`wire/README.md`](./wire/README.md), "Contract": state that `data` on a `CommandResult`, a
pipeline step and a pipeline result is the exception to "unset fields are omitted, never `null`":
`data` set to `null` is sent as `"data": null`, and only `data` never set is omitted, as
TypeScript already sends it. Python now does too (#2073). Clarifies the existing TypeScript
behaviour, so the version stays.
