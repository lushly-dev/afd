# Command Authoring Reference

## The Async + CommandResult Pattern

Every botcore command follows the same contract:

```python
async def my_command(arg1: str, arg2: int = 0) -> CommandResult[dict]:
    """Short description of what this command does."""
    ...
```

### Rules

1. **Always async** — All commands must be `async def`
2. **Always returns `CommandResult[T]`** — Import from `afd`
3. **Use `success()` for happy paths** — Wraps data + reasoning
4. **Use `error()` for expected failures** — Never raise for business logic errors
5. **Type the generic** — `CommandResult[dict]` tells consumers what `data` contains

## CommandResult API

```python
from afd import CommandResult, success, error
```

### success(data, reasoning=...)

```python
return success(
    {"files_checked": 42, "issues": []},
    reasoning="All 42 files passed lint checks"
)
```

- `data` — The structured result (dict, list, or any serializable type)
- `reasoning` — Human-readable explanation of the outcome (shown in MCP responses)

### error(message)

```python
return error("Package 'nonexistent' not found in any workspace")
```

- `message` — Explanation of what went wrong and ideally how to fix it

## Parameter Conventions

### Required vs Optional

```python
async def my_command(
    name: str,                    # Required — no default
    language: str | None = None,  # Optional — None means "all"
    verbose: bool = False,        # Optional flag
) -> CommandResult[dict]:
```

### Common Patterns

| Pattern | Example |
|---|---|
| Filter parameter | `language: str \| None = None` — None means "show all" |
| Boolean flag | `verbose: bool = False` |
| Path parameter | `path: str \| None = None` — None means "current directory" |
| Threshold | `confidence: int = 80` — numeric with sensible default |

## Docstrings

Write a single-line docstring. The MCP server uses this as the tool description:

```python
async def dev_lint() -> CommandResult[dict]:
    """Run language-appropriate linter on the current workspace."""
```

Multi-line docstrings work but only the first line appears in tool listings.

## Error Handling

### Expected Failures → error()

```python
async def lib_package_info(name: str) -> CommandResult[dict]:
    packages = _discover_all(root)
    match = next((p for p in packages if p["name"] == name), None)
    if match is None:
        return error(f"Package '{name}' not found. Use lib_package_list() to see available packages.")
    return success(match, reasoning=f"Found {name}")
```

### Unexpected Failures → Let Them Propagate

Don't catch exceptions that indicate bugs. Let them propagate so the MCP framework logs them:

```python
# Good — let FileNotFoundError propagate if config file is missing
config = toml.loads(Path("botcore.toml").read_text())

# Bad — swallowing unexpected errors
try:
    config = toml.loads(Path("botcore.toml").read_text())
except Exception:
    return error("Something went wrong")
```

## Returning Structured Data

Always return dicts with consistent, documented keys:

```python
return success({
    "packages": [{"name": "foo", "version": "1.0.0"}],
    "total": 1,
    "by_language": {"python": 1, "typescript": 0},
}, reasoning="Found 1 package")
```

### Data Design Guidelines

- Include a `total` or `count` field when returning lists
- Include summary/aggregate fields alongside detail lists
- Use snake_case keys
- Return booleans as `True`/`False`, not strings
- Include enough context for the reasoning to be self-contained

## Real-World Examples

### Simple Query Command

```python
async def lib_status() -> CommandResult[dict]:
    """Aggregate monorepo health overview."""
    root = _find_libraries_root()
    if root is None:
        return error("Not inside the libraries monorepo")
    ts_pkgs = _discover_ts_packages(root)
    py_pkgs = _discover_py_packages(root)
    return success({
        "root": str(root),
        "packages": {"total": len(ts_pkgs) + len(py_pkgs)},
        "ts_packages": [p["name"] for p in ts_pkgs],
        "py_packages": [p["name"] for p in py_pkgs],
    }, reasoning=f"Found {len(ts_pkgs) + len(py_pkgs)} packages")
```

### Command with Filtering

```python
async def lib_package_list(language: str | None = None) -> CommandResult[dict]:
    """List all packages across TS and Python workspaces."""
    root = _find_libraries_root()
    packages = []
    if language != "typescript":
        packages.extend(_discover_py_packages(root))
    if language != "python":
        packages.extend(_discover_ts_packages(root))
    return success({
        "packages": packages,
        "total": len(packages),
    }, reasoning=f"Found {len(packages)} packages")
```
