# Todo Example Specification

This directory contains the shared API contract for the Todo example. All backend implementations (TypeScript, Python, etc.) must follow this specification to ensure interoperability with all frontend implementations (Vanilla JS, React, etc.).

## Files

- `commands.schema.json`: JSON Schema defining the input and output for all 11 commands.
- `test-cases.json`: Conformance test cases used to verify backend implementations.
- `README.md`: This file.

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

1. `todo.create`: Create a new todo
2. `todo.list`: List todos with filtering
3. `todo.get`: Get a single todo by ID
4. `todo.update`: Update todo fields
5. `todo.toggle`: Toggle completion status
6. `todo.delete`: Delete a todo
7. `todo.clear`: Clear all completed todos
8. `todo.stats`: Get todo statistics
9. `todo.createBatch`: Create multiple todos
10. `todo.deleteBatch`: Delete multiple todos
11. `todo.toggleBatch`: Toggle multiple todos

## Error Codes

- `NOT_FOUND`: Requested resource doesn't exist
- `VALIDATION_ERROR`: Input failed validation
- `NO_CHANGES`: Update requested but no changes provided
