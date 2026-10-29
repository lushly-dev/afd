# Quality Checks Reference

## dev_check_size()

```python
async def dev_check_size() -> CommandResult[dict]
```

Checks Python file line counts against configurable thresholds. Large files are hard for agents and humans to navigate.

**Behavior:**
- Scans all `.py` files recursively in the workspace
- Excludes test files and `__pycache__` directories
- Compares line counts against `file_size_warn` and `file_size_error` thresholds

**Config fields:**
| Field | Default | Effect |
|---|---|---|
| `file_size_warn` | 500 | Files above this get a warning |
| `file_size_error` | 1000 | Files above this get an error |

**Return data:**
- `files_checked` — Total files scanned
- `errors` — List of files exceeding error threshold (with line counts)
- `warnings` — List of files exceeding warn threshold
- `ok` — Whether all files are within error threshold

**Per-package override:** Yes — `[tool.botcore.packages.NAME]` can set different thresholds.

## dev_check_coverage()

```python
async def dev_check_coverage() -> CommandResult[dict]
```

Runs pytest with coverage reporting and validates against configured thresholds.

**Behavior:**
- Runs `pytest --cov=<paths> --cov-report=term-missing`
- Parses the total coverage percentage from output
- Compares against `coverage_threshold` (fail) and `coverage_warn_threshold` (warn)

**Config fields:**
| Field | Default | Effect |
|---|---|---|
| `coverage_threshold` | 80 | Below this → error |
| `coverage_warn_threshold` | 60 | Below this → warning |
| `coverage_paths` | `["src/"]` | Paths to measure |
| `coverage_exclude` | `[]` | Exclusion patterns |

**Return data:**
- `coverage_percent` — Measured coverage percentage
- `threshold` — Configured threshold
- `passed` — Whether coverage meets threshold
- `stdout` — Full pytest output

**Per-package override:** Yes — different packages can have different coverage targets.

## dev_check_deps()

```python
async def dev_check_deps() -> CommandResult[dict]
```

Checks Python dependencies against PyPI for version staleness. Requires `httpx` to be installed.

**Behavior:**
1. Reads dependencies from `pyproject.toml`
2. Queries PyPI for latest versions
3. Compares installed vs latest
4. Classifies as error (major behind) or warning (minor behind)

**Config fields:**
| Field | Default | Effect |
|---|---|---|
| `deps_max_major_behind` | 1 | Major versions behind → error |
| `deps_max_minor_behind` | 3 | Minor versions behind → warning |

**Modes:**
- Default: checks all declared dependencies
- Staged mode: checks only dependencies modified in staged git changes

**Return data:**
- `checked` — Number of dependencies checked
- `errors` — Dependencies with major version lag
- `warnings` — Dependencies with minor version lag
- `up_to_date` — Dependencies at or near latest
- `packages` — Full detail per dependency (name, current, latest, lag)

## Threshold Strategy

### For New Projects

```toml
[tool.botcore]
coverage_threshold = 90     # Start strict
file_size_warn = 300        # Keep files small from day one
```

### For Legacy Projects

```toml
[tool.botcore]
coverage_threshold = 50     # Realistic starting point
file_size_error = 2000      # Acknowledge existing large files

[tool.botcore.packages.new-module]
coverage_threshold = 80     # Strict for new code
file_size_warn = 300
```

Ratchet thresholds up over time as quality improves.
