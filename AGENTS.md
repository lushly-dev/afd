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
│   ├── command-schema-guide.md      # How to design commands for good UX
│   ├── trust-through-validation.md  # Why CLI validation builds trust
│   ├── implementation-phases.md     # 4-phase implementation roadmap
│   └── production-considerations.md # Security, observability, mutation safety
├── packages/
│   ├── core/                        # Core types (CommandResult, errors, etc.)
│   ├── server/                      # Zod-based MCP server factory
│   ├── client/                      # MCP client library (Node.js)
│   ├── cli/                         # AFD command-line tool
│   ├── testing/                     # Test utilities for command validation
│   └── examples/
│       └── todo-app/                # Complete working example
├── Agentic AI UX Design Principles/ # Reference: UX framework (for PMs/designers)
├── AGENTS.md                        # This file - AI agent context
├── README.md                        # Human-readable overview
└── package.json
```

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
  confidence?: number;      // 0-1, enables confidence indicators
  reasoning?: string;       // Explains "why", enables transparency
  sources?: Source[];       // Attribution for verification
  plan?: PlanStep[];        // Multi-step visibility
  alternatives?: Alternative<T>[];  // Other options considered
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

## Related Resources

- **MCP** - Model Context Protocol (current agent communication standard)
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
