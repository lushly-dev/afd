# Event Sourcing and CQRS

Patterns for event-driven data modeling, Command Query Responsibility Segregation, and event store design.

---

## Core Concepts

### Event Sourcing

Store every state change as an immutable event rather than overwriting current state. The current state is derived by replaying events.

```
Traditional:  UPDATE accounts SET balance = 150 WHERE id = 1;
Event-sourced: INSERT INTO events (aggregate_id, type, data) VALUES
               (1, 'MoneyDeposited', '{"amount": 50}');
```

### CQRS (Command Query Responsibility Segregation)

Separate the write model (commands) from the read model (queries). Each side can be optimized independently.

```
Commands → Write Model → Event Store → Projections → Read Model → Queries
```

---

## When to Use (and When Not To)

### Good Fit

- **Audit requirements**: Regulatory compliance, financial systems, healthcare
- **Complex domain logic**: Domain-driven design with aggregates that have complex state transitions
- **Temporal queries**: "What was the state of X at time T?"
- **Event-driven architectures**: Microservices communicating via events
- **Separate read/write scaling**: Read-heavy systems where write throughput must be preserved
- **Undo / replay**: Systems that need to reconstruct or replay history

### Poor Fit

- Simple CRUD applications with straightforward read/write patterns
- Small teams without DDD experience (high learning curve)
- Systems where eventual consistency is unacceptable for all reads
- Low-complexity domains where the overhead is not justified

---

## Event Store Schema

```sql
CREATE TABLE events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Optimistic concurrency: no two events for same aggregate with same version
  UNIQUE (aggregate_id, version)
);

CREATE INDEX idx_events_aggregate ON events(aggregate_id, version);
CREATE INDEX idx_events_type ON events(event_type, created_at);
```

### Event Structure

```json
{
  "aggregate_type": "Order",
  "aggregate_id": "order_abc123",
  "event_type": "OrderPlaced",
  "version": 1,
  "event_data": {
    "customer_id": "cust_456",
    "items": [
      { "sku": "WIDGET-A", "quantity": 2, "price_cents": 1999 }
    ],
    "total_cents": 3998
  },
  "metadata": {
    "correlation_id": "req_789",
    "caused_by": "PlaceOrderCommand",
    "user_id": "user_012",
    "timestamp": "2025-01-15T10:30:00Z"
  }
}
```

---

## Aggregate Design

```typescript
// TypeScript example
interface OrderEvent {
  type: 'OrderPlaced' | 'ItemAdded' | 'ItemRemoved' | 'OrderShipped' | 'OrderCancelled';
  data: Record<string, unknown>;
  version: number;
  timestamp: Date;
}

class OrderAggregate {
  private id: string;
  private status: 'draft' | 'placed' | 'shipped' | 'cancelled';
  private items: OrderItem[];
  private version: number = 0;
  private uncommittedEvents: OrderEvent[] = [];

  // Rebuild state from events
  static fromHistory(events: OrderEvent[]): OrderAggregate {
    const order = new OrderAggregate();
    for (const event of events) {
      order.apply(event, false);
    }
    return order;
  }

  // Command: place order (validates, then emits event)
  place(customerId: string, items: OrderItem[]): void {
    if (this.status !== 'draft') {
      throw new Error('Order already placed');
    }
    this.emit({
      type: 'OrderPlaced',
      data: { customerId, items, totalCents: this.calculateTotal(items) },
    });
  }

  // Apply event to state (pure function, no side effects)
  private apply(event: OrderEvent, isNew: boolean = true): void {
    switch (event.type) {
      case 'OrderPlaced':
        this.status = 'placed';
        this.items = event.data.items as OrderItem[];
        break;
      case 'OrderShipped':
        this.status = 'shipped';
        break;
      case 'OrderCancelled':
        this.status = 'cancelled';
        break;
    }
    this.version = event.version;
    if (isNew) this.uncommittedEvents.push(event);
  }
}
```

---

## Projections (Read Models)

Projections consume events and build optimized read-side views.

```typescript
// Projection: build a denormalized orders-for-display table
class OrderListProjection {
  async handle(event: OrderEvent): Promise<void> {
    switch (event.type) {
      case 'OrderPlaced':
        await db.insert(orderListTable).values({
          orderId: event.aggregateId,
          customerId: event.data.customerId,
          totalCents: event.data.totalCents,
          itemCount: event.data.items.length,
          status: 'placed',
          placedAt: event.timestamp,
        });
        break;

      case 'OrderShipped':
        await db.update(orderListTable)
          .set({ status: 'shipped', shippedAt: event.timestamp })
          .where(eq(orderListTable.orderId, event.aggregateId));
        break;
    }
  }
}
```

### Projection Patterns

| Pattern | Description | Use When |
|---------|-------------|----------|
| **Synchronous** | Projection updated in same transaction as event | Strong consistency needed for this read model |
| **Async / Eventually Consistent** | Projection updated via message queue | Read model can tolerate slight delay |
| **Catch-up** | Replay all events from beginning to rebuild | Projection logic changed, new read model added |
| **Snapshot** | Periodically save aggregate state | Long event streams (thousands of events per aggregate) |

---

## Snapshot Pattern

For aggregates with many events, avoid replaying the full history on every load.

```sql
CREATE TABLE snapshots (
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(100) NOT NULL,
  version INT NOT NULL,
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (aggregate_id, version)
);
```

**Loading with snapshots**:
1. Load the latest snapshot for the aggregate
2. Load events *after* the snapshot version
3. Apply those events to the snapshot state

**When to snapshot**: Every N events (e.g., 100), or when load time exceeds a threshold.

---

## Key Design Rules

1. **Events are immutable** -- Never modify or delete events. Create compensating events instead.
2. **Events are past-tense facts** -- `OrderPlaced`, not `PlaceOrder`. They describe what happened.
3. **Aggregates are consistency boundaries** -- All invariants within an aggregate are enforced synchronously.
4. **Cross-aggregate consistency is eventual** -- Use sagas or process managers for multi-aggregate workflows.
5. **Version events** -- Include schema version in events. Use upcasters to transform old events to new schema.
6. **Small aggregates** -- Prefer many small aggregates over few large ones. Fewer events per aggregate means faster load times.
7. **Idempotent projections** -- Projections should produce the same result if an event is processed twice.

---

## Agent Considerations

- **Event catalog**: Maintain a machine-readable catalog of all event types with their schemas (JSON Schema or TypeScript types). This allows agents to understand the domain model.
- **Projection metadata**: Document which projections exist, what events they consume, and their consistency guarantees.
- **Command validation**: Clearly separate command validation (can this happen?) from event application (it happened). Agents should validate commands before emitting events.
- **Compensating events**: When agents need to "undo" something, guide them to emit compensating events (e.g., `OrderCancelled`) rather than deleting events.
