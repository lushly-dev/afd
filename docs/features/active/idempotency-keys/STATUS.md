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

- **3. TypeScript** ([#2675](https://github.com/lushly-dev/afd/issues/2675)): merged in #2864. Every case of `spec/vectors/idempotency.json` runs in `packages/server/src/idempotency-vectors.test.ts` (the `waits`, `cancels` and `drops` engines' S7 cases skipped as another engine's); the three codes are in the catalog with constants in all four languages; the todo example declares its nine mutations, and `afd validate --surface` reports none undeclared (`missing-idempotency`). A direct registry takes a step built with `createIdempotencyStep`, so `/direct` hosts without it do not bundle it.

- **4. Python, Rust and C++** (#2676, split on 2026-11-27): one issue per language, each planned and independent of the others: Python [#2955](https://github.com/lushly-dev/afd/issues/2955), Rust [#2956](https://github.com/lushly-dev/afd/issues/2956), C++ [#2957](https://github.com/lushly-dev/afd/issues/2957). Not started.

## Follow-ups not yet issues

- The todo example's scenarios have jobs 4 and 8 (`backends/typescript/scenarios/10-*` and `11-*`);
  a keyed repeat joins them once the scenario runner can send `_meta`. The runner change has no
  issue.
- `spec/meta-tools.json`'s `meta` description names `dev.afd/idempotencyKey` only once every
  language accepts it, since every server lists that file; TypeScript accepts it already. Part of
  step 4.
- The default in-memory store sweeps expired keys but has no cap on live ones, so an identified
  caller can fill it with unique keys for `ttlMs`. A `maxEntries` that refuses new reservations
  with a retryable error is a possible follow-up. No issue.

## What future sessions must know

- The engine's deadline sits outside user middleware in all four languages, so the retry
  middleware never sees an engine `TIMEOUT`. It repeats failures a handler returned.
- The engine step is not a middleware: it sits between the approval admission check and the
  handler, so a repeat passes the same gates as the first call (I2).
- A lost reservation answers with the existing `OUTCOME_UNKNOWN`, which `spec/error-codes.md`
  lists as transport-specific and not in the shared catalog. It joins the new `idempotency`
  profile with the first implementation. Do not add a third new code.
- Umbel's and Factory Gateway's keys travel in command input and stay as they are (I5).
- TypeScript's engine keeps a call's chain running after it answers `TIMEOUT` (S7, `continues`):
  the reservation stays live and is settled when the handler returns. The step reads the server's
  clock (`clock` option), never the call's.
- The step is not a middleware: `execution.ts` calls it in the innermost link, after the approval
  admission check, and `command-timeout.ts` reads whether it reserved the key (R3) from the
  engine's admission record. It binds the scope to the principal middleware left (an auth
  middleware may set the actor), and dates the lease from when the call's chain, and its
  deadline, started.
- Every TypeScript engine resolves a key one way, `resolveIdempotencyKey` in
  `@lushly-dev/afd-core/internal/idempotency`: the router, the server engine, the core registry and
  the meta argument, so a nested call from a batch item never trips K2 on its parent's derived
  key.

## How to keep this file

- Edit your own step's line and leave the others alone. Never write which steps are done, next
  or latest in a sentence that every step would rewrite.
- A follow-up that becomes an issue moves to that issue and leaves this file.
- Update "Last verified" only after checking the claims against `main`.
