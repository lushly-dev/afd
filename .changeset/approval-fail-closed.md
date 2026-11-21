---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
---

A declared approval policy now holds without the approval middleware (`spec/command-metadata.md`, "Approvals").

- `@lushly-dev/afd-server`: `createMcpServer` and `createDirectRegistry` run a command whose `approval` is `'required'` or a function only when an approval middleware admitted that call. Without one, the call fails with `APPROVAL_UNAVAILABLE` before the handler runs (not retryable; a policy function is not evaluated). Each batch item, pipeline step and command run from inside another command's handler is checked on its own. A server that declares `approval` on a command and installs no `createApprovalMiddleware` now refuses that command: add the middleware, or set `approval: 'not-required'` where no approval is wanted.
- `createApprovalMiddleware` decides from the policy and `confirmPrompt` of the command each call runs, so a command missing from its `commands` option is held as its policy says. `commands` is now optional, and is used only when the middleware runs outside `createMcpServer` and `createDirectRegistry`.
- `@lushly-dev/afd-core`: `ErrorCodes.APPROVAL_UNAVAILABLE`, new in the shared catalog.
