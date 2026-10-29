# Stores and State Management Libraries

Comprehensive reference for selecting, configuring, and using state management stores across React, Vue, and Svelte ecosystems.

## Library Comparison Matrix

| Library | Model | Bundle size | Boilerplate | Devtools | Best for |
|---|---|---|---|---|---|
| **Redux Toolkit** | Centralized flux | ~11KB | Medium | Excellent (time-travel) | Large enterprise apps, strict patterns |
| **Zustand** | Centralized hooks | ~1.5KB | Minimal | Good (Redux DevTools) | Most React apps, simple to medium state |
| **Jotai** | Atomic bottom-up | ~4KB | Minimal | Good (Jotai DevTools) | Fine-grained derived state, concurrent mode |
| **Valtio** | Proxy-based mutable | ~3KB | Minimal | Good | Developers preferring mutable style |
| **Pinia** | Centralized (Vue) | ~2KB | Minimal | Excellent (Vue DevTools) | All Vue 3 projects |
| **Svelte stores** | Built-in reactive | 0KB (built-in) | Minimal | Via Svelte DevTools | All Svelte projects |
| **MobX** | Observable mutable | ~16KB | Low-medium | Good | Complex observable graphs |
| **TanStack Store** | Framework-agnostic | ~1KB | Minimal | Planned | Cross-framework state |

## Zustand (React)

### Core Setup

```typescript
import { create } from 'zustand';

interface BearState {
  bears: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
}

const useBearStore = create<BearState>((set, get) => ({
  bears: 0,
  increase: () => set((state) => ({ bears: state.bears + 1 })),
  decrease: () => set((state) => ({ bears: Math.max(0, state.bears - 1) })),
  reset: () => set({ bears: 0 }),
}));

// Usage with selector (prevents unnecessary re-renders)
const bears = useBearStore((state) => state.bears);
const increase = useBearStore((state) => state.increase);
```

### Middleware Stack

```typescript
import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const useStore = create<State>()(
  devtools(
    persist(
      immer(
        subscribeWithSelector((set, get) => ({
          // ... store definition
        }))
      ),
      { name: 'app-storage' }
    ),
    { name: 'AppStore' }
  )
);
```

| Middleware | Purpose |
|---|---|
| `devtools` | Redux DevTools integration, time-travel debugging |
| `persist` | Save/restore state to localStorage, sessionStorage, or custom storage |
| `immer` | Write mutable-looking code that produces immutable updates |
| `subscribeWithSelector` | Subscribe to specific state slices outside React |

### Zustand Patterns

**Slice pattern for large stores:**

```typescript
// bears-slice.ts
export const createBearSlice = (set) => ({
  bears: 0,
  addBear: () => set((state) => ({ bears: state.bears + 1 })),
});

// fish-slice.ts
export const createFishSlice = (set) => ({
  fishes: 0,
  addFish: () => set((state) => ({ fishes: state.fishes + 1 })),
});

// store.ts
const useStore = create((...a) => ({
  ...createBearSlice(...a),
  ...createFishSlice(...a),
}));
```

**External subscriptions (outside React):**

```typescript
const unsub = useBearStore.subscribe(
  (state) => state.bears,
  (bears, prevBears) => console.log('Bears changed:', prevBears, '->', bears)
);
```

**Async actions:**

```typescript
const useStore = create<State>((set) => ({
  users: [],
  loading: false,
  error: null,
  fetchUsers: async () => {
    set({ loading: true, error: null });
    try {
      const users = await api.getUsers();
      set({ users, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },
}));
```

## Jotai (React)

### Core Concepts

Jotai uses atoms -- the smallest unit of state. Components subscribe to individual atoms, causing re-renders only when their specific atoms change.

```typescript
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai';

// Primitive atom
const countAtom = atom(0);

// Derived (read-only) atom
const doubledAtom = atom((get) => get(countAtom) * 2);

// Derived (read-write) atom
const incrementAtom = atom(
  (get) => get(countAtom),
  (get, set) => set(countAtom, get(countAtom) + 1)
);

// Async atom
const userAtom = atom(async () => {
  const response = await fetch('/api/user');
  return response.json();
});

// Usage
function Counter() {
  const count = useAtomValue(countAtom);       // read only
  const setCount = useSetAtom(countAtom);       // write only
  const [value, setValue] = useAtom(countAtom);  // read + write
}
```

### Jotai Utilities and Extensions

```typescript
import { atomWithStorage } from 'jotai/utils';
import { atomWithQuery } from 'jotai-tanstack-query';
import { atomWithMachine } from 'jotai-xstate';

// Persistent atom (localStorage)
const themeAtom = atomWithStorage('theme', 'light');

// Atom backed by TanStack Query
const usersAtom = atomWithQuery(() => ({
  queryKey: ['users'],
  queryFn: fetchUsers,
}));

// Atom backed by XState machine
const authAtom = atomWithMachine(authMachine);
```

### Jotai Patterns

**Atom families (parameterized atoms):**

```typescript
import { atomFamily } from 'jotai/utils';

const todoAtomFamily = atomFamily((id: string) =>
  atom({ id, text: '', done: false })
);

// Usage -- each todo gets its own atom
const todo = useAtomValue(todoAtomFamily('todo-1'));
```

**Scoped atoms with Provider:**

```typescript
import { Provider } from 'jotai';

// Each Provider creates an isolated atom scope
<Provider>
  <ComponentA />  {/* Has its own countAtom instance */}
</Provider>
<Provider>
  <ComponentB />  {/* Has its own countAtom instance */}
</Provider>
```

## Valtio (React)

Valtio uses JavaScript Proxies to track which properties are accessed, enabling automatic re-render optimization.

```typescript
import { proxy, useSnapshot } from 'valtio';

// Define state with plain mutation
const state = proxy({
  count: 0,
  users: [] as User[],
});

// Mutate directly (outside or inside React)
state.count++;
state.users.push({ name: 'Alice' });

// In React -- useSnapshot creates an immutable snapshot for rendering
function Counter() {
  const snap = useSnapshot(state);
  return <p>{snap.count}</p>;
  // snap is read-only; mutate state directly instead
}
```

**Key characteristics:**
- Write mutable code; Valtio handles immutability under the hood
- Automatic render optimization via usage tracking (no selectors needed)
- Works well for developers coming from MobX or Vue's reactivity
- `derive()` for computed properties; `devtools()` for debugging

## Redux Toolkit (React)

### Modern Redux Setup

```typescript
import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Slice
const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0, status: 'idle' },
  reducers: {
    increment: (state) => { state.value += 1; },  // Immer under the hood
    decrement: (state) => { state.value -= 1; },
    incrementByAmount: (state, action) => { state.value += action.payload; },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCount.pending, (state) => { state.status = 'loading'; })
      .addCase(fetchCount.fulfilled, (state, action) => {
        state.status = 'idle';
        state.value = action.payload;
      });
  },
});

// Async thunk
const fetchCount = createAsyncThunk('counter/fetchCount', async () => {
  const response = await api.getCount();
  return response.data;
});

// Store
const store = configureStore({
  reducer: { counter: counterSlice.reducer },
});

// RTK Query for server state
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const api = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  endpoints: (builder) => ({
    getUsers: builder.query<User[], void>({ query: () => 'users' }),
    addUser: builder.mutation<User, Partial<User>>({
      query: (body) => ({ url: 'users', method: 'POST', body }),
      invalidatesTags: ['Users'],
    }),
  }),
});
```

**When to use Redux Toolkit:**
- Large teams needing strict, predictable patterns
- Applications requiring time-travel debugging
- Existing Redux codebases (RTK simplifies migration)
- Full-stack data management with RTK Query

## Pinia (Vue)

### Store Definition

```typescript
import { defineStore } from 'pinia';

// Option syntax
export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0, name: 'Counter' }),
  getters: {
    doubled: (state) => state.count * 2,
  },
  actions: {
    increment() { this.count++; },
    async fetchCount() {
      this.count = await api.getCount();
    },
  },
});

// Composition API syntax (recommended for complex stores)
export const useCounterStore = defineStore('counter', () => {
  const count = ref(0);
  const doubled = computed(() => count.value * 2);
  function increment() { count.value++; }
  return { count, doubled, increment };
});

// Usage
const store = useCounterStore();
store.count;       // reactive
store.increment();
store.$patch({ count: 10 });  // batch update
```

**Key characteristics:**
- Official Vue state management (replaced Vuex)
- Full TypeScript support with auto-completion
- Vue DevTools integration with time-travel
- Supports Options API and Composition API syntax
- SSR-friendly with built-in hydration support

## Svelte Stores

### Built-in Store Types

```typescript
import { writable, readable, derived } from 'svelte/store';

// Writable store
const count = writable(0);
count.set(5);
count.update(n => n + 1);

// Readable store (external data source)
const time = readable(new Date(), (set) => {
  const interval = setInterval(() => set(new Date()), 1000);
  return () => clearInterval(interval);
});

// Derived store
const doubled = derived(count, $count => $count * 2);

// Multi-source derived
const summary = derived(
  [count, time],
  ([$count, $time]) => `${$count} at ${$time}`
);
```

```svelte
<!-- Auto-subscription with $ prefix in Svelte components -->
<p>Count: {$count}</p>
<button on:click={() => $count++}>Increment</button>
```

**Svelte 5 runes (signals-based):**

```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);

  $effect(() => {
    console.log('Count changed:', count);
  });
</script>
```

## Selection Decision Tree

```
Start
  |
  ├── Is it server data (API responses)?
  |     └── YES -> TanStack Query / SWR (not a store)
  |
  ├── Is it a complex flow with finite states?
  |     └── YES -> XState
  |
  ├── Framework?
  |     ├── Vue -> Pinia
  |     ├── Svelte -> Built-in stores / runes
  |     └── React ->
  |           ├── Large team, strict patterns? -> Redux Toolkit
  |           ├── Prefer mutable style? -> Valtio
  |           ├── Complex derived state? -> Jotai
  |           └── General purpose? -> Zustand
  |
  └── Framework-agnostic needed?
        └── YES -> TC39 Signals polyfill / custom pub-sub
```

## Agentic Considerations

- **Check existing patterns first**: Before suggesting a library, inspect `package.json` for existing state management dependencies. Follow established patterns.
- **Do not mix competing solutions**: Never add Zustand to a project that already uses Jotai for the same purpose. Pick one store paradigm.
- **Prefer minimal solutions**: If the project has 2-3 pieces of shared state, React Context or Vue provide/inject may suffice. Do not over-engineer.
- **Generate typed stores**: Always define TypeScript interfaces for store state. Never use `any` or untyped store shapes.
- **Include selectors**: When generating Zustand code, always use selectors to prevent unnecessary re-renders. Never destructure the entire store.
