# @lushly-dev/afd-view-state

## 2.3.0

### Minor Changes

- [#727](https://github.com/lushly-dev/afd/pull/727) [`2f3624e`](https://github.com/lushly-dev/afd/commit/2f3624e06dde5c0a34e41afc535087c487214a6e) Thanks [@Falkicon](https://github.com/Falkicon)! - Define the auth and view-state commands on Zod Mini through `defineCommandWithSchema`, each schema beside its JSON Schema as a literal, so a browser host that uses them bundles neither classic Zod nor `toJSONSchema`. What a command advertises does not change: its input and output JSON Schemas are the same as before, and a test in each package holds them equal to the schemas.

  `@lushly-dev/afd-auth/commands` adds `createAuthSessionGetCommand(adapter)` and `createAuthMutationCommands(adapter, options)`, in modules of their own, so a host can load `auth-session-get` before first paint and the sign-in commands later. `createAuthCommands` returns both, in the same order.

  Two things a caller can see:

  - `inputSchema` and `outputSchema` of these commands are now Zod Mini schemas, though `ZodCommandDefinition` still types `inputSchema` as classic. `safeParse` and `parse` still work; classic's methods such as `.optional()`, `.extend()` or `.shape.id.describe()` do not.
  - With no Zod locale loaded, as on Zod Mini alone, a bad email at `auth-sign-in` says `Invalid email` rather than `Invalid email address`, and an in-process `NaN` or `Infinity` is described as `nan` or `number`, which JSON cannot carry. With classic Zod loaded anywhere in the process nothing changes.

- [#725](https://github.com/lushly-dev/afd/pull/725) [`a5830b4`](https://github.com/lushly-dev/afd/commit/a5830b4d7a360af0406c473fcafff87ee2eef8cb) Thanks [@Falkicon](https://github.com/Falkicon)! - Add `ViewStateRegistry.hydrateOne(id)`: the same read as `hydrate()` for one registered ID, through `adapter.get(table, id)`, so a handler registered after boot gets its persisted state without `hydrate()` writing over what the other handlers hold in memory. An unregistered ID reads nothing. A missing record, or one in another category, leaves the handler as it is, and an adapter error is logged as `hydrate()` logs it. Await it before any `set` or `replace` on that ID: a change made first is lost in memory while its scheduled write still reaches the adapter.

### Patch Changes

- Updated dependencies [[`8e2e46f`](https://github.com/lushly-dev/afd/commit/8e2e46f4283d7c9fb3cafbfd0006efbe09495c42), [`8f8f94b`](https://github.com/lushly-dev/afd/commit/8f8f94b412f4304e61d0a15d7e65ffcbab4c95b9), [`5f11192`](https://github.com/lushly-dev/afd/commit/5f111922eee6240e116cbb267bc4d410ba2f2743), [`560c603`](https://github.com/lushly-dev/afd/commit/560c6033cc32d1b2b6f18e3329c057466175b4c7), [`2ab549a`](https://github.com/lushly-dev/afd/commit/2ab549a40614f998c9004fe8a103c62e8a8597c2), [`43c6fc7`](https://github.com/lushly-dev/afd/commit/43c6fc79e71c17eae2ed3286b1756f6543b4694d), [`0d9720a`](https://github.com/lushly-dev/afd/commit/0d9720a152313e5fdee4a19fde78da70f4d05d6f), [`c80a9b4`](https://github.com/lushly-dev/afd/commit/c80a9b4dc9078f408876ab0250d8d82c40653dc2), [`550bf0c`](https://github.com/lushly-dev/afd/commit/550bf0ce016c00ad8b67ad62799444ec4e79fe78), [`0e8fbcf`](https://github.com/lushly-dev/afd/commit/0e8fbcffc9838e7f90817fdf65bf57562e201b31), [`c329e9d`](https://github.com/lushly-dev/afd/commit/c329e9d15c60b14bc874ad6e08b6d4fe5ec2d4e2), [`280f65f`](https://github.com/lushly-dev/afd/commit/280f65f4a488139eb7f80d2e5347d3a16f9b9957)]:
  - @lushly-dev/afd-server@2.3.0

## 2.2.1

### Patch Changes

- Updated dependencies [[`2f90983`](https://github.com/lushly-dev/afd/commit/2f90983dfc41d3b302d0254a02e38b1c297b4b1e)]:
  - @lushly-dev/afd-server@2.2.1

## 2.2.0

### Patch Changes

- [#452](https://github.com/lushly-dev/afd/pull/452) [`ac87f87`](https://github.com/lushly-dev/afd/commit/ac87f879217c1af4f4536eeaf8f7e6613f47eea4) Thanks [@Falkicon](https://github.com/Falkicon)! - Require `zod` `^4.6.6`, so installs can no longer resolve a Zod affected by [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (memory exhaustion while validating oversized constrained collections).

- Updated dependencies [[`03e4c37`](https://github.com/lushly-dev/afd/commit/03e4c374618d5e9ebe05af96c712d5aa2b7dbef0), [`51f6f73`](https://github.com/lushly-dev/afd/commit/51f6f737cefcc5f4b818e40b39dc675811a81a60), [`9b79b8e`](https://github.com/lushly-dev/afd/commit/9b79b8eac07b10080a0f3b411e79ffffc56219cd), [`99fa015`](https://github.com/lushly-dev/afd/commit/99fa01517754c8b123cdca535f58cdf0a77977d9), [`2e10d29`](https://github.com/lushly-dev/afd/commit/2e10d299627da1286b14052d7ec073ba8d652f3d), [`d225fee`](https://github.com/lushly-dev/afd/commit/d225fee04831ce8c4404ce2f322a67b639efb1cd), [`a73a6b9`](https://github.com/lushly-dev/afd/commit/a73a6b9399154796b15c1a3d8359d755b3c7a761), [`0e66fdb`](https://github.com/lushly-dev/afd/commit/0e66fdb5e666f7c36037a4d126374161f563807f), [`ac87f87`](https://github.com/lushly-dev/afd/commit/ac87f879217c1af4f4536eeaf8f7e6613f47eea4)]:
  - @lushly-dev/afd-server@2.2.0

## 2.1.0

### Patch Changes

- [#324](https://github.com/lushly-dev/afd/pull/324) [`8abba60`](https://github.com/lushly-dev/afd/commit/8abba6092afc5cff4114988c32f5d92dbc9d2d4c) Thanks [@Falkicon](https://github.com/Falkicon)! - Internal peer dependencies now publish as caret ranges. `@lushly-dev/afd-auth` peers on `@lushly-dev/afd-server` `^X.Y.Z` and `@lushly-dev/afd-view-state` peers on `@lushly-dev/local-db` `^X.Y.Z`, where each previously required that exact version. `@lushly-dev/afd-adapters` peers on `@lushly-dev/afd-core` `^X.Y.Z` instead of `>=2.0.0`, so a future major of afd-core is no longer accepted without a matching adapters release.

- [#372](https://github.com/lushly-dev/afd/pull/372) [`4e16a06`](https://github.com/lushly-dev/afd/commit/4e16a0699eeb00c5d6576d29be575b86ca8fa485) Thanks [@Falkicon](https://github.com/Falkicon)! - Make view-state declarations usable without the optional local-db peer by describing the existing adapter contract structurally. Preserve the complete DataAdapter type surface and compatibility with existing local-db adapters.

- Updated dependencies [[`7277d79`](https://github.com/lushly-dev/afd/commit/7277d79b9c5c999fb0411b1f58909a3e4d721eb3), [`b38a9b8`](https://github.com/lushly-dev/afd/commit/b38a9b880058fa5f310005c96593e8ecab107e95), [`7e56bd0`](https://github.com/lushly-dev/afd/commit/7e56bd09a8ee50ec4e1a72f5a8d337eddb4d9b98), [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568), [`e136261`](https://github.com/lushly-dev/afd/commit/e1362612f12648a0ec6ab0793075f694a0b3e422)]:
  - @lushly-dev/afd-server@2.1.0

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
