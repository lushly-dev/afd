# Command Trust Config

**Status:** IMPLEMENTED (2025-01)
**Priority:** P2
**Depends On:** Command Protocol (Complete), Streaming Architecture (Complete)
**Spec:** [command-trust-config.spec.md](./command-trust-config.spec.md)

---

## Summary

Extend AFD's command definitions with trust metadata that triggers safety behaviors in frontends. When an agent executes a destructive action (delete, clear, etc.), the frontend should prompt the user for confirmation before applying the change locally.

## Problem Statement

Currently in the Myoso demo:
1. Commands have `tags: ['destructive']` but this metadata doesn't flow to the frontend
2. `executeLocalAction` in ChatSidebar runs immediately on `tool_end` without confirmation
3. Agent-triggered deletes bypass the confirmation dialog that UI-triggered deletes show

## Current Implementation Status

### What Already Exists

**Tags on destructive commands:**
```typescript
// demos/todo/backend/src/commands/delete.ts
export const deleteTodo = defineCommand({
  name: 'todo-delete',
  tags: ['todo', 'delete', 'write', 'single', 'destructive'],  // ✅ Tag exists
  mutation: true,
  // ...
});
```

**Warnings in CommandResult:**
```typescript
return success(
  { deleted: true, id: input.id },
  {
    warnings: [{
      code: 'PERMANENT',
      message: 'This action cannot be undone',
      severity: 'info',  // Could use 'caution' to signal confirmation needed
    }],
  }
);
```

**UI confirmation for manual actions:**
```typescript
// demos/todo/frontend/src/hooks/useTodoOperations.ts
const handleDeleteTodo = async (id: string) => {
  const confirmed = await confirm(
    "Delete Todo",
    `Are you sure you want to delete "${todo?.title}"?`,
    "This action cannot be undone."
  );
  if (!confirmed) return;
  localStore.deleteTodo(id);  // Only executes after confirmation
};
```

### What's Missing

**Streaming events don't include command metadata:**
```typescript
// demos/todo/backend/src/chat-server.ts (current)
onToolEnd: (name: string, result: unknown, latencyMs: number) => {
  res.write(`event: tool_end\ndata: ${JSON.stringify({ name, result, latencyMs })}\n\n`);
  // ❌ Missing: destructive flag, tags, confirmPrompt
}
```

**Frontend executes immediately without checking:**
```typescript
// demos/todo/frontend/src/components/ChatSidebar.tsx (current)
if (!eventData.error) {
  executeLocalAction(localStore, eventData.name, args, eventData.result);
  // ❌ No confirmation for destructive actions
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Command Definition                                │
│  defineCommand({                                                     │
│    name: 'todo-delete',                                              │
│    destructive: true,           // Explicit flag                     │
│    confirmPrompt: 'Delete this todo permanently?',  // Custom msg    │
│    tags: ['destructive'],       // Also in tags for filtering        │
│  })                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Streaming Event (tool_end)                        │
│  {                                                                   │
│    name: 'todo-delete',                                              │
│    result: { deleted: true, id: '123' },                            │
│    latencyMs: 0.5,                                                   │
│    metadata: {                    // NEW: Include trust metadata     │
│      destructive: true,                                              │
│      confirmPrompt: 'Delete this todo permanently?',                │
│    }                                                                 │
│  }                                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Frontend Handler                                  │
│  if (eventData.metadata?.destructive) {                             │
│    const confirmed = await confirmDestructiveAction(                │
│      eventData.name,                                                 │
│      eventData.metadata.confirmPrompt                               │
│    );                                                                │
│    if (!confirmed) return;  // User cancelled                       │
│  }                                                                   │
│  executeLocalAction(localStore, eventData.name, args, result);      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Proposed Extensions

### 1. ZodCommandOptions (packages/server/src/schema.ts)

```typescript
export interface ZodCommandOptions<TInput, TOutput> {
  // Existing fields
  name: string;
  description: string;
  input: TInput;
  handler: (input, context) => Promise<CommandResult<TOutput>>;
  category?: string;
  mutation?: boolean;
  tags?: string[];
  // ...

  // NEW: Trust flags
  destructive?: boolean;      // Triggers confirmation UI before execution
  confirmPrompt?: string;     // Custom confirmation message
  undoable?: boolean;         // Signals that undo is available (future)
}
```

### 2. Streaming Callbacks (demos/todo/backend/src/chat.ts)

```typescript
export interface StreamingCallbacks {
  onToken: (text: string) => void;
  onToolStart: (name: string, args: Record<string, unknown>) => void;
  onToolEnd: (
    name: string,
    result: unknown,
    latencyMs: number,
    metadata?: {                // NEW: Pass through command metadata
      destructive?: boolean;
      confirmPrompt?: string;
      tags?: string[];
    }
  ) => void;
  onError: (message: string) => void;
  onDone: (metadata: DoneMetadata) => void;
}
```

### 3. SSE Event Format (chat-server.ts)

```typescript
onToolEnd: (name, result, latencyMs, metadata) => {
  res.write(`event: tool_end\ndata: ${JSON.stringify({
    name,
    result,
    latencyMs,
    metadata  // Include destructive, confirmPrompt, tags
  })}\n\n`);
}
```

### 4. Frontend Integration (ChatSidebar.tsx)

```typescript
} else if (currentEvent === 'tool_end') {
  const { name, result, latencyMs, metadata } = eventData;

  // Check if destructive action needs confirmation
  if (metadata?.destructive) {
    const confirmed = await showDestructiveConfirmation({
      toolName: name,
      prompt: metadata.confirmPrompt || `Are you sure you want to ${name}?`,
      args: toolArgs.get(name),
    });

    if (!confirmed) {
      // User cancelled - don't execute locally
      // Optionally show "Action cancelled" message
      return;
    }
  }

  // Execute local action (only after confirmation if destructive)
  executeLocalAction(localStore, name, toolArgs.get(name) || {}, result);
}
```

---

## Alternative: Warning-Based Signaling

Instead of (or in addition to) command-level flags, the `severity: 'caution'` warning level could signal "needs confirmation":

```typescript
// In command handler
return success(data, {
  warnings: [{
    code: 'REQUIRES_CONFIRMATION',
    message: 'This action cannot be undone',
    severity: 'caution',  // Frontend interprets as "show confirmation"
  }],
});
```

**Pros:** No schema changes needed, works with existing Warning type
**Cons:** Requires frontend to parse warnings, less explicit than `destructive: true`

**Recommendation:** Use both approaches:
- `destructive: true` for explicit command-level configuration
- `severity: 'caution'` warnings for runtime/contextual confirmation needs

---

## Use Cases

| Flag | Trigger | Example |
|------|---------|---------|
| `destructive: true` | Show confirmation modal before local execution | Delete item, clear completed |
| `confirmPrompt` | Custom message in confirmation dialog | "Delete 'Buy groceries' permanently?" |
| `undoable: true` | Show undo option after execution (future) | Edit, move, archive |

---

## Implementation Phases

### Phase 1: Metadata Flow (Required)
1. Add `destructive` and `confirmPrompt` to `ZodCommandOptions`
2. Expose command metadata in registry
3. Pass metadata through streaming callbacks
4. Include metadata in `tool_end` SSE events

### Phase 2: Frontend Integration (Required)
1. Add confirmation dialog component for agent actions
2. Check `metadata.destructive` before `executeLocalAction`
3. Show custom prompt from `metadata.confirmPrompt`

### Phase 3: Enhanced UX (Optional)
1. Add `undoable` flag and undo stack
2. Add `requiresAuth` for protected operations
3. Add visual indicators for destructive commands in tool execution list

---

## Registry Changes

The `CommandRegistry` needs to expose full command metadata:

```typescript
// Current (insufficient)
listCommands(): Array<{ name: string; description: string }>

// Proposed
listCommands(): Array<{
  name: string;
  description: string;
  destructive?: boolean;
  confirmPrompt?: string;
  tags?: string[];
  mutation?: boolean;
}>

// Or add a getCommandMetadata method
getCommandMetadata(name: string): CommandMetadata | undefined
```

---

## Consumers

- **Myoso Demo** (`demos/todo`) — Reference implementation
- **Any AFD frontend** — Can implement confirmation UI based on metadata

---

## Open Questions

1. ~~Should undo be mandatory for undoable commands?~~ → Defer to Phase 3
2. ~~Auth integration pattern?~~ → Out of scope for this proposal
3. **Should confirmation happen before or after backend execution?**
   - Current: Backend executes, then frontend confirms before local apply
   - Alternative: Frontend confirms, then triggers backend execution
   - Recommendation: Keep current flow (backend already executed, confirm local apply)

4. **What if user cancels after backend executed?**
   - The action already happened on the backend (Convex)
   - Cancelling only prevents local UI update
   - May cause sync issues → Need to handle gracefully

---

## Related

- [Production Considerations](../../guides/production-considerations.md) — Broader security patterns
- [Command Schema Guide](../../guides/command-schema-guide.md) — Command design patterns
- AGENTS.md — Documents `destructive` tag convention
