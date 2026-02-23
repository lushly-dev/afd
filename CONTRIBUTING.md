# Contributing to AFD

AFD (Agent-First Development) is a methodology where AI agents are first-class users. Everything in this repo follows **Command-First** design: all functionality is exposed as commands with schemas before any UI is built. If you're contributing, you're building for agents — not just humans.

## Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0
- **Python** >= 3.10 (for the Python package and Alfred)
- **Lefthook** (auto-installed via `pnpm install`)

## Getting Started

```bash
git clone https://github.com/lushly-dev/afd.git
cd afd
pnpm install   # Installs deps + Lefthook git hooks
pnpm build     # Build all packages
pnpm test      # Run all tests
```

For the Python package:

```bash
cd python
pip install -e ".[dev]"
pytest tests/ -v
```

For Alfred (quality bot):

```bash
cd alfred
uv pip install -e ".[dev]"
uv run alfred lint        # Architecture compliance
uv run alfred parity      # Cross-language API sync
uv run alfred quality     # Command description quality
```

## Core Principles

Every contribution should follow these patterns:

### 1. Commands Return `CommandResult`

All handlers — TypeScript, Python, and Rust — must return `CommandResult`:

```typescript
return success(data, { confidence: 0.95, reasoning: 'Cache hit' });
return failure({ code: 'NOT_FOUND', message: '...', suggestion: 'Try...' });
```

### 2. Errors Include `suggestion`

Every error must include a `suggestion` field so agents can self-recover. Alfred's `afd-actionable-errors` lint rule enforces this.

### 3. Commands Use `domain-action` Naming

Commands are kebab-case in `domain-action` format: `todo-create`, `user-get`, `order-list`. Alfred's `afd-kebab-naming` rule enforces this in TypeScript.

### 4. No Business Logic in UI

Data transforms (`.map().filter()`, `.reduce()`, `Math.*`) belong in command handlers, not UI components. Alfred's `afd-no-business-in-ui` rule catches violations.

## How to Add a Command

The most common contribution is adding or modifying commands. Use `defineCommand()` with a Zod schema:

```typescript
import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';

const myCommand = defineCommand({
  name: 'domain-action',
  description: 'Imperative verb description (10-120 chars)',
  input: z.object({ /* ... */ }),
  mutation: false,  // true for state-changing commands
  async handler(input, context) {
    return success(result, { reasoning: 'why this result' });
  },
});
```

After adding commands, run `alfred quality` to validate description quality (imperative voice, length, no near-duplicates).

## Multi-Language Parity

AFD ships implementations in TypeScript, Python, and Rust. TypeScript is the source of truth for the API surface. When adding exports to `packages/core/src/index.ts`, mirror them in:

- **Python**: `python/src/afd/__init__.py` (`__all__` list)
- **Rust**: `packages/rust/src/lib.rs` (`pub use` re-exports)

Run `alfred parity` to detect drift. The tool normalizes naming conventions (camelCase ↔ snake_case) across languages.

## Quality Gates

### Lefthook Git Hooks

Lefthook runs automatically on commit and push — no manual setup needed.

**Pre-commit** (every commit):
- Biome lint + auto-fix on staged `.ts`/`.js`/`.json` files
- Portability check (no machine-specific paths)
- File size check (warn >300 lines, error >500)
- TypeScript type checking

**Pre-push** (before push):
- Full lint, test suite, typecheck
- Portability + file size on all files
- Orphan file detection (`.ts` files not imported anywhere)

**Commit messages** are validated by commitlint (Conventional Commits).

### On-Demand Check

Run the full quality gate manually:

```bash
npx lefthook run check   # Lint + typecheck + test + build + portability + file-size + orphans
```

### Alfred Quality Bot

Alfred provides deterministic architecture compliance — agents and humans skip expensive manual review:

| Command | What it checks |
|---------|----------------|
| `alfred lint` | 6 AFD architecture rules (CommandResult, actionable errors, kebab naming, no-fetch-in-UI, no-business-in-UI, layer imports) |
| `alfred parity` | API surface sync across TypeScript, Python, and Rust |
| `alfred quality` | Command description quality (length, imperative voice, duplicates) |

## Development Workflow

### Building

```bash
pnpm build                          # All packages
pnpm -F @lushly-dev/afd-core build  # Specific package
```

### Testing

```bash
pnpm test                                          # All tests
pnpm -F @lushly-dev/afd-core test                  # Specific package
cd packages/server && pnpm vitest run src/server.test.ts  # Single file
pnpm -F @lushly-dev/afd-server test:watch          # Watch mode
```

Tests use Vitest with explicit imports (`describe`, `it`, `expect` from `'vitest'`). Place tests in `src/**/*.test.ts`.

### Linting & Formatting

[Biome](https://biomejs.dev/) handles both linting and formatting:

```bash
pnpm lint       # Check
pnpm lint:fix   # Auto-fix
pnpm format     # Format
pnpm typecheck  # Type check
```

## Code Style

Enforced by Biome — most issues auto-fix on save or commit:

- **Indentation**: Tabs
- **Quotes**: Single quotes
- **Trailing commas**: ES5 style
- **Line width**: 100 characters
- **Imports**: `import type { ... }` for type-only imports (`useImportType: "error"`)
- **Node builtins**: `node:` prefix required (`useNodejsImportProtocol: "error"`)
- **No `any`**: `noExplicitAny: "error"` — use proper types
- **No unused**: `noUnusedImports` and `noUnusedVariables` are errors

## Commit Messages

Enforced by commitlint. Use [Conventional Commits](https://www.conventionalcommits.org/) with scoped types:

```
feat(core): add pipeline timeout support
fix(server): handle empty input validation
docs(python): update command naming guide
chore(deps): update dependencies
```

**Allowed scopes**: `core`, `server`, `client`, `auth`, `cli`, `testing`, `adapters`, `examples`, `alfred`, `python`, `rust`, `deps`

## Submitting Changes

1. Fork the repository and create a branch from `main`
2. Make changes following the principles above
3. Verify locally:
   - `pnpm lint` — no lint errors
   - `pnpm test` — all tests pass
   - `pnpm build` — builds cleanly
   - `alfred lint` — no architecture violations (if adding commands)
4. Push and open a pull request

### PR Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality
- Update documentation if behavior changes — see `AGENTS.md` for the routing table and `skills/` for deep topic guides
- All Lefthook hooks must pass

## Package Structure

```
packages/
  core/       # Foundational types (CommandResult, errors, pipeline, handoff)
  server/     # MCP server factory with Zod validation + middleware
  client/     # MCP client + DirectClient (zero-overhead in-process)
  auth/       # Provider-agnostic auth adapter
  cli/        # Command-line interface
  testing/    # JTBD scenario runner + surface validation
  adapters/   # Frontend rendering adapters for CommandResult
  examples/   # Multi-stack example (TS, Python, Rust) + DirectClient demo
  rust/       # Rust crate implementation
python/       # Python package (pip install afd)
alfred/       # Quality bot (lint, parity, quality)
```

## Further Reading

- [AGENTS.md](AGENTS.md) — Architecture overview and skill routing table
- [alfred/AGENTS.md](alfred/AGENTS.md) — Alfred command reference and lint rules
- `skills/` — Deep topic skills for AFD patterns, each language, auth, contracts, DirectClient

## Questions?

Open an issue on [GitHub](https://github.com/lushly-dev/afd/issues) for questions or discussion.
