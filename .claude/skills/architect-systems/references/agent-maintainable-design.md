# Agent-Maintainable Design

Architecture and design patterns that make codebases navigable, modifiable, and extendable by AI agents.

## Why Agent-Maintainability Matters

AI coding agents (Claude, Copilot, Cursor, Cody) are becoming primary contributors to codebases. An architecture that is hard for agents to navigate is also hard for new human developers. Agent-maintainability is an amplifier of general maintainability.

Key insight: **Agents make architectural decisions during code generation**, whether explicitly instructed or not. A well-documented architecture constrains agent decisions toward consistency.

## Principles

### 1. Discoverability Over Convention

Agents cannot "just know" your conventions. Make structure explicit.

| Implicit (Agent-Hostile) | Explicit (Agent-Friendly) |
|---|---|
| "We always put services in /lib" | `ARCHITECTURE.md` documents directory structure |
| "That's configured in the DI container" | Dependency injection is visible in module manifests |
| "Everyone knows the naming convention" | `.claude/AGENTS.md` or `CONVENTIONS.md` codifies naming rules |
| "Check Confluence for the design" | ADRs live in `docs/architecture/decisions/` in the repo |

### 2. Small, Focused Units

Agents work best with files they can read in a single context window and functions they can understand at a glance.

| Metric | Target | Why |
|---|---|---|
| File length | < 500 lines | Fits in context window with room for instructions |
| Function length | < 50 lines | Single responsibility; easy to reason about |
| Module public API | < 15 exports | Narrow interface; clear contract |
| Import depth | < 5 levels | Shallow dependency trees are easier to trace |
| Cyclomatic complexity | < 10 per function | Linear code paths are predictable |

### 3. Explicit Boundaries

Every boundary in the system should be:
- **Named** -- Module, service, or context has a clear name
- **Documented** -- README or manifest at the root of each module
- **Enforced** -- Fitness functions prevent boundary violations
- **Contracted** -- Public API is typed and versioned

### 4. No Hidden State

Agents cannot discover state that is invisible in the code.

| Hidden State (Avoid) | Explicit State (Prefer) |
|---|---|
| Global mutable singletons | Dependency-injected services |
| Environment variables read deep in business logic | Configuration objects passed at startup |
| Side effects in constructors | Explicit initialization methods |
| Magic middleware ordering | Middleware pipeline defined in one place |
| Database triggers | Domain events handled in application code |
| Framework magic (auto-wiring, convention-over-config without docs) | Explicit wiring with visible configuration |

### 5. Grep-Friendly Naming

Agents find code by searching. Names should be unique and searchable.

| Bad (Ambiguous) | Good (Grep-Friendly) |
|---|---|
| `handle()` | `handleOrderPlacement()` |
| `process()` | `processPaymentRefund()` |
| `data` | `orderLineItems` |
| `utils.ts` | `price-calculation.ts` |
| `helpers/index.ts` | `string-formatters.ts` |
| `Service` | `OrderFulfillmentService` |

### 6. Self-Describing Directory Structure

The directory tree should communicate architecture at a glance.

**Agent-hostile structure** (organized by technical layer):
```
src/
  controllers/     # 50 files, mixed domains
  services/        # 80 files, mixed domains
  models/          # 60 files, mixed domains
  utils/           # Junk drawer
```

**Agent-friendly structure** (organized by domain):
```
src/
  modules/
    ordering/
      README.md            # Module purpose, contracts, dependencies
      api/                 # Public interface
      domain/              # Business logic
      adapters/            # Infrastructure implementations
      __tests__/           # Tests for this module
    billing/
      README.md
      api/
      domain/
      adapters/
      __tests__/
```

## Module Manifest Pattern

Each module should have a manifest (README.md or module.yaml) that an agent reads first:

```markdown
# Ordering Module

## Purpose
Manages order lifecycle from placement through fulfillment.

## Bounded Context
Ordering (see ADR-002)

## Public API
- `PlaceOrderPort` -- Accept a new order
- `GetOrderPort` -- Query order by ID
- `OrderEvents` -- Published events (OrderPlaced, OrderCancelled)

## Dependencies
- **Consumes**: Billing.PaymentGateway, Inventory.StockCheckPort
- **Publishes to**: Event bus (OrderPlaced, OrderCancelled, OrderFulfilled)

## Data Ownership
- `orders` table (PostgreSQL)
- `order_events` table (event store)

## Key ADRs
- ADR-002: Modular monolith architecture
- ADR-005: Event-driven order fulfillment
```

## Architecture Documentation for Agents

### ARCHITECTURE.md (Root Level)

Place an `ARCHITECTURE.md` at the repository root:

```markdown
# Architecture Overview

## Pattern
Modular monolith with event-driven integration between modules.

## Module Map
| Module | Bounded Context | Team | Purpose |
|---|---|---|---|
| ordering | Ordering | Orders Team | Order lifecycle management |
| billing | Billing | Payments Team | Payment processing, invoicing |
| inventory | Inventory | Warehouse Team | Stock management, reservations |

## Communication
- **Intra-module**: Direct function calls via public API
- **Inter-module**: Domain events via internal event bus
- **External**: REST API via API gateway

## Key Constraints
- No module imports from another module's internal/ directory
- No shared database tables across modules
- All inter-module communication goes through events or public API ports

## ADRs
See docs/architecture/decisions/
```

### CLAUDE.md / AGENTS.md Integration

If the project uses agent instruction files, include architecture-relevant rules:

```markdown
## Architecture Rules
- Follow hexagonal architecture: domain/ has zero infrastructure imports
- Each module has api/, domain/, adapters/, __tests__/ directories
- Inter-module communication uses events, not direct imports
- New modules require an ADR and module README
- Files must not exceed 500 lines
- Run `npm run arch-test` before committing to validate module boundaries
```

## Testing for Agent-Maintainability

### Automated Checks

```
FUNCTION: Agent-maintainability fitness functions
CHECKS:
  - [ ] No file exceeds 500 lines
  - [ ] No function exceeds 50 lines (cyclomatic complexity < 10)
  - [ ] Every module directory contains a README.md
  - [ ] No cross-module internal imports
  - [ ] Domain layer has zero infrastructure imports
  - [ ] No files named "utils.ts", "helpers.ts", or "misc.ts"
  - [ ] ARCHITECTURE.md exists at repo root
  - [ ] All public API types are explicitly exported (no barrel re-exports of internals)
```

### Manual Review Questions

When reviewing architecture for agent-maintainability:

1. Can an agent find the entry point for a feature by searching file names?
2. Can an agent understand a module's purpose by reading its README?
3. Can an agent modify one module without understanding all others?
4. Can an agent run tests for a single module in isolation?
5. Can an agent trace the flow of a request through the system by following imports?
6. Are all configuration values discoverable (not hidden in environment or convention)?

## Anti-Patterns

| Anti-Pattern | Agent Impact | Fix |
|---|---|---|
| **God module** (1000+ line files) | Cannot fit in context window | Split by responsibility |
| **Barrel exports** (re-exporting everything from index.ts) | Hides actual file location | Import from specific files |
| **Dynamic dispatch** (string-based routing, eval) | Cannot trace statically | Use typed dispatch or explicit routing |
| **Convention-only structure** | Agent guesses wrong | Document conventions in ARCHITECTURE.md |
| **Circular dependencies** | Agent gets lost tracing imports | Break cycles with dependency inversion |
| **Test-free modules** | Agent cannot verify changes | Add tests as a prerequisite for module creation |
| **Undocumented side effects** | Agent introduces bugs unknowingly | Make side effects explicit in function signatures |
| **Framework magic** | Agent doesn't know what's auto-configured | Document all auto-wiring in README |
