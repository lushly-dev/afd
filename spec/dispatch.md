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
| Python | `python/tests/test_dispatch_vectors.py` | `hooks` (`onCommand`/`onError`, [#1551](https://github.com/lushly-dev/afd/issues/1551)) |
| Rust | `packages/rust/tests/dispatch_vectors.rs` | `stamping` & `hooks` ([#546](https://github.com/lushly-dev/afd/issues/546)) |
| C++ | `packages/cpp/tests/dispatch_vectors_test.cpp` | None |
<!-- generated:capabilities:spec.dispatch.conformance:end -->
