# Python Coding Standards

Detailed conventions for Python code.

## Style and Tooling

- **Formatter:** Black (or Ruff format)
- **Linter:** Ruff or Flake8
- **Line length:** 88 characters (Black default)
- **Imports:** Organized with `isort`

## Type Hints

Required for all function signatures:

```python
def process_data(input_value: str, count: int = 10) -> list[dict]:
    """Process the input value and return results."""
    ...
```

## Naming Conventions

| Element   | Convention         | Example              |
| --------- | ------------------ | -------------------- |
| Variables | snake_case         | `user_count`         |
| Functions | snake_case         | `get_user_data()`    |
| Classes   | PascalCase         | `DataProcessor`      |
| Constants | SCREAMING_SNAKE    | `MAX_RETRIES`        |
| Private   | leading underscore | `_internal_helper()` |

## Docstrings

Use Google-style docstrings:

```python
def fetch_results(query: str, limit: int = 50) -> list[Result]:
    """Fetch results matching the query.

    Args:
        query: Search query string.
        limit: Maximum results to return.

    Returns:
        List of matching Result objects.

    Raises:
        ValueError: If query is empty.
    """
```

## Best Practices

1. **Prefer comprehensions** over explicit loops for simple transformations
2. **Use context managers** (`with`) for resource handling
3. **Avoid mutable default arguments** (use `None` and check)
4. **Use `pathlib.Path`** over string path manipulation
5. **Use f-strings** for string formatting
6. **Use sets** for membership testing (O(1) vs O(n) for lists)
7. **Use generators** for large datasets to avoid loading everything into memory

## Virtual Environments

- Use `venv` or `uv` for environment management
- Include `requirements.txt` or `pyproject.toml`
- Pin versions for reproducibility

## Error Handling

```python
def process_file(filepath: str) -> ProcessedData:
    """Process a data file.

    Raises:
        FileNotFoundError: If file doesn't exist.
        ValueError: If file content is invalid.
    """
    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except FileNotFoundError:
        raise FileNotFoundError(f"Data file not found: {filepath}")
    except PermissionError:
        raise PermissionError(f"Cannot read file: {filepath}")

    if not content.strip():
        raise ValueError(f"File is empty: {filepath}")

    return parse_content(content)
```

### Custom Exceptions

```python
class ConfigError(Exception):
    """Raised when configuration is invalid."""
    pass

class APIError(Exception):
    """Raised when API request fails."""
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code
```

### Context Managers for Cleanup

```python
from contextlib import contextmanager

@contextmanager
def managed_resource(name: str):
    resource = acquire_resource(name)
    try:
        yield resource
    except Exception as e:
        log.error(f"Error with resource {name}: {e}")
        raise
    finally:
        release_resource(resource)
```

## Performance

```python
# Use sets for membership testing
valid_ids = set(get_valid_ids())
if user_id in valid_ids:  # O(1)
    ...

# Use generators for large datasets (lazy evaluation)
total = sum(item.value for item in large_dataset)
```

## Security

```python
# Use environment variables for secrets
API_KEY = os.environ.get("API_KEY")

# Use parameterized queries
cursor.execute(
    "SELECT * FROM users WHERE id = ?",
    (user_id,)
)
```
