# @lushly-dev/local-db

## 2.0.0

### Minor Changes

- [#251](https://github.com/lushly-dev/afd/pull/251) [`f820855`](https://github.com/lushly-dev/afd/commit/f820855cb098e83cf311a8b2e361e4ca0fc4129a) Thanks [@Falkicon](https://github.com/Falkicon)! - Give `MemoryAdapter` and `HttpAdapter` the same semantics, checked by one shared contract test suite.

  Behavior changes:

  - **`HttpAdapter`: `chat_messages` maps to `/chat/messages`**; it used to hit `/chat/sessions`.
  - **`HttpAdapter`: table names are own-property checked and URL-encoded.** A table without a `pathMap` entry is sent as one percent-encoded segment, so `constructor` or `__proto__` no longer resolve to `Object.prototype` members and `../admin` no longer escapes the base path. Table and record names `''`, `.` and `..` reject with a 400 `DataAdapterError` (`code: 'INVALID_NAME'`) in both adapters.
  - **Errors are `DataAdapterError`s** (new export) with an HTTP-style `status` and a `code` (`NOT_FOUND`, `CONFLICT`, `INVALID_NAME`, `HTTP_<status>`). `HttpAdapter` keeps its `HTTP <status>: <body>` messages.
  - **`HttpAdapter.remove()` of a missing record (404) now succeeds**, as `MemoryAdapter.remove()` always did.
  - **`MemoryAdapter.update()` of a missing record rejects with a 404** instead of creating it, matching `PATCH`. In the upsert tables (`settings`, `flags`, `feature_flags`, `feature_data`, `keyboard_shortcuts`), where `HttpAdapter` sends `PUT`, it still creates the record. The stored record keeps its key as `id` even if the patch carries another one.
  - **`MemoryAdapter` stores and returns JSON copies** instead of live references to its internal records, so changing a result (or the object passed to `create`/`update`) no longer changes stored data. Values behave as over HTTP: `Date`s become ISO strings and `undefined` properties are dropped.
  - **`MemoryAdapter.batch()` is atomic**, as `DataAdapter` documents: if any operation fails (400 or above, except a `GET` of a missing record), no write is applied, the failed operation keeps its status and error, every other operation reports `424`, and the summary counts all operations as failed. `PUT` upserts and `PATCH` requires an existing record; paths are percent-decoded; `PATCH`/`PUT`/`DELETE` without a record ID fail with 400. Batches run synchronously, so concurrent calls cannot interleave with them. `MemoryAdapter` subclasses that override `create`/`update`/`remove` no longer affect `batch()`.
  - `MemoryAdapter` reads no longer create empty tables, so `health().tables` counts only tables with data written to them.

## 1.0.0

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
