# Recovery

A failed command's `suggestion` tells the caller how to recover, in prose. An agent reads it and
does what it says. Nothing checks that the step it describes exists, can be called, or helps. A
survey of 379 suggestions across five AFD surfaces found 18% that a program could follow exactly
as written, and suggestions that named commands no surface registers
([research](../docs/features/complete/verified-recovery/recovery-research.md)).

`CommandError.recovery` is the same step in a form a program can follow and a test can check. It
sits beside `suggestion`, never in its place: people and models read the prose, and tools and
tests read the structure.

## The field

`recovery` is an optional object on `CommandError` ([`schema/error.json`](./schema/error.json)).

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | string, required | What the caller does next: `call`, `fix-input`, `retry`, `external` or `stop` |
| `command` | non-empty string | `call` only: the command to call next, by its registered name |
| `input` | object, at least one member | `call`: arguments for `command`. `fix-input`: replacement values for the failed call's input |
| `needs` | array of distinct, non-empty strings, at least one | `call`: fields of `command`'s input the caller must choose. `fix-input`: fields of the failed call's input the caller must choose new values for |
| `thenRetry` | boolean, absent read as `false` | `call` only: once `command` succeeds, repeat the failed call unchanged and expect it to get further |
| `afterMs` | integer, 0 to 2^53 − 1 | `retry` only: wait at least this long before repeating the call; absent means no minimum wait |

No member is ever `null`: an unset field is omitted, as everywhere on the wire
([schema rules](./schema/README.md#key-naming-and-omitted-optional-fields)).

The kinds:

- **`call`**: call `command`. With `thenRetry`, the call fixes what refused the original (signing
  in, resuming a paused lane), so the original call is repeated. Without it, the call is the way
  forward itself (listing work that can be taken instead). `command` is a command name: under the
  grouped, lazy or hybrid tool strategies the caller reaches it the way it reaches any command
  ([tool strategies](./tool-strategies.md)), through `afd-call` or its group.
- **`fix-input`**: call the same command again with changed input: the failed call's input with
  each top-level member that `input` names replaced by `input`'s value, then each field in `needs`
  given a value the caller chooses. A member cannot be removed this way; a step that needs one
  removed is `external`. At least one of `input` and `needs` is set.
- **`retry`**: call the same command again with the same input, after `afterMs`. Only for a
  transient failure: an error whose recovery is `retry` **MUST** set `retryable: true`.
- **`external`**: the step is outside the command surface: a configuration change, a person's
  decision, a shell command. The prose says what; no program can follow it.
- **`stop`**: no step makes this call succeed. The caller should do something else. An error whose
  recovery is `stop` **MUST NOT** set `retryable: true`.

Rules for producers:

1. **The structure and the prose describe the same step.** An error that sets `recovery` **SHOULD**
   set `suggestion` too, and when the kind is `call` the suggestion **SHOULD** name `command` as
   written. An agent reads the prose, so a correct structure behind a wrong sentence still misleads.
2. **`command` names a command the caller can call** on the surface that returned the error:
   registered, exposed to the caller's interface, allowed in its context, and visible to it under
   the server's authorization ([hidden commands](./authorization.md#hidden-commands)) and any
   `allow` list a direct client sets. A command the caller cannot see is never named, by
   `recovery` or by `suggestion`, so a recovery never reveals a hidden command
   ([error codes, D4](./error-codes.md#unknown-and-unexposed-commands-d4)). A command on another
   surface, or a tool only a person runs, is `external`.
3. **`input` holds only what is known to work.** A field the caller must decide goes in `needs`,
   never as a placeholder value, and `needs` and `input` never name the same field. Schema
   validation does not check this rule; the testing packages do when they follow a recovery.
4. **Fields belong to their kinds.** `command` and `thenRetry` appear only on `call`, `afterMs` only
   on `retry`, and `input` and `needs` only on `call` and `fix-input`. The schema enforces this.
5. **No acknowledgement, approval or credential in `input`.** A recovery never carries `confirm`
   (the acknowledgement of a [confirmation](./command-metadata.md#confirmations)), an approval token or a credential
   in `input`: a field the caller must decide to give goes in `needs`, and a step a person must
   take is `external`. The schema refuses `confirm` in `input`.
6. **Untrusted text stays out.** `command` is a registered name and `input` holds values the
   command chose, never text from the caller's input, stored records or another system copied in,
   for the same reason suggestions never echo a requested command name
   ([error codes, rule 4](./error-codes.md#unknown-and-unexposed-commands-d4)).

Rules for consumers:

7. **Read leniently.** A recovery that does not match `$defs/recovery` in
   [`schema/error.json`](./schema/error.json) is read as no recovery, and the rest of the error is
   kept, `suggestion` included. That covers an unknown `kind`, an unknown member, a `null` member, a
   member of the wrong type or on the wrong kind, and a value out of range. A whole number written
   with a fraction part of zero, such as `30000.0`, is an integer, as JSON Schema reads it. New
   kinds and members may therefore be added without a breaking change. Readers do not enforce the
   error-level rules that tie `retryable` to `retry` and `stop`; the schema checks producers.
8. **Following grants nothing.** A program that follows a recovery calls `command` the way it
   calls any command: through the same exposure, context, authorization, confirmation and approval
   checks, with its own credentials. It does not follow a recovery into a command whose metadata
   marks it destructive or approval-gated without the same decision it would take for that command
   anyway. Only the error's own `recovery` is followed: a `cause`'s recovery describes the cause and
   may come from another surface.
9. **Followers bound what they follow.** A follower caps the wait it honours from `afterMs` and
   the number of recoveries it follows in a row, and stops when a recovery leads back to a refusal
   it has already seen.

## Examples

A refusal that sends the caller to other work:

```json
{
  "code": "ALREADY_CLAIMED",
  "message": "Issue #205 is claimed by fix/client-timeout",
  "suggestion": "Take another issue from issue-check's dispatchable list",
  "recovery": { "kind": "call", "command": "issue-check" }
}
```

A refusal fixed by another call, after which the original is repeated:

```json
{
  "code": "LANE_PAUSED",
  "message": "The lane is paused",
  "suggestion": "Call lane-resume, then lane-enqueue again",
  "recovery": { "kind": "call", "command": "lane-resume", "thenRetry": true }
}
```

A transient failure:

```json
{
  "code": "RATE_LIMITED",
  "message": "Rate limit exceeded",
  "suggestion": "Wait 30 seconds and try again",
  "retryable": true,
  "recovery": { "kind": "retry", "afterMs": 30000 }
}
```

## What a test can check

Because the step is structured, a test can follow it and judge the result
([verified recovery](../docs/features/complete/verified-recovery/verified-recovery.proposal.md)):
a `call` recovery's command must be callable and not refuse in the same way; with `thenRetry` the
repeated call must succeed or fail with a different, expected code; a `fix-input` recovery's input
must pass validation; and a chain of recoveries must end within a bound without returning to the
refusal it started from. Which of an application's own errors carry a recovery, and how its
scenarios check them, is the application's and testing package's concern. The errors the engines
emit themselves carry the recoveries below.

## Engine errors

The errors AFD's own engines emit (registries, servers, routers, middleware, the confirmation and
approval steps, and the context commands) carry the recovery this table gives, in all four
implementations. A batch item or pipeline step that fails with one of these errors carries the
same recovery. Every other engine error carries none for now
([follow-ups](../docs/features/complete/verified-recovery/STATUS.md#follow-ups)).

The recovery describes the same step as the error's `suggestion` (rule 1). Where a row turns on
whether the caller can call a command, the engine decides it once and uses the answer for both:
the command is named in the suggestion and in a `call` recovery only when the caller can call it
on this surface, which means:
- it is registered or served;
- it is exposed to the caller's interface;
- it is allowed in the active context;
- it is admitted by any `allow` list;
- it is visible under the server's authorization (rule 2).

The idempotency step's errors, and the `retry` a `TIMEOUT` carries for a keyed call, are in
[idempotency](./idempotency.md#errors) and join this table with the first implementation.

A meta-tool such as `afd-discover` is called as its own tool, not through `afd-call`, whose
lookup holds only commands. Where the table says *none*, the engine sets no recovery: the step is
the caller's own and no command does it, such as spelling a command name correctly or splitting a
pipeline.

| Code | When | Recovery |
| --- | --- | --- |
| `COMMAND_NOT_FOUND` | An unknown command name at lookup (a call, `afd-call`, a batch item or a pipeline step), and the caller can call `afd-discover` | `{ "kind": "call", "command": "afd-discover" }` |
| `COMMAND_NOT_FOUND` | An unknown command name at lookup outside TypeScript's core registry, the caller cannot call `afd-discover` and can call `afd-help` | `{ "kind": "call", "command": "afd-help" }` |
| `COMMAND_NOT_FOUND` | TypeScript's core registry, whatever it registers: its suggestion names the `afd tools` shell command | `{ "kind": "external" }` |
| `COMMAND_NOT_FOUND` | Every other case, a grouped tool's unknown action and `afd-detail`'s per-entry not-found included, whatever the caller can call | none |
| `UNKNOWN_TOOL`, `COMMAND_NOT_ALLOWED` | Every case: the remedy is the client's own `listCommandNames()`, not a command | none |
| `COMMAND_NOT_EXPOSED` | Every case: the command cannot be called from this interface | `{ "kind": "external" }` |
| `CALL_NOT_GRANTED` | Every case: the deployer adds a calls grant | `{ "kind": "external" }` |
| `COMMAND_NOT_IN_CONTEXT` | The caller can call `afd-context-list` | `{ "kind": "call", "command": "afd-context-list" }` |
| `COMMAND_NOT_IN_CONTEXT` | It cannot: the suggestion names the contexts instead | none |
| `CONTEXT_NOT_FOUND` | `afd-context-enter` names a context that does not exist, and the caller can call `afd-context-list` | `{ "kind": "call", "command": "afd-context-list" }` |
| `CONTEXT_NOT_FOUND` | Every other case: the caller cannot call `afd-context-list`, or a direct registry's unknown `activeContext` | none |
| `CONTEXT_DEPTH_EXCEEDED` | `afd-context-enter` while the context stack is full, and the caller can call `afd-context-exit` | `{ "kind": "call", "command": "afd-context-exit", "thenRetry": true }` |
| `CONTEXT_DEPTH_EXCEEDED` | The caller cannot call `afd-context-exit` | none |
| `RATE_LIMITED` | The middleware knows when the window ends ("Try again in N seconds") | `{ "kind": "retry", "afterMs": N × 1000 }`, the same whole number of seconds the suggestion gives |
| `RATE_LIMITED` | The limiter's client capacity is full, or a task limit is reached | `{ "kind": "retry" }` |
| `CONFIRMATION_REQUIRED` | Every case: the user confirms, which rule 5 keeps out of `input` | `{ "kind": "external" }` |
| `CONFIRMATION_DECLINED` | Every case: the user chose not to proceed | `{ "kind": "stop" }` |
| `APPROVAL_REQUIRED` | `reason: "declined"`, or a DirectClient whose `onApprovalNeeded` answered no | `{ "kind": "stop" }` |
| `APPROVAL_REQUIRED` | The caller reshapes the call: an `afd-batch` or `afd-pipe` refused up front (`input-not-known`, `too-many-approvals`), a gated step the suggestion says to call on its own, or an approved call resent the wrong way | none |
| `APPROVAL_REQUIRED` | Every other case: a person must approve, the approval is pending or unanswered, a token was rejected, or a DirectClient's `onApprovalNeeded` failed (threw, rejected or gave no answer), which is not a decline | `{ "kind": "external" }` |
| `APPROVAL_UNAVAILABLE` | `no-approval-step` or `admission-mismatch`: the operator fixes the approval setup | `{ "kind": "external" }` |
| `APPROVAL_UNAVAILABLE` | `input-not-canonical`: the caller sends the input in a form canonical JSON accepts | none |

Each `retry` row's error is already `retryable: true`, and each `stop` row's is not, as the kinds
require. Engines fix any suggestion that names a command the caller cannot call (rule 2) in the
same change, so the two never disagree. A grouped tool's unknown-action suggestion names no command a
recovery could call, in any language ("Use afd-call with the full command name, or list tools to find a valid action."),
so Python's, which names `afd-discover` and `afd-detail`, takes the shared text.

The error helpers an application uses follow the table where they share a code:
- `rateLimitError()` and its counterparts set `{ "kind": "retry" }`, with `afterMs` when they are
  given the wait in seconds.
- The other helpers (validation, not found, timeout, internal) set no recovery.
- An application sets its own recovery through the general error constructor in each language.

The default server instructions say what `error.recovery` is beside the prose
([tool strategies](./tool-strategies.md)).

## Conformance

- [`vectors/recovery.json`](./vectors/recovery.json) holds whole errors that are valid and invalid
  under the schema, each invalid one with the rule it breaks. Every implementation validates each
  case against [`schema/error.json`](./schema/error.json), round-trips the valid ones through its
  native `CommandError` type unchanged, and reads each invalid one to exactly its `readsAs`: the
  same error with any recovery that breaks `$defs/recovery` dropped (rule 7).
- [`wire/result-failure.json`](./wire/result-failure.json) carries a `recovery`, so every language's
  wire-fixture round trip covers it.
- The engine rows are pinned where shared vectors already reach the engines:
  - [`vectors/dispatch.json`](./vectors/dispatch.json) gives `expect.recovery` on each refusing case.
  - [`vectors/tool-strategies.json`](./vectors/tool-strategies.json) gives `expected.recovery` on
    each refusing call.
  - [`vectors/app-calls.json`](./vectors/app-calls.json) pins `CALL_NOT_GRANTED`'s whole error,
    recovery included.
  - Each value is the object the error's `recovery` must equal, or `null` where the table gives
    none, and every language's loader compares it.
  - `dispatch.json`'s `registry` surface registers the context commands as plain commands, with
    no tool surface and no bootstrap or help commands. So `afd-context-list` is callable there in
    every language, and `afd-discover` and `afd-help` are not.
- Rows no shared vector reaches are checked by each language's own tests:
  - the rate limiter and task limit;
  - the declines;
  - the reshaped and unavailable approvals;
  - `UNKNOWN_TOOL` and `COMMAND_NOT_ALLOWED`;
  - the context commands.

| Implementation | Native type | Tests |
| --- | --- | --- |
| TypeScript | `Recovery` on `CommandError` (`packages/core/src/errors.ts`) | `packages/server/src/recovery-vectors.test.ts`, `packages/server/src/wire-fixtures.test.ts` |
| Python | `Recovery` on `CommandError` (`python/src/afd/core/errors.py`) | `python/tests/test_recovery_vectors.py`, `python/tests/test_wire_fixtures.py` |
| Rust | `Recovery` on `CommandError` (`packages/rust/src/errors.rs`) | `packages/rust/tests/recovery_vectors.rs`, `packages/rust/tests/wire_fixtures.rs` |
| C++ | `Recovery` on `CommandError` (`packages/cpp/include/afd/errors.hpp`) | `packages/cpp/tests/recovery_vectors_test.cpp`, `packages/cpp/tests/wire_fixtures_test.cpp` |
