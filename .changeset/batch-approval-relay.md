---
'@lushly-dev/afd-server': minor
---

With `createApprovalMiddleware({ relay: 'mcp-elicitation' })`, an `afd-batch` or `afd-pipe` from an MCP client that can elicit is now approved up front instead of failing each gated step with `APPROVAL_REQUIRED` (#459). Before any step runs, the server works out every step's validated input and asks once, listing each gated step's summary, command and canonical input (at most 20; more is refused with `reason: 'too-many-approvals'`); on acceptance each gated step runs once on its own approval, bound to the whole request and to its command, input and actor, and every nonce is spent before the first step runs, so a replay runs nothing. A decline runs nothing. A pipeline whose gated step takes its input from `$prev`, `$first` or `$steps` runs nothing and fails with `APPROVAL_REQUIRED`, `details.reason: 'input-not-known'`, `step` and `command`, so the agent can split it there. Clients that cannot elicit keep the step-by-step fallback.
