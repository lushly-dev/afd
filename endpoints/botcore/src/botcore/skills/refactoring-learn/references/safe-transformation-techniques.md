# Safe Transformation Techniques

Strategies for making large-scale refactoring changes safely, especially in legacy and production systems.

---

## Strangler Fig Pattern

Coined by Martin Fowler (2004). Gradually replace components of a legacy system by building new functionality alongside the old, routing traffic incrementally, and decommissioning old code once the new path is validated.

### When to Use

- Migrating monolith to microservices
- Replacing legacy frameworks or libraries
- Modernizing API layers
- Any large-scale replacement where a big-bang rewrite is too risky

### Implementation Steps

1. **Identify the boundary** -- Find the perimeter where calls enter the legacy component
2. **Create the facade** -- Introduce a routing layer (API gateway, proxy, feature flag) that can direct traffic
3. **Build the replacement** -- Implement the new version of the component
4. **Redirect incrementally** -- Route a percentage of traffic to the new component; start with internal/staging
5. **Validate** -- Compare outputs, monitor error rates, check performance
6. **Decommission** -- Once fully migrated and validated, remove the legacy code path

### Agentic Workflow Considerations

- Agents should never remove the legacy code path in the same PR that introduces the new path
- Each increment should be a separate commit with clear intent
- Agent should verify both paths produce equivalent results before suggesting removal
- Use feature flags to control routing -- agents can toggle these safely

```typescript
// Facade pattern for strangler fig
class PaymentService {
  async processPayment(order: Order): Promise<PaymentResult> {
    if (await this.featureFlags.isEnabled('new-payment-engine', order.customerId)) {
      return this.newPaymentEngine.process(order);
    }
    return this.legacyPaymentProcessor.process(order);
  }
}
```

---

## Branch by Abstraction

Used for replacing components that are deeply embedded in the codebase (not at the perimeter). Introduces an abstraction layer so old and new implementations can coexist.

### When to Use

- Replacing an internal library or utility
- Swapping data access layers (e.g., ORM migration)
- Changing internal algorithms
- Any deep-stack component replacement

### Implementation Steps

1. **Create the abstraction** -- Define an interface that captures the current behavior
2. **Adapt existing code** -- Make the existing implementation conform to the new interface
3. **Redirect clients** -- Update all callers to use the abstraction instead of the concrete implementation
4. **Build the new implementation** -- Create the replacement behind the same abstraction
5. **Switch** -- Route to the new implementation (feature flag or config)
6. **Clean up** -- Remove the old implementation and, if appropriate, the abstraction

```typescript
// Step 1: Define the abstraction
interface NotificationSender {
  send(to: string, message: string): Promise<void>;
}

// Step 2: Wrap existing implementation
class LegacyEmailSender implements NotificationSender {
  async send(to: string, message: string): Promise<void> {
    // Existing email logic, now behind the interface
    this.legacyMailer.sendEmail(to, 'Notification', message);
  }
}

// Step 4: Build replacement
class ModernNotificationSender implements NotificationSender {
  async send(to: string, message: string): Promise<void> {
    await this.notificationApi.push({ recipient: to, body: message });
  }
}

// Step 5: Switch via configuration
class NotificationFactory {
  create(): NotificationSender {
    if (config.useModernNotifications) {
      return new ModernNotificationSender();
    }
    return new LegacyEmailSender();
  }
}
```

### Agentic Workflow Considerations

- Agents should create the abstraction and adapter in a separate commit before building the replacement
- Each step is independently deployable and testable
- Agent should verify all callers are updated to use the abstraction before proceeding

---

## Parallel Change (Expand-Migrate-Contract)

Make a breaking change safely by expanding the interface to support both old and new, migrating callers, then contracting to remove old support.

### When to Use

- Changing function signatures
- Modifying data schemas
- Renaming public APIs
- Any breaking change to a widely-used interface

### Implementation Steps

1. **Expand** -- Add the new interface alongside the old one; the old interface delegates to the new
2. **Migrate** -- Update all callers to use the new interface
3. **Contract** -- Remove the old interface once all callers are migrated

```typescript
// Step 1: EXPAND -- add new parameter, keep old signature working
function formatCurrency(amount: number): string;
function formatCurrency(amount: number, currency: string): string;
function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

// Step 2: MIGRATE -- update all callers to pass currency explicitly
// formatCurrency(42)         -->  formatCurrency(42, 'USD')
// formatCurrency(100)        -->  formatCurrency(100, 'EUR')

// Step 3: CONTRACT -- remove the overload, require the parameter
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}
```

### Agentic Workflow Considerations

- Agent should expand first, then migrate callers in a separate pass, then contract
- Never combine expand and contract in the same commit
- Use deprecation markers (`@deprecated`) during the migrate phase
- Agent should search for all callers before contracting to ensure none remain

---

## Parallel Run (Shadow Testing)

Run old and new implementations simultaneously and compare results before switching.

### When to Use

- High-risk algorithm replacements
- Data pipeline migrations
- Financial calculations or any domain where correctness is critical
- When confidence in the new implementation is low

### Implementation Steps

1. **Instrument** -- Add comparison infrastructure
2. **Shadow** -- Run new code in parallel, compare outputs, log discrepancies
3. **Validate** -- Analyze discrepancy logs; fix the new implementation
4. **Switch** -- When discrepancy rate is acceptable, make new implementation primary
5. **Monitor** -- Keep the old path available for a rollback window
6. **Remove** -- Decommission the old implementation

```typescript
class PricingService {
  async calculatePrice(order: Order): Promise<Price> {
    const legacyResult = await this.legacyPricing.calculate(order);

    // Shadow run -- non-blocking, never affects the response
    this.shadowRun(order, legacyResult).catch(err =>
      logger.warn('Shadow pricing failed', { orderId: order.id, error: err })
    );

    return legacyResult; // Legacy is still the source of truth
  }

  private async shadowRun(order: Order, expected: Price): Promise<void> {
    const newResult = await this.newPricing.calculate(order);
    if (!this.resultsMatch(expected, newResult)) {
      metrics.increment('pricing.shadow.mismatch');
      logger.info('Pricing mismatch', {
        orderId: order.id,
        legacy: expected,
        new: newResult,
      });
    }
  }
}
```

### Agentic Workflow Considerations

- Agent should never make the new implementation primary without human approval
- Shadow infrastructure should be clearly marked as temporary
- Discrepancy logs should be structured for easy analysis
- Agent can help analyze discrepancy patterns and suggest fixes

---

## Feature Flag Driven Refactoring

Use feature flags to control the rollout of refactored code, enabling gradual deployment and instant rollback.

### Principles

- **Flag granularity** -- One flag per refactored component, not one flag for the entire refactoring effort
- **Flag lifecycle** -- Every flag should have a planned removal date; stale flags are tech debt
- **Default to old** -- The old path is always the default; the new path requires explicit enablement
- **Monitoring** -- Each flag should have associated metrics to validate the new path

```typescript
// Feature flag for a refactored search algorithm
async function search(query: string): Promise<Results> {
  if (await flags.isEnabled('use-vector-search', { userId: currentUser.id })) {
    return vectorSearch.execute(query);
  }
  return legacyKeywordSearch.execute(query);
}
```

### Agentic Workflow Considerations

- Agent should always introduce refactored paths behind feature flags for non-trivial changes
- Agent should create the flag, not hard-code boolean switches
- Agent should add monitoring for the new code path
- Agent should not remove the flag without explicit human approval

---

## Mikado Method

A structured approach for managing complex refactoring by visualizing dependencies as a directed graph.

### Process

1. **Set a goal** -- Define the desired end state
2. **Try it naively** -- Attempt the change
3. **Record failures** -- Note what breaks as prerequisites
4. **Revert** -- Undo the naive attempt
5. **Solve prerequisites** -- Work on the leaves of the dependency graph first
6. **Repeat** -- Continue until the original goal succeeds

### Agentic Workflow Considerations

- Agent can automate the "try it naively" step by making the change and running tests
- Failed tests reveal prerequisites that should be addressed first
- Agent should build the dependency graph and tackle leaf nodes first
- Each prerequisite fix is a separate, small, testable commit

---

## Seam Identification (Working Effectively with Legacy Code)

From Michael Feathers' approach. A seam is a place where you can alter behavior without editing the code at that location.

### Types of Seams

| Seam Type | Mechanism | Example |
|-----------|-----------|---------|
| **Object seam** | Override via subclass or interface | Inject a mock dependency |
| **Preprocessor seam** | Conditional compilation | `#ifdef TEST` blocks |
| **Link seam** | Replace at link/import time | Module mocking, import aliasing |
| **Configuration seam** | Change behavior via config | Feature flags, environment variables |

### Agentic Workflow Considerations

- Before refactoring legacy code, agent should identify seams to create test harnesses
- Agent should prefer object and configuration seams over preprocessor seams
- Seam identification is the critical first step before any legacy refactoring
