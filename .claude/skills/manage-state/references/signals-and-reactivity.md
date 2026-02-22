# Signals and Fine-Grained Reactivity

Deep reference for signal-based state management and fine-grained reactivity patterns across modern frameworks.

## What Are Signals

Signals are reactive primitives that hold a value and automatically notify dependents when that value changes. Unlike component-level reactivity (React's useState + virtual DOM diffing), signals enable **fine-grained reactivity** -- only the specific DOM nodes or computations that depend on a signal re-execute when it changes, skipping the component tree entirely.

### Core Signal Primitives

Every signal system provides three primitives:

| Primitive | Purpose | Behavior |
|---|---|---|
| **State signal** | Writable reactive value | Holds a value; notifies subscribers on write |
| **Computed signal** | Derived reactive value | Lazily re-evaluates when dependencies change; memoized |
| **Effect** | Side-effect runner | Re-runs when any accessed signal changes |

### The Reactive Graph

Signals form a directed acyclic graph (DAG):

```
[State A] ──┐
             ├──> [Computed C] ──> [Effect E]
[State B] ──┘
```

- **Push-based notification**: State changes push invalidation through the graph
- **Pull-based evaluation**: Computed values lazily recompute only when read
- **Glitch-free**: The graph resolves all dependencies before running effects, preventing intermediate inconsistent reads

## Framework Implementations

### SolidJS -- The Pioneer

Solid pioneered fine-grained reactivity in modern frameworks. Components run once (not on every render), and only signal-dependent expressions update.

```typescript
import { createSignal, createMemo, createEffect } from 'solid-js';

// State signal
const [count, setCount] = createSignal(0);

// Computed (memoized derivation)
const doubled = createMemo(() => count() * 2);

// Effect (side-effect on change)
createEffect(() => {
  console.log(`Count is ${count()}, doubled is ${doubled()}`);
});

// In JSX -- only this text node updates, not the whole component
const Counter = () => <p>Count: {count()}</p>;
```

**Key characteristics:**
- Components are plain functions that execute once
- Reactivity is tracked by function calls (`count()` not `count`)
- No virtual DOM -- updates go directly to real DOM nodes
- `createResource()` for async data with Suspense integration

### Angular Signals (v17+)

Angular adopted signals as a first-class reactivity primitive, complementing (and eventually replacing) RxJS for component-level state.

```typescript
import { signal, computed, effect } from '@angular/core';

// State signal
const count = signal(0);

// Read: count()
// Write: count.set(5) or count.update(c => c + 1)

// Computed
const doubled = computed(() => count() * 2);

// Effect
effect(() => {
  console.log(`Count: ${count()}`);
});
```

**Key characteristics:**
- Signals are zoneless -- they do not require Zone.js
- `computed()` signals are lazily evaluated and memoized
- Works alongside RxJS; `toSignal()` and `toObservable()` bridge the two
- Enables `OnPush` change detection by default with signals
- `input()`, `output()`, `model()` are signal-based component APIs

**Angular signal patterns:**

```typescript
// Signal-based component input
@Component({ ... })
export class UserCard {
  name = input.required<string>();    // signal-based input
  greeting = computed(() => `Hello, ${this.name()}`);
}

// Converting RxJS to signals
const data = toSignal(this.http.get<User[]>('/api/users'), { initialValue: [] });

// Converting signals to RxJS
const count$ = toObservable(count);
```

### Preact Signals

Preact Signals work across Preact and React (via adapter) with a minimal API.

```typescript
import { signal, computed, effect } from '@preact/signals';

const count = signal(0);
const doubled = computed(() => count.value * 2);

// Direct access via .value
count.value = 5;

// In JSX -- pass signal directly for fine-grained updates
const Counter = () => <p>Count: {count}</p>;
```

**Key characteristics:**
- Access via `.value` property
- Signals can be passed directly into JSX (Preact) for text-node-level updates
- `@preact/signals-react` adapter for React projects
- Globally accessible -- not scoped to components
- ~1KB bundle size

### Qwik Signals

Qwik uses signals as part of its resumability model, serializing signal state to HTML.

```typescript
import { component$, useSignal, useComputed$ } from '@builder.io/qwik';

export const Counter = component$(() => {
  const count = useSignal(0);
  const doubled = useComputed$(() => count.value * 2);

  return <button onClick$={() => count.value++}>
    {count.value} (doubled: {doubled.value})
  </button>;
});
```

**Key characteristics:**
- Signals serialize into HTML for instant resumability
- `useSignal()` for component-scoped signals
- `useStore()` for object-level reactive state
- Fine-grained updates without hydration cost

### Vue Reactivity (Signal-Like)

Vue's reactivity system predates the "signals" branding but follows the same principles.

```typescript
import { ref, reactive, computed, watchEffect } from 'vue';

// ref: wraps a single value
const count = ref(0);
count.value++;

// reactive: wraps an object with deep reactivity
const state = reactive({ count: 0, name: 'Vue' });
state.count++;

// computed: derived value
const doubled = computed(() => count.value * 2);

// watchEffect: runs on dependency change
watchEffect(() => console.log(count.value));
```

**Key characteristics:**
- `ref()` for primitives, `reactive()` for objects
- Proxy-based tracking (object-level) rather than function-call tracking
- `computed()` is lazy and cached
- `watch()` for explicit dependency watching with old/new values
- `shallowRef()` and `shallowReactive()` for opt-out of deep reactivity

## TC39 Signals Proposal

The TC39 Signals proposal (Stage 1 as of 2025) aims to standardize a signal primitive in JavaScript itself. It is a collaborative effort with input from Angular, Solid, Vue, Preact, Svelte, Ember, MobX, and others.

### Proposed API

```typescript
// State signal
const counter = new Signal.State(0);

// Read
counter.get();  // 0

// Write
counter.set(1);

// Computed signal
const isEven = new Signal.Computed(() => (counter.get() & 1) === 0);

// Effects are intentionally left to userland / frameworks
```

### Design Philosophy

- **Minimal API surface**: Only State and Computed are standardized; effects are framework-specific
- **Push-pull hybrid**: Invalidation is pushed, evaluation is pulled
- **Glitch-free**: Consistent reads within a computation
- **Auto-tracking**: Dependencies are discovered by reading signals during computation
- **Polyfill available**: `signal-polyfill` package for early adoption

### Implications for Framework Authors

When TC39 Signals ships:
- Frameworks can share a common reactive primitive
- Framework interop becomes possible (signals from Angular readable in Solid)
- Bundle sizes decrease as signal implementation moves to the engine
- The proposal is intentionally conservative -- production polyfill expected before standardization

## Patterns and Best Practices

### Signal Store Pattern

Organize related signals into a cohesive store module:

```typescript
// user-store.ts
import { signal, computed } from '@preact/signals';

const user = signal<User | null>(null);
const isAuthenticated = computed(() => user.value !== null);
const displayName = computed(() => user.value?.name ?? 'Guest');

export const userStore = {
  user,
  isAuthenticated,
  displayName,
  login: (u: User) => { user.value = u; },
  logout: () => { user.value = null; },
} as const;
```

### Avoiding Common Signal Pitfalls

| Pitfall | Problem | Fix |
|---|---|---|
| Reading signals outside tracking scope | Value read but no subscription created | Ensure reads happen inside computed/effect |
| Circular dependencies | Computed A depends on Computed B which depends on A | Restructure derivation graph; split state |
| Effects with side-effects that write signals | Infinite loops | Use `untrack()` or `batch()` to break cycles |
| Stale closures | Callback captures old signal value | Read signal inside the callback, not outside |
| Over-granular signals | Too many signals create graph overhead | Group related values into a single signal holding an object |

### Batching Updates

Most signal systems support batching to defer notifications:

```typescript
// Solid
import { batch } from 'solid-js';
batch(() => {
  setFirst('Jane');
  setLast('Doe');
}); // Effects run once, not twice

// Preact Signals
import { batch } from '@preact/signals';
batch(() => {
  count.value = 1;
  name.value = 'Updated';
});

// Angular -- signals batch automatically within change detection
```

### Migration Path: React useState to Signals

For projects considering a gradual migration:

1. **Phase 1**: Use `@preact/signals-react` alongside existing useState
2. **Phase 2**: Convert leaf components to signals for fine-grained updates
3. **Phase 3**: Move shared state from Context/Redux to signal stores
4. **Phase 4**: Evaluate full framework migration if performance gains justify it

## Performance Characteristics

| Aspect | Signals (fine-grained) | Virtual DOM (React-style) |
|---|---|---|
| Update granularity | DOM node level | Component subtree level |
| Dependency tracking | Automatic at read time | Manual (deps arrays, memo) |
| Render overhead | None (no VDOM diffing) | Diff + reconciliation per component |
| Memory | Signal graph overhead | VDOM tree overhead |
| Best for | Frequent, localized updates | Complex component compositions |
| Worst for | Massive signal graphs (10k+) | High-frequency updates to deep trees |

## Agentic Considerations

When an AI agent works with signals:

- **Detect the framework first**: Check `package.json` or imports to determine which signal system is in use
- **Prefer framework-native signals**: Do not introduce @preact/signals into an Angular project; use Angular's `signal()`
- **Preserve reactivity**: When refactoring, ensure computed values remain derived (do not convert them to manual state)
- **Test derivations**: Generate tests that verify computed signals update correctly when source signals change
- **Watch for effects**: If generating code that writes to signals inside effects, add explicit guards to prevent infinite loops
