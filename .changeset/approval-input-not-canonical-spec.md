---
"afd-spec": patch
---

[`command-metadata.md`](./command-metadata.md), "Approvals", and [`error-codes.md`](./error-codes.md):
`APPROVAL_UNAVAILABLE` gains a third `details.reason`, `input-not-canonical`: the approval step's
answer when a call needs approval and its validated input has no canonical JSON form, so no approval
can be bound to it and the person is not asked. A call its policy lets through still runs on such an
input. The admission rule also covers a policy given only to the approval middleware. Additive, so
the version stays.
