# @lushly-dev/afd-server

## 2.0.0

### Major Changes

- [#254](https://github.com/lushly-dev/afd/pull/254) [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc) Thanks [@Falkicon](https://github.com/Falkicon)! - Remove the APIs deprecated for this major version:

  - `@lushly-dev/afd-core` no longer re-exports `GitHubConnector`, `PackageManagerConnector` and their types (`GitHubConnectorOptions`, `Issue`, `IssueCreateOptions`, `IssueFilters`, `PrCreateOptions`, `PullRequest`, `PackageManager`, `PackageManagerConnectorOptions`) from its root entry. Import them from `@lushly-dev/afd-core/connectors`. The root entry now bundles for the browser.
  - `resolveReference`, the old alias of `resolveVariable`, is removed from `@lushly-dev/afd-core`. Use `resolveVariable`.
  - `createMcpServer()` no longer accepts `stdio: boolean`. Use `transport: 'stdio' | 'http' | 'auto'`. Passing `stdio` now throws instead of being silently ignored, because ignoring `stdio: false` would switch a server to auto-detection.
  - `@lushly-dev/afd-view-state` no longer re-exports `createViewStateCommands` from its root entry. Import it from `@lushly-dev/afd-view-state/commands`.

### Minor Changes

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `createDirectRegistry(commands, options?)` to `@lushly-dev/afd-server`: a `DirectClient`-compatible registry that runs every call through the same execution engine as `createMcpServer` (Zod input validation, middleware, error sanitization, `onCommand`/`onError`). It lists and runs only the commands exposed to one interface (`'agent'` by default; flags a command leaves out fall back to `defaultExpose`) and returns `COMMAND_NOT_EXPOSED` or `COMMAND_NOT_FOUND` otherwise. Hand-written registries that call `command.handler(input)` skipped all of this; the todo-directclient example, the showcase pipeline demo and the `afd-directclient` skill now use `createDirectRegistry`.

  `DirectClient` gains an `allow?: (commandName) => boolean` option. Refused commands return `COMMAND_NOT_ALLOWED` without reaching the registry and are left out of `listCommands()`, `listCommandNames()` and `hasCommand()`. `UNKNOWN_TOOL` failures now carry a `suggestion`.

  Minor: new API and a new opt-in option.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Add a transport-free `@lushly-dev/afd-server/define` entry point. It exports `defineCommand`, `ZodCommandDefinition`, `ZodCommandOptions`, the schema helpers (`zodToJsonSchema`, `getRequiredFields`, `isObjectSchema`), the result helpers (`success`, `failure`, `error`, `isSuccess`, `isFailure`) and `defaultExpose`, and nothing in its module graph imports the MCP SDK or a Node.js builtin, so browser code can define commands (esbuild `--platform=browser` bundles it). The root entry is unchanged.

  To support it, `@lushly-dev/afd-core` adds two browser-safe subpaths, `@lushly-dev/afd-core/commands` and `@lushly-dev/afd-core/result`. `@lushly-dev/afd-auth/commands` now imports from `/define`, so it no longer loads the MCP transport either.

  Minor for server and core: new subpath exports, no changes to existing ones.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - `createRetryMiddleware` now backs off exponentially, as its documentation said, instead of linearly: retry `n` backs off `min(maxDelay, retryDelay * 2 ** (n - 1))`. New options: `maxDelay` caps each backoff (default 5000 ms) and `jitter` (default `true`) randomizes each wait to between half and all of the backoff; pass `jitter: false` for exact waits. The wait now ends when `context.signal` aborts, and the middleware then returns the last failure without retrying, so a disconnected client or an expired batch deadline no longer keeps a command retrying. Invalid options (a negative or fractional `maxRetries`, a negative or NaN `retryDelay`, a negative or infinite `maxDelay`) throw when the middleware is created; a negative `maxRetries` used to skip the command and return `RETRY_EXHAUSTED`, which is no longer produced.

### Patch Changes

- [#232](https://github.com/lushly-dev/afd/pull/232) [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1) Thanks [@Falkicon](https://github.com/Falkicon)! - Bound fuzzy matching of unknown command names and contain exceptions thrown during input validation. `findSimilarTools` now returns no suggestions for names longer than `MAX_SIMILARITY_INPUT_LENGTH` (128), skips candidates whose length difference rules out the 0.4 threshold, and uses a two-row Levenshtein, so a large name sent to `afd-call`, `afd-detail` or `DirectClient` no longer blocks the event loop for seconds. Error messages echo at most 128 characters of an unknown name (new `truncateName` helper), and the client uses the core matcher instead of its own copy. In the server, an exception thrown by a Zod `.refine`, `.superRefine`, `.transform` or `.preprocess` callback now returns a `VALIDATION_ERROR` result, with the exception text only in `devMode`, instead of rejecting: `/batch` and `afd-batch` no longer answer HTTP 500 after earlier commands in the batch ran, and `afd-pipe` and `/stream` no longer expose raw exception text. A throwing or rejecting `onCommand` or `onError` hook no longer changes a command's result, and handler results are copied instead of mutated, so frozen results work.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Resolve command exposure per flag everywhere, as `ExposeOptions` documents: each flag a command's `expose` leaves out falls back to `defaultExpose`. The core registry (`listByExposure`, `execute` with `context.interface`) used to treat any explicit `expose` object as replacing all defaults, so `expose: { mcp: true }` hid a command from the in-app agent and palette, unlike `createDirectRegistry` and the Python implementation. MCP and CLI stay opt-in. New `isExposedTo(command, interface)` helper.

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

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - `PipelineStep.stream` and `PipelineOptions.onProgress` were validated and documented but never used. Both are now `@deprecated` as not implemented, and `executePipeline()` (so `afd-pipe` and `DirectClient.pipe`) rejects a step with `stream: true` the way it rejects `options.parallel`: that step fails with `UNSUPPORTED_OPTION` and every other step is `skipped`, before any command runs. `stream: false` is still accepted, and `onProgress` is accepted but never called. The docs for `executeStream()`, the registry's `executeStream()`, `StreamableCommand` and the server's `/stream` endpoint now say that streaming is not incremental: the handler runs to completion and its result is then sent as chunks (one per array item).

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Pipeline variable references now follow `spec/pipeline-variables.md` in `executePipeline`, `afd-pipe` and `DirectClient.pipe`.

  **Behavior change: `$input` is the request's own `input`.** `PipelineRequest` has a new optional `input` field (any JSON value, checked in request preflight), and `$input` / `$input.<path>` resolve only to it. Before, `$input` resolved to the executor's context: for `DirectClient.pipe` that was the caller's whole call context, so a step could copy trace IDs, auth or any custom context value into a command input. The context still reaches every command, but no reference can read it. Pass pipeline data as `pipe({ input, steps })`. `PipelineContext.pipelineInput` is now typed `unknown`.

  Other changes:

  - Only whole strings of the reference forms resolve. Other `$` strings such as `$9.99` or `$HOME` used to become `undefined` and are now passed through unchanged; `$$` escapes a literal `$` (`"$$prev"` becomes `"$prev"`); strings over 1024 characters are literals.
  - Paths follow only own keys of plain JSON objects and in-bounds array indices. `constructor.constructor` no longer reaches `Function`, and `__`-prefixed segments, prototype properties, getters and array `length` never resolve.
  - An unresolved reference is omitted from an object and becomes `null` in an array. In `when` conditions it is absent: `$exists` is false and `$eq`/`$ne`/`$gt`/`$gte`/`$lt`/`$lte` are false (`$ne` against a missing field used to be true). A condition operand that is not a reference is absent too.
  - Step inputs or a request `input` nested deeper than 64 levels are rejected with `VALIDATION_ERROR` before any step runs, instead of throwing `RangeError`. Condition evaluation and reference resolution run inside the per-step error handling.
  - Step data is copied with `structuredClone` when it is recorded and when a reference resolves it, so a handler that mutates its input no longer changes an earlier step's recorded data.
  - Resolution moved to a new `pipeline-variables` module; the public exports are unchanged. The `afd-pipe` tool schema documents `input` and the reference syntax.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - The server engine now runs `afd-batch`, `/batch` and `/stream` through the core `executeBatch()` and `executeStream()` executors, with its own `executeCommand` as the callback, and builds thrown-handler failures with the core `executionFailure()`. The server, the core registry and DirectClient now share one batch and stream implementation. Observable differences from the server's former copies: an invalid batch envelope's `INVALID_BATCH_REQUEST` suggestion uses the core wording; a stream whose `context.signal` is aborted before or during execution ends with a single `STREAM_ABORTED` error chunk (the command does not run when the signal was already aborted); a failure result without an `error` streams as `COMMAND_FAILED` with a suggestion; stream `STREAM_ERROR` chunks carry a suggestion; a callback that rejects becomes a per-entry `COMMAND_EXECUTION_ERROR` instead of rejecting the whole batch; and in `devMode` a thrown non-`Error` value no longer gets a synthetic stack in `details`.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Tool `_meta` now includes `destructive` when a command sets it, so `afd validate --execute` and other clients can skip destructive tools as well as mutations.

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix what agents see in `tools/list` and add opt-in bootstrap tools.

  - **`tools/list` schema change.** Command input schemas are now generated in Zod input mode (`zodToJsonSchema(schema, { io })`, default `'input'`; `output` schemas keep output mode). Fields with `.default()` are no longer listed as `required` (the todo example's `todo-list` required `sortBy`, `sortOrder`, `limit` and `offset`), `additionalProperties: false` is no longer added to non-strict objects, and a `.transform()` in an input schema no longer makes `defineCommand` throw; it is advertised by its input type. `examples` are typed as `z.input`. Core `JsonSchema.type` and the DirectClient parameter type now include `'integer'`, which Zod emits for `z.number().int()`, and DirectClient validation accepts integers for it.
  - **Grouped tools.** In the default `grouped` strategy each group tool now carries every action's command name, input schema and metadata (`requires`, `examples`, `mutation`, `outputSchema`, `contexts`) in `_meta.actions`, small groups also inline the per-action schemas as `params.anyOf` branches, and `afd-detail` is listed. Meta-tool schemas are generated from the Zod schemas the router validates, and `afd-batch` now advertises `options.parallelism`.
  - **New `bootstrap` server option** (default `false`). `bootstrap: true` registers `afd-help`, `afd-docs` and `afd-schema` as MCP-exposed tools that describe only the MCP-exposed commands in the active context. `getBootstrapCommands()` and `createAfd{Help,Docs,Schema}Command()` now return `ZodCommandDefinition`s with `expose: { mcp: true }`, so `server.execute('afd-help')` works and no `as unknown as` cast is needed. `afd-schema` with `format: 'typescript'` now returns generated TypeScript input types in `typescript` (confidence 1).
  - **Validation and names.** Invalid `afd-discover` and `afd-detail` arguments (such as `{ search: 123 }` or `{}`) return a `VALIDATION_ERROR` result instead of throwing a `TypeError` (HTTP 500 over HTTP, raw error text over stdio), and `afd-call` validates its arguments the same way; invalid batch and pipeline envelopes keep `INVALID_BATCH_REQUEST`/`INVALID_PIPELINE_REQUEST` and now include the failing paths in `details.errors`. Server creation throws on duplicate command names and on names the server handles itself (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`; the bootstrap names with `bootstrap: true`; the `afd-context-*` names with `contexts`).

- [#232](https://github.com/lushly-dev/afd/pull/232) [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1) Thanks [@Falkicon](https://github.com/Falkicon)! - Re-export the core `error(code, message, options)` helper from `@lushly-dev/afd-server`, alongside `success` and `failure`, so the documented `import { defineCommand, success, error } from '@lushly-dev/afd-server'` compiles.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Cut the token cost of tool output. MCP tool results are now compact JSON instead of pretty-printed. A `COMMAND_NOT_FOUND` suggestion from command execution (direct tool calls, `/rpc`, batch entries, pipeline steps) no longer lists every command name, which defeated the lazy strategy: like `afd-call` and `afd-detail`, it names at most three close matches (bounded fuzzy matching, only commands callable in the active context) and points to `afd-discover`. All three now share one wording: `Did you mean 'a'? Other close matches: 'b', 'c'. Use afd-discover to list all commands.` `afd-detail` entries for unknown names echo the name cut to 128 characters plus `…` in their `name` field instead of the full request (up to about 88 KB each); found commands keep their exact name.

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - `GET /stream/:name?input=...` now applies `maxBodyBytes` to its query input, as `POST /stream` does to the body. `maxBodyBytes` used to cover POST bodies only, so a host that raised Node's header size limit (or set a small `maxBodyBytes`) accepted query input of any size up to the header limit. Input whose UTF-8 size exceeds `maxBodyBytes` is refused with HTTP 413 (`HTTP_413`) before the command runs.

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`77a829c`](https://github.com/lushly-dev/afd/commit/77a829c531edf4ba352bd570da8ea12bed0cb92b), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1)]:
  - @lushly-dev/afd-core@2.0.0

## 1.0.0

### Minor Changes

- [#178](https://github.com/lushly-dev/afd/pull/178) [`b9eeeff`](https://github.com/lushly-dev/afd/commit/b9eeeff6502c922ea88ef7bc8a596025c13f7c95) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `createMcpHandler()` for embedding AFD MCP HTTP endpoints in host-controlled Node servers without starting a listener via `createMcpServer()`.

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
