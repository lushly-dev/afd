# Setup

First-time setup guide for botcore. Run these steps once to get a working development environment.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| Python | 3.11+ | `python --version` |
| uv | Latest | `uv --version` |
| Node.js | 20+ (for check scripts) | `node -v` |
| Git | Any recent | `git --version` |

## Install

```bash
uv pip install --python python --break-system-packages -e ".[dev,mcp]"
```

## Verify

```bash
pytest tests/ -v          # Run all tests
ruff check src/ tests/ scripts/ packages/*/src/   # Lint
ruff format --check <changed files>               # Format, against base only
```

## Development Commands

```bash
# Run all tests
pytest tests/ -v

# Run single test file
pytest tests/test_skill_seed.py -v

# Lint
ruff check src/

# Lint with auto-fix
ruff check src/ --fix

# Format the files you changed (never untouched ones)
ruff format <changed files>
```

## Gates in AFD

Botcore's own Lefthook hooks and check scripts were retired when it moved into AFD. The
repository's `lefthook.yml` runs `scripts/check-portability.mjs` on staged TypeScript, JavaScript,
JSON, Markdown and YAML, and `scripts/check-file-size.mjs` on staged TypeScript; their full-tree
runs in pre-push scan only the repository's own roots, not `endpoints/`. Neither reaches Botcore's
Python by itself:

| Check | Where it runs |
|-------|---------------|
| `ruff check` on `src/`, `tests/`, `scripts/` and each `packages/*/src/` | The Botcore workflow's lint step, and `pnpm verify` for a Botcore change |
| `ruff format` | Compared against base only: format the files you change, never untouched ones |
| Portability | `node scripts/check-portability.mjs <files>` from the repository root. Escape: `# portability-ok: reason` on the line or the one above |
| File size | The `dev_check_size` command (over MCP) reads `file_size_warn` and `file_size_error` (500 and 1,000 by default) and only warns below the error line |

## Code Style (Ruff)

- 100 char line width, Python 3.11 target
- Ruff for both linting and formatting
- Hatchling build backend
- Tests in `tests/` directory (`test_*.py`)

## Repo Configuration

AFD's `botcore.toml` sits at the repository root, not in `endpoints/botcore`, and describes the
whole repository: its primary language is TypeScript (`language = "typescript"`, Biome and
Vitest), with `file_size_warn = 500` and `file_size_error = 1500`. It also holds the skills
profile (`[skills]`), the bloat sweep (`[sweep]`) and the software factory's adapter
(`[plugins.factory]`). Read that file for the current values; the `configure-botcore` skill
explains which config file wins and what each key does. Botcore's own Python code follows the
Ruff settings in `endpoints/botcore/pyproject.toml` (above), whatever the root file names.
