# Contributing to AFD

AFD (Agent-First Development) is a methodology where AI agents are first-class users. Everything in this repo follows **Command-First** design: all functionality is exposed as commands with schemas before any UI is built. If you're contributing, you're building for agents — not just humans.

## Prerequisites

- **Node.js** >= 22.12.0 (development and CI use Node 26 LTS, pinned in `.nvmrc`)
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
uv sync --frozen --all-extras --dev
uv run alfred --workspace .. lint        # Architecture compliance
uv run alfred --workspace .. parity      # Cross-language API sync
uv run alfred --workspace .. quality     # Command description quality
```

## Core Principles

Every contribution should follow these patterns:

### 1. Commands Return `CommandResult`

All handlers — TypeScript, Python, Rust, and C++ — must return `CommandResult`:

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

AFD ships implementations in TypeScript, Python, Rust, and C++. TypeScript is the source of truth for the API surface. When adding exports to `packages/core/src/index.ts`, mirror them in:

- **Python**: `python/src/afd/__init__.py` (`__all__` list)
- **Rust**: `packages/rust/src/lib.rs` (`pub use` re-exports)
- **C++**: `packages/cpp/include/afd/` (declarations in `namespace afd`, reached from `afd/afd.hpp`; C++ uses TypeScript's names in snake_case)

Run `alfred parity` to detect drift. The tool normalizes naming conventions (camelCase ↔ snake_case) across languages.

## Quality Gates

### Lefthook Git Hooks

Lefthook runs automatically on commit and push — no manual setup needed.

**Pre-commit** (every commit):
- Biome lint + auto-fix on staged `.ts`/`.js`/`.json` files
- Portability check (no machine-specific paths)
- File size check on staged `.ts` files (warn >500 lines, error >1000; markdown is not size-checked)
- TypeScript type checking

**Pre-push** (before push):
- Full lint, plus tests and typecheck for the packages the change affects
- Portability + file size on all files
- Orphan file detection (`.ts` files not imported anywhere)
- Version, package-boundary and skill checks, and the tooling tests

The hooks neither install nor build: run `pnpm install` after pulling `main`, and `pnpm build` after changing a package another one imports. `lefthook.yml` is the full definition.

**Commit messages** are validated by commitlint (Conventional Commits).

### On-Demand Check

Run the gates manually:

```bash
pnpm check    # The TypeScript gate ci.yml runs, over the packages the change affects
pnpm verify   # pnpm check, then the local suite of every other workflow the change triggers
```

`pnpm check` covers TypeScript only. Python, Rust, C++, Alfred and the browser suites have workflows of their own, and `pnpm verify` runs the ones a change triggers (`pnpm verify --list` prints the plan).

### Alfred Quality Bot

Alfred provides deterministic architecture compliance — agents and humans skip expensive manual review:

| Command | What it checks |
|---------|----------------|
| `alfred lint` | AFD architecture rules (CommandResult, actionable errors, kebab naming, no-fetch-in-UI, no-business-in-UI, layer imports and more; [alfred/AGENTS.md](alfred/AGENTS.md) lists them) |
| `alfred parity` | API surface sync across TypeScript, Python, Rust, and C++ |
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

**Allowed types and scopes** are listed in `commitlint.config.js`. Leave the scope out for cross-cutting work.

## Submitting Changes

1. Fork the repository and create a branch from `main`
2. Make changes following the principles above
3. Verify locally:
   - `pnpm verify` — the TypeScript gate and every other suite the change triggers
   - `alfred lint` — no architecture violations (if adding commands)
4. Push and open a pull request

### PR Guidelines

- Keep PRs focused on a single concern
- Include tests for new functionality
- Update documentation if behavior changes — see `AGENTS.md` for what every session needs, and `.claude/skills/` for deep topic guides
- All Lefthook hooks must pass

## Package Structure

AFD's own packages are under `packages/` (TypeScript, Rust, C++) and `python/`; the foundations, integrations and endpoints built around them have directories of their own. The layout section of [AGENTS.md](AGENTS.md#layout) is the maintained map.

## Further Reading

- [AGENTS.md](AGENTS.md) — Layout, the commands that confirm work, and where each topic's detail lives
- [alfred/AGENTS.md](alfred/AGENTS.md) — Alfred command reference and lint rules
- `.claude/skills/` — Deep topic skills for AFD patterns, each language, auth, DirectClient, and the session workflow

## Questions?

Open an issue on [GitHub](https://github.com/lushly-dev/afd/issues) for questions or discussion.
