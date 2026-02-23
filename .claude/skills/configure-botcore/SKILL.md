---
name: configure-botcore
source: botcore
description: >
  Guides configuration of botcore projects via botcore.toml or pyproject.toml. Covers BotCoreConfig model, SkillsConfig, PackageOverrideConfig, EnvConfig, language detection and tool defaults, per-package overrides, precedence rules, plugin config validation, and common misconfiguration pitfalls. Use when setting up a new botcore project, configuring thresholds, adding per-package overrides, troubleshooting config-related silent failures, or understanding the config loading flow. Triggers: config, configuration, botcore.toml, pyproject.toml, BotCoreConfig, thresholds, language detection, tool defaults, per-package, SkillsConfig.

version: 1.0.0
triggers:
  - config
  - configuration
  - botcore.toml
  - pyproject.toml
  - BotCoreConfig
  - thresholds
  - language detection
  - tool defaults
  - per-package
  - SkillsConfig
  - PackageOverrideConfig
  - EnvConfig
  - coverage threshold
  - file size limit
  - configure botcore
portable: true
---

# Configuring Botcore

Expert guidance for configuring botcore behavior through TOML configuration files, environment variables, and per-package overrides.

## Capabilities

1. **Write Project Config** -- Set up `botcore.toml` or `[tool.botcore]` in `pyproject.toml` with correct fields and types
2. **Configure Quality Thresholds** -- Set file size, coverage, duplication, and dependency staleness limits
3. **Add Per-Package Overrides** -- Apply different thresholds to specific packages in a monorepo
4. **Configure Skills** -- Control which skills are included, skipped, or sourced from alternate directories
5. **Set Up Plugin Config** -- Define plugin-specific configuration sections validated by plugin schemas
6. **Understand Precedence** -- Know how CLI flags, project config, language defaults, and core defaults layer

## Routing Logic

| Request Type | Load Reference |
|---|---|
| All config fields, types, defaults, annotated example | [references/config-reference.md](references/config-reference.md) |
| load_config() flow, layered merge, CLI overrides | [references/precedence.md](references/precedence.md) |
| Per-package overrides, get_config_for_path() | [references/per-package.md](references/per-package.md) |
| Language auto-detection, _TOOL_DEFAULTS map | [references/language-detection.md](references/language-detection.md) |

## Core Principles

### 1. Convention Over Configuration

<rules>
Botcore auto-detects language and applies tool defaults. Only configure what differs from defaults.
An empty config section is valid — language detection + defaults handle the common case.
</rules>

For a standard Python project, botcore auto-detects Python and sets linter=ruff, test_runner=pytest, formatter=ruff without any config.

### 2. Config Sources Have Clear Precedence

<rules>
Precedence (highest to lowest): CLI flags → project config → plugin defaults → core defaults.
Per-package overrides use REPLACE semantics, not additive merge.
</rules>

A CLI flag always wins. A per-package `coverage_paths=["lib/"]` completely replaces the root `coverage_paths=["src/"]`.

### 3. Fail Fast on Unknown Fields

<rules>
All config models use `extra="forbid"`. Typos and unknown fields cause immediate validation errors.
This prevents silent misconfiguration — a misspelled field name is caught on load.
</rules>

### 4. Secrets Stay in Environment

<rules>
API keys and tokens go in environment variables (`EnvConfig`), never in TOML files.
TOML config is committed to the repo. Secrets must not be.
</rules>

## Quick Reference

### Minimal Config (usually sufficient)

```toml
# pyproject.toml
[tool.botcore]
# Language auto-detected. Defaults applied automatically.
```

### Common Overrides

```toml
[tool.botcore]
language = "python"
file_size_warn = 300       # Lines (default: 500)
file_size_error = 600      # Lines (default: 1000)
coverage_threshold = 90    # Percent (default: 80)
```

### Default Thresholds

| Field | Default | Unit |
|---|---|---|
| `file_size_warn` | 500 | lines |
| `file_size_error` | 1000 | lines |
| `coverage_threshold` | 80 | percent |
| `coverage_warn_threshold` | 60 | percent |
| `duplication_threshold` | 5 | occurrences |
| `duplication_min_lines` | 10 | lines |
| `circular_deps_allowed` | 0 | count |
| `deps_max_major_behind` | 1 | versions |
| `deps_max_minor_behind` | 3 | versions |

### Tool Defaults by Language

| Language | Linter | Test Runner | Formatter |
|---|---|---|---|
| Python | ruff | pytest | ruff |
| TypeScript | biome | vitest | biome |
| Rust | clippy | cargo-test | rustfmt |

## Checklist

- [ ] Config placed in `pyproject.toml [tool.botcore]` or standalone `botcore.toml`
- [ ] No unknown fields (would cause validation error)
- [ ] Language explicitly set or auto-detection verified
- [ ] Quality thresholds appropriate for project maturity
- [ ] Per-package overrides use `[tool.botcore.packages.NAME]` syntax
- [ ] Secrets in environment variables, not TOML
- [ ] Plugin config sections match installed plugins
