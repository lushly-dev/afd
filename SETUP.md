# Setup

First-time setup guide for the AFD monorepo. Run these steps once to get a working development environment.

The repository holds AFD's libraries in four languages and the projects that grew up around them (see [the README](README.md#the-rest-of-the-repository)). You don't need every toolchain: Node and pnpm cover most of it, and the rest is only needed for the area you work on.

## Prerequisites

Everyone needs these:

| Tool | Version | Check |
|------|---------|-------|
| Node.js | 26 LTS for development (`.nvmrc`); packages support 22.12+, Violet and the hosted fixtures need 24+ | `node -v` |
| pnpm | 10.30.1 (pinned in `package.json`) | `pnpm -v` |
| Git | Any recent | `git --version` |

Add these for the area you touch:

| Tool | Version | Needed for | Check |
|------|---------|-----------|-------|
| Python | 3.10+ (3.11+ for Botcore, Alfred and Health) | `python/`, `alfred/`, `endpoints/botcore/`, `endpoints/health/` | `python --version` |
| uv | Latest | The Python projects above | `uv --version` |
| Rust | 1.98.0 for Umbel, Loam Mail and Specimen's host (each has a `rust-toolchain.toml` that pins it, and Umbel's adds the `wasm32-wasip2` target; `rustup` installs what they name); the `afd` crate supports 1.85+ | `packages/rust/`, `endpoints/umbel/`, `endpoints/loam/plugins/`, Specimen's native host | `rustc --version` |
| CMake and a C++20 compiler | CMake 3.25+; GCC 12+, Clang 16+, Apple Clang 15+ or MSVC 2022 | `packages/cpp/` | `cmake --version` |
| Chromium | The build Playwright names; install it with `pnpm -F <package> exec playwright install chromium` | The browser suites of Specimen, FAST-AF, Violet, Loam and the Health dashboard | |
| OpenSSL | Any recent | Loam's hosted suite and `pnpm test:hosted:local` | `openssl version` |

## Install

### TypeScript packages

```bash
pnpm install    # Installs deps + Lefthook git hooks
pnpm build      # Build all packages
```

This builds every workspace package, including Specimen, FAST-AF, Violet and Loam, which are TypeScript. Specimen's native host is a separate Rust build (`pnpm -F @lushly-dev/specimen build:host`), needed only to render.

### Python package

```bash
cd python
uv sync --frozen --all-extras
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
cd python && uv run pytest -q

# Alfred
cd alfred && uv run alfred --workspace .. lint
```

## Working on one area

`pnpm check` is the TypeScript quality gate: lint, build, typecheck and tests with coverage, over the packages your change affects. It does not run a browser, and it does not cover Python, Rust or C++. Each area below has a fuller suite of its own. `pnpm verify` runs `pnpm check` and then every one of these suites your change would trigger in CI (`pnpm verify --list` shows the plan first).

| Area | Where | Also run |
|------|-------|----------|
| AFD in Python | `python/` | `cd python && uv run pytest -q` |
| AFD in Rust | `packages/rust/` | `cd packages/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` |
| AFD in C++ | `packages/cpp/` | `cd packages/cpp && cmake --preset dev && cmake --build --preset dev && ctest --preset dev` |
| Specimen | `foundations/specimen/`, `integrations/specimen-*`, `endpoints/specimen-cli/` | `pnpm test:specimen` (Chromium) |
| FAST-AF | `foundations/fast-af/` | `pnpm test:fast-af` (Chromium), and `pnpm test:stories` after changing a component or a story (Chromium, Rust) |
| Violet | `foundations/violet/`, `integrations/violet-afd/`, `endpoints/violet-*` | `pnpm test:violet` (Chromium) |
| Umbel | `endpoints/umbel/` | `cargo fmt`, `cargo clippy`, the WebAssembly component builds and `cargo test --locked --workspace`; its [README](endpoints/umbel/README.md) has the commands |
| Loam | `endpoints/loam/` | Its browser, walk and hosted suites; the [packages README](endpoints/loam/packages/README.md) has the commands (Chromium, Rust, OpenSSL) |
| Botcore | `endpoints/botcore/` | Its own [SETUP.md](endpoints/botcore/SETUP.md) |
| Health | `endpoints/health/`, `endpoints/health-dashboard/` | `cd endpoints/health && uv sync --frozen --extra dev && uv run --frozen pytest -q`; `pnpm -F @lushly-dev/health-dashboard test:browser` (Chromium) |

`pnpm verify --list` prints the full commands your change would run. The workflows in `.github/workflows/` are the definition of what CI runs, and [gates.md](.claude/skills/prepare-pr/references/gates.md) explains what each gate covers.

Rust builds across this repository's worktrees share one target directory, which grows quickly; `pnpm rust:sweep` evicts builds nothing has read for three days.

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
| pre-commit | Biome lint and fix (staged), portability, file-size, typecheck of the staged files' packages and their dependents | `git commit` |
| commit-msg | commitlint (conventional commits) | `git commit` |
| pre-push | Full lint; test and typecheck of the affected packages; portability, file-size, orphan-files, versions, boundaries, skills, tooling tests | `git push` |
| check | All pre-push + build of the affected packages | `pnpm check` |

**Check scripts** (`scripts/`):

| Script | What it checks |
|--------|---------------|
| `check-file-size.mjs` | `.ts` under `packages/` and `.js`/`.mjs` under `scripts/`: warn >500 lines, error >1500 (the same pair as `botcore.toml`). A runaway guard with no override: the 500-line review belongs to the `sweep-bloat` skill's periodic pass, not to the commit. Generated files and Markdown are not size-checked |
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
