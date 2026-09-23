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

1. **Command Design** — Define commands with typed schemas, proper error handling, and UX-enabling metadata
2. **CLI Validation** — Test commands via CLI before building UI
3. **MCP Integration** — Set up MCP servers and connect clients
4. **Testing** — Unit tests, performance tests, AFD compliance checks, and surface validation
5. **Functional Parity** — Prefer shared AFD capabilities and agent-visible behavior over literal package symmetry; keep the command layer framework-agnostic
6. **Ecosystem Integration Boundaries** — Keep UI/framework integrations in examples or ecosystem layers rather than the core AFD surface

## Routing Logic

| Request type | Load reference |
|--------------|----------------|
| Command schemas, typed schema patterns | [references/command-design.md](references/command-design.md) |
| CommandResult interface, UX fields, batch patterns | [references/command-schema.md](references/command-schema.md) |
| MCP server setup, transports, embeddable Node handler | [references/mcp-integration.md](references/mcp-integration.md) |
| Testing commands, performance | [references/testing.md](references/testing.md) |
| CLI usage, validation workflow | [references/cli-validation.md](references/cli-validation.md) |
| Command tags, bootstrap tools, tool strategies | [references/command-taxonomy.md](references/command-taxonomy.md) |
| Output schemas, context scoping | [references/command-design.md](references/command-design.md) |
| Lazy discovery, `afd-call`, context management | [references/mcp-integration.md](references/mcp-integration.md) |
| Real-time protocols, WebSocket | [references/handoff-pattern.md](references/handoff-pattern.md) |
| JTBD scenarios, fixtures | [references/jtbd-scenarios.md](references/jtbd-scenarios.md) |
| Telemetry middleware, sinks, monitoring | [references/telemetry.md](references/telemetry.md) |
| defaultMiddleware, auto trace ID, logging/timing defaults | [references/telemetry.md](references/telemetry.md) |
| External adapters, CLI/API bridging | [references/external-adapters.md](references/external-adapters.md) |
| Destructive commands, confirmation UI | [references/command-trust-config.md](references/command-trust-config.md) |
| Interface exposure, undo metadata | [references/command-exposure-undo.md](references/command-exposure-undo.md) |
| Cross-platform exec, connectors | [references/platform-utils.md](references/platform-utils.md) |
| Command prerequisites, `requires` field | [references/command-schema.md](references/command-schema.md) |
| Surface validation, semantic quality | [references/surface-validation.md](references/surface-validation.md) |

### Functional Parity Rule

When comparing implementations across TypeScript, Python, and Rust, treat parity as a shared capability contract, not a promise that every API or module name will match exactly.

- Core AFD surfaces MUST stay framework-agnostic.
- React or browser integrations SHOULD live in examples or ecosystem layers.
- Cross-language implementations MAY choose idiomatic signatures, schemas, or module boundaries when that better fits the host language.
- New features SHOULD be judged first by whether they change agent-visible behavior, then by whether they belong in the shared AFD surface.
- Shared parity examples include output schemas, validated examples, prerequisite metadata, context scoping, grouped/lazy tool strategies, and meta-tools such as `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, and `afd-detail`.

## Core Principles

### 1. Command-First Development

All functionality is exposed as commands before any UI is built:

```typescript
// Step 1: Define command
const createItem = defineCommand({
  name: 'item-create',
  expose: { mcp: true }, // Commands are private unless exposed; MCP clients need this opt-in
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

TypeScript is shown here for brevity, but the command-first workflow is the invariant. Python uses Pydantic-based command definitions and Rust uses JSON Schema-backed command definitions while preserving the same agent-facing contract.

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
| Rich command metadata | Add `output` / `output_schema`, `requires`, `contexts`, and `examples` |
| Large command surfaces | Use `individual`, `grouped`, or `lazy` tool strategies |
| Lazy agent workflow | `afd-discover -> afd-detail -> afd-call` |
| Runtime dispatch | `afd-call`, `afd-batch`, `afd-pipe`, `afd-discover`, `afd-detail` |
| Context scoping | `afd-context-list`, `afd-context-enter`, `afd-context-exit` |
| Create standalone MCP server | `const server = createMcpServer({ commands }); await server.start()` |
| Embed MCP into existing Node host | `const handler = createMcpHandler({ commands })` |

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
| `@lushly-dev/afd-core` | Core types (CommandResult, CommandError, validateCommandName) |
| `@lushly-dev/afd-server` | Zod-based MCP server factory |
| `@lushly-dev/afd-client` | MCP client with SSE/HTTP transports + DirectClient |
| `@lushly-dev/afd-testing` | JTBD scenario runner, surface validation, test validators |
| `@lushly-dev/afd-adapters` | Frontend adapters for rendering CommandResult |
| `@lushly-dev/afd-view-state` | Ecosystem-level UI view state management via commands; not part of the core cross-language parity surface |
| `@lushly-dev/afd-cli` | Command-line interface |
| `@lushly-dev/local-db` | Async data adapter with swappable backends (Memory, HTTP) |

## When to Escalate

- Complex multi-step agent workflows (refer to MCP documentation)
- Real-time streaming responses (WebSocket transport)
- Authentication/authorization for commands (refer to security expert)

## Resources

- **AFD Repository**: https://github.com/lushly-dev/afd
- **Example App**: `packages/examples/todo/`
