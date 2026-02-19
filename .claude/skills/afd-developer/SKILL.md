---
name: afd-developer
description: >
  Agent-First Development methodology for building software where AI agents are
  first-class users. Covers command design, CLI validation, MCP servers,
  CommandResult schemas, testing strategies, and the core AFD philosophy.
  Use when: building agent-ready apps, designing commands, integrating MCP,
  understanding AFD patterns, or following the command-first workflow.
  Triggers: agent-first, AFD, command-first, MCP server, CommandResult,
  CLI validation, afd call, honesty check, define-validate-surface.
---

# Agent-First Development (AFD)

Expert guidance for building software with the Agent-First Development methodology.

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Philosophy, UX design for agents, "why AFD" | [references/philosophy.md](references/philosophy.md) |
| Trust, CLI validation rationale, honesty check | [references/trust-validation.md](references/trust-validation.md) |
| Implementation phases, checklists, anti-patterns | [references/implementation-phases.md](references/implementation-phases.md) |
| Production: security, observability, mutation safety | [references/production-considerations.md](references/production-considerations.md) |

## Core Philosophy

**"The best UI is no UI"** - AFD inverts traditional development where UI is built first. Instead:

```
Traditional:  UI -> API -> Agent Access (afterthought)
Agent-First:  Commands -> Validation -> UI (surface)
```

### The Honesty Check

> "If it can't be done via CLI, the architecture is wrong."

This principle ensures:
- No UI-only code paths
- All business logic lives in command handlers
- UI is a thin wrapper over commands
- Same commands power both human UI and agent interactions

## Development Workflow

```
+---------------------------------------------+
|  1. DEFINE                                  |
|  - Create command with Zod/Pydantic schema  |
|  - Define inputs, outputs, error codes      |
|  - Register in command registry             |
+---------------------------------------------+
              |
              v
+---------------------------------------------+
|  2. VALIDATE                                |
|  - Test via CLI: afd call <command>         |
|  - DO NOT proceed until CLI works           |
|  - Add automated tests                      |
+---------------------------------------------+
              |
              v
+---------------------------------------------+
|  3. SURFACE                                 |
|  - Build UI that calls command              |
|  - Use metadata for UX (confidence, etc.)   |
|  - Integration testing                      |
+---------------------------------------------+
```

## Command Structure

### Naming Convention

Format: `domain-action` (lowercase, hyphen-separated)

```
Good:                    Bad:
todo-create              createTodo (not namespaced)
user-authenticate        todo_create (wrong separator)
document-search          TodoCreate (not lowercase)
todo.create              (dots not compatible with all MCP clients)
```

### CommandResult Schema

Commands return structured results with UX-enabling metadata:

```typescript
interface CommandResult<T> {
  // Core fields (required)
  success: boolean;
  data?: T;
  error?: CommandError;

  // UX-enabling fields (recommended)
  confidence?: number;      // 0-1, for reliability indicators
  reasoning?: string;       // Explain "why" to users
  warnings?: Warning[];     // Alert to side effects
  suggestions?: string[];   // Guide next steps
  sources?: Source[];       // Attribution for verification
  plan?: PlanStep[];        // Multi-step visibility
  alternatives?: Alt<T>[];  // Other options considered
}
```

### Error Structure

Errors must be actionable:

```typescript
interface CommandError {
  code: string;           // e.g., 'NOT_FOUND', 'VALIDATION_ERROR'
  message: string;        // Human-readable description
  suggestion?: string;    // How to recover
  retryable?: boolean;    // Can the operation be retried?
}
```

### Standard Error Codes

| Code | When to use |
|------|-------------|
| `NOT_FOUND` | Resource doesn't exist |
| `VALIDATION_ERROR` | Input fails schema validation |
| `FORBIDDEN` | User lacks permission |
| `CONFLICT` | Resource state prevents action |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected server error |
| `NO_CHANGES` | Update had nothing to change |

## CLI Commands

```bash
# Connect to MCP server
afd connect http://localhost:3100/sse

# List available commands
afd tools

# Call a command
afd call todo-create '{"title": "Test", "priority": "high"}'

# Interactive shell
afd shell
```

## AFD Packages

| Package | Purpose |
|---------|---------|
| `@afd/core` | Core types (CommandResult, CommandError) |
| `@afd/server` | Zod-based MCP server factory |
| `@afd/client` | MCP client with SSE/HTTP transports |
| `@afd/testing` | Test validators, JTBD scenarios |
| `@afd/cli` | Command-line interface |

## When Adding Features

1. **Define the command first** - Create the tool definition with clear schema
2. **Test via CLI** - Validate it works before any UI work
3. **Document the command** - Add to tool registry with description

## When Fixing Bugs

1. **Reproduce via CLI** - Can you trigger the bug without UI?
2. **Fix at command layer** - The fix should work for both agents and humans
3. **Verify via CLI** - Confirm fix works before checking UI

## Testing Strategy

| Layer | Tool | Purpose |
|-------|------|---------|
| Unit | Vitest | Test handler logic in isolation |
| Validation | Vitest | Test schemas accept/reject |
| Performance | Vitest | Baseline response times |
| AFD Compliance | Vitest | Verify CommandResult structure |
| Integration | Vitest | Test command -> store flow |
| E2E | Playwright | Test UI -> command -> response |

## Related Skills

- `afd-typescript` - TypeScript implementation patterns
- `afd-python` - Python implementation patterns
- `afd-rust` - Rust implementation patterns
- `pr-review` - PR review using AFD standards
- `commit-messages` - Conventional commit format

## Resources

- [Philosophy](references/philosophy.md) - UX design for AI collaborators
- [Trust Through Validation](references/trust-validation.md) - Why CLI validation matters
- [Implementation Phases](references/implementation-phases.md) - Phased rollout with checklists
- [Production Considerations](references/production-considerations.md) - Security, observability, mutation safety
