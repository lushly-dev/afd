# Production Considerations

AFD defines a methodology for building agent-first software. This document covers adjacent concerns that are important for production systems but **intentionally outside AFD's core scope**.

## Why These Are Out of Scope

AFD is a **methodology** (how to think about building software), not a **framework** (what specific code to write). The core message is simple:

> Commands → CLI Validation → UI Surface

These production concerns are out of scope because:

1. **They vary significantly** by project, domain, and regulatory environment
2. **Including them would dilute** the core message
3. **Different teams need different solutions** - prescribing one would limit adoption

This document acknowledges these concerns and provides guidance on what to think about—without prescribing specific implementations.

---

## Security & Authorization

### The Problem

AFD says "expose everything as commands" and "if it works via CLI, it works everywhere." But in production, not every user or agent should access every command.

### AFD's Position

AFD validates **capability** (can this action be performed correctly?). **Authorization** (should this actor perform it?) is a separate, orthogonal concern.

The CLI validation principle ensures commands *work*. A separate authorization layer decides if a given call *proceeds*.

### Why AFD Doesn't Prescribe a Solution

Authorization models vary dramatically:

| Context | Typical Approach |
|---------|------------------|
| Consumer app | User-based permissions, OAuth scopes |
| Enterprise SaaS | Role-based access control (RBAC), tenant isolation |
| Internal tools | Service accounts, API keys |
| Regulated industries | Approval workflows, audit requirements |

Baking any specific model into AFD would limit its applicability.

### Common Approaches to Consider

**1. Scope-Based Permissions**
```typescript
// Command declares required scopes
const deleteDocument = {
  name: 'document.delete',
  requiredScopes: ['documents:write', 'documents:delete'],
  // ...
};

// Authorization layer checks before execution
if (!actor.hasScopes(command.requiredScopes)) {
  return { success: false, error: { code: 'FORBIDDEN', ... } };
}
```

**2. Resource-Level Access Control**
```typescript
// Check actor can access specific resource
const canAccess = await checkAccess(actor, 'document', documentId);
if (!canAccess) {
  return { success: false, error: { code: 'NOT_FOUND', ... } };
}
```

**3. Approval Workflows for Destructive Actions**
```typescript
// High-risk commands require approval
const result = {
  success: true,
  data: { pendingApproval: true, approvalId: 'apr-123' },
  plan: [
    { id: '1', action: 'request_approval', status: 'in_progress' },
    { id: '2', action: 'execute', status: 'pending' }
  ]
};
```

**4. Agent-Specific Constraints**

Agents may have stricter limits than developer CLI access:

```typescript
// Agent runtime constraints
const agentConfig = {
  maxTokensPerRequest: 4000,
  allowedCommands: ['document.read', 'document.list'],
  blockedCommands: ['document.delete', 'admin.*'],
  requiresUserConfirmation: ['document.update']
};
```

### Recommendation

Layer authorization **on top of** commands. Commands should be agnostic to who's calling them; a separate auth layer decides if the call proceeds. This keeps commands testable via CLI while allowing flexible security policies.

---

## Mutation Safety

### The Problem

If retries aren't safe and writes aren't concurrency-aware, trust collapses—even if CLI validation passes. A user who sees inconsistent results after a retry will lose confidence in the system.

### AFD's Position

Commands should be well-defined and testable. How you handle concurrency and mutation safety depends on your domain and consistency requirements.

### Why AFD Doesn't Require Specific Patterns

- Simple CRUD apps may not need idempotency keys
- Real-time collaborative apps need conflict resolution
- Financial systems need transaction guarantees
- Content management may only need optimistic locking

Requiring all of these would over-constrain simple use cases.

### Patterns to Consider

**1. Preview/Apply (Dry-Run)**

Let users see what will happen before it happens:

```typescript
// Preview mode - returns what would change
const preview = await call('document.update.preview', {
  id: 'doc-123',
  changes: { title: 'New Title' }
});
// Returns: { diff: [...], warnings: [...], affectedCount: 3 }

// Apply mode - performs the change
const result = await call('document.update.apply', {
  id: 'doc-123',
  changes: { title: 'New Title' },
  previewToken: preview.data.token  // Optional: ensure nothing changed
});
```

**2. Idempotency Keys**

Make retries safe:

```typescript
// Client generates idempotency key
const result = await call('payment.create', {
  amount: 100,
  idempotencyKey: 'user-123-order-456-attempt-1'
});

// If retried with same key, returns same result without re-executing
```

**3. Optimistic Concurrency**

Prevent overwrites in collaborative scenarios:

```typescript
// Include expected version
const result = await call('document.update', {
  id: 'doc-123',
  changes: { ... },
  expectedRevision: 42  // Fails if current revision != 42
});

// Error if concurrent edit occurred
if (result.error?.code === 'REVISION_CONFLICT') {
  // Prompt user to merge or retry
}
```

**4. Compensation/Undo Tokens**

For reversible operations:

```typescript
const result = await call('document.archive', {
  id: 'doc-123'
});
// Returns: { ..., undoToken: 'undo-xyz-789', undoExpiresAt: '...' }

// Later: undo the action
await call('document.archive.undo', { undoToken: 'undo-xyz-789' });
```

### Recommendation

For commands with side effects, consider which patterns apply:

| Command Type | Consider |
|--------------|----------|
| Creates resources | Idempotency keys |
| Updates shared data | Optimistic concurrency |
| Destructive actions | Preview/apply, undo tokens |
| Financial operations | All of the above |

Document which patterns each command supports in its schema.

---

## Sensitive Information in Reasoning

### The Problem

The `reasoning` field enables transparency—users can understand *why* the agent made a decision. However, raw reasoning might inadvertently leak:

- Private document excerpts
- Internal policy rules
- Prompt/system instructions
- Security-sensitive detection logic

### AFD's Position

Commands should return reasoning for transparency. How you sanitize or scope that reasoning is implementation-specific and depends on your security requirements.

### Approaches to Consider

**1. Separate User-Safe Explanation from Debug Reasoning**

```typescript
interface CommandResult<T> {
  // User-facing, sanitized
  explanation?: string;
  
  // Debug-level, privileged access only
  debugReasoning?: string;  // Excluded from production responses
}
```

**2. Redaction Before Returning**

```typescript
// Sanitize reasoning before including in result
const sanitizedReasoning = redactSensitivePatterns(rawReasoning, [
  /internal policy: .*/gi,
  /document excerpt: .*/gi
]);
```

**3. Reasoning Access Tiers**

```typescript
// Different detail levels based on caller
if (caller.hasScope('debug:reasoning')) {
  result.reasoning = fullReasoning;
} else {
  result.reasoning = summarizedReasoning;
}
```

### Recommendation

For production systems handling sensitive data, default to user-safe summaries. Keep detailed reasoning in logs or behind privileged access.

---

## Observability & Audit

### The Problem

For debugging, compliance, and incident response, you need visibility into what commands were called, by whom, and with what effects.

### AFD's Position

The `metadata` field in `CommandResult` supports observability data like `traceId`. What you track depends on your operational and compliance requirements.

### Recommended Fields for Production

```typescript
metadata?: {
  // Correlation
  traceId: string;           // Trace across UI/CLI/MCP calls
  requestId: string;         // Unique per request
  
  // Debugging
  commandVersion: string;    // Version of command implementation
  durationMs: number;        // Execution time
  
  // Audit (for mutations)
  actor?: {
    type: 'user' | 'agent' | 'system';
    id: string;
    clientId?: string;       // Which client/app
  };
  
  // Effects (for mutations)
  effects?: Array<{
    type: 'created' | 'updated' | 'deleted';
    resourceType: string;
    resourceId: string;
    summary?: string;
  }>;
}
```

### When to Include What

| Field | When to Include |
|-------|-----------------|
| `traceId` | Always (correlation) |
| `durationMs` | Always (performance) |
| `commandVersion` | Production (debugging) |
| `actor` | Mutations (audit) |
| `effects` | Mutations with side effects (audit) |

### OpenTelemetry Integration

For distributed tracing, you can wrap commands with OpenTelemetry spans. The `@afd/server` package provides a `createTracingMiddleware` helper, or you can implement your own:

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app-commands');

// Middleware that wraps commands with OpenTelemetry spans
export function withTracing(handler, commandName, mutation = false) {
  return async (input, context) => {
    return tracer.startActiveSpan(`command.${commandName}`, async (span) => {
      // Standard attributes
      span.setAttribute('command.name', commandName);
      span.setAttribute('command.mutation', mutation);
      span.setAttribute('command.trace_id', context.traceId ?? 'none');
      
      try {
        const result = await handler(input, context);
        
        // Result attributes
        span.setAttribute('command.success', result.success);
        if (result.confidence !== undefined) {
          span.setAttribute('command.confidence', result.confidence);
        }
        if (result.metadata?.durationMs) {
          span.setAttribute('command.duration_ms', result.metadata.durationMs);
        }
        
        // Error handling
        if (!result.success && result.error) {
          span.setAttribute('error.code', result.error.code);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: result.error.message,
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }
        
        span.end();
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        span.end();
        throw error;
      }
    });
  };
}
```

### Recommended Span Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `command.name` | string | Command identifier (e.g., `todo.create`) |
| `command.mutation` | boolean | Whether command has side effects |
| `command.success` | boolean | Whether command succeeded |
| `command.confidence` | float | AI confidence score (0-1) if applicable |
| `command.duration_ms` | int | Execution time in milliseconds |
| `command.trace_id` | string | AFD trace ID for correlation |
| `error.code` | string | Error code if failed |

### Correlation: traceId Flow

The `traceId` field enables correlation across surfaces:

```
┌──────────────────────────────────────────────────────────────┐
│                    Trace Correlation                          │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  UI Request           CLI Request           Agent Request     │
│      │                    │                     │             │
│      └────────────────────┴─────────────────────┘             │
│                           │                                   │
│                    ┌──────▼──────┐                            │
│                    │  traceId:   │                            │
│                    │  abc-123    │                            │
│                    └──────┬──────┘                            │
│                           │                                   │
│         ┌─────────────────┼─────────────────┐                 │
│         ▼                 ▼                 ▼                 │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐             │
│   │ Command  │     │ Database │     │ External │             │
│   │   Log    │     │  Query   │     │   API    │             │
│   └──────────┘     └──────────┘     └──────────┘             │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

1. **Client generates traceId** when initiating a request
2. **Pass traceId in context** to command handlers
3. **Include in metadata** for command result
4. **Propagate to downstream** services/databases
5. **Query logs by traceId** for end-to-end visibility

### Metrics to Export

For production monitoring, export these command metrics:

```typescript
// Counter: Total commands executed
command_executions_total{command="todo.create", success="true"}

// Histogram: Command duration
command_duration_seconds{command="todo.create", quantile="0.95"}

// Gauge: Commands in progress
commands_in_progress{command="todo.create"}

// Counter: Errors by type
command_errors_total{command="todo.create", error_code="VALIDATION_ERROR"}
```

**Recommended dashboards:**
- Command success rate by command and surface
- P50/P95/P99 latency by command
- Error rate trends
- AI command confidence distribution

---

## Undo & Compensation

### The Problem

Some domains require the ability to reverse actions—collaborative editing, financial transactions, or any destructive user-facing operation.

### AFD's Position

Not all commands are reversible (e.g., `email.send`, `notification.push`). Undo capability is domain-specific, not a universal requirement.

### When to Implement

Consider undo/compensation for:

- **Collaborative editing** - Conflict resolution, version history
- **Financial transactions** - Audit trail, reversals, chargebacks
- **Destructive user actions** - "Undo" window, soft deletes
- **Batch operations** - Partial rollback on failure

For commands where undo makes sense, return an `undoToken` and implement a corresponding `*.undo` command.

---

## Trust Metrics Segmentation

### The Problem

Aggregate metrics like "99% success rate" can hide problems. Mutations might be at 92% while queries are at 99.9%—the aggregate looks fine but mutations are problematic.

### AFD's Position

The [Trust Through Validation](./trust-through-validation.md) guide recommends tracking success rate, retry rate, and override rate. How you segment these metrics is an operational concern.

### Recommended Segments

| Dimension | Why It Matters |
|-----------|----------------|
| **Surface** (UI / Agent / Automation) | Different surfaces may have different reliability |
| **Command type** (Query / Mutation / Long-running) | Mutations are higher-stakes |
| **Confidence tier** (High / Medium / Low) | Low-confidence results need more scrutiny |
| **Error category** | Distinguish transient vs permanent failures |

Define these segments based on your analytics infrastructure and what actions you can take on the insights.

---

## Summary

| Concern | AFD's Scope | Your Responsibility |
|---------|-------------|---------------------|
| **Authorization** | Commands work correctly | Decide who can call them |
| **Mutation safety** | Commands are testable | Choose appropriate patterns |
| **Sensitive reasoning** | Enable transparency | Sanitize for your context |
| **Observability** | Provide metadata hooks | Implement your audit needs |
| **Undo** | Commands are well-defined | Add where domain requires |
| **Metrics** | Recommend what to track | Segment for your operations |

AFD gets you to "commands that work reliably for any caller." These production concerns get you to "commands that work reliably *and safely* in your specific environment."

---

## Related

- [Command Schema Guide](./command-schema-guide.md) - Schema design patterns
- [Trust Through Validation](./trust-through-validation.md) - Building user trust
- [Implementation Phases](./implementation-phases.md) - When to add production concerns (Phase 3-4)
