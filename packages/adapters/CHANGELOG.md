# @lushly-dev/afd-adapters

## 2.1.0

### Patch Changes

- [#324](https://github.com/lushly-dev/afd/pull/324) [`8abba60`](https://github.com/lushly-dev/afd/commit/8abba6092afc5cff4114988c32f5d92dbc9d2d4c) Thanks [@Falkicon](https://github.com/Falkicon)! - Internal peer dependencies now publish as caret ranges. `@lushly-dev/afd-auth` peers on `@lushly-dev/afd-server` `^X.Y.Z` and `@lushly-dev/afd-view-state` peers on `@lushly-dev/local-db` `^X.Y.Z`, where each previously required that exact version. `@lushly-dev/afd-adapters` peers on `@lushly-dev/afd-core` `^X.Y.Z` instead of `>=2.0.0`, so a future major of afd-core is no longer accepted without a matching adapters release.

## 2.0.0

### Patch Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Close two HTML-injection gaps in `escapeHtml()` and stop confidence bars from throwing.

  - **`escapeHtml()` escapes every value**: it converts the value with `String(value)` and then escapes it. A non-string (an object with a `toString()`, an `Error`, an array) used to be returned unescaped.
  - **`escapeHtml()` escapes `'` as `&[#39](https://github.com/lushly-dev/afd/issues/39);`**, so its output is safe in single-quoted attribute values too.
  - `WebAdapter.renderConfidence()` (and `renderCommandResult()`) clamp a confidence outside `[0, 1]` and render a non-finite one as 0% instead of throwing `RangeError`.
  - The package `lint` script now also checks `tests/` and `vitest.config.ts`.

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
