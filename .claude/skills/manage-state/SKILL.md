---
name: manage-state
source: botcore
description: >
  Guides state management architecture and implementation across frontend and backend applications. Covers signals and fine-grained reactivity (Preact, Angular, Solid, TC39 proposal), atomic and proxy stores (Zustand, Jotai, Valtio, Pinia, Svelte stores), state machines and statecharts (XState), server state synchronization (TanStack Query, SWR), reactive primitives, pub/sub and observable patterns, CQRS/command pattern, and Python state management (dataclasses, Pydantic, transitions, event-driven patterns). Use when choosing a state management approach, implementing stores or signals, modeling complex UI flows with state machines, synchronizing server state, debugging reactivity issues, or migrating between state libraries. Triggers: state management, signals, store, Zustand, Jotai, Redux, Pinia, XState, state machine, TanStack Query, SWR, reactivity, observable, pub/sub, Pydantic state, reactive, server state, cache invalidation.

version: 1.0.0
triggers:
  - state management
  - signals
  - store
  - Zustand
  - Jotai
  - Valtio
  - Redux
  - Pinia
  - XState
  - state machine
  - statechart
  - TanStack Query
  - SWR
  - reactivity
  - observable
  - pub/sub
  - reactive
  - server state
  - cache invalidation
  - fine-grained reactivity
  - Svelte store
  - Pydantic state
  - event-driven state
  - global state
  - local state
  - derived state
  - computed state
portable: true
---

# Managing State

Architecture and implementation guidance for state management across frontend frameworks, backend services, and agentic workflows.

## Capabilities

1. **Select state management approach** -- Evaluate project requirements and recommend the right pattern (signals, atomic stores, centralized stores, state machines, or server state)
2. **Implement signals and fine-grained reactivity** -- Build reactive state with signals in Angular, Solid, Preact, Qwik, or framework-agnostic TC39-aligned patterns
3. **Configure stores** -- Set up Zustand, Jotai, Valtio, Redux Toolkit, Pinia, or Svelte stores with middleware, persistence, and devtools
4. **Model complex flows with state machines** -- Design statecharts and state machines using XState for multi-step forms, wizards, async workflows, and UI orchestration
5. **Synchronize server state** -- Implement TanStack Query or SWR for caching, background refetching, optimistic updates, and cache invalidation
6. **Apply framework-agnostic patterns** -- Use pub/sub, observable stores, command/CQRS patterns, and event-driven architectures across any stack
7. **Manage Python application state** -- Structure state with dataclasses, Pydantic models, Python state machines (transitions, python-statemachine), and async event-driven patterns
8. **Guide agentic state operations** -- Help AI agents reason about state shape, select appropriate patterns, and avoid common state management pitfalls

## Routing Logic

| Request type | Load reference |
|---|---|
| Signals, fine-grained reactivity, TC39 signals proposal, framework reactivity | [references/signals-and-reactivity.md](references/signals-and-reactivity.md) |
| Zustand, Jotai, Valtio, Redux, Pinia, Svelte stores, store selection | [references/stores-and-libraries.md](references/stores-and-libraries.md) |
| XState, state machines, statecharts, complex UI flows, wizards | [references/state-machines.md](references/state-machines.md) |
| TanStack Query, SWR, server state, caching, cache invalidation | [references/server-state.md](references/server-state.md) |
| Pub/sub, observables, CQRS, command pattern, event-driven | [references/framework-agnostic-patterns.md](references/framework-agnostic-patterns.md) |
| Python dataclasses, Pydantic, transitions, async state machines | [references/python-state.md](references/python-state.md) |

## Core Principles

### 1. Categorize State Before Choosing Tools

State falls into distinct categories that demand different solutions. Mixing categories in a single tool creates unnecessary complexity.

| Category | Description | Typical solution |
|---|---|---|
| **UI state** | Ephemeral, component-local (toggles, form input focus) | Component-local state, signals |
| **Client state** | Shared across components (theme, auth, sidebar) | Stores (Zustand, Jotai, Pinia) |
| **Server state** | Data owned by a remote source (API responses, DB records) | TanStack Query, SWR |
| **URL state** | Current route, search params, hash | Router, URL search params |
| **Form state** | Field values, validation, dirty/pristine tracking | Form libraries or local state |
| **Machine state** | Finite states with explicit transitions (checkout flow, wizard) | XState, state machines |

**Agentic consideration**: When an agent is asked to "add state management," first classify what kind of state is involved. Never default to a global store for server-owned data.

### 2. Colocate State With Its Consumers

State should live as close as possible to where it is read and written. Lifting state higher than necessary causes prop drilling, unnecessary re-renders, and tight coupling. Only promote state to a shared store when multiple unrelated components need it.

### 3. Derive, Don't Duplicate

Computed or derived values should be calculated from source state, never stored separately. Signals, computed atoms, and selectors exist specifically for this purpose. Duplicated state is a synchronization bug waiting to happen.

```typescript
// Good: derived from source
const fullName = computed(() => `${firstName()} ${lastName()}`);

// Bad: duplicated state that must be kept in sync
const [fullName, setFullName] = useState('');
useEffect(() => setFullName(`${firstName} ${lastName}`), [firstName, lastName]);
```

### 4. Make State Transitions Explicit

For complex flows, use state machines or explicit action/event patterns rather than ad-hoc boolean flags. Impossible states should be unrepresentable.

```typescript
// Bad: boolean soup allows impossible states
{ isLoading: true, isError: true, data: [...] }

// Good: discriminated union or state machine
type State = { status: 'idle' } | { status: 'loading' } | { status: 'error'; error: Error } | { status: 'success'; data: Item[] };
```

### 5. Separate Server State From Client State

Server state is fundamentally different: it has an authoritative remote source, can become stale, requires cache invalidation, and needs background refetching. Use purpose-built tools (TanStack Query, SWR) rather than stuffing API responses into client stores.

### 6. Minimize Reactivity Surface

Subscribe only to the state slices a component actually uses. Broad subscriptions cause cascading re-renders. Use selectors (Zustand), atoms (Jotai), or fine-grained signals to keep the reactivity graph narrow.

```typescript
// Zustand: select only what you need
const count = useStore((state) => state.count);

// Jotai: atomic by design
const countAtom = atom(0);
const [count] = useAtom(countAtom);
```

### 7. Treat State as a Contract

State shape is an API. Changes to state structure ripple through every consumer. Define state types explicitly, version breaking changes in shared stores, and use TypeScript or Pydantic to enforce contracts at compile time or runtime.

## Workflow

### Choosing a State Management Approach

#### 1. Audit Current State Needs

- [ ] List every piece of state the feature requires
- [ ] Categorize each item (UI, client, server, URL, form, machine) using the table above
- [ ] Identify which components read and write each piece of state

#### 2. Match Categories to Tools

- [ ] UI state -- keep local (useState, signals, component state)
- [ ] Client state -- evaluate store options based on project size and framework
- [ ] Server state -- use TanStack Query, SWR, or framework-specific data-fetching
- [ ] Complex flows -- model with XState or a state machine
- [ ] Cross-cutting -- combine tools (e.g., Zustand for client + TanStack Query for server)

#### 3. Implement With Guard Rails

- [ ] Define TypeScript types or Pydantic models for all state shapes
- [ ] Configure devtools (Redux DevTools, Jotai DevTools, XState Inspector)
- [ ] Write unit tests for state transitions and derived values
- [ ] Set up persistence middleware if state must survive page reloads

#### 4. Validate

- [ ] No impossible states are representable
- [ ] No duplicated state exists (all computed values are derived)
- [ ] Re-render counts are acceptable (React DevTools Profiler or equivalent)
- [ ] State is colocated -- nothing is global that does not need to be

## Quick Reference -- Selection Matrix

| Scenario | Recommended tool | Why |
|---|---|---|
| Small app, few shared values | React Context / Vue provide-inject / Svelte context | No external dependency needed |
| Medium app, moderate shared state | Zustand (React), Pinia (Vue), Svelte stores | Minimal boilerplate, good devtools |
| Complex derived state graphs | Jotai / Recoil (React), Solid signals | Atomic model prevents over-rendering |
| Proxy-based mutable style | Valtio (React), Vue reactivity | Feels like plain JS mutation |
| Large enterprise, strict patterns | Redux Toolkit + RTK Query | Proven at scale, time-travel debug |
| Complex UI flow (wizard, checkout) | XState | Explicit states prevent impossible transitions |
| Server data caching | TanStack Query / SWR | Built-in cache, refetch, invalidation |
| Python backend state | Pydantic models + dataclasses | Validated, typed, serializable |
| Python async state machine | transitions / python-statemachine | Async-native, decorator-based |
| Framework-agnostic reactivity | TC39 Signals polyfill / custom pub-sub | No framework lock-in |

## Quick Reference -- Signals Across Frameworks

| Framework | Signal primitive | Computed | Effect | Status |
|---|---|---|---|---|
| Solid | `createSignal()` | `createMemo()` | `createEffect()` | Stable, production |
| Angular | `signal()` | `computed()` | `effect()` | Stable since v17+ |
| Preact | `signal()` | `computed()` | `effect()` | Stable via @preact/signals |
| Qwik | `useSignal()` | `useComputed$()` | `useTask$()` | Stable |
| Vue | `ref()` / `reactive()` | `computed()` | `watchEffect()` | Stable (signal-like) |
| TC39 Proposal | `Signal.State()` | `Signal.Computed()` | Userland | Stage 1, polyfill available |

## Checklist

### State Architecture

- [ ] **Categorized**: Every piece of state is classified (UI, client, server, URL, form, machine)
- [ ] **Colocated**: State lives at the lowest common ancestor of its consumers
- [ ] **Derived**: No duplicated state; all computed values use derivation primitives
- [ ] **Typed**: State shapes defined with TypeScript interfaces or Pydantic models
- [ ] **Explicit transitions**: Complex flows use state machines or discriminated unions

### Implementation

- [ ] **Selectors**: Components subscribe only to the state slices they need
- [ ] **Devtools**: State inspection tooling configured for the chosen library
- [ ] **Persistence**: State that must survive reloads uses persistence middleware
- [ ] **Tests**: State transitions, derived values, and edge cases are unit tested
- [ ] **No impossible states**: Boolean flag combinations cannot produce invalid states

### Server State

- [ ] **Separated**: Server data uses TanStack Query / SWR, not client stores
- [ ] **Cache keys**: Query keys are structured and predictable
- [ ] **Invalidation**: Mutations invalidate affected queries
- [ ] **Optimistic updates**: Critical user actions update UI before server confirmation
- [ ] **Error boundaries**: Failed queries have fallback UI

### Agentic Workflow

- [ ] **Classify first**: Agent categorizes state before suggesting a library
- [ ] **Match conventions**: Agent follows existing project patterns (check package.json / imports)
- [ ] **Explain trade-offs**: Agent articulates why a particular approach was chosen
- [ ] **Test coverage**: Agent writes tests for any state logic it generates

## When to Escalate

- **Architectural migration** -- Migrating an entire application from one state management paradigm to another (e.g., Redux to Zustand at scale) requires team-wide coordination and incremental strategy beyond a single-task scope
- **Real-time synchronization** -- When state must be synchronized across multiple clients in real time (collaborative editing, multiplayer), escalate to architects for WebSocket/CRDT strategy
- **Distributed state** -- Backend state spanning multiple services with eventual consistency, saga/orchestration patterns, or distributed transactions requires domain-specific architectural review
- **Performance cliff** -- If state subscription counts exceed thousands of listeners or re-render profiles show systemic issues despite correct selectors, the problem may be architectural rather than implementation-level
- **Framework migration** -- Moving between frameworks (React to Vue, Angular to Solid) where state management must be preserved or translated requires holistic migration planning
- **Regulatory state requirements** -- State that must satisfy audit trails, GDPR right-to-erasure, or compliance logging needs legal and security review beyond state management patterns
