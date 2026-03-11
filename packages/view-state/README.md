# @lushly-dev/afd-view-state

UI view state management via AFD commands for [Agent-First Development](https://github.com/lushly-dev/afd).

## Why

UI state (panels, sidebars, selections, tool modes) typically lives outside the command system — invisible to agents, tests, and automation. This package makes every layout decision accessible through the same command contract:

- **Agents can control layout** — open panels, switch tabs, resize sidebars via commands
- **Tests express intent** — assert on state, not pixel coordinates
- **State persists** — reload hydration via `@lushly-dev/local-db`
- **Undo support** — every `view-state-set` captures previous state

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
});

// Read and write state
registry.get('design-panel');                  // { open: true, tab: 'styles' }
registry.set('design-panel', { open: false }); // returns previous state
registry.list();                               // [{ id: 'design-panel', state: {...} }]
```

## With AFD commands

```ts
import { createMcpServer } from '@lushly-dev/afd-server';
import { ViewStateRegistry, createViewStateCommands } from '@lushly-dev/afd-view-state';

const registry = new ViewStateRegistry();
const commands = createViewStateCommands(registry);

const server = createMcpServer({
  name: 'my-app',
  version: '1.0.0',
  commands,
});
```

Commands exposed: `view-state-get`, `view-state-set`, `view-state-list`.

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
| `set(id, partial)` | Apply partial state, returns previous for undo |
| `list()` | List all registered states |
| `hydrate()` | Load persisted states and apply to handlers |
| `flush()` | Write all pending persistence immediately |
| `destroy()` | Flush + clear all handlers |

## License

MIT
