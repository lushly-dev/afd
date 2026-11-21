---
'@lushly-dev/afd-server': patch
---

One approval runs one handler, on the input approved, in more cases.

- A policy given only in `createApprovalMiddleware`'s `commands` option is now held to the same rule as a command's own policy: a retry middleware placed after the approval middleware, or an input changed after the approval, answers `APPROVAL_UNAVAILABLE` with `details.reason: 'admission-mismatch'` instead of running the handler again or on the changed input.
- A call that needs approval on a validated input with no canonical JSON form (a `bigint`, a `Set` or a class instance produced by a transform) is answered by the approval middleware with `APPROVAL_UNAVAILABLE` and `details.reason: 'input-not-canonical'`, before any token check or relay and without asking the person, for a single call and for an up-front `afd-batch` or `afd-pipe` step. It failed with `COMMAND_EXECUTION_ERROR` before. A call its policy lets through still runs on such an input, compared by identity at dispatch.
- The admission is bound to the canonical input the middleware decided on before awaiting the token check, the nonce store, the relayed or up-front approval or the policy function, so an input changed during that await is refused rather than admitted as changed. An input a policy function changed is refused before anyone is asked, so the person never sees one input while the token binds another.
- An approval middleware that does not gate a command no longer admits it. Behind a second such middleware, an approved call now runs (it was refused as `admission-mismatch`), and each approval step that ever admitted the call must admit it again for each dispatch, so neither can replace or restore the other's, and a retry placed between two of them is refused. An `afd-batch` or `afd-pipe` step whose policy changes its input is refused up front the same way.
- A validated input of `NaN` that its policy lets through now runs; it was refused as not equal to itself.
