# Troubleshooting Reference

## Common Errors and Resolutions

### dev_lint / dev_test / dev_build

| Error | Cause | Resolution |
|---|---|---|
| "No language detected" | No pyproject.toml, package.json, or Cargo.toml found | Set `language` explicitly in config, or ensure you're in the right directory |
| "No linter configured" | Language detected but no linter in `_TOOL_DEFAULTS` | Set `linter` explicitly in `[tool.botcore]` |
| "ruff: command not found" | Linter not installed | `pip install ruff` (or the appropriate tool) |
| "pytest: command not found" | Test runner not installed | `pip install pytest` |
| Non-zero exit code from linter | Lint errors found | Read the linter output and fix reported issues |
| Non-zero exit code from tests | Test failures | Read test output, fix failing tests |

### dev_check_size

| Error | Cause | Resolution |
|---|---|---|
| Files exceeding error threshold | File has too many lines | Refactor into smaller modules. Target < 300 lines per file. |
| Many files at warning level | Growing code without splitting | Proactively split before files reach error threshold |

**Tips for reducing file size:**
- Extract helper functions into utility modules
- Split command files by domain (e.g., `commands/dev/core.py` + `commands/dev/quality.py`)
- Move constants and type definitions to separate files

### dev_check_coverage

| Error | Cause | Resolution |
|---|---|---|
| Coverage below threshold | Insufficient test coverage | Add tests for uncovered code paths |
| `coverage_paths` mismatch | Config points to wrong directory | Check `coverage_paths` matches your source layout |
| "pytest-cov not installed" | Missing coverage plugin | `pip install pytest-cov` |
| Coverage drops after refactor | Tests not updated for new structure | Update test imports and add tests for new modules |

### dev_check_deps

| Error | Cause | Resolution |
|---|---|---|
| Major version behind | Dependency has a newer major version | Review changelog, test upgrade, update version pin |
| Minor version behind | Dependency has newer minor versions | Update version pin (usually safe) |
| "httpx not installed" | Missing HTTP client | `pip install httpx` |
| PyPI request timeout | Network issues | Retry, or check network connectivity |

### dev_dead_code (vulture)

| Error | Cause | Resolution |
|---|---|---|
| False positive on plugin entry | Vulture doesn't see entry-point usage | Add to vulture whitelist or lower confidence threshold |
| False positive on test fixtures | pytest fixtures look unused to vulture | Add to whitelist |
| "vulture: command not found" | Not installed | `pip install vulture` |

### dev_circular_imports

| Error | Cause | Resolution |
|---|---|---|
| Cycle detected | Module A imports B, B imports A | Extract shared types into a third module |
| `TYPE_CHECKING` cycles | Cycles only in type annotations | Use `from __future__ import annotations` + `TYPE_CHECKING` guard |
| False cycle from re-exports | `__init__.py` re-exports cause apparent cycles | Review if the cycle is real or just re-export noise |

### dev_check_paths (portability)

| Error | Cause | Resolution |
|---|---|---|
| Hardcoded Windows path | `C:\Users\...` in source | Use `Path.home()` or environment variables |
| Hardcoded Unix path | `/home/user/...` in source | Use `pathlib.Path` with relative paths |
| Localhost URL flagged | `http://localhost:3000` in source | Usually a warning — add to `path_check_allowlist` if intentional |

## General Debugging

### Check Config Loading

```python
from botcore.config import load_config
config = load_config()
print(f"Language: {config.language}")
print(f"Linter: {config.linter}")
print(f"Test runner: {config.test_runner}")
print(f"Coverage threshold: {config.coverage_threshold}")
```

### Check Workspace Detection

```python
from botcore.utils.workspace import find_workspace, detect_language
ws = find_workspace()
print(f"Workspace: {ws}")
print(f"Language: {detect_language(ws)}")
```

### Run a Single Command Directly

```python
import asyncio
from botcore.commands.dev import dev_lint
result = asyncio.run(dev_lint())
print(result)
```
