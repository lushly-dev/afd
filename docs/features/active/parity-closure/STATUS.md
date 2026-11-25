# Language parity closure: status

Epic: [#1551](https://github.com/lushly-dev/afd/issues/1551). File new work for this area as its sub-issue.

Read this before the [plan](parity-closure.plan.md). Last reconciled 2026-11-13 against `main`
at `1024546b`, using the [capability matrix](../../../language-parity.md), merged history and
the linked tracking issues. This audit did not rerun the four language suites.

## Delivery by wave

| Wave | State | Evidence / remaining scope |
| --- | --- | --- |
| 0. Original in-flight fixes | Done | The plan records #286, #289, #301, #304 to #306 and #315 |
| 1. Shared contract | Implemented at `1.0-rc`; core 1.0 decided, declaration open | The stabilization candidate merged in #367; all four suites load the validation, executor-control and pipeline-reference vectors. The owner decided on 2026-11-21 to declare core 1.0 now ([#541](https://github.com/lushly-dev/afd/issues/541); [the record](../architecture-review/decisions.md), AR2); the declaration is [#1926](https://github.com/lushly-dev/afd/issues/1926) |
| 2. Engine alignment | Partial | Python runtime API/boundary candidate [#545](https://github.com/lushly-dev/afd/issues/545), remaining executor consolidation [#1535](https://github.com/lushly-dev/afd/issues/1535), and [name cleanup](../python-parity/STATUS.md); Python reserves the bootstrap and context names as TypeScript does ([#1731](https://github.com/lushly-dev/afd/issues/1731)); Rust runtime [#546](https://github.com/lushly-dev/afd/issues/546); C++ Wave 2 ([#547](https://github.com/lushly-dev/afd/issues/547): `list_by_tags`, `compose_middleware`, retry/rate-limit/telemetry middleware and telemetry types, `_meta` from #341), approval admission (`APPROVAL_UNAVAILABLE`, [#1886](https://github.com/lushly-dev/afd/issues/1886): #1895, #1892, #2029, dispatch gap in #2200) and Approvals rule 6 MCP token-delivery defaults ([#1665](https://github.com/lushly-dev/afd/issues/1665)) merged in #2200; TypeScript MockServer [#544](https://github.com/lushly-dev/afd/issues/544). The matrix distinguishes landed fixes from remaining gaps |
| 3. Surfaces | Partial | TypeScript/Python dual-era MCP and clients landed in #391 to #393. Rust's optional server landed in #394 and its strategies, meta-tools and contexts in #526. C++'s opt-in `afd::mcp_stdio` target and command-to-tool helpers landed for [#341](https://github.com/lushly-dev/afd/issues/341) (stdio, with individual tools at first; the grouped, lazy and hybrid strategies with the meta-tools ([#1202](https://github.com/lushly-dev/afd/issues/1202)) and contexts ([#1425](https://github.com/lushly-dev/afd/issues/1425)) followed); Python's defaults (D5, [#542](https://github.com/lushly-dev/afd/issues/542)) merged in #1807, and the Python CLI's `batch` and `stream` ([#548](https://github.com/lushly-dev/afd/issues/548)) in #1826 |
| 4. Remaining decisions | Partial | Intended differences are recorded in the matrix; Python application auth remains [#549](https://github.com/lushly-dev/afd/issues/549) |

## TypeScript D8 candidate (#543)

Implemented on `lush/fleet-543-context-timeout-parity`: the standalone server's engine middleware
bounds middleware and handler execution by each command's positive finite `context.timeout`, aborts its signal and
returns `TIMEOUT` with a recovery suggestion. Cancelled or timed-out work cannot start after
middleware resumes, including gated and ungated steps awaiting the batch approval relay (#1417).
Focused tests cover the engine, both MCP eras and HTTP `/rpc`; full validation belongs to the lane.

Attempt 1 placed deadlines in the shared engine, adding 808 minified bytes to `/direct` and
failing Loam's kernel budget at 116,441 of 115,500 bytes. The repair moves the deadline boundary
and final cancellation guard into `createMcpServer`/`createMcpHandler`'s middleware assembly,
including `server.execute()`. The shared engine and in-process registry stay on their original
path; DirectClient continues to enforce its own deadline. A module-graph assertion keeps server
timers out of `/direct`.

After rebasing onto `eeea8be1`, the kernel measures 115,401 of 115,500 bytes (1,040 fewer than the
ejected candidate). With esbuild 0.28.2, the registry host returns from 39,879 to 39,071 and the
tool-surface host from 74,118 to 73,310; their ceilings return to 39,100 and 74,000. No Loam
ceiling changes. `pnpm -F @lushly-dev/loam-web budget` and server entry-point tests pass.

## TypeScript MockServer candidate (#544)

Implemented on `lush/fleet-544-mockserver-server-engine`: `MockMcpServer` uses
`createDirectRegistry` from the transport-free server entry. Production Zod definitions
retain their validation and input transforms; core definitions and mock helpers are adapted
with their historical input passthrough. Single calls and batch entries
share server middleware, suggestions, error handling and request-scoped contexts, including
declared context fields. Defect 20 in the matrix is updated. Focused mock and scenario tests
cover the candidate; the lane owns full validation and landing.

## Python runtime candidate (#545)

Implemented on `lush/fleet-545-python-wave2-runtime`:

- `failure()` forwards all non-payload result options, with camelCase wire output.
- `define_command` and `MCPServer.command` retain `errors` and `execution_time`;
  the server decorator also forwards `handoff` and `handoff_protocol`.
- `DirectClient` applies a fail-closed `allow` predicate to discovery, calls and pipe
  steps, with the policy carried into nested calls that forward context. Ordered client middleware wraps each registry attempt within the existing
  total deadline and returns redacted failures for exceptions. The validating
  registry retains exposure checks on raw execute and lists only callable commands.
- `create_handoff` supplies the shared reconnect policy (allowed, 3 attempts, 1000 ms).
  The client inherits metadata or this fallback; explicitly supplied options win.

The one-executor item is split to [#1535](https://github.com/lushly-dev/afd/issues/1535)
(`status:planned`, `execution:integrative`): consolidating the core registry,
SimpleRegistry, MockServer and DirectClient.pipe, plus public batch/stream executors,
is a separate architectural PR. Per-call contexts/tool surfaces and server deadlines
remain the matrix's existing gaps. Focused regressions cover this candidate; full
validation and landing belong to the lane.

## Rust runtime (#546's split issues)

- Middleware signature and per-call allocation ([#1764](https://github.com/lushly-dev/afd/issues/1764)): merged in #2328; the async-safe file journal sink in #2431.

- Built-in middleware ([#1600](https://github.com/lushly-dev/afd/issues/1600)): merged in #2356; tracing middleware is N/A, as in C++.

- Stream executor ([#1601](https://github.com/lushly-dev/afd/issues/1601)): merged in #2438.

- Cancellation signal for deadlines ([#1599](https://github.com/lushly-dev/afd/issues/1599)): the registry, batch and pre-cancel guard landed with #2221; `DirectClient` and pipeline deadlines fire the command's signal, and pipelines stop at a cancelled call: #2441.

## Follow-up parity items

- Python `McpClient.call()` fail-closed `OUTCOME_UNKNOWN` ([#2319](https://github.com/lushly-dev/afd/issues/2319)): `McpClient.call()` snapshots read-only `_meta.mutation: false` (without contradicting destructive or non-read-only markers) before dispatch, clears cached tool metadata on reconnect discovery failure, and returns non-retryable `OUTCOME_UNKNOWN` with `details.cause` on timeout, transport loss, HTTP 5xx, JSON-RPC `-32603`, or failed task poll; `spec/error-codes.md` updated (merged in #2511).
- Python & Rust `instances` setting ([#2242](https://github.com/lushly-dev/afd/issues/2242)): Python `create_server(..., instances="single" | "multiple")` and Rust `McpServer::with_instances(ServerInstances::Single | Multiple)` + `with_confirmation_key` refuse multi-instance startup when active confirmations, `relay="mcp-elicitation"`, or in-memory approval nonce stores (including inside `compose_middleware`) rely on per-process defaults, and warn once per process over HTTP when omitted (silent on stdio); C++ `afd::mcp_stdio` verified stdio-only with `state_secret` ≥ 32 bytes and `nonce_store` already supported (merged in #2527).

## Historical checkpoints

The plan's 2026-10-10 stabilization candidate is now merged (#367), and its first releases are
recorded in [release readiness](../../../operations/stabilization-release.md). Its warnings about
unmerged candidate code and broken Python 0.8.0 describe that checkpoint, not current delivery.
They do not close the runtime, client, tooling or contract-declaration gaps above.

## Next gate

Close or explicitly disposition every remaining matrix gap, keep the four languages' vector
loaders in step, and declare core 1.0 ([#1926](https://github.com/lushly-dev/afd/issues/1926)). New cross-language features keep their own
plans; their presence on one server does not close this plan.
