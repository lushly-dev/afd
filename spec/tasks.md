# Tasks

Profile: `tasks`. This page belongs to the `tasks` profile of the
[contract registry](./registry.md): an implementation that does not claim the profile need not
implement it. A server claims it when it serves the MCP Tasks extension.

A command's `task` says whether an MCP `tools/call` to it may run as a task under the Tasks
extension (`io.modelcontextprotocol/tasks`,
[SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension), revision 2026-07-28):

| `task` | A request that declares the extension in its client capabilities | One that does not |
| --- | --- | --- |
| `never` (default) | Inline | Inline |
| `optional` | A task | Inline |
| `required` | A task | JSON-RPC `-32021` (missing required client capability), naming the extension |

**What may be a task.** Registration refuses `optional` and `required` on a command that declares
`confirmPrompt`, an `approval` other than `not-required`, or `confirmationMode`: a task never asks
a person, so no AFD task is ever `input_required`. Only a `tools/call` that routes to one command
(its own tool, a hybrid first-class tool, a grouped tool or `afd-call`) can become a task.
`afd-batch` and `afd-pipe` never do: an `optional` step runs inline, and a step naming a `required`
command fails the whole request with `INVALID_BATCH_REQUEST` or `INVALID_PIPELINE_REQUEST` before
any step runs. The HTTP routes, `DirectClient`, in-process registries and the CLI always run
inline. The server never answers with a task to a request that did not declare the extension.
A request declares it in its own `_meta` client capabilities on MCP 2026-07-28; a 2025 request
never does, whatever its session declared at `initialize` (the extension is not defined for
2025-11-25), so it is treated as not declaring it, `tasks/*` included (`-32021`).

**Only for callers the server can tell apart.** A task's owner protects it only if the server can
tell its callers apart, so a server creates no task otherwise:
- without an HTTP request (stdio, or another transport with one client per connection), callers
  are told apart by their connection, and tasks work as this section says;
- over HTTP, the call must carry verified credentials ([authorization](./authorization.md)), or
  the host must declare that its per-request hook identifies every caller (Rust:
  `TaskOptions::with_callers_identified_by_hook`, which counts only while a hook is installed).
  The declaration is a promise that every distinct caller maps to a distinct actor.

A server that cannot tell its HTTP callers apart behaves as a server without the extension: it
does not declare it, `tasks/get`, `tasks/update` and `tasks/cancel` answer `-32601`, and an
`optional` command runs inline. A `required` command, which cannot run inline, fails before
anything runs with `UNAUTHORIZED` (`retryable: false`), whose suggestion says to configure
authorization or the hook declaration, whether or not the request declared the extension. This is
decided per request, from the configuration and the request: a `required` command is never
refused at registration, since authorization may be configured later.

**Creating one.** Everything an inline call meets before dispatch happens first: the HTTP layer's
403 ([authorization, M6](./authorization.md#m6-scopes)), the context hook and the scope check.
Then:
- the task id holds at least 128 bits from a cryptographic random source, so it cannot be guessed;
- the record is in the `TaskStore` before the server answers with `CreateTaskResult`; a store that
  cannot record it fails the call, and nothing runs;
- the record's **owner** is the call's [principal binding](./authorization.md#m8-the-principal-binding),
  and it holds no token. Credentials that cannot be bound (M8) get no task: the call fails with
  an internal error that names no one, and nothing runs.

**Running one.** The command runs through the normal executor (validation, middleware, handler)
with a fresh context carrying the call's actor, credentials and trace. A task's **run budget**
(`maxRunMs`, default one hour) is separate from how long its finished result is kept
(**post-completion retention**, `ttlMs` on `TaskOptions`, default one hour):
- **Initial and finished `ttlMs`.** On `CreateTaskResult` and while `working`, the wire `ttlMs`
  (counted from `createdAt`, per SEP-2663) is `maxRunMs + retention` (two hours by default), capped
  by any host token-expiry grace and the JSON safe-integer ceiling (`2^53 - 1`). Once the task
  reaches a terminal status (`completed`, `failed` or `cancelled`) at `finishedAt`, its stored and
  reported `ttlMs` is tightened atomically to `min(maxRunMs, max(0, finishedAt - createdAt)) +
  retention` (still capped by any token-expiry grace and never wider than the initial `ttlMs`), so
  a task that finishes near its run budget stays readable for the full retention period after
  finishing and expires once `finishedAt + retention` passes without ever widening past its
  advertised TTL.
- **Cancellation and deadlines.** The task's cancellation signal fires on `tasks/cancel`, when its
  run budget (`createdAt + maxRunMs`) ends, when its `ttlMs` ends, and at `credentials.expiresAt`,
  and the server then stops the handler. If the run budget ends while the task is still working
  (before token expiry and before `ttlMs`), it completes with the failure `TIMEOUT` (retryable
  unless the command is a `mutation` whose handler started, whose suggestion then says to check its
  effect), kept for the retention period; a handler that had already returned before the run budget
  stopped it keeps its result as long as the token and `ttlMs` still hold. When its `ttlMs` ends
  the task is gone.
- **Its result** is the `CallToolResult` an inline call would return, `structuredContent` included,
  with status `completed`; a failed `CommandResult` is `completed` with `isError: true`, as the
  extension says. `failed` is only for a JSON-RPC error. A task stopped by `tasks/cancel` is
  `cancelled`; a handler that had already returned when the cancel arrived keeps its result.
- **The token bounds it.** A task never outlives the token that started it: when
  `credentials.expiresAt` passes while it is working, it is stopped and completes with the failure
  `TASK_TOKEN_EXPIRED` ([error codes](./error-codes.md#tasks-profile-tasks)): start it again with a new token.
  A task whose token expired before it could start completes the same way without running, and
  a result that arrives after `expiresAt` is not delivered. The failure is retryable unless the
  command is a `mutation` whose handler started, since it may have made its change. A host may
  also end the task's `ttlMs` there, or a grace after it.
- **Progress** updates `statusMessage` and `lastUpdatedAt`; no progress or log notification is sent
  for a task (the extension delivers none).

**`tasks/get`, `tasks/update` and `tasks/cancel`.** Each request passes the same authorization as a
`tools/call` ([M6, other methods](./authorization.md#other-methods)), and then the **owner check**:
the store returns a task only when the caller's principal binding equals its owner. A task owned by
anyone else, an expired task and an unknown id get the same answer, the extension's answer for an
unknown task (`-32602`), so an id reveals nothing. The server checks the owner and the TTL again
itself, whatever the store returned. On an authorized server the owner must also still hold what a
call of the task's command needs, as far as it is known without the input, to read or update it: the
command's `scopes`, or under a resolver its `visible` and `known` (else the request is refused with
`INSUFFICIENT_SCOPE`, as a request that names no command is for its required scopes). `tasks/cancel`
does not ask that, since stopping a task only takes authority away. A task whose command no longer
exists for its owner ([hidden commands](./authorization.md#hidden-commands)) gets the unknown-task
answer on all three. `tasks/update` finds no task
waiting for input, and answers as the extension says for that. `tasks/cancel` requests cooperative
cancellation; a finished task is unchanged. `Mcp-Name` carries the task id on Streamable HTTP.

**The store.**

```text
TaskStore
    create(record)                      // durable before it returns
    get(id, owner) -> record | none     // none when the owner differs
    update(id, owner, change)
    expire(now) -> count                // removes tasks past their ttl
```

The default store is in memory and serves one process, and it is bounded so that one principal
cannot exhaust it: a store may refuse a new task when its owner, or the store, holds as many as it
allows, and the call then fails with `RATE_LIMITED` (retryable) and nothing runs. It may drop a
finished task before its `ttlMs` ends to make room, so finished results cannot keep other callers
out. A server also bounds how many tasks one process runs at once, whatever its store allows. A host
with several processes behind one URL supplies a shared store; a `tasks/cancel` answered by another
process reaches the task through the store.
