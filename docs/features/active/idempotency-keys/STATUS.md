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

- **1. The retry fix,** four languages ([#2673](https://github.com/lushly-dev/afd/issues/2673)): merged in #2794: the retry middleware does not repeat a command with `mutation: true` unless the host sets `retryMutations`.

- **2. Spec and vectors** ([#2674](https://github.com/lushly-dev/afd/issues/2674)): merged in #2803. [`spec/idempotency.md`](../../../../spec/idempotency.md) (D1 to D5, K1 to K6, S1 to S13, R1 to R4), pointers in seven other spec pages, `metadata.idempotentReplay` in the result schema, and `spec/vectors/idempotency.json` (88 cases in nine sections, every language a documented gap). Each language has a loader that skips every case.

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
  lists as transport-specific and not in the shared catalog. It joins the new `idempotency`
  profile with the first implementation. Do not add a third new code.
- Umbel's and Factory Gateway's keys travel in command input and stay as they are (I5).
- Three things the spec leaves for the first implementation, because tests pin them to what the
  code does today: the two new codes' entries in `spec/vectors/error-codes.json` with their
  constants in all four languages (the rule in `spec/error-codes.md`, "Specified, not yet in the
  catalog"), the key in `spec/meta-tools.json`'s `meta` argument, and the rows of
  `spec/recovery.md`'s engine table.

## How to keep this file

- Edit your own step's line and leave the others alone. Never write which steps are done, next
  or latest in a sentence that every step would rewrite.
- A follow-up that becomes an issue moves to that issue and leaves this file.
- Update "Last verified" only after checking the claims against `main`.
