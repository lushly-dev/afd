# Config Precedence Reference

## Load Flow

```
load_config(workspace, cli_overrides, discovered_plugins)
    │
    ├─ 1. Find workspace root (find_workspace() if not provided)
    │
    ├─ 2. Read TOML config (_read_toml)
    │      ├─ Try pyproject.toml → [tool.botcore]
    │      └─ Fallback to botcore.toml
    │
    ├─ 3. Apply CLI overrides (raw.update(cli_overrides))
    │
    ├─ 4. Validate with Pydantic (BotCoreConfig(**raw))
    │
    ├─ 5. Apply language defaults (_apply_language_defaults)
    │      ├─ Auto-detect language if not set
    │      └─ Fill linter/test_runner/formatter from _TOOL_DEFAULTS
    │
    └─ 6. Validate plugin configs (_validate_plugin_configs)
           ├─ Validate [plugins.X] against plugin schemas
           └─ Warn about orphan plugin config sections
```

## Precedence Layers

From highest to lowest priority:

| Layer | Source | Example |
|---|---|---|
| **1. CLI flags** | `cli_overrides` dict | `--coverage-threshold 90` |
| **2. Project config** | `pyproject.toml` or `botcore.toml` | `coverage_threshold = 85` |
| **3. Language defaults** | `_TOOL_DEFAULTS` dict | Python → linter="ruff" |
| **4. Core defaults** | `BotCoreConfig` field defaults | `coverage_threshold = 80` |

### How Layers Merge

- CLI overrides are applied with `dict.update()` — they completely replace the project config value
- Language defaults only fill `None` fields — they never override explicit config
- Core defaults are Pydantic field defaults — they apply when no other source provides a value

## TOML Source Priority

When both files exist:

1. `pyproject.toml` `[tool.botcore]` — **checked first**
2. `botcore.toml` — fallback only if pyproject.toml has no `[tool.botcore]` section

If pyproject.toml has a `[tool.botcore]` section, `botcore.toml` is **completely ignored**.

## Language Default Application

```python
def _apply_language_defaults(config, workspace):
    # Auto-detect if not explicitly set
    if config.language is None and workspace:
        config.language = detect_language(workspace)

    # Fill tool fields only if still None
    if config.language in _TOOL_DEFAULTS:
        defaults = _TOOL_DEFAULTS[config.language]
        if config.linter is None:
            config.linter = defaults["linter"]
        if config.test_runner is None:
            config.test_runner = defaults["test_runner"]
        if config.formatter is None:
            config.formatter = defaults["formatter"]
```

Key behavior:
- Language auto-detection only runs if `language` is not explicitly set
- Tool defaults only fill fields that are still `None` after config loading
- Explicitly setting `linter = "pylint"` in config prevents the ruff default

## Plugin Config Validation

For each discovered plugin:
1. Call `plugin.config_schema()` to get the Pydantic model (or None)
2. If a schema exists and `[plugins.plugin-name]` exists in config, validate it
3. Warn about config sections with no matching installed plugin

```toml
# This gets validated against the plugin's schema:
[tool.botcore.plugins.my-plugin]
max_retries = 5

# This triggers a warning if "ghost-plugin" is not installed:
[tool.botcore.plugins.ghost-plugin]
some_key = "value"
```

## Common Pitfalls

| Pitfall | What Happens | Fix |
|---|---|---|
| Config in both files | `botcore.toml` is silently ignored | Use one file only |
| Typo in field name | `ValidationError: Extra inputs not permitted` | Check field spelling |
| Setting linter but not language | Language defaults don't override explicit linter | Set both or neither |
| Plugin config without plugin | Warning on load, config section unused | Install plugin or remove section |
