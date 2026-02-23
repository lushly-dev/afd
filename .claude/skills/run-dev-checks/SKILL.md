---
name: run-dev-checks
source: botcore
description: >
  Guides usage of botcore's development commands for linting, testing, building, quality gates, and static analysis. Covers dev_lint/dev_test/dev_build (language-aware dispatch), quality checks (file size, coverage, dependency staleness), static analysis (dead code, circular imports, unused deps, dependency graphs), portability checks, and skill linting. Use when running dev checks, understanding quality thresholds, diagnosing lint or test failures, analyzing code quality, or checking cross-platform portability. Triggers: dev lint, dev test, dev build, coverage, file size, dead code, circular imports, unused deps, dependency graph, portability, skill lint.

version: 1.0.0
triggers:
  - dev lint
  - dev test
  - dev build
  - coverage
  - file size
  - dead code
  - circular imports
  - unused deps
  - dependency graph
  - portability
  - skill lint
  - quality check
  - dev commands
  - ruff
  - pytest
  - biome
  - vitest
portable: true
---

# Running Dev Checks

Expert guidance for botcore's development command suite — language-aware linting, testing, building, quality gates, and static analysis.

## Capabilities

1. **Run Language-Aware Commands** -- Execute lint, test, and build using the correct tool for the detected language (Python/TypeScript/Rust)
2. **Check Code Quality** -- Validate file sizes, test coverage, and dependency freshness against configurable thresholds
3. **Analyze Code Structure** -- Find dead code, circular imports, unused dependencies, and generate dependency graphs
4. **Check Portability** -- Detect hardcoded paths that break cross-platform compatibility
5. **Lint Skills** -- Validate skill directories against the Agent Skills format specification

## Routing Logic

| Request Type | Load Reference |
|---|---|
| dev_lint, dev_test, dev_build signatures, language dispatch | [references/core-commands.md](references/core-commands.md) |
| dev_check_size, dev_check_coverage, dev_check_deps thresholds | [references/quality-checks.md](references/quality-checks.md) |
| dev_dead_code, dev_circular_imports, dev_unused_deps, dev_dep_graph | [references/analysis.md](references/analysis.md) |
| Common error codes and resolutions | [references/troubleshooting.md](references/troubleshooting.md) |

## Core Principles

### 1. Language Dispatch Is Automatic

<rules>
Dev commands read the `language`, `linter`, `test_runner`, and `formatter` from config.
The same `dev_lint()` call runs ruff for Python, biome for TypeScript, or clippy for Rust.
Never hardcode tool names in scripts — let config drive tool selection.
</rules>

### 2. Thresholds Are Config-Driven

<rules>
All quality thresholds come from `BotCoreConfig` with sensible defaults.
Override per-package in `[tool.botcore.packages.NAME]` for monorepos.
</rules>

| Check | Config Field | Default |
|---|---|---|
| File size warning | `file_size_warn` | 500 lines |
| File size error | `file_size_error` | 1000 lines |
| Coverage failure | `coverage_threshold` | 80% |
| Coverage warning | `coverage_warn_threshold` | 60% |
| Major version lag | `deps_max_major_behind` | 1 |
| Minor version lag | `deps_max_minor_behind` | 3 |

### 3. Analysis Commands Are Read-Only

<rules>
Analysis commands (dead_code, circular_imports, unused_deps, dep_graph) report findings but never modify code.
They return structured data for agents to act on — the agent decides what to fix.
</rules>

## Command Overview

### Core Commands (Language-Dispatched)

| Command | Python | TypeScript | Rust |
|---|---|---|---|
| `dev_lint()` | ruff check | biome lint | cargo clippy |
| `dev_test()` | pytest | vitest run | cargo test |
| `dev_build()` | hatch build | turbo build | cargo build |
| `dev_skill_lint()` | (universal) | (universal) | (universal) |

### Quality Commands

| Command | What It Checks |
|---|---|
| `dev_check_size()` | Python file line counts vs thresholds |
| `dev_check_coverage()` | Test coverage vs threshold (runs pytest --cov) |
| `dev_check_deps()` | Dependency versions vs PyPI latest |

### Analysis Commands

| Command | What It Finds |
|---|---|
| `dev_dead_code()` | Unused functions, variables, imports (via vulture) |
| `dev_circular_imports()` | Import cycles using AST + DFS |
| `dev_unused_deps()` | Declared but not imported dependencies |
| `dev_dep_graph()` | Module dependency graph (JSON or DOT) |

### Portability Commands

| Command | What It Detects |
|---|---|
| `dev_check_paths()` | Hardcoded Windows/Unix paths, localhost URLs |

## Workflow

### Daily Development Flow

1. **Write code** — make changes
2. **Lint** — `dev_lint()` catches style and syntax issues
3. **Test** — `dev_test()` runs the test suite
4. **Quality gates** — `dev_check_size()`, `dev_check_coverage()` validate standards

### Pre-Release Analysis

1. **Dead code** — `dev_dead_code()` finds unused symbols
2. **Circular imports** — `dev_circular_imports()` detects cycles
3. **Unused deps** — `dev_unused_deps()` finds removable dependencies
4. **Dep freshness** — `dev_check_deps()` checks for staleness
5. **Portability** — `dev_check_paths()` ensures cross-platform compatibility

## Checklist

- [ ] `dev_lint()` passes with no errors
- [ ] `dev_test()` passes with no failures
- [ ] `dev_check_size()` — no files exceed error threshold
- [ ] `dev_check_coverage()` — meets coverage threshold
- [ ] `dev_check_deps()` — no major-version-behind dependencies
- [ ] `dev_circular_imports()` — within allowed cycle count
- [ ] `dev_check_paths()` — no hardcoded platform-specific paths
