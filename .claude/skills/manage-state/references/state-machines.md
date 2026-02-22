# State Machines and Statecharts

Reference for modeling complex application flows using state machines and statecharts, primarily with XState.

## When to Use State Machines

State machines are the right choice when:

- A feature has **finite, enumerable states** (idle, loading, error, success)
- **Impossible states** keep appearing as bugs (e.g., `isLoading: true` AND `isError: true`)
- The flow has **complex transitions** with guards and side effects
- Multiple actors or processes must be **orchestrated** (parallel states)
- You need **visual documentation** of the flow that stays in sync with code

Common use cases: multi-step forms, checkout flows, authentication, media players, file upload pipelines, wizard interfaces, game states, connection management.

## State Machine Fundamentals

### Finite State Machine (FSM)

An FSM has a finite number of states, transitions between states triggered by events, and can only be in one state at a time.

```typescript
import { createMachine, interpret } from 'xstate';

const toggleMachine = createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: {
      on: { TOGGLE: 'active' },
    },
    active: {
      on: { TOGGLE: 'inactive' },
    },
  },
});
```

### Statecharts (Extended State Machines)

Statecharts extend FSMs with:

| Feature | Description |
|---|---|
| **Hierarchical states** | Nested states (parent/child) for grouping related states |
| **Parallel states** | Multiple independent state regions active simultaneously |
| **Guards** | Conditional transitions based on context or event data |
| **Actions** | Side effects on entry, exit, or transition (fire-and-forget) |
| **Context** | Extended state (data) that accompanies the finite state |
| **Invoked services** | Async operations (promises, callbacks, other machines) managed by the machine |
| **History states** | Remember and restore the last active child state |
| **Delayed transitions** | Automatic transitions after a timeout |

## XState v5 (Current)

### Machine Definition

```typescript
import { setup, assign, fromPromise } from 'xstate';

// Define machine with setup() for type safety
const fetchMachine = setup({
  types: {
    context: {} as { data: Item[]; error: string | null; retries: number },
    events: {} as
      | { type: 'FETCH' }
      | { type: 'RETRY' }
      | { type: 'CANCEL' },
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch('/api/items');
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    }),
  },
  guards: {
    canRetry: ({ context }) => context.retries < 3,
  },
  actions: {
    incrementRetries: assign({
      retries: ({ context }) => context.retries + 1,
    }),
    clearError: assign({ error: null }),
  },
}).createMachine({
  id: 'fetch',
  initial: 'idle',
  context: { data: [], error: null, retries: 0 },
  states: {
    idle: {
      on: { FETCH: 'loading' },
    },
    loading: {
      invoke: {
        src: 'fetchData',
        onDone: {
          target: 'success',
          actions: assign({ data: ({ event }) => event.output }),
        },
        onError: {
          target: 'failure',
          actions: assign({ error: ({ event }) => event.error.message }),
        },
      },
      on: { CANCEL: 'idle' },
    },
    success: {
      on: { FETCH: 'loading' },
    },
    failure: {
      on: {
        RETRY: {
          target: 'loading',
          guard: 'canRetry',
          actions: ['incrementRetries', 'clearError'],
        },
      },
    },
  },
});
```

### Using in React

```typescript
import { useMachine } from '@xstate/react';

function DataFetcher() {
  const [state, send] = useMachine(fetchMachine);

  return (
    <div>
      {state.matches('idle') && (
        <button onClick={() => send({ type: 'FETCH' })}>Load Data</button>
      )}
      {state.matches('loading') && <Spinner />}
      {state.matches('success') && <DataList items={state.context.data} />}
      {state.matches('failure') && (
        <div>
          <p>Error: {state.context.error}</p>
          <button onClick={() => send({ type: 'RETRY' })}>Retry</button>
        </div>
      )}
    </div>
  );
}
```

### Using in Vue

```typescript
import { useMachine } from '@xstate/vue';

const { snapshot, send } = useMachine(fetchMachine);
// snapshot is a reactive ref
```

### Using in Svelte

```typescript
import { useMachine } from '@xstate/svelte';

const { snapshot, send } = useMachine(fetchMachine);
// snapshot is a Svelte readable store
```

## Statechart Patterns

### Hierarchical (Nested) States

Group related states to share transitions and reduce duplication.

```typescript
const authMachine = setup({ /* types */ }).createMachine({
  id: 'auth',
  initial: 'unauthenticated',
  states: {
    unauthenticated: {
      initial: 'idle',
      states: {
        idle: {
          on: { LOGIN: 'signingIn' },
        },
        signingIn: {
          invoke: {
            src: 'loginService',
            onDone: '#auth.authenticated',
            onError: 'error',
          },
        },
        error: {
          on: { LOGIN: 'signingIn' },
        },
      },
    },
    authenticated: {
      on: { LOGOUT: 'unauthenticated' },
      initial: 'active',
      states: {
        active: {},
        refreshing: {},
      },
    },
  },
});
```

### Parallel States

Model independent concerns that evolve simultaneously.

```typescript
const editorMachine = setup({ /* types */ }).createMachine({
  id: 'editor',
  type: 'parallel',
  states: {
    document: {
      initial: 'clean',
      states: {
        clean: { on: { EDIT: 'dirty' } },
        dirty: {
          on: {
            SAVE: 'saving',
            DISCARD: 'clean',
          },
        },
        saving: {
          invoke: {
            src: 'saveDocument',
            onDone: 'clean',
            onError: 'dirty',
          },
        },
      },
    },
    toolbar: {
      initial: 'visible',
      states: {
        visible: { on: { TOGGLE_TOOLBAR: 'hidden' } },
        hidden: { on: { TOGGLE_TOOLBAR: 'visible' } },
      },
    },
    connection: {
      initial: 'online',
      states: {
        online: { on: { DISCONNECT: 'offline' } },
        offline: { on: { RECONNECT: 'online' } },
      },
    },
  },
});
```

### Multi-Step Form (Wizard Pattern)

```typescript
const wizardMachine = setup({
  types: {
    context: {} as {
      personalInfo: PersonalInfo | null;
      address: Address | null;
      payment: Payment | null;
    },
    events: {} as
      | { type: 'NEXT'; data: Record<string, unknown> }
      | { type: 'BACK' }
      | { type: 'SUBMIT' },
  },
}).createMachine({
  id: 'wizard',
  initial: 'personalInfo',
  context: { personalInfo: null, address: null, payment: null },
  states: {
    personalInfo: {
      on: {
        NEXT: {
          target: 'address',
          actions: assign({ personalInfo: ({ event }) => event.data }),
        },
      },
    },
    address: {
      on: {
        NEXT: {
          target: 'payment',
          actions: assign({ address: ({ event }) => event.data }),
        },
        BACK: 'personalInfo',
      },
    },
    payment: {
      on: {
        NEXT: {
          target: 'review',
          actions: assign({ payment: ({ event }) => event.data }),
        },
        BACK: 'address',
      },
    },
    review: {
      on: {
        SUBMIT: 'submitting',
        BACK: 'payment',
      },
    },
    submitting: {
      invoke: {
        src: 'submitForm',
        onDone: 'complete',
        onError: 'review', // Return to review on failure
      },
    },
    complete: { type: 'final' },
  },
});
```

### Actor Model (Spawned Machines)

XState v5 uses the actor model. Machines can spawn child actors for concurrent workflows.

```typescript
import { setup, sendTo, fromPromise } from 'xstate';

const parentMachine = setup({
  actors: {
    childWorker: fromPromise(async ({ input }) => {
      return processItem(input.item);
    }),
  },
}).createMachine({
  // Parent orchestrates child actors
  // Each child runs independently with its own lifecycle
});
```

## Testing State Machines

### Unit Testing Transitions

```typescript
import { createActor } from 'xstate';

describe('fetchMachine', () => {
  it('transitions from idle to loading on FETCH', () => {
    const actor = createActor(fetchMachine);
    actor.start();

    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'FETCH' });
    expect(actor.getSnapshot().value).toBe('loading');
  });

  it('respects retry guard', () => {
    const actor = createActor(fetchMachine, {
      snapshot: { context: { retries: 3, data: [], error: 'fail' } },
    });
    actor.start();

    // Should not transition -- guard blocks it
    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('failure');
  });
});
```

### Model-Based Testing

XState supports generating test paths from machine definitions:

```typescript
import { createTestModel } from '@xstate/test';

const testModel = createTestModel(toggleMachine);
const testPaths = testModel.getShortestPaths();

testPaths.forEach((path) => {
  it(path.description, async () => {
    await path.test({ /* test context */ });
  });
});
```

## Stately Visual Editor

The Stately visual editor (stately.ai) allows:
- Drag-and-drop machine design
- Export to XState v5 code
- Visual simulation of transitions
- Team collaboration on statecharts
- Auto-generated documentation from machine definitions

## Common Anti-Patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Boolean flags instead of states | `{ isLoading, isError, isSuccess }` allows impossible combos | Use a single state enum or machine |
| God machine | One machine with 50+ states | Split into parallel regions or child actors |
| Context as primary state | Using context values to determine behavior | Use finite states for control flow, context for data |
| Missing error states | Errors silently ignored | Always define error transitions for invoked services |
| No guards on transitions | Transitions happen regardless of preconditions | Add guards to validate transitions |

## Agentic Considerations

- **Identify machine candidates**: When an agent sees multiple boolean flags controlling a flow (`isLoading && !isError && isRetrying`), suggest refactoring to a state machine
- **Generate visual-first**: When designing a new machine, describe states and transitions before writing code. The Stately editor can generate XState code from visual designs.
- **Test all paths**: When generating state machine code, also generate tests covering happy path, error path, and edge cases (guards blocking transitions)
- **Keep machines focused**: Each machine should model one concern. If a machine grows beyond 10-15 states, consider splitting into parallel regions or child actors.
- **Document state meaning**: Add descriptions to states explaining what the user sees and what the system is doing in each state
