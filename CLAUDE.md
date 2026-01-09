# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Run all tests
pnpm test

# Run tests for specific package
pnpm -F @lushly-dev/afd-core test
pnpm -F @lushly-dev/afd-server test

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
├── cli/        # @lushly-dev/afd-cli - Command-line tool
├── testing/    # @lushly-dev/afd-testing - JTBD scenario runner
└── examples/
    ├── todo/                # Multi-stack example (TS, Python, Rust backends)
    └── todo-directclient/   # DirectClient + AI integration example
```

### Core Types (`@lushly-dev/afd-core`)

The foundation - defines types used everywhere:

- **CommandResult<T>**: Standard result with `success`, `data`, `error`, plus UX fields (`confidence`, `reasoning`, `warnings`)
- **CommandError**: Error with `code`, `message`, `suggestion` for actionable recovery
- **PipelineRequest/PipelineResult**: Multi-step command chaining with variable resolution
- **HandoffResult**: Protocol handoff for real-time connections (WebSocket, SSE)
- **BatchResult**: Batch execution with aggregated confidence

```typescript
// Always return CommandResult from handlers
return success(data, { confidence: 0.95, reasoning: 'Cache hit' });
return failure({ code: 'NOT_FOUND', message: '...', suggestion: 'Try...' });
```

### Server Package (`@lushly-dev/afd-server`)

Builds MCP servers from Zod-defined commands:

```typescript
import { defineCommand, createMcpServer, success } from '@lushly-dev/afd-server';

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
- Tab indentation, single quotes, trailing commas
- `noExplicitAny: error` - avoid `any` types
- `useImportType: error` - use `import type { ... }` for type-only imports

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

## Related Documentation

- **AGENTS.md**: Comprehensive AI agent context and patterns
- **docs/philosophy.md**: Why AFD exists
- **docs/command-schema-guide.md**: Command design patterns
- **docs/specs/**: Specifications for handoff, pipelines, etc.
