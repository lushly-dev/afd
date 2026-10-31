# @lushly-dev/violet-core

The native token engine behind Violet Design, a hierarchical design token platform. Nodes inherit tokens from their parents and add, override, subtract, reset or copy them; this package stores them, resolves inheritance and exports the result. It has no AFD dependency: the command layer that returns `CommandResult` envelopes for the CLI, REST API and MCP server is [`@lushly-dev/violet-afd`](../../../../integrations/violet-afd/README.md).

```bash
npm install @lushly-dev/violet-core
```

```ts
import { createMemoryDatabase, exportTokens, resolveTokens } from '@lushly-dev/violet-core';

const db = createMemoryDatabase(); // or SQLiteDatabase / PostgresDatabase, written by your own code
const { tokens } = await resolveTokens(db, 'brand-dark', { filter: 'color.*' });
const { content } = await exportTokens(db, 'brand-dark', { format: 'css' }); // :root { --color-…: … }
```

Exports to CSS, SCSS, TypeScript, JSON, Swift, Kotlin, Dart, Tailwind and Lua. Failures throw `TokenDomainError` with the code, message and suggestion the matching command reports.

| Entry point | Contents |
| --- | --- |
| `.` | Data contracts and `ErrorCodes`, the `Database` interface, memory/overlay/SQLite/Postgres stores, export transformers, `resolveTokens`/`exportTokens`, the hosted API OpenAPI document and the CSS validators |
| `./worker` | Worker-safe subset: `createMemoryDatabase`, `resolveTokens`/`exportTokens`, the OpenAPI document |
| `./engine` | Worker-safe building blocks: resolver, resolution cache, dependency graph, glob and constraint validators, token ids, transformers, memory and overlay stores |
| `./neon` | The Neon store; needs the optional `@neondatabase/serverless` and `ws` |
| `./css` | CSS validators only |
| `./types` | Data contracts and `ErrorCodes` |

Storage backends are optional. SQLite needs the optional `better-sqlite3` package, and Neon needs `@neondatabase/serverless` and `ws`, declared as optional peers so your project's copies are used; `npm install --omit=optional` leaves only `zod`, and in-memory storage, resolution and export still work.

`@lushly-dev/violet-core/css` holds allow-list validators for drawing token values safely: `safeCssColor`, `safeCssLength`, `safeFontFamily`, `safeShadow`, `safeDuration`, `safeEasing` and `safeCssNumber`. Each returns a rebuilt, safe value or `null` (never the input passed through), so a token holding `url(…)`, `;` or `}` can't reach a stylesheet. The subpath has no other imports, so browser code can load it alone.

The command registry, command definitions, `initializeCore`, `CommandResult` helpers and demo seed moved to `@lushly-dev/violet-afd`; see the [transition notes](../../../../docs/features/active/platform-monorepo/violet-transition.md).

## License

MIT
