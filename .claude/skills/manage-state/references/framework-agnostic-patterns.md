# Framework-Agnostic State Patterns

Reference for state management patterns that work across any technology stack -- pub/sub, observables, command/CQRS, and event-driven architectures.

## Pub/Sub Pattern

The publish/subscribe pattern decouples state producers from consumers. Publishers emit events without knowing who is listening; subscribers react to events without knowing who emitted them.

### Minimal TypeScript Implementation

```typescript
type Listener<T> = (value: T) => void;
type Unsubscribe = () => void;

class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    this.listeners.get(event)?.forEach((listener) => listener(value));
  }
}

// Usage
interface AppEvents {
  'user:login': { userId: string };
  'user:logout': void;
  'cart:updated': { itemCount: number };
}

const bus = new EventBus<AppEvents>();
const unsub = bus.on('user:login', ({ userId }) => console.log(`User ${userId} logged in`));
bus.emit('user:login', { userId: '123' });
unsub();
```

### When to Use Pub/Sub

- Cross-component communication without prop drilling
- Decoupled modules that need to react to events
- Plugin systems where the core does not know about extensions
- Bridging micro-frontends or web components

### Pitfalls

| Pitfall | Problem | Mitigation |
|---|---|---|
| Memory leaks | Subscribers not cleaned up | Always call unsubscribe; use WeakRef for long-lived buses |
| Event storms | One event triggers cascading events | Limit chaining depth; use batch/queue patterns |
| Debugging difficulty | Hard to trace which subscriber handles an event | Add event logging middleware; use typed event maps |
| Ordering dependencies | Subscriber execution order is non-deterministic | Do not depend on subscriber ordering; use explicit sequencing if needed |

## Observable Store Pattern

A reactive store that notifies subscribers whenever its state changes. This is the foundation underneath Redux, Zustand, MobX, and most state management libraries.

### Minimal Implementation

```typescript
type Subscriber<T> = (state: T) => void;

class Store<T> {
  private state: T;
  private subscribers = new Set<Subscriber<T>>();

  constructor(initialState: T) {
    this.state = initialState;
  }

  getState(): T {
    return this.state;
  }

  setState(updater: T | ((prev: T) => T)): void {
    this.state = typeof updater === 'function'
      ? (updater as (prev: T) => T)(this.state)
      : updater;
    this.notify();
  }

  subscribe(subscriber: Subscriber<T>): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private notify(): void {
    this.subscribers.forEach((sub) => sub(this.state));
  }
}

// Usage
const store = new Store({ count: 0, name: 'World' });
const unsub = store.subscribe((state) => console.log(state));
store.setState((prev) => ({ ...prev, count: prev.count + 1 }));
```

### Adding Selectors

```typescript
class Store<T> {
  // ... previous implementation

  select<S>(selector: (state: T) => S): { subscribe: (fn: (val: S) => void) => () => void } {
    let prev = selector(this.state);
    return {
      subscribe: (fn) => {
        return this.subscribe((state) => {
          const next = selector(state);
          if (!Object.is(prev, next)) {
            prev = next;
            fn(next);
          }
        });
      },
    };
  }
}

// Only notified when count changes, not name
store.select((s) => s.count).subscribe((count) => console.log('Count:', count));
```

## Command Pattern

The command pattern encapsulates state mutations as objects, enabling undo/redo, logging, queuing, and auditing.

### Implementation

```typescript
interface Command<TState> {
  execute(state: TState): TState;
  undo(state: TState): TState;
  description: string;
}

class CommandManager<TState> {
  private state: TState;
  private history: Command<TState>[] = [];
  private future: Command<TState>[] = [];

  constructor(initialState: TState) {
    this.state = initialState;
  }

  execute(command: Command<TState>): void {
    this.state = command.execute(this.state);
    this.history.push(command);
    this.future = []; // Clear redo stack on new command
  }

  undo(): void {
    const command = this.history.pop();
    if (command) {
      this.state = command.undo(this.state);
      this.future.push(command);
    }
  }

  redo(): void {
    const command = this.future.pop();
    if (command) {
      this.state = command.execute(this.state);
      this.history.push(command);
    }
  }

  getState(): TState {
    return this.state;
  }

  getHistory(): string[] {
    return this.history.map((cmd) => cmd.description);
  }
}

// Example commands
interface EditorState {
  text: string;
  cursorPosition: number;
}

const insertText = (text: string, position: number): Command<EditorState> => ({
  description: `Insert "${text}" at ${position}`,
  execute: (state) => ({
    text: state.text.slice(0, position) + text + state.text.slice(position),
    cursorPosition: position + text.length,
  }),
  undo: (state) => ({
    text: state.text.slice(0, position) + state.text.slice(position + text.length),
    cursorPosition: position,
  }),
});
```

### When to Use Commands

- **Undo/redo** functionality (text editors, drawing tools, form builders)
- **Audit logging** (every state change is a named, inspectable object)
- **Batch operations** (group multiple commands into a single undoable transaction)
- **Remote execution** (serialize commands and send to server for replay)

## CQRS (Command Query Responsibility Segregation)

CQRS separates read operations (queries) from write operations (commands), allowing each to be optimized independently.

### Frontend CQRS Pattern

```typescript
// Commands -- write side
interface CreateTodoCommand {
  type: 'CREATE_TODO';
  payload: { text: string; dueDate: Date };
}

interface CompleteTodoCommand {
  type: 'COMPLETE_TODO';
  payload: { id: string };
}

type Command = CreateTodoCommand | CompleteTodoCommand;

async function executeCommand(command: Command): Promise<void> {
  switch (command.type) {
    case 'CREATE_TODO':
      await api.post('/todos', command.payload);
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      break;
    case 'COMPLETE_TODO':
      await api.patch(`/todos/${command.payload.id}`, { completed: true });
      queryClient.invalidateQueries({ queryKey: ['todos'] });
      break;
  }
}

// Queries -- read side (via TanStack Query)
function useTodos(filters: Filters) {
  return useQuery({
    queryKey: ['todos', filters],
    queryFn: () => api.get('/todos', { params: filters }),
  });
}

function useTodoStats() {
  return useQuery({
    queryKey: ['todos', 'stats'],
    queryFn: () => api.get('/todos/stats'),
  });
}
```

### Backend CQRS Pattern

```
Write path: Client -> Command Handler -> Validate -> Write DB -> Emit Event
Read path:  Client -> Query Handler -> Read DB/Cache -> Return Data
Event sync: Write DB -> Event Bus -> Projection Handler -> Read DB/Cache
```

**When CQRS adds value:**
- Read and write models have very different shapes
- Reads vastly outnumber writes (optimize read path with materialized views)
- Complex domain logic on writes with simple reads
- Event sourcing is already in use

**When CQRS is overkill:**
- Simple CRUD applications
- Read/write ratios are balanced
- Single-team, single-service applications

## Event Sourcing (Brief Overview)

Event sourcing stores state as a sequence of immutable events rather than as a current snapshot. Combined with CQRS, it enables complete audit trails and temporal queries.

```typescript
// Events are immutable facts
type TodoEvent =
  | { type: 'TodoCreated'; id: string; text: string; timestamp: Date }
  | { type: 'TodoCompleted'; id: string; timestamp: Date }
  | { type: 'TodoDeleted'; id: string; timestamp: Date };

// Reducer builds current state from events
function buildTodo(events: TodoEvent[]): Todo | null {
  return events.reduce((state, event) => {
    switch (event.type) {
      case 'TodoCreated':
        return { id: event.id, text: event.text, completed: false, deleted: false };
      case 'TodoCompleted':
        return state ? { ...state, completed: true } : null;
      case 'TodoDeleted':
        return null;
      default:
        return state;
    }
  }, null as Todo | null);
}
```

## Middleware Pattern

Intercept and transform state operations for cross-cutting concerns.

```typescript
type Middleware<T> = (
  next: (state: T) => void,
) => (state: T) => void;

// Logging middleware
const logger: Middleware<any> = (next) => (state) => {
  console.log('State update:', state);
  next(state);
};

// Persistence middleware
const persist = (key: string): Middleware<any> => (next) => (state) => {
  localStorage.setItem(key, JSON.stringify(state));
  next(state);
};

// Validation middleware
const validate = <T>(validator: (s: T) => boolean): Middleware<T> => (next) => (state) => {
  if (validator(state)) {
    next(state);
  } else {
    console.error('Invalid state update rejected:', state);
  }
};

// Compose middlewares
function applyMiddleware<T>(...middlewares: Middleware<T>[]): Middleware<T> {
  return (next) => middlewares.reduceRight((acc, mw) => mw(acc), next);
}
```

## Agentic Considerations

- **Match the pattern to the problem**: Pub/sub for decoupled event communication, observable stores for shared reactive state, commands for undoable operations, CQRS for read/write separation
- **Do not over-engineer**: If a simple store with selectors solves the problem, do not introduce CQRS or event sourcing. Complexity should be justified by requirements.
- **Framework-agnostic first**: When building shared libraries or packages, use these patterns instead of framework-specific state management. This enables reuse across React, Vue, Svelte, and backend Node.js.
- **Type everything**: Commands, events, and store state should all be fully typed with TypeScript interfaces or discriminated unions. Agents should always generate these types.
- **Test the pattern, not the framework**: Unit tests for command execution, event handling, and store updates should not depend on React rendering. Test pure state logic independently.
