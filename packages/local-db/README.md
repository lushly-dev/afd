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
| `get` | `get<T>(table, id): Promise<T \| null>` | Get record by ID |
| `list` | `list<T>(table, params?): Promise<ListResult<T>>` | List with filter/sort/paginate |
| `create` | `create<T>(table, data): Promise<T>` | Create a record |
| `update` | `update<T>(table, id, patch): Promise<T>` | Update (merge patch) |
| `remove` | `remove(table, id): Promise<void>` | Delete a record |
| `batch` | `batch(ops): Promise<BatchResult>` | Atomic multi-operation |
| `health` | `health(): Promise<HealthStatus>` | Backend health check |

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

Default path mapping: `accounts` → `/accounts`, `flags` → `/flags`, `settings` → `/settings`, etc.

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
