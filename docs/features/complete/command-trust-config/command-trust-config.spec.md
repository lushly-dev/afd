# Spec: Command Trust Config

**Proposal:** [command-trust-config.proposal.md](./command-trust-config.proposal.md)
**Status:** COMPLETE
**Created:** 2025-01
**Last Updated:** 2026-01
**Effort:** M (1-3 days)

---

## 1. Overview

Add trust metadata (`destructive`, `confirmPrompt`) to AFD command definitions and flow this metadata through the streaming pipeline so frontends can prompt users for confirmation before executing destructive agent actions locally.

### Key Decisions

| Decision | Outcome |
|----------|---------|
| Metadata location | Add to `ZodCommandOptions` in `@lushly-dev/afd-server` |
| Streaming format | Include `metadata` object in `tool_end` SSE events |
| Registry exposure | Add `getCommandMetadata(name)` method |
| Confirmation timing | After backend executes, before local apply |
| Warning-based fallback | Support `severity: 'caution'` as runtime signal |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Command Definition (Backend)                      │
│  defineCommand({                                                     │
│    name: 'todo-delete',                                              │
│    destructive: true,                                                │
│    confirmPrompt: 'Delete this todo permanently?',                  │
│    tags: ['destructive'],                                            │
│  })                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Registry (Backend)                                │
│  registry.getCommandMetadata('todo-delete')                         │
│  → { destructive: true, confirmPrompt: '...', tags: [...] }         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Chat Processing (Backend)                         │
│  onToolEnd(name, result, latencyMs, metadata)                       │
│  ← metadata fetched from registry after execution                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SSE Event (Network)                               │
│  event: tool_end                                                     │
│  data: { name, result, latencyMs, metadata }                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Frontend Handler                                  │
│  if (metadata?.destructive) {                                       │
│    await confirmDestructiveAction(name, metadata.confirmPrompt);    │
│  }                                                                   │
│  executeLocalAction(localStore, name, args, result);                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data & API

### 3.1 Command Options Extension

```typescript
// packages/server/src/schema.ts

export interface ZodCommandOptions<TInput, TOutput> {
  // Existing fields...
  name: string;
  description: string;
  input: TInput;
  handler: (input: TInput, context: CommandContext) => Promise<CommandResult<TOutput>>;
  category?: string;
  mutation?: boolean;
  tags?: string[];
  version?: string;
  executionTime?: 'instant' | 'fast' | 'slow' | 'long-running';
  errors?: string[];
  handoff?: boolean;
  handoffProtocol?: string;

  // NEW: Trust metadata
  /** Whether this command is destructive (triggers confirmation UI) */
  destructive?: boolean;
  /** Custom confirmation prompt message */
  confirmPrompt?: string;
}
```

### 3.2 Command Metadata Type

```typescript
// packages/server/src/schema.ts (or new file)

export interface CommandMetadata {
  name: string;
  description: string;
  category?: string;
  mutation?: boolean;
  tags?: string[];
  destructive?: boolean;
  confirmPrompt?: string;
}
```

### 3.3 Registry Extension

```typescript
// demos/todo/backend/src/registry.ts

interface ExecutableCommand {
  name: string;
  description: string;
  handler: (input: unknown) => Promise<CommandResult<unknown>>;
  // NEW
  metadata: CommandMetadata;
}

export class CommandRegistry {
  // Existing methods...

  /** Get command metadata for trust/safety checks */
  getCommandMetadata(name: string): CommandMetadata | undefined {
    const command = this.commands.get(name);
    return command?.metadata;
  }

  /** List commands with full metadata */
  listCommandsWithMetadata(): CommandMetadata[] {
    return Array.from(this.commands.values()).map((cmd) => cmd.metadata);
  }
}
```

### 3.4 Streaming Callbacks Extension

```typescript
// demos/todo/backend/src/chat.ts

export interface StreamingCallbacks {
  onToken: (text: string) => void;
  onToolStart: (name: string) => void;
  // CHANGED: Added metadata parameter
  onToolEnd: (
    name: string,
    result: unknown,
    latencyMs: number,
    metadata?: CommandMetadata
  ) => void;
  onError: (message: string) => void;
  onDone: (metadata: DoneMetadata) => void;
}
```

### 3.5 SSE Event Format

```typescript
// tool_end event data structure
interface ToolEndEvent {
  name: string;
  result: unknown;
  latencyMs: number;
  error?: string;
  metadata?: {
    destructive?: boolean;
    confirmPrompt?: string;
    tags?: string[];
    mutation?: boolean;
  };
}
```

---

## 4. Implementation

### 4.1 File: `packages/server/src/schema.ts` [MODIFY]

#### Add Trust Fields to ZodCommandOptions

```typescript
export interface ZodCommandOptions<TInput, TOutput> {
  // ... existing fields ...

  /**
   * Whether this command performs destructive/irreversible actions.
   * When true, frontends SHOULD prompt for user confirmation before
   * applying the result locally.
   */
  destructive?: boolean;

  /**
   * Custom confirmation prompt message for destructive commands.
   * If not provided, frontends MAY use a generic confirmation message.
   * @example "Delete 'Buy groceries' permanently?"
   */
  confirmPrompt?: string;
}
```

#### Add Trust Fields to ZodCommandDefinition

The definition interface must also include these fields so they're available on the command object after `defineCommand()`:

```typescript
export interface ZodCommandDefinition<TInput, TOutput> {
  // ... existing fields ...

  /** Whether this command is destructive (triggers confirmation UI) */
  destructive?: boolean;
  /** Custom confirmation prompt message */
  confirmPrompt?: string;
}
```

#### Update defineCommand to Include Metadata

```typescript
export function defineCommand<TInput, TOutput>(
  options: ZodCommandOptions<TInput, TOutput>
): ZodCommandDefinition<TInput, TOutput> {
  // ... existing code ...

  return {
    // ... existing fields ...
    destructive: options.destructive,
    confirmPrompt: options.confirmPrompt,
    // ... rest ...
  };
}
```

---

### 4.2 File: `demos/todo/backend/src/registry.ts` [MODIFY]

#### Update ExecutableCommand Interface

```typescript
interface ExecutableCommand {
  name: string;
  description: string;
  handler: (input: unknown) => Promise<CommandResult<unknown>>;
  metadata: {
    category?: string;
    tags?: string[];
    mutation?: boolean;
    destructive?: boolean;
    confirmPrompt?: string;
  };
}
```

#### Update Constructor to Store Metadata

```typescript
constructor() {
  for (const cmd of allCommands) {
    this.commands.set(cmd.name, {
      name: cmd.name,
      description: cmd.description,
      handler: cmd.handler as (input: unknown) => Promise<CommandResult<unknown>>,
      metadata: {
        category: cmd.category,
        tags: cmd.tags,
        mutation: cmd.mutation,
        destructive: cmd.destructive,
        confirmPrompt: cmd.confirmPrompt,
      },
    });
  }
}
```

#### Add getCommandMetadata Method

```typescript
/**
 * Get command metadata for trust/safety checks.
 * Used by streaming layer to include metadata in tool_end events.
 */
getCommandMetadata(name: string): CommandMetadata | undefined {
  const command = this.commands.get(name);
  if (!command) return undefined;
  return {
    name: command.name,
    description: command.description,
    ...command.metadata,
  };
}
```

---

### 4.3 File: `demos/todo/backend/src/chat.ts` [MODIFY]

#### Update StreamingCallbacks Interface

```typescript
export interface StreamingCallbacks {
  onToken: (text: string) => void;
  onToolStart: (name: string) => void;
  onToolEnd: (
    name: string,
    result: unknown,
    latencyMs: number,
    metadata?: {
      destructive?: boolean;
      confirmPrompt?: string;
      tags?: string[];
    }
  ) => void;
  onError: (message: string) => void;
  onDone: (metadata: unknown) => void;
}
```

#### Update processChatStreaming to Pass Metadata

In the tool execution loop, after executing command:

```typescript
// Execute command
const result = await callConvexAction(commandName, fc.args || {});
const latencyMs = performance.now() - start;

// Get command metadata from registry
const metadata = registry.getCommandMetadata(commandName);

// Notify tool completion WITH metadata
callbacks.onToolEnd(commandName, toolExecution.result, latencyMs, metadata ? {
  destructive: metadata.destructive,
  confirmPrompt: metadata.confirmPrompt,
  tags: metadata.tags,
} : undefined);
```

---

### 4.4 File: `demos/todo/backend/src/chat-server.ts` [MODIFY]

#### Update onToolEnd Handler

```typescript
onToolEnd: (name: string, result: unknown, latencyMs: number, metadata?: CommandMetadata) => {
  res.write(`event: tool_end\ndata: ${JSON.stringify({
    name,
    result,
    latencyMs,
    metadata: metadata ? {
      destructive: metadata.destructive,
      confirmPrompt: metadata.confirmPrompt,
      tags: metadata.tags,
    } : undefined,
  })}\n\n`);
},
```

---

### 4.5 File: `demos/todo/backend/src/commands/delete.ts` [MODIFY]

#### Add Trust Metadata

```typescript
export const deleteTodo = defineCommand<typeof inputSchema, DeleteResult>({
  name: 'todo-delete',
  description: 'Delete a todo item',
  category: 'todo',
  tags: ['todo', 'delete', 'write', 'single', 'destructive'],
  mutation: true,
  version: '1.0.0',
  input: inputSchema,
  errors: ['NOT_FOUND'],
  // NEW: Trust metadata
  destructive: true,
  confirmPrompt: 'This todo will be permanently deleted.',

  async handler(input) {
    // ... existing handler code ...
  },
});
```

#### Similarly Update Other Destructive Commands

**Todo commands:**
- `demos/todo/backend/src/commands/clear.ts` - `destructive: true`, `confirmPrompt: 'All completed todos will be permanently deleted.'`
- `demos/todo/backend/src/commands/delete-batch.ts` - `destructive: true`, `confirmPrompt: 'These todos will be permanently deleted.'`

**List commands:**
- `demos/todo/backend/src/commands/list-delete.ts` - `destructive: true`, `confirmPrompt: 'This list and all its todos will be permanently deleted.'`

**Note commands:**
- `demos/todo/backend/src/commands/note-delete.ts` - `destructive: true`, `confirmPrompt: 'This note will be permanently deleted.'`
- `demos/todo/backend/src/commands/notefolder-delete.ts` - `destructive: true`, `confirmPrompt: 'This folder and all its notes will be permanently deleted.'`

---

### 4.6 File: `demos/todo/frontend/src/components/ChatSidebar.tsx` [MODIFY]

#### Reuse Existing useConfirm Hook

The frontend already has a `useConfirm` hook at `demos/todo/frontend/src/hooks/useConfirm.ts`. Reuse it for consistency with UI-triggered confirmations.

```typescript
// Import the existing hook
import { useConfirm } from '../hooks/useConfirm';

// In component
const { confirm } = useConfirm();
```

#### Update tool_end Handler

```typescript
} else if (currentEvent === 'tool_end') {
  const eventData = JSON.parse(data) as {
    name: string;
    result: unknown;
    latencyMs: number;
    metadata?: {
      destructive?: boolean;
      confirmPrompt?: string;
      tags?: string[];
    };
  };

  // ... existing tool completion UI updates ...

  // Check if destructive action needs confirmation
  if (eventData.metadata?.destructive) {
    const args = toolsInProgress.get(eventData.name)?.args || {};
    const toolDisplayName = eventData.name.replace(/-/g, ' ');

    const confirmed = await confirm(
      'Confirm Agent Action',
      eventData.metadata.confirmPrompt || `Are you sure you want to ${toolDisplayName}?`,
      'This action was performed by the AI assistant.'
    );

    if (confirmed) {
      // User confirmed - apply locally
      executeLocalAction(localStore, eventData.name, args, eventData.result);
    } else {
      // User cancelled - sync to reconcile with backend state
      // The action already executed on Convex, so we need to sync
      await handleCancelledDestructiveAction(eventData.name);
    }
  } else if (!eventData.error) {
    // Non-destructive: execute immediately
    const args = toolsInProgress.get(eventData.name)?.args || {};
    executeLocalAction(localStore, eventData.name, args, eventData.result);
  }
}
```

#### Handle Sync on Cancelled Destructive Action

When the user cancels a destructive action, the backend (Convex) has already executed it. The local Zustand store is now out of sync. Handle this gracefully:

```typescript
/**
 * Handle when user cancels a destructive action that already executed on backend.
 * Since Convex already performed the action, we need to sync local state.
 */
const handleCancelledDestructiveAction = useCallback(async (commandName: string) => {
  // Option 1: Force sync from Convex (preferred)
  // This ensures local state matches backend
  if (localStore?.forceSync) {
    await localStore.forceSync();
  }

  // Option 2: Show informational message
  // Let user know the action was performed server-side
  addMessage({
    id: crypto.randomUUID(),
    role: 'system',
    content: `Note: The ${commandName.replace(/-/g, ' ')} action was already performed on the server. Your view has been synced.`,
    timestamp: new Date().toISOString(),
  });
}, [localStore, addMessage]);
```

**Important:** If `forceSync()` doesn't exist on the local store, implement it or use Convex's real-time sync to automatically reconcile state on the next query update.

---

## 5. Test Plan

| Type | Test Case | Location |
|------|-----------|----------|
| Unit | defineCommand includes destructive/confirmPrompt | `packages/server/src/schema.test.ts` |
| Unit | ZodCommandDefinition has destructive/confirmPrompt fields | `packages/server/src/schema.test.ts` |
| Unit | Registry.getCommandMetadata returns metadata | `demos/todo/backend/src/registry.test.ts` |
| Unit | StreamingCallbacks.onToolEnd receives metadata | `demos/todo/backend/src/chat.test.ts` |
| Unit | tool_end SSE event includes metadata | `demos/todo/backend/src/chat-server.test.ts` |
| Integration | Delete command flows metadata to frontend | Manual test |
| E2E | Agent delete triggers confirmation dialog | Manual test |
| E2E | User cancel triggers sync and shows message | Manual test |
| E2E | User confirm applies local delete | Manual test |
| E2E | Note delete shows note-specific confirmation | Manual test |

### Manual Test Scenarios

1. **Agent Delete Flow (Confirm):**
   - Send chat message: "Delete the todo about groceries"
   - Verify confirmation dialog appears with custom prompt
   - Click "Confirm" → todo removed from list
   - Verify chat shows successful deletion

2. **Agent Delete Flow (Cancel + Sync):**
   - Send chat message: "Delete the todo about milk"
   - Verify confirmation dialog appears
   - Click "Cancel"
   - Verify system message appears: "action was already performed on the server"
   - Verify local state syncs (todo disappears after sync)
   - This validates the sync-on-cancel behavior

3. **Non-Destructive Flow:**
   - Send chat message: "Create a new todo to buy milk"
   - Verify NO confirmation dialog appears
   - Verify todo appears immediately in list

4. **Note Delete Flow:**
   - Send chat message: "Delete the note about recipes"
   - Verify confirmation dialog appears with note-specific prompt
   - Test both confirm and cancel paths

---

## 6. Rollout

### Wave 1: Backend Schema Changes

1. Add `destructive` and `confirmPrompt` to `ZodCommandOptions`
2. Update `defineCommand` to pass through fields
3. Update `ZodCommandDefinition` interface

### Wave 2: Registry & Streaming

1. Update `CommandRegistry` to store and expose metadata
2. Update `StreamingCallbacks` interface
3. Update `processChatStreaming` to fetch and pass metadata
4. Update `chat-server.ts` to include metadata in SSE events

### Wave 3: Command Updates

1. Add `destructive: true` to delete commands
2. Add custom `confirmPrompt` messages
3. Optionally update warnings to use `severity: 'caution'`

### Wave 4: Frontend Integration

1. Add pending confirmation state
2. Update `tool_end` handler to check metadata
3. Add confirmation dialog component/usage
4. Test end-to-end flow

### Rollback

- Backend changes are additive (new optional fields)
- Frontend can ignore metadata if not present
- No data migration required
- Revert commits if issues found

---

## 7. Checklist

### Backend Schema
- [x] `ZodCommandOptions` updated with `destructive`, `confirmPrompt`
- [x] `ZodCommandDefinition` updated with `destructive`, `confirmPrompt`
- [x] `defineCommand` passes through trust fields

### Registry & Streaming
- [x] `CommandRegistry.getCommandMetadata()` implemented
- [x] `StreamingCallbacks.onToolEnd` signature updated
- [x] `processChatStreaming` fetches and passes metadata
- [x] `chat-server.ts` includes metadata in `tool_end` events

### Destructive Commands
- [x] `todo-delete` command has `destructive: true`
- [x] `todo-clear` command has `destructive: true`
- [x] `todo-deleteBatch` command has `destructive: true`
- [x] `list-delete` command has `destructive: true`
- [x] `note-delete` command has `destructive: true`
- [x] `notefolder-delete` command has `destructive: true`

### Frontend Integration
- [x] `useConfirm` hook imported in ChatSidebar
- [x] `tool_end` handler checks `metadata.destructive`
- [x] Confirmation dialog shown for destructive agent actions
- [x] Cancelled actions rely on Convex sync (no explicit handler needed)

### Verification
- [x] Manual tests pass (agent delete flow, cancel flow)
- [x] Proposal updated to IMPLEMENTED status
