# @lushly-dev/afd-view-state

UI view state management via AFD commands for [Agent-First Development](https://github.com/lushly-dev/afd).

## Why

UI state (panels, sidebars, selections, tool modes) typically lives outside the command system — invisible to agents, tests, and automation. This package makes every layout decision accessible through the same command contract:

- **Agents can control layout** — open panels, switch tabs, resize sidebars via commands
- **Tests express intent** — assert on state, not pixel coordinates
- **State persists** — reload hydration via `@lushly-dev/local-db`
- **Undo support** — handlers that provide `replace` receive exact undo metadata; legacy partial-only handlers remain compatible but do not advertise reversible undo

## Installation

```bash
npm install @lushly-dev/afd-view-state
# or
pnpm add @lushly-dev/afd-view-state
```

## Quick start

```ts
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';

const registry = new ViewStateRegistry();

// Components register their get/set handlers
registry.register('design-panel', {
  get: () => ({ open: panel.isOpen, tab: panel.activeTab }),
	set: (s) => {
		if (s.open !== undefined) panel.isOpen = s.open;
		if (s.tab !== undefined) panel.activeTab = s.tab;
	},
	replace: (s) => {
		panel.isOpen = s.open;
		panel.activeTab = s.tab;
	},
});

// Read and write state
registry.get('design-panel');                  // { open: true, tab: 'styles' }
registry.set('design-panel', { open: false }); // returns previous state
registry.list();                               // [{ id: 'design-panel', state: {...} }]
```

## With AFD commands

The command factory lives in the `@lushly-dev/afd-view-state/commands` subpath.
It defines the commands with `@lushly-dev/afd-server/define`, which loads
neither the MCP SDK nor any Node.js builtin, so it can run in the browser next to
the UI it controls.

### MCP tools

Commands are private to MCP unless they opt in. Pass `expose: { mcp: true }` so
`createMcpServer` lists them as tools; without it the server exposes none of them.

```ts
import { createMcpServer } from '@lushly-dev/afd-server';
import { ViewStateRegistry } from '@lushly-dev/afd-view-state';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';

const registry = new ViewStateRegistry();
const commands = createViewStateCommands(registry, { expose: { mcp: true } });

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands,
});
```

### In-app agent

Without `expose`, the commands keep the default exposure (command palette and
in-app agent). Run them through `createDirectRegistry` so input is validated:

```ts
import { createDirectClient } from '@lushly-dev/afd-client';
import { createDirectRegistry } from '@lushly-dev/afd-server';
import { createViewStateCommands } from '@lushly-dev/afd-view-state/commands';

const client = createDirectClient(createDirectRegistry(createViewStateCommands(registry)));
await client.call('view-state-set', { id: 'design-panel', state: { open: true } });
```

Commands: `view-state-get`, `view-state-set`, `view-state-list`. The factory
returns them as a typed tuple, so you can destructure them:

```ts
const [viewStateGet, viewStateSet, viewStateList] = createViewStateCommands(registry);
```

> The root entry (`@lushly-dev/afd-view-state`) still re-exports
> `createViewStateCommands`, marked `@deprecated`. It will be removed from the
> root in the next major version; import it from `/commands`.

`view-state-set` merges the supplied `state` by default. Set `replace: true`
to replace the complete state; this requires the registered handler to provide a
`replace(state)` callback. When replacement is available, successful set
commands include `undoCommand: 'view-state-set'` and `undoArgs` with
`replace: true`, which restores the complete previous snapshot including
removing keys added by the mutation. Legacy handlers with only `set(partial)`
continue to support partial updates, but their results omit undo metadata and
include a warning because an exact restoration cannot be guaranteed.

## Persistence

Optional — provide a `DataAdapter` from `@lushly-dev/local-db` to persist state across reloads:

```ts
import { createHttpAdapter } from '@lushly-dev/local-db';

const registry = new ViewStateRegistry({
  adapter: createHttpAdapter('/api/v1'),
  table: 'settings',        // default
  category: 'view-state',   // default
  debounceMs: 300,           // default — batches rapid changes
});

// On app startup, hydrate registered handlers from persisted state
await registry.hydrate();
```

Without an adapter, the registry works entirely in-memory.

## API

| Method | Description |
|--------|-------------|
| `register(id, handler)` | Register a view state handler. Throws on duplicate |
| `unregister(id)` | Remove a handler. No-op if unknown |
| `has(id)` | Check if a handler is registered |
| `get(id)` | Get current state. Returns `null` if not registered |
| `set(id, partial)` | Apply partial state, returns a detached previous snapshot |
| `replace(id, state)` | Replace complete state; requires handler `replace` support |
| `list()` | List all registered states |
| `hydrate()` | Load persisted states and apply to handlers |
| `flush()` | Write all pending persistence immediately |
| `destroy()` | Flush + clear all handlers |

## License

MIT
