---
'@lushly-dev/afd-core': minor
'@lushly-dev/afd-server': minor
---

A declared approval policy now holds without the approval middleware (`spec/command-metadata.md`, "Approvals").

- `@lushly-dev/afd-server`: `createMcpServer` and `createDirectRegistry` run a command whose `approval` is `'required'` or a function only when an approval middleware admitted that call. Without one, the call fails with `APPROVAL_UNAVAILABLE` before the handler runs (not retryable; a policy function is not evaluated). Each batch item, pipeline step and command run from inside another command's handler is checked on its own. A server that declares `approval` on a command and installs no `createApprovalMiddleware` now refuses that command: add the middleware, or set `approval: 'not-required'` where no approval is wanted.
- `createApprovalMiddleware` decides from the policy and `confirmPrompt` of the command each call runs, so a command missing from its `commands` option is held as its policy says. A policy given only in `commands` still holds too: a call is held when either the command's own policy or the listed one holds it. `commands` is now optional.
- One approval runs one handler, on the input approved: the engine takes the admission as it dispatches, so a retry middleware placed after the approval middleware, another command name, or an input changed after the approval answers `APPROVAL_UNAVAILABLE`. Put `createRetryMiddleware` before the approval middleware.
- A `replayJournal` target without the approval middleware now refuses a gated command too. A journal entry does not prove an approval (with `recordFailures: true` it can hold calls that never ran, and replay executes every entry), so replay gated commands against a target with the approval middleware, or pass only the entries recorded as successful to a target that serves them with `approval: 'not-required'`.
- `@lushly-dev/afd-core`: `ErrorCodes.APPROVAL_UNAVAILABLE`, new in the shared catalog.
