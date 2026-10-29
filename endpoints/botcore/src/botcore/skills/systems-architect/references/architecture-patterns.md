# Architecture Patterns

Detailed guidance on event-driven architecture, CQRS, hexagonal/ports-and-adapters, and related patterns.

## Event-Driven Architecture (EDA)

### Core Concepts

Event-driven architecture uses events as the primary communication mechanism between components. Events represent facts -- things that have happened.

| Concept | Definition |
|---|---|
| **Event** | An immutable record of something that happened ("OrderPlaced") |
| **Producer** | Component that publishes events |
| **Consumer** | Component that reacts to events |
| **Event Broker** | Infrastructure that routes events (Kafka, RabbitMQ, SNS/SQS, EventBridge) |
| **Event Schema** | Defined structure of an event (versioned) |

### Event Types

| Type | Purpose | Example |
|---|---|---|
| **Domain Event** | Business fact within a bounded context | `OrderPlaced { orderId, customerId, items, total }` |
| **Integration Event** | Cross-context communication | `OrderPlacedIntegration { orderId, total }` (less detail) |
| **Notification Event** | Signal that something happened (thin) | `OrderPlaced { orderId }` (consumer fetches details) |
| **Event-Carried State Transfer** | Full state in the event (fat) | `OrderPlaced { orderId, ...fullOrderDetails }` |

### Event Design Rules

1. **Events are immutable** -- Once published, never modified
2. **Events are past tense** -- `OrderPlaced`, not `PlaceOrder` (that's a command)
3. **Events carry enough context** -- Consumer should not need to call back to producer
4. **Events are versioned** -- Use schema registry; support backward compatibility
5. **Events are ordered within a partition** -- Use aggregate ID as partition key
6. **Idempotent consumers** -- Every consumer must handle duplicate events gracefully

### Choreography vs Orchestration

| Approach | Description | Best For |
|---|---|---|
| **Choreography** | Services react to events independently; no central coordinator | Simple flows, loosely coupled services |
| **Orchestration** | A central orchestrator (saga) directs the flow | Complex flows with compensation logic |

**Choreography example** (order flow):
```
OrderService publishes OrderPlaced
  --> PaymentService listens, processes payment, publishes PaymentCompleted
    --> InventoryService listens, reserves items, publishes ItemsReserved
      --> ShippingService listens, creates shipment
```

**Orchestration example** (saga):
```
OrderSaga orchestrates:
  1. Command: ProcessPayment --> PaymentService
  2. On success: Command: ReserveItems --> InventoryService
  3. On success: Command: CreateShipment --> ShippingService
  4. On any failure: Compensate (refund, unreserve, cancel)
```

### When to Use EDA

Use when:
- Components need loose coupling
- Real-time processing is required
- Audit trail / event log is valuable
- Multiple consumers need to react to the same event
- Systems need to scale independently

Avoid when:
- Simple CRUD with no downstream effects
- Strong consistency is required across operations
- The team lacks operational maturity for async debugging

## CQRS (Command Query Responsibility Segregation)

### Core Concept

Separate the model for writing data (commands) from the model for reading data (queries).

```
[Client]
   |
   +-- Commands --> [Write Model] --> [Write Store]
   |                                       |
   |                              (events/projections)
   |                                       |
   +-- Queries  --> [Read Model]  <-- [Read Store]
```

### When to Use CQRS

| Signal | Why CQRS Helps |
|---|---|
| Read/write ratio is heavily skewed | Optimize read and write stores independently |
| Complex queries span multiple aggregates | Build denormalized read models |
| Different scaling needs for reads vs writes | Scale read replicas independently |
| Event sourcing is in use | Read models are projections of the event stream |
| Multiple read representations needed | Dashboard view, API view, search index |

### When NOT to Use CQRS

- Read and write models are nearly identical (simple CRUD)
- Team is unfamiliar with eventual consistency
- The added complexity isn't justified by the use case
- A single relational database handles both reads and writes adequately

### CQRS Implementation Levels

| Level | Description | Complexity |
|---|---|---|
| **Same database, separate models** | Different query/command classes but same DB | Low |
| **Separate read database** | Write to primary, project to read replica | Medium |
| **Event-sourced write side** | Commands produce events; read models built from event stream | High |

### Event Sourcing (often paired with CQRS)

Instead of storing current state, store the sequence of events that led to current state.

**Benefits:**
- Complete audit trail
- Temporal queries (what was the state at time T?)
- Event replay for debugging or rebuilding read models
- Natural fit with event-driven architecture

**Challenges:**
- Event schema evolution over time
- Snapshotting needed for aggregates with many events
- Eventually consistent read models
- Operational complexity

## Hexagonal Architecture (Ports and Adapters)

### Core Concept

Isolate the application's core domain logic from all external concerns (UI, database, APIs, message queues) through ports (interfaces) and adapters (implementations).

```
            [Driving Adapters]           [Driven Adapters]
            (REST, gRPC, CLI)            (DB, Queue, API)
                  |                            ^
                  v                            |
            [Inbound Ports]              [Outbound Ports]
            (Use Case interfaces)        (Repository, Gateway interfaces)
                  |                            ^
                  v                            |
            +-----------------------------+
            |        DOMAIN CORE          |
            |  (Entities, Value Objects,  |
            |   Domain Services, Rules)   |
            +-----------------------------+
```

### Key Concepts

| Concept | Role | Example |
|---|---|---|
| **Domain Core** | Business logic, entities, value objects | `Order`, `Money`, `PlaceOrderUseCase` |
| **Inbound Port** | Interface that the domain exposes to the outside | `PlaceOrderPort`, `GetOrderPort` |
| **Outbound Port** | Interface that the domain needs from the outside | `OrderRepository`, `PaymentGateway` |
| **Driving Adapter** | Implements inbound communication (calls into domain) | REST controller, GraphQL resolver, CLI |
| **Driven Adapter** | Implements outbound interfaces (called by domain) | PostgreSQL repository, Stripe adapter, SQS publisher |

### Directory Structure

```
src/
  order/                         # Bounded context
    domain/                      # Domain core (no external dependencies)
      entities/
        Order.ts
        OrderLine.ts
      value-objects/
        Money.ts
        OrderId.ts
      events/
        OrderPlaced.ts
      services/
        PricingService.ts
    ports/                       # Interfaces
      inbound/
        PlaceOrderPort.ts
        GetOrderPort.ts
      outbound/
        OrderRepository.ts
        PaymentGateway.ts
        EventPublisher.ts
    adapters/                    # Implementations
      inbound/
        rest/
          OrderController.ts
        graphql/
          OrderResolver.ts
      outbound/
        persistence/
          PostgresOrderRepository.ts
        payment/
          StripePaymentGateway.ts
        messaging/
          SqsEventPublisher.ts
    application/                 # Use cases (orchestration)
      PlaceOrderUseCase.ts
      GetOrderUseCase.ts
```

### Dependency Rule

**Dependencies point inward.** The domain core depends on nothing external. Everything external depends on the domain.

- Domain core: zero imports from adapters, frameworks, or infrastructure
- Ports: defined in the domain layer as interfaces
- Adapters: implement port interfaces, depend on the domain
- Application services: orchestrate domain objects, depend only on ports

### Benefits

- **Testability** -- Test domain logic without databases, APIs, or frameworks
- **Swappability** -- Replace PostgreSQL with MongoDB by writing a new adapter
- **Framework independence** -- Domain core does not know about Express, Spring, or Django
- **Clarity** -- Clear separation of concerns; each layer has a single responsibility

### Common Mistakes

| Mistake | Fix |
|---|---|
| Domain imports framework code | Move framework code to adapter layer |
| Repository returns ORM entities | Return domain entities; map in adapter |
| Business logic in controllers | Move to domain services or use cases |
| Ports defined in adapter layer | Define ports next to the domain core |
| Skipping ports for "simplicity" | Ports are the architecture; don't skip them |

## Combining Patterns

These patterns compose naturally:

```
DDD Bounded Context
  +-- Hexagonal Architecture (structure within the context)
       +-- CQRS (separate read/write models)
            +-- Event Sourcing (write side stores events)
                 +-- Event-Driven (integration between contexts)
```

Not every context needs every pattern. Use the simplest combination that meets requirements:

| Complexity Level | Patterns | When |
|---|---|---|
| **Simple** | Hexagonal only | CRUD-heavy context with clean domain |
| **Moderate** | Hexagonal + EDA | Context publishes events consumed by others |
| **Advanced** | Hexagonal + CQRS | Read/write asymmetry within a context |
| **Complex** | Hexagonal + CQRS + Event Sourcing + EDA | Core domain with audit requirements and complex reads |
