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

### Interface-aware consumers

Read `CommandContext.interface` directly when your application needs to distinguish an interactive caller from a CLI or MCP caller:

```typescript
const headless = context.interface === 'cli' || context.interface === 'mcp';
```

This is an application predicate, not an exported AFD helper. Interface exposure does not replace application authentication or authorization.

## Undo Metadata

The `undoable` flag declares capability. Implementation is consumer-specific. It is on core `CommandDefinition` and on `defineCommand`; `spec/command-metadata.md` lists where it surfaces.

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
| CLI | `afd tools` shows `(undoable)` after the tool name |
| MCP | `_meta.undoable` in `tools/list`; `afd-detail`, `afd-help` (full) and `afd-docs` report it |
| Agent | Report "I can undo this if needed" |

### Undo Validation

`registry.register(command)` accepts a command definition. It does not resolve or validate undo handlers. A consumer that advertises undo must test that the returned `undoCommand` exists, that `undoArgs` pass its input schema, and that the undo restores the intended state. `undoable: true` alone does not guarantee an executable undo.

## File Locations

| File | Changes |
|------|---------|
| `packages/core/src/commands.ts` | `ExposeOptions`, `defaultExpose`, `undoable`, `expose`, `listByExposure()` |
| `packages/core/src/result.ts` | `undoCommand`, `undoArgs` |
| `packages/server/src/schema.ts` | Pass through new fields in `defineCommand` |
