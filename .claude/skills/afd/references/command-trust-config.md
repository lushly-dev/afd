# Command Trust Config

Trust metadata on AFD commands that triggers safety behaviors in frontends.

## Fields

Added to `ZodCommandOptions` and `ZodCommandDefinition`:

```typescript
defineCommand({
  name: 'todo-delete',
  destructive: true,                              // Triggers confirmation UI
  confirmPrompt: 'This todo will be permanently deleted.',  // Custom message
  tags: ['destructive'],
  mutation: true,
  // ...
});
```

| Field | Type | Purpose |
|-------|------|---------|
| `destructive` | `boolean` | Signals frontends to prompt for confirmation |
| `confirmPrompt` | `string` | Custom confirmation message (fallback: generic) |

## Metadata Flow

```
Command Definition (destructive, confirmPrompt)
         ↓
Registry.getCommandMetadata(name)
         ↓
StreamingCallbacks.onToolEnd(name, result, latencyMs, metadata)
         ↓
SSE tool_end event { name, result, latencyMs, metadata }
         ↓
Frontend: if (metadata?.destructive) → show confirmation
```

## Registry API

```typescript
// Get metadata for a single command
registry.getCommandMetadata('todo-delete')
// → { name, description, destructive: true, confirmPrompt: '...', tags: [...] }

// List all commands with metadata
registry.listCommandsWithMetadata()
```

## SSE Event Format

```typescript
// tool_end event includes metadata when present
interface ToolEndEvent {
  name: string;
  result: unknown;
  latencyMs: number;
  metadata?: {
    destructive?: boolean;
    confirmPrompt?: string;
    tags?: string[];
    mutation?: boolean;
  };
}
```

## Frontend Pattern

```typescript
if (eventData.metadata?.destructive) {
  const confirmed = await confirm(
    'Confirm Agent Action',
    eventData.metadata.confirmPrompt || `Are you sure?`,
  );
  if (confirmed) {
    executeLocalAction(localStore, name, args, result);
  } else {
    // Action already executed on backend — sync to reconcile
    await localStore.forceSync();
  }
} else {
  executeLocalAction(localStore, name, args, result);
}
```

**Cancel semantics**: The backend executes before the frontend confirms. Cancelling prevents local apply but the server-side change already happened. Use Convex real-time sync or `forceSync()` to reconcile.

## Warning-Based Fallback

For runtime/contextual confirmation (not static command-level):

```typescript
return success(data, {
  warnings: [{
    code: 'REQUIRES_CONFIRMATION',
    message: 'This action cannot be undone',
    severity: 'caution',  // Frontend interprets as "show confirmation"
  }],
});
```

Use both approaches: `destructive: true` for static config, `severity: 'caution'` for runtime signals.

## Commands Using Trust Config

| Command | confirmPrompt |
|---------|---------------|
| `todo-delete` | "This todo will be permanently deleted." |
| `todo-clear` | "All completed todos will be permanently deleted." |
| `todo-delete-batch` | "These todos will be permanently deleted." |
| `list-delete` | "This list and all its todos will be permanently deleted." |
| `note-delete` | "This note will be permanently deleted." |
| `notefolder-delete` | "This folder and all its notes will be permanently deleted." |
