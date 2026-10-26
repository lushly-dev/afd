---
"@lushly-dev/afd-client": minor
---

`DirectClient` handles `APPROVAL_REQUIRED` with an `onApprovalNeeded` hook (#419). On `true`, the client retries the same call once with `context.approval` set to the result's `details.approvalToken`; on `false`, a hook error or without a hook, it returns the original result unchanged. `pipe()` asks when each gated step is reached. `context.timeout` bounds each attempt, the hook receives the call's `signal`, and a token that expires during the wait returns the retry's `APPROVAL_REQUIRED` (`reason: 'expired'`) without a second retry. New types: `DirectApprovalHook`, `DirectApprovalRequest`.
