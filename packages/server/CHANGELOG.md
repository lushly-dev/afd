# @lushly-dev/afd-server

## 2.2.1

### Patch Changes

- [#479](https://github.com/lushly-dev/afd/pull/479) [`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e) Thanks [@Falkicon](https://github.com/Falkicon)! - Keep DirectClient approval credentials in a private exchange instead of returning them to the gated caller. Public call, pipe and DirectRegistry contexts discard caller-supplied approval evidence; only an affirmative trusted hook enables one verified retry. Preserve in-process CLI approval through the same exchange.

  Use matching client, core and server versions. Applications that submitted approval tokens directly through createDirectRegistry must migrate to DirectClient's onApprovalNeeded hook. Custom registries must support the private exchange; legacy token-in-result failures remain held and are returned without their token.

- Updated dependencies [[`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e)]:
  - @lushly-dev/afd-core@2.2.1

## 2.2.0

### Minor Changes

- [#432](https://github.com/lushly-dev/afd/pull/432) [`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0) Thanks [@Falkicon](https://github.com/Falkicon)! - Pre-execution approvals ([#272](https://github.com/lushly-dev/afd/issues/272)): a command can be held for a human's sign-off before its handler runs.

  - `@lushly-dev/afd-core`: `CommandDefinition` gains `approval` (`'required'`, `'not-required'` or a function of the validated input and context; `ApprovalPolicy`, `ApprovalDecision`), and `CommandContext` gains `approval`, the approval token. `ErrorCodes.APPROVAL_REQUIRED` joins the shared catalog (45 codes). Tool `_meta` reports `approval` as `'required'`, `'not-required'` or `'conditional'` (a function; `approvalMode()`).
  - `@lushly-dev/afd-server`: `defineCommand` accepts `approval` and keeps it through `toCommandDefinition()`; afd-detail and afd-docs report it. New `createApprovalMiddleware({ secret, commands })` returns `APPROVAL_REQUIRED` before the handler when a call needs approval and `context.approval` holds no valid token. `details` carries `approvalToken`, `expiresAt`, `summary` and, for a rejected token, `reason`. Tokens are HMAC-SHA256-signed with an app-supplied secret (required, at least 32 bytes, rotatable), bound to the command, the canonical validated input and the actor, short-lived (5 minutes by default) and single-use by default (`replay: 'within-ttl'` to allow reuse; `nonceStore` for several instances). Options `summarize`, `includeToken`, `onApprovalRequired` and `clock`.
  - `@lushly-dev/afd-cli`: `afd validate` warns (`MISSING_APPROVAL_POLICY`) about `mutation` or `destructive` tools, and grouped-tool actions, whose `_meta` declares no approval policy.

- [#433](https://github.com/lushly-dev/afd/pull/433) [`51f6f73`](https://github.com/lushly-dev/afd/commit/51f6f737cefcc5f4b818e40b39dc675811a81a60) Thanks [@Falkicon](https://github.com/Falkicon)! - Add a command journal with replay ([#273](https://github.com/lushly-dev/afd/issues/273)).

  - **Core:** `JournalEntry` (`seq`, `timestamp`, `traceId`, `command`, `input`, `actor`, `contextDigest`, `result`, `durationMs` and a `tape` of the clock and random values the handler read), the `JournalSink` interface (append, read a `seq` range), `MemoryJournalSink`, `createContextDigest()` and the JSON Lines helpers `serializeJournal()` and `parseJournal()`. `FileJournalSink` writes JSON Lines and is in the new Node-only subpath `@lushly-dev/afd-core/journal-file`; the root entry stays browser-safe. A journal keeps only the actor, the interface and the trace ID from the context, plus a SHA-256 hash over those and the names (never the values) of the other context keys.
  - **Server:** `createJournalMiddleware(sink, options)` records each call that passed validation (failures only with `recordFailures: true`; `auth-*` commands are skipped by default; `filter` and `redact` keep other secret inputs and results out, and `redact` should drop the tape when a secret comes from `context.random`). `replayJournal(registry, entries, options)` re-executes entries in `seq` order with each entry's trace ID, actor, interface and tape-restored clock and random source, and reports each as `same`, `different` (with a structural diff) or `error`. It reports divergence; it does not make handlers deterministic beyond the clock and random source.

  The format is specified in `spec/journal.md`, with the fixture `spec/wire/journal.jsonl`.

- [#406](https://github.com/lushly-dev/afd/pull/406) [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd) Thanks [@Falkicon](https://github.com/Falkicon)! - Add standard `actor`, `clock` and `random` fields to `CommandContext` ([#271](https://github.com/lushly-dev/afd/issues/271), [#274](https://github.com/lushly-dev/afd/issues/274)).

  - **Core:** `Actor` (`kind`: `human`, `agent`, `service`, `script` or `test`, with optional `id`, `label` and `onBehalfOf`), `Clock`, `RandomSource`, `systemClock`, `systemRandom`, `fixedClock()` (a manual clock with `set` and `advance`), `seededRandom()` (reproducible, not cryptographic) and `withContextDefaults()`. `ResultMetadata` and `TelemetryEvent` gain `actorKind`. The core registry gives handlers a clock and a random source.
  - **Server:** new `clock`, `random` and `actor` options. MCP calls run as `{ kind: 'agent' }` unless the option or `createContext` says otherwise; every context gets a clock and a random source; results carry `metadata.actorKind` (the kind only, never the id). `executionTimeMs`, the telemetry middleware and HTTP session expiry use the clock. `createDirectRegistry()` accepts the same three defaults.
  - **Client:** `DirectClient` accepts `actor` (default `{ kind: 'human' }`), `clock` and `random` (default: the registry's own); a call's own context wins.
  - **Auth:** `createAuthMiddleware` fills `context.actor` from the verified session: a human actor gets the user's `id` and `label`, other actors get `onBehalfOf`.
  - **Testing:** `createTestContext()` sets `actor: { kind: 'test' }`, a clock and a random source (`now` stops the clock); `InProcessExecutor` takes a `context` for every step and runs steps as a test actor. `fixedClock` and `seededRandom` are re-exported.

  The golden wire fixtures now include `"actorKind": "agent"` in result metadata.

  The server engine, `createDirectRegistry()` and the core registry now pass handlers a copy of the caller's context (with the defaults filled in), so changes middleware or handlers make to it no longer show on the caller's object. The CLI talks to servers over MCP, so its calls run as `agent` unless the server's `actor` option or `createContext` says otherwise; the same holds for `ScenarioExecutor`, which runs steps through the CLI.

- [#391](https://github.com/lushly-dev/afd/pull/391) [`2e10d29`](https://github.com/lushly-dev/afd/commit/2e10d299627da1286b14052d7ec073ba8d652f3d) Thanks [@Falkicon](https://github.com/Falkicon)! - Serve MCP 2026-07-28 (stateless, per-request `_meta`) next to the 2025 protocol.

  - New `POST /mcp` endpoint on `createMcpServer` and `createMcpHandler`, built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). It answers `server/discover`, validates the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, adds `resultType`, `serverInfo` and cache hints, and serves 2025 clients that send `initialize` statelessly on the same path. AFD's Host, Origin, CORS and body-size checks still run first, and `createContext(req)` still reaches every command.
  - stdio serves both eras on one connection: `server/discover` openings get 2026-07-28, `initialize` openings keep the 2025 protocol and the server's single context stack.
  - Contexts on the stateless lane are request input: send `_meta["dev.afd/context"]` on `tools/list` and `tools/call`. There, `afd-context-enter` and `afd-context-exit` validate but do not store, and return `persisted: false`.
  - New options `instructions` (returned by `server/discover`) and `toolsListTtlMs` (default 5 minutes, or 0 when `contexts` are configured).
  - The `/sse` and `/message` routes (the 2024-11-05 HTTP+SSE transport) are deprecated and unchanged; they are removed in 3.0.
  - The `@modelcontextprotocol/sdk` 1.x dependency is replaced by `@modelcontextprotocol/server` and `@modelcontextprotocol/node` 2.x.

- [#395](https://github.com/lushly-dev/afd/pull/395) [`d225fee`](https://github.com/lushly-dev/afd/commit/d225fee04831ce8c4404ce2f322a67b639efb1cd) Thanks [@Falkicon](https://github.com/Falkicon)! - Report standard MCP tool fields from command metadata (`spec/command-metadata.md`, "MCP tool fields").

  - Individual command tools carry MCP `annotations`: `mutation: false` gives `readOnlyHint: true`; `mutation: true` gives `readOnlyHint: false` and `destructiveHint` from `destructive`. An unset `mutation` claims nothing.
  - Every `tools/call` result for a command, batch or pipeline carries the result as `structuredContent` as well as text.
  - Individual command tools with an `output` schema advertise a top-level `outputSchema`: the CommandResult envelope with `data` typed by that schema. MCP clients validate `structuredContent` against it, so a handler whose data does not match its declared output schema now fails on the client; `advertiseOutputSchema: false` switches it off. `_meta.outputSchema` is unchanged.
  - Core: `commandToolAnnotations` and `commandResultOutputSchema` helpers, `annotations`/`outputSchema` on `McpTool`, `structuredContent` on `McpToolCallResult`, and the MCP 2026-07-28 error codes `HEADER_MISMATCH`, `MISSING_REQUIRED_CLIENT_CAPABILITY` and `UNSUPPORTED_PROTOCOL_VERSION`. `SERVER_NOT_INITIALIZED` is deprecated.

- [#448](https://github.com/lushly-dev/afd/pull/448) [`a73a6b9`](https://github.com/lushly-dev/afd/commit/a73a6b9399154796b15c1a3d8359d755b3c7a761) Thanks [@Falkicon](https://github.com/Falkicon)! - Relay approvals to the human over MCP ([#418](https://github.com/lushly-dev/afd/issues/418)). `createApprovalMiddleware` takes `relay: 'mcp-elicitation'` (default `'none'`). With it, a call to a single gated command from an MCP client that declares form elicitation is answered with a form elicitation showing the approval summary, the command and its validated input: `input_required` on `/mcp` (MCP 2026-07-28), or a server-sent elicitation on a 2025-era stdio connection. The command runs once the human accepts. No approval token is issued on this path. The signed `requestState` binds the command, the validated input and the actor, plus a single-use nonce and an expiry under a MAC keyed with the approval secret. Answers lapse 10 minutes after they were asked. A declined form fails with `APPROVAL_REQUIRED`, `details.reason: 'declined'` and `retryable: false`. `afd-batch` and `afd-pipe` steps, and clients that cannot elicit, still get `APPROVAL_REQUIRED`. `includeToken` now defaults to `false` when `context.interface` is `'mcp'` (the MCP lanes and the HTTP routes of `createMcpHandler`), so the agent never receives the token unless the server opts in. The confirmation and approval elicitations share one `requestState`, so a call that needs both asks for each in turn.

- [#435](https://github.com/lushly-dev/afd/pull/435) [`0e66fdb`](https://github.com/lushly-dev/afd/commit/0e66fdb5e666f7c36037a4d126374161f563807f) Thanks [@Falkicon](https://github.com/Falkicon)! - Enforce `confirmPrompt` (`spec/command-metadata.md`, "Confirmations").

  - **Server:** `createMcpServer` and `createMcpHandler` take `confirmations` (`'off'` by default, `'enforce'` or `'require-human'`) and `confirmationKey`. A call that reaches a command with `confirmPrompt` runs only after the user accepts an MCP elicitation, through an `input_required` result on `/mcp` or a server-side elicitation on a 2025 stdio connection. Under `'enforce'` the caller can instead acknowledge: `confirm: true` on the tool, `afd-call` or a grouped tool, `confirm: [names]` on `afd-batch` and `afd-pipe`, `_meta["dev.afd/confirm"]`, or the `Afd-Confirm` header on `/rpc`, `/batch` and `/stream`. Otherwise the call fails with `CONFIRMATION_REQUIRED` or `CONFIRMATION_DECLINED` before the handler runs. Gated tools advertise the optional `confirm` argument.
  - **Client:** `McpClient` takes `onElicitation` to answer servers' form elicitations on the `streamable-http` transport. Without it, an `input_required` result becomes an `INPUT_REQUIRED` failure carrying the server's `inputRequests`.
  - **CLI:** at a terminal, the CLI asks a server's yes/no elicitation (`[y/N]`) on stderr; otherwise it declares no elicitation, so the server's error explains how to acknowledge.

### Patch Changes

- [#446](https://github.com/lushly-dev/afd/pull/446) [`99fa015`](https://github.com/lushly-dev/afd/commit/99fa01517754c8b123cdca535f58cdf0a77977d9) Thanks [@Falkicon](https://github.com/Falkicon)! - `JOURNAL_REPLAY` is now a registered symbol, `Symbol.for('@lushly-dev/afd-server/journal-replay')` ([#441](https://github.com/lushly-dev/afd/issues/441)), so separately loaded copies of afd-server agree on the replay marker. A globally installed `afd replay` no longer makes a project's own journal middleware re-record the replayed calls. `afd replay` still prefers the module's own afd-server copy, as a fallback for older versions.

- [#452](https://github.com/lushly-dev/afd/pull/452) [`ac87f87`](https://github.com/lushly-dev/afd/commit/ac87f879217c1af4f4536eeaf8f7e6613f47eea4) Thanks [@Falkicon](https://github.com/Falkicon)! - Require `zod` `^4.6.6`, so installs can no longer resolve a Zod affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion while validating oversized constrained collections).

- Updated dependencies [[`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0), [`51f6f73`](https://github.com/lushly-dev/afd/commit/51f6f737cefcc5f4b818e40b39dc675811a81a60), [`f152bb9`](https://github.com/lushly-dev/afd/commit/f152bb93c62a3fe06162705b37abcd0ddfc29fc9), [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd), [`d225fee`](https://github.com/lushly-dev/afd/commit/d225fee04831ce8c4404ce2f322a67b639efb1cd)]:
  - @lushly-dev/afd-core@2.2.0

## 2.1.0

### Minor Changes

- [#313](https://github.com/lushly-dev/afd/pull/313) [`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3) Thanks [@Falkicon](https://github.com/Falkicon)! - `@lushly-dev/afd-core` exports `AFD_CONTRACT_VERSION`, the version of the AFD contract the package implements. The contract is the wire shapes, pipeline variables, behavior vectors and conformance suite that the TypeScript, Python, Rust and C++ implementations share. Its `MAJOR.MINOR` version lives in `spec/VERSION` and is independent of the package version. It reads `1.0-rc` until every language loads every vector file.

  The `afd-help` bootstrap command returns it as `contractVersion`, so an agent can tell which contract a server implements.

- [#308](https://github.com/lushly-dev/afd/pull/308) [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95) Thanks [@Falkicon](https://github.com/Falkicon)! - Commands carry `destructive`, `confirmPrompt` and `undoable` in both definitions, and every surface reports them consistently ([#275](https://github.com/lushly-dev/afd/issues/275)). The canonical field list is in `spec/command-metadata.md`.

  - `@lushly-dev/afd-core`: `CommandDefinition` gains `destructive` and `confirmPrompt`, which only the Zod definitions had. `McpToolCommandMeta` gains `undoable`.
  - `@lushly-dev/afd-server`: `defineCommand` accepts `undoable`, and `toCommandDefinition()` now keeps `destructive`, `confirmPrompt` and `undoable` instead of dropping the first two. `undoable` is reported in the tool `_meta` (and in each grouped `_meta.actions` entry) when set, like `destructive`. It is also reported by `afd-detail`, `afd-help` with `format: 'full'` and `DirectRegistry.listCommands()`. `afd-help` full also reports `destructive`. `afd-docs` documents all three.
  - `@lushly-dev/afd-cli`: `afd tools` marks tools whose `_meta` sets `destructive` or `undoable`, for example `todo-delete (destructive, undoable)`.
  - `@lushly-dev/afd-client`: `createReconnectingHandoff` falls back to core's `defaultReconnectPolicy` (3 attempts, 1000 ms) when neither the options nor the handoff's `metadata.reconnect` set `maxAttempts` or `backoffMs`. It used to fall back to 5 attempts.

### Patch Changes

- [#326](https://github.com/lushly-dev/afd/pull/326) [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98) Thanks [@Falkicon](https://github.com/Falkicon)! - `ErrorCodes` in `@lushly-dev/afd-core` now holds the 42-code shared catalog of `spec/error-codes.md`. It adds 20 codes that the engines already emitted without a constant: `COMMAND_NOT_EXPOSED`, `COMMAND_NOT_IN_CONTEXT`, `COMMAND_NOT_ALLOWED`, `UNKNOWN_TOOL`, `AMBIGUOUS_ACTION`, `INVALID_GROUPED_CALL`, `SESSION_REQUIRED`, `CONTEXT_NOT_FOUND`, `CONTEXT_DEPTH_EXCEEDED`, `INVALID_BATCH_REQUEST`, `BATCH_TIMEOUT`, `COMMAND_SKIPPED`, `INVALID_PIPELINE_REQUEST`, `PIPELINE_TIMEOUT`, `UNSUPPORTED_OPTION`, `STREAM_ABORTED`, `STREAM_TIMEOUT`, `STREAM_ERROR`, `STREAM_ENDED_UNEXPECTEDLY` and `COMMAND_FAILED`. Python, Rust and C++ define the same catalog. The spec also lists each code's meaning, whether it is retryable and which layer emits it, plus the transport-specific codes of the HTTP layer and the client.

  `@lushly-dev/afd-server`: the tool router no longer has an `afd-call` branch that answered `COMMAND_NOT_EXPOSED`. `createMcpServer` never reached it, and a remote caller always gets `COMMAND_NOT_FOUND` for a command it cannot see, as `spec/error-codes.md` requires.

- [#367](https://github.com/lushly-dev/afd/pull/367) [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568) Thanks [@Falkicon](https://github.com/Falkicon)! - Advertise canonical command metadata from core MCP tool conversion, share malformed batch result shapes across HTTP and MCP, omit invented output schemas when converting commands with no declared output, and stop scheduling queued batch commands and pipeline steps after caller cancellation while preserving started work outcomes.

  Redact exceptions thrown by core pipeline executors using the shared command error policy.

- [#292](https://github.com/lushly-dev/afd/pull/292) [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422) Thanks [@Falkicon](https://github.com/Falkicon)! - `afd validate --surface` now validates the server's commands whatever its `toolStrategy`. Against the default `grouped` strategy it used to validate the grouped tools themselves, so a two-command `todo` server failed with a `naming-convention` error for the tool `todo` and reported schema-complexity and missing-category findings for `todo`, `afd-batch`, `afd-pipe`, `afd-call` and `afd-detail`. Now:

  - grouped tools are expanded into one command per `_meta.actions` entry, with that command's name, description, input schema and metadata;
  - lazy servers, which list no command tools, are enumerated with `afd-discover` and `afd-detail`; so are grouped tools that do not list their actions;
  - the tools AFD provides itself (`afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail`, `afd-help`, `afd-docs`, `afd-schema`, `afd-context-*`) are skipped in every strategy.

  The output says which grouped tools were expanded and which built-in tools were skipped. If discovery fails, the listed tools are validated as before and a warning says why.

  `@lushly-dev/afd-core` exports the built-in names as `AFD_META_TOOL_NAMES`, `AFD_BOOTSTRAP_COMMAND_NAMES`, `AFD_CONTEXT_COMMAND_NAMES`, `AFD_BUILTIN_TOOL_NAMES` and `isAfdBuiltinName()`, which the server now uses for its reserved names. `McpTool['_meta']` now types a grouped tool's `actions`.

- Updated dependencies [[`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3), [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95), [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98), [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568), [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422)]:
  - @lushly-dev/afd-core@2.1.0

## 2.0.0

### Major Changes

- [#225](https://github.com/lushly-dev/afd/pull/225): remotely callable commands must declare `expose: { mcp: true }`. MCP exposure is enforced across discovery and execution, including batch, pipeline and streaming routes. **Migration:** add the opt-in to commands intended for remote callers; configure the server's allowed HTTP hosts/origins for your deployment. Malformed request envelopes are validated before handlers run, and request/stream lifecycle cleanup is enforced.

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
