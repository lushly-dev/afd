# Setup

First-time setup guide for the AFD monorepo. Run these steps once to get a working development environment.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 20+ | `node -v` |
| pnpm | 9+ | `pnpm -v` |
| Python | 3.10+ (for Python package and Alfred) | `python --version` |
| Git | Any recent | `git --version` |

## Install

### TypeScript packages

```bash
pnpm install    # Installs deps + Lefthook git hooks
pnpm build      # Build all packages
```

### Python package

```bash
cd python
pip install -e ".[dev]"
```

### Alfred (quality bot)

```bash
cd alfred
uv pip install -e ".[dev]"
```

## Verify

```bash
pnpm test         # Run all tests (Vitest)
pnpm lint         # Biome lint check
pnpm typecheck    # tsc --noEmit
```

```bash
# Python
cd python && pytest tests/ -v

# Alfred
cd alfred && uv run alfred lint
```

## Build & Test Commands

```bash
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

# Quality gate (all checks)
pnpm check
```

## Git Hooks (Lefthook)

Lefthook manages git hooks. Installed automatically via `pnpm install`.

| Hook | Commands | Trigger |
|------|----------|--------|
| pre-commit | Biome lint (staged), portability, file-size, typecheck | `git commit` |
| commit-msg | commitlint (conventional commits) | `git commit` |
| pre-push | Full lint, test, typecheck, portability, file-size, orphan-files | `git push` |
| check | All pre-push + build | `npx lefthook run check` |

**Check scripts** (`scripts/`):

| Script | What it checks |
|--------|---------------|
| `check-file-size.mjs` | Warn >300, error >500 lines. Escape: `// afd-override: max-lines=N` (cap 1000) |
| `check-portability.mjs` | Machine-specific paths (drive letters, user homes). Escape: `// portability-ok: reason` |
| `check-orphan-files.mjs` | Unreferenced `.ts` files across packages (warning only) |

Skip hooks: `git commit --no-verify` / `git push --no-verify`

## Code Style

### TypeScript (Biome)

- Tab indentation, single quotes, trailing commas (es5)
- `noExplicitAny: error` — no `any` types
- `useImportType: error` — use `import type { ... }` for type-only imports
- `noUnusedImports: error`, `noUnusedVariables: error`
- `useNodejsImportProtocol: error` — use `node:` prefix for Node.js builtins

### Python (Ruff)

- 100 char line width, Python 3.10 target
- Pytest for testing

## Repo Configuration

`botcore.toml` at repo root sets quality thresholds and tooling:

```toml
[skills]
source_dir = ".claude/skills"
```
