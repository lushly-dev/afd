# DDD Strategic Design

Domain-Driven Design strategic patterns for identifying bounded contexts, subdomains, and context maps.

## Core Concepts

### Subdomains

Every business can be decomposed into subdomains. Classification determines investment level:

| Type | Definition | Strategy | Example |
|---|---|---|---|
| **Core** | Competitive advantage; what makes the business unique | Build in-house, invest deeply, best engineers | Recommendation engine, pricing algorithm |
| **Supporting** | Necessary for core to function; not differentiating | Build in-house but simpler, or outsource | User management, notification system |
| **Generic** | Commodity; same across industries | Buy or use SaaS | Email delivery, payment processing, auth |

### Bounded Contexts

A bounded context is a boundary within which a domain model is consistent and unambiguous. Inside a bounded context:

- Terms have precise, agreed-upon meanings (ubiquitous language)
- One model applies -- no conflicting definitions
- One team typically owns it

**Key rule**: The same real-world concept can have different models in different bounded contexts.

Example -- "Customer" in different contexts:
- **Sales context**: Lead with pipeline stage, expected value, sales rep
- **Billing context**: Account with payment method, invoice history, credit limit
- **Support context**: Ticket requester with SLA tier, contact preferences

Each context has its own `Customer` model. They are not the same entity.

### Ubiquitous Language

Each bounded context has its own language:
- Terms are defined precisely within the context
- The same word in different contexts may mean different things
- Code, tests, documentation, and conversation all use the same terms
- If the team says "order" and the code says "transaction", there is a language gap to fix

## Context Mapping

Context maps show how bounded contexts relate to each other.

### Relationship Patterns

| Pattern | Description | When to Use |
|---|---|---|
| **Shared Kernel** | Two contexts share a small, co-owned model | Tightly coupled teams that coordinate easily |
| **Customer-Supplier** | Upstream provides, downstream consumes | Clear producer/consumer relationship |
| **Conformist** | Downstream adopts upstream's model as-is | Upstream won't change; downstream adapts |
| **Anti-Corruption Layer (ACL)** | Downstream translates upstream's model | Protect your model from a messy or legacy upstream |
| **Open Host Service** | Upstream exposes a well-defined protocol | Serving many downstream consumers |
| **Published Language** | Shared schema/format for interchange | Event-driven integration between contexts |
| **Separate Ways** | No integration; contexts are independent | When integration cost exceeds benefit |
| **Partnership** | Two teams align on shared goals and coordinate | Mutual dependency, willing to co-evolve |

### Anti-Corruption Layer (ACL)

The ACL is the most important pattern for protecting domain integrity:

```
[Your Bounded Context]
    |
    +-- ACL (translator layer)
    |      |
    |      +-- Translates external models to your internal models
    |      +-- Isolates your domain from upstream changes
    |      +-- Contains adapters, mappers, facades
    |
[External / Legacy System]
```

Use an ACL when:
- Integrating with legacy systems that have messy models
- Consuming third-party APIs with unfamiliar conventions
- Protecting your core domain from upstream model changes
- The upstream model doesn't match your ubiquitous language

## Discovery Process

### Step 1: Event Storming (Simplified)

Event Storming identifies domain events, commands, and aggregates:

1. **List domain events** -- Things that happen in the business ("OrderPlaced", "PaymentReceived", "ItemShipped")
2. **Group events by proximity** -- Events that occur together or in sequence likely belong to the same context
3. **Identify commands** -- What triggers each event? ("PlaceOrder", "ProcessPayment", "ShipItem")
4. **Identify actors** -- Who or what issues each command?
5. **Draw boundaries** -- Where do you see natural clusters? These are candidate bounded contexts

### Step 2: Validate Boundaries

For each candidate bounded context, check:

- [ ] Does it have its own ubiquitous language?
- [ ] Can one team own it?
- [ ] Can it be deployed independently (or could it be, if extracted)?
- [ ] Does it have a clear API surface?
- [ ] Would splitting it further create more coupling than cohesion?

### Step 3: Map Context Relationships

For each pair of communicating contexts:

1. Identify which context is upstream (provides data) and which is downstream (consumes)
2. Choose the appropriate relationship pattern from the table above
3. Document the integration mechanism (API call, event, shared library)
4. Define who owns the contract and how changes are negotiated

### Step 4: Align with Team Topology

Conway's Law: Systems mirror the communication structures of the organizations that build them.

| Context Relationship | Team Relationship |
|---|---|
| Shared Kernel | Same team or very close collaboration |
| Customer-Supplier | Stream-aligned teams with platform team |
| Anti-Corruption Layer | Teams with minimal coordination |
| Separate Ways | Fully independent teams |

If your bounded context boundaries don't align with team boundaries, one of them needs to change.

## Common Mistakes

| Mistake | Problem | Fix |
|---|---|---|
| **One model for everything** | "Customer" means something different to sales and billing but uses one class | Separate models per bounded context |
| **Database-driven boundaries** | Contexts defined by database tables, not domain logic | Start from domain events, not ERDs |
| **Entity-per-service** | One microservice per database entity (UserService, OrderService, ProductService) | One service per bounded context (may contain many entities) |
| **Ignoring Conway's Law** | Architecture boundaries don't match team boundaries | Align contexts to teams or restructure teams |
| **Shared database** | Multiple contexts read/write the same tables | Each context owns its data; integrate via APIs or events |
| **Anemic domain model** | Domain objects are just data holders with no behavior | Push business logic into domain entities and value objects |

## DDD Building Blocks (Tactical Patterns)

Within a bounded context, use these tactical patterns:

| Pattern | Purpose | Example |
|---|---|---|
| **Entity** | Object with identity that persists over time | Order (identified by OrderId) |
| **Value Object** | Immutable object defined by its attributes | Money(amount, currency), Address |
| **Aggregate** | Cluster of entities with a root that enforces invariants | Order aggregate (Order + OrderLines) |
| **Domain Event** | Record of something significant that happened | OrderPlaced, PaymentFailed |
| **Repository** | Abstraction for persistence of aggregates | OrderRepository |
| **Domain Service** | Business logic that doesn't belong to a single entity | PricingService, FraudCheckService |
| **Application Service** | Orchestrates use cases, delegates to domain | PlaceOrderHandler |
| **Factory** | Creates complex aggregates | OrderFactory |

### Aggregate Design Rules

1. **Protect invariants** -- The aggregate root enforces all business rules
2. **Reference by ID** -- Aggregates reference other aggregates by ID, not by direct object reference
3. **Small aggregates** -- Prefer smaller aggregates; one entity as root with minimal children
4. **Eventual consistency between aggregates** -- Use domain events, not transactions spanning aggregates
5. **One aggregate per transaction** -- A single database transaction modifies one aggregate
