---
status: complete
created: 2026-03-01
origin: fabric-ux-prototype — UI view state managed outside the command system, invisible to agents and tests
effort: S (1-2 days for Option A docs, M 3-5 days for Option B package)
package: "@lushly-dev/afd-view-state"
depends-on: "@lushly-dev/local-db"
---

# View State — AFD Command Pattern for UI State Management

## TL;DR

A new AFD pattern (and optional package) for managing UI view state — panels, sidebars, selections, tool modes, theme preferences — through the command system. One generic command (`view-state-set`) replaces per-surface UI state management, making every layout decision accessible to agents, tests, automation, and reload hydration through the same contract.

## Problem

AFD applications typically handle UI view state (what's open, what's selected, what mode you're in) outside the command system — via direct property assignments, localStorage, or framework-specific state. This creates gaps:

1. **Agents can't control layout** — opening a panel or switching tabs requires clicking, not commanding
2. **Tests are brittle** — Playwright clicks on coordinates instead of expressing intent
3. **State doesn't persist** — page reload loses layout, requiring manual re-setup
4. **No undo** — closing a panel can't be reversed through the command system
5. **Fragmented persistence** — each component invents its own save/load pattern

## Solution

### ViewStateRegistry

A singleton registry where components declare their view state by ID:

```ts
// Component registers once in connectedCallback
viewState.register('design-panel', {
  get: () => ({ open: this.isOpen, tab: this.activeTab, width: this.panelWidth }),
  set: (s) => {
    if (s.open !== undefined) this.isOpen = s.open;
    if (s.tab !== undefined) this.activeTab = s.tab;
    if (s.width !== undefined) this.panelWidth = s.width;
  },
});
```

### AFD Commands

Three commands provide the contract:

| Command | Description | Use cases |
|---|---|---|
| `view-state-get` | Read current state for a UI surface | Agent inspection, test assertions |
| `view-state-set` | Apply state (persists + triggers component) | Agent control, automation, reload hydration |
| `view-state-list` | List all registered view states | Discovery, debugging, state snapshots |

### Persistence

The registry persists to the `@lushly-dev/local-db` DataAdapter (settings table, `category='view-state'`). One bulk `GET /settings?category=view-state` on init replaces N individual hydration fetches.

### Key properties

- **Framework-agnostic** — works with FAST Element, React, vanilla JS (handlers are plain get/set functions)
- **Agent-accessible** — same command works for user clicks, agent instructions, test fixtures, and automation scripts
- **Undo support** — `view-state-set` captures previous state in `undoArgs`
- **Debounced persistence** — batches rapid changes (e.g., panel resize) into a single server write
- **Offline-safe** — falls back to defaults if server is unavailable

## Reference implementation

The pattern is validated in [fabric-ux-prototype](https://github.com/azure-data-intelligence-platform/fabric-ux-prototype) with these registered view states:

| ID | State | Component |
|---|---|---|
| `zero-shell` | toolMode, copilotOpen, sidebarWidth | Shell chrome |
| `theme` | darkMode, wireframeMode | Theme system |
| `design-panel` | open, tab, width | Design inspector |
| `selection` | selector (CSS selector) | Canvas selection |

## Package plan

### Option A: Pattern documentation only

Document the ViewStateRegistry pattern in AFD docs. Consumers copy the ~160-line `view-state.ts` utility and the command definitions. Lightest lift.

### Option B: `@lushly-dev/afd-view-state` package

A proper package exporting:
- `ViewStateRegistry` class + `viewState` singleton
- `createViewStateCommands(registry)` factory that generates the 3 AFD commands
- TypeScript types: `ViewStateHandler<T>`, `ViewStateEntry`

Depends on `@lushly-dev/local-db` for persistence.

### Recommendation

Start with **Option A** (docs), promote to **Option B** when a second consumer validates the pattern.

## Follow-up tasks

- [ ] Document the pattern in AFD docs (after merge in fabric-ux-prototype)
- [ ] Migrate fabric-ux-prototype to use the package once published
- [ ] Update AFD todo example with view state (selected item, filter mode)
- [ ] Add view state section to AFD skills

## Related

- `@lushly-dev/local-db` — DataAdapter interface used for persistence
- AFD `defineCommand` — command pattern used for the 3 view-state commands
- **Output schemas** — view-state commands should declare `output` so agents know response shapes before calling
- **Context scoping** — consider whether view-state commands should be universal or scoped to a UI context via `contexts`
- **Lazy discovery** — `afd-call` universal dispatcher works with view-state commands out of the box
- fabric-ux-prototype PR (view-state-commands branch)
