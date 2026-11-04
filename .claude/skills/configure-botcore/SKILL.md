---
name: configure-botcore
description: >
  Configures botcore through botcore.toml or [tool.botcore] in pyproject.toml:
  which file wins, validation, defaults, per-package and per-language settings,
  and the [skills] section. Use when writing botcore config or when a setting
  seems to be ignored.
metadata:
  source: botcore
  version: 2.1.0
  portable: true
---

<!-- Generated from skills/exports.json; edit the canonical botcore-config skill. -->

# Configuring botcore

`load_config()` in `src/botcore/config.py` is the source of truth; read it when this page and the code disagree.

## Which file is read

- **Workspace:** commands load config from `find_workspace()`: the nearest directory at or above the working directory holding `pnpm-workspace.yaml`, `Cargo.toml`, `pyproject.toml`, `package.json` or `.git`. A managed host passes its target instead. In a monorepo, a command run inside a package with its own manifest reads that package's directory, not the repository root.
- **pyproject wins wholesale:** if that directory's `pyproject.toml` has a `[tool.botcore]` table, it is the whole config and `botcore.toml` is ignored entirely. This applies even when the table is empty, or is created only by a subtable such as `[tool.botcore.plugins.agents]`. Otherwise botcore reads the top level of `botcore.toml`.
- **Section names differ:** `botcore.toml` uses `[skills]`, `[packages.x]` and `[plugins.x]`; `pyproject.toml` uses `[tool.botcore.skills]`, `[tool.botcore.packages.x]` and `[tool.botcore.plugins.x]`.
- **Syntax errors are silent:** a `pyproject.toml` that fails to parse falls through to `botcore.toml`, and a `botcore.toml` that fails to parse yields all defaults, with no warning. If every setting seems ignored, parse the file with `tomllib`.
- **Unknown keys are loud:** every model uses `extra="forbid"`, so a misspelt key raises a `ValidationError` from any command that loads config. Plugin sections are validated by the plugin's own schema instead (see below).

## Precedence

What is wired, highest first:

1. Values in the project file.
2. Language defaults. If `language` is unset, `detect_language()` sets it. Then any unset `linter`, `test_runner` or `formatter` is filled from `_TOOL_DEFAULTS`.
3. Model defaults.

`load_config(cli_overrides=...)` and its docstring describe a "CLI flags" layer on top, but no caller passes `cli_overrides`, and no CLI flag sets a config value. Some commands take arguments that beat config for that call, for example `dev_check_size(warn_threshold=..., error_threshold=...)`.

## Language detection and tool defaults

`detect_language()` checks the workspace root only, in this order: `Cargo.toml` → rust; `pyproject.toml` with `[build-system]` → python; `package.json` → typescript; any other `pyproject.toml` → python. A TypeScript repository with a root `Cargo.toml` is detected as Rust, so set `language` explicitly in mixed repositories.

| `_TOOL_DEFAULTS` | linter | test_runner | formatter |
|---|---|---|---|
| python | ruff | pytest | ruff |
| typescript | biome | vitest | biome |
| rust | clippy | cargo-test | rustfmt |

Other languages get no tool defaults.

For several languages, add two or more `[language_config.<lang>]` tables (`root`, `linter`, `test_runner`, `formatter`); one table alone doesn't switch on dispatch. Their keys then become the active languages, and dev commands called without `language` or `path` (`dev_lint`, `dev_test`, `dev_build`, `dev_check_deps` and the analysis commands) run once per language. A path resolves to a language in this order: the `language` argument, the longest matching `root`, the package override's `language`, marker detection in the path's directory, then `language`. Loading warns when `language` isn't one of the `language_config` keys, and when two roots overlap.

## Defaults and who reads them

| Field | Default | Read by |
|---|---|---|
| `file_size_warn`, `file_size_error` | 500, 1000 lines | `dev_check_size` |
| `coverage_threshold`, `coverage_warn_threshold` | 80, 60 % | `dev_check_coverage` |
| `coverage_paths` | `["src/"]` | `dev_check_coverage`, Python only |
| `deps_max_major_behind`, `deps_max_minor_behind` | 1, 3 | `dev_check_deps`, PyPI packages only |
| `path_check_exclude`, `path_check_allowlist` | `[]` | `dev_check_paths` |
| `circular_deps_allowed` | 0 | `dev_circular_imports` |

Defined but not used, so setting them changes nothing:

- `duplication_threshold` (5), `duplication_min_lines` (10), `coverage_exclude` (`[]`), `check_changelog` and `check_agents` (`true`): no command reads them.
- `telemetry_enabled` (`false`) and `telemetry_format` (`"text"`): only `registry.get_client(config=...)` reads them, and no caller passes a config.
- `botcore_version` is an informational stamp.
- `EnvConfig` (`openai_api_key`, `github_token`, `convex_url`) is exported but never loaded, so nothing reads environment variables through it.

## Per-package overrides

- Keys match the manifest name that `detect_package()` finds by walking up from a file: `package.json` `name`, `[project].name` or Cargo `[package].name`. They don't match directory names, so `[packages.python]` does nothing for a `python/` directory whose `pyproject.toml` names it `afd`. Quote scoped names: `[packages."@scope/pkg"]`.
- **Allowed fields:** `language`, the size and coverage fields, `coverage_paths`, `coverage_exclude`, the two `duplication_*` fields and `circular_deps_allowed`.
- **REPLACE semantics:** `get_config_for_path()` applies an override with `dict.update`. So a package's `coverage_paths = ["lib/"]` replaces the root's `["src/"]` rather than adding to it.
- **Only `language` takes effect in core:** it is read by `resolve_language()`. No core command calls `get_config_for_path()`, so the other per-package fields affect only plugins or scripts that call it.

## Plugin sections

`[plugins.<name>]` stays a raw dict unless config is loaded with discovered plugins, as `botcore serve` (`build_namespace`) and `build_host` do. In that case the plugin's `config_schema()` validates the section and replaces it with the model, and a section with no installed plugin produces a warning. Those two paths then call the plugin's `configure()` with it. The CLI's plugin registration and plain `load_config()` calls do neither.

## `[skills]`

| Key | Default | Effect |
|---|---|---|
| `source_dir` | `".claude/skills"` | Directory, relative to the workspace, that skill-seed, list, status, lint, adopt and index use |
| `include` | unset (all) | Only these are seeded or updated; when set, `skip` is ignored |
| `skip` | `[]` | Never seeded or updated |
| `agent_skills` | `false` | Also copy seeded and updated skills to `.agent/skills/` |
| `listing_budget` | `8000` | Positive integer. skill-lint warns (SK019) when the skills' descriptions plus `when_to_use` exceed it; skills with `disable-model-invocation: true` don't count |

Retired skills: on every run, not only with `--update`, skill-seed removes a retired skill's botcore-managed copy (frontmatter `metadata.source: botcore`, or a top-level `source: botcore` in older copies). It does so only when no `include` list is set and `skip` doesn't name the skill (`seed_manages_retired` in `src/botcore/commands/skill/renames.py`). Otherwise it leaves the copy and reports it under `retired_locally_owned`.
