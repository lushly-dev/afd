---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-cli": minor
---

Pre-execution approvals (#272): a command can be held for a human's sign-off before its handler runs.

- `@lushly-dev/afd-core`: `CommandDefinition` gains `approval` (`'required'`, `'not-required'` or a function of the validated input and context; `ApprovalPolicy`, `ApprovalDecision`), and `CommandContext` gains `approval`, the approval token. `ErrorCodes.APPROVAL_REQUIRED` joins the shared catalog (45 codes). Tool `_meta` reports `approval` as `'required'`, `'not-required'` or `'conditional'` (a function; `approvalMode()`).
- `@lushly-dev/afd-server`: `defineCommand` accepts `approval` and keeps it through `toCommandDefinition()`; afd-detail and afd-docs report it. New `createApprovalMiddleware({ secret, commands })` returns `APPROVAL_REQUIRED` before the handler when a call needs approval and `context.approval` holds no valid token. `details` carries `approvalToken`, `expiresAt`, `summary` and, for a rejected token, `reason`. Tokens are HMAC-SHA256-signed with an app-supplied secret (required, at least 32 bytes, rotatable), bound to the command, the canonical validated input and the actor, short-lived (5 minutes by default) and single-use by default (`replay: 'within-ttl'` to allow reuse; `nonceStore` for several instances). Options `summarize`, `includeToken`, `onApprovalRequired` and `clock`.
- `@lushly-dev/afd-cli`: `afd validate` warns (`MISSING_APPROVAL_POLICY`) about `mutation` or `destructive` tools, and grouped-tool actions, whose `_meta` declares no approval policy.
