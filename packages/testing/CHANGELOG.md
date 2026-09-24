# @lushly-dev/afd-testing

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Make the scenario runner, the testing MCP tools and surface validation fail loudly instead of passing silently, and confine the MCP tools to their working directory.

  - **Behaviour change: fixtures check every command.** `applyFixture` passes each command's real `CommandResult` to the adapter and fails on the first `success: false`, naming the command and error code (`Fixture command 'todo-create' failed with VALIDATION_ERROR: ...`). Adapter `warnings` are returned. The scenario is then reported as an `error` at the fixture step (`result.error.type: 'fixture_failed'`) and no step runs. The fixture handler must return a `CommandResult` (new `FixtureCommandHandler` type). The todo adapter uses the example's kebab-case commands (`todo-clear` with `{ all: true }`, `todo-create`, `todo-toggle`). The legacy hard-coded `todo`/`violet` switch is gone: a fixture is applied through a registered adapter, the built-in todo adapter, or the generic adapter for `setup`/`data` command lists, and a fixture for an app with no adapter is an error. Relative fixture paths resolve against the scenario file (`scenario.sourcePath`, set by `parseScenarioFile`), not the process working directory. `ScenarioExecutor` (CLI) now applies fixtures and resolves step references too.
  - **Behaviour change: no more false greens from expectations.** An object is a matcher only if all its keys are matcher keys; mixing in other keys, a typo next to a matcher, or a matcher given the wrong type of value is an error (parse error in YAML, `InvalidExpectationError` from `evaluateResult`, step `error` of type `parse_error` at run time). New `equals` matcher, and `error.suggestion` expectations (a string to contain, or a matcher). The YAML parser rejects unknown fields at every level, `data` on an expected failure, `error` on an expected success, and the unimplemented `verify`, `isolation` and `dependsOn` fields ("not supported"). Scenario-level `timeout` is implemented. An unresolved `${{ steps[N]... }}` reference fails the step with a `reference_error` instead of sending `''` or `undefined`. `testCommandMultiple` now fails a case whose `expectError` does not occur.
  - **Behaviour change: timeouts cancel.** `scenarioEvaluate({ timeout })` and a scenario's `timeout` abort an `AbortSignal` passed to the executor (`execute(scenario, { signal })`, new `ExecuteScenarioOptions`) and to the handler as an optional third argument; the running step is abandoned, later steps never run, the timer is cleared, and the result records `error: { type: 'timeout', message }`. `ScenarioExecutor` kills the CLI process. `failFast` reports scenarios it did not run with the new `skip` outcome and `summary.skippedScenarios` (the old path mislabelled them `partial` and dropped them). Unparseable scenario files are reported as `error` scenarios with a non-zero exit code in directory and explicit mode, and `scenario-list` returns them in `parseErrors`. The terminal reporter no longer prints "All scenarios passed!" when scenarios errored.
  - **Security: MCP tools are confined to `cwd`.** Every path argument, and every fixture file a scenario names, is resolved against the server's `cwd` and rejected with `PATH_OUTSIDE_WORKSPACE` when it leaves it, including through a symlinked parent. `scenario-create` rejects names and file names with path separators, strips line breaks from the generated header comment, and refuses to write a file its own parser would reject (the default template now has a placeholder step, so it parses). YAML and fixture JSON errors report a line or position but never echo file contents.
  - **MCP schemas match the implementations.** Tool inputs are validated against their schemas (types, enums, ranges, required and unknown fields) and invalid input returns a `VALIDATION_ERROR` result instead of throwing. `scenario-evaluate` takes `failFast` (`stopOnFailure` is kept as an alias), `timeout`, and defaults `format` to `json` as documented; `verbose` is gone. `scenario-create` lists the real templates (`blank`, `crud`, `error-handling`, `workflow`) and implements `commands`. `scenario-coverage` writes `output` (also a new `ScenarioCoverageInput.output`) and computes coverage only over known commands. `scenario-list` implements `recursive`, `pattern` and `format`, and rejects `status: 'passed' | 'failed'` with `UNSUPPORTED_FILTER` since it keeps no run history. The server no longer answers JSON-RPC notifications, and stdio replies to malformed input with a parse or invalid-request error. `scenario-suggest` is described as heuristic, uses kebab-case command names, finds known commands without scenarios, and `relatedCommands` lists tool names only.
  - **Surface validation scales.** Descriptions are tokenized once and only pairs sharing a term are scored against the threshold (`SimilarityOptions.threshold`); schema overlap prunes pairs that cannot reach the threshold; findings are appended without spreading, so 2,000 commands validate in well under a second and a rule with hundreds of thousands of findings no longer overflows the stack. `additionalInjectionPatterns` now extends the built-in `INJECTION_PATTERNS` instead of replacing them, and patterns with the `g` or `y` flag give the same answer on every scan.

### Patch Changes

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - The core command registry now follows the MCP server's execution rules, and error and result helpers no longer leak or misreport.

  - **Batch and stream share one executor.** New `executeBatch()` and `executeStream()` in `@lushly-dev/afd-core` take an `execute` callback, like `executePipeline()`. `createCommandRegistry()` delegates to them, and the MCP server engine can adopt them later.
  - **Batch timeout at any parallelism.** `executeBatch` now enforces `options.timeout` when `parallelism > 1`. At the deadline, in-flight commands have their `signal` aborted and are reported as `BATCH_TIMEOUT`, and commands not yet started are reported as `BATCH_TIMEOUT` without running. Previously a 50 ms timeout with `parallelism: 2` took 405 ms and ran every command.
  - **Exposure is checked on every entry point.** `executeBatch(request, context)` and `executeStream(name, input, options, context)` take a `CommandContext`. Its `interface` reaches each batch entry and the stream, so a command that `execute` rejects with `COMMAND_NOT_EXPOSED` is no longer run through a batch or stream. `COMMAND_NOT_EXPOSED` now includes a `suggestion`.
  - **Malformed batches are rejected before anything runs.** The registry validates the whole envelope with `isBatchRequest()`, as the server does. A `null` entry, an empty command name, a non-string `id` or invalid options now return `INVALID_BATCH_REQUEST`. Previously a `null` entry was silently skipped, so two commands reported `total: 1`. `COMMAND_SKIPPED` and `BATCH_TIMEOUT` results now include a `suggestion`.
  - **Handler exceptions are redacted by default.** `execute` returns `COMMAND_EXECUTION_ERROR` with a generic message and no stack. Pass `createCommandRegistry({ devMode: true })` to include the raw message and the stack in `details.stack`, as the server's `devMode` does. Previously the message and stack were always included.
  - **The stack is no longer in `details`.** `wrapError()` builds a plain `CommandError` from a thrown `Error`. It keeps the message and any string `code`, string `suggestion` and boolean `retryable`, and drops every other field, such as a Node system error's `errno`, `syscall` and `path`. The stack is kept on a non-enumerable `stack` property for logging and is never serialized. `cause` is set only when the error's cause is itself a `CommandError`. `internalError(message, cause)` attaches `cause` non-enumerably, so `error.cause` still works in process but is never serialized.
  - **`isCommandError()` returns `false` for `Error` instances**, including errors from another realm, even when they carry a string `code` such as `ENOENT`.
  - **`isSuccess(success(undefined))` is now `true`.** `isSuccess` checks only `success === true`, so void commands no longer fall through both `isSuccess` and `isFailure`. It narrows `data` to the result's type `T`.
  - **`createTimeoutController()` returns a `TimeoutController`**, an `AbortController` with a `dispose()` method. The timer is `unref()`'d in Node and cleared on abort or `dispose()`. Call `dispose()` when the work finishes so the signal is not aborted afterwards and the process is not kept alive.
  - **Testing: `MockMcpServer` behaves like the server.** It lists and runs only commands with `expose.mcp: true`; any other command returns `COMMAND_NOT_EXPOSED`. It accepts the built-in `afd-batch` tool through the shared batch executor, and it redacts handler exceptions unless `createMockServer(commands, { devMode: true })` is used. `createMockCommand`, `createSuccessCommand` and `createFailureCommand` now set `expose.mcp: true`, so they stay callable through the mock server.

- [#234](https://github.com/lushly-dev/afd/pull/234) [`f8a9d85`](https://github.com/lushly-dev/afd/commit/f8a9d851531bf2c2edea7284f031c68d7b22a455) Thanks [@Falkicon](https://github.com/Falkicon)! - `MockMcpServer.register()` now accepts typed commands, matching `CommandRegistry.register()` in `@lushly-dev/afd-core`. Previously `server.register(createMockCommand<{ name: string }, Greeting>(...))` did not compile, because the method only took `CommandDefinition<unknown, unknown>`. Runtime behaviour is unchanged.

- [#232](https://github.com/lushly-dev/afd/pull/232) [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix Windows command injection in `exec()` and the testing `CliWrapper`. Neither spawns with `shell: true` any more. On Windows, `.exe` commands run directly, and `.cmd`/`.bat` shims such as `npm` run through `cmd.exe` with every argument escaped (a cross-spawn-style `prepareSpawn()` helper, exported from `@lushly-dev/afd-core/platform`). `GitHubConnector` now passes `--flag=value` arguments. `PackageManagerConnector` rejects invalid package and script names with a `SPAWN_FAILED` result. `exec()` now decodes output as a UTF-8 stream, so multibyte characters split across chunks stay intact.

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
