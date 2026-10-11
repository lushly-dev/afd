# Batch and pipeline execution controls

Shared behavior for TypeScript, Python, Rust and C++ executors. TypeScript is the reference;
[`vectors/batch-controls.json`](./vectors/batch-controls.json) covers the serial controls and
request validation. Cancellation signals and concurrent failure ordering also require deterministic
executor tests, because their host scheduling mechanisms differ.

## Timeout units and values

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

## Caller cancellation

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
