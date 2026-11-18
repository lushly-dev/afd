# Language parity closure: status

Read this before the [plan](parity-closure.plan.md). Last reconciled 2026-11-13 against `main`
at `1024546b`, using the [capability matrix](../../../language-parity.md), merged history and
the linked tracking issues. This audit did not rerun the four language suites.

## Delivery by wave

| Wave | State | Evidence / remaining scope |
| --- | --- | --- |
| 0. Original in-flight fixes | Done | The plan records #286, #289, #301, #304 to #306 and #315 |
| 1. Shared contract | Implemented at `1.0-rc`; declaration open | The stabilization candidate merged in #367; all four suites load the validation, executor-control and pipeline-reference vectors. Contract 1.0 remains [#541](https://github.com/lushly-dev/afd/issues/541) |
| 2. Engine alignment | Partial | Python runtime [#545](https://github.com/lushly-dev/afd/issues/545) and [name cleanup](../python-parity/STATUS.md); Rust runtime [#546](https://github.com/lushly-dev/afd/issues/546); C++ [#547](https://github.com/lushly-dev/afd/issues/547); TypeScript MockServer [#544](https://github.com/lushly-dev/afd/issues/544). The matrix distinguishes landed fixes from remaining gaps |
| 3. Surfaces | Partial | TypeScript/Python dual-era MCP and clients landed in #391 to #393. Rust's optional server landed in #394 and its strategies, meta-tools and contexts in #526. C++'s opt-in `afd::mcp_stdio` target and command-to-tool helpers landed for [#341](https://github.com/lushly-dev/afd/issues/341) (stdio, individual tools); Python CLI batch/stream [#548](https://github.com/lushly-dev/afd/issues/548) and defaults [#542](https://github.com/lushly-dev/afd/issues/542) remain |
| 4. Remaining decisions | Partial | Intended differences are recorded in the matrix; Python application auth remains [#549](https://github.com/lushly-dev/afd/issues/549) |

## TypeScript D8 candidate (#543)

Implemented on `lush/fleet-543-context-timeout-parity`: the server engine bounds middleware and
handler execution by each command's positive finite `context.timeout`, aborts its signal and
returns `TIMEOUT` with a recovery suggestion. Cancelled or timed-out work cannot start after
middleware resumes, including gated and ungated steps awaiting the batch approval relay (#1417).
Focused tests cover the engine, both MCP eras and HTTP `/rpc`; full validation belongs to the lane.

With esbuild 0.28.2, this adds 808 minified bytes to `/direct` for the deadline, signal composition,
timer cleanup and cancellation guard. The registry host grows from 39,071 to 39,879 bytes (budget
39,100 → 40,000); the tool-surface host grows from 73,310 to 74,118 (74,000 → 74,200). Other
budgets hold, and the browser entry gains no transport dependency.

## Historical checkpoints

The plan's 2026-10-10 stabilization candidate is now merged (#367), and its first releases are
recorded in [release readiness](../../../operations/stabilization-release.md). Its warnings about
unmerged candidate code and broken Python 0.8.0 describe that checkpoint, not current delivery.
They do not close the runtime, client, tooling or contract-declaration gaps above.

## Next gate

Close or explicitly disposition every remaining matrix gap, keep the four languages' vector
loaders in step, and record the contract 1.0 decision. New cross-language features keep their own
plans; their presence on one server does not close this plan.
