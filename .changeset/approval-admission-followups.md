---
'@lushly-dev/afd-server': patch
---

One approval runs one handler, on the input approved, in more cases.

- A policy given only in `createApprovalMiddleware`'s `commands` option is now held to the same rule as a command's own policy: a retry middleware placed after the approval middleware, or an input changed after the approval, answers `APPROVAL_UNAVAILABLE` with `details.reason: 'admission-mismatch'` instead of running the handler again or on the changed input.
- A gated call whose validated input has no canonical JSON form (a `bigint`, a `Set` or a class instance produced by a transform) answers `APPROVAL_UNAVAILABLE` with `details.reason: 'admission-mismatch'`, also when its policy function returns `'not-required'`, since a change to such an input could not be seen.
- The admission is bound to the canonical input the middleware decided on before awaiting the token check, the nonce store, the relayed or up-front approval or the policy function, so an input changed during that await is refused rather than admitted as changed.
