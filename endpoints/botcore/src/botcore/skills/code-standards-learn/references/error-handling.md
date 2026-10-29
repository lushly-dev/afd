# Error Handling Patterns

Guidelines for consistent error handling.

## Principles

1. **Fail fast** -- Validate inputs early
2. **Be specific** -- Use descriptive error messages
3. **Handle gracefully** -- Provide fallbacks where appropriate
4. **Log for debugging** -- Include context in error logs

## JavaScript/TypeScript

### Try/Catch Pattern

```typescript
async function fetchUserData(userId: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${userId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch user ${userId}:`, error);
    throw new Error(`Unable to load user data: ${error.message}`);
  }
}
```

### Custom Error Classes

```typescript
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}
```

### Result Pattern (Alternative to Exceptions)

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

function parseConfig(input: string): Result<Config> {
  try {
    const config = JSON.parse(input);
    return { success: true, data: config };
  } catch (e) {
    return { success: false, error: new Error("Invalid JSON") };
  }
}

const result = parseConfig(rawInput);
if (result.success) {
  useConfig(result.data);
} else {
  showError(result.error.message);
}
```

## Python

### Exception Handling

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

## Error Message Quality

Good error messages are:

- **Specific:** What went wrong
- **Actionable:** What the user can do
- **Contextual:** Relevant details (IDs, values, limits)

```typescript
// Good
throw new Error(
  `Failed to save document "${doc.title}": ` +
    `File size (${doc.size}MB) exceeds limit (10MB). ` +
    `Try reducing image sizes.`
);

// Bad
throw new Error("Save failed");
```

## Checklist

- [ ] Inputs validated early with clear error messages
- [ ] Try/catch blocks around operations that can fail
- [ ] Errors logged with sufficient context for debugging
- [ ] User-facing errors are helpful, not technical dumps
- [ ] Resources cleaned up in finally blocks or with context managers
- [ ] Error types are specific and distinguishable
