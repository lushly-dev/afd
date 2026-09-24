# @lushly-dev/local-db

Async data adapter with swappable backends for [Agent-First Development](https://github.com/lushly-dev/afd).

## Why

AFD commands need persistent storage, but the backend varies:
- **Unit tests** need fast, in-memory storage with no setup
- **Local dev** needs a REST API backed by SQLite or similar
- **Production** needs a cloud database (Azure SQL, Cosmos DB, Postgres)

`@lushly-dev/local-db` provides a single `DataAdapter` interface that all backends implement. Your commands write to the interface once — swap the backend by changing one line.

## Installation

```bash
npm install @lushly-dev/local-db
# or
pnpm add @lushly-dev/local-db
```

## Quick start

```ts
import { createMemoryAdapter, createHttpAdapter } from '@lushly-dev/local-db';

// Tests — no server needed
const db = createMemoryAdapter({
  users: [{ id: 'u1', name: 'Alice' }],
});

// Production — talks to your REST API
const db = createHttpAdapter('https://api.example.com/v1');

// Same API either way
const user = await db.get('users', 'u1');
const all = await db.list('users', { limit: 10 });
await db.create('users', { name: 'Bob' });
await db.update('users', 'u1', { name: 'Updated' });
await db.remove('users', 'u1');
```

## API

### `DataAdapter` interface

| Method | Signature | Description |
|--------|-----------|-------------|
| `get` | `get<T>(table, id): Promise<T \| null>` | Get record by ID (`null` if missing) |
| `list` | `list<T>(table, params?): Promise<ListResult<T>>` | List with filter/sort/paginate |
| `create` | `create<T>(table, data): Promise<T>` | Create a record |
| `update` | `update<T>(table, id, patch): Promise<T>` | Merge a patch; 404 if missing (upsert tables create) |
| `remove` | `remove(table, id): Promise<void>` | Delete a record (missing is fine) |
| `batch` | `batch(ops): Promise<BatchResult>` | Atomic multi-operation |
| `health` | `health(): Promise<HealthStatus>` | Backend health check |

### Contract

`MemoryAdapter` and `HttpAdapter` pass one shared contract test suite, so tests written
against the memory adapter describe production behavior:

- **Records are JSON copies.** Changing a returned object, or the object you passed in, never
  changes stored data. Values are stored as JSON, so a `Date` comes back as an ISO string and
  `undefined` properties are dropped, exactly as over HTTP.
- **`update()` of a missing record rejects** with a `DataAdapterError` whose `status` is 404, and
  creates nothing. The upsert tables (`settings`, `flags`, `feature_flags`, `feature_data`,
  `keyboard_shortcuts`) are the exception: there `update()` creates the record (`HttpAdapter`
  sends `PUT`).
- **`remove()` of a missing record succeeds.**
- **Table and record names** can be any string except `''`, `.` and `..`, which reject with a
  400 `DataAdapterError` (`code: 'INVALID_NAME'`). `HttpAdapter` sends an unmapped table as one
  percent-encoded path segment, so names like `constructor` or `../admin` stay inside the base
  URL.
- **`batch()` is all or nothing.** Operations run in order (`PUT` upserts, `PATCH` needs an
  existing record). If one fails (any status of 400 or more, except a `GET` of a missing record,
  which reports 404 with `data: null`), no write is applied: the failed operation keeps its
  status and error, every other operation reports `424`, and the summary counts all of them as
  failed. `HttpAdapter` sends the batch as one `POST /batch`, so the server must implement the
  same semantics.
- **Errors** reject with `DataAdapterError` (`status`, `code`: `NOT_FOUND`, `CONFLICT`,
  `INVALID_NAME` or `HTTP_<status>`).

### `QueryParams`

```ts
interface QueryParams {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  [key: string]: string | number | boolean | undefined; // filters
}
```

### Adapters

#### `MemoryAdapter`

In-memory storage backed by `Map`. Supports filtering, sorting, pagination, batch.

```ts
const db = createMemoryAdapter(initialData?);
db.clear();        // reset all data
db.count('table'); // row count
```

#### `HttpAdapter`

REST client via `fetch()`. Maps table names to URL paths.

```ts
const db = createHttpAdapter(baseUrl, {
  pathMap: { my_table: '/custom-endpoint' },
  fetch: customFetchFn, // for Node or testing
});
```

Default path mapping: `accounts` → `/accounts`, `flags` → `/flags`, `settings` → `/settings`,
`chat_sessions` → `/chat/sessions`, `chat_messages` → `/chat/messages`, etc. Other tables map to
`/<encoded table name>`.

Uses PUT for upsert-style tables (settings, flags), PATCH for entity tables (accounts, annotations).

## With AFD commands

```ts
import { defineCommand, success } from '@lushly-dev/afd-server';
import type { DataAdapter } from '@lushly-dev/local-db';
import { z } from 'zod/v3';

// Inject adapter — no storage coupling in command logic
export function createUserCommands(db: DataAdapter) {
  return defineCommand({
    name: 'user-list',
    input: z.object({ limit: z.number().optional() }),
    async handler(input) {
      const result = await db.list('users', { limit: input.limit });
      return success(result);
    },
  });
}
```

## License

MIT
