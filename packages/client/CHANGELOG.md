# @lushly-dev/afd-client

## 2.2.1

### Patch Changes

- [#479](https://github.com/lushly-dev/afd/pull/479) [`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e) Thanks [@Falkicon](https://github.com/Falkicon)! - Keep DirectClient approval credentials in a private exchange instead of returning them to the gated caller. Public call, pipe and DirectRegistry contexts discard caller-supplied approval evidence; only an affirmative trusted hook enables one verified retry. Preserve in-process CLI approval through the same exchange.

  Use matching client, core and server versions. Applications that submitted approval tokens directly through createDirectRegistry must migrate to DirectClient's onApprovalNeeded hook. Custom registries must support the private exchange; legacy token-in-result failures remain held and are returned without their token.

- Updated dependencies [[`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e)]:
  - @lushly-dev/afd-core@2.2.1

## 2.2.0

### Minor Changes

- [#406](https://github.com/lushly-dev/afd/pull/406) [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd) Thanks [@Falkicon](https://github.com/Falkicon)! - Add standard `actor`, `clock` and `random` fields to `CommandContext` ([#271](https://github.com/lushly-dev/afd/issues/271), [#274](https://github.com/lushly-dev/afd/issues/274)).

  - **Core:** `Actor` (`kind`: `human`, `agent`, `service`, `script` or `test`, with optional `id`, `label` and `onBehalfOf`), `Clock`, `RandomSource`, `systemClock`, `systemRandom`, `fixedClock()` (a manual clock with `set` and `advance`), `seededRandom()` (reproducible, not cryptographic) and `withContextDefaults()`. `ResultMetadata` and `TelemetryEvent` gain `actorKind`. The core registry gives handlers a clock and a random source.
  - **Server:** new `clock`, `random` and `actor` options. MCP calls run as `{ kind: 'agent' }` unless the option or `createContext` says otherwise; every context gets a clock and a random source; results carry `metadata.actorKind` (the kind only, never the id). `executionTimeMs`, the telemetry middleware and HTTP session expiry use the clock. `createDirectRegistry()` accepts the same three defaults.
  - **Client:** `DirectClient` accepts `actor` (default `{ kind: 'human' }`), `clock` and `random` (default: the registry's own); a call's own context wins.
  - **Auth:** `createAuthMiddleware` fills `context.actor` from the verified session: a human actor gets the user's `id` and `label`, other actors get `onBehalfOf`.
  - **Testing:** `createTestContext()` sets `actor: { kind: 'test' }`, a clock and a random source (`now` stops the clock); `InProcessExecutor` takes a `context` for every step and runs steps as a test actor. `fixedClock` and `seededRandom` are re-exported.

  The golden wire fixtures now include `"actorKind": "agent"` in result metadata.

  The server engine, `createDirectRegistry()` and the core registry now pass handlers a copy of the caller's context (with the defaults filled in), so changes middleware or handlers make to it no longer show on the caller's object. The CLI talks to servers over MCP, so its calls run as `agent` unless the server's `actor` option or `createContext` says otherwise; the same holds for `ScenarioExecutor`, which runs steps through the CLI.

- [#445](https://github.com/lushly-dev/afd/pull/445) [`50e17b6`](https://github.com/lushly-dev/afd/commit/50e17b60e3334b8d8ae314719e417002aa35bfd3) Thanks [@Falkicon](https://github.com/Falkicon)! - `DirectClient` handles `APPROVAL_REQUIRED` with an `onApprovalNeeded` hook ([#419](https://github.com/lushly-dev/afd/issues/419)). On `true`, the client retries the same call once with `context.approval` set to the result's `details.approvalToken`; on `false`, a hook error or without a hook, it returns the original result unchanged. `pipe()` asks when each gated step is reached. `context.timeout` bounds each attempt, the hook receives the call's `signal`, and a token that expires during the wait returns the retry's `APPROVAL_REQUIRED` (`reason: 'expired'`) without a second retry. New types: `DirectApprovalHook`, `DirectApprovalRequest`.

- [#392](https://github.com/lushly-dev/afd/pull/392) [`cf7fc58`](https://github.com/lushly-dev/afd/commit/cf7fc58dddd8b7005b50cd3a038e49849351eb63) Thanks [@Falkicon](https://github.com/Falkicon)! - Talk MCP 2026-07-28 from the client, CLI and testing tools.

  - `@lushly-dev/afd-client`: new `streamable-http` transport, built on the official MCP TypeScript SDK v2 client. It speaks MCP 2026-07-28 when the server offers it and falls back to the 2025 `initialize` handshake, so `McpClient` now talks to an AFD server's `/mcp` endpoint, the Python and Rust AFD servers, and any official MCP SDK server. It is the default for URLs that do not end in `/sse`; `protocolMode: 'auto' | 'legacy' | 'modern'` controls negotiation. `stream()` on a `/mcp` URL uses the sibling `/stream` path. The `sse` and `http` transports are deprecated and removed in 3.0.
  - `@lushly-dev/afd-cli`: `--transport` accepts `streamable-http`, and `connect`, `call --connect`, `shell` and `scenario run` infer the transport from the URL (`sse` for `/sse`, `http` for `/message`, `streamable-http` otherwise) instead of defaulting to `sse` or `http`.
  - `@lushly-dev/afd-testing`: the mock MCP servers are dual-era. `initialize` echoes a supported requested version (the newest legacy revision otherwise, instead of always `2024-11-05`), and requests carrying MCP 2026-07-28 `_meta` get `server/discover`, `resultType`, `serverInfo`, cache fields and `-32022` for unsupported versions.

- [#435](https://github.com/lushly-dev/afd/pull/435) [`0e66fdb`](https://github.com/lushly-dev/afd/commit/0e66fdb5e666f7c36037a4d126374161f563807f) Thanks [@Falkicon](https://github.com/Falkicon)! - Enforce `confirmPrompt` (`spec/command-metadata.md`, "Confirmations").

  - **Server:** `createMcpServer` and `createMcpHandler` take `confirmations` (`'off'` by default, `'enforce'` or `'require-human'`) and `confirmationKey`. A call that reaches a command with `confirmPrompt` runs only after the user accepts an MCP elicitation, through an `input_required` result on `/mcp` or a server-side elicitation on a 2025 stdio connection. Under `'enforce'` the caller can instead acknowledge: `confirm: true` on the tool, `afd-call` or a grouped tool, `confirm: [names]` on `afd-batch` and `afd-pipe`, `_meta["dev.afd/confirm"]`, or the `Afd-Confirm` header on `/rpc`, `/batch` and `/stream`. Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before the handler runs. Gated tools advertise the optional `confirm` argument.
  - **Client:** `McpClient` takes `onElicitation` to answer servers' form elicitations on the `streamable-http` transport. Without it, an `input_required` result becomes an `INPUT_REQUIRED` failure carrying the server's `inputRequests`.
  - **CLI:** at a terminal, the CLI asks a server's yes/no elicitation (`[y/N]`) on stderr; otherwise it declares no elicitation, so the server's error explains how to acknowledge.

### Patch Changes

- Updated dependencies [[`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0), [`51f6f73`](https://github.com/lushly-dev/afd/commit/51f6f737cefcc5f4b818e40b39dc675811a81a60), [`f152bb9`](https://github.com/lushly-dev/afd/commit/f152bb93c62a3fe06162705b37abcd0ddfc29fc9), [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd), [`d225fee`](https://github.com/lushly-dev/afd/commit/d225fee04831ce8c4404ce2f322a67b639efb1cd)]:
  - @lushly-dev/afd-core@2.2.0

## 2.1.0

### Patch Changes

- [#308](https://github.com/lushly-dev/afd/pull/308) [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95) Thanks [@Falkicon](https://github.com/Falkicon)! - Commands carry `destructive`, `confirmPrompt` and `undoable` in both definitions, and every surface reports them consistently ([#275](https://github.com/lushly-dev/afd/issues/275)). The canonical field list is in `spec/command-metadata.md`.

  - `@lushly-dev/afd-core`: `CommandDefinition` gains `destructive` and `confirmPrompt`, which only the Zod definitions had. `McpToolCommandMeta` gains `undoable`.
  - `@lushly-dev/afd-server`: `defineCommand` accepts `undoable`, and `toCommandDefinition()` now keeps `destructive`, `confirmPrompt` and `undoable` instead of dropping the first two. `undoable` is reported in the tool `_meta` (and in each grouped `_meta.actions` entry) when set, like `destructive`. It is also reported by `afd-detail`, `afd-help` with `format: 'full'` and `DirectRegistry.listCommands()`. `afd-help` full also reports `destructive`. `afd-docs` documents all three.
  - `@lushly-dev/afd-cli`: `afd tools` marks tools whose `_meta` sets `destructive` or `undoable`, for example `todo-delete (destructive, undoable)`.
  - `@lushly-dev/afd-client`: `createReconnectingHandoff` falls back to core's `defaultReconnectPolicy` (3 attempts, 1000 ms) when neither the options nor the handoff's `metadata.reconnect` set `maxAttempts` or `backoffMs`. It used to fall back to 5 attempts.

- [#367](https://github.com/lushly-dev/afd/pull/367) [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568) Thanks [@Falkicon](https://github.com/Falkicon)! - Enforce direct MCP call and stream deadlines and cancellation, preserve registry tool schemas and planning metadata, and validate/coalesce MCP session renewal before replaying requests.

- Updated dependencies [[`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3), [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95), [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98), [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568), [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422)]:
  - @lushly-dev/afd-core@2.1.0

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - `McpClient.batch()` and `pipe()` honour their timeouts and no longer claim that commands failed when the outcome is unknown.

  - The request now waits for `BatchOptions.timeout` or `PipelineOptions.timeoutMs` plus a 5 second margin (exported as `SERVER_DEADLINE_MARGIN_MS`), and never less than the client `timeout`. Both used to time out at the client `timeout` (30 s by default) while the server kept running.
  - **Behavior change:** when the request times out or the connection fails after it was sent, the result is an `OUTCOME_UNKNOWN` failure with `retryable: false` and details of the cause. A batch reports no per-command `results` and zero success and failure counts (it used to report every command as failed); a pipeline carries the error on one pipeline-level step (`index: -1`) instead of marking every step as failed. The server may already have run the writes, so check their effects before retrying.
  - When nothing ran (not connected, a JSON-RPC rejection, an HTTP 4xx), the result is still a definite failure, now with the specific code (`NOT_CONNECTED`, `INVALID_INPUT`, ...) instead of `BATCH_ERROR`/`PIPELINE_ERROR`.
  - `callTool()` and `request()` take an optional `{ timeout }` (`RequestOptions`) for one request.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Make McpClient and DirectClient return the same structured failures.

  - **JSON-RPC errors map to AFD codes** instead of a retryable `INTERNAL_ERROR` ("contact support") carrying the client stack: -32700 `PARSE_ERROR`, -32600 `INVALID_REQUEST`, -32601 `METHOD_NOT_FOUND`, -32602 `INVALID_INPUT`, -32603 `INTERNAL_ERROR` (retryable), and the AFD server's -32000 `REQUEST_REJECTED` and -32001 `SESSION_NOT_FOUND` (retryable). Other codes are `JSON_RPC_ERROR`. The server's `error.data.suggestion` is used when present, `details.jsonRpcCode` holds the code, and no stack is attached. The HTTP and SSE transports now read the JSON-RPC error body of a non-2xx response (the AFD server sends -32700, -32600, -32000 and -32001 that way) instead of throwing `HTTP error: 400`.
  - Other `call()` failures are specific too: `TIMEOUT` (with the "may still have run" caveat), `NOT_CONNECTED`, `CONNECTION_ERROR`, and `HTTP_<status>` (retryable for 5xx and 429). `request()` throws the new exported `NotConnectedError`, `RequestTimeoutError`, `JsonRpcResponseError` and `HttpStatusError`.
  - **`DirectClient.call()` no longer rejects** when a hand-written registry, a handler or client middleware throws: it returns a `COMMAND_EXECUTION_ERROR` failure without the exception text (via core's `executionFailure`), like `createDirectRegistry()` and the MCP server. `pipe()` records such a step as failed.
  - **`DirectTransport`** (now in its own module, still exported from the package root) answers an unknown tool with a proper `UNKNOWN_TOOL` `CommandResult` (with `suggestion`, `retryable: false`, and the `UnknownToolError` as `data`) instead of the raw `UnknownToolError` JSON that McpClient reported as `TOOL_ERROR`. A throwing registry gives a sanitized `COMMAND_EXECUTION_ERROR` result instead of a JSON-RPC error with the exception message; `tools/call` without a string name gets -32602. `UNKNOWN_TOOL` from `DirectClient` is now also `retryable: false`.
  - **`createReconnectingHandoff()` accepts `McpClient`**: its client parameter is the new `HandoffCommandClient` interface (`call(name, args)`), which both clients satisfy. Passing an `McpClient` used to fail with TS2345.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix McpClient connection lifecycle events, support `transport: 'direct'`, and document which servers McpClient can talk to.

  - **`connected` fires after the tools list is loaded**, so `getTools()` is ready in the handler. A failed tools refresh no longer fails `connect()` (after `connected` had already fired); the list stays empty.
  - Events are delivered to a snapshot of the handlers, so a handler that unsubscribes during delivery no longer makes the next one miss the event.
  - **Less reconnect noise:** failed reconnect attempts no longer each emit `error` and flip the state to `error` and back. Each attempt emits `reconnecting`; when all fail, one `error` ("Max reconnection attempts reached", with the last failure as `cause`) is emitted. Transport errors during connecting are reported once, by `connect()`.
  - **Backoff has a cap and jitter**: `reconnectDelay * 2^(n-1)` plus up to 100 ms of jitter, capped by the new `maxReconnectDelay` option (default 30 s), as in `createReconnectingHandoff()`.
  - **`HttpTransport` detects connection loss**: after 3 consecutive requests that get no HTTP response it reports the connection as closed, so `autoReconnect` now works for the `http` transport.
  - **`transport: 'direct'`** now works instead of throwing: pass `registry` (for example `createDirectRegistry(commands)`), no URL needed. `call()`, `batch()`, `pipe()` and `stream()` run in process (batches and pipelines through core's `executeBatch()`/`executePipeline()`, streams through `executeStream()`). `McpClientConfig.transport` is now typed `'sse' | 'http' | 'direct'` (`McpTransportType`); `'websocket'` and `'stdio'`, which always threw at connect time, are rejected by the type and by the constructor with an error naming the supported transports.
  - The README and API docs now state that McpClient targets AFD servers: it does not implement the MCP Streamable HTTP transport or the legacy SSE `endpoint` event, so servers built on the official MCP SDK (which answer 406/400) need the official SDK client.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Make `McpClient.stream()` end honestly and parse server-sent events per the spec.

  Behavior changes:

  - **A stream always ends with a `complete` or `error` chunk.** A stream that closes without one now yields a `STREAM_TRUNCATED` error chunk (`retryable: false`) instead of ending silently like a success. `[DONE]` without a `complete` chunk counts as truncated.
  - **A stream's own `timeout` is reported as `STREAM_TIMEOUT`** (`retryable: true`), no longer as `STREAM_CANCELLED`. Aborting `options.signal` is still `STREAM_CANCELLED`.
  - **`stream()` refuses to run before `connect()`**: it yields one `NOT_CONNECTED` error chunk and sends nothing.
  - **`disconnect()` aborts active streams**, which end with `STREAM_CANCELLED`.
  - **The stream URL keeps the base path**: `<base>/stream/<command>`, where `<base>` is the client URL without a trailing `/sse`, `/message` or `/messages` (the Python client's rule). `https://host/api/mcp/sse` used to stream from `https://host/stream/<command>`.
  - **One event is bounded** by the new `maxStreamEventSize` option (default 1 MiB); a larger event ends the stream with `STREAM_EVENT_TOO_LARGE` instead of buffering without limit. Parsing is linear in the stream size (the line buffer is no longer re-scanned on every read).
  - **SSE parsing follows the spec**: `data:` without a space, multi-line `data` fields (joined with `\n`), comments, and CR/CRLF line endings. Events that are not stream chunks are skipped.
  - An HTTP error whose body is an AFD failure (such as the server's `METHOD_NOT_ALLOWED`) is passed through as the error chunk.

  The built-in SSE handoff handler (`sseHandler` with credentials) uses the same parser, so its messages now follow the same rules, and an oversized event reports `SseEventTooLargeError` through `onError` and disconnects.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Enforce `DirectCallContext.timeout`, which was documented but ignored. When it passes, the signal the command receives (the caller's `signal` combined with `AbortSignal.timeout`) aborts and the call resolves to a structured `TIMEOUT` failure, even if the command ignores the signal. In `pipe()` the timeout applies per step. Values that are not positive finite numbers are ignored.

  Export an `isUnknownToolError(result)` type guard. `call<T>()` returns `CommandResult<T> | CommandResult<UnknownToolError>`, so the documented `if (result.success) result.data.id` never narrowed; after `isUnknownToolError(result)` is false, `result` is `CommandResult<T>`.

  Minor: a new export; callers that passed `timeout` now get the documented behaviour.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `createDirectRegistry(commands, options?)` to `@lushly-dev/afd-server`: a `DirectClient`-compatible registry that runs every call through the same execution engine as `createMcpServer` (Zod input validation, middleware, error sanitization, `onCommand`/`onError`). It lists and runs only the commands exposed to one interface (`'agent'` by default; flags a command leaves out fall back to `defaultExpose`) and returns `COMMAND_NOT_EXPOSED` or `COMMAND_NOT_FOUND` otherwise. Hand-written registries that call `command.handler(input)` skipped all of this; the todo-directclient example, the showcase pipeline demo and the `afd-directclient` skill now use `createDirectRegistry`.

  `DirectClient` gains an `allow?: (commandName) => boolean` option. Refused commands return `COMMAND_NOT_ALLOWED` without reaching the registry and are left out of `listCommands()`, `listCommandNames()` and `hasCommand()`. `UNKNOWN_TOOL` failures now carry a `suggestion`.

  Minor: new API and a new opt-in option.

### Patch Changes

- [#232](https://github.com/lushly-dev/afd/pull/232) [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1) Thanks [@Falkicon](https://github.com/Falkicon)! - Bound fuzzy matching of unknown command names and contain exceptions thrown during input validation. `findSimilarTools` now returns no suggestions for names longer than `MAX_SIMILARITY_INPUT_LENGTH` (128), skips candidates whose length difference rules out the 0.4 threshold, and uses a two-row Levenshtein, so a large name sent to `afd-call`, `afd-detail` or `DirectClient` no longer blocks the event loop for seconds. Error messages echo at most 128 characters of an unknown name (new `truncateName` helper), and the client uses the core matcher instead of its own copy. In the server, an exception thrown by a Zod `.refine`, `.superRefine`, `.transform` or `.preprocess` callback now returns a `VALIDATION_ERROR` result, with the exception text only in `devMode`, instead of rejecting: `/batch` and `afd-batch` no longer answer HTTP 500 after earlier commands in the batch ran, and `afd-pipe` and `/stream` no longer expose raw exception text. A throwing or rejecting `onCommand` or `onError` hook no longer changes a command's result, and handler results are copied instead of mutated, so frozen results work.

- [#255](https://github.com/lushly-dev/afd/pull/255) [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b) Thanks [@Falkicon](https://github.com/Falkicon)! - Update the `eventsource` dependency of the SSE transport from 4.x to 5.x. The client calls the same API (the named `EventSource` export and the `fetch` option that adds headers), so its behavior is unchanged. eventsource 5 is ESM only, declares support for Node.js 22.12 or later, and fails the connection if a single SSE line exceeds 100 MB.

- [#253](https://github.com/lushly-dev/afd/pull/253) [`d091ef3`](https://github.com/lushly-dev/afd/commit/d091ef386cbbf141022b805f5382e47fcf94c95c) Thanks [@Falkicon](https://github.com/Falkicon)! - `McpClient.stream()` now runs in the client's MCP session. Over HTTP and SSE it sends the `Mcp-Session-Id` that `initialize` returned, so `/stream/<command>` sees the session's active context (`afd-context-enter`) the way `call()` does. Before, streams carried no session and ran statelessly: a command hidden by the active context could still be streamed. If the server has expired the session (HTTP 404), the client starts a new session and retries the stream once, as it already did for other requests; without a session to renew, the server's structured failure is returned as the error chunk.

  `HttpTransport` and `SseTransport` expose the session as a read-only `sessionId` and can start a new one with `renewSession()`. Both are optional members of the `Transport` interface, so custom transports keep compiling.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Make HTTP context scoping per client, add a request-context hook, and make the HTTP transport conform to JSON-RPC.

  Behavior changes in `@lushly-dev/afd-server`:

  - **Context state is per session.** `afd-context-enter`/`exit` no longer change one process-wide stack shared by every HTTP client. When `contexts` are configured, `initialize` on `/message` returns an `Mcp-Session-Id` header; requests that repeat it share that session's stack. Requests without it are stateless: they see no active context, and enter/exit return `SESSION_REQUIRED`. An unknown or expired session ID gets HTTP 404 (JSON-RPC `-32001`). Sessions expire after `sessionIdleTimeoutMs` (default 30 minutes) and are capped by `maxSessions` (default 1000, least recently used evicted). stdio keeps a single stack. Stacks hold at most 16 contexts (`CONTEXT_DEPTH_EXCEEDED`), and re-entering the active context is a no-op.
  - **JSON-RPC notifications get HTTP 202 with an empty body.** A `/message` or `/rpc` message with `"jsonrpc": "2.0"` and no `id` is never answered with a response object. `/message` does not execute such notifications; `/rpc` still runs the command. The simple `/rpc` format without `jsonrpc` is still always answered.
  - **Protocol errors are JSON-RPC error objects** on `/message` and `/rpc`, instead of `{ success: false }` bodies: `-32700` (HTTP 400), `-32600` including batch arrays (HTTP 400), `-32601`, `-32602` and `-32603` (HTTP 200, with the request `id`), and `-32000` for Host/Origin/Content-Type/size rejections (original HTTP status). Recovery guidance is in `error.data.suggestion`. `/batch` and `/stream` keep AFD error bodies.
  - **`GET /stream/<command>` is refused for `mutation: true` commands** with HTTP 405 (`Allow: POST`, code `METHOD_NOT_ALLOWED`), so link prefetchers cannot trigger writes. Use `POST /stream/<command>`.
  - **`/sse` is bounded:** at most `maxSseConnections` (default 100) concurrent connections, then HTTP 503 with `Retry-After`; a `: ping` heartbeat every 25 seconds; closed connections are removed.
  - New `createContext(req)` option: its result is merged into the `CommandContext` of every remotely executed command (`tools/call`, `afd-call`, batch items, pipeline steps, `/rpc`, `/batch`, `/stream`). `traceId`, `signal` and `interface` (now `'mcp'` for remote calls) cannot be overridden. `context.signal` now aborts when an HTTP client disconnects on every route, and stdio passes the MCP request's cancellation signal. Pipeline `$input` no longer exposes the execution context, so request values cannot be copied into step inputs. The rate-limit docs now key on a `createContext` value instead of `traceId` or an unset `userId`.
  - `start()` logs the resolved transport to stderr, because `transport: 'auto'` picks stdio whenever stdin is not a TTY (Docker without `-t`, systemd, pm2, CI) and the HTTP port then never opens. The JSDoc now states the real defaults: `toolStrategy: 'grouped'` and `cors` following `devMode`.

  `@lushly-dev/afd-client`: the HTTP and SSE transports repeat the `Mcp-Session-Id` returned by `initialize`, and when the server answers 404 for a forgotten session they start a new session and retry the request once.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Pipeline variable references now follow `spec/pipeline-variables.md` in `executePipeline`, `afd-pipe` and `DirectClient.pipe`.

  **Behavior change: `$input` is the request's own `input`.** `PipelineRequest` has a new optional `input` field (any JSON value, checked in request preflight), and `$input` / `$input.<path>` resolve only to it. Before, `$input` resolved to the executor's context: for `DirectClient.pipe` that was the caller's whole call context, so a step could copy trace IDs, auth or any custom context value into a command input. The context still reaches every command, but no reference can read it. Pass pipeline data as `pipe({ input, steps })`. `PipelineContext.pipelineInput` is now typed `unknown`.

  Other changes:

  - Only whole strings of the reference forms resolve. Other `$` strings such as `$9.99` or `$HOME` used to become `undefined` and are now passed through unchanged; `$$` escapes a literal `$` (`"$$prev"` becomes `"$prev"`); strings over 1024 characters are literals.
  - Paths follow only own keys of plain JSON objects and in-bounds array indices. `constructor.constructor` no longer reaches `Function`, and `__`-prefixed segments, prototype properties, getters and array `length` never resolve.
  - An unresolved reference is omitted from an object and becomes `null` in an array. In `when` conditions it is absent: `$exists` is false and `$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` are false (`$ne` against a missing field used to be true). A condition operand that is not a reference is absent too.
  - Step inputs or a request `input` nested deeper than 64 levels are rejected with `VALIDATION_ERROR` before any step runs, instead of throwing `RangeError`. Condition evaluation and reference resolution run inside the per-step error handling.
  - Step data is copied with `structuredClone` when it is recorded and when a reference resolves it, so a handler that mutates its input no longer changes an earlier step's recorded data.
  - Resolution moved to a new `pipeline-variables` module; the public exports are unchanged. The `afd-pipe` tool schema documents `input` and the reference syntax.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix what agents see in `tools/list` and add opt-in bootstrap tools.

  - **`tools/list` schema change.** Command input schemas are now generated in Zod input mode (`zodToJsonSchema(schema, { io })`, default `'input'`; `output` schemas keep output mode). Fields with `.default()` are no longer listed as `required` (the todo example's `todo-list` required `sortBy`, `sortOrder`, `limit` and `offset`), `additionalProperties: false` is no longer added to non-strict objects, and a `.transform()` in an input schema no longer makes `defineCommand` throw; it is advertised by its input type. `examples` are typed as `z.input`. Core `JsonSchema.type` and the DirectClient parameter type now include `'integer'`, which Zod emits for `z.number().int()`, and DirectClient validation accepts integers for it.
  - **Grouped tools.** In the default `grouped` strategy each group tool now carries every action's command name, input schema and metadata (`requires`, `examples`, `mutation`, `outputSchema`, `contexts`) in `_meta.actions`, small groups also inline the per-action schemas as `params.anyOf` branches, and `afd-detail` is listed. Meta-tool schemas are generated from the Zod schemas the router validates, and `afd-batch` now advertises `options.parallelism`.
  - **New `bootstrap` server option** (default `false`). `bootstrap: true` registers `afd-help`, `afd-docs` and `afd-schema` as MCP-exposed tools that describe only the MCP-exposed commands in the active context. `getBootstrapCommands()` and `createAfd{Help,Docs,Schema}Command()` now return `ZodCommandDefinition`s with `expose: { mcp: true }`, so `server.execute('afd-help')` works and no `as unknown as` cast is needed. `afd-schema` with `format: 'typescript'` now returns generated TypeScript input types in `typescript` (confidence 1).
  - **Validation and names.** Invalid `afd-discover` and `afd-detail` arguments (such as `{ search: 123 }` or `{}`) return a `VALIDATION_ERROR` result instead of throwing a `TypeError` (HTTP 500 over HTTP, raw error text over stdio), and `afd-call` validates its arguments the same way; invalid batch and pipeline envelopes keep `INVALID_BATCH_REQUEST`/`INVALID_PIPELINE_REQUEST` and now include the failing paths in `details.errors`. Server creation throws on duplicate command names and on names the server handles itself (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`; the bootstrap names with `bootstrap: true`; the `afd-context-*` names with `contexts`).

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1)]:
  - @lushly-dev/afd-core@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-core@1.0.0

## 1.0.0

### Minor Changes

- ### Breaking Changes
  - **Node.js 22+ required** — dropped Node 20 support, CI tests on 22.x and 24.x
  - **Zod 4** — upgraded from Zod 3. `zod-to-json-schema` replaced with built-in `z.toJSONSchema()`. `ZodEffects` replaced by `ZodPipe` for transforms. Schema introspection uses `.unwrap()`/`.removeDefault()` instead of `._def.innerType`.
  - **eventsource 4** — named import (`{ EventSource }` instead of default), custom `fetch` option for headers instead of `EventSourceInitDict`. `@types/eventsource` removed (types now bundled).

  ### Other Updates
  - TypeScript target bumped to ES2024
  - All dependencies updated to latest: commander 14, conf 15, glob 13, ora 9, jsdom 28, dotenv 17, vite 8, commitlint 20
  - Replaced custom `scripts/release.mjs` with `@changesets/cli` for versioning and changelogs
  - Removed redundant eslint from React example (biome covers React hooks rules)
  - Refactored `direct.ts` — extracted `unknown-tool.ts` and `direct-validation.ts`
  - Refactored `executor.ts` — extracted `validator.ts`
  - CI now runs `pnpm check` (lefthook quality gate) to prevent local/CI desync

### Patch Changes

- Updated dependencies []:
  - @lushly-dev/afd-core@1.0.0
