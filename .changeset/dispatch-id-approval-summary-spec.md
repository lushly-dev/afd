---
"afd-spec": patch
---

The engine gives every dispatch a `dispatchId` on the command context ([`spec/dispatch.md`](https://github.com/lushly-dev/afd/blob/main/spec/dispatch.md), "The dispatch id", I1 to I4): 128 random bits as 22 base64url characters, made by the engine and never taken from the caller, one for each call, batch item, pipeline step and command a handler runs, and unchanged when a middleware runs the inner links again (a retry). It is not stamped on the result, not written to a journal entry and not named in the context digest's `keys`, so results, journals and digests are unchanged. `dispatchId` is a reserved context name ([`spec/context-fields.md`](https://github.com/lushly-dev/afd/blob/main/spec/context-fields.md)): once a language implements the id, a host that declared a context field of that name must rename it, and a context value a host set under it is replaced.

The approval step builds an approval summary when it admits a held call ([`spec/command-metadata.md`](https://github.com/lushly-dev/afd/blob/main/spec/command-metadata.md), "The approval summary"): `via`, the command, the input digest, an `approvalId` derived from the evidence's single-use key, and the issue time and expiry the evidence carries. The middleware's `onApprovalAccepted` option is given the summary and the call's `dispatchId` before the handler runs, and a hook that refuses (a throw, a rejection, an `Err`, an error return) stops the handler. A held call's request carries the `approvalId` its token will have. The summary holds no token, nonce, decision id or credential.

No implementation has either yet. A new vector file, [`spec/vectors/journal-seams.json`](https://github.com/lushly-dev/afd/blob/main/spec/vectors/journal-seams.json), pins both and lists all four languages in its `gaps`; each language loads it and skips every case under its tracking issue.

Behaviour change: none for any implementation. `spec/vectors/approval-tokens.json` is regenerated with two added members on each binding (`inputDigest`, `approvalId`) and a new `approvalIds` section; no existing value changes, and no language checks the new members until it implements the summary.
