# @lushly-dev/violet-afd

The AFD command layer behind Violet Design, a hierarchical design token platform. Nodes inherit tokens from their parents and add, override, subtract, reset or copy them; every capability is a command that returns a structured `CommandResult`, so the CLI, REST API and MCP server all share one behavior.

```bash
npm install @lushly-dev/violet-core @lushly-dev/violet-afd
```

```ts
import { createMemoryDatabase, initializeCore, registry } from '@lushly-dev/violet-afd';

initializeCore();
const context = { db: createMemoryDatabase(), actor: 'build' };

await registry.execute('node.create', { name: 'base', type: 'root' }, context);
await registry.execute('token.add', { nodeId: 'base', tokenId: 'color.bg', value: '#FFFFFF' }, context);
const css = await registry.execute('export', { nodeId: 'base', format: 'css' }, context);
```

Exports to CSS, SCSS, TypeScript, JSON, Swift, Kotlin, Dart, Tailwind and Lua. Imports Style Dictionary and DTCG JSON, including whole node trees from files (`import.tree`).

SQLite storage needs the optional `better-sqlite3` package; in-memory storage needs nothing native.

This package is the pre-split `@lushly-dev/violet-core` command surface, moved out of the native foundation [`@lushly-dev/violet-core`](../../foundations/violet/packages/core/README.md), which it requires as a peer. Its `.`, `./commands`, `./worker`, `./types` and `./css` entry points keep the earlier `@lushly-dev/violet-core` contents, so existing command users change the package name in their imports. It depends on `@lushly-dev/afd-core` `^0.1.1`, the AFD range the source declared; see the [transition notes](../../docs/features/active/platform-monorepo/violet-transition.md).

`@lushly-dev/violet-afd/css` re-exports the native `@lushly-dev/violet-core/css`: it holds allow-list validators for drawing token values safely: `safeCssColor`, `safeCssLength`, `safeFontFamily`, `safeShadow`, `safeDuration`, `safeEasing` and `safeCssNumber`. Each returns a rebuilt, safe value or `null` (never the input passed through), so a token holding `url(…)`, `;` or `}` can't reach a stylesheet. The subpath has no other imports, so browser code can load it alone.

## License

MIT
