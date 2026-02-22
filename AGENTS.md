# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Documentation Policy**: Skills are the source of truth for detailed knowledge.
> This file is a routing table. See [afd skill](skills/afd/) for core AFD patterns.

## Build & Test Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm -F @lushly-dev/afd-core build
pnpm -F @lushly-dev/afd-server build
pnpm -F @lushly-dev/afd-client build
pnpm -F @lushly-dev/afd-adapters build
pnpm -F @lushly-dev/afd-auth build

# Run all tests
pnpm test

# Run tests for specific package
pnpm -F @lushly-dev/afd-core test
pnpm -F @lushly-dev/afd-server test
pnpm -F @lushly-dev/afd-auth test

# Run single test file
cd packages/server && pnpm vitest run src/server.test.ts

# Run tests in watch mode
pnpm -F @lushly-dev/afd-server test:watch

# Lint and format
pnpm lint          # Check with Biome
pnpm lint:fix      # Fix lint issues
pnpm format        # Format code

# Type checking
pnpm typecheck
```

## Architecture Overview

AFD (Agent-First Development) is a methodology where AI agents are first-class users. The architecture follows **Command-First**: all functionality is exposed as commands before any UI is built.

### Package Structure

```
packages/
├── core/       # @lushly-dev/afd-core - Foundational types
├── server/     # @lushly-dev/afd-server - MCP server factory
├── client/     # @lushly-dev/afd-client - MCP client + DirectClient
├── auth/       # @lushly-dev/afd-auth - Provider-agnostic auth adapter
├── cli/        # @lushly-dev/afd-cli - Command-line tool
├── testing/    # @lushly-dev/afd-testing - JTBD scenario runner + surface validation
├── adapters/   # @lushly-dev/afd-adapters - Frontend adapters for rendering CommandResult
└── examples/
    ├── todo/                # Multi-stack example (TS, Python, Rust backends)
    └── todo-directclient/   # DirectClient + AI integration example

python/
├── src/afd/              # Python AFD package (pip install afd)
│   ├── core/             # CommandResult, errors, metadata
│   ├── server/           # FastMCP-based server factory
│   └── lushx_ext/        # Lushx extension (auto-registered)
└── tests/

alfred/                   # AFD quality bot (deterministic compliance checks)
├── src/alfred/           # 3 commands: lint, parity, quality
└── tests/                # 22 tests
```

### Alfred (Quality Bot)

Deterministic architecture compliance checks so agents skip expensive reasoning. Three commands available via CLI (`alfred <cmd>`), MCP server, and botcore plugin:

- **`alfred lint`** — Validates AFD architecture rules (6 lint rules across Python/TS/Rust)
- **`alfred parity`** — Detects API surface drift between TypeScript, Python, and Rust packages
- **`alfred quality`** — Checks command description quality (length, imperative voice, duplicates)

See [alfred/AGENTS.md](alfred/AGENTS.md) for full command reference, lint rules, and development setup.

### Lushx Extension

The Python package includes a lushx extension that auto-registers when `afd` is pip-installed:

```bash
# Install AFD (extension auto-registers)
pip install -e python

# Run AFD linter in any repo
lushx dev afd-lint
```

**Lint rules provided:**
| Rule | Language | Description |
|------|----------|-------------|
| `afd-command-result` | Python, Rust | Handlers must return CommandResult |
| `afd-actionable-errors` | Python | error() calls need suggestion param |
| `afd-no-direct-fetch` | Python, TS | No fetch/axios in UI components |
| `afd-kebab-naming` | TypeScript | Command names must be kebab-case |
| `afd-no-business-in-ui` | TypeScript | No data transforms in components |
| `afd-layer-imports` | All | UI can't import from services directly |

### Core Types (`@lushly-dev/afd-core`)

The foundation - defines types used everywhere:

- **CommandResult<T>**: Standard result with `success`, `data`, `error`, plus UX fields (`confidence`, `reasoning`, `warnings`)
- **CommandError**: Error with `code`, `message`, `suggestion` for actionable recovery
- **CommandDefinition**: Full command schema with trust metadata (`destructive`, `confirmPrompt`, `undoable`, `expose`)
- **ExposeOptions**: Interface exposure control (`palette`, `mcp`, `agent`, `cli`) with secure defaults
- **PipelineRequest/PipelineResult**: Multi-step command chaining with variable resolution
- **HandoffResult**: Protocol handoff for real-time connections (WebSocket, SSE)
- **BatchResult**: Batch execution with aggregated confidence
- **Platform Utils**: Cross-platform `exec()`, `findUp()`, connectors (`GitHubConnector`, `PackageManagerConnector`)

```typescript
// Always return CommandResult from handlers
return success(data, { confidence: 0.95, reasoning: 'Cache hit' });
return failure({ code: 'NOT_FOUND', message: '...', suggestion: 'Try...' });
```

### Server Package (`@lushly-dev/afd-server`)

Builds MCP servers from Zod-defined commands:

```typescript
import { defineCommand, createMcpServer, defaultMiddleware, success } from '@lushly-dev/afd-server';

const myCommand = defineCommand({
  name: 'domain-action',  // kebab-case naming
  description: 'What it does',
  input: z.object({ ... }),
  mutation: false,  // true for state-changing commands
  async handler(input, context) {
    return success(result, { reasoning: 'why' });
  },
});

const server = createMcpServer({
  name: 'my-server',
  version: '1.0.0',
  commands: [myCommand],
  middleware: defaultMiddleware(),  // Trace IDs, logging, slow-command warnings
  transport: 'auto',  // 'stdio' | 'http' | 'auto'
});
```

### Client Package (`@lushly-dev/afd-client`)

Two client types:

1. **McpClient**: For network communication (SSE/HTTP)
2. **DirectClient**: Zero-overhead in-process execution (~0.01ms vs 2-10ms)

```typescript
// DirectClient for co-located agents
const client = new DirectClient(registry);
const result = await client.call<Todo>('todo-create', { title: 'Fast!' });

// Pipeline execution
const result = await client.pipe([
  { command: 'user-get', input: { id: 1 }, as: 'user' },
  { command: 'order-list', input: { userId: '$prev.id' } },
]);
```

### Data Flow

```
Command Definition (Zod schema + handler)
         ↓
    MCP Server (validates input, executes handler)
         ↓
    CommandResult (success/failure + metadata)
         ↓
    Client (McpClient or DirectClient)
```

## Key Conventions

### Command Naming
- Use `domain-action` format: `todo-create`, `user-get`, `order-list`
- Commands are kebab-case, not dot-separated

### CommandResult Fields
- **Required**: `success`, `data` or `error`
- **Recommended**: `reasoning` (explains what happened), `confidence` (0-1)
- **Errors**: Always include `suggestion` for recovery guidance
- **Mutations**: Include `warnings` for side effects

### Testing Pattern
- Tests use Vitest with explicit imports (not globals)
- Place tests in `src/**/*.test.ts`
- Use `describe`/`it`/`expect` from 'vitest'

### Biome Linting
- Tab indentation, single quotes, trailing commas (es5)
- `noExplicitAny: error` - avoid `any` types
- `useImportType: error` - use `import type { ... }` for type-only imports
- `noUnusedImports: error`, `noUnusedVariables: error`
- `useNodejsImportProtocol: error` - use `node:` prefix for Node.js builtins

## Pipeline Variable Resolution

When working with pipelines, these variables are available:

| Variable | Resolves to |
|----------|-------------|
| `$prev` | Previous step output |
| `$prev.field` | Specific field from previous |
| `$first` | First step output |
| `$steps[n]` | Step at index n |
| `$steps.alias` | Step by alias name |
| `$input` | Original pipeline input |

## Skill Index

| Skill | When to Use |
|-------|-------------|
| [afd](skills/afd/) | Core AFD patterns, command design, workflow |
| [afd-developer](skills/afd-developer/) | AFD philosophy, honesty check, define-validate-surface |
| [afd-python](skills/afd-python/) | Python implementation with Pydantic, FastMCP |
| [afd-typescript](skills/afd-typescript/) | TypeScript patterns, Zod tips |
| [afd-rust](skills/afd-rust/) | Rust implementation patterns |
| [afd-auth](skills/afd-auth/) | Auth adapter, middleware, commands, session sync, React hooks |
| [afd-directclient](skills/afd-directclient/) | In-process command execution, pipe() pipelines |
| [afd-contracts](skills/afd-contracts/) | TypeSpec-based contract system for multi-layer API schema sync |

## Related Documentation

- **docs/specs/**: Specifications for handoff, pipelines, etc.
- All guides have been migrated to skills (see Skill Index above)
