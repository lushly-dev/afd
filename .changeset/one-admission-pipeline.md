---
"@lushly-dev/afd-server": minor
---

Every lane of an MCP server now admits a call through one pipeline with named stages (`evidence`, `meta`, `principal`, `approver`, `bind`, then the router's `scope`, `resolve`, `allow`, `lookup`, `context`, `host-verified`, `confirm`, `task` and `execute`). The lanes are `/mcp`, stdio in both eras, `/message`, `/rpc`, `/batch` and `/stream`. The HTTP routes now decode as the meta-tools they stand for: `/rpc` and `/stream` as `afd-call`, and `/batch` as `afd-batch`. So the same call gets the same answer on every lane. What changes on the HTTP routes (`/rpc`, `/batch`, `/stream`), each now matching the MCP lanes:

- They check the active context before confirmation, as `spec/dispatch.md` requires. A confirm-gated command outside the session's active context now fails with `COMMAND_NOT_IN_CONTEXT`, not `CONFIRMATION_REQUIRED`. A batch still confirms every step first.
- A caller the `approver` option names is decided as on the 2025-era `/message` lane:
  - its `APPROVAL_REQUIRED` results carry `details.approvalToken`;
  - its `_meta["dev.afd/approval"]` is refused with `APPROVAL_REQUIRED` (`retryable: false`) and nothing runs, where before it was ignored;
  - credentials that cannot be bound fail its call as an internal error.
- `createContext` runs for every call, refused ones included, before the scope, host-verified and confirmation checks. A throwing `createContext` therefore answers a call that would have been refused as an internal error.
- An unknown `Mcp-Session-Id` on `/batch` and `/stream` is answered with HTTP 404 before any refusal, as on `/rpc`.

Smaller changes:

- A `/stream/` path without a command name is HTTP 400.
- On `/message`, `arguments` that are not an object are `INVALID_PARAMS` before the approval-evidence check.
- `/rpc` and `/batch` trace IDs take the router's form (`rpc-<time>-<random>`, `batch-<time>-<random>`).

The server's trusted state for a call is no longer nine private symbols on `CommandContext`. These are the session's context state, the scope view, the approver, the approval relay and up-front approval, the confirmation and human-relay channels, task dispatch and the direct registry's `allow`. They are now one frozen host-state record, which the context carries as a single opaque token. Copies carry it, so a nested call a handler makes with its own context is still decided under the caller's session and authorization. A handler cannot read it, change it or forge it: a token the server did not mint carries no state and refuses every command. As before, a handler that deliberately removes the token from its context makes what amounts to a fresh in-process call.
