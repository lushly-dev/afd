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

- **4. Python, Rust and C++** (#2676, split on 2026-11-27): one issue per language, each planned and independent of the others: Python [#2955](https://github.com/lushly-dev/afd/issues/2955), Rust [#2956](https://github.com/lushly-dev/afd/issues/2956), C++ [#2957](https://github.com/lushly-dev/afd/issues/2957). Each language's line below records its pull request.
  - **C++** ([#2957](https://github.com/lushly-dev/afd/issues/2957)): merged in #3051. `CommandRegistryOptions::idempotency` adds the step inside the registry's innermost link, after the approval admission check. C++ waits for a late handler (S7, `waits`), so the step settles from the handler's result before the caller gets `TIMEOUT`. Every case of `spec/vectors/idempotency.json` runs in `packages/cpp/tests/idempotency_vectors_test.cpp` except other engines' S7 cases and the HTTP and task cases, which C++ has no surface for; C++ has left `gaps`. The todo C++ backend declares its nine mutations, and `afd validate --surface`'s rules find none undeclared. R3's recovery is on the `TIMEOUT` of the registry, `DirectClient` and `afd::mcp_stdio`. Not done here, because other languages were still to land: the last-lander items (`spec/meta-tools.json`'s `meta` description, `spec/context-fields.md`'s "once every language accepts it"), done in #3060.

  - **Rust** ([#2956](https://github.com/lushly-dev/afd/issues/2956)): merged in #3058. `tests/idempotency_vectors.rs` runs every case but the other engines' three S7 cases, and Rust left the vectors' `gaps`. The step is `CommandRegistry::set_idempotency`, in the innermost link after the approval admission check, with no feature needed. The engine drops a call at its deadline (S7, `drops`). The todo backend declares its nine mutations, and `todo-create-batch`, which may run as a task, keys repeats in its handler.

  - **Python** ([#2955](https://github.com/lushly-dev/afd/issues/2955)): merged in #3060. Every case of `spec/vectors/idempotency.json` runs in `python/tests/test_idempotency_vectors.py` (the `continues`, `waits` and `drops` engines' S7 cases skipped as another engine's), and Python has left the file's `gaps`; `python/tests/test_idempotency_engine.py` has the proposal's exit criteria. The todo Python backend declares its nine mutations and serves the step, and its `tests/test_surface.py` finds none undeclared. As the last of the three, it also names `dev.afd/idempotencyKey` in `spec/meta-tools.json`'s `meta` description (and in each language's copy), empties the vectors' `gaps`, and states the shared spec text for all four languages.

## Follow-ups not yet issues

- The todo example's scenarios have jobs 4 and 8 (`backends/typescript/scenarios/10-*` and `11-*`);
  a keyed repeat joins them once the scenario runner can send `_meta`. The runner change has no
  issue.
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

- Python's step is `afd.server.idempotency_step`, called from `run_handler` in
  `afd.core.single_executor` after `check_admission`; the retry middleware and the deadline read
  the command's `idempotency`, whether the call has a key and whether the step reserved it from
  the executor's `RunningCommand` entry. Python's engine cancels the handler at the deadline
  (S7, `cancels`): the step catches the `CancelledError` and settles the reservation as unknown,
  synchronously for the default store. An `async` store's `reserve` runs under
  `asyncio.shield`, and a reservation made after the call was cancelled is released.
- Python tells anonymous stdio connections apart by wrapping each connection's read stream in
  `Server.run` (`afd.server.sdk_internals.READ_STREAM_CONTEXT`, with a guard test). The MCP SDK's
  in-process `Client(server)` in its default 2026-07-28 mode has no connection at all (a direct
  dispatcher, no streams), so there an anonymous keyed call cannot be told apart and the step
  refuses it with `UNAUTHORIZED`; tests that need a connection use
  `Client(InMemoryTransport(server))`.

- Rust keeps the key's marks (delivered, set by the engine) and the step's call in crate-private
  `CommandContext` fields that `CallState` restores at every link, so a middleware cannot change
  the key or drop the step. The pipeline executor passes each step's `stepIndex` in its context
  map, which the MCP server's `afd-pipe` reads to derive `<key>:step:<i>`. Struct literals of
  `JournalRecord` in Umbel and Loam's mail engine name the new `idempotency_key` field.

- C++'s step runs in `CommandRegistry::run_chain`'s innermost link (`detail::run_idempotency_step`,
  `packages/cpp/src/idempotency.cpp`). The retry middleware reads `mutation`, `idempotency` and
  whether the call carries a key from the registry's per-call admission record
  (`detail::live_repeat_declaration`). The surface that owns a call's deadline (the registry,
  `DirectClient`, `afd::mcp_stdio`) hands the registry a `detail::IdempotencyNote` and reads from
  it whether the step reserved the key (R3). On stdio, a call that, as middleware left it, has no
  credentials and no actor but a bare agent (no id or `onBehalfOf`) is scoped to its connection
  (S3).

## How to keep this file

- Edit your own step's line and leave the others alone. Never write which steps are done, next
  or latest in a sentence that every step would rewrite.
- A follow-up that becomes an issue moves to that issue and leaves this file.
- Update "Last verified" only after checking the claims against `main`.
