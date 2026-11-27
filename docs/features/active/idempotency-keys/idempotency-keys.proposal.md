# Idempotency keys: a mutation a caller can safely send twice

Epic: [#2672](https://github.com/lushly-dev/afd/issues/2672).

> **Goal**: A caller that does not know whether its change was applied can send it again with
> the same key and never have it applied twice, and nothing in AFD repeats a mutation that has
> not been declared safe to repeat.

| Field | Value |
|---|---|
| Status | Approved 2026-11-26: the owner accepted decisions I1 to I9 as recommended. TypeScript merged in #2864; progress is in [STATUS.md](./STATUS.md). |
| Author | jasfalk (drafted with Claude) |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `packages/cli`, `python/`, `packages/rust`, `packages/cpp` |
| Related | [`spec/execution-controls.md`](../../../../spec/execution-controls.md), [`spec/error-codes.md`](../../../../spec/error-codes.md), [`spec/recovery.md`](../../../../spec/recovery.md), [authorization, M8](../../../../spec/authorization.md#m8-the-principal-binding), [Factory Gateway](../factory-gateway/factory-gateway.proposal.md), [journal seams](../journal-seams/journal-seams.proposal.md) |

## Why

An agent's most common failure with a write is not knowing whether it happened. AFD says so
itself and then leaves the caller alone with it:

- `TIMEOUT` is `retryable: true`, and its catalog entry ends "The command may still have run"
  ([error codes](../../../../spec/error-codes.md)).
- Its suggestion is prose: "check its effect before retrying a mutation"
  (`packages/server/src/command-timeout.ts`). No structured recovery can say how.
- A client that loses its connection gets `OUTCOME_UNKNOWN`, which is not retryable, for any
  call "not positively marked read-only". It has no way to ask again safely.
- The retry middleware does not check what it repeats. Its default predicate retries
  `TRANSIENT_ERROR` and `TIMEOUT` for any command, in all four languages
  (`packages/server/src/middleware.ts`, `python/src/afd/server/middleware.py`,
  `packages/rust/src/middleware.rs`, `packages/cpp/src/middleware.cpp`). The engine's own
  deadline sits outside the middleware, so the middleware never sees that timeout. What it
  repeats is a failure the handler returned, such as a downstream request that timed out after
  the write went through. A server that installs it can apply one request twice.
- The MCP annotation that would tell a client is never set: "`idempotentHint` and
  `openWorldHint` are not derived" ([command metadata](../../../../spec/command-metadata.md#annotations)).

Applications answer it one at a time, each with its own spelling:

- Factory Gateway gave two of its commands a `dedupe_key` input and wrote a job for it, "never
  file the same issue or post the same comment twice"
  ([scenario 09](../factory-gateway/scenarios/09-never-file-or-say-it-twice.scenario.yaml)).
- Umbel's `knowledge-propose` takes a required `idempotency_key` input and refuses a reused one
  with `PROPOSAL_KEY_REUSED` (`endpoints/umbel/docs/phases/2-knowledge/spec.md`), and its
  curator carries keys of its own.

No client, retry step or agent can use a convention it cannot see. The question came up while
assessing an ERP built as a separate project on AFD, where a double-posted entry is a wrong
ledger. The need is not specific to that: it is any write an agent may repeat.

## Jobs

The feature adds no commands. Its jobs are stated here and checked by shared vectors, not by
scenario files: a scenario step has no key for `_meta` (`packages/testing/src/parsers/yaml.ts`)
and cannot run two calls at once or stop a process mid-call, and jobs 1 to 3 and 5 to 7 each
need one of those ([jobs first](../../../../.claude/skills/afd/references/jobs-first.md#what-a-scenario-cannot-express)
says to state such a limit and keep the job). Jobs 4 and 8 can be scenario steps, and phase 3
adds them to the todo example's scenarios, with a keyed repeat once the runner can send a key.

1. **Send it again safely.** When my call to a mutation times out, I want to send the same call
   with the same key and never have the change applied a second time, so that a retry is safe.
2. **Be told about a reused key.** When I reuse a key with a different input, I want to be
   refused, so that I never believe a second change was made when it was not.
3. **Not race myself.** When two copies of one call arrive together, I want one to run and the
   other to be told to wait, so that a slow first attempt and its retry cannot both apply.
4. **Know before I call.** When I plan a retry, I want the command's metadata to say whether a
   repeat is safe, so that I do not have to read a description to find out.
5. **Never be repeated behind my back.** When a server retries for me, I want it never to repeat
   a mutation that is not declared safe, so that installing a retry step cannot corrupt data.
6. **Be told when nobody knows.** When the process died between the change and its record, I
   want to be told the outcome is unknown, so that I check instead of a silent second run. This
   holds only with a store that survives the process.
7. **Own the guarantee.** When my handler writes to a database, I want the key in my hands, so
   that I can commit it with my write and have a guarantee no engine step can give.
8. **Stay quiet.** When a call carries no key and its command declares nothing, I want it to
   behave as today, apart from job 5.

## Proposal

### 1. The command says whether a repeat is safe

A command gains `idempotency`:

| Value | Meaning | Who may repeat it |
|---|---|---|
| `natural` | Repeating the call leaves the same state: a set, a delete by id | Anyone, with or without a key |
| `keyed` | Repeating is safe only with a key | A caller that sends one |
| unset | Nothing is claimed | Nobody automatically, when the command is `mutation: true` |

A declared `natural` sets the MCP tool annotation `idempotentHint: true`. Nothing else does: the
annotation rule reports "only from a field the command sets, never from a default", so an unset
field claims nothing. The field is reported in `_meta` and `afd-detail`, and
`afd validate --surface` notes a `mutation: true` command that declares neither value.

A command that changes state without declaring `mutation: true` is invisible to this feature, as
it is to every other planning signal. Python, Rust and C++ cannot tell an unset `mutation` from
`false`, so the rule cannot be stricter than the flag (I7).

### 2. The key

A caller sends the key in `_meta["dev.afd/idempotencyKey"]`: 1 to 200 characters from
`A-Z a-z 0-9 . _ ~ -`. The meta-tools accept it in their `meta` argument, as they accept declared
context fields, and in-process callers set `idempotencyKey` on the call context, where it is a
reserved name. It is never read from a command's input or an HTTP header.

In a batch or pipeline the request's key is the base: item `i` runs under `<key>:<i>` and step
`i` under `<key>:step:<i>`. A caller's key cannot contain `:`, so a derived key never collides
with one a caller chose, and it stays within 255 characters.

A key is scoped to the caller's [principal binding](../../../../spec/authorization.md#m8-the-principal-binding)
and the command. One key used on two commands is two keys.

### 3. Two tiers

**The handler's tier.** The engine validates the key and puts it on the context. A handler that
writes to a transactional store commits the key with its write and answers a repeat itself. This
is the only tier that can promise the change is applied exactly once, because only the handler
can put the key and the effect in one transaction. AFD's part is to deliver the key the same way
on every surface.

**The engine's tier.** A server or registry option, `idempotency: { store, ttlMs, leaseMs }`, for
handlers that cannot do that. It is an engine step, not a middleware: it sits between the
approval admission check and the handler (stages 9 and 10 of
[dispatch](../../../../spec/dispatch.md)), so everything it stores is a handler's result and a
repeat passes the same authorization, confirmation and approval gates as the first call. The
output-budget check runs on a replayed result as on any other. It acts only on a command
declared `keyed`, on a call that carries a key.

| The store holds, for this caller, command and key | The step |
|---|---|
| Nothing | Reserves the key with a digest of the validated input, runs the handler, and stores the result when it settles |
| A stored result, same input digest | Returns it without running the handler, with `metadata.idempotentReplay: true` |
| A stored result or a reservation, different input digest | Refuses with `IDEMPOTENCY_KEY_REUSED`, not retryable, recovery `stop` |
| A live reservation, same input digest | Refuses with `IDEMPOTENCY_IN_PROGRESS`, retryable, recovery `retry` with `afterMs` |
| A reservation that will never be completed | Refuses with the existing `OUTCOME_UNKNOWN`, not retryable, recovery `external`: the suggestion says to check the effect and then use a new key |

What the step stores when the handler settles:

- A success, and a failure that is not `retryable`: stored.
- A `retryable` failure other than `TIMEOUT`: the reservation is released, so a repeat runs. A
  `keyed` command that returns one promises that nothing was applied.
- `TIMEOUT`, whose catalog meaning is "may still have run", and a handler that throws: the
  reservation is kept as never completed, so a repeat gets `OUTCOME_UNKNOWN`.

A reservation is also never completed when its lease runs out. The lease is the call's
effective deadline plus a margin the option sets (`leaseMs`), so a handler the engine is still
waiting for is never taken for a dead one. It runs out when the process died, or when the
engine abandoned the handler at its deadline and the language dropped the call:

- **Rust** drops the future, and **Python** cancels the task, which the step treats as a throw.
  The reservation is never completed.
- **TypeScript** lets the chain finish, and **C++** waits for it before replacing the result.
  The handler's result is stored, and a repeat is answered from it.

In every case a repeat applies nothing: it gets the first result, `IDEMPOTENCY_IN_PROGRESS` or
`OUTCOME_UNKNOWN`.

This is the honest limit of the tier. When the effect and the record are not one transaction,
the engine cannot know which happened, and it refuses rather than guess (I3).

**Callers it can tell apart.** A stored result is only as private as the binding that scopes it.
M8 says that over HTTP without credentials "every caller binds alike unless a hook maps each to
its own actor", and a `required` task fails there for that reason. The engine's tier follows the
same rule: where the server cannot tell its callers apart, a call that carries a key to a
`keyed` command is refused with `UNAUTHORIZED` before anything runs, as a `required` task is,
unless the host declares that its hook identifies every caller.

The store is an interface, like the approval nonce store: `reserve`, `complete`, `release` and
`get`, each atomic. The default is in memory and per process, and its documentation says that
it does not survive a restart, so job 6 needs a store the host supplies.

### 4. Retry is safe by default

The retry middleware repeats a failed call only when the command is not `mutation: true`, or is
`natural`, or is `keyed` and the call carries a key. Otherwise it returns the failure. A host
that knows better passes `retryMutations: true`.

The first half of this ships on its own, ahead of everything else here: until `idempotency`
exists, the middleware stops repeating any command with `mutation: true`
([#2673](https://github.com/lushly-dev/afd/issues/2673)). That default change ships in a minor
release, as a fix (I6).

### 5. What callers see

- A `TIMEOUT` on a `keyed` call that carried a key gains `recovery: { "kind": "retry" }`, and a
  follower resends the key with the same input. On any other mutation it keeps today's prose
  and gets no recovery.
- A client that would report `OUTCOME_UNKNOWN` after a lost connection may instead repeat a call
  to a `natural` command, or a `keyed` one it sent a key with.
- `afd call` takes `--idempotency-key`, and DirectClient's `call` an `idempotencyKey` option. A
  client-side retry sends the same key.
- The journal entry records the key in an optional `idempotencyKey` member, on the allowlist
  beside `traceId` and restored on replay as it is. A replayed result is an ordinary entry, and
  it replays as `same` because the replaying store is rebuilt in order.

## What stays out

- **Exactly-once from the engine.** Stated above: only the handler's tier can promise it.
- **Optimistic concurrency** (`expectedVersion`). `CONFLICT` is already in the catalog; a
  convention for stale writes is a separate proposal if a second consumer asks.
- **Tasks.** A call that becomes an MCP task is not deduplicated in the first version; the task
  id already lets the caller find it.
- **A durable store.** The host's, as with nonces.
- **Migrating Factory Gateway's and Umbel's keys.** Both take a key as command input, and both
  use it for more than deduplication (Factory Gateway to choose what it writes into GitHub,
  Umbel to derive a proposal's id). They coexist with the standard key and may adopt it later
  (I5).

## Spec changes (first pull request)

As merged, three items below moved to the first implementation, because tests pin each file to
what the code does today: the new codes' entries in `spec/vectors/error-codes.json` (the rule in
`spec/error-codes.md`, "Specified, not yet in the catalog"), the `meta` key in
`spec/meta-tools.json`, and the rows of `spec/recovery.md`'s engine table. The spec pages name
all three.

The review of the spec added rules this proposal did not have, none of which changes a decision
below. [`spec/idempotency.md`](../../../../spec/idempotency.md) is the source for each:

- A nested call starts without the key (K6), and `null` is no key (K2).
- The step compares the declared context fields with the input (S4), so one key under another
  scope is another call.
- A command whose handler decides who may call it keeps the promise in its handler (D5).
- A reservation has an identity, so a late handler cannot settle a key that was reserved again,
  and `ttlMs` must exceed the default deadline plus `leaseMs` (S5, S8).
- A caller the server cannot tell apart is refused before any confirmation or approval, and
  anonymous stdio connections never share a store (S3).
- The `TIMEOUT` recovery is given only where the step acted on the call (R3), and a client repeats
  a `keyed` call by itself only where its application told it to (R4).
- A task run is treated as carrying no key (S11), so a command that may run as a task answers
  repeats in its handler (D5).
- The retry rule is an order: `natural` first, then `keyed`, then `mutation` (R1). Section 4
  below reads otherwise for a `keyed` command that does not declare `mutation`; the spec's order
  holds.
- A replayed result replays as `same` from a journal only where the store's history is rebuilt
  (The journal), which narrows section 5's sentence.
- The engine checks cancellation again after it reserves a key (S5); the replay marker is the
  engine's and is never `false` (S9); and a host with several processes shares the store or
  leaves the step off (S13).

- `spec/command-metadata.md`: the `idempotency` field, its surfaces and the `idempotentHint`
  rule in Annotations.
- A new `spec/idempotency.md`: the key and its characters, its scope, the derived keys, the
  table above, what is stored, what each language does with an abandoned handler, the
  callers-apart rule, the store's contract and the two tiers.
- `spec/error-codes.md` and `spec/vectors/error-codes.json`: `IDEMPOTENCY_KEY_REUSED` and
  `IDEMPOTENCY_IN_PROGRESS` in a new `idempotency` profile, and `OUTCOME_UNKNOWN`'s entry
  extended to the lost reservation. `OUTCOME_UNKNOWN` is a transport-specific code today, not in
  the shared catalog, so the spec pull request also decides whether it joins the profile or
  stays where it is with the engine step named as a sender.
- `spec/recovery.md`, engine table: the two new codes, `OUTCOME_UNKNOWN` from this step, and
  the conditional `retry` on `TIMEOUT`. `spec/execution-controls.md`: the expiry rule gains it.
- `spec/context-fields.md` and `spec/meta-tools.json`: `idempotencyKey` joins the reserved
  names, and its `_meta` key joins the keys `meta` accepts.
- `spec/dispatch.md`: the step between stages 9 and 10.
- `spec/journal.md`: the `idempotencyKey` member, on the allowlist and in the context digest by
  the rule `context` follows (absent, the hash is unchanged).
- `spec/schema/result.json`: `metadata.idempotentReplay`.
- `spec/vectors/idempotency.json`: every row of the table, the storing rules, the scoping
  rules, and the retry middleware's decision for each combination of `mutation`, `idempotency`
  and key.

## Phases

| # | Phase | Exit |
|---|---|---|
| 1 | The retry fix, in four languages ([#2673](https://github.com/lushly-dev/afd/issues/2673)) | A shared vector shows a `mutation: true` command is not repeated without the option |
| 2 | Spec and vectors ([#2674](https://github.com/lushly-dev/afd/issues/2674)) | The spec changes above are merged and the vector file loads in every language's suite, each case skipped with its tracking issue |
| 3 | TypeScript ([#2675](https://github.com/lushly-dev/afd/issues/2675)): metadata, key delivery, the engine step and in-memory store, the retry rule, the CLI flag and DirectClient option, and the todo example's nine mutations each declared `natural` or `keyed` | Every vector passes in TypeScript; `afd validate --surface` on the todo example reports no undeclared mutation |
| 4 | Python, Rust and C++ ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Every vector passes in each, and the parity page shows no gap |

## Decisions

Decided by the owner on 2026-11-26, each as recommended.

| # | Question | Decision |
|---|---|---|
| I1 | One field with `natural` and `keyed`, or a boolean? | The two values. An agent plans differently for "repeat freely" and "repeat only with a key", and only the first maps to `idempotentHint`. |
| I2 | An engine step after the approval check, so a repeat is approved again, or an outer step, so a repeat skips the gates? | After the check. A repeat that skips authorization is a way to read a result without holding the rights to produce it. The cost is a second approval after a timed-out approved call. |
| I3 | After a reservation that will never complete: refuse (at most once) or run again (at least once)? | Refuse. A caller can recover from "unknown, go and check"; it cannot recover from a silent second payment. |
| I4 | Does a `keyed` command require a key? | No. Without one it runs as today and nothing retries it. A host that wants to require it can refuse in its own middleware. |
| I5 | The key travels in `_meta`, never in a command's input. Umbel and Factory Gateway take theirs as input. Coexist, or migrate them? | Coexist. `_meta` is what lets a client and a retry step send a key without knowing the command; their input keys also carry meaning of their own. |
| I6 | Does the retry fix, a changed default in a published package, ship in a minor release? | Yes, as a fix with a changelog line naming the change and `retryMutations: true`. The old default contradicts the catalog's "may still have run". |
| I7 | A mutation that does not declare `mutation: true` is still retried. Accept that? | Yes. Three of the four languages cannot tell unset from `false`, and `afd validate --surface` is where an undeclared mutation is caught. |
| I8 | A new `idempotency` error-code profile, or the core catalog? | A profile, as approvals and tasks have, since the engine's tier is optional. |
| I9 | Does the key go on the journal entry as a named member, or in [journal seams](../journal-seams/journal-seams.proposal.md)' `ext`? | A named member: AFD defines the key, and replay must restore it. This does not depend on that proposal. |

## Exit criteria

- Every case in `vectors/idempotency.json` passes in all four languages.
- A handler that applies its effect and then outlives the engine's deadline: a repeat with the
  same key applies nothing, in every language. It gets the first result,
  `IDEMPOTENCY_IN_PROGRESS` or `OUTCOME_UNKNOWN`.
- With the retry middleware installed and a handler that returns `TIMEOUT` after its effect, the
  effect of a `mutation: true` command that is `keyed` or declares nothing is applied once, with
  a key and without. A `natural` command is repeated by design.
- `afd validate --surface` on the todo example reports no undeclared mutation.
