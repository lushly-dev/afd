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
uv pip install -e ".[dev]"

# Run tests
uv run pytest tests/ -v

# Run single test file
uv run pytest tests/test_lint.py -v

# Lint
uv run ruff check .

# CLI
uv run alfred lint [--path PATH]
uv run alfred parity [--path PATH]
uv run alfred quality [--path PATH]

# MCP server
uv run python -m alfred.mcp_server          # stdio transport
uv run python -m alfred.mcp_server --sse    # SSE transport
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

### `alfred parity` — Cross-Language API Surface and Wire-Shape Sync

Two checks.

**Name parity** compares public exports across the TypeScript, Python, and Rust entry points to detect API drift.

| Entry Point | Source |
|-------------|--------|
| TypeScript | `packages/core/src/index.ts`: `export { a, b as c } from`, `export type { }`, inline `type`, `export * from` (followed into the module), `export * as ns`, and direct `export function/const/class/interface/type/enum` declarations; comments ignored |
| Python | `python/src/afd/__init__.py`: `__all__` read with `ast`, including `__all__ +=`, `.extend()`, `.append()` and `__all__ + [...]` |
| Rust | `packages/rust/src/lib.rs`: `pub use` in every form (single items, groups, nested groups, `self`, `as` aliases, `*` followed into the module) and top-level `pub fn/struct/enum/trait/type/const/static`; `pub(crate)`, `#[cfg(test)]` and items inside blocks ignored |

- TypeScript is treated as the **source of truth**
- Normalizes naming (camelCase → snake_case) for cross-language comparison
- Filters out TS-only platform utilities (`exec`, path/OS helpers, connectors)
- Skips version-related exports (`__version__`, `VERSION`, `is_native`, `is_wasm`)

**Wire shapes** checks the golden fixtures in `spec/wire/*.json` (see `spec/wire/README.md`): each must be valid JSON and be referenced by name in all three round-trip suites (`packages/server/src/wire-fixtures.test.ts`, `python/tests/test_wire_fixtures.py`, `packages/rust/tests/wire_fixtures.rs`). An uncovered fixture, a missing suite, or a missing `spec/wire` is a gap.

- `total_gaps` = `name_gaps` + `wire_fixtures.gaps`; the CLI exits 1 when it is above zero
- Confidence = `1.0 - total_gaps / (TS exports + fixtures × 3)`
- `tests/test_parity.py::test_parity_on_real_repo` holds the repo to budgets: no uncovered fixture, core exports found in every language, and `missing_from_python` / `missing_from_rust` no larger than `NAME_GAP_BUDGET` (lower the budget when a gap closes)

**Returns:** `{ counts, missing_from_python[], missing_from_rust[], missing_from_typescript[], extra_in_*[], name_gaps, wire_fixtures: { fixtures[], suites, missing_suites[], invalid_fixtures[], uncovered{}, gaps }, total_gaps }`

### `alfred quality` — Command Description Quality

Scans `defineCommand()` (TypeScript) and `@server.command()` / `define_command()` (Python) definitions for description quality issues.

- TypeScript: a comment-aware scanner handles generic calls (`defineCommand<In, Out>({...})`), nested objects before `description` (`expose: { mcp: true }`), any quoting and escapes (`"Don't"`), templates without `${}` and `+` concatenation. Only the definition's top-level `name` and `description` count; calls in comments are ignored.
- Python: definitions are read with `ast` (keyword or positional `name`/`description`), so docstring examples are ignored.
- The walk prunes `node_modules`, `.venv`, `dist` and the other `AFDLinter.SKIP_DIRS`, and matches the skip path patterns (`.claude/`, ...) relative to the scanned root.

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

- **Core:** `lushly-botcore>=0.2.0`, `afd>=0.2.0`, `click>=8.0`, `rich>=13.0`
- **MCP:** `lushly-botcore[mcp]`
- **Python:** ≥3.11

---

## Key Patterns

- All commands are **async** functions returning `CommandResult[dict]`
- Uses `success()` and `error()` from `afd.core.result`
- Every error includes `suggestion=` for agent recovery
- CLI exits with code 1 on failures (CI-compatible)
- Default path is current working directory when `--path` not provided
