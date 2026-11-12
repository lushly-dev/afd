# Setup

First-time setup guide for the AFD monorepo. Run these steps once to get a working development environment.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 26 LTS for development (`.nvmrc`); packages support 22.12+, Violet and the hosted fixtures need 24+ | `node -v` |
| pnpm | 10.30.1 (pinned in `package.json`) | `pnpm -v` |
| Python | 3.10+ (for Python package and Alfred) | `python --version` |
| Git | Any recent | `git --version` |

`pnpm verify` also needs `uv`, the Rust toolchain, CMake, OpenSSL or Chromium when the change it checks reaches a suite that uses them. `pnpm verify --list` prints the plan first.

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
uv sync --frozen --all-extras --dev
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
cd alfred && uv run alfred --workspace .. lint
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

# The TypeScript quality gate ci.yml runs, over the packages the change affects
pnpm check

# pnpm check, then the local suite of every other workflow the change triggers
pnpm verify
```

## Git Hooks (Lefthook)

Lefthook manages git hooks. Installed automatically via `pnpm install`; `lefthook.yml` defines them.

| Hook | Commands | Trigger |
|------|----------|--------|
| pre-commit | Biome lint and fix (staged), portability, file-size, typecheck of the staged files' packages | `git commit` |
| commit-msg | commitlint (conventional commits) | `git commit` |
| pre-push | Full lint, the affected packages' tests and typecheck, portability, file-size, orphan-files, versions, boundaries, skills, tooling tests | `git push` |
| check | All pre-push, plus the affected build and coverage | `pnpm check` |

The hooks neither install nor build: run `pnpm install` after pulling `main`, and `pnpm build` after changing a package another one imports.

**Check scripts** (`scripts/`):

| Script | What it checks |
|--------|---------------|
| `check-file-size.mjs` | `.ts` under `packages/` and `.js`/`.mjs` under `scripts/`: warn >500 lines, error >1000 (the same pair as `botcore.toml`). Escape: `// afd-override: max-lines=N` (cap 1500; leave headroom). Markdown is not size-checked |
| `check-portability.mjs` | Machine-specific paths (drive letters, user homes). Escape: `// portability-ok: reason` |
| `check-orphan-files.mjs` | Unreferenced `.ts` files across packages (warning only) |
| `check-versions.mjs` | Package versions and the AFD contract version (`spec/VERSION`) against the language constants, `docs/language-parity.md` and the README table |

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
