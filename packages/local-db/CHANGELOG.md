# @lushly-dev/local-db

## 2.3.0

### Minor Changes

- [#629](https://github.com/lushly-dev/afd/pull/629) [`dc3e085`](https://github.com/lushly-dev/afd/commit/dc3e085a51e2a8a2e1b8b693f1ed1de69d949d65) Thanks [@Falkicon](https://github.com/Falkicon)! - Add browser stores over IndexedDB, each at its own subpath so the root entries are unchanged.

  `@lushly-dev/local-db/indexeddb` exports `IndexedDbAdapter` (and `createIndexedDbAdapter`), a `DataAdapter` that owns one database: an object store `records` keyed by `[table, id]` with an index on `table`, so any table name works. Each call is one transaction, so `batch()` is atomic. It takes an optional `indexedDB` factory (for `fake-indexeddb` in Node.js), has `close()` and `destroy()`, closes itself when another connection upgrades or deletes the database, and rejects with `STORAGE_UNAVAILABLE` or `STORAGE_ERROR` when IndexedDB is missing or fails.

  `@lushly-dev/local-db/testing` exports the adapter contract suite as `runDataAdapterContract(name, create)`, which every built-in adapter passes. It imports its test functions from `vitest` (a new optional peer dependency) and no Node.js builtin, so it runs in Node.js and in Vitest's browser mode.

  `@lushly-dev/afd-core/journal-indexeddb` exports `IndexedDbJournalSink`, a `JournalSink` with an object store `entries` keyed by `seq`, and `IndexedDbJournalError`. Before its first `append` (or on `lock()`) the sink takes the Web Lock `<name>:writer` and holds it until `close()`; while another context holds it, `append` and `lock()` reject with `JOURNAL_LOCKED` and a suggestion, as `FileJournalSink` allows one process per file. An append still waiting for the lock when `close()` is called rejects with `JOURNAL_CLOSED`, and a database name may not start with `-` (Web Lock names cannot).

## 2.2.1

## 2.2.0

## 2.1.0

### Patch Changes

- [#367](https://github.com/lushly-dev/afd/pull/367) [`f19257e`](https://github.com/lushly-dev/afd/commit/f19257e404f69061149c5ed51a30a622a4450568) Thanks [@Falkicon](https://github.com/Falkicon)! - Return a failing exit status for unsuccessful streams and validate record IDs consistently in the memory adapter.

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
