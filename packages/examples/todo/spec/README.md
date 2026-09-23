# Todo Example Specification

This directory contains the shared API contract for the Todo example. All backend implementations (TypeScript, Python, etc.) must follow this specification to ensure interoperability with all frontend implementations (Vanilla JS, React, etc.).

## Files

- `commands.schema.json`: JSON Schema defining the input and output for all 11 commands,
  keyed by MCP tool name. The TypeScript and Python test suites fail if it does not list
  exactly the commands their backend defines.
- `test-cases.json`: Conformance test cases used to verify backend implementations.
- `README.md`: This file.

## Conformance Test Cases

`pnpm test:conformance:ts` and `pnpm test:conformance:py` (from `packages/examples/todo`) start a
backend over stdio with an in-memory store and run every case in `test-cases.json`. Before each
case the runner calls `todo-clear` with `{ "all": true }`, then runs the `setup` steps (a step's
`capture` stores its `data`, which later inputs reference as `"$name.field"`), then the command.

Each `expect` entry maps a dotted path in the `CommandResult` to a value. Paths may index arrays
and read `.length` (`data.todos.0.title`, `data.todos.length`). The value is either the exact
JSON value expected, or `{ "exists": true }` / `{ "exists": false }` to check that a field is
present (not `null` or missing) without fixing its value.

## Data Types

### Todo

```typescript
interface Todo {
  id: string; // Unique identifier
  title: string; // 1-200 characters
  description?: string; // Optional, max 1000 characters
  priority: "low" | "medium" | "high";
  completed: boolean;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
  completedAt?: string; // ISO 8601 timestamp, present when completed=true
}
```

### CommandResult

All commands return AFD-compliant results:

```typescript
interface CommandResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    retryable?: boolean;
  };
  reasoning?: string;
  confidence?: number;
  warnings?: Warning[];
  alternatives?: Alternative<T>[];
  metadata?: {
    executionTimeMs?: number;
  };
}
```

## Commands

Command names are kebab-case MCP tool names, and every command is exposed to MCP clients.

1. `todo-create`: Create a new todo
2. `todo-list`: List todos with filtering, sorting and pagination
3. `todo-get`: Get a single todo by ID
4. `todo-update`: Update todo fields
5. `todo-toggle`: Toggle completion status
6. `todo-delete`: Delete a todo
7. `todo-clear`: Clear completed todos, or all todos with `{ "all": true }`
8. `todo-stats`: Get todo statistics
9. `todo-create-batch`: Create multiple todos (1-100)
10. `todo-delete-batch`: Delete multiple todos (1-100 IDs)
11. `todo-toggle-batch`: Toggle multiple todos, or set them all with `completed`

## Error Codes

Every error includes a `suggestion` for recovery.

- `NOT_FOUND`: Requested resource doesn't exist
- `VALIDATION_ERROR`: Input failed validation
- `NO_CHANGES`: Update requested but no changes provided

Batch commands report per-item failures in `data.failed` (with the same error codes) and still
return `success: true`; they fail as a whole only when the input itself is invalid.
