# Agent-First Development (AFD) - AI Agent Context

> **For AI Agents**: This document provides context for understanding and contributing to the AFD project.

## What is AFD?

**Agent-First Development** is a software development methodology where AI agents are treated as first-class users from day one. Instead of building UI first and adding API/agent access later, AFD inverts this:

```
Traditional:  UI → API → Agent Access (afterthought)
Agent-First:  Commands → Validation → UI (surface)
```

## Core Philosophy

**"Agent" is like "Person"** - The underlying technology (MCP, function calling, etc.) will evolve, but the concept of an autonomous agent remains constant. AFD is technology-agnostic by design.

**"The best UI is no UI"** - AFD applies UX design thinking to AI agents. Traditional apps are opaque to AI—capabilities locked behind visual interfaces. AFD inverts this: commands ARE the application, UI is just one possible surface. This enables fearless UI experimentation, future-proof architecture, and true human-AI collaboration.

📖 See [docs/philosophy.md](./docs/philosophy.md) for the full vision.

## Key Principles

1. **Command-First** - All functionality is exposed as commands/tools before any UI is built
2. **CLI Validation** - Commands are tested via CLI before investing in UI development
3. **Honesty Check** - If it can't be done via CLI, the architecture is wrong
4. **Dual Interface** - Same commands power both human UI and agent interactions
5. **UX-Enabling Schemas** - Commands return data that enables good agent experiences

## Command Taxonomy

AFD commands use a **tag-based classification system** for filtering, grouping, and permission control.

### Standard Tags

| Category | Tags | Purpose |
|----------|------|---------|
| **Entity** | `todo`, `user`, `document` | Groups commands by domain |
| **Action** | `create`, `read`, `update`, `delete`, `list`, `toggle` | CRUD operations |
| **Scope** | `single`, `batch` | One item vs. multiple |
| **Risk** | `destructive`, `safe` | Warns agents about irreversible actions |
| **Access** | `bootstrap`, `admin`, `public` | Permission filtering |

### Example Usage

```typescript
defineCommand({
  name: 'todo-delete',
  category: 'todo',
  tags: ['todo', 'delete', 'write', 'single', 'destructive'],
  mutation: true,
  // ...
});
```

### Bootstrap Tools

Every AFD MCP server exposes three bootstrap tools for agent onboarding:

| Tool | Description |
|------|-------------|
| `afd-help` | List commands with tag/category filtering |
| `afd-docs` | Generate markdown documentation |
| `afd-schema` | Export JSON schemas for all commands |

```typescript
import { getBootstrapCommands } from '@afd/server';
const bootstrapCmds = getBootstrapCommands(() => myCommands);
```

### MCP Tool Strategy

Control how commands appear in IDE tool lists:

```typescript
createMcpServer({
  name: 'my-app',
  commands: [/* ... */],
  toolStrategy: 'individual', // 'grouped' (default) | 'individual'
});
```

- **grouped** (default): Commands consolidated by category (cleaner IDE UX)
- **individual**: Each command = separate MCP tool (more precise schemas)

## VS Code MCP Configuration

The Todo example includes three backend implementations (TypeScript, Python, Rust). Configure them in `.vscode/mcp.json`:

```jsonc
{
  "mcpServers": {
    // TypeScript backend (stdio transport - auto-starts)
    "afd-todo-ts": {
      "command": "node",
      "args": ["packages/examples/todo/backends/typescript/dist/server.js"],
      "disabled": false
    },
    
    // Python backend (stdio transport - auto-starts)
    "afd-todo-python": {
      "command": "python",
      "args": ["-m", "todo_backend"],
      "cwd": "packages/examples/todo/backends/python",
      "disabled": true
    },
    
    // Rust backend (HTTP/SSE transport - requires manual server start)
    "afd-todo-rust": {
      "url": "http://127.0.0.1:3100/sse",
      "disabled": true
    }
  }
}
```

### Transport Types

| Backend | Transport | Auto-Start | Notes |
|---------|-----------|------------|-------|
| TypeScript | stdio | ✅ Yes | VS Code spawns the Node process |
| Python | stdio | ✅ Yes | VS Code spawns Python |
| Rust | HTTP/SSE | ❌ No | Must run `cargo run -- server` first |

### Switching Backends

1. **Enable ONE backend** at a time (they share the same tool names)
2. **Reload VS Code** after changes (Command Palette → "MCP: Restart Servers")
3. **For Rust**: Start the server manually before enabling

> **Important**: Only enable one todo backend at a time. All three expose identical tool names (`todo-create`, `todo-list`, etc.), so having multiple enabled causes conflicts.

### Transport Selection Guide

Choose the right transport based on your deployment scenario:

| Transport | Latency | Use When |
|-----------|---------|----------|
| **Direct** | ~0.01ms | Agent and app share the same runtime (tests, embedded agents) |
| **stdio** | ~10-50ms | IDE integration, local development |
| **HTTP/SSE** | ~20-100ms | Network communication, multi-process, production |

#### Direct Transport (In-Process)

When your agent runs in the same Node.js/Bun process as the application, use `DirectClient` for zero-overhead execution:

```typescript
import { DirectClient } from '@afd/client';
import { registry } from '@my-app/commands';

const client = new DirectClient(registry);
const result = await client.call<Todo>('todo-create', { title: 'Fast!' });
// ~0.03ms vs 2-10ms for MCP
```

**Best for**: Embedded AI agents (e.g., Gemini, OpenAI running in your Node process).

**Trade-offs**: No process isolation, same runtime required, registry must be importable.

**When to use DirectClient**:
- ✅ LLM is co-located in the same process as your app
- ✅ Agent makes many sequential tool calls (each saves ~2-10ms)
- ❌ Not for tests (GitHub Actions, IDE) — use CLI/MCP instead
- ❌ Not for remote agents — use HTTP/SSE

**Security**: When exposing DirectClient over HTTP, apply hardening:
- CORS lockdown, rate limiting, input validation, API key masking

📖 See [DirectClient Guide](./docs/directclient-guide.md) for implementation details.

📌 See `packages/examples/todo-directclient` for a complete AI Copilot example.

## Repository Structure

```
afd/
├── docs/
│   ├── philosophy.md                # Why AFD: UX design for AI collaborators
│   ├── command-schema-guide.md      # How to design commands for good UX
│   ├── trust-through-validation.md  # Why CLI validation builds trust
│   ├── implementation-phases.md     # 4-phase implementation roadmap
│   ├── production-considerations.md # Security, observability, mutation safety
│   └── directclient-guide.md        # DirectClient: when to use, security, hardening
├── packages/
│   ├── core/                        # Core types (CommandResult, errors, etc.)
│   ├── server/                      # Zod-based MCP server factory
│   ├── client/                      # MCP client + DirectClient
│   ├── cli/                         # AFD command-line tool
│   ├── testing/                     # Test utilities + JTBD scenario runner
│   └── examples/
│       ├── todo/                    # Multi-stack Todo example
│       │   ├── backends/
│       │   │   ├── typescript/      # Node.js + @afd/server (stdio)
│       │   │   ├── python/          # Python + FastMCP (stdio)
│       │   │   └── rust/            # Axum + HTTP/SSE transport
│       │   ├── frontends/
│       │   │   ├── vanilla/         # Vanilla JS frontend
│       │   │   └── react/           # React frontend
│       │   ├── scenarios/           # JTBD scenario YAML files
│       │   └── fixtures/            # Pre-seeded test data (JSON)
│       └── todo-directclient/       # DirectClient + AI Copilot example
│           ├── backend/             # Chat server with Gemini integration
│           └── frontend/            # Chat UI with tool execution display
├── Agentic AI UX Design Principles/ # Reference: UX framework (for PMs/designers)
├── AGENTS.md                        # This file - AI agent context
├── README.md                        # Human-readable overview
└── package.json
```

## Conformance Testing

AFD promotes **Spec-First Development**. We use a shared conformance suite to ensure multiple implementations (e.g., TS and Python) behave identically.

```bash
# Run conformance tests for the Todo example
cd packages/examples/todo
npx tsx dx/run-conformance.ts ts  # Test TypeScript backend
npx tsx dx/run-conformance.ts py  # Test Python backend
```

## JTBD Scenario Testing

Test user journeys through YAML scenario files with fixtures and step references.

### Scenario File Structure

```yaml
# scenarios/create-and-complete-todo.scenario.yaml
scenario:
  name: "Create and complete a todo"
  tags: ["smoke", "crud"]

setup:
  fixture:
    file: "fixtures/seeded-todos.json"

steps:
  - name: "Create todo"
    command: todo.create
    input:
      title: "Buy groceries"
    expect:
      success: true
      data:
        title: "Buy groceries"

  - name: "Complete todo"
    command: todo.toggle
    input:
      id: "${{ steps[0].data.id }}"  # Reference previous step
    expect:
      success: true
```

### Step References

Reference data from previous steps: `${{ steps[N].data.path }}`

```yaml
steps:
  - name: "Create"
    command: todo.create
    input: { title: "Test" }
    # Result: { data: { id: "todo-123" } }

  - name: "Update"
    command: todo.update
    input:
      id: "${{ steps[0].data.id }}"    # → "todo-123"
      title: "Updated"
```

### Fixtures

Pre-seed test data before scenario execution:

```json
// fixtures/seeded-todos.json
{
  "app": "todo",
  "clearFirst": true,
  "todos": [
    { "title": "Existing todo", "priority": "high" }
  ]
}
```

### Running Scenarios

```bash
# Via conformance runner
npx tsx dx/run-conformance.ts ts

# Programmatically
import { parseScenario, InProcessExecutor } from '@afd/testing';
const scenario = parseScenario(yaml);
const result = await executor.run(scenario);
```

### Dry Run Validation

Validate scenarios without executing them:

```typescript
import { validateScenario } from '@afd/testing';

const validation = validateScenario(scenario, {
  availableCommands: ['todo.create', 'todo.get'],
});

if (!validation.valid) {
  console.error(validation.errors);
  // ["Unknown command 'todo.unknown' in step 3"]
}
```

### Error Messages

Failed assertions show expected vs actual values:

```
"2 assertions failed: data.total: expected 99, got 2; data.completed: expected true, got false"
```

### Scenario Commands (Phase 2)

Batch operations for managing JTBD scenarios:

```typescript
import {
  scenarioList,
  scenarioEvaluate,
  scenarioCoverage,
  scenarioCreate,
} from '@afd/testing';

// List all scenarios with filtering
const list = await scenarioList({
  directory: './scenarios',
  job: 'todo-management',
  tags: ['smoke'],
});

// Batch evaluate with parallel execution
const result = await scenarioEvaluate({
  handler: myCommandHandler,
  directory: './scenarios',
  concurrency: 4,
  format: 'junit',
  output: './test-results.xml',
});
console.log(`Exit code: ${result.data.exitCode}`);

// Calculate coverage against known commands
const coverage = await scenarioCoverage({
  directory: './scenarios',
  knownCommands: ['todo.create', 'todo.list', 'todo.delete'],
});
console.log(`Coverage: ${coverage.data.summary.commands.coverage}%`);

// Create scenario from template
const created = await scenarioCreate({
  name: 'todo-crud',
  job: 'Manage todos',
  template: 'crud',  // Generates create/read/update/delete steps
  directory: './scenarios',
});
```

### Agent Integration (Phase 3)

MCP server and AI-friendly hints for agent integration:

```typescript
import { createMcpTestingServer, scenarioSuggest } from '@afd/testing';

// Create MCP server exposing all scenario commands
const server = createMcpTestingServer({
  handler: async (command, input) => registry.execute(command, input),
});

// AI-powered scenario suggestions
const suggestions = await scenarioSuggest({
  context: 'changed-files',
  files: ['src/commands/todo/create.ts'],
});

// Results include _agentHints for AI interpretation
console.log(suggestions.data._agentHints);
// { shouldRetry: false, nextSteps: [...], interpretationConfidence: 0.9 }
```

### App Adapters (Phase 4)

Adapters enable the framework to work with different AFD applications:

```typescript
import { registerAdapter, detectAdapter, todoAdapter, createGenericAdapter } from '@afd/testing';

// Register built-in adapter
registerAdapter(todoAdapter);

// Create custom adapter for your app
const myAdapter = createGenericAdapter('myapp', {
  commands: ['myapp.create', 'myapp.list'],
  errors: ['NOT_FOUND', 'VALIDATION_ERROR'],
});
registerAdapter(myAdapter);

// Auto-detect adapter from fixture
const fixture = { app: 'todo', todos: [] };
const adapter = detectAdapter(fixture);
```

See `packages/testing/README.md` for full documentation.

## How to Use AFD CLI

```bash
# Connect to any MCP server
afd connect <url>

# List available tools/commands
afd tools

# Call a specific tool
afd call <tool-name> [arguments]

# Run command validation suite
afd validate

# Interactive shell mode
afd shell
```

## Development Workflow

When contributing to or using AFD methodology:

```
1. DEFINE
   - Create CommandDefinition
   - Define schema (inputs/outputs)
   - Register in command registry

2. VALIDATE
   - Test via afd call <command>
   - Verify all edge cases
   - Add automated tests

3. SURFACE
   - Build UI component (optional)
   - UI invokes the same command
   - Integration testing
```

## For AI Agents Working on This Repo

### When Adding Features

1. **Define the command first** - Create the tool definition with clear schema
2. **Test via CLI** - Validate it works before any UI work
3. **Document the command** - Add to tool registry with description

### When Fixing Bugs

1. **Reproduce via CLI** - Can you trigger the bug without UI?
2. **Fix at command layer** - The fix should work for both agents and humans
3. **Verify via CLI** - Confirm fix works before checking UI

### Code Conventions

- Commands are the source of truth
- UI components are thin wrappers that invoke commands
- All state mutations happen through commands
- Commands return structured results (success/failure + data)

### Command Schema Design

When creating commands, include UX-enabling fields:

```typescript
interface CommandResult<T> {
  // Required
  success: boolean;
  data?: T;
  error?: { code: string; message: string; suggestion?: string };

  // Recommended for AI-powered commands
  confidence?: number; // 0-1, enables confidence indicators
  reasoning?: string; // Explains "why", enables transparency
  sources?: Source[]; // Attribution for verification
  plan?: PlanStep[]; // Multi-step visibility
  alternatives?: Alternative<T>[]; // Other options considered
}

// Alternative type for consistency
interface Alternative<T> {
  data: T;
  reason: string;
  confidence?: number;
}
```

**Why this matters**: These fields enable good agent UX:

- `confidence` → User knows when to trust vs. verify
- `reasoning` → User understands agent decisions
- `sources` → User can verify information
- `plan` → User sees what will happen before it happens

See [docs/command-schema-guide.md](./docs/command-schema-guide.md) for detailed patterns.

## Lessons Learned (Real-World Implementation)

These lessons come from implementing AFD in:

- **[Violet Design](https://github.com/Falkicon/dsas)** — Hierarchical design token management (TypeScript, 24 commands)
- **[Noisett](https://github.com/Falkicon/Noisett)** — AI image generation (Python, 19 commands, **5 surfaces**)

### Multi-Surface Validation (Noisett)

**Achievement**: Noisett serves the same 19 commands through **5 different surfaces**:

| Surface      | Technology   | Backend Changes |
| ------------ | ------------ | --------------- |
| CLI          | Python Click | —               |
| MCP          | FastMCP      | —               |
| REST API     | FastAPI      | —               |
| Web UI       | Vanilla JS   | —               |
| Figma Plugin | TypeScript   | **Zero** ✅     |

The Figma plugin (Phase 7) required **zero backend changes** — it calls the same `/api/generate` and `/api/jobs/{id}` endpoints. This validates AFD's core promise: commands are the app, surfaces are interchangeable.

**Key Insight**: The "honesty check" (can it be done via CLI?) proved correct. Before building the Figma plugin, we verified the CLI could generate images. Since it could, adding another surface was trivial.

### TypeScript + Zod Generics

**Challenge**: `CommandDefinition<TSchema, TOutput>` typing with optional fields and defaults.

**Problem**: Zod distinguishes between `z.input<>` (what you pass in) and `z.output<>` (after transforms/defaults applied). Optional fields with `.default()` exist in output but not necessarily in input.

```typescript
// ❌ Wrong - handler receives raw input, not parsed
async handler(input: z.output<typeof InputSchema>) {
  // input.priority might be undefined!
}

// ✅ Correct - parse inside handler to apply defaults
async handler(rawInput: z.input<typeof InputSchema>) {
  const input = InputSchema.parse(rawInput);
  // input.priority is guaranteed to have default value
}
```

### Zod Union Ordering Matters

**Challenge**: Complex union schemas can match unexpectedly.

**Problem**: A permissive object schema in a union can match and strip properties from objects that should fall through to later union members.

```typescript
// ❌ Wrong - platform schema matches any object, strips unknown props
const TokenValueSchema = z.union([
  z.string(),
  z.object({ web: z.string().optional(), ios: z.string().optional() }),
  z.record(z.string(), z.unknown()), // Never reached for objects
]);

// ✅ Correct - strict mode + refinement prevents over-matching
const TokenValueSchema = z.union([
  z.string(),
  z
    .object({ web: z.string().optional(), ios: z.string().optional() })
    .strict()
    .refine((obj) => obj.web || obj.ios, "Need at least one platform"),
  z.record(z.string(), z.unknown()), // Now correctly catches other objects
]);
```

### Registry Type Constraints

**Challenge**: Generic command registry that stores different command types.

**Problem**: TypeScript's variance rules make it hard to store `CommandDefinition<SpecificSchema, SpecificOutput>` in a `Map<string, CommandDefinition<any, any>>`.

```typescript
// ✅ Solution - use 'any' internally, cast at boundaries
class CommandRegistry {
  private commands = new Map<string, CommandDefinition<any, any>>();

  register<TSchema extends z.ZodType, TOutput>(
    command: CommandDefinition<TSchema, TOutput>
  ) {
    this.commands.set(command.name, command as CommandDefinition<any, any>);
  }

  async execute<TOutput>(
    name: string,
    input: unknown
  ): Promise<CommandResult<TOutput>> {
    const command = this.commands.get(name);
    return command.handler(input) as CommandResult<TOutput>;
  }
}
```

### CLI-First Benefits

The "honesty check" worked exactly as intended:

- Bugs discovered via `violet node create --name test` before any UI existed
- Schema issues surfaced during `pnpm test` cycles
- 89 tests catch regressions before UI development starts

### Key Takeaways

1. **Parse inside handlers** - Don't trust TypeScript to know Zod has applied defaults
2. **Order unions carefully** - Most specific schemas first, most permissive last
3. **Use `.strict()` on objects** - Prevents silent property stripping
4. **Test with complex data** - Object values, nested structures, edge cases
5. **Type boundaries** - Use `any` internally, cast at API boundaries

## Related Resources

- **MCP** - Model Context Protocol (current agent communication standard)
- **[Philosophy](./docs/philosophy.md)** - Why AFD: UX design for AI collaborators
- **[Command Schema Guide](./docs/command-schema-guide.md)** - Detailed command design patterns
- **[Trust Through Validation](./docs/trust-through-validation.md)** - Why CLI validation matters
- **[Implementation Phases](./docs/implementation-phases.md)** - 4-phase roadmap for AFD projects
- **[Production Considerations](./docs/production-considerations.md)** - Security, mutation safety, observability

## Contributing

AI agents are encouraged to:

1. Propose new commands via issues/PRs
2. Improve command schemas for better agent usability
3. Add examples showing AFD patterns
4. Enhance documentation for both humans and agents
