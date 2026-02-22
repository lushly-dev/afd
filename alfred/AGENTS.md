# Alfred - Agent Documentation

AFD's quality bot — deterministic architecture compliance checks so agents can skip expensive reasoning.

> **Philosophy:** Anything that can be checked mechanically, Alfred checks.

---

## Overview

Alfred is a Python package that validates AFD codebases follow architectural conventions. It provides three commands exposed via CLI, MCP server, and botcore plugin. All commands return `CommandResult` and are async.

---

## Development Commands

```bash
# Install with all extras
cd alfred
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Run single test file
pytest tests/test_lint.py -v

# Lint
ruff check .

# CLI
alfred lint [--path PATH]
alfred parity [--path PATH]
alfred quality [--path PATH]

# MCP server
python -m alfred.mcp_server          # stdio transport
python -m alfred.mcp_server --sse    # SSE transport
```

---

## Commands

### `alfred lint` — Architecture Compliance

Wraps the `AFDLinter` from the `afd` Python package. Scans Python, TypeScript, and Rust files for AFD anti-patterns.

| Rule | Language | Severity | Description |
|------|----------|----------|-------------|
| `afd-command-result` | Python, Rust | Error | Handlers must return `CommandResult` |
| `afd-actionable-errors` | Python | Warning | `error()` calls must include `suggestion=` |
| `afd-no-direct-fetch` | Python, TS | Error | No `fetch()`/`axios`/`httpx` in UI layer |
| `afd-kebab-naming` | TypeScript | Error | Command names must be kebab-case |
| `afd-no-business-in-ui` | TypeScript | Warning | No `.map().filter()`, `.reduce()`, `new Date()`, `Math.*` in UI |
| `afd-layer-imports` | All | Warning | UI can't import from `services/`, `core/`, or `api/` directly |

**Skipped directories:** `node_modules`, `.venv`, `__pycache__`, `.git`, `dist`, `build`, `target`, `.pytest_cache`, `.claude`, `.agent`, `chrome-profile`

**Returns:** `{ passed, files_checked, error_count, warning_count, issues[] }`

### `alfred parity` — Cross-Language API Surface Sync

Compares public exports across TypeScript, Python, and Rust entry points to detect API drift.

| Entry Point | Source |
|-------------|--------|
| TypeScript | `packages/core/src/index.ts` (export statements) |
| Python | `python/src/afd/__init__.py` (`__all__` list) |
| Rust | `packages/rust/src/lib.rs` (`pub use` re-exports) |

- TypeScript is treated as the **source of truth**
- Normalizes naming (camelCase → snake_case) for cross-language comparison
- Filters out TS-only platform utilities (`exec`, path/OS helpers, connectors)
- Skips version-related exports (`__version__`, `VERSION`, `is_native`, `is_wasm`)
- Confidence = `1.0 - (total_gaps / total_ts_exports)`

**Returns:** `{ typescript_count, python_count, rust_count, missing_from_python[], missing_from_rust[], missing_from_typescript[], extra_in_* }`

### `alfred quality` — Command Description Quality

Scans `defineCommand()` (TypeScript) and `@server.command()` / `@define_command()` (Python) definitions for description quality issues.

| Check | Rule | Threshold |
|-------|------|-----------|
| Too short | `description-too-short` | < 10 characters |
| Too long | `description-too-long` | > 120 characters |
| Non-imperative | `not-imperative` | Doesn't start with a recognized verb |
| Near-duplicate | `near-duplicate` | > 80% word overlap between descriptions |

Recognized imperative verbs include: get, list, create, update, delete, validate, search, export, import, analyze, check, run, build, test, deploy, start, stop, generate, sync, resolve, compile, install, configure, and ~25 more.

**Returns:** `{ commands_scanned, typescript_commands, python_commands, issue_count, issues[] }`

---

## MCP Server

Uses botcore's `create_mcp_server()` factory to expose the standard 3-tool pattern:

| Tool | Description |
|------|-------------|
| `alfred-start` | Discovery — available commands and capabilities |
| `alfred-docs` | Reference documentation by topic |
| `alfred-run` | Execute Python code with all Alfred functions available |

---

## Plugin System

`AlfredPlugin` implements botcore's plugin interface and auto-registers via the `botcore.plugins` entry point:

```toml
[project.entry-points."botcore.plugins"]
alfred = "alfred.plugin:AlfredPlugin"
```

Registers 3 commands + inline docs. No custom configuration schema.

---

## Project Structure

```
alfred/
├── pyproject.toml
├── AGENTS.md
├── src/alfred/
│   ├── __init__.py         # Package init, version
│   ├── cli.py              # Click CLI (lint, parity, quality)
│   ├── plugin.py           # BotCorePlugin (auto-discovered)
│   ├── mcp_server.py       # MCP server entry point
│   └── commands/
│       ├── __init__.py     # Re-exports all commands
│       ├── lint.py         # alfred_lint — architecture compliance
│       ├── parity.py       # alfred_parity — cross-language sync
│       └── quality.py      # alfred_quality — description quality
└── tests/
    ├── test_lint.py        # 6 tests
    ├── test_parity.py      # 9 tests
    └── test_quality.py     # 7 tests
```

**Tests:** 22 total (pytest + pytest-asyncio)

---

## Dependencies

- **Core:** `lushly-botcore>=0.1.0`, `afd>=0.2.0`
- **CLI:** `click>=8.0`, `rich>=13.0`
- **MCP:** `lushly-botcore[mcp]`
- **Python:** ≥3.11

---

## Key Patterns

- All commands are **async** functions returning `CommandResult[dict]`
- Uses `success()` and `error()` from `afd.core.result`
- Every error includes `suggestion=` for agent recovery
- CLI exits with code 1 on failures (CI-compatible)
- Default path is current working directory when `--path` not provided
