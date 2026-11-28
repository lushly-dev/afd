# Idempotency keys

Profile: `idempotency`. This page belongs to the `idempotency` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. An implementation claims it when a command can declare `idempotency` and its engine can be given the idempotency step.

A caller often cannot tell whether a change it sent was applied: its call timed out, its
connection dropped, or a step in between failed after the write went through. An idempotency key
lets it send the same call again and never have the change applied twice. This page defines the
key, what a command declares about repeats, an optional engine step that answers a repeat from a
store, and the rule that keeps a retry from repeating a change nobody declared safe.

Proposal and status: [`docs/features/active/idempotency-keys/`](../docs/features/active/idempotency-keys/idempotency-keys.proposal.md).
TypeScript ([#2675](https://github.com/lushly-dev/afd/issues/2675)) and C++ ([#2957](https://github.com/lushly-dev/afd/issues/2957)) implement
all of it. Python and Rust are listed in the `gaps` of
[`vectors/idempotency.json`](./vectors/idempotency.json), and [Status](#status) says what each
does.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119.

## What a command declares

A command definition has an optional `idempotency` field
([command metadata](./command-metadata.md#fields)):

| Value | The command promises | Who may repeat a call |
| --- | --- | --- |
| `natural` | Repeating a call leaves the same state as making it once: a set, a delete by id | Anyone, with or without a key |
| `keyed` | Repeating a call that carries the same key and input is safe, because the handler or the [engine's step](#the-engines-step) answers the repeat | A caller that sends a key |
| unset | Nothing | Nobody automatically, when the command declares `mutation: true` |

- **D1. Declared, never derived.** Nothing is read from an unset field. A command without
  `mutation: true` is not thereby `natural`: Python, Rust and C++ cannot tell an unset `mutation`
  from `false`, so no rule here depends on that difference.
- **D2. The annotation.** A command that declares `natural` reports the MCP tool annotation
  `idempotentHint: true`. No other value, and no default, reports the annotation
  ([annotations](./command-metadata.md#annotations)).
- **D3. Surfaces.** The field is reported in the tool's `_meta`, in `afd-detail` and in the `full`
  format of `afd-help`, and omitted when unset.
- **D4. Validation of the surface.** `afd validate --surface` notes a command that declares
  `mutation: true` and no `idempotency`.
- **D5. `keyed` is a promise the surface must keep.** A command declares `keyed` only where its
  handler answers repeats itself or the server has the engine's step. A command whose handler
  decides whether the caller may make the call (by checking the caller's access to a scope it
  claims, for example: [context fields](./context-fields.md#trust)) keeps the promise in its
  handler, or has a middleware make that check: the step returns a stored result without running
  the handler (S5), so it would go on answering after the access was withdrawn. A command that
  may run as a task keeps it in its handler too, since the step does not act on a task run (S11).

## The key

- **K1. Where it travels.** A caller sends the key in `_meta["dev.afd/idempotencyKey"]`. The
  meta-tools accept the same key in their `meta` argument, as they accept a declared context
  field's ([context fields](./context-fields.md#clients-that-cannot-set-_meta)). An in-process
  caller sets `idempotencyKey` on the call's context (`idempotency_key` in Python, Rust and C++),
  a reserved name; `afd call --idempotency-key <key>` and DirectClient's `idempotencyKey` call
  option set it for those callers. A value the host's own code sets wins over one from `_meta`,
  as for a declared field. The key is never read from a command's input or from an HTTP header.
  A client that retries a call itself sends the same key again.
- **K2. Its form.** A key a caller sends, on any of K1's carriers, is 1 to 200 characters, each
  one of `A-Z a-z 0-9 . _ ~ -`. `null` is no key, as it is no value for a declared field. Any
  other value fails the call with `VALIDATION_ERROR` before any confirmation, middleware or
  handler runs, in the way an invalid declared context field does: the error's details name the `_meta` key, and its
  suggestion gives the form. A key the engine derives (K4), or a replayer restores from a journal
  entry, is not a caller's and is set as it is.
- **K3. Every call gets it.** A valid key is put on the context of the call whatever the command
  declares, so a handler can use it ([the handler's tier](#two-tiers)). A command that has no use
  for it ignores it.
- **K4. Derived keys.** In an `afd-batch` or `afd-pipe` request the request's key is a base. The
  item at 0-based index `i` runs under `<key>:<i>`, and the step at 0-based index `i` under
  `<key>:step:<i>`. A caller's key cannot contain `:`, so a derived key never equals one a caller
  chose, and it stays within 255 characters.
- **K5. Its scope.** A key means something only together with the caller and the command: the
  scope is the call's [principal binding](./authorization.md#m8-the-principal-binding), the
  command's name and the key. The same key from another principal, or on another command, is
  another key.
- **K6. A nested call starts without one.** A command a handler runs through the registry does
  not inherit the key the engine delivered to that handler, also where the two calls share one
  context object. A handler that wants a nested call keyed sets a key of its own on that call,
  which K2 checks as a caller's.

## Two tiers

**The handler's tier.** The engine validates the key and delivers it (K1 to K6). A handler that
writes to a transactional store commits the key with its write and answers a repeat itself. Only
this tier can promise that a change is applied exactly once, because only the handler can put the
key and the effect in one transaction. A command that works this way declares `keyed` and needs
nothing below.

**The engine's tier.** A server or registry may be given an idempotency step for handlers that
cannot do that. It promises less, and says so: a repeat that reaches the same store within the
time the store remembers (S8) is never applied a second time, and where nobody can know whether
the first attempt was applied, the caller is told that instead of being given a guess.

## The engine's step

The step is an option of the server or registry (`idempotency`, with `store`, `ttlMs` and
`leaseMs`), not a middleware.

- **S1. Where it sits.** It runs between the approval admission check and the handler (stages 9
  and 10 of [dispatch](./dispatch.md)). A repeat therefore passes the same exposure, context,
  confirmation, validation, scope, middleware and approval checks as the first call, and
  everything the step stores is a handler's result. A check the handler itself makes is not among
  them (D5). The output-budget check and metadata stamping (stages 11 and 12) run on a result the
  step returns as on any other.
- **S2. When it acts.** Only on a call that carries a key to a command that declares `keyed`, and
  that does not run as a task (S11). Any other call runs as if the step were absent.
- **S3. Callers it can tell apart.** A stored result is only as private as the principal binding
  that scopes it ([M8](./authorization.md#m8-the-principal-binding)). For a call the step would
  act on:
  - The engine validates the key first (K2), so a malformed key is `VALIDATION_ERROR` here too.
  - Over HTTP, on a server that cannot tell its callers apart, the call fails with `UNAUTHORIZED`
    (`retryable: false`) before any confirmation, middleware or approval step runs, as a
    `required` [task](./tasks.md) does there. The host lifts this the way it
    does for tasks, by declaring that its per-request hook identifies every caller.
  - Credentials that M8 cannot bind (an issuer, subject or client id missing or empty) fail the
    call the same way a task fails there, as an internal error whose message names no one. They
    are never taken as no credentials.
  - Where callers are told apart only by their connection (stdio) and the call has neither an
    actor nor credentials, the step keeps the key in a store of that connection's own, never in
    one shared with other connections.
- **S4. What is compared.** The step identifies a call by the unpadded base64url SHA-256 of the
  canonical JSON (rule 3 of [Approvals](./approvals.md)) of
  `{ "context": <fields>, "input": <the validated input> }`, where `<fields>` holds each
  [declared context field](./context-fields.md) the call carries, by name. A call under another
  workspace or scope is therefore another call, and a repeat carries the same values: a host
  whose declared fields change with every attempt (an agent's turn number, say) cannot use the
  step for those calls. A value with no canonical form cannot be
  compared, so such a call fails with `VALIDATION_ERROR` before the handler, its details naming
  the `_meta` key and `reason: "input-not-canonical"`.
- **S5. What the step does**, by what the store holds for the call's scope (K5):

  | The store holds | The step |
  | --- | --- |
  | Nothing | Reserves the key with the call's digest (S4), runs the handler, and settles the reservation when the handler returns (S6) |
  | A stored result, same digest | Returns it without running the handler, with `metadata.idempotentReplay: true` (S9) |
  | A stored result or a reservation, another digest | Fails with `IDEMPOTENCY_KEY_REUSED` |
  | A live reservation, same digest | Fails with `IDEMPOTENCY_IN_PROGRESS` |
  | A reservation that was never settled (S6, S7), same digest | Fails with `OUTCOME_UNKNOWN` |

  A reservation is made atomically: of two calls with the same scope that find nothing, exactly
  one reserves and runs. Each reservation has an identity of its own, and settling or releasing
  acts only on the reservation it was made for (S12).

  Once it holds the reservation, and immediately before the handler, the engine makes its
  cancellation check ([execution controls](./execution-controls.md#how-cancellation-reaches-a-handler)).
  A call cancelled or past its deadline by then releases the reservation and gets the result it
  would have got without the step: the handler never ran, so nothing is stored. An engine that
  cannot release there, because the call was dropped or cancelled while it awaited the store,
  leaves a reservation nothing will settle, which S7 covers.
- **S6. Settling.** When the handler returns:
  - a success, or a failure that is not `retryable`, is stored;
  - a `retryable` failure other than `TIMEOUT` releases the reservation, so a repeat runs. A
    `keyed` command that returns one promises that nothing was applied;
  - `TIMEOUT`, which means the work "may still have run" ([error codes](./error-codes.md)), and a
    handler that throws, mark the reservation as never settled, at once.
- **S7. A handler that outlives the call.** What the reservation becomes depends on what the
  engine does when the call's deadline passes, which differs by language
  ([execution controls](./execution-controls.md)):

  | The engine | The reservation |
  | --- | --- |
  | Keeps the call's chain running after it answers `TIMEOUT` (TypeScript) | Stays live. When the handler returns it is settled as S6 says, however late, unless the key was reserved again in the meantime (S8) |
  | Waits for the handler and then replaces its result with `TIMEOUT` (C++) | Is settled by the handler's own result, as S6 says, before the caller gets `TIMEOUT` |
  | Cancels the handler (Python) | Cancellation counts as a throw: never settled, at once (S6) |
  | Drops the call (Rust) | Hears nothing more. It is live until its lease runs out, and never settled after that |

  A reservation's lease runs out `leaseMs` (default `60000`) after the call's deadline, or after
  the reservation was made where the call has no deadline. Past that, a reservation that is still
  unsettled is treated as never settled, for as long as it stays so. A process that died leaves
  the same thing behind. A host whose handlers run longer than that without a deadline sets
  `leaseMs` to cover them.
- **S8. How long the store remembers.** A stored result, and a reservation that was never
  settled, answer repeats for `ttlMs` (default `86400000`, one day) from the time the key was
  reserved, and so does a reservation still live. After that the key is new whatever the
  record's state, and a late settlement of the old reservation does nothing.
  `ttlMs` **MUST** be greater than the server's default deadline plus `leaseMs`, and a server
  refuses a configuration where it is not: otherwise a key could become new while the engine is
  still waiting for its first handler. A call given a longer deadline of its own, or none, can
  still outlast `ttlMs`; its late settlement then does nothing, and the host that allows such
  calls sets `ttlMs` to cover them. Expiry and leases use the server's clock, never one the
  caller can supply.
- **S9. What is returned.** A replayed result is the stored one, the handler's own metadata keys
  included, with the engine's metadata stamped anew for this call and `idempotentReplay: true`
  added. The member is the engine's: an engine with the step removes a handler-supplied
  `idempotentReplay` from every result, so the first call's result never carries it.
- **S10. Batches and pipelines.** Each item and each step is a call of its own under its derived
  key (K4), so a repeated request replays the items that were stored and runs the ones that were
  not.
- **S11. Tasks.** The step does not act on a call that runs as an MCP task, and such a call is
  treated as carrying no key by R1 and R3: nothing repeats it automatically. Its task id lets the
  caller find it.
- **S12. The store.** The store is an interface the host may supply. `reserve` makes a
  reservation or reports what is held, and returns the reservation's identity; `complete` and
  `release` take that identity and do nothing when the reservation is no longer the scope's;
  `get` reads. Each is atomic. The default keeps everything in memory, for this process only.
- **S13. The limits of the promise.** A repeat is answered only where it reaches the store that
  holds the first call's key: within `ttlMs`, from the same principal, with the same key, input
  and declared context. A restart forgets the default store's keys, and a repeat that reaches
  another process finds nothing there unless the processes share a store. A host that needs the
  promise across restarts or processes supplies a store that gives it, and a host that runs
  several processes behind one address **MUST** give the step a store they share or leave the
  step off: R3's recovery would otherwise send a repeat to a process that knows nothing of the
  key.

### Errors

| Code | When | Retryable | Recovery |
| --- | --- | --- | --- |
| `IDEMPOTENCY_KEY_REUSED` | The key is held for another call (S5). The suggestion says to use a new key for a different call | No | `{ "kind": "stop" }` |
| `IDEMPOTENCY_IN_PROGRESS` | An earlier call with this key and digest is still running (S5). The suggestion says to repeat the call shortly | Yes | `{ "kind": "retry", "afterMs": 1000 }` |
| `OUTCOME_UNKNOWN` | An earlier call with this key and digest started and nobody can say whether it was applied (S6, S7). The suggestion says to check the effect, then use a new key if the call is still wanted | No | `{ "kind": "external" }` |

The first two are new and join the shared catalog, in an `idempotency` profile, with the first
implementation ([error codes](./error-codes.md#specified-not-yet-in-the-catalog)).
`OUTCOME_UNKNOWN` exists as a client's code for a lost connection; the step is a second sender of
it, and it joins the same profile then.

## Retrying

- **R1. What a retry may repeat.** The retry middleware decides from the command's declaration,
  in this order:
  1. a command that declares `natural` is repeated;
  2. a command that declares `keyed` is repeated only when the call carries a key (and is not a
     task run, S11);
  3. any other command is repeated unless it declares `mutation: true`.

  A middleware that cannot read the declaration (one outside the execution engine, as for the
  journal's `secret`) treats the command as a mutation that declares nothing.
- **R2. The host's override.** A host that knows its commands may set the middleware's
  `retryMutations` option (`retry_mutations` in Python, Rust and C++), which restores retrying
  every command.
- **R3. A timeout that may be repeated.** When the step acted on a call and the engine then gives
  that call a `TIMEOUT` that is `retryable`, the error carries `recovery: { "kind": "retry" }`,
  and its suggestion says to repeat the call with the same idempotency key. A follower repeats
  the call as it was sent, its `_meta` included. On any other call, a `keyed` one on a server
  without the step among them, `TIMEOUT` carries no recovery, as today: only this server's own
  store makes the repeat safe.
- **R4. A client that lost its answer.** A client that would report `OUTCOME_UNKNOWN` for a lost
  connection **MAY** instead repeat a call to a command it knows to be `natural`. It repeats a
  `keyed` call only where its application has told it to, since only the application knows that
  the server keeps keys and for how long (S13).

## The journal

A journal entry for a call that carried a key records it in an optional `idempotencyKey` member
([journal](./journal.md#entry)), on the allowlist beside `traceId`: a derived key (K4) is recorded
as derived. Replay restores it through the engine's own replay path, not as a caller's key, so K2
does not refuse a derived one.

A result the step returned is recorded as any result is. It replays as `same` only where the
replaying surface rebuilds the store's history: the step's verdict depends on what the store
holds, on the server's clock and on the caller's credentials, none of which the journal carries
in full, and entries are in the order calls finished, so a call refused as in progress can stand
before the call it waited on. Elsewhere the entry is reported `different`, as any entry is whose
result depends on state outside the journal.

## Status

<!-- generated:capabilities:spec.idempotency.status:start -->
|  | TypeScript | Python | Rust | C++ |
| --- | --- | --- | --- | --- |
| The `idempotency` field and `idempotentHint` | Yes | Planned ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Planned ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Yes |
| The key: delivery, validation, derived keys, the journal member | Yes | Planned ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Planned ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Yes |
| The engine's step, the retry rule and the `TIMEOUT` recovery | Yes | Planned ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Planned ([#2676](https://github.com/lushly-dev/afd/issues/2676)) | Yes |
<!-- generated:capabilities:spec.idempotency.status:end -->

[`vectors/idempotency.json`](./vectors/idempotency.json) pins the rules its sections name. It
leaves to each language's own tests the surfaces of D3 beyond the tool's `_meta`, D4, D5, K1's
rule against HTTP headers, the store's interface (S12), S13 and R4. The retry middleware's first half is implemented in all four languages: it does not repeat a
command with `mutation: true` without the host's `retryMutations` option
([#2673](https://github.com/lushly-dev/afd/issues/2673)). R1's whole order, `natural` and `keyed`
included, is TypeScript's and C++'s so far.
