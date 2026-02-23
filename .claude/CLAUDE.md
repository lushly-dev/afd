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
pnpm -F @lushly-dev/afd-cli build
pnpm -F @lushly-dev/afd-testing build

# Run all tests
pnpm test

# Run tests for specific package
pnpm -F @lushly-dev/afd-core test
pnpm -F @lushly-dev/afd-server test
pnpm -F @lushly-dev/afd-client test
pnpm -F @lushly-dev/afd-auth test
pnpm -F @lushly-dev/afd-testing test

# Run single test file
cd packages/server && pnpm vitest run src/server.test.ts

# Run tests in watch mode
pnpm -F @lushly-dev/afd-server test:watch

# Run tests with coverage
pnpm test:coverage

# Lint and format
pnpm lint          # Check with Biome
pnpm lint:fix      # Fix lint issues
pnpm format        # Format code

# Type checking
pnpm typecheck

# Quality gate (all checks)
pnpm check

# Python tests (alfred)
cd alfred && uv run pytest tests/ -v

# Python tests (afd)
cd python && pip install -e ".[dev]" && pytest tests/ -v
```

## Engine Requirements

- **Node.js**: >=20.0.0
- **pnpm**: >=9.0.0 (packageManager: pnpm@10.30.1)
- **Python**: >=3.10 (afd package), >=3.11 (alfred)
- **TypeScript**: ~5.9.x (strict mode, ES2022 target, NodeNext modules)

## Git Hooks (Lefthook)

Lefthook manages git hooks. Installed automatically via `pnpm install` (prepare script).

| Hook | Commands | Trigger |
|------|----------|--------|
| pre-commit | Biome lint (staged), portability, file-size, typecheck | `git commit` |
| commit-msg | commitlint (conventional commits) | `git commit` |
| pre-push | Full lint, test, typecheck, portability, file-size, orphan-files | `git push` |
| check | All pre-push + build | `npx lefthook run check` |

All hooks run **sequentially** (not parallel) to prevent terminal buffer deadlocks on Windows.

**Check scripts** (`scripts/`):

| Script | What it checks |
|--------|---------------|
| `check-file-size.mjs` | Warn >300, error >500 lines. Escape: `// afd-override: max-lines=N` (cap 1000) |
| `check-portability.mjs` | Machine-specific paths (drive letters, user homes). Escape: `// portability-ok: reason` |
| `check-orphan-files.mjs` | Unreferenced `.ts` files across packages (warning only) |

Skip hooks: `git commit --no-verify` / `git push --no-verify`

### Conventional Commits

Commit messages are validated by commitlint. Required format: `type(scope): subject`

**Allowed types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`

**Allowed scopes**: `core`, `server`, `client`, `auth`, `cli`, `testing`, `adapters`, `examples`, `alfred`, `python`, `rust`, `deps`

- Subject max 72 characters, no period at end
- No sentence-case, start-case, pascal-case, or upper-case subjects
- Unscoped commits are also valid

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `ci.yml` | Push to main, PRs to main | Lint, typecheck, build, test with coverage on Node 20.x and 22.x |
| `release.yml` | Push to main | Changesets-based release — creates version PR or publishes to npm |
| `publish-python.yml` | GitHub Release or `python-v*` tag | Tests, builds, and publishes Python package to PyPI via OIDC |

### Release Pipeline

- **TypeScript packages**: Changesets (`pnpm changeset`) manages versioning. All `@lushly-dev/*` packages are in a fixed version group.
- **Python package**: Tagged releases with `python-v*` pattern. Uses PyPI Trusted Publishing (OIDC).

## Architecture Overview

AFD (Agent-First Development) is a methodology where AI agents are first-class users. The architecture follows **Command-First**: all functionality is exposed as commands before any UI is built.

### Package Structure

```
packages/
├── core/       # @lushly-dev/afd-core      v0.1.1 - Foundational types and utilities
├── server/     # @lushly-dev/afd-server     v0.1.1 - MCP server factory (Zod + middleware)
├── client/     # @lushly-dev/afd-client     v0.1.1 - MCP client + DirectClient
├── auth/       # @lushly-dev/afd-auth       v0.1.0 - Provider-agnostic auth adapter
├── cli/        # @lushly-dev/afd-cli        v0.1.1 - Command-line tool
├── testing/    # @lushly-dev/afd-testing    v0.1.1 - JTBD scenario runner + surface validation
├── adapters/   # @lushly-dev/afd-adapters   v0.1.1 - Frontend adapters for CommandResult
├── rust/       # afd (crate)                v0.1.0 - Core types for Rust (native + WASM)
└── examples/
    ├── chat/                # Handoff pattern demo (WebSocket real-time chat)
    ├── showcase/            # Feature demos (auth, middleware, pipelines, expose/trust)
    ├── todo/                # Multi-stack example (TS, Python, Rust backends)
    └── todo-directclient/   # DirectClient + AI integration example

python/                      # Python AFD package (pip install afd) v0.2.0
├── src/afd/
│   ├── core/                # CommandResult, errors, metadata, pipeline, handoff
│   ├── server/              # FastMCP-based server factory with decorators
│   ├── transports/          # Transport layer (base, FastMCP, mock)
│   ├── testing/             # Assertions and fixtures
│   ├── cli/                 # Click-based CLI
│   ├── lushx_ext/           # Lushx extension (auto-registered linters)
│   └── direct.py            # Direct client
└── tests/

alfred/                      # AFD quality bot v0.1.0
├── src/alfred/
│   ├── commands/            # lint, parity, quality
│   ├── cli.py               # Click CLI
│   ├── plugin.py            # Botcore plugin (auto-discovered)
│   └── mcp_server.py        # MCP server entry point
└── tests/                   # 22 tests
```

### Workspace Configuration

The pnpm workspace (`pnpm-workspace.yaml`) includes:
- `packages/*` — all core packages
- `packages/examples/_shared/*` — shared example utilities
- `packages/examples/chat` — chat example
- `packages/examples/todo/backends/*` and `frontends/*` — todo backends/frontends
- `packages/examples/todo-directclient/backend` — directclient example
- `packages/examples/showcase/backend` — showcase demos

### Alfred (Quality Bot)

Deterministic architecture compliance checks so agents skip expensive reasoning. Three commands available via CLI (`alfred <cmd>`), MCP server, and botcore plugin:

- **`alfred lint`** — Validates AFD architecture rules (6 lint rules across Python/TS/Rust)
- **`alfred parity`** — Detects API surface drift between TypeScript, Python, and Rust packages
- **`alfred quality`** — Checks command description quality (length, imperative voice, duplicates)

Alfred is configured as an MCP server in `.claude/mcp.json` (runs via `uv`).

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

The foundation — defines types used across all packages:

- **CommandResult<T>**: Standard result with `success`, `data`, `error`, plus UX fields (`confidence`, `reasoning`, `warnings`)
- **CommandError**: Error with `code`, `message`, `suggestion` for actionable recovery
- **CommandDefinition**: Full command schema with trust metadata (`destructive`, `confirmPrompt`, `undoable`, `expose`)
- **ExposeOptions**: Interface exposure control (`palette`, `mcp`, `agent`, `cli`) with secure defaults
- **PipelineRequest/PipelineResult**: Multi-step command chaining with variable resolution and conditions
- **HandoffResult**: Protocol handoff for real-time connections (WebSocket, SSE)
- **BatchResult**: Batch execution with aggregated confidence
- **StreamChunk**: Streaming results with progress feedback (data, progress, error, complete chunks)
- **TelemetryEvent/TelemetrySink**: Observability types
- **Platform Utils**: Cross-platform `exec()`, `findUp()`, `normalizePath()`, OS detection (`isWindows`, `isMac`, `isLinux`)
- **Connectors**: `GitHubConnector` (issues, PRs), `PackageManagerConnector` (npm/pnpm/yarn)

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

**Key exports**: `defineCommand`, `createMcpServer`, `defaultMiddleware`, `success`, `failure`, validation utilities (`validateInput`, `validateOrThrow`, `patterns`), middleware factories (`createLoggingMiddleware`, `createRateLimitMiddleware`, `createRetryMiddleware`, `createTracingMiddleware`, `createTelemetryMiddleware`), bootstrap commands (`getBootstrapCommands`), handoff schemas.

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

### Auth Package (`@lushly-dev/afd-auth`)

Provider-agnostic authentication adapter with:

- **AuthAdapter interface**: Discriminated union session states
- **Auth middleware**: For auth-gated commands
- **React hooks**: `useAuth()` hook via `@lushly-dev/afd-auth/react` export
- **Session sync**: Multi-tab session synchronization
- **Provider support**: Convex Auth, Better Auth (both optional peer deps)

### Testing Package (`@lushly-dev/afd-testing`)

- **JTBD scenario runner**: Job-to-be-done test scenarios
- **Surface validation**: Semantic quality analysis, schema complexity scoring
- **Assertions and fixtures**: Test helpers for CommandResult validation

### Rust Package (`packages/rust/`)

Core AFD types implemented in Rust with dual target support:

- **Native**: Full `tokio` async runtime
- **WASM**: `wasm-bindgen` for browser/edge deployment
- Mirrors core TypeScript types: `CommandResult`, `CommandError`, `Pipeline`, `Handoff`, `Batch`, `Streaming`

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
- Validated by `validateCommandName()` and `afd-kebab-naming` lint rule

### CommandResult Fields
- **Required**: `success`, `data` or `error`
- **Recommended**: `reasoning` (explains what happened), `confidence` (0-1)
- **Errors**: Always include `suggestion` for recovery guidance
- **Mutations**: Include `warnings` for side effects

### Testing Pattern
- Tests use Vitest with explicit imports (not globals)
- Place tests in `src/**/*.test.ts`
- Use `describe`/`it`/`expect` from 'vitest'
- Python tests use pytest with pytest-asyncio (`asyncio_mode = "auto"`)
- Rust tests use `#[tokio::test]` with `pretty_assertions`

### Biome Linting

Configuration in `biome.json`:

**Formatter**:
- Tab indentation, line width 100, LF line endings
- Single quotes, trailing commas (es5), semicolons always

**Linter rules** (all `error` unless noted):
- `noExplicitAny` — avoid `any` types
- `noImplicitAnyLet` — no untyped `let` declarations
- `useImportType` — use `import type { ... }` for type-only imports
- `noUnusedImports`, `noUnusedVariables` — clean imports
- `useNodejsImportProtocol` — use `node:` prefix for Node.js builtins
- `noNonNullAssertion` — no `!` assertions
- `noConfusingVoidType` — no confusing `void` usage
- `noArrayIndexKey` — no array index as React key
- `useConst` — prefer `const` over `let`
- `useLiteralKeys` — prefer literal object keys
- `useExhaustiveDependencies` — React hooks deps (`warn`)
- **a11y**: `noStaticElementInteractions`, `useKeyWithClickEvents`, `noLabelWithoutControl`
- **security**: `noDangerouslySetInnerHtml`

**Excluded from Biome**: `node_modules`, `dist`, `*.plan.md`, `_generated`, `alfred/`

### TypeScript Configuration

Root `tsconfig.json` settings:
- `target`: ES2022, `module`: NodeNext, `moduleResolution`: NodeNext
- `strict`: true, `noUncheckedIndexedAccess`: true
- `verbatimModuleSyntax`: true — enforces explicit `import type`
- `declaration`: true, `declarationMap`: true, `sourceMap`: true
- All packages extend root config

### Python Configuration

**Ruff** (linter): line-length 100, selects E, F, I, N, W, UP, B, C4, SIM
**mypy**: strict mode, Python 3.10 target
**pytest**: asyncio auto mode, tests in `tests/`, src in `src/`

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

- **docs/features/**: Feature lifecycle — `proposed/`, `active/`, `complete/`
- **docs/whitepaper/**: AFD Whitepaper
- **alfred/AGENTS.md**: Alfred quality bot command reference
