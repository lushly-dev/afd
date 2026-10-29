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
ruff check src/           # Lint
ruff format --check src/  # Format check
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

# Format
ruff format src/
```

## Git Hooks (Lefthook)

Lefthook manages git hooks. Requires `lefthook` binary on PATH.

| Hook | Commands | Trigger |
|------|----------|--------|
| pre-commit | ruff check --fix (staged), ruff format (staged), portability, file-size | `git commit` |
| pre-push | Full ruff lint, format-check, pytest, portability, file-size | `git push` |
| check | Same as pre-push | `lefthook run check` |

**Check scripts** (`scripts/`):

| Script | What it checks |
|--------|---------------|
| `check-file-size.mjs` | Warn >300, error >500 lines. Escape: `# botcore-override: max-lines=N` (cap 1000) |
| `check-portability.mjs` | Machine-specific paths (drive letters, user homes). Escape: `# portability-ok: reason` |

Skip hooks: `git commit --no-verify` / `git push --no-verify`

## Code Style (Ruff)

- 100 char line width, Python 3.11 target
- Ruff for both linting and formatting
- Hatchling build backend
- Tests in `tests/` directory (`test_*.py`)

## Repo Configuration

`botcore.toml` at repo root:

```toml
language = "python"
linter = "ruff"
test_runner = "pytest"
formatter = "ruff"
file_size_warn = 500
file_size_error = 1000
coverage_threshold = 80
check_changelog = true
check_agents = true

[skills]
source_dir = ".claude/skills"
```
