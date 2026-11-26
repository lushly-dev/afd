# Idempotency keys: status

Epic: [#2672](https://github.com/lushly-dev/afd/issues/2672).

| Field | Value |
| --- | --- |
| Proposal | [idempotency-keys.proposal.md](./idempotency-keys.proposal.md) |
| Decisions | I1 to I9, accepted by the owner as recommended on 2026-11-26 ([Decisions](./idempotency-keys.proposal.md#decisions)) |
| Last verified | 2026-11-26, against `main` at `fb34d7c0b`: `git grep` finds none of `idempotencyKey`, `retryMutations` or `idempotentReplay` in `spec/`, `packages/` or `python/` |

## Steps

Each step has its own line. A session edits only its own step's line, and marks it merged with
the pull request's number.

- **1. The retry fix,** four languages ([#2673](https://github.com/lushly-dev/afd/issues/2673)): claimed on the issue on 2026-11-26, no pull request yet. Needs nothing else here.

- **2. Spec and vectors** ([#2674](https://github.com/lushly-dev/afd/issues/2674)): not started. Needs nothing else here.

- **3. TypeScript** ([#2675](https://github.com/lushly-dev/afd/issues/2675)): not started. Needs step 2.

- **4. Python, Rust and C++** ([#2676](https://github.com/lushly-dev/afd/issues/2676)): not started. Needs step 3. Split per language when it is planned.

## Follow-ups not yet issues

- The todo example's scenarios gain jobs 4 and 8 in step 3, and a keyed repeat once the scenario
  runner can send `_meta`. The runner change has no issue.

## What future sessions must know

- The engine's deadline sits outside user middleware in all four languages, so the retry
  middleware never sees an engine `TIMEOUT`. It repeats failures a handler returned.
- The engine step is not a middleware: it sits between the approval admission check and the
  handler, so a repeat passes the same gates as the first call (I2).
- A lost reservation answers with the existing `OUTCOME_UNKNOWN`, which `spec/error-codes.md`
  lists as transport-specific and not in the shared catalog. Step 2 decides whether it joins the
  new profile. Do not add a third new code.
- Umbel's and Factory Gateway's keys travel in command input and stay as they are (I5).

## How to keep this file

- Edit your own step's line and leave the others alone. Never write which steps are done, next
  or latest in a sentence that every step would rewrite.
- A follow-up that becomes an issue moves to that issue and leaves this file.
- Update "Last verified" only after checking the claims against `main`.
