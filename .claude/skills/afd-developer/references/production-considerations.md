# Production Considerations

Adjacent concerns important for production systems but intentionally outside AFD's core scope. AFD is a methodology (how to think), not a framework (what code to write).

## Security & Authorization

AFD validates **capability** (can this action be performed correctly?). **Authorization** (should this actor perform it?) is orthogonal.

### Common Approaches

**Scope-Based Permissions**:
```typescript
const deleteDocument = {
  name: 'document-delete',
  requiredScopes: ['documents:write', 'documents:delete'],
};
// Authorization layer checks before execution
```

**Resource-Level Access Control**:
```typescript
const canAccess = await checkAccess(actor, 'document', documentId);
```

**Approval Workflows** for destructive actions:
```typescript
return success({ pendingApproval: true, approvalId: 'apr-123' });
```

**Agent-Specific Constraints**:
```typescript
const agentConfig = {
  allowedCommands: ['document-read', 'document-list'],
  blockedCommands: ['document-delete', 'admin-*'],
  requiresUserConfirmation: ['document-update'],
};
```

**Recommendation**: Layer authorization on top of commands. Commands are agnostic to caller; a separate auth layer decides if the call proceeds.

## Mutation Safety

### Patterns

**Preview/Apply (Dry-Run)**: Let users see what will happen before it happens.

**Idempotency Keys**: Make retries safe with client-generated keys.

**Optimistic Concurrency**: Prevent overwrites with `expectedRevision`.

**Compensation/Undo Tokens**: For reversible operations, return `undoToken`.

| Command Type | Consider |
|--------------|----------|
| Creates resources | Idempotency keys |
| Updates shared data | Optimistic concurrency |
| Destructive actions | Preview/apply, undo tokens |
| Financial operations | All of the above |

## Sensitive Information in Reasoning

The `reasoning` field enables transparency, but raw reasoning may leak private data. Approaches:

1. **Separate user-safe explanation from debug reasoning**
2. **Redact sensitive patterns before returning**
3. **Reasoning access tiers** based on caller scope

Default to user-safe summaries. Keep detailed reasoning in logs or behind privileged access.

## Observability & Audit

### Recommended Metadata Fields

```typescript
metadata?: {
  traceId: string;           // Correlation across surfaces
  requestId: string;         // Unique per request
  commandVersion: string;    // Implementation version
  durationMs: number;        // Execution time
  actor?: {
    type: 'user' | 'agent' | 'system';
    id: string;
    clientId?: string;
  };
  effects?: Array<{
    type: 'created' | 'updated' | 'deleted';
    resourceType: string;
    resourceId: string;
  }>;
}
```

### OpenTelemetry Integration

Wrap commands with spans. Recommended attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `command.name` | string | Command identifier |
| `command.mutation` | boolean | Has side effects |
| `command.success` | boolean | Succeeded |
| `command.confidence` | float | AI confidence (0-1) |
| `command.duration_ms` | int | Execution time |
| `command.trace_id` | string | AFD trace ID |

### Metrics to Export

```
command_executions_total{command, success}
command_duration_seconds{command, quantile}
commands_in_progress{command}
command_errors_total{command, error_code}
```

## Trust Metrics Segmentation

Aggregate metrics hide problems. Segment by:

| Dimension | Why It Matters |
|-----------|----------------|
| **Surface** (UI / Agent / Automation) | Different surfaces have different reliability |
| **Command type** (Query / Mutation) | Mutations are higher-stakes |
| **Confidence tier** (High / Medium / Low) | Low-confidence needs more scrutiny |
| **Error category** | Transient vs permanent failures |

## Summary

| Concern | AFD's Scope | Your Responsibility |
|---------|-------------|---------------------|
| Authorization | Commands work correctly | Decide who can call them |
| Mutation safety | Commands are testable | Choose appropriate patterns |
| Sensitive reasoning | Enable transparency | Sanitize for your context |
| Observability | Provide metadata hooks | Implement your audit needs |
| Undo | Commands are well-defined | Add where domain requires |
| Metrics | Recommend what to track | Segment for your operations |
