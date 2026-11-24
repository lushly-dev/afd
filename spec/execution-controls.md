# Execution controls

Shared normative rules for deadlines, cancellation, batch limits and validation issue caps across
TypeScript, Python, Rust and C++.

- [`vectors/execution-controls.json`](./vectors/execution-controls.json) is **specification-authored**
  and pins the server-level default deadline, cooperative cancellation propagation, batch size and
  parallelism ceilings, and the validation issue cap.
- [`vectors/batch-controls.json`](./vectors/batch-controls.json) covers serial batch and pipeline
  controls, fractional deadlines and envelope validation.
- Concurrent cancellation and failure ordering also require deterministic barrier tests in each
  language's executor suite, because host scheduling differs across runtimes.

## Defaults and ceilings

| Control | Option name (conceptual) | Default | Refusal / expiry error | `retryable` |
| --- | --- | --- | --- | --- |
| Server-level default deadline | `defaultTimeoutMs` | `30000` ms | `TIMEOUT` | `true` |
| Pre-cancelled dispatch | caller signal / token | — | `COMMAND_CANCELLED` | `false` |
| Maximum batch size | `maxBatchSize` | `500` commands | `INVALID_BATCH_REQUEST` | `false` |
| Maximum batch parallelism | `maxBatchParallelism` | `16` concurrent | `INVALID_BATCH_REQUEST` | `false` |
| Validation issue cap | `maxValidationIssues` | `100` issues | `VALIDATION_ERROR` (with `details.truncated: true`) | `false` |

## Single-command deadlines

- **Server-level default deadline.** Every remote MCP/HTTP server enforces a default per-command
  deadline of **`30000` ms** (`defaultTimeoutMs`) when a call does not supply its own per-call
  timeout. A host may configure a different positive finite millisecond value, or explicitly disable
  the default (`0` / `null` / `None`) for trusted long-running deployments.
- **Per-call override.** A caller or `createContext` hook that supplies a positive finite per-call
  timeout (`context.timeout` in TypeScript, `timeout_ms` in Rust and C++, `timeout_ms` in Python)
  overrides the server default for that call.
- **Expiry result.** When the deadline expires, the engine aborts/cancels the command's cooperative
  cancellation signal and settles the call with `TIMEOUT` (`retryable: true`), `details: { command,
  timeoutMs }`, and a suggestion advising the caller to retry with a larger timeout and to check
  whether a mutation already took effect.
- **Cooperative interruption.** A handler may continue running after the engine stops waiting; a
  `TIMEOUT` does not prove that the command had no side effects or roll them back.

## How cancellation reaches a handler

Every implementation propagates a cooperative cancellation signal on `CommandContext`:

| Language | Carrier on `CommandContext` |
| --- | --- |
| TypeScript | `context.signal` (`AbortSignal`) |
| Python | `asyncio` task cancellation (`CancelledError`) and optional `context.signal` |
| Rust | `context.cancellation` (cooperative `CancellationToken`, in addition to future drop on timeout) |
| C++ | `context.cancellation` (`afd::CancellationToken`) |

Normative rules:

- **Pre-dispatch check.** Before middleware and immediately before the handler starts (including
  after an approval or confirmation wait), the engine checks whether the signal is already
  cancelled. If so, the handler **MUST NOT** run and the engine returns `COMMAND_CANCELLED`
  (`retryable: false`) with a suggestion to retry with a fresh signal if the work is still needed.
- **Deadline linkage.** When a per-command, batch or pipeline deadline expires, the engine signals
  the handler's cancellation carrier so cooperative handlers can stop work promptly.
- **In-flight preservation.** Cancellation after a handler starts is cooperative: if the handler
  completes before any deadline settles, preserve its actual `CommandResult`. Cancellation alone
  does not force failure or prove rollback.

## Batch size and parallelism limits

- **`maxBatchSize` (default `500`).** An `afd-batch` or batch executor request whose `commands`
  array contains more than `maxBatchSize` entries is rejected before any command starts.
- **`maxBatchParallelism` (default `16`).** An `afd-batch` or batch executor request whose
  `options.parallelism` exceeds `maxBatchParallelism` is rejected before any command starts.
- **Refusal result.** Both refusals return a rejected `BatchResult` (`success: false`,
  `results: []`) with `error.code: "INVALID_BATCH_REQUEST"`, `retryable: false`, and a suggestion
  naming the configured limits (`1` to `maxBatchSize` commands, `parallelism` at most
  `maxBatchParallelism`). No command runs.
- **Configurability.** Servers and executors allow overriding `maxBatchSize` and
  `maxBatchParallelism` with positive integers.

## Validation issue cap

- **`maxValidationIssues` (default `100`).** A single `VALIDATION_ERROR` reports at most
  `maxValidationIssues` entries in `details.errors`, bounding response size and CPU work on
  pathological inputs (such as a large invalid array).
- **Never silent.** When validation finds more than `maxValidationIssues` issues:
  - `details.errors` contains the first `maxValidationIssues` issues (in the implementation's
    deterministic traversal order).
  - `details.truncated` **MUST** be `true`.
  - `details.limit` **MUST** equal the active cap (`100` by default).
  - `details.totalErrors` **SHOULD** carry the total issue count when traversal completed without
    short-circuiting.
  - `suggestion` **MUST** append an explicit truncation notice (for example,
    `"... (showing first 100 validation issues; fix these and retry)"`).
- When the issue count is at or below `maxValidationIssues`, `details.truncated` and `details.limit`
  are omitted.

## Batch and pipeline timeout units and values

- Batch `options.timeout` and pipeline `options.timeoutMs` are finite, non-negative JSON numbers in
  milliseconds. Fractions such as `20.5` are accepted ([#329](https://github.com/lushly-dev/afd/issues/329)).
- Zero is an immediate deadline; omitting the option means no deadline.
- Strings, booleans, explicit `null`, negative numbers and native non-finite numbers are rejected
  before any command starts. Batch `parallelism` remains a positive integer.
- The deadline covers the whole batch or pipeline, including time spent draining commands already
  started. Runtime timer precision does not change which numeric values the request accepts.
- A batch command still pending when the deadline expires receives `BATCH_TIMEOUT`, as does work
  never started before the deadline. A pipeline's current step fails with `PIPELINE_TIMEOUT` and
  later steps are skipped with that error. `continueOnFailure` does not override a deadline.
- Deadline signals request cooperative interruption. A handler may continue after the executor
  stops waiting; a timeout does not prove that the command had no effects or roll those effects back.

## stopOnError

Batch `stopOnError: true` stops scheduling when a failed result is observed
([#330](https://github.com/lushly-dev/afd/issues/330)).

- Commands already started finish normally and their actual results are included. A failure in
  another command does not cancel them or replace their results with `COMMAND_CANCELLED`.
- Commands not started because of the failure receive `COMMAND_SKIPPED` and zero execution duration.
- Work started before the executor observes the failure is in flight, even if the failure happened
  earlier in wall-clock time. Schedulers need not produce the same start trace across languages.
- A whole-batch deadline and caller cancellation still apply while started commands are draining.

Use a barrier in concurrent tests: first establish that two commands started, fail one, then release
its peer and verify its result while a queued third command stays unstarted. Timer races alone do
not define the scheduling contract.

## Caller cancellation in batch and pipeline

A caller cancellation signal stops scheduling unstarted work
([#363](https://github.com/lushly-dev/afd/issues/363)). Cancellation is distinct from `stopOnError`.

- Check the signal before each command or step starts, including the first. An already-cancelled
  request starts no work. Once cancellation is observed, no queued command or later pipeline step
  starts, even with `continueOnFailure`.
- Unstarted batch commands have a failed command result with the existing `COMMAND_CANCELLED` code
  and zero duration. Unstarted pipeline steps use the existing `skipped` status and optional error
  with `COMMAND_CANCELLED`. The result shapes and error catalog are unchanged.
- Propagate the caller's signal to commands already running. Their interruption is cooperative;
  preserve the actual result they return. Cancellation alone does not force success or failure,
  prove rollback, or justify labelling a started command as unstarted.
- Deadlines remain active while awaiting cooperative completion. Deadline expiry is reported as
  the existing timeout code.
- Native hosts without a caller cancellation mechanism do not need a new public token API to load
  the vectors. Hosts that expose such a mechanism must honor these scheduling rules.

Cancellation errors use `message: "Command cancelled before starting"` and
`suggestion: "Start the command again if the result is still needed"`; no retryability guarantee is
added. Concurrent tests should use a barrier or an explicit abort from the running callback to
prove that queued work cannot start. Started commands that ignore cancellation can still have effects.

## Conformance

- [`vectors/execution-controls.json`](./vectors/execution-controls.json) pins the defaults,
  deadlines, cancellation propagation, batch size/parallelism limits and validation issue cap.
  TypeScript ([#2128](https://github.com/lushly-dev/afd/issues/2128)), Python
  ([#2129](https://github.com/lushly-dev/afd/issues/2129)), Rust
  ([#2130](https://github.com/lushly-dev/afd/issues/2130)) and C++
  ([#2131](https://github.com/lushly-dev/afd/issues/2131),
  [#1766](https://github.com/lushly-dev/afd/issues/1766)) execute every case.
- [`vectors/batch-controls.json`](./vectors/batch-controls.json) pins serial batch and pipeline
  control cases across all four languages.
