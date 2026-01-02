# AFD - Agent-First Development

A methodology and toolkit for building software where AI agents are first-class users.

> **"The best UI is no UI."** — AFD makes this UX principle achievable.

## Philosophy: UX Design for AI Collaborators

AFD treats AI agents the way UX designers treat human users: as collaborators deserving thoughtful, friction-free experiences.

Traditional apps are **opaque to AI**—capabilities locked behind visual interfaces, state hidden in UI components, features that only work through mouse clicks. An LLM with terminal access is like a brilliant engineer who can only interact through a keyhole.

**AFD inverts this.** Commands ARE the application. The UI becomes optional—a view layer that can be swapped, simplified, or removed entirely as AI handles more of the "understanding intent" work.

This enables:
- **Fearless experimentation** — Change UI radically without touching business logic
- **Future-proof architecture** — Same commands work for CLI, GUI, chat, voice, whatever comes next
- **Human-AI collaboration** — Shared command language both can understand and verify
- **Reductive design** — Systematically remove UI friction as AI capabilities grow

📖 **[Read the full philosophy →](./docs/philosophy.md)**

---

## The Problem

Traditional software development treats agent/API access as an afterthought:

```
Traditional Flow:
  Build UI → Extract API → Expose to Agents (maybe)
```

This leads to:
- Inconsistent behavior between UI and agent interactions
- Features that only work through the UI
- Agents that can't fully utilize the software
- Fragile integrations that break when UI changes

## The Solution: Agent-First Development

AFD inverts the development flow:

```
Agent-First Flow:
  Define Commands → Validate via CLI → Build UI Surface
```

**The command layer IS the product.** UI is just one of many possible surfaces.

## Core Principles

### 1. Command-First

All application functionality is exposed as **commands** (tools) with well-defined schemas:

```typescript
// Every action is a command
const createDocument = {
  name: 'document.create',
  description: 'Creates a new document',
  schema: {
    title: { type: 'string', required: true },
    content: { type: 'string', required: false }
  },
  handler: async (args) => { /* ... */ }
};
```

### 2. CLI Validation

Before building any UI, validate commands work via CLI:

```bash
# Test the command directly
afd call document.create --title "My Document"

# Verify it worked
afd call document.list
```

If it doesn't work via CLI, **don't build UI for it**.

### 3. The Honesty Check

> "If it can't be done via CLI, the architecture is wrong."

The CLI becomes a quality gate:
- Forces proper abstraction
- Ensures all actions are centralized
- Prevents UI-only code paths
- Enables automation and testing

### 4. Dual Interface

The same commands power both humans and agents:

### 5. UX-Enabling Schemas

Commands should return data that enables good agent UX:

```typescript
interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: CommandError;
  
  // UX-enabling fields
  confidence?: number;      // Enables confidence indicators
  reasoning?: string;       // Enables transparency ("why did the agent do this?")
  sources?: Source[];       // Enables source attribution
  plan?: PlanStep[];        // Enables plan visualization
  alternatives?: T[];       // Enables user choice
}
```

See [Command Schema Guide](./docs/command-schema-guide.md) for detailed patterns.

```
┌─────────────────────────────────────────────────┐
│              Command Registry                    │
│  (Single source of truth for all actions)       │
└─────────────────────────────────────────────────┘
        ▲               ▲               ▲
        │               │               │
   ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
   │   UI    │    │   CLI   │    │   MCP   │
   │ (Human) │    │ (Dev)   │    │ (Agent) │
   └─────────┘    └─────────┘    └─────────┘
```

## Development Workflow

**Per-Command Workflow** (repeat for each feature):

```
┌─────────────────────────────────────────────────┐
│  Step 1: DEFINE                                 │
│  • Create command with schema                   │
│  • Register in command registry                 │
│  • Document inputs, outputs, side effects       │
├─────────────────────────────────────────────────┤
│  Step 2: VALIDATE                               │
│  • Test via CLI: afd call <command>             │
│  • Cover edge cases and error states            │
│  • Add automated tests (Vitest)                 │
│  • ⛔ Do NOT proceed until CLI works            │
├─────────────────────────────────────────────────┤
│  Step 3: SURFACE                                │
│  • Build UI component that invokes command      │
│  • UI is a thin wrapper, not business logic     │
│  • Integration test (Playwright)                │
└─────────────────────────────────────────────────┘
```

> **Note**: This is the per-command workflow. For the full 4-phase **project implementation roadmap** (Foundation → Expansion → Refinement → Ecosystem), see [Implementation Phases](./docs/implementation-phases.md).

## Why "Agent-First"?

The term **"Agent"** is intentionally technology-agnostic:

- **MCP** (Model Context Protocol) is today's standard
- **Function Calling** is another approach
- **Future protocols** will emerge

But the concept of an **autonomous agent** that can use your software remains constant—just like "Person" describes a human regardless of what tools they use.

By designing for agents first, your software automatically becomes:
- API-first (agents need APIs)
- Well-documented (agents need schemas)
- Testable (agents need predictable behavior)
- Automatable (agents ARE automation)

## Enabling Good Agent UX

AFD isn't just about making software work for agents—it's about enabling **good** agent experiences. Well-designed commands build user trust:

| UX Principle | How AFD Enables It |
|--------------|-------------------|
| **Competence Trust** | CLI-validated commands prove reliability |
| **Transparency** | Commands return `reasoning` and `sources` |
| **Plan Visibility** | Commands return `plan` with steps |
| **Confidence Calibration** | Commands return `confidence` scores |
| **Control & Intervention** | Commands are atomic, cancellable units |
| **Error Recovery** | Commands have standardized, actionable errors |

See [Trust Through Validation](./docs/trust-through-validation.md) for the full trust framework.

## Getting Started

### Installation

```bash
# Install globally (once published to npm)
npm install -g @afd/cli

# Or run from source
git clone https://github.com/Falkicon/afd.git
cd afd
pnpm install
pnpm build
node packages/cli/dist/bin.js --help
```

### Connect to an MCP Server

```bash
# Connect to a running MCP server
afd connect http://localhost:3100/sse

# List available commands
afd tools

# Call a command
afd call document.create '{"title": "Test"}'
```

### Validate Your Commands

```bash
# Run validation suite
afd validate

# Validate specific category
afd validate --category document
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `afd connect <url>` | Connect to an MCP server |
| `afd disconnect` | Disconnect from server |
| `afd status` | Show connection status |
| `afd tools` | List available tools |
| `afd tools --category <name>` | Filter tools by category |
| `afd call <tool> [args]` | Call a tool with JSON args |
| `afd validate` | Run command validation |
| `afd shell` | Interactive mode |

## Comparison

| Approach | Development Flow | Agent Access | Testing |
|----------|------------------|--------------|---------|
| **UI-First** | UI → API → Agents | Afterthought | E2E only |
| **API-First** | API → UI, Agents | Better | API + E2E |
| **Agent-First** | Commands → CLI → UI | Native | Command + CLI + E2E |

## Documentation

| Guide | Description |
|-------|-------------|
| [Philosophy](./docs/philosophy.md) | **Why** AFD — UX design for AI collaborators |
| [Command Schema Guide](./docs/command-schema-guide.md) | How to design commands that enable good agent UX |
| [Trust Through Validation](./docs/trust-through-validation.md) | How CLI validation builds user trust |
| [Implementation Phases](./docs/implementation-phases.md) | 4-phase roadmap for AFD projects |
| [Production Considerations](./docs/production-considerations.md) | Security, mutation safety, and observability guidance |

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@afd/core`](./packages/core) | Core types (CommandResult, CommandError, MCP) | ✅ Complete |
| [`@afd/server`](./packages/server) | Zod-based MCP server factory | ✅ Complete |
| [`@afd/client`](./packages/client) | MCP client library with SSE/HTTP transports | ✅ Complete |
| [`@afd/testing`](./packages/testing) | JTBD scenario testing with MCP agent integration | ✅ Complete |
| [`@afd/cli`](./packages/cli) | Command-line interface | ✅ Complete |

## Examples

| Example | Description |
|---------|-------------|
| [Todo App](./packages/examples/todo-app) | Complete working example with CLI, MCP server, and web UI |

## Testing

AFD emphasizes testability at every layer. Run the full test suite:

```bash
pnpm test
```

### Test Categories

| Category | Purpose | Location |
|----------|---------|----------|
| **Unit Tests** | Command logic correctness | `**/commands/__tests__/commands.test.ts` |
| **Performance Tests** | Response time baselines | `**/commands/__tests__/performance.test.ts` |
| **AFD Compliance** | CommandResult structure validation | Included in unit tests |

### Performance Testing

Performance tests establish baselines and detect regressions:

```bash
# Run with performance summary
pnpm test

# Example output:
# 📊 Performance Summary
# Command             Duration    Threshold   Status
# todo.create         0.85ms      10ms        ✓
# todo.list           8.7ms       20ms        ✓
```

Commands are tested in isolation (no network, no database) to measure pure business logic performance. See [Performance Testing Guide](./packages/examples/todo-app/src/commands/__tests__/performance.test.ts) for patterns.

## Roadmap

- [x] Methodology documentation
- [x] Command schema guide
- [x] Trust framework documentation
- [x] Implementation phases guide
- [x] CLI tool (`@afd/cli`)
- [x] MCP client library (`@afd/client`)
- [x] MCP server library (`@afd/server`)
- [x] Core types (`@afd/core`)
- [x] Testing utilities (`@afd/testing`)
- [x] Example implementations
- [x] Performance testing framework
- [ ] VS Code extension
- [ ] npm publish

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

For AI agents contributing to this repo, see [AGENTS.md](AGENTS.md).

## License

MIT - see [LICENSE](LICENSE)
