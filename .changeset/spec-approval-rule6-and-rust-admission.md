---
"afd-spec": patch
---

[`vectors/approval-tokens.json`](./vectors/approval-tokens.json) adds `tokenDelivery` vectors pinning Approvals rule 6 ([`command-metadata.md`](./command-metadata.md#approvals), [#1665](https://github.com/lushly-dev/afd/issues/1665)): MCP calls omit `details.approvalToken` by default unless the server opts in, while non-MCP calls include it unless opted out. All four implementations load and pass them. [`vectors/dispatch.json`](./vectors/dispatch.json) removes Rust's `approvalUnavailable` gap now that all four implementations refuse unadmitted gated commands with `APPROVAL_UNAVAILABLE` ([#1886](https://github.com/lushly-dev/afd/issues/1886)). Additive, so the version stays.

Behaviour change: Rust and Python approval middleware now omit `details.approvalToken` on MCP calls by default unless the server opts in (`with_include_token(true)` / `include_token=True`), matching TypeScript and C++, and Rust aligns MCP relay fallback opt-in with the other implementations.
