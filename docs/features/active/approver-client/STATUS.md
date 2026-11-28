# Approver client: status

| Field | Value |
| --- | --- |
| Proposal | [approver-client.proposal.md](./approver-client.proposal.md) |
| Spec | [`spec/approvals.md`](../../../../spec/approvals.md#approval-evidence-from-an-approver-client), "Approval evidence from an approver client" and "Approval display" |
| Origin | Loam phase 5, step 0c ([specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md), 7.2 and 12; D146, D150) |
| Last verified | 2026-11-28, against `main` plus [#1466](https://github.com/lushly-dev/afd/issues/1466) |

## Done

- **Spec, TypeScript and Rust,** in [#1475](https://github.com/lushly-dev/afd/pull/1475): the subsection and the display rules in `spec/command-metadata.md`; `createMcpServer({ approver })` and `AFD_APPROVAL_META_KEY` in `@lushly-dev/afd-server`; `approvalDisplay` and its names in `@lushly-dev/afd-core`; `McpServer::with_approver`, `afd::server::AFD_APPROVAL_META_KEY` and `afd::approval_display` in the `afd` crate.
- **Python and C++ parity,** in [#1466](https://github.com/lushly-dev/afd/issues/1466): `create_server(approver=...)`, `AFD_APPROVAL_META_KEY`, off-object carrier and `approval_display` (`afd` / `afd.core`) in Python; `StdioServerOptions::approver`, `afd::mcp::approval_meta_key`, `CommandContext::credentials` (`PrincipalCredentials`) and `afd::approval_display` (`afd/approval_display.hpp`) in C++.
- **Vectors:** [`spec/vectors/approver-client.json`](../../../../spec/vectors/approver-client.json), 87 display and 9 carrier cases. All four languages run every case with `gaps: {}`; Alfred name-gap budgets lowered (Python 10 → 5, C++ 75 → 70).

## Not done

- **Loam's part** (`approvals = "shell"`, the preview, the hold, the token kept in the kernel's memory): Loam phase 5, step 5.
- **The approval link store** ("approve by link"): Loam's milestone C amendment (D150).
