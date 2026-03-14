# Zero Chat Tool Commands

> Plan: Add canvas-awareness commands to the Zero chat agent — perception (read selection, inspect components, query routes, walk DOM, capture screenshots) and manipulation (edit attributes, navigate, select elements, toggle overlays)

---
status: captured
created: 2026-02-27
origin: Post-merge review of Zero chat sidebar improvements (#82). The chat agent can execute AFD commands via `execute_afd_command` meta-tool, but the existing 46-command catalog has no commands for canvas awareness — selection state, component inspection, route introspection, visual capture, or DOM structure queries. The agent receives basic context (route, selected tag/id) with each message, but cannot programmatically read, inspect, or modify the live canvas.
effort: L (5-8 days)
package: "@lushly-dev/afd-server", "@lushly-dev/afd-core", "fabric-ux-prototype"
depends-on: AFD 0.3.0 upgrade (requires, expose, suggestions, undoCommand, McpImageContent)
---

## Problem

Zero's chat agent lives inside the Fabric Zero Shell and helps designers iterate on the live prototype. After the recent Zero chat sidebar improvements (#82), the agent can invoke 46 AFD commands — but none of them let it **see or act on** the canvas the designer is working in.

### What the agent cannot do today

| Need | Current state | Impact |
|------|---------------|--------|
| Read what's selected | Tag name + ID sent as message context only | Agent can't inspect attributes, slots, events, or component API |
| Inspect component API | CEM loader exists in UI layer only | Agent can't recommend property changes or suggest alternatives |
| Read the DOM tree | No command | Agent can't understand page structure or find elements |
| Navigate routes | Only `nav-list`/`nav-select` for hubs | Agent can't navigate to `/item/:id` or read route params |
| Edit element attributes | Only `icon-set` for icons, HUD for manual editing | Agent can't programmatically change appearance, size, text, etc. |
| Capture screenshots | No capability exists | Agent can't see what the designer sees or verify visual changes |
| Read computed styles | No command | Agent can't verify token usage or diagnose styling issues |
| Query component catalog | Only via Nexus KB (external) | Agent can't recommend components from the 65+ library |
| Walk selection breadcrumb | `selectionPath` observable, UI only | Agent can't navigate parent/child relationships |
| Toggle overlays | UI only | Agent can't show/hide selection highlights or HUD panels |

### Rich capabilities exist but aren't exposed

The prototype has sophisticated selection, inspection, and editing capabilities in its UI layer that are completely invisible to the chat agent:

- **Selection service** (`src/utils/selection-service.ts`) — `getComponentInfo()`, `selectionPath`, `getChildren()`, shadow DOM piercing
- **CEM loader** (`src/utils/cem-loader.ts`) — `getCEMInfo()`, `classifyAttributes()` with control type inference
- **Component HUD** (`src/components/component-hud/component-hud.ts`) — `applyAttribute()`, `toggleBoolAttr()` with reactive read-back
- **Router** (`src/utils/router.ts`) — `currentRoute`, `navigate()`, `navigateByName()`, full route registry

All of these run in the browser main thread — the same execution context as AFD command handlers. Exposing them as commands requires only wrapping existing service calls, not building new infrastructure.

## Proposed Solution

Add **12 new AFD commands** across 3 new files under a new `'zero'` category. These commands wrap existing browser-side singletons and expose them to the chat agent via the existing `execute_afd_command` meta-tool bridge.

### Prerequisites

**AFD 0.3.0 upgrade** — The prototype currently uses `@lushly-dev/afd-core: ^0.1.1` and `@lushly-dev/afd-server: ^0.1.0`. The 0.3.0 release (published 2026-02-27) adds several features purpose-built for these tool commands:

| Feature | Usage in this plan |
|---------|-------------------|
| `requires: string[]` | Inspection commands declare `requires: ['selection-get']` — agent learns workflow ordering |
| `expose: ExposeOptions` | All zero commands set `{ agent: true, mcp: true }` for Copilot access |
| `suggestions: string[]` | Every result includes next-step hints for the agent |
| `undoCommand` + `undoArgs` | `element-set-attribute` and `route-navigate` provide serializable undo |
| `destructive` + `confirmPrompt` | Future-proof for dangerous mutations |
| `McpImageContent` | `screenshot-capture` returns base64 PNG via native MCP image type |

### Architecture

```
                               ┌─────────────────────────────┐
                               │     Copilot SDK (server)     │
                               │  execute_afd_command tool    │
                               └──────────┬──────────────────┘
                                          │ WebSocket
                               ┌──────────▼──────────────────┐
                               │   copilot-bridge (browser)   │
                               │   allCommands.find(name)     │
                               └──────────┬──────────────────┘
                                          │ direct call
              ┌───────────────────────────▼────────────────────────────┐
              │                 AFD Command Handlers                   │
              │                (browser main thread)                   │
              ├────────────────────┬──────────────────┬────────────────┤
              │  selection-commands│  canvas-commands  │  nav.ts (ext)  │
              │  ┌──────────────┐ │  ┌──────────────┐ │ ┌────────────┐ │
              │  │selection-get │ │  │dom-query     │ │ │route-get   │ │
              │  │sel.-inspect  │ │  │component-qry │ │ │route-nav   │ │
              │  │sel.-breadcrmb│ │  │screenshot-cap│ │ └────────────┘ │
              │  │sel.-select   │ │  │overlay-toggle│ │                │
              │  │elem-set-attr │ │  └──────────────┘ │                │
              │  │elem-get-style│ │                    │                │
              │  └──────┬───────┘ └────────┬───────────┘                │
              └─────────┼──────────────────┼───────────────────────────┘
                        │                  │
         ┌──────────────▼───┐    ┌─────────▼──────────┐
         │ selectionService │    │  CEM loader         │
         │ router           │    │  html2canvas        │
         │ store            │    │  overlay-host       │
         └──────────────────┘    └────────────────────┘
```

All handlers run in the browser main thread. They import singletons at module scope (established pattern from `nav.ts`, `prototype-info.ts`, `icon-commands.ts`). No serialization boundary between commands and the DOM.

## Command Catalog

### Tier 1 — Perception (read the canvas)

#### `selection-get` — Read the selected element

```typescript
defineCommand({
  name: 'selection-get',
  description: 'Read the currently selected element in the canvas',
  category: 'zero',
  mutation: false,
  executionTime: 'instant',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'selection', 'read', 'safe'],
  errors: ['NOT_FOUND'],
  input: z.object({}),
});
```

**Returns:** `{ tag, id, textContent (first 200 chars), attributes: [{name, value}], boundingRect: {x, y, width, height}, hasChildren: boolean }`

**Error:** `NOT_FOUND` if nothing selected → `suggestion: 'Click an element in the canvas while in select mode, or use selection-select with a CSS selector'`

**Result metadata:**
- `suggestions: ['Use selection-inspect for CEM-enriched details', 'Use element-set-attribute to modify properties']`

**Implementation:** Import `selectionService` → call `getComponentInfo(selectedElement)` → map to output shape.

---

#### `selection-inspect` — Deep CEM-enriched inspection

```typescript
defineCommand({
  name: 'selection-inspect',
  description: 'Inspect the selected element with full component API details from the Custom Elements Manifest',
  category: 'zero',
  mutation: false,
  executionTime: 'fast',
  requires: ['selection-get'],
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'selection', 'inspection', 'read', 'safe'],
  errors: ['NOT_FOUND', 'CEM_NOT_LOADED'],
  input: z.object({}),
});
```

**Returns:** `{ tag, className, description, attributes: { primary: ClassifiedAttribute[], secondary: ClassifiedAttribute[] }, slots: [{name, description}], events: [{name, description}], sourcePath }`

Where `ClassifiedAttribute` includes: `{ name, controlType, options, liveValue, default, description }`

**Implementation:** Import `getCEMInfo()` and `classifyAttributes()` from CEM loader. Merge with live attribute values from the selected element.

---

#### `selection-breadcrumb` — Selection ancestry path

```typescript
defineCommand({
  name: 'selection-breadcrumb',
  description: 'Get the parent chain from canvas root to the currently selected element',
  category: 'zero',
  mutation: false,
  executionTime: 'instant',
  requires: ['selection-get'],
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'selection', 'navigation', 'read', 'safe'],
  errors: ['NOT_FOUND'],
  input: z.object({}),
});
```

**Returns:** `{ path: [{ tag, id, depth }], selectedIndex: number }`

**Implementation:** Read `selectionService.selectionPath` and map each element to `{ tag, id, depth }`.

---

#### `element-get-styles` — Computed token values

```typescript
defineCommand({
  name: 'element-get-styles',
  description: 'Read computed Fabric design token values on the selected element or a targeted element',
  category: 'zero',
  mutation: false,
  executionTime: 'instant',
  requires: ['selection-get'],
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'style', 'tokens', 'read', 'safe'],
  errors: ['NOT_FOUND'],
  input: z.object({
    selector: z.string().optional().describe('CSS selector to target a specific element (default: selected element)'),
    tokens: z.array(z.string()).optional().describe('Specific token names to read (default: all common tokens)'),
  }),
});
```

**Returns:** `{ tokens: { [tokenName]: computedValue }, dimensions: { width, height, x, y } }`

Reads a curated set of ~40 common Fabric design tokens via `window.getComputedStyle()`:
- Color tokens: `colorNeutralForeground1`, `colorNeutralBackground1`, `colorBrandForeground1`, etc.
- Spacing tokens: `spacingVerticalS`, `spacingVerticalM`, `spacingHorizontalM`, etc.
- Typography tokens: `fontFamilyBase`, `fontSizeBase300`, `fontWeightSemibold`, etc.
- Border tokens: `borderRadiusMedium`, `strokeWidthThin`, etc.

**No external dependency** — uses native `getComputedStyle()` API only.

---

#### `dom-query` — Component tree structure

```typescript
defineCommand({
  name: 'dom-query',
  description: 'Query the component tree structure from a root element, showing custom element nesting',
  category: 'zero',
  mutation: false,
  executionTime: 'fast',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'dom', 'tree', 'read', 'safe'],
  errors: ['NOT_FOUND'],
  input: z.object({
    selector: z.string().optional().describe('CSS selector for root element (default: canvas root)'),
    depth: z.number().min(1).max(6).optional().describe('Max tree depth (default: 3)'),
  }),
});
```

**Returns:** `{ root: TreeNode }` where `TreeNode = { tag, id, childCount, children?: TreeNode[] }`

**Implementation:** Uses `selectionService.getChildren()` recursively. Truncates at depth limit but includes `childCount` hint. Shadow DOM is pierced automatically by the selection service.

---

#### `component-query` — Search the component catalog

```typescript
defineCommand({
  name: 'component-query',
  description: 'Search the Custom Elements Manifest for available Fabric components by name, description, or attribute',
  category: 'zero',
  mutation: false,
  executionTime: 'fast',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'cem', 'catalog', 'read', 'safe'],
  errors: [],
  input: z.object({
    query: z.string().describe('Search term to match against component names, descriptions, and attributes'),
    limit: z.number().min(1).max(20).optional().describe('Maximum results to return (default: 10)'),
  }),
});
```

**Returns:** `{ matches: [{ tag, description, attributeCount, slotCount, eventCount }], total: number }`

**Implementation:** Imports CEM loader's indexed manifest. Searches across tag names (including aliases), descriptions, and attribute names. Case-insensitive partial matching.

---

#### `screenshot-capture` — Visual canvas capture

```typescript
defineCommand({
  name: 'screenshot-capture',
  description: 'Capture a screenshot of the canvas or selected element as a base64 PNG image',
  category: 'zero',
  mutation: false,
  executionTime: 'slow',
  expose: { agent: true, mcp: true, palette: false },
  tags: ['zero', 'visual', 'capture', 'read'],
  errors: ['NOT_FOUND', 'CAPTURE_FAILED', 'FEATURE_DISABLED'],
  input: z.object({
    target: z.enum(['canvas', 'selection']).optional().describe('What to capture (default: canvas)'),
    scale: z.number().min(0.25).max(2).optional().describe('Scale factor for the capture (default: 1)'),
  }),
});
```

**Returns:** `{ base64: string, width: number, height: number, mimeType: 'image/png' }`

**Dependencies:** `html2canvas` (new dev dependency). Gated behind `Flags.ScreenshotTool` (`ops/screenshot-tool`) — returns `FEATURE_DISABLED` error when flag is off.

**Bridge enhancement:** The copilot tool bridge (`copilot-tool-bridge.ts`) needs a postprocessor to detect image results (by `mimeType` field) and return them as `McpImageContent` alongside the text result for rich rendering in agents that support images.

---

#### `route-get` — Current route state

```typescript
defineCommand({
  name: 'route-get',
  description: 'Get the current route and list of all registered routes in the prototype',
  category: 'zero',
  mutation: false,
  executionTime: 'instant',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'navigation', 'routing', 'read', 'safe'],
  errors: [],
  input: z.object({}),
});
```

**Returns:** `{ current: { path, name, params, component, title } | null, routes: [{ path, name, component, title }] }`

**Implementation:** Import `router` singleton → read `currentRoute` + `routes`.

---

### Tier 2 — Manipulation (act on the canvas)

#### `selection-select` — Programmatically select an element

```typescript
defineCommand({
  name: 'selection-select',
  description: 'Select an element in the canvas by CSS selector',
  category: 'zero',
  mutation: true,
  executionTime: 'fast',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'selection', 'update'],
  errors: ['NOT_FOUND'],
  input: z.object({
    selector: z.string().describe('CSS selector to find and select the element'),
  }),
});
```

**Returns:** Same shape as `selection-get` for the newly selected element.

**Implementation:** Uses `document.querySelector()` with a helper that walks `shadowRoot` boundaries (following the pattern in `selectionService.elementFromPoint()`). After finding the element, triggers selection via the selection service.

---

#### `element-set-attribute` — Edit element attributes

```typescript
defineCommand({
  name: 'element-set-attribute',
  description: 'Set or remove an attribute on the selected element or a targeted element',
  category: 'zero',
  mutation: true,
  executionTime: 'instant',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'element', 'edit', 'update'],
  errors: ['NOT_FOUND', 'VALIDATION_ERROR'],
  input: z.object({
    attribute: z.string().describe('Attribute name to set (e.g., "appearance", "size", "disabled")'),
    value: z.string().describe('Attribute value to set. Empty string removes the attribute. "true"/"false" for booleans.'),
    selector: z.string().optional().describe('CSS selector to target a specific element (default: selected element)'),
  }),
});
```

**Returns:** `{ tag, attribute, previousValue, newValue, allAttributes: [{name, value}] }`

**Undo:** Returns `undoCommand: 'element-set-attribute'` with `undoArgs: { attribute, value: previousValue, selector }` — enables the agent to offer undo after changes.

**Implementation:** Follows the `applyAttribute()` pattern from component HUD:
- Empty string or `'false'` → `removeAttribute(name)`
- `'true'` → `setAttribute(name, '')` (boolean attribute)
- Otherwise → `setAttribute(name, value)`
- Read back the value after setting to confirm and report live state.

---

#### `route-navigate` — Navigate to any route

```typescript
defineCommand({
  name: 'route-navigate',
  description: 'Navigate to a route by path or route name',
  category: 'zero',
  mutation: true,
  executionTime: 'instant',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'navigation', 'routing', 'update'],
  errors: ['NOT_FOUND'],
  input: z.object({
    path: z.string().optional().describe('URL path to navigate to (e.g., "/workspaces", "/item/abc-123")'),
    name: z.string().optional().describe('Route name to navigate to (e.g., "home", "editor")'),
  }),
});
```

**Returns:** `{ previous: { path, name }, current: { path, name, params, component, title } }`

**Undo:** Returns `undoCommand: 'route-navigate'` with `undoArgs: { path: previousPath }`.

**Validation:** At least one of `path` or `name` must be provided. If `name` is given, validates against `router.routes` before navigating.

---

#### `overlay-toggle` — Show/hide overlay layers

```typescript
defineCommand({
  name: 'overlay-toggle',
  description: 'Show or hide the canvas overlay layers (selection highlights, HUD panels, annotation pins)',
  category: 'zero',
  mutation: true,
  executionTime: 'instant',
  expose: { agent: true, mcp: true, palette: true },
  tags: ['zero', 'overlay', 'ui', 'update'],
  errors: ['NOT_FOUND'],
  input: z.object({
    visible: z.boolean().optional().describe('Set overlay visibility. Omit to toggle.'),
  }),
});
```

**Returns:** `{ visible: boolean }`

**Undo:** Returns `undoCommand: 'overlay-toggle'` with `undoArgs: { visible: previousState }`.

**Implementation:** Finds `overlay-host` element → toggles its `hidden` observable.

## File Organization

```
src/afd/commands/
  selection-commands.ts  ← NEW (~250 lines)
    selection-get
    selection-inspect
    selection-breadcrumb
    selection-select
    element-set-attribute
    element-get-styles

  canvas-commands.ts     ← NEW (~250 lines)
    dom-query
    component-query
    screenshot-capture
    overlay-toggle

  nav.ts                 ← EXTENDED (+~50 lines)
    route-get
    route-navigate
    (existing: nav-list, nav-select)

  index.ts               ← MODIFIED (import + registration)
```

Three files keeps each under the 300-line warning threshold and groups by domain.

## Registration

```typescript
// src/afd/commands/index.ts — additions
import { selectionCommands } from './selection-commands.js';
import { canvasCommands } from './canvas-commands.js';
// route-get and route-navigate added to existing navList/navSelect exports in nav.ts

export { selectionCommands } from './selection-commands.js';
export { canvasCommands } from './canvas-commands.js';

// Add to allCommands array
export const allCommands = [
  ...prototypeCommands,
  ...fabricCommands,
  ...localDataCommands,
  ...featureFlagCommands,
  ...selectionCommands,  // NEW
  ...canvasCommands,     // NEW
];
```

The system message in `copilot-system-message.ts` auto-discovers commands via `formatCatalog()` which groups by category — the new `[zero]` category will appear automatically.

## Bridge Enhancement

The tool bridge (`copilot-tool-bridge.ts`) currently serializes all results as JSON strings. For `screenshot-capture`, the result contains a base64 image. To leverage the MCP protocol's native image support:

```typescript
// In handleAfdResult or createAfdTool handler
if (result?.data?.mimeType?.startsWith('image/')) {
  // Return as MCP image content alongside text summary
  return JSON.stringify({
    success: true,
    data: result.data,
    _mcpImage: {
      type: 'image',
      data: result.data.base64,
      mimeType: result.data.mimeType,
    },
  });
}
```

This is additive — all other results pass through unchanged.

## System Message Update

Add a brief section to the system message explaining canvas awareness:

```
── Canvas Awareness ──
You can see and act on the live canvas:
- Inspect selected elements (selection-get, selection-inspect)
- Read component APIs from the 65+ catalog (component-query)
- Navigate routes (route-get, route-navigate)
- Walk the DOM tree (dom-query)
- Edit element attributes (element-set-attribute)
- Read computed design tokens (element-get-styles)
- Capture screenshots (screenshot-capture)

When a designer selects an element and asks a question, start with
selection-get to understand context, then selection-inspect for details.
```

## Dependencies

| Dependency | Type | Purpose |
|-----------|------|---------|
| `@lushly-dev/afd-core: ^0.3.0` | Upgrade | `requires`, `expose`, `suggestions`, `undoCommand`, `McpImageContent` |
| `@lushly-dev/afd-server: ^0.3.0` | Upgrade | Updated `defineCommand()` with new fields |
| `html2canvas` | New dev dep | `screenshot-capture` canvas rendering |

## Feature Flag

```json
"ops/screenshot-tool": {
  "name": "ops/screenshot-tool",
  "description": "Enable screenshot capture command in Zero chat",
  "enabled": true,
  "type": "ops",
  "createdAt": "2026-02-27T00:00:00Z"
}
```

Added to:
- `data/prototype.db.json` seed catalog
- `src/afd/adapters/local-db.ts` `defaultData.flags`
- `src/utils/feature-flags.ts` `Flags.ScreenshotTool`
- Bump `_schemaVersion` for deep merge migration

## Testing

### Unit tests (Vitest + jsdom)

| Test file | Commands tested | Key cases |
|-----------|----------------|-----------|
| `tests/selection-commands.test.ts` | selection-get, selection-inspect, selection-breadcrumb, selection-select, element-set-attribute, element-get-styles | No selection → NOT_FOUND, CEM lookup, attribute edit + undo, shadow DOM selector fallback |
| `tests/canvas-commands.test.ts` | dom-query, component-query, screenshot-capture, overlay-toggle | Tree depth limiting, CEM search matching, flag gating, toggle undo |
| `tests/nav-commands.test.ts` (extend) | route-get, route-navigate | Unknown route → NOT_FOUND, path vs name navigation, undo with previous path |

### Mock strategy

All tests mock the browser singletons:
- `selectionService` — mock `selectedElement`, `getComponentInfo()`, `selectionPath`, `getChildren()`
- `router` — mock `currentRoute`, `routes`, `navigate()`, `navigateByName()`
- CEM loader — mock `getCEMInfo()`, `classifyAttributes()`, indexed manifest
- `html2canvas` — mock to return a fake canvas with `toDataURL()` stub

### Validation

```bash
npm run typecheck    # New files compile with 0.3.0 types
npm run test         # All new + existing tests pass
npm run lint         # Biome clean
npm run check        # Full quality gate
```

### Manual verification

1. Start dev server (`npm run dev`)
2. Open Zero chat
3. Ask _"What commands are available?"_ → confirm `[zero]` category with all 12 commands
4. Select a `<fabric-button>` → ask _"What is this?"_ → confirm `selection-get` fires
5. Ask _"What can I change on it?"_ → confirm `selection-inspect` fires with attributes
6. Ask _"Set appearance to primary"_ → confirm `element-set-attribute` fires
7. Ask _"Where am I?"_ → confirm `route-get` fires with current route
8. Ask _"Show me the page structure"_ → confirm `dom-query` fires with tree
9. Ask _"Take a screenshot"_ → confirm `screenshot-capture` fires (if flag enabled)

## Implementation Order

| Phase | Work | Files | Est. |
|-------|------|-------|------|
| **0** | Upgrade AFD 0.3.0, npm install, verify existing commands | `package.json` | 0.5d |
| **1** | Selection + element commands | `src/afd/commands/selection-commands.ts` | 1.5d |
| **2** | Canvas + DOM commands | `src/afd/commands/canvas-commands.ts` | 1.5d |
| **3** | Route commands (extend nav.ts) | `src/afd/commands/nav.ts` | 0.5d |
| **4** | Registration, flag, bridge, system message | `index.ts`, `feature-flags.ts`, `copilot-tool-bridge.ts`, `copilot-system-message.ts`, `local-db.ts`, `prototype.db.json` | 1d |
| **5** | Unit tests | `tests/selection-commands.test.ts`, `tests/canvas-commands.test.ts`, `tests/nav-commands.test.ts` | 1.5d |
| **6** | Manual testing + polish | — | 0.5d |
| | **Total** | | **7d** |

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **New `'zero'` category** | Separates canvas-awareness tools from general prototype commands. Clear signal in system message and `afd-help`. |
| **AFD 0.3.0 upgrade first** | Unlocks `requires`, `expose`, `suggestions`, `undoCommand`, `McpImageContent` — all directly useful. Backward-compatible. Published to npm 2026-02-27. |
| **3 files, not 1 monolith** | Keeps each under the 300-line warning threshold. Groups by domain (selection, canvas, navigation). |
| **`html2canvas` for screenshots** | Only viable browser-side approach for pixel capture. Gated behind ops flag. `McpImageContent` gives clean return type. |
| **`element-get-styles` uses native API** | `getComputedStyle()` is zero-dependency and returns real resolved token values. No need for html2canvas here. |
| **`requires` for inspection commands** | `selection-inspect`, `selection-breadcrumb`, `element-get-styles` declare `requires: ['selection-get']`. Agent learns the selection → inspect ordering from metadata. |
| **Undo on all mutations** | `element-set-attribute`, `route-navigate`, `overlay-toggle` include `undoCommand`/`undoArgs`. Enables agent to offer undo. |
| **Meta-tool bridge unchanged** | New commands auto-discovered via `allCommands`. Only enhancement is image content postprocessor for screenshots. |
| **Module-level singleton imports** | Established pattern (`nav.ts` → `featureRegistry`, `prototype-info.ts` → `store`). Handlers run in browser thread with full DOM access. |

## Future Considerations

- **Batch operations** — `afd-batch` from 0.3.0 enables multi-command roundtrips. Agent could call `selection-get` + `selection-inspect` + `element-get-styles` in one batch.
- **Pipeline workflows** — `afd-pipe` enables `selection-get → selection-inspect → element-set-attribute` chains with `$prev` variable resolution.
- **Streaming for large DOM trees** — If `dom-query` at depth 6 returns very large trees, consider streaming chunks via `StreamChunk<T>`.
- **Output schema predictability** — When the `output` schema proposal ships, add Zod output schemas to all zero commands for pipeline field reference safety.
- **Schema examples** — When the `examples` proposal ships, add concrete input examples (e.g., `{ selector: 'fabric-button[appearance="primary"]' }`) to help agents construct valid inputs.
