---
'@lushly-dev/local-db': minor
---

Give `MemoryAdapter` and `HttpAdapter` the same semantics, checked by one shared contract test suite.

Behavior changes:

- **`HttpAdapter`: `chat_messages` maps to `/chat/messages`**; it used to hit `/chat/sessions`.
- **`HttpAdapter`: table names are own-property checked and URL-encoded.** A table without a `pathMap` entry is sent as one percent-encoded segment, so `constructor` or `__proto__` no longer resolve to `Object.prototype` members and `../admin` no longer escapes the base path. Table and record names `''`, `.` and `..` reject with a 400 `DataAdapterError` (`code: 'INVALID_NAME'`) in both adapters.
- **Errors are `DataAdapterError`s** (new export) with an HTTP-style `status` and a `code` (`NOT_FOUND`, `CONFLICT`, `INVALID_NAME`, `HTTP_<status>`). `HttpAdapter` keeps its `HTTP <status>: <body>` messages.
- **`HttpAdapter.remove()` of a missing record (404) now succeeds**, as `MemoryAdapter.remove()` always did.
- **`MemoryAdapter.update()` of a missing record rejects with a 404** instead of creating it, matching `PATCH`. In the upsert tables (`settings`, `flags`, `feature_flags`, `feature_data`, `keyboard_shortcuts`), where `HttpAdapter` sends `PUT`, it still creates the record. The stored record keeps its key as `id` even if the patch carries another one.
- **`MemoryAdapter` stores and returns JSON copies** instead of live references to its internal records, so changing a result (or the object passed to `create`/`update`) no longer changes stored data. Values behave as over HTTP: `Date`s become ISO strings and `undefined` properties are dropped.
- **`MemoryAdapter.batch()` is atomic**, as `DataAdapter` documents: if any operation fails (400 or above, except a `GET` of a missing record), no write is applied, the failed operation keeps its status and error, every other operation reports `424`, and the summary counts all operations as failed. `PUT` upserts and `PATCH` requires an existing record; paths are percent-decoded; `PATCH`/`PUT`/`DELETE` without a record ID fail with 400. Batches run synchronously, so concurrent calls cannot interleave with them. `MemoryAdapter` subclasses that override `create`/`update`/`remove` no longer affect `batch()`.
- `MemoryAdapter` reads no longer create empty tables, so `health().tables` counts only tables with data written to them.
