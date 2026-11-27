# Approver client: status

| Field | Value |
| --- | --- |
| Proposal | [approver-client.proposal.md](./approver-client.proposal.md) |
| Spec | [`spec/approvals.md`](../../../../spec/approvals.md#approval-evidence-from-an-approver-client), "Approval evidence from an approver client" and "Approval display" |
| Origin | Loam phase 5, step 0c ([specification](../../../../endpoints/loam/docs/phases/5-copilot/spec.md), 7.2 and 12; D146, D150) |
| Last verified | 2026-11-17, against `main` at `247111aa` plus this change |

## Done

- **Spec, TypeScript and Rust,** in [#1475](https://github.com/lushly-dev/afd/pull/1475): the subsection and the display rules in `spec/command-metadata.md`; `createMcpServer({ approver })` and `AFD_APPROVAL_META_KEY` in `@lushly-dev/afd-server`; `approvalDisplay` and its names in `@lushly-dev/afd-core`; `McpServer::with_approver`, `afd::server::AFD_APPROVAL_META_KEY` and `afd::approval_display` in the `afd` crate.
- **Vectors:** [`spec/vectors/approver-client.json`](../../../../spec/vectors/approver-client.json), 87 display and 9 carrier cases. TypeScript and Rust run all of them (Rust's carrier with `server-auth`); Python and C++ load the file and skip every case as the documented gap.

## Not done

- **Python and C++ parity:** [#1466](https://github.com/lushly-dev/afd/issues/1466). Closing it removes the language from the vector file's `gaps` and lowers Alfred's name budgets (Python 93, C++ 76).
- **Loam's part** (`approvals = "shell"`, the preview, the hold, the token kept in the kernel's memory): Loam phase 5, step 5.
- **The approval link store** ("approve by link"): Loam's milestone C amendment (D150).
