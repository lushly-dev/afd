---
name: architect-systems
source: botcore
description: >
  Guides software architecture decisions across patterns, trade-offs, and documentation. Covers monolith vs microservices, modular monoliths, event-driven architecture, CQRS, hexagonal/ports-and-adapters, DDD bounded contexts, ADRs, evolutionary architecture with fitness functions, and platform engineering. Use when designing system architecture, choosing patterns, writing ADRs, decomposing domains, evaluating trade-offs, or planning migrations. Triggers: architecture, system design, microservices, monolith, DDD, bounded context, event-driven, CQRS, ADR, hexagonal, fitness function, platform engineering.

version: 1.0.0
triggers:
  - architecture
  - system design
  - microservices
  - monolith
  - modular monolith
  - DDD
  - domain driven design
  - bounded context
  - event-driven
  - CQRS
  - ADR
  - architecture decision record
  - hexagonal architecture
  - ports and adapters
  - fitness function
  - evolutionary architecture
  - platform engineering
  - service decomposition
  - system decomposition
portable: true
---

# Architecting Systems

Software architecture patterns, decision-making frameworks, and agent-maintainable design for modern systems.

## Capabilities

1. **Pattern Selection** -- Evaluate and recommend architecture patterns (monolith, modular monolith, microservices, serverless) based on team size, domain complexity, and operational maturity
2. **Domain Decomposition** -- Apply DDD strategic design to identify bounded contexts, subdomains, and context maps that drive service boundaries
3. **Architecture Decision Records** -- Author and review ADRs using lightweight markdown templates that capture context, decision, and consequences
4. **Event-Driven Design** -- Design event-driven systems using CQRS, event sourcing, and asynchronous messaging patterns
5. **Hexagonal Architecture** -- Structure applications using ports-and-adapters to isolate domain logic from infrastructure concerns
6. **Evolutionary Architecture** -- Define fitness functions and automated governance to ensure architectures evolve safely over time
7. **Agent-Maintainable Design** -- Architect systems with explicit boundaries, clear contracts, and discoverable structure so AI agents can navigate, modify, and extend them confidently
8. **Platform Engineering Guidance** -- Advise on internal developer platform design, self-service capabilities, and golden paths

## Routing Logic

| Request Type | Reference |
|---|---|
| Choosing between monolith, modular monolith, and microservices | [pattern-selection.md](references/pattern-selection.md) |
| Writing or reviewing an ADR | [adr-guide.md](references/adr-guide.md) |
| Domain-driven design and bounded contexts | [ddd-strategic-design.md](references/ddd-strategic-design.md) |
| Event-driven, CQRS, or hexagonal architecture | [architecture-patterns.md](references/architecture-patterns.md) |
| Fitness functions and evolutionary architecture | [evolutionary-architecture.md](references/evolutionary-architecture.md) |
| Designing for AI agent maintainability | [agent-maintainable-design.md](references/agent-maintainable-design.md) |

## Core Principles

### 1. Decisions Over Diagrams

<rules>
Architecture is the set of decisions that are hard to reverse.
Document decisions (ADRs), not just diagrams. Diagrams rot; recorded reasoning endures.
</rules>

Every significant architectural choice must produce an ADR. The ADR captures **why** a decision was made, not just what was decided. When revisiting a decision later, the context section tells you whether the original constraints still hold.

### 2. Start Simple, Evolve Deliberately

<rules>
Begin with the simplest architecture that meets current constraints.
Premature decomposition is more expensive than a well-structured monolith.
</rules>

| Team / Domain Signal | Recommended Starting Point |
|---|---|
| Single team, unclear domain boundaries | Modular monolith |
| Multiple teams, well-understood domains | Service-per-bounded-context |
| Spike / prototype / validation | Single deployable |
| High-scale, independent release cadence per domain | Microservices |

Split only when you have evidence: independent scaling needs, distinct release cadences, or organizational boundaries that demand it.

### 3. Domain First, Technology Second

<rules>
Let the domain model drive architecture boundaries.
Technology choices serve the domain, not the other way around.
</rules>

1. **Identify subdomains** -- Core (competitive advantage), Supporting (necessary but not differentiating), Generic (commodity)
2. **Draw bounded contexts** -- Each context owns its ubiquitous language and data
3. **Map context relationships** -- Upstream/downstream, conformist, anti-corruption layer, shared kernel
4. **Then choose technology** -- The pattern (monolith module, service, serverless function) follows from context boundaries

### 4. Explicit Contracts at Every Boundary

<rules>
Every boundary between modules, services, or teams must have an explicit contract.
Implicit coupling is the primary cause of architectural decay.
</rules>

Contracts include:
- **API contracts** -- OpenAPI specs, protobuf definitions, GraphQL schemas
- **Event contracts** -- Schema registry, versioned event schemas
- **Data contracts** -- Ownership, SLAs, schema evolution rules
- **Team contracts** -- Context maps showing upstream/downstream obligations

### 5. Agent-Maintainable by Default

<rules>
Architecture should be navigable and modifiable by AI agents without hidden context.
If an agent cannot discover a boundary, a human will also struggle.
</rules>

Design for agent maintainability:
- **Discoverable structure** -- Consistent directory layout, naming conventions, and manifest files
- **Explicit wiring** -- Dependency injection, configuration-as-code, no magic globals
- **Documented boundaries** -- Each module/service has a README or manifest describing its purpose, contracts, and dependencies
- **Small, focused units** -- Files under 500 lines, functions under 50 lines, modules with single responsibilities
- **Testable in isolation** -- Each bounded context or module can be tested without spinning up the entire system

### 6. Evolutionary Over Planned

<rules>
No architecture survives first contact with production unchanged.
Build fitness functions that guard architectural qualities as the system evolves.
</rules>

- Define **fitness functions** for key architectural characteristics (modularity, performance, security, coupling)
- Embed fitness functions in **CI/CD pipelines** so violations fail the build
- Review fitness functions quarterly -- they evolve with business needs
- Use **architecture decision records** to track why constraints were added or relaxed

## Workflow

### Step 1: Understand the Problem Space

- Identify the domain and its subdomains (core, supporting, generic)
- Map stakeholders and their concerns (scalability, time-to-market, compliance, cost)
- Understand team topology -- how many teams, their autonomy, communication patterns
- Identify hard constraints (regulatory, existing infrastructure, budget)

### Step 2: Establish Bounded Contexts

- Use DDD strategic design to draw context boundaries (see [ddd-strategic-design.md](references/ddd-strategic-design.md))
- Define ubiquitous language within each context
- Create a context map showing relationships between contexts
- Validate boundaries against team structure (Conway's Law)

### Step 3: Select Architecture Pattern

- Use the decision matrix in [pattern-selection.md](references/pattern-selection.md) to evaluate options
- Consider current team maturity and operational capabilities
- Favor the simplest pattern that meets constraints
- Document the decision in an ADR (see [adr-guide.md](references/adr-guide.md))

### Step 4: Define Contracts and Communication

- Choose synchronous (REST, gRPC) vs asynchronous (events, messaging) communication per boundary
- Define event schemas and API contracts
- Establish data ownership rules -- no shared databases across bounded contexts
- Document integration patterns (API gateway, event bus, saga/choreography)

### Step 5: Design for Evolution

- Identify key architectural characteristics (performance, scalability, modularity, security)
- Write fitness functions for each characteristic (see [evolutionary-architecture.md](references/evolutionary-architecture.md))
- Plan migration paths -- how does the architecture evolve if assumptions change?
- Set review cadence for architectural decisions

### Step 6: Validate Agent-Maintainability

- Verify directory structure follows consistent, discoverable conventions
- Ensure each module has explicit entry points and documented contracts
- Check that dependencies are injected, not hardcoded
- Confirm tests can run per-module without full system setup
- Review naming conventions for grep-ability and clarity

## Quick Reference: Architecture Pattern Cheat Sheet

| Pattern | Best For | Watch Out For |
|---|---|---|
| **Monolith** | Small teams, early products, unclear domains | Becomes deployment bottleneck at scale |
| **Modular Monolith** | Medium teams, well-defined domains, single deployment | Module coupling creep without fitness functions |
| **Microservices** | Large orgs, independent scaling, autonomous teams | Distributed complexity, operational overhead |
| **Serverless** | Event-driven workloads, variable traffic, cost-sensitive | Cold starts, vendor lock-in, debugging difficulty |
| **Event-Driven** | Real-time processing, loose coupling, audit trails | Eventual consistency complexity, debugging async flows |
| **CQRS** | Read/write asymmetry, complex queries, event sourcing | Added complexity if read/write patterns are symmetric |
| **Hexagonal** | Testability, swappable infrastructure, long-lived systems | Indirection overhead for small projects |

## Quick Reference: ADR Minimal Template

```markdown
# ADR-NNN: [Short Decision Title]

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX

## Context
[What forces are at play? What is the problem or opportunity?]

## Decision
[What is the change being made? State it clearly.]

## Consequences
[What becomes easier? What becomes harder? What are the trade-offs?]
```

Full template and examples in [adr-guide.md](references/adr-guide.md).

## Checklist

### Architecture Decision
- [ ] Problem space and constraints are documented
- [ ] Subdomains identified (core, supporting, generic)
- [ ] Bounded contexts drawn with explicit boundaries
- [ ] Context map shows upstream/downstream relationships
- [ ] Architecture pattern selected with documented rationale (ADR)
- [ ] Contracts defined at every boundary (API, event, data)
- [ ] Communication patterns chosen per boundary (sync vs async)
- [ ] Data ownership rules established -- no shared databases
- [ ] Fitness functions defined for key architectural characteristics
- [ ] Migration path documented for likely evolution scenarios

### Agent-Maintainability
- [ ] Directory structure is consistent and discoverable
- [ ] Each module has a manifest or README describing purpose and contracts
- [ ] Dependencies are explicit (injection, config-as-code)
- [ ] Files are under 500 lines, functions under 50 lines
- [ ] Modules are testable in isolation
- [ ] Naming conventions are grep-friendly and consistent
- [ ] No hidden state or magic globals

### ADR Quality
- [ ] Title clearly states the decision
- [ ] Context explains the forces and constraints
- [ ] Decision is stated unambiguously
- [ ] Consequences list both benefits and trade-offs
- [ ] Status is current (not stale "Proposed" from 6 months ago)
- [ ] ADR is stored in version control alongside the code

## When to Escalate

| Condition | Escalate To |
|---|---|
| Cross-organization service boundaries requiring governance alignment | Enterprise architect or architecture review board |
| Data sovereignty or regulatory constraints affecting data placement | Legal/compliance team + data architect |
| Migration from monolith to microservices affecting multiple teams | Tech lead + affected team leads for coordination |
| Performance requirements that may need fundamental architecture change | Performance engineering team for load testing validation |
| Vendor lock-in decisions with multi-year cost implications | Engineering leadership + finance for TCO analysis |
| Security architecture (zero-trust, encryption at rest/transit) | Security architect for threat modeling |
| Conflicting bounded context boundaries between teams | Facilitate collaborative Event Storming session |
| Fitness function failures with no clear resolution | Architecture review with senior engineers |
