# @lushly-dev/afd-view-state

## 3.0.0

### Major Changes

- [#2645](https://github.com/lushly-dev/afd/pull/2645) [`f01f103`](https://github.com/lushly-dev/afd/commit/f01f1033dd68f240aea655705f5e0d5fd9c76543) Thanks [@Falkicon](https://github.com/Falkicon)! - `zod` is now a peer dependency (`^4.6.6`) of `@lushly-dev/afd-server`, `@lushly-dev/afd-testing` and `@lushly-dev/afd-view-state` instead of a dependency, so an application's command schemas and the server use one copy of Zod. With two copies the schemas still validated, but TypeScript can reject an application's schema passed to `defineCommand`, because the two copies' types do not unify. `@lushly-dev/afd-cli` now depends on `zod` itself, since it runs the server, and `@lushly-dev/afd-auth`'s optional `zod` peer rises from `^4.0.0` to `^4.6.6` to match the server it runs on. Shape detection for a `VALIDATION_ERROR`'s `expectedFields`, `unexpectedFields` and `missingFields`, and `isObjectSchema()`, now read a schema's `_zod.def.type` instead of using `instanceof` against afd-server's own Zod classes, so they do not depend on which copy of Zod built the schema.

  This is a breaking install change, so it is a major. npm 7 or later, pnpm and Bun install a missing peer themselves, but these applications need a change:

  - One that depends on a `zod` outside `^4.6.6`, such as 3.25 (whose `zod/v4` entry it may have used for its commands): npm stops with `ERESOLVE` where it used to nest a second copy, and pnpm warns and then links the server to that `zod`, which it cannot run on. Upgrade the application to `zod@^4.6.6`.
  - One that never depended on `zod`, for example one that uses only `@lushly-dev/afd-view-state` or `@lushly-dev/afd-testing`, where peers are not installed automatically (Yarn, npm's `legacy-peer-deps`, or pnpm with `auto-install-peers=false`): the install warns, and the server may fail to import `zod` or find another package's copy. Add `zod@^4.6.6` to its dependencies.

### Minor Changes

- [#2529](https://github.com/lushly-dev/afd/pull/2529) [`2f8fa9c`](https://github.com/lushly-dev/afd/commit/2f8fa9cac35dbce5ab432dcc54e3d8464a5fa0ee) Thanks [@Falkicon](https://github.com/Falkicon)! - Add Controls, an agent's path to read and fill the form a person is looking at, in two new browser-safe entries of `@lushly-dev/afd-view-state` ([#2487](https://github.com/lushly-dev/afd/issues/2487)).

  - **`@lushly-dev/afd-view-state/controls`:** `ControlRegistry`, where an application registers a synchronous handler for each control it lets an agent see (`read()` returns its kind, label, value, limits and choices; `write(value)` sets it) and names the screen and the command its form is for with `setScreen`. The registry issues each control a `rev` that changes whenever anything about the control changes, made of a counter and random bytes (`token` option for tests). Also the types `ControlHandler`, `ControlState`, `Control`, `ControlKind`, `ControlValue`, `ControlFormat` and `ControlChoice`.
  - **`@lushly-dev/afd-view-state/controls/commands`:** `createControlCommands(registry, { expose })` returns `control-list` (paged, with an output budget), `control-set` (1 to 50 values, all or none, each with the `rev` it was read with; refuses secrets, controls the person could not change, a stale `rev`, a value the control does not take and a caller whose actor is `human`, with a `suggestion`, a `recovery` and every refusal in `details.refused`; reports `changed`, `unchanged`, `affected` and `missing`, and `undoCommand: 'control-restore'`), `control-restore` (puts back what a fill replaced, skipping with one of five reasons any control changed since) and `control-choices` (searches a long list of choices). They go to the in-app agent by default, `control-restore` to the command palette as well, and to MCP only with `expose`.
  - The root entry and `/commands` are unchanged.

### Patch Changes

- Updated dependencies [[`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`612c0cb`](https://github.com/lushly-dev/afd/commit/612c0cb29ed8de62850dcd2db0e18dc365523c9f), [`e0dbde6`](https://github.com/lushly-dev/afd/commit/e0dbde69123eff2c7ff8372705dd05410701855e), [`bb791f8`](https://github.com/lushly-dev/afd/commit/bb791f81fa5b2aaf9cdf9f79c910eae0d4ff0f75), [`e179b98`](https://github.com/lushly-dev/afd/commit/e179b98aff85f0ee7d17e55cdc4fca6cb13d85bc), [`2f91ebc`](https://github.com/lushly-dev/afd/commit/2f91ebc786a4fa0cf5b3cee956ccb4a574efa576), [`b96288b`](https://github.com/lushly-dev/afd/commit/b96288b7e861937029f14f295c6c1484e51ee0e7), [`ea0155f`](https://github.com/lushly-dev/afd/commit/ea0155f120f98cb23757da697d3dd00456e77422), [`7f994c7`](https://github.com/lushly-dev/afd/commit/7f994c7e4e32c94a210e90669e59824cac0b4221), [`0bb74cc`](https://github.com/lushly-dev/afd/commit/0bb74cc86269a6b17400a30f0aabc2142a936967), [`b2fa476`](https://github.com/lushly-dev/afd/commit/b2fa4767043a672767d3b02d6c9e113e2808425b), [`c34838d`](https://github.com/lushly-dev/afd/commit/c34838d71a7f780667dcb46f3746d11c6ff16c14), [`e7f7b64`](https://github.com/lushly-dev/afd/commit/e7f7b64667544c05392367f2b1dc8692a8dc3b10), [`5e33124`](https://github.com/lushly-dev/afd/commit/5e33124bc3d6d698192741dc38bfbe43186fd7f1), [`ca7326e`](https://github.com/lushly-dev/afd/commit/ca7326effcfd756493344e40564772aa43e3cc81), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`67f32e8`](https://github.com/lushly-dev/afd/commit/67f32e875872c6da44205e6170bc5dd2d392a609), [`64247b5`](https://github.com/lushly-dev/afd/commit/64247b51e9f959be7d795708d07c145456a89e10), [`3d9ab45`](https://github.com/lushly-dev/afd/commit/3d9ab45bde620af5ebe982073089c81bf47a841e), [`cb09d91`](https://github.com/lushly-dev/afd/commit/cb09d918b7829425a5f0a73b8fb1e67210ec38df), [`64f1aa0`](https://github.com/lushly-dev/afd/commit/64f1aa013cfb7dce02b7e4dece3cfc201d611e6a), [`be12d09`](https://github.com/lushly-dev/afd/commit/be12d098a66416639485d5219ecd316f62a93897), [`a91e0ea`](https://github.com/lushly-dev/afd/commit/a91e0ea58d150cb3cd04df8d34fb474e50f3a83f), [`5c9ebec`](https://github.com/lushly-dev/afd/commit/5c9ebec174e8cad39e15ef4f1d99e966bbca38a8), [`c8fb751`](https://github.com/lushly-dev/afd/commit/c8fb75129572e6292584e7e9a0e62764d7bb2846), [`f01f103`](https://github.com/lushly-dev/afd/commit/f01f1033dd68f240aea655705f5e0d5fd9c76543)]:
  - @lushly-dev/afd-server@3.0.0
  - @lushly-dev/local-db@3.0.0

## 2.5.0

### Minor Changes

- [#1650](https://github.com/lushly-dev/afd/pull/1650) [`68b0024`](https://github.com/lushly-dev/afd/commit/68b002499c6ccd9194f48e77d5e0046fd8a1b377) Thanks [@Falkicon](https://github.com/Falkicon)! - `ViewStateRegistry.flush()` resolves with `{ failed }`, the IDs whose write failed, instead of nothing, and a failed write is kept and written again by the next flush, unless a newer state for its ID replaced it. Before, a failed write was logged and dropped, so a caller that awaited `flush()` could not tell its state was not stored. `flush()` still never rejects. A `hydrate()` that applies an ID's stored state drops a write kept for it, including one that fails while being written, and a failing ID is logged once until a write of it succeeds. The new `ViewStateFlushResult` type is exported.

### Patch Changes

- Updated dependencies [[`5962565`](https://github.com/lushly-dev/afd/commit/5962565062f2f34331f4c5e1f14b132700736959), [`274fcca`](https://github.com/lushly-dev/afd/commit/274fcca21fdeebb344a19873cea5b37a41cf80ff), [`709e64f`](https://github.com/lushly-dev/afd/commit/709e64f88733aa9879d007efe5654733f3dbd840), [`ea0cd02`](https://github.com/lushly-dev/afd/commit/ea0cd0276bc784c31f9bf923a7c67a97a06cf3dd), [`010b87a`](https://github.com/lushly-dev/afd/commit/010b87a94b39c9ae25985fdb83b3c1aec0825780), [`d676427`](https://github.com/lushly-dev/afd/commit/d6764276fdabede07f7f9eaf33785e046829a7d4), [`67ca558`](https://github.com/lushly-dev/afd/commit/67ca558ab822145a3ec2f5403b4dc94e1425cc4d), [`8c3425d`](https://github.com/lushly-dev/afd/commit/8c3425d880a4894255264a742dc57f447e6fef49), [`f1b4e51`](https://github.com/lushly-dev/afd/commit/f1b4e51fe863dcd3ba8dab509b9e9a1af390b4ce), [`0928fc9`](https://github.com/lushly-dev/afd/commit/0928fc99fa557b4e5dc5b52f25e560c096a2a61a), [`902e5ee`](https://github.com/lushly-dev/afd/commit/902e5ee2cb711bc9f45bf4ffa1b74dc248a0d1eb), [`bb6a71b`](https://github.com/lushly-dev/afd/commit/bb6a71b4b37084b94d52d90c659358afac9389fc), [`68b0024`](https://github.com/lushly-dev/afd/commit/68b002499c6ccd9194f48e77d5e0046fd8a1b377), [`eb45732`](https://github.com/lushly-dev/afd/commit/eb4573252a377e92bcef3ffa7de3e7c38696c876), [`e28d562`](https://github.com/lushly-dev/afd/commit/e28d56294dc9f917e4e2a8e91c76baeb8fd67e1c), [`4da865f`](https://github.com/lushly-dev/afd/commit/4da865ffd7b7d7717e77b7ab83b9101b11ed8019), [`93fe92c`](https://github.com/lushly-dev/afd/commit/93fe92ccbab0660bc4e51bf78004ad0890d55418), [`c9c03be`](https://github.com/lushly-dev/afd/commit/c9c03befb0576648fcabd1ffd29717f41c0293d1), [`e96c2f0`](https://github.com/lushly-dev/afd/commit/e96c2f0022745190659d9ef1eff4e024b69ce5ae), [`641faba`](https://github.com/lushly-dev/afd/commit/641fabaa659ff9fd5eca6e2229e4eb404bd341de), [`619909a`](https://github.com/lushly-dev/afd/commit/619909adbb14f7bb3115ce4e6c6ee485676d069e), [`9c3f9f2`](https://github.com/lushly-dev/afd/commit/9c3f9f24c59c50dcd81298545f133825af2c2554), [`076b364`](https://github.com/lushly-dev/afd/commit/076b3643552fe7bac71b81f78843dc5a973f8772)]:
  - @lushly-dev/afd-server@2.5.0

## 2.4.0

### Patch Changes

- Updated dependencies [[`eba33ef`](https://github.com/lushly-dev/afd/commit/eba33efa826865dabd1770941f61e1f9e86ce544), [`7aebc3f`](https://github.com/lushly-dev/afd/commit/7aebc3f5dd9cdb730f34af0d8c2620fdc1324663)]:
  - @lushly-dev/afd-server@2.4.0

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
