# Python State Management

Reference for managing application state in Python using dataclasses, Pydantic models, state machines, and event-driven patterns.

## Choosing a State Container

| Container | Validation | Performance | Use case |
|---|---|---|---|
| `dataclass` | None (types are hints only) | Fastest | Internal domain models, known-good data |
| `Pydantic BaseModel` | Full runtime validation | Moderate | API boundaries, configs, external data |
| `Pydantic dataclass` | Full validation + dataclass API | Moderate | Bridging stdlib dataclass interfaces with validation |
| `TypedDict` | None (types are hints only) | Dict-speed | Interop with dict-based APIs, JSON structures |
| `NamedTuple` | None | Tuple-speed | Immutable records, legacy interop |
| `attrs` | Optional validators | Fast | Feature-rich alternative to dataclass |

**Rule of thumb**: Use `dataclass` for internal state, Pydantic `BaseModel` at system boundaries.

## Dataclass Patterns

### Immutable State with Frozen Dataclasses

```python
from dataclasses import dataclass, field, replace
from typing import Optional

@dataclass(frozen=True)
class AppState:
    user: Optional[str] = None
    items: tuple[str, ...] = ()
    count: int = 0

# Create new state via replace (immutable update)
state = AppState(user="Alice", count=0)
new_state = replace(state, count=state.count + 1)
```

### State with Computed Properties

```python
from dataclasses import dataclass, field
from functools import cached_property

@dataclass
class CartState:
    items: list[CartItem] = field(default_factory=list)
    discount_percent: float = 0.0

    @cached_property
    def subtotal(self) -> float:
        return sum(item.price * item.quantity for item in self.items)

    @cached_property
    def total(self) -> float:
        return self.subtotal * (1 - self.discount_percent / 100)

    def __setattr__(self, name, value):
        # Invalidate cached properties on mutation
        if name in ('items', 'discount_percent'):
            self.__dict__.pop('subtotal', None)
            self.__dict__.pop('total', None)
        super().__setattr__(name, value)
```

### Dataclass-Based State Store

```python
from dataclasses import dataclass, field, replace
from typing import Callable, Generic, TypeVar

T = TypeVar('T')

class Store(Generic[T]):
    """Minimal observable store using dataclasses."""

    def __init__(self, initial_state: T):
        self._state = initial_state
        self._subscribers: list[Callable[[T], None]] = []

    @property
    def state(self) -> T:
        return self._state

    def update(self, **changes) -> None:
        self._state = replace(self._state, **changes)
        self._notify()

    def subscribe(self, callback: Callable[[T], None]) -> Callable[[], None]:
        self._subscribers.append(callback)
        return lambda: self._subscribers.remove(callback)

    def _notify(self) -> None:
        for sub in self._subscribers:
            sub(self._state)

# Usage
@dataclass(frozen=True)
class CounterState:
    count: int = 0
    name: str = "default"

store = Store(CounterState())
unsub = store.subscribe(lambda s: print(f"Count: {s.count}"))
store.update(count=store.state.count + 1)
```

## Pydantic State Models

### Validated State at Boundaries

```python
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from enum import Enum

class OrderStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

class OrderState(BaseModel):
    id: str
    status: OrderStatus = OrderStatus.PENDING
    items: list[str] = Field(min_length=1)
    total: float = Field(gt=0)
    created_at: datetime = Field(default_factory=datetime.now)
    shipped_at: datetime | None = None

    @field_validator('shipped_at')
    @classmethod
    def shipped_requires_shipped_status(cls, v, info):
        if v is not None and info.data.get('status') not in (
            OrderStatus.SHIPPED, OrderStatus.DELIVERED
        ):
            raise ValueError('shipped_at can only be set when status is shipped or delivered')
        return v

    model_config = {"frozen": True}  # Immutable by default
```

### Pydantic Settings for Configuration State

```python
from pydantic_settings import BaseSettings

class AppConfig(BaseSettings):
    database_url: str
    redis_url: str = "redis://localhost:6379"
    debug: bool = False
    max_connections: int = Field(default=10, ge=1, le=100)

    model_config = {"env_prefix": "APP_"}  # Reads APP_DATABASE_URL, etc.

config = AppConfig()  # Automatically reads from environment variables
```

## Python State Machines

### transitions Library

The `transitions` library is a lightweight FSM implementation with async support.

```python
from transitions import Machine

class OrderWorkflow:
    states = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']

    def __init__(self):
        self.machine = Machine(
            model=self,
            states=OrderWorkflow.states,
            initial='pending',
            transitions=[
                {'trigger': 'confirm',  'source': 'pending',   'dest': 'confirmed'},
                {'trigger': 'ship',     'source': 'confirmed', 'dest': 'shipped'},
                {'trigger': 'deliver',  'source': 'shipped',   'dest': 'delivered'},
                {'trigger': 'cancel',   'source': ['pending', 'confirmed'], 'dest': 'cancelled'},
            ],
        )

    def on_enter_shipped(self):
        print("Order has been shipped! Sending notification...")

    def on_enter_cancelled(self):
        print("Order cancelled. Processing refund...")

# Usage
order = OrderWorkflow()
order.confirm()     # pending -> confirmed
order.ship()        # confirmed -> shipped
order.state         # 'shipped'
order.cancel()      # Raises MachineError -- cannot cancel from shipped
```

### Async State Machine with transitions

```python
from transitions.extensions.asyncio import AsyncMachine
import asyncio

class AsyncOrderWorkflow:
    states = ['pending', 'processing', 'complete', 'error']

    def __init__(self):
        self.machine = AsyncMachine(
            model=self,
            states=AsyncOrderWorkflow.states,
            initial='pending',
            transitions=[
                {'trigger': 'process', 'source': 'pending', 'dest': 'processing'},
                {'trigger': 'complete', 'source': 'processing', 'dest': 'complete'},
                {'trigger': 'fail', 'source': 'processing', 'dest': 'error'},
                {'trigger': 'retry', 'source': 'error', 'dest': 'processing',
                 'conditions': ['can_retry']},
            ],
        )
        self.retries = 0
        self.max_retries = 3

    def can_retry(self):
        return self.retries < self.max_retries

    async def on_enter_processing(self):
        self.retries += 1
        print(f"Processing... (attempt {self.retries})")

async def main():
    workflow = AsyncOrderWorkflow()
    await workflow.process()   # pending -> processing
    await workflow.fail()      # processing -> error
    await workflow.retry()     # error -> processing (if retries < max)

asyncio.run(main())
```

### python-statemachine Library

A more structured alternative with class-based state and transition definitions.

```python
from statemachine import StateMachine, State

class TrafficLightMachine(StateMachine):
    green = State(initial=True)
    yellow = State()
    red = State()

    slow_down = green.to(yellow)
    stop = yellow.to(red)
    go = red.to(green)

    def on_enter_red(self):
        print("STOP!")

    def on_exit_red(self):
        print("Getting ready...")

# Usage
sm = TrafficLightMachine()
sm.slow_down()  # green -> yellow
sm.stop()       # yellow -> red
sm.go()         # red -> green
sm.current_state  # State('green')
```

## Event-Driven State Patterns

### AsyncIO Event Bus

```python
import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

@dataclass
class AsyncEventBus:
    _handlers: dict[str, list[Callable[..., Coroutine]]] = field(default_factory=dict)

    def on(self, event: str, handler: Callable[..., Coroutine]) -> Callable[[], None]:
        self._handlers.setdefault(event, []).append(handler)
        return lambda: self._handlers[event].remove(handler)

    async def emit(self, event: str, **data: Any) -> None:
        for handler in self._handlers.get(event, []):
            await handler(**data)

# Usage
bus = AsyncEventBus()

async def on_user_created(user_id: str, email: str):
    print(f"Sending welcome email to {email}")

bus.on("user:created", on_user_created)
await bus.emit("user:created", user_id="123", email="alice@example.com")
```

### Reducer Pattern in Python

Port of the Redux reducer pattern for Python backends:

```python
from dataclasses import dataclass, replace
from typing import Union

@dataclass(frozen=True)
class TodoState:
    items: tuple[str, ...] = ()
    filter: str = "all"

@dataclass(frozen=True)
class AddTodo:
    text: str

@dataclass(frozen=True)
class RemoveTodo:
    index: int

@dataclass(frozen=True)
class SetFilter:
    filter: str

Action = Union[AddTodo, RemoveTodo, SetFilter]

def reducer(state: TodoState, action: Action) -> TodoState:
    match action:
        case AddTodo(text=text):
            return replace(state, items=(*state.items, text))
        case RemoveTodo(index=index):
            return replace(state, items=state.items[:index] + state.items[index + 1:])
        case SetFilter(filter=f):
            return replace(state, filter=f)
        case _:
            return state

# Usage
state = TodoState()
state = reducer(state, AddTodo("Buy groceries"))
state = reducer(state, AddTodo("Walk the dog"))
state = reducer(state, SetFilter("active"))
```

## Pydantic-AI Graph State

For agentic workflows using Pydantic-AI, state passes through graph nodes:

```python
from pydantic import BaseModel
from pydantic_graph import BaseNode, Graph, End

class WorkflowState(BaseModel):
    query: str
    results: list[str] = []
    iteration: int = 0

class SearchNode(BaseNode[WorkflowState]):
    async def run(self, state: WorkflowState) -> str:
        # Node can read and mutate state
        results = await search(state.query)
        state.results.extend(results)
        state.iteration += 1

        if state.iteration >= 3 or len(state.results) >= 10:
            return End()
        return "refine"  # Go to refine node

class RefineNode(BaseNode[WorkflowState]):
    async def run(self, state: WorkflowState) -> str:
        state.query = refine_query(state.query, state.results)
        return "search"  # Go back to search node

graph = Graph(nodes=[SearchNode, RefineNode])
final_state = await graph.run(WorkflowState(query="state management patterns"))
```

## Best Practices

### State Immutability

```python
# Prefer frozen dataclasses for state
@dataclass(frozen=True)
class State:
    value: int = 0

# Use replace() for updates
new_state = replace(state, value=state.value + 1)

# For Pydantic, use model_copy
new_model = model.model_copy(update={"value": model.value + 1})
```

### State Serialization

```python
import json
from dataclasses import asdict
from pydantic import BaseModel

# Dataclass serialization
state_dict = asdict(state)
state_json = json.dumps(state_dict)

# Pydantic serialization (preferred for API boundaries)
class ApiState(BaseModel):
    count: int
    name: str

state_json = api_state.model_dump_json()
state_dict = api_state.model_dump()
restored = ApiState.model_validate_json(state_json)
```

## Agentic Considerations

- **Use Pydantic at boundaries**: When generating API handlers, CLI parsers, or config loaders, always use Pydantic for validation. Use dataclasses for internal domain logic.
- **Prefer immutable state**: Generate frozen dataclasses by default. Mutable state is a common source of bugs in multi-step agent workflows.
- **Type-check state transitions**: When generating state machines, ensure transitions are typed and tested. Use `match` statements (Python 3.10+) for exhaustive action handling.
- **Async-first for I/O state**: When state transitions involve I/O (API calls, DB queries), use async state machines from `transitions.extensions.asyncio` or `python-statemachine` async support.
- **Serialize state for debugging**: In agentic workflows, always make state serializable (JSON-compatible). This enables logging, replay, and debugging of multi-step operations.
