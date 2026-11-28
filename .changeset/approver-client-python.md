---
"afd-python": minor
---

Behaviour change: Python and C++ now implement the approver client carrier and approval display rules (`spec/approvals.md`), leaving `spec/vectors/approver-client.json`'s `gaps` empty (`{}`) across all four languages.

### Added

- **Approver client carrier** ([`spec/approvals.md`](../spec/approvals.md#approval-evidence-from-an-approver-client), [#1466](https://github.com/lushly-dev/afd/issues/1466)): `create_server(approver=...)` (and `ServerConfig.approver`), `AFD_APPROVAL_META_KEY` (`"dev.afd/approval"`) and `ApproverPredicate` exported from `afd.server`. When `approver(context)` returns explicit `True` after `context_hook` on a caller with complete verified credentials, the server suppresses form elicitation and up-front batch/pipe approval, returns a principal-bound (`principal\0`) `details.approvalToken` on hold, and accepts the token back once in `_meta["dev.afd/approval"]` on single-command MCP 2026-07-28 calls (`tools/call` and `afd-call`). Carrying the key on `afd-batch`, `afd-pipe` or MCP 2025 is refused (`APPROVAL_REQUIRED`, `retryable: false`, no recovery), and placing `"dev.afd/approval"` anywhere in tool arguments is refused with `VALIDATION_ERROR` for every caller.
- **Approval display rules** ([`spec/approvals.md`](../spec/approvals.md#approval-display), [#1466](https://github.com/lushly-dev/afd/issues/1466)): `approval_display`, `ApprovalDisplay`, `ApprovalDisplayLimits`, `APPROVAL_DISPLAY_LIMITS`, `ApprovalDisplayRefusal`, `hides_characters` and `is_hidden_code_point` exported from `afd` and `afd.core` (UTF-16 code-unit lengths and canonical UTF-16 key order, iterative traversal, Unicode General Category `M` combining-mark runs). `python/tests/test_approver_client_vectors.py` now runs all 87 display and 9 carrier cases in `spec/vectors/approver-client.json`, and Python has left the file's `gaps`.
