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

## Repository Structure

```
afd/
├── docs/
│   ├── philosophy.md                # Why AFD: UX design for AI collaborators
│   ├── command-schema-guide.md      # How to design commands for good UX
│   ├── trust-through-validation.md  # Why CLI validation builds trust
│   ├── implementation-phases.md     # 4-phase implementation roadmap
│   └── production-considerations.md # Security, observability, mutation safety
├── packages/
│   ├── core/                        # Core types (CommandResult, errors, etc.)
│   ├── server/                      # Zod-based MCP server factory
│   ├── client/                      # MCP client library (Node.js)
│   ├── cli/                         # AFD command-line tool
│   ├── testing/                     # Test utilities + JTBD scenario runner
│   └── examples/
│       └── todo/                    # Multi-stack Todo example (TS + Python)
│           ├── scenarios/           # JTBD scenario YAML files
│           └── fixtures/            # Pre-seeded test data (JSON)
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
