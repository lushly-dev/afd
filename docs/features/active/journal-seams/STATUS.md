# Journal seams: status

Epic: [#2677](https://github.com/lushly-dev/afd/issues/2677).

| Field | Value |
| --- | --- |
| Proposal | [journal-seams.proposal.md](./journal-seams.proposal.md) |
| Decisions | J1 to J6, accepted by the owner as recommended on 2026-11-26 ([Decisions](./journal-seams.proposal.md#decisions)). J2 builds the dispatch id and the approval hook now and holds every member of the journal entry and the result ([Approved and held](./journal-seams.proposal.md#approved-and-held)) |
| Last verified | 2026-11-26, against `main` at `fb34d7c0b`: `git grep` finds none of `dispatchId`, `onApprovalAccepted`, `approvalId` or `recordAbandoned` in `spec/`, `packages/` or `python/` |

## Steps

Each step has its own line. A session edits only its own step's line, and marks it merged with
the pull request's number.

- **0. What each language records at a deadline today** ([#2678](https://github.com/lushly-dev/afd/issues/2678)): not started. Needs nothing else here; changes no behaviour.

- **1. Spec and vectors, the dispatch id and the approval hook** ([#2679](https://github.com/lushly-dev/afd/issues/2679)): merged in #2796. `spec/dispatch.md` ("The dispatch id", I1 to I4), `spec/command-metadata.md` ("The approval summary"), `spec/vectors/journal-seams.json` (12 and 12 cases, every language a documented gap) and `approvalId` on each binding of `approval-tokens.json`. Each language has a loader that skips every case.

- **2. TypeScript** ([#2680](https://github.com/lushly-dev/afd/issues/2680)): merged in #2846. `context.dispatchId` from both engines (`packages/core/src/dispatch-id.ts`), `onApprovalAccepted` and `ApprovalSummary` on `createApprovalMiddleware`, `approvalId` on `ApprovalRequest` and DirectClient's `DirectApprovalRequest`. Every `journal-seams.json` case runs; `wire/journal.jsonl` is unchanged.

- **3. Rust** ([#2681](https://github.com/lushly-dev/afd/issues/2681)): merged in #2865. `CommandContext::dispatch_id`, `ApprovalMiddlewareOptions::with_on_approval_accepted` with `ApprovalSummary`, `ApprovalRequest::approval_id`, `DirectApprovalRequest::approval_id` and `afd::approval_id`; every case of `journal-seams.json` runs and Rust has left its `gaps`. Umbel's D208 middleware does not use the id yet. Loam OS M1 consumes it.

- **4. Python and C++** ([#2682](https://github.com/lushly-dev/afd/issues/2682)): not started. Needs step 2, and comes after step 3 (J6).

## Held

Not to be started until the owner decides to build the layered product the entry members are
for (J2).

- **The entry members** ([#2725](https://github.com/lushly-dev/afd/issues/2725)): `ext` and `annotate` (S2), `recordAbandoned` (S4), and the `dispatchIds` stamp on results and entries (S1).

- **The worked example** ([#2683](https://github.com/lushly-dev/afd/issues/2683)): the `pond` example chained by hash. Needs the entry members.

## What future sessions must know

- Umbel's D66 (the journal is fail-open) and D208 (the Loam OS write-ahead record is Umbel's, not
  a change to `spec/journal.md`) stand. Nothing built now adds a member to the entry or the
  result.
- The dispatch id is set by the engine, never taken from the caller and never drawn from
  `context.random`, and its name stays out of the context digest's `keys`. `wire/journal.jsonl`
  must stay byte-identical.
- `onApprovalAccepted` is given the approval summary and the call's `dispatchId`, never a token,
  a nonce or a decision id. The `dispatchId` argument was added while recording J2.
- While the entry members are held, the journal entry carries no `dispatchId`. A host that keys
  its own record by it, as Umbel's D208 middleware may, settles each intent in that record after
  the call returns.

## How to keep this file

- Edit your own step's line and leave the others alone. Never write which steps are done, next
  or latest in a sentence that every step would rewrite.
- A held item moves to "Steps" only on the owner's decision, recorded in the proposal.
- Update "Last verified" only after checking the claims against `main`.
