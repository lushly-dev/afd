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
npm install @lushly-dev/afd-view-state zod
# or
pnpm add @lushly-dev/afd-view-state zod
```

`zod` (`^4.6.6`) is a peer dependency, shared with `@lushly-dev/afd-server`.

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
It defines the commands with `@lushly-dev/afd-server/define` on Zod Mini, which
loads neither the MCP SDK, any Node.js builtin nor classic Zod, so it can run in the
browser next to the UI it controls.

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

> Since 2.0 the root entry (`@lushly-dev/afd-view-state`) no longer re-exports
> `createViewStateCommands`; import it from `/commands`.

`view-state-set` merges the supplied `state` by default. Set `replace: true`
to replace the complete state; this requires the registered handler to provide a
`replace(state)` callback. When replacement is available, successful set
commands include `undoCommand: 'view-state-set'` and `undoArgs` with
`replace: true`, which restores the complete previous snapshot including
removing keys added by the mutation. Legacy handlers with only `set(partial)`
continue to support partial updates, but their results omit undo metadata and
include a warning because an exact restoration cannot be guaranteed.

## Controls

Controls give an in-app agent a way to fill the form a person is looking at: it
reads the controls on the screen and sets their values through commands, and
never through clicks. An application registers a handler for each control it
lets the agent see, as it registers a view state. The registry gives each
control a `rev`, a token that changes whenever anything about the control
changes, and a write must send it back. So an agent never replaces what the
person typed without having read it. See the
[specification](../../docs/features/active/controls/spec.md).

| Entry | Exports |
| --- | --- |
| `@lushly-dev/afd-view-state/controls` | `ControlRegistry` and the types (`ControlHandler`, `ControlState`, `Control`, …). It loads no command definition |
| `@lushly-dev/afd-view-state/controls/commands` | `createControlCommands`, its options and result types |

Both are browser-safe, like `/commands`, and neither loads the view-state
registry.

```ts
import { createDirectClient } from '@lushly-dev/afd-client';
import { createDirectRegistry } from '@lushly-dev/afd-server';
import { ControlRegistry } from '@lushly-dev/afd-view-state/controls';
import { createControlCommands } from '@lushly-dev/afd-view-state/controls/commands';

const controls = new ControlRegistry();
controls.setScreen({ name: 'Book a workshop seat', command: 'workshop-book' });

// A handler is synchronous: read says what the control is, write sets its value.
const unregister = controls.register('attendee-name', {
  read: () => ({ kind: 'text', label: 'Full name', value: nameInput.value, required: true }),
  write: (value) => {
    nameInput.value = String(value);
  },
});

const registry = createDirectRegistry(createControlCommands(controls));
const agent = createDirectClient(registry, { actor: { kind: 'agent' } });
```

| Command | What it does |
| --- | --- |
| `control-list` | Lists the controls on the screen, in the order they were registered: each one's id, `rev`, kind, label, value, limits and choices, with `screen`, `command`, `total` and `more`. Pages with `group`, `limit` and `offset`, and declares an output budget |
| `control-set` | Sets 1 to 50 controls at once, all or none. Each entry sends `{ id, value, rev }`; the result has `changed`, `unchanged`, `affected` (the controls the write moved) and `missing` (required controls still empty), and `undoCommand: 'control-restore'` |
| `control-restore` | Puts back what a `control-set` replaced, skipping each control the person has changed since, with its reason |
| `control-choices` | Searches or pages through the choices of a control that has more than ten |

- **Kinds:** `text` (with `maxLength` and a `format` of `email`, `date`, `time`
  or `color`), `number` (with `min` and `max`), `boolean`, `choice` and
  `choices`. A choice may be sent by its value or its label.
- **What is refused:** a control that is not registered (`NOT_FOUND`), a
  secret (`FORBIDDEN`: it is listed without its value, error or `rev`), a
  control that is disabled, read-only or not shown, or a `rev` that is not the
  control's own (`CONFLICT`), and a value the control does not take
  (`VALIDATION_ERROR`). Each refusal carries a `suggestion` and a `recovery`,
  and `details.refused` lists every refused entry.
- **A person cannot call `control-set`:** a caller whose actor is `human` is
  refused, so create the agent's client with `actor: { kind: 'agent' }`.
  `control-restore` may be called by a person, for an undo button.
- **Default exposure:** `control-list`, `control-set` and `control-choices` go
  to the in-app agent only; `control-restore` goes to the agent and the command
  palette. None goes to MCP or the CLI unless you pass `expose`, which is merged
  over each default: `createControlCommands(controls, { expose: { mcp: true } })`.
- **Not stored:** the registry persists nothing.

A binder that makes a handler from a form's elements is a later phase; for now
an application writes its handlers itself.

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

Without an adapter, the registry works entirely in-memory, and neither entrypoint
requires `@lushly-dev/local-db` to be installed, including for TypeScript consumers.
Install it separately when using its adapters. The adapter option describes the
same structural contract as `DataAdapter`, so existing adapters and code that
reads `ViewStateRegistryOptions['adapter']` remain compatible.

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
| `hydrateOne(id)` | The same for one registered ID, leaving the other handlers as they are. An unregistered ID, a missing record or one in another category is ignored. Await it before any `set` or `replace` on that ID |
| `flush()` | Write all pending persistence immediately. Resolves with `{ failed }`, the IDs whose write failed; each is kept and written again by the next flush, unless a newer state or a hydrate replaced it. Never rejects |
| `destroy()` | Flush + clear all handlers |

## License

MIT
