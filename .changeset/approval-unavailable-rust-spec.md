---
"afd-spec": patch
---

[`command-metadata.md`](./command-metadata.md), "Approvals": the support table marks Rust's
`CommandRegistry::execute` as holding a declared approval policy without the approval middleware,
so all four languages now enforce `APPROVAL_UNAVAILABLE`
([#1886](https://github.com/lushly-dev/afd/issues/1886)). Additive, so the version stays.
