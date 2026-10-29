# Pattern Selection Guide

How to choose between monolith, modular monolith, microservices, and serverless architectures.

## Decision Matrix

Evaluate each factor on a scale of 1-5. Higher total scores favor more distributed architectures.

| Factor | Score 1 (Low) | Score 5 (High) |
|---|---|---|
| **Team count** | 1-2 teams | 10+ teams |
| **Domain clarity** | Unclear, still exploring | Well-understood, stable boundaries |
| **Independent scaling needs** | Uniform load | Components vary 100x in load |
| **Release cadence independence** | Single release is fine | Teams blocked by shared releases |
| **Operational maturity** | No DevOps, manual deploys | Full CI/CD, observability, on-call |
| **Organizational autonomy need** | Centralized decision-making | Teams need full ownership |

### Scoring Guide

| Total Score | Recommended Pattern |
|---|---|
| 6-12 | Monolith or Modular Monolith |
| 13-20 | Modular Monolith with selective extraction |
| 21-26 | Microservices or Service-per-bounded-context |
| 27-30 | Full microservices with platform engineering |

## Pattern Deep Dives

### Monolith

**When to choose:**
- Small team (1-5 developers)
- New product with unclear domain boundaries
- Speed to market is the top priority
- Limited operational capacity

**Key practices:**
- Organize by domain, not by technical layer
- Use internal module boundaries even without enforcement
- Keep the door open: structure code so extraction is possible later

**Anti-patterns to avoid:**
- Big ball of mud -- no internal structure
- Database-as-integration -- sharing tables between conceptual modules
- God classes / God services that span multiple domains

### Modular Monolith

**When to choose:**
- Medium teams (5-20 developers)
- Domain boundaries are becoming clear
- Want microservice-like modularity without distributed complexity
- Single deployment is acceptable

**Key practices:**
- Each module maps to a bounded context
- Modules communicate through explicit interfaces (not direct DB access)
- Enforce module boundaries with architecture tests (e.g., ArchUnit, dependency-cruiser)
- Each module owns its database schema (logical separation within same DB)

**Module boundary enforcement:**

```
src/
  modules/
    ordering/          # Bounded context: Ordering
      api/             # Public interface (what other modules can call)
      internal/        # Private implementation
      events/          # Events this module publishes
      schema/          # Database schema owned by this module
    inventory/         # Bounded context: Inventory
      api/
      internal/
      events/
      schema/
    shipping/          # Bounded context: Shipping
      api/
      internal/
      events/
      schema/
```

**Fitness function example:**

```
RULE: No module may import from another module's `internal/` directory.
ENFORCEMENT: CI pipeline architecture test.
VIOLATION: Build fails with explicit message.
```

### Microservices

**When to choose:**
- Large organization (20+ developers across multiple teams)
- Well-understood, stable domain boundaries
- Independent scaling requirements per service
- Teams need autonomous release cadences
- Operational maturity exists (CI/CD, observability, on-call)

**Key practices:**
- One service per bounded context (not per entity)
- Each service owns its data store entirely
- Asynchronous communication (events) as default; synchronous (API) only when necessary
- API gateway for external consumers
- Service mesh for internal observability and traffic management

**Prerequisites checklist (do not adopt microservices without these):**
- [ ] Automated CI/CD pipelines per service
- [ ] Centralized logging and distributed tracing
- [ ] Health checks and alerting
- [ ] Service discovery mechanism
- [ ] Team on-call rotation
- [ ] Defined SLAs per service

**Anti-patterns to avoid:**
- Distributed monolith -- services that must deploy together
- Shared database -- defeats the purpose of service independence
- Synchronous chains -- A calls B calls C calls D (fragile, slow)
- Nano-services -- too fine-grained, excessive network overhead

### Serverless

**When to choose:**
- Event-driven workloads (file uploads, webhooks, scheduled jobs)
- Highly variable traffic with long idle periods
- Cost optimization is critical
- Functions are stateless and short-lived

**Key practices:**
- Keep functions focused (single responsibility)
- Use managed services for state (DynamoDB, S3, SQS)
- Design for cold starts in latency-sensitive paths
- Version functions and use aliases for deployment safety

**Constraints to evaluate:**
- Cold start latency acceptable? (100ms-3s depending on runtime)
- Execution time within limits? (15 min for Lambda)
- Vendor lock-in acceptable? (harder to migrate than containers)
- Debugging and local development story adequate?

## Migration Paths

### Monolith to Modular Monolith

1. Identify domain boundaries within the monolith
2. Extract modules with explicit public interfaces
3. Enforce boundaries with architecture tests
4. Separate database schemas logically per module
5. Introduce event publishing between modules

### Modular Monolith to Microservices (Selective Extraction)

1. Identify the module with the strongest case for extraction (scaling, release cadence, team ownership)
2. Introduce an anti-corruption layer between the module and the monolith
3. Extract the module's database to its own data store
4. Replace in-process calls with API or event-based communication
5. Deploy independently; validate with integration tests
6. Repeat for next candidate module

### Strangler Fig Pattern (Legacy Monolith to Services)

1. Place an API gateway / reverse proxy in front of the monolith
2. Build new functionality as separate services behind the gateway
3. Gradually redirect routes from monolith to new services
4. Monolith shrinks over time as routes are redirected
5. Decommission monolith when no routes remain

## Trade-Off Summary

| Dimension | Monolith | Modular Monolith | Microservices | Serverless |
|---|---|---|---|---|
| Deployment simplicity | High | High | Low | Medium |
| Independent scaling | None | None | High | High |
| Operational complexity | Low | Low | High | Medium |
| Team autonomy | Low | Medium | High | High |
| Data consistency | Easy (ACID) | Moderate | Hard (eventual) | Hard (eventual) |
| Debugging | Easy | Easy | Hard (distributed) | Hard (ephemeral) |
| Initial velocity | High | High | Low (infrastructure) | Medium |
| Long-term flexibility | Low | Medium | High | Medium |
