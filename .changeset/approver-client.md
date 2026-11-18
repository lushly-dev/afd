---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
---

Approval evidence from an approver client and the approval display rules (`spec/command-metadata.md`; Loam phase 5 step 0c).

- `createMcpServer({ approver })` names trusted MCP clients, such as a shell that shows a person the held action. An approver's `APPROVAL_REQUIRED` results carry `details.approvalToken` whatever `includeToken` says and are never answered with a form; its retry of one command on MCP 2026-07-28 carries the token in `_meta["dev.afd/approval"]` (`AFD_APPROVAL_META_KEY`), taken once by the command the call routes to. On `afd-batch`, `afd-pipe` or a 2025-era request the key fails with `APPROVAL_REQUIRED` before anything runs. A token issued on an approver's call binds its principal binding (actor and credentials), so another client gets `credentials-mismatch`. Any other caller's key is ignored.
- **Behavior change:** a `dev.afd/approval` key anywhere in MCP tool arguments, or in the input of the `/rpc`, `/batch` and `/stream` routes, now fails with `VALIDATION_ERROR` from every caller, where it was stripped or ignored.
- `@lushly-dev/afd-core` adds `approvalDisplay`, `hidesCharacters`, `isHiddenCodePoint` and `APPROVAL_DISPLAY_LIMITS`: whether a person can be shown a held call's input in full (at most 8000 UTF-16 code units of canonical JSON, 400 values, depth 6, strings of 2000 and keys of 200, and no hidden code points or six stacked combining marks), with the refusal named.
