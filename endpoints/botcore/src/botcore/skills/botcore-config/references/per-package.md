# Per-Package Overrides Reference

## Purpose

In monorepos, different packages may need different quality thresholds. Per-package overrides let you set stricter or more lenient limits for individual packages without affecting the root config.

## Config Syntax

```toml
[tool.botcore]
# Root defaults
coverage_threshold = 80
file_size_warn = 500

[tool.botcore.packages.my-strict-package]
coverage_threshold = 95
file_size_warn = 300

[tool.botcore.packages.my-lenient-package]
coverage_threshold = 60
file_size_error = 2000
```

## How get_config_for_path() Works

```python
def get_config_for_path(config, file_path, workspace):
    base = config.model_dump()                    # Start with root config
    package_name = detect_package(file_path, workspace)  # Find package
    if package_name and package_name in config.packages:
        overrides = config.packages[package_name].model_dump(exclude_none=True)
        base.update(overrides)                    # REPLACE semantics
    return base
```

### REPLACE Semantics

Per-package overrides **replace**, not merge:

```toml
[tool.botcore]
coverage_paths = ["src/", "lib/"]

[tool.botcore.packages.my-package]
coverage_paths = ["lib/"]
# Result for my-package: coverage_paths = ["lib/"]  ← NOT ["src/", "lib/"]
```

This is intentional. When a package needs different paths, it needs different paths — not the root paths plus its own.

## Overridable Fields

Only fields in `PackageOverrideConfig` can be overridden per-package:

| Field | Root Default | What It Controls |
|---|---|---|
| `file_size_warn` | 500 | `dev_check_size` warning threshold |
| `file_size_error` | 1000 | `dev_check_size` error threshold |
| `coverage_threshold` | 80 | `dev_check_coverage` failure threshold |
| `coverage_warn_threshold` | 60 | `dev_check_coverage` warning threshold |
| `coverage_paths` | `["src/"]` | Paths to measure coverage |
| `coverage_exclude` | `[]` | Coverage exclusion patterns |
| `duplication_threshold` | 5 | Max duplicate code occurrences |
| `duplication_min_lines` | 10 | Min lines for duplication detection |
| `circular_deps_allowed` | 0 | Allowed circular dependency cycles |

Fields **not** overridable per-package: `language`, `linter`, `test_runner`, `formatter`, `skills`, `plugins`.

## Package Detection

`detect_package(file_path, workspace)` determines which package a file belongs to by walking up from the file's directory looking for `pyproject.toml` or `package.json`.

The package name is read from the manifest and matched against `config.packages` keys.

## Example: Monorepo with Mixed Standards

```toml
[tool.botcore]
language = "python"
coverage_threshold = 80
file_size_warn = 500

# New package, strict standards
[tool.botcore.packages.botcore]
coverage_threshold = 90
file_size_warn = 300

# Legacy package, relaxed while migrating
[tool.botcore.packages.old-service]
coverage_threshold = 50
file_size_error = 2000
circular_deps_allowed = 3
```
