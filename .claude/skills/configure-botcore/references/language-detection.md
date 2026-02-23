# Language Detection Reference

## How Detection Works

When `language` is not set in config, `detect_language(workspace)` examines the workspace root for language-specific marker files.

Detection runs in `_apply_language_defaults()` during config loading, before tool defaults are applied.

## Detection Logic

`detect_language()` in `botcore/utils/workspace.py` checks for:

| Language | Marker Files |
|---|---|
| Python | `pyproject.toml`, `setup.py`, `setup.cfg` |
| TypeScript | `package.json`, `tsconfig.json` |
| Rust | `Cargo.toml` |

When multiple markers are present, the first match in the check order wins. In monorepos, detection runs against the workspace root, not individual package directories.

## Tool Defaults Map

Once a language is detected (or explicitly set), tools are filled from `_TOOL_DEFAULTS`:

```python
_TOOL_DEFAULTS = {
    "python":     {"linter": "ruff",    "test_runner": "pytest",     "formatter": "ruff"},
    "typescript": {"linter": "biome",   "test_runner": "vitest",     "formatter": "biome"},
    "rust":       {"linter": "clippy",  "test_runner": "cargo-test", "formatter": "rustfmt"},
}
```

### Application Rules

1. Defaults only fill fields that are `None` after config loading
2. An explicit `linter = "pylint"` in config prevents the ruff default
3. Setting `language` without setting tools → tools auto-filled from defaults
4. Setting tools without setting `language` → language remains `None`, tools used as-is

## Common Scenarios

### Auto-Detection (most common)

```toml
# pyproject.toml — has [project] section
[tool.botcore]
# language not set → auto-detected as "python"
# linter → ruff, test_runner → pytest, formatter → ruff
```

### Explicit Language

```toml
[tool.botcore]
language = "typescript"
# linter → biome, test_runner → vitest, formatter → biome
```

### Explicit Language + Custom Tool

```toml
[tool.botcore]
language = "python"
linter = "pylint"      # Overrides ruff default
# test_runner → pytest (default), formatter → ruff (default)
```

### Unsupported Language

```toml
[tool.botcore]
language = "go"
# No defaults applied — linter, test_runner, formatter all remain None
# Dev commands will fail with "no linter configured"
```

## Workspace Detection

`find_workspace()` walks up from the current directory looking for workspace root indicators (pyproject.toml, package.json, .git, etc.). This determines where config files are read from.

`detect_package(file_path, workspace)` is separate from workspace detection — it finds which package within a workspace a specific file belongs to, used by `get_config_for_path()` for per-package overrides.
