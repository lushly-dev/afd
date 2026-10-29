# Gating Patterns Reference

## Frontend Gating

### Declarative Gate Element

The preferred approach for frontend gating is a custom element that declaratively swaps content based on flag state. This pattern is framework-agnostic and works with any component system that supports slots or child projection.

#### Basic swap (enabled/disabled)

```html
<flag-gate flag="release/home-v2">
  <home-v2 slot="enabled"></home-v2>
  <home-v1 slot="disabled"></home-v1>
</flag-gate>
```

When the flag is on, the `enabled` slot content renders. When off, the `disabled` slot renders.

#### Show-only (no fallback)

```html
<flag-gate flag="ops/copilot-panel">
  <copilot-panel slot="enabled"></copilot-panel>
</flag-gate>
```

Content appears only when the flag is on. Nothing renders when off.

#### Inverted gate

```html
<flag-gate flag="ops/disable-animations" invert>
  <div slot="enabled" class="animated-intro">...</div>
</flag-gate>
```

The `invert` attribute reverses the logic: content in the `enabled` slot shows when the flag is **off**.

#### Gate Element Attributes

| Attribute | Type | Default | Description |
|---|---|---|---|
| `flag` | string | `''` | Flag name to evaluate |
| `invert` | boolean | `false` | Reverse the gate logic |

#### Implementation Notes

- The gate element should use `display: contents` to avoid adding visual footprint to the DOM
- Subscribe to the flag store's change notifications for reactive updates
- Use named slots (`enabled` / `disabled`) for explicit content assignment
- When the flag state changes, automatically swap which slot is visible

### Conditional Template Rendering

For cases where a full gate element is not warranted, use conditional rendering in templates:

```typescript
// In a component's template
render() {
  return html`
    ${when(
      flagStore.isEnabled(Flags.CompactSidebar),
      () => html`<compact-sidebar></compact-sidebar>`,
      () => html`<standard-sidebar></standard-sidebar>`
    )}
  `;
}
```

Use this approach for:
- Fine-grained property or attribute differences within a single component
- Inline conditional styling
- Cases where a gate element adds unnecessary DOM nesting

### Component-Level Gating

For entire component registrations or route-level gating:

```typescript
// Route-level gating
const routes = [
  {
    path: "/dashboard",
    component: flagStore.isEnabled(Flags.DashboardV2)
      ? "dashboard-v2"
      : "dashboard-v1",
  },
];
```

Note: Route-level gating evaluates once at route registration. If flags change at runtime, routes need re-registration or a reactive wrapper.

## Backend Gating

### Handler Delegation Pattern

The core principle: the command name, input schema, and output type **never change**. Only internal logic swaps based on flag state.

```typescript
// Internal handler for the default path
function handleDefault(input: MyInput): MyOutput {
  return { items: getBasicItems(input) };
}

// Internal handler for the flagged variant
function handleV2(input: MyInput): MyOutput {
  return {
    items: getEnhancedItems(input),
    analytics: getUsageData(),
  };
}

// Public command -- stable API contract
export const myCommand = defineCommand({
  name: "my-command",
  inputSchema: myInputSchema,   // Never changes
  outputSchema: myOutputSchema, // Never changes
  async handler(input) {
    const data = flagStore.isEnabled(Flags.MyFeatureV2)
      ? handleV2(input)
      : handleDefault(input);

    return success(data, {
      reasoning: `Used ${flagStore.isEnabled(Flags.MyFeatureV2) ? "v2" : "default"} handler`,
      confidence: 1,
    });
  },
});
```

### Anti-pattern: Separate Commands for Variants

```typescript
// WRONG -- creates parallel API surface
export const myCommandV1 = defineCommand({ name: "my-command-v1", ... });
export const myCommandV2 = defineCommand({ name: "my-command-v2", ... });
```

Problems with separate commands:
- Consumers must know which variant to call
- Schema divergence between versions
- Cleanup requires migrating all callers
- Breaks the principle that flags change internals, not contracts

### Multi-Flag Delegation

When a handler needs to check multiple flags:

```typescript
async handler(input) {
  // Evaluate flags in priority order
  if (flagStore.isEnabled(Flags.ExperimentalSearch)) {
    return handleExperimental(input);
  }
  if (flagStore.isEnabled(Flags.EnhancedSearch)) {
    return handleEnhanced(input);
  }
  return handleDefault(input);
}
```

Keep the priority chain explicit and linear. Avoid nested conditionals or complex flag combinations.

### Service-Level Gating

For gating at the service or middleware level:

```typescript
// Middleware-style gating
function withFeatureFlag(flagName: string, handler: Handler, fallback: Handler): Handler {
  return (input) => {
    return flagStore.isEnabled(flagName)
      ? handler(input)
      : fallback(input);
  };
}

// Usage
const searchHandler = withFeatureFlag(
  Flags.SearchV2,
  handleSearchV2,
  handleSearchDefault
);
```

## Reactive Flag Store

### Store Interface

A flag store should implement at minimum:

```typescript
interface FlagStore {
  // Query
  isEnabled(flagName: string): boolean;
  getFlag(flagName: string): FlagDefinition | undefined;
  getAllFlags(): FlagDefinition[];

  // Mutation
  setFlag(flagName: string, enabled: boolean): ValidationResult;
  resetAll(): void;

  // Lifecycle
  init(adapter: StorageAdapter): void;
}
```

### Reactivity Requirements

The store must notify consumers when flag state changes:

1. **Observable pattern** -- Implement as an observable so UI frameworks can subscribe
2. **Granular notifications** -- Notify only when specific flag values change, not on every store access
3. **Synchronous reads** -- `isEnabled()` must be synchronous for template rendering
4. **Persistent state** -- Flag overrides survive page reloads (use localStorage or equivalent)

### Storage Architecture

```
Seed catalog (committed JSON)
    |
    v
Storage adapter (localStorage, memory, etc.)
    |
    v
Flag store singleton (reactive, observable)
    |
    +---> Frontend gates (declarative elements, templates)
    +---> Backend handlers (delegation pattern)
    +---> Management commands (list, get, set, reset)
```

The seed catalog provides defaults. The storage adapter persists runtime overrides. The store merges both and exposes the current state.

## Testing Gated Code

### Setup

```typescript
import { createMemoryAdapter } from "./adapters/memory.js";

let flagStore: FlagStore;

beforeEach(() => {
  const adapter = createMemoryAdapter();
  flagStore = new FlagStore();
  flagStore.init(adapter);
  // All flags start with seed-data defaults (typically off)
});
```

### Testing Both Paths

```typescript
it("renders v2 layout when flag is enabled", () => {
  flagStore.setFlag(Flags.HomeV2, true);
  const result = render();
  expect(result).toContain("home-v2");
});

it("renders v1 layout when flag is disabled", () => {
  // Flag is off by default from seed data
  const result = render();
  expect(result).toContain("home-v1");
});
```

### Testing Validation

```typescript
it("warns when enabling a flag with unmet dependencies", () => {
  const result = flagStore.setFlag(Flags.EnhancedDashboard, true);
  expect(result.warnings).toContain("requires release/new-data-layer");
});

it("warns when enabling a flag that conflicts with an active flag", () => {
  flagStore.setFlag(Flags.LayoutA, true);
  const result = flagStore.setFlag(Flags.LayoutB, true);
  expect(result.warnings).toContain("conflicts with experiment/layout-a");
});
```

### Testing Gate Elements

```typescript
it("shows enabled slot when flag is on", async () => {
  flagStore.setFlag(Flags.HomeV2, true);
  const el = document.createElement("flag-gate");
  el.setAttribute("flag", Flags.HomeV2);
  el.innerHTML = `
    <div slot="enabled">V2</div>
    <div slot="disabled">V1</div>
  `;
  document.body.appendChild(el);
  await el.updateComplete;
  expect(getVisibleSlot(el)).toBe("enabled");
});
```

Always test both flag states to ensure clean fallback behavior and catch regressions in either path.
