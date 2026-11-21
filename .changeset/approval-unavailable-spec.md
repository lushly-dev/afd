---
"afd-spec": patch
---

[`command-metadata.md`](./command-metadata.md), "Approvals": a declared approval policy now holds
without the approval middleware. A server engine never runs a command whose policy is not
`not-required` unless its approval step admitted that call; each batch item, pipeline step and
command run from inside another command's handler is admitted on its own. Without such a step the
engine answers `APPROVAL_UNAVAILABLE` before the handler runs, not retryable, reading the
declaration alone (a policy function is not evaluated). `APPROVAL_UNAVAILABLE` joins
[`error-codes.md`](./error-codes.md)'s catalog and `vectors/error-codes.json` (50 codes), with its
constant in all four languages. TypeScript enforces it; Python, Rust and C++ define the constant
and their enforcement follows in [#1886](https://github.com/lushly-dev/afd/issues/1886). Additive, so the version stays.
