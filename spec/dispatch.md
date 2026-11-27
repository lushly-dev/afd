# Single-command dispatch

Normative execution order for dispatching a single command through an AFD server engine or
validating registry. TypeScript (`packages/server/src/execution.ts`), Python, Rust and C++ must
follow this order. [`vectors/dispatch.json`](./vectors/dispatch.json) pins it across all four
languages.

Every rule here is normative. **MUST**, **MUST NOT**, **SHOULD** and **MAY** are used as in
RFC 2119.

## Overview

A single-command dispatch runs these stages in order. Any stage that fails short-circuits and
returns its `CommandResult` immediately; no later stage runs.

| Stage | What runs | Failure code | Hooks that ran |
| --- | --- | --- | --- |
| 1. Caller-admission gates | `apps` grant check, `allow` predicate, active context validity, pre-dispatch scope check | `CALL_NOT_GRANTED`, `COMMAND_NOT_ALLOWED`, `CONTEXT_NOT_FOUND`, `INSUFFICIENT_SCOPE` (or HTTP 403) | None |
| 2. Command lookup | Resolve command by name; hide unexposed commands on remote lanes and hidden commands on authorized servers ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)) | `COMMAND_NOT_FOUND` | None |
| 3. Exposure check | In-process callers naming an interface (`palette`, `mcp`, `agent`, `cli`) check `expose` | `COMMAND_NOT_EXPOSED` (`retryable: false`) | None |
| 4. Active context check | Verify command is accessible in the active context | `COMMAND_NOT_IN_CONTEXT` | None |
| 5. Confirmation gate | On surfaces enforcing `confirmPrompt` (MCP server / router with `confirmations: "enforce"` or `"require-human"`; `confirmationMode: "host-verified"` validates input first per [`command-metadata.md`](./command-metadata.md#host-verified-confirmation)) | `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` (`retryable: false`) | None |
| 6. Input validation | Validate against the command's input schema ([`validation.md`](./validation.md)): apply defaults, strip undeclared keys unless `additionalProperties` allows them | `VALIDATION_ERROR` | None (throwing schema callback calls `onError`) |
| 7. Declared context fields & output-budget ask | Validate declared context fields ([`context-fields.md`](./context-fields.md)) and any `dev.afd/outputBudget` ask ([`output-budgets.md`](./output-budgets.md#b2-the-ask)); execute-time scope check on validated input | `VALIDATION_ERROR` / `INSUFFICIENT_SCOPE` | None |
| 8. Middleware chain | Run configured middleware in onion order (`mw[0]` outermost, `mw[n-1]` innermost), receiving the validated input | Any failure returned by middleware (e.g. `APPROVAL_REQUIRED`, `RATE_LIMITED`); thrown error -> `COMMAND_EXECUTION_ERROR` | Middleware up to short-circuit or throw |
| 9. Approval admission check | Innermost link verifies that a command declaring an approval policy other than `not-required` was admitted by an approval step for this command and validated input ([`command-metadata.md`](./command-metadata.md#approvals)) | `APPROVAL_UNAVAILABLE` (`retryable: false`) | Outer middleware before/after; handler does NOT run |
| 10. Handler | Run the command's handler with the validated input and context | Handler's failure result; thrown error/panic -> `COMMAND_EXECUTION_ERROR` | Middleware + handler |
| 11. Output-budget check | On budgeted commands, measure canonical JSON without `metadata` ([`output-budgets.md`](./output-budgets.md#b5-the-check-after-the-handler)) | `OUTPUT_BUDGET_EXCEEDED` (failure for read; warning for mutation) | Middleware + handler |
| 12. Metadata stamping | Stamp `executionTimeMs`, `commandVersion`, `traceId` (when set on context) and `actorKind` (when context carries an actor) on a copy of the result | — | Middleware + handler |
| 13. Observer hooks | Call `onCommand(name, rawInput, result)` outside the execution `try`; if middleware or handler threw, call `onError(err)` instead | Never changes the result | `onCommand` (normal return, including middleware failures) or `onError` (thrown error / throwing hook) |

## The dispatch id

Before stage 1 the engine gives each call it is asked to run an id and sets it on the command
context as `dispatchId` (`dispatch_id` in Python, Rust and C++). A call refused in stages 1 to 7
has one too, though nothing reads it. It names this one call and nothing else:
a host that keeps its own record of a call (an intent written before the handler, an approval, an
outcome) keys it by this id, which no other dispatch shares. The trace id cannot serve: a caller
sets it, and the calls of one request share it on purpose.

- **I1. Made by the engine.** The id is 128 bits from the platform's cryptographic random source,
  or from a secure generator the host supplies where the platform's cannot be trusted, written as
  unpadded base64url: 22 characters of `A-Z a-z 0-9 - _`, the last of which carries two bits and
  so is `A`, `Q`, `g` or `w`. It is never taken from the caller. A value that a caller, a context hook or an in-process host put under that name is
  replaced. It is never drawn from `context.random`, so a journal's tape is unchanged.
- **I2. One per dispatch.** Each `afd-batch` item, each `afd-pipe` step and each command a handler
  runs through the registry is a dispatch of its own and gets its own id, whatever trace id they
  share. A middleware that calls `next()` more than once (a retry) runs the inner links again
  under the same id. The id is not an admission: each pass through the innermost link still takes
  its own approval admission (rule 9), so a retry placed after the approval step is refused with
  `APPROVAL_UNAVAILABLE` (`details.reason: "admission-mismatch"`) as before. A nested call
  leaves the outer call's id as it was, also where the two share one context object.
- **I3. Stable and readable.** Every middleware and the handler read the same value for the whole
  dispatch. A middleware **MUST NOT** change it, and an engine whose middleware could restores it
  before each link.
- **I4. Nowhere else.** The id is not stamped on the result, not written to a journal entry, and
  its name never enters the journal's `contextDigest.keys`
  ([journal](./journal.md#context-digest-no-secrets)). A server therefore returns the same
  results and writes the same journal bytes as one without the id. The one exception is a host
  that used the name itself: `dispatchId` is reserved
  ([context fields](./context-fields.md#declaration)), so in an implementation that sets the id a
  declared field of that name fails at registration and a context value under it is replaced.

[`vectors/journal-seams.json`](./vectors/journal-seams.json) pins I1 to I4 in its `dispatchId`
section. TypeScript and Rust set the id; the languages still listed in that file's `gaps` do not
yet.

## The idempotency step

A server or registry given an idempotency step runs it between stages 9 and 10, for a call that
carries an idempotency key to a command that declares `idempotency: "keyed"`
([idempotency, S1 to S13](./idempotency.md#the-engines-step)). The step may return a stored
result or a refusal in place of running the handler; stages 11 to 13 then run on what it
returned. Between stages 4 and 5 the engine validates the key and sets it on the command context,
as it does a declared context field in stage 7 ([idempotency, K1 to K6](./idempotency.md#the-key)),
so a malformed key comes ahead of `CONFIRMATION_REQUIRED`, though rules 2 and 5 otherwise put
confirmation before validation. A call the step would act on from a caller the server cannot tell
apart is refused at the same point (S3), and the engine's cancellation check runs again between
the step's reservation and the handler (S5). TypeScript implements the key and the step; Python,
Rust and C++ do not yet ([#2676](https://github.com/lushly-dev/afd/issues/2676)).

## Normative rules

### Precedence of pre-execution checks

1. **Pre-lookup gates come first.** An `apps` call without a grant (`CALL_NOT_GRANTED`), an
   in-process call refused by `allow` (`COMMAND_NOT_ALLOWED`), or a call naming an unconfigured
   `activeContext` (`CONTEXT_NOT_FOUND`) fails before command lookup, so the caller cannot probe
   whether a command exists.
2. **Lookup precedes exposure, context and validation.** An unknown command fails with
   `COMMAND_NOT_FOUND` even when its input is invalid or its context is wrong. On remote surfaces
   (MCP, HTTP), an unexposed or authorization-hidden command is indistinguishable from an unknown
   command ([D4](./error-codes.md#unknown-and-unexposed-commands-d4)).
3. **Exposure precedes context and validation.** On an in-process registry called with an interface
   (`mcp`, `agent`, `palette`, `cli`), an unexposed command fails with `COMMAND_NOT_EXPOSED`
   (`retryable: false`) before the active context or input schema is checked. A trusted in-process
   caller that names no interface skips the exposure check.
4. **Active context precedes confirmation and validation.** A command outside the active context
   fails with `COMMAND_NOT_IN_CONTEXT` before confirmation or input validation runs.
5. **Confirmation precedes validation and middleware on MCP routes.** On a server configured with
   `confirmations: "enforce"` or `"require-human"`, an unconfirmed call to a command declaring
   `confirmPrompt` fails with `CONFIRMATION_REQUIRED` (`retryable: false`) before middleware or the
   handler runs (for `confirmationMode: "host-verified"`, input validation runs before
   `HumanRelay::begin` per [`command-metadata.md`](./command-metadata.md#host-verified-confirmation)).
   In-process registries do not run the confirmation gate.
6. **Input validation precedes declared context fields and middleware.** Invalid command input fails
   with `VALIDATION_ERROR` (for input) before declared context fields are checked. Only valid input
   (with schema defaults applied and undeclared keys removed per [`validation.md`](./validation.md))
   reaches declared context-field validation, middleware and the handler.
7. **Declared context fields precede middleware.** A missing required declared context field or an
   invalid field value fails with `VALIDATION_ERROR` before any middleware or handler runs.

### Middleware, approval admission and exceptions

8. **Onion order.** Middleware runs in registration order on the way in (`mw[0]` before `mw[1]`)
   and reverse order on the way out (`mw[1]` after `mw[0]`). If a middleware returns a result
   without calling `next()` (for example `APPROVAL_REQUIRED` from the approval middleware), inner
   middleware and the handler do not run, while outer middleware still sees the returned result on
   the way out.
9. **Fail-closed approval admission.** At the innermost link before invoking the handler, if the
   command declares an approval policy other than `not-required` and no approval step admitted this
   dispatch (same command name and validated input), the engine MUST return `APPROVAL_UNAVAILABLE`
   (`retryable: false`) and MUST NOT run the handler.
10. **Exception containment.** An uncaught exception (or unwinding panic in Rust) from any
    middleware or from the handler MUST be caught and converted into a failed `CommandResult` with
    code `COMMAND_EXECUTION_ERROR`. Outside `devMode`, `message` MUST be
    `"An internal error occurred"` and no exception message or stack trace may reach the caller. In
    `devMode`, the exception message is returned.

### Metadata stamping and observer hooks

11. **Result metadata stamping.** When the handler returns, the innermost link builds a copy of the
    result (never mutating a frozen object) with `metadata` carrying:
    - `executionTimeMs`: elapsed milliseconds measured from the context clock (clamped to `>= 0`);
    - `commandVersion`: the command's declared `version` (when set);
    - `traceId`: `context.traceId` (when set and non-empty);
    - `actorKind`: `context.actor.kind` (when set, read after the handler so middleware such as
      auth may refine it).
    Existing custom keys in `result.metadata` are preserved.
12. **`onCommand` and `onError`.**
    - Pre-middleware refusals (stages 1–7) call neither `onCommand` nor `onError` (except a schema
      callback that throws during input validation, which calls `onError`).
    - When the middleware chain returns a `CommandResult` normally (whether the handler ran or a
      middleware short-circuited), `onCommand(name, rawInput, result)` is called with the **raw
      input** as originally sent.
    - When middleware or the handler throws, `onError` is called and `onCommand` is NOT called.
    - A throw or rejection inside `onCommand` MUST be reported to `onError` and MUST NOT alter the
      returned `CommandResult`. A throw inside `onError` is swallowed.

## Conformance

[`vectors/dispatch.json`](./vectors/dispatch.json) drives a scripted registry and MCP server through
every stage above, asserting the returned result, error code, the error's recovery where a case
gives `expect.recovery` ([engine errors](./recovery.md#engine-errors)), metadata stamping and which
hooks ran.
All four languages load it; known language gaps are declared in its top-level `gaps` object with
their tracking issues and skipped by that language's suite until closed.

<!-- generated:capabilities:spec.dispatch.conformance:start -->
| Language | Suite | Known gaps in `dispatch.json` |
| --- | --- | --- |
| TypeScript | `packages/server/src/dispatch-vectors.test.ts` | None |
| Python | `python/tests/test_dispatch_vectors.py` | `hooks` (`onCommand`/`onError`, [#2788](https://github.com/lushly-dev/afd/issues/2788)) |
| Rust | `packages/rust/tests/dispatch_vectors.rs` | `stamping` & `hooks` ([#546](https://github.com/lushly-dev/afd/issues/546)) |
| C++ | `packages/cpp/tests/dispatch_vectors_test.cpp` | None |
<!-- generated:capabilities:spec.dispatch.conformance:end -->
