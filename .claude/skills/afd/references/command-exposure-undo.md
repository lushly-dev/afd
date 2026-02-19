# Command Exposure & Undo

Extends command trust config with interface exposure control and undo capability metadata.

## Exposure Control

Controls which interfaces can access a command:

```typescript
export interface ExposeOptions {
  palette?: boolean;  // Command palette (default: true)
  mcp?: boolean;      // External MCP agents (default: false — opt-in)
  agent?: boolean;    // In-app AI assistant (default: true)
  cli?: boolean;      // Terminal/CLI (default: false)
}

export const defaultExpose: Readonly<ExposeOptions> = Object.freeze({
  palette: true,
  agent: true,
  mcp: false,    // Security: external agents must opt-in
  cli: false,
});
```

### Usage in Command Definition

```typescript
defineCommand({
  name: 'settings-reset',
  destructive: true,
  expose: {
    palette: true,
    agent: false,   // Don't let AI reset settings
    mcp: false,
    cli: true,
  },
  // ...
});
```

### Registry Filtering

```typescript
// Get commands exposed to a specific interface
const mcpTools = registry.listByExposure('mcp');
const cliCommands = registry.listByExposure('cli');
```

### Blocked Interface Behavior

When invoked through a non-exposed interface:

```typescript
// Returns structured error
{
  code: 'COMMAND_NOT_EXPOSED',
  message: "Command 'settings-reset' is not exposed to mcp",
  retryable: false,
}
```

### Headless Detection

```typescript
export function isHeadlessContext(ctx: CommandContext): boolean {
  return ctx.interface === 'cli' || ctx.interface === 'mcp';
}
```

## Undo Metadata

The `undoable` flag declares capability. Implementation is consumer-specific.

### Command Definition

```typescript
defineCommand({
  name: 'todo-archive',
  undoable: true,
  // ...
});
```

### CommandResult Undo Fields

For serializable undo over MCP (functions can't serialize):

```typescript
interface CommandResult<T> {
  // ... existing fields ...
  undoCommand?: string;                    // e.g. 'todo-unarchive'
  undoArgs?: Record<string, unknown>;      // e.g. { id: '123' }
}
```

### Consumer Implementations

| Consumer | Undo Implementation |
|----------|---------------------|
| FAST-AF | `${methodName}Undo()` convention on host |
| CLI | Show "(undoable)" in help text |
| MCP | Include in tool metadata |
| Agent | Report "I can undo this if needed" |

### Undo Validation

Optional registry validation at registration:

```typescript
registry.register(command, {
  validateUndo: true  // Warns if undoable but no undo handler resolvable
});
```

## File Locations

| File | Changes |
|------|---------|
| `packages/core/src/commands.ts` | `ExposeOptions`, `defaultExpose`, `undoable`, `expose`, `listByExposure()` |
| `packages/core/src/result.ts` | `undoCommand`, `undoArgs` |
| `packages/server/src/schema.ts` | Pass through new fields in `defineCommand` |
