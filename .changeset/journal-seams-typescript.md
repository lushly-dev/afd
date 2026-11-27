---
"@lushly-dev/afd-core": minor
"@lushly-dev/afd-server": minor
"@lushly-dev/afd-client": minor
---

A host can now key a record of its own by the call it describes, and record which approval admitted a held call ([`spec/dispatch.md`](https://github.com/lushly-dev/afd/blob/main/spec/dispatch.md), "The dispatch id", and [`spec/command-metadata.md`](https://github.com/lushly-dev/afd/blob/main/spec/command-metadata.md), "The approval summary").

- **`context.dispatchId`.** `createMcpServer`, `createDirectRegistry` and the core registry give every call an id: 128 random bits from `crypto.getRandomValues`, as 22 characters of unpadded base64url, never taken from the caller. Each batch item, pipeline step and command a handler runs gets its own; a retry inside the middleware chain keeps it. It is a read-only property of the call's context: a write is ignored and it cannot be redefined, so every middleware, including each part of a `composeMiddleware`, and the handler read the same value. An app call's `callGrant` reads the id its handler will. It is not enumerable: results, journal entries and the journal's context digest are byte for byte what they were.
- **`onApprovalAccepted(summary, dispatchId)`** on `createApprovalMiddleware`, called when the step admits a held call (a token, an answer over the MCP relay, a `HumanRelay`'s evidence, or DirectClient's private exchange), before the handler. The new `ApprovalSummary` type carries `via`, `command`, `inputDigest`, `approvalId`, and `issuedAt` and `expiresAt` when the evidence has them; it holds no token, nonce or decision id. The step waits for the hook, and a hook that throws or rejects fails the call with `COMMAND_EXECUTION_ERROR` before the handler runs.
- **`approvalId`** on `onApprovalRequired`'s `ApprovalRequest` and on DirectClient's `DirectApprovalRequest`: the id the call's summary will carry, so the surface that asks a person can keep it beside their answer.

Breaking for one rare case: `dispatchId` is now a reserved context name, as `spec/context-fields.md` requires from the release that sets the id. A declared context field of that name fails at registration (rename the field), and a context value a host put under it is replaced by the engine's (read the host's own value under another name). Code that builds an `ApprovalRequest` itself, such as a test's fake, now supplies `approvalId`. `spec/vectors/journal-seams.json` no longer lists TypeScript as a gap; every case runs.
