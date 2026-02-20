---
name: afd
description: >
  Agent-First Development (AFD) patterns for building software where AI agents
  are first-class users. Covers command design, CLI validation, MCP servers,
  CommandResult schemas, and testing strategies. Use when building agent-ready
  apps, designing commands, or integrating MCP.
version: "2.0.0"
category: core
triggers:
  - agent-first
  - AFD
  - command-first
  - MCP server
  - CommandResult
  - CLI validation
  - afd call
---

# Agent-First Development (AFD)

Expert guidance for building software with the Agent-First Development methodology.

## Capabilities

1. **Command Design** — Define commands with Zod schemas, proper error handling, and UX-enabling metadata
2. **CLI Validation** — Test commands via CLI before building UI
3. **MCP Integration** — Set up MCP servers and connect clients
4. **Testing** — Unit tests, performance tests, and AFD compliance checks
5. **FAST Element Integration** — Connect commands to FAST Element components

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Command schemas, Zod patterns | [references/command-design.md](references/command-design.md) |
| CommandResult interface, UX fields, batch patterns | [references/command-schema.md](references/command-schema.md) |
| MCP server setup, transports | [references/mcp-integration.md](references/mcp-integration.md) |
| Testing commands, performance | [references/testing.md](references/testing.md) |
| CLI usage, validation workflow | [references/cli-validation.md](references/cli-validation.md) |
| Command tags, bootstrap tools | [references/command-taxonomy.md](references/command-taxonomy.md) |
| Real-time protocols, WebSocket | [references/handoff-pattern.md](references/handoff-pattern.md) |
| JTBD scenarios, fixtures | [references/jtbd-scenarios.md](references/jtbd-scenarios.md) |
| Telemetry middleware, sinks, monitoring | [references/telemetry.md](references/telemetry.md) |
| External adapters, CLI/API bridging | [references/external-adapters.md](references/external-adapters.md) |
| Destructive commands, confirmation UI | [references/command-trust-config.md](references/command-trust-config.md) |
| Interface exposure, undo metadata | [references/command-exposure-undo.md](references/command-exposure-undo.md) |
| Cross-platform exec, connectors | [references/platform-utils.md](references/platform-utils.md) |

## Core Principles

### 1. Command-First Development

All functionality is exposed as commands before any UI is built:

```typescript
// Step 1: Define command
const createItem = defineCommand({
  name: 'item-create',
  input: z.object({ title: z.string().min(1) }),
  async handler(input) {
    const item = await store.create(input);
    return success(item, { reasoning: `Created "${item.title}"` });
  },
});

// Step 2: Validate via CLI
// afd call item-create '{"title": "Test"}'

// Step 3: Build UI (only after CLI works)
```

### 2. The Honesty Check

> "If it can't be done via CLI, the architecture is wrong."

- No UI-only code paths
- All business logic in command handlers
- UI is a thin wrapper

### 3. UX-Enabling Schemas

Commands return metadata that enables good agent UX:

```typescript
interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: CommandError;
  
  // UX-enabling fields
  confidence?: number;      // 0-1, for reliability indicators
  reasoning?: string;       // Explain "why" to users
  warnings?: Warning[];     // Alert to side effects
  suggestions?: string[];   // Guide next steps
}
```

### 4. Structured Errors

Errors include recovery guidance:

```typescript
return error('NOT_FOUND', `Item ${id} not found`, {
  suggestion: 'Use item.list to see available items',
});
```

## Quick Reference

| Task | Pattern |
|------|---------|
| Define command | `defineCommand({ name, input, handler })` |
| Success response | `success(data, { reasoning, confidence })` |
| Error response | `error(code, message, { suggestion })` |
| Test via CLI | `afd call <command> '<json>'` |
| List commands | `afd tools` |
| Create MCP server | `createMcpServer({ commands }).listen(port)` |

## Development Workflow

```
┌─────────────────────────────────────────────────┐
│  1. DEFINE                                      │
│  • Create command with Zod schema               │
│  • Define inputs, outputs, error codes          │
├─────────────────────────────────────────────────┤
│  2. VALIDATE                                    │
│  • Test via CLI: afd call <command>             │
│  • ⛔ Do NOT proceed until CLI works            │
├─────────────────────────────────────────────────┤
│  3. SURFACE                                     │
│  • Build UI that calls command                  │
│  • Use metadata for UX (confidence, reasoning)  │
└─────────────────────────────────────────────────┘
```

## AFD Packages

| Package | Purpose |
|---------|---------|
| `@lushly-dev/afd-core` | Core types (CommandResult, CommandError) |
| `@lushly-dev/afd-server` | Zod-based MCP server factory |
| `@lushly-dev/afd-client` | MCP client with SSE/HTTP transports |
| `@lushly-dev/afd-testing` | Test validators and helpers |
| `@lushly-dev/afd-cli` | Command-line interface |

## When to Escalate

- Complex multi-step agent workflows (refer to MCP documentation)
- Real-time streaming responses (WebSocket transport)
- Authentication/authorization for commands (refer to security expert)

## Resources

- **AFD Repository**: https://github.com/lushly-dev/afd
- **Example App**: `packages/examples/todo/`
