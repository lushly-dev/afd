---
status: approved
author: System
created: 2026-01-24
updated: 2026-01-24
priority: P2
depends-on: command-trust-config (complete)
review-round: 2
---

# Command Exposure & Undo Metadata

Extend AFD command schema with `undoable` and `expose` fields for headless-compatible safety metadata.

## Summary

This proposal extends the existing `command-trust-config` work with two additional fields:
- `undoable` — indicates the command can be reversed
- `expose` — controls which interfaces (MCP, CLI, palette, agent) can access the command

These fields are defined in AFD (not UI layer) because they're useful in headless scenarios:
- CLI can show "(undoable)" hints
- MCP servers can filter exposed commands
- Agents can report undo capability

---

## Proposed Schema

### CommandDefinition Extensions

```typescript
export interface CommandDefinition<TInput, TOutput> {
  // Existing from command-trust-config
  destructive?: boolean;
  confirmPrompt?: string;

  // NEW: Undo support
  /** Whether this command can be undone */
  undoable?: boolean;

  // NEW: Interface exposure control
  /** Which interfaces this command is exposed to */
  expose?: ExposeOptions;
}

export interface ExposeOptions {
  /** Command palette (default: true) */
  palette?: boolean;
  /** External MCP agents (default: false — opt-in for security) */
  mcp?: boolean;
  /** In-app AI assistant (default: true) */
  agent?: boolean;
  /** Terminal/CLI (default: false) */
  cli?: boolean;
}
```

### Defaults (Frozen)

```typescript
/** Frozen to prevent accidental mutation */
export const defaultExpose: Readonly<ExposeOptions> = Object.freeze({
  palette: true,   // User-facing: on by default
  agent: true,     // In-app AI: on by default
  mcp: false,      // External agents: opt-in (security)
  cli: false,      // Automation: opt-in
});
```

---

## Undo Semantics

The `undoable: true` flag declares capability. **Implementation is consumer-specific:**

| Consumer | Implementation |
|----------|----------------|
| FAST-AF | `${methodName}Undo()` convention on host |
| CLI | Show "(undoable)" in help text |
| MCP | Include in tool metadata |
| Agent | Report "I can undo this if needed" |

### CommandResult with Undo Info

For consumers that need runtime undo data:

```typescript
interface CommandResult<T> {
  // Existing fields...
  
  /** Undo command name (for remote/serializable undo) */
  undoCommand?: string;
  /** Arguments to pass to undo command */
  undoArgs?: Record<string, unknown>;
}
```

This allows serialization over MCP (functions can't serialize).

### Undo Validation (Optional)

Registry can validate undo capability at registration:

```typescript
registry.register(command, {
  validateUndo: true  // Warns if undoable but no undo handler resolvable
});
```

---

## Registry Filtering

### `listByExposure()` Method

Following existing `listByCategory()` and `listByTags()` patterns:

```typescript
/**
 * Get commands exposed to a specific interface.
 * @param interface - The interface to filter by (mcp, cli, palette, agent)
 */
listByExposure(interface: keyof ExposeOptions): CommandDefinition[] {
  return Array.from(commands.values()).filter(cmd => {
    const expose = cmd.expose ?? defaultExpose;
    return expose[interface] === true;
  });
}
```

### Usage

```typescript
// Get only MCP-exposed commands
const mcpTools = registry.listByExposure('mcp');

// Get CLI commands
const cliCommands = registry.listByExposure('cli');
```

---

## Blocked Interface Behavior

When a command is invoked through an interface where `expose[interface] === false`:

```typescript
// Registry checks interface context before execution
execute(id: string, args: unknown[], context: CommandContext): Promise<CommandResult> {
  const cmd = this.get(id);
  
  // Check exposure
  if (context.interface) {
    const expose = cmd.expose ?? defaultExpose;
    if (!expose[context.interface]) {
      return failure({
        code: 'COMMAND_NOT_EXPOSED',
        message: `Command '${id}' is not exposed to ${context.interface}`,
        retryable: false,
      });
    }
  }
  
  return cmd.execute(args, context);
}
```

---

## Headless Detection Helper

```typescript
/** Check if executing in headless context */
export function isHeadlessContext(ctx: CommandContext): boolean {
  return ctx.interface === 'cli' || ctx.interface === 'mcp';
}
```

---

## Implementation Tasks

### Task 1: Add `ExposeOptions` Type

**File:** `packages/core/src/commands.ts`

```typescript
export interface ExposeOptions {
  palette?: boolean;
  mcp?: boolean;
  agent?: boolean;
  cli?: boolean;
}

export const defaultExpose: Readonly<ExposeOptions> = Object.freeze({
  palette: true,
  agent: true,
  mcp: false,
  cli: false,
});
```

### Task 2: Extend `CommandDefinition`

**File:** `packages/core/src/commands.ts`

Add `undoable` and `expose` fields.

### Task 3: Add Undo Fields to `CommandResult`

**File:** `packages/core/src/result.ts`

Add `undoCommand` and `undoArgs` for serializable undo.

### Task 4: Add `listByExposure()` Method

**File:** `packages/core/src/commands.ts`

New method following existing `listByCategory`/`listByTags` pattern.

### Task 5: Add Exposure Check in `execute()`

**File:** `packages/core/src/commands.ts`

Check `expose[context.interface]` before execution.

### Task 6: Update `commandToMcpTool`

**File:** `packages/core/src/commands.ts`

Filter by `expose.mcp === true` when listing MCP tools.

### Task 7: Pass Through in Server Schema

**File:** `packages/server/src/schema.ts`

Pass new fields through in `defineCommand`.

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/commands.ts` | Modify | Add `ExposeOptions`, `undoable`, `expose`, `listByExposure()` |
| `packages/core/src/result.ts` | Modify | Add `undoCommand`, `undoArgs` |
| `packages/server/src/schema.ts` | Modify | Pass through new fields in `defineCommand` |

---

## Resolved Blockers

| Blocker | Resolution |
|---------|------------|
| `list()` filter inconsistent | Added `listByExposure()` following existing patterns |
| Missing blocked call behavior | Added `COMMAND_NOT_EXPOSED` error in `execute()` |
| No undo validation | Added optional `validateUndo` at registration |

---

## Related

- [Command Trust Config](../active/command-trust-config/command-trust-config.spec.md) — `destructive`, `confirmPrompt`
- [FAST-AF Command Safety Behaviors](../../../../../../fast-af/docs/features/active/command-safety/proposal.md) — UI implementations
