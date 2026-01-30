---
proposal: command-exposure-undo
reviewer: Claude Opus 4.5
date: 2026-01-24
verdict: REVISE REQUIRED
---

# Command Exposure & Undo Metadata — Review

## Context

Reviewed proposal at `docs/features/proposed/command-exposure-undo/proposal.md` which extends `CommandDefinition` with `undoable` and `expose` fields for headless-compatible safety metadata.

**Review Criteria:**
- Type safety
- Integration with existing `command-trust-config`
- Headless compatibility (CLI, MCP, agents)

**Codebase Research Performed:**
- `packages/core/src/commands.ts` — CommandDefinition, CommandRegistry, commandToMcpTool
- `packages/core/src/result.ts` — CommandResult interface
- `packages/server/src/schema.ts` — ZodCommandOptions with destructive/confirmPrompt
- `packages/core/src/commands.test.ts` — Existing filtering patterns (listByTags)

---

## BLOCKERS (Must Fix)

### 1. `list()` Filter API Inconsistent with Existing Patterns

**Evidence:** Existing registry uses separate methods for filtering:
```typescript
// Existing pattern (commands.ts:317-332)
listByCategory(category: string): CommandDefinition[];
listByTags(tags: string[], mode: 'all' | 'any'): CommandDefinition[];
```

**Proposed (breaks convention):**
```typescript
list(filter?: { expose?: keyof ExposeOptions })
```

**Fix:** Follow established pattern with a dedicated method:
```typescript
listByExposure(interface: keyof ExposeOptions): CommandDefinition[];
```

Or update `list()` with a more extensible filter object that could include multiple criteria:
```typescript
list(filter?: CommandFilter): CommandDefinition[];

interface CommandFilter {
  category?: string;
  tags?: { values: string[]; mode: 'all' | 'any' };
  expose?: keyof ExposeOptions;
}
```

---

### 2. Missing Behavior Spec for Blocked Interface Calls

**Issue:** What happens when a command is invoked through an interface where `expose[interface] === false`?

Scenarios:
- MCP client calls `document.create` but `expose.mcp: false`
- CLI invokes `preferences.set` but `expose.cli: false`

**Evidence:** No error handling or behavior specified in proposal.

**Fix:** Define explicit behavior:
```typescript
// Option A: Return error in CommandResult
{ success: false, error: { code: 'COMMAND_NOT_EXPOSED', message: '...' } }

// Option B: Throw typed error
throw new CommandNotExposedError(commandName, interface);

// Option C: Omit from listing, block at registry.execute()
```

Recommend Option A for headless compatibility (agents can handle gracefully).

---

### 3. No Undo Validation at Definition Time

**Issue:** `undoable: true` is declarative but nothing validates the undo mechanism exists.

**Evidence:** Proposal states "Implementation is consumer-specific":
- FAST-AF: `${methodName}Undo()` convention
- CLI: Show "(undoable)" hint
- MCP: Include in metadata

But if a developer sets `undoable: true` and forgets to implement the undo method, runtime failures occur.

**Fix:** Add validation option in registry:
```typescript
registry.register(command, {
  validateUndo: true  // Throws if undoable but no undo handler
});
```

Or require explicit undo handler reference:
```typescript
undoable?: boolean | {
  handler: string;  // Name of undo command (validates it exists)
};
```

---

## SUGGESTIONS (Take or Leave)

### 1. Use Frozen Default Object

Prevent accidental mutation of defaults:
```typescript
const defaultExpose: Readonly<ExposeOptions> = Object.freeze({
  palette: true,
  agent: true,
  mcp: false,
  cli: false,
});
```

---

### 2. Consider Stricter Type for ExposeOptions

Current proposal uses optional booleans with runtime defaults. Safer alternative:

```typescript
// Option A: Required fields (compile-time safety)
interface ExposeOptions {
  palette: boolean;
  mcp: boolean;
  agent: boolean;
  cli: boolean;
}

// Option B: Discriminated union for common presets
type ExposeOptions =
  | { preset: 'public' }        // palette + agent
  | { preset: 'internal' }      // palette only
  | { preset: 'automation' }    // cli + mcp
  | { custom: { palette?: boolean; mcp?: boolean; agent?: boolean; cli?: boolean } };
```

---

### 3. Undo Fields Location in CommandResult

Proposal adds top-level fields:
```typescript
interface CommandResult<T> {
  undoCommand?: string;
  undoArgs?: Record<string, unknown>;
}
```

Consider nesting under existing `metadata` to reduce interface pollution:
```typescript
interface ResultMetadata {
  // ... existing fields
  undo?: {
    command: string;
    args: Record<string, unknown>;
  };
}
```

Pro: Keeps core result shape minimal
Con: Less discoverable in TypeScript autocomplete

---

### 4. Add Headless Detection Helper

For consumers to adapt behavior:
```typescript
// In CommandContext or utility module
function isHeadlessContext(ctx: CommandContext): boolean {
  return ctx.interface === 'cli' || ctx.interface === 'mcp';
}
```

Allows commands to adjust output format (no ANSI in CLI, structured JSON for MCP).

---

### 5. Consider Tag-Based Exposure Alternative

Existing tag infrastructure could handle exposure:
```typescript
// Instead of:
expose: { mcp: true, cli: true }

// Could use:
tags: ['@expose:mcp', '@expose:cli']

// Filter with existing method:
registry.listByTags(['@expose:mcp'], 'any');
```

**Trade-off:** Less type-safe but reuses existing infrastructure.

---

## OUT OF SCOPE (Noted, Not Actioned)

- **UI rendering of undo hints** — FAST-AF layer concern, not AFD core
- **Actual undo implementation mechanics** — Consumer-specific per proposal design
- **Agent behavior around undo prompting** — Agent layer concern
- **Command palette filtering UI** — FAST-AF feature
- **MCP tool description augmentation** — Implementation detail

---

## Integration Assessment

### With `command-trust-config` (IMPLEMENTED)

**Status:** Clean extension

The proposal correctly builds on existing patterns:
```typescript
// Already in ZodCommandOptions (packages/server/src/schema.ts)
destructive?: boolean;
confirmPrompt?: string;

// Proposed additions follow same pattern
undoable?: boolean;
expose?: ExposeOptions;
```

Same location (`ZodCommandOptions`), same optional boolean pattern.

### Headless Compatibility

**Status:** Strong

Proposal explicitly designs for headless:
- `undoCommand` + `undoArgs` enable serializable undo (no closures)
- `expose.mcp` and `expose.cli` provide per-interface control
- Registry filtering works without UI layer

**Gap:** Missing explicit `interface` field in `CommandContext` to detect caller.

---

## Recommendation

**REVISE REQUIRED**

Address the three blockers before implementation:
1. Align `list()` filter API with existing method patterns
2. Specify behavior when command invoked on non-exposed interface
3. Add validation mechanism for undo capability claims

Suggestions are discretionary improvements that would strengthen the design.

---

## Appendix: Files Researched

| File | Lines | Relevance |
|------|-------|-----------|
| `packages/core/src/commands.ts` | 101-174, 204-281, 656-693 | CommandDefinition, Registry, commandToMcpTool |
| `packages/core/src/result.ts` | 27-118 | CommandResult interface |
| `packages/server/src/schema.ts` | ZodCommandOptions | Existing trust config pattern |
| `packages/core/src/commands.test.ts` | 6-175 | Tag filtering test patterns |
| `packages/client/src/direct.ts` | 213-247 | DirectRegistry interface |
