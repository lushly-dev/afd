# @lushly-dev/afd-view-state

## 2.0.0

### Major Changes

- [#254](https://github.com/lushly-dev/afd/pull/254) [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc) Thanks [@Falkicon](https://github.com/Falkicon)! - Remove the APIs deprecated for this major version:

  - `@lushly-dev/afd-core` no longer re-exports `GitHubConnector`, `PackageManagerConnector` and their types (`GitHubConnectorOptions`, `Issue`, `IssueCreateOptions`, `IssueFilters`, `PrCreateOptions`, `PullRequest`, `PackageManager`, `PackageManagerConnectorOptions`) from its root entry. Import them from `@lushly-dev/afd-core/connectors`. The root entry now bundles for the browser.
  - `resolveReference`, the old alias of `resolveVariable`, is removed from `@lushly-dev/afd-core`. Use `resolveVariable`.
  - `createMcpServer()` no longer accepts `stdio: boolean`. Use `transport: 'stdio' | 'http' | 'auto'`. Passing `stdio` now throws instead of being silently ignored, because ignoring `stdio: false` would switch a server to auto-detection.
  - `@lushly-dev/afd-view-state` no longer re-exports `createViewStateCommands` from its root entry. Import it from `@lushly-dev/afd-view-state/commands`.

### Minor Changes

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `@lushly-dev/afd-view-state/commands` for `createViewStateCommands`. The commands now use `defineCommand` from `@lushly-dev/afd-server/define`, so neither this subpath nor the root entry loads the MCP transport, and both bundle for the browser. The root re-export of `createViewStateCommands` is kept but marked `@deprecated`; it will be removed from the root in the next major version.

  `createViewStateCommands(registry, { expose })` sets `expose` on all three commands. The default is unchanged (private to MCP), which since MCP exposure became opt-in meant the documented MCP setup listed no view-state tools: pass `expose: { mcp: true }`, as the README now shows.

  The factory's return type is now a labelled tuple, `[viewStateGet, viewStateSet, viewStateList]`, so callers can destructure precisely typed commands. It is still an array and remains assignable to `ZodCommandDefinition[]`.

  Minor: a new subpath and option, plus a deprecation.

### Patch Changes

- [#250](https://github.com/lushly-dev/afd/pull/250) [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470) Thanks [@Falkicon](https://github.com/Falkicon)! - Fix the persistence flush race. Flushes are now single-flight: each is chained after the previous one, so writes never overlap and the last state scheduled is the last one written, whatever order the network completes requests in; a flush requested during another runs afterwards for the state that changed meanwhile. `destroy()` and `flush()` wait for in-flight writes. A failed update falls back to create only when the record does not exist (an HTTP 404, a 404 `status`, a `*NOT_FOUND` code, or `adapter.get()` returning null), instead of on any error.

- Updated dependencies [[`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f943a5c`](https://github.com/lushly-dev/afd/commit/f943a5c55edfe16cc5b5e66ef1ec4948cd8cbdcc), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`31ab538`](https://github.com/lushly-dev/afd/commit/31ab5388f0e88e59f41b972daedf8c6fe12b0470), [`389b351`](https://github.com/lushly-dev/afd/commit/389b35181238d23dc6857f7ca3d2398340e009b1), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a), [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a)]:
  - @lushly-dev/afd-server@2.0.0
  - @lushly-dev/local-db@2.0.0

## 1.0.0

### Patch Changes

- Updated dependencies [[`b9eeeff`](https://github.com/lushly-dev/afd/commit/b9eeeff6502c922ea88ef7bc8a596025c13f7c95)]:
  - @lushly-dev/afd-server@1.0.0
  - @lushly-dev/local-db@1.0.0

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
  - @lushly-dev/afd-server@1.0.0
  - @lushly-dev/local-db@1.0.0
