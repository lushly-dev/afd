# Phase 01 - API Specification

> **Goal**: Define a shared API contract that all backend implementations must follow, with conformance test cases to verify compliance.

---

## Deliverables

| Deliverable | Location | Purpose |
|-------------|----------|---------|
| `commands.schema.json` | `packages/examples/todo/spec/` | JSON Schema defining all commands |
| `test-cases.json` | `packages/examples/todo/spec/` | Conformance test cases |
| `README.md` | `packages/examples/todo/spec/` | Human-readable contract docs |

---

## Data Types

### Todo

The core entity. All backends must return todos with this exact structure:

```typescript
interface Todo {
  id: string;           // Unique identifier (e.g., "todo-1234567890-abc")
  title: string;        // 1-200 characters
  description?: string; // Optional, max 1000 characters
  priority: "low" | "medium" | "high";
  completed: boolean;
  createdAt: string;    // ISO 8601 timestamp
  updatedAt: string;    // ISO 8601 timestamp
  completedAt?: string; // ISO 8601 timestamp, present when completed=true
}
```

### TodoStats

Statistics response:

```typescript
interface TodoStats {
  total: number;
  completed: number;
  pending: number;
  byPriority: {
    low: number;
    medium: number;
    high: number;
  };
  completionRate: number; // 0.0 to 1.0
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
  confidence?: number;      // 0.0 to 1.0
  warnings?: Warning[];
  alternatives?: Alternative<T>[];
  metadata?: {
    executionTimeMs?: number;
  };
}

interface Warning {
  code: string;
  message: string;
  severity?: "info" | "warning" | "caution";
}

interface Alternative<T> {
  data: T;
  reason: string;
  confidence?: number;
}
```

---

## Commands Specification

### 1. todo.create (mutation)

Create a new todo item.

**Input:**
```json
{
  "title": "string (required, 1-200 chars)",
  "description": "string (optional, max 1000 chars)",
  "priority": "low | medium | high (default: medium)"
}
```

**Success Output:**
```json
{
  "success": true,
  "data": { /* Todo object */ },
  "reasoning": "Created todo \"Buy groceries\" with medium priority",
  "confidence": 1.0
}
```

**Errors:**
| Code | When |
|------|------|
| `VALIDATION_ERROR` | Title empty or too long |

---

### 2. todo.list (query)

List todos with optional filtering and pagination.

**Input:**
```json
{
  "completed": "boolean (optional) - filter by status",
  "priority": "low | medium | high (optional)",
  "search": "string (optional) - search in title/description",
  "sortBy": "createdAt | updatedAt | priority | title (default: createdAt)",
  "sortOrder": "asc | desc (default: desc)",
  "limit": "number 1-100 (default: 20)",
  "offset": "number >= 0 (default: 0)"
}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "todos": [ /* Array of Todo objects */ ],
    "total": 42,
    "hasMore": true
  },
  "reasoning": "Found 42 todos (pending, high priority), returning 20 starting at offset 0",
  "confidence": 1.0,
  "alternatives": [
    {
      "data": { "todos": [...], "total": 100, "hasMore": false },
      "reason": "View all 100 todos without filters",
      "confidence": 1.0
    }
  ]
}
```

**Notes:**
- `alternatives` should be returned when filters are applied, offering unfiltered view

---

### 3. todo.get (query)

Get a single todo by ID.

**Input:**
```json
{
  "id": "string (required)"
}
```

**Success Output:**
```json
{
  "success": true,
  "data": { /* Todo object */ },
  "reasoning": "Retrieved todo \"Buy groceries\"",
  "confidence": 1.0
}
```

**Errors:**
| Code | When |
|------|------|
| `NOT_FOUND` | Todo with ID doesn't exist |

---

### 4. todo.update (mutation)

Update a todo's fields.

**Input:**
```json
{
  "id": "string (required)",
  "title": "string (optional, 1-200 chars)",
  "description": "string (optional, max 1000 chars)",
  "priority": "low | medium | high (optional)",
  "completed": "boolean (optional)"
}
```

**Success Output:**
```json
{
  "success": true,
  "data": { /* Updated Todo object */ },
  "reasoning": "Updated todo: title='New title', priority='high'",
  "confidence": 1.0
}
```

**Errors:**
| Code | When |
|------|------|
| `NOT_FOUND` | Todo with ID doesn't exist |
| `NO_CHANGES` | No fields to update provided |
| `VALIDATION_ERROR` | Invalid field values |

---

### 5. todo.toggle (mutation)

Toggle completion status of a todo.

**Input:**
```json
{
  "id": "string (required)"
}
```

**Success Output:**
```json
{
  "success": true,
  "data": { /* Updated Todo object */ },
  "reasoning": "Marked as completed: \"Buy groceries\"",
  "confidence": 1.0
}
```

**Errors:**
| Code | When |
|------|------|
| `NOT_FOUND` | Todo with ID doesn't exist |

---

### 6. todo.delete (mutation)

Delete a todo.

**Input:**
```json
{
  "id": "string (required)"
}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "deleted": true,
    "id": "todo-123"
  },
  "reasoning": "Deleted todo \"Buy groceries\"",
  "confidence": 1.0,
  "warnings": [
    {
      "code": "PERMANENT",
      "message": "This action cannot be undone",
      "severity": "info"
    }
  ]
}
```

**Errors:**
| Code | When |
|------|------|
| `NOT_FOUND` | Todo with ID doesn't exist |

---

### 7. todo.clear (mutation)

Clear all completed todos.

**Input:**
```json
{}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "cleared": 5,
    "remaining": 10
  },
  "reasoning": "Cleared 5 completed todos, 10 remaining",
  "confidence": 1.0,
  "warnings": [
    {
      "code": "BULK_DELETE",
      "message": "Permanently deleted 5 todos",
      "severity": "caution"
    }
  ]
}
```

---

### 8. todo.stats (query)

Get todo statistics.

**Input:**
```json
{}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "total": 15,
    "completed": 5,
    "pending": 10,
    "byPriority": {
      "low": 3,
      "medium": 7,
      "high": 5
    },
    "completionRate": 0.333
  },
  "reasoning": "15 total todos, 5 completed, 10 pending, 33% completion rate",
  "confidence": 1.0
}
```

---

### 9. todo.createBatch (mutation)

Create multiple todos at once.

**Input:**
```json
{
  "todos": [
    { "title": "Task 1", "priority": "high" },
    { "title": "Task 2" }
  ]
}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "succeeded": [ /* Array of created Todo objects */ ],
    "failed": [],
    "summary": {
      "total": 2,
      "successCount": 2,
      "failureCount": 0
    }
  },
  "reasoning": "Successfully created all 2 todos",
  "confidence": 1.0
}
```

**Partial Failure Output:**
```json
{
  "success": true,
  "data": {
    "succeeded": [ /* Created todos */ ],
    "failed": [
      {
        "index": 1,
        "input": { "title": "" },
        "error": { "code": "VALIDATION_ERROR", "message": "Title is required" }
      }
    ],
    "summary": {
      "total": 3,
      "successCount": 2,
      "failureCount": 1
    }
  },
  "reasoning": "Created 2 of 3 todos. 1 failed validation.",
  "confidence": 0.67,
  "warnings": [
    {
      "code": "PARTIAL_SUCCESS",
      "message": "1 of 3 items could not be created",
      "severity": "warning"
    }
  ]
}
```

---

### 10. todo.deleteBatch (mutation)

Delete multiple todos at once.

**Input:**
```json
{
  "ids": ["todo-1", "todo-2", "todo-3"]
}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "deletedIds": ["todo-1", "todo-2"],
    "failed": [
      {
        "index": 2,
        "id": "todo-3",
        "error": { "code": "NOT_FOUND", "message": "Todo not found" }
      }
    ],
    "summary": {
      "total": 3,
      "successCount": 2,
      "failureCount": 1
    }
  },
  "confidence": 0.67,
  "reasoning": "Deleted 2 of 3 todos. 1 were not found.",
  "warnings": [
    {
      "code": "DESTRUCTIVE_BATCH",
      "message": "Permanently deleted 2 todos",
      "severity": "caution"
    }
  ]
}
```

---

### 11. todo.toggleBatch (mutation)

Toggle multiple todos, or set all to specific state.

**Input:**
```json
{
  "ids": ["todo-1", "todo-2"],
  "completed": true  // Optional: if provided, set all to this state
}
```

**Success Output:**
```json
{
  "success": true,
  "data": {
    "succeeded": [ /* Updated Todo objects */ ],
    "failed": [],
    "summary": {
      "total": 2,
      "successCount": 2,
      "failureCount": 0,
      "markedComplete": 2,
      "markedIncomplete": 0
    }
  },
  "reasoning": "Successfully set to complete all 2 todos",
  "confidence": 1.0
}
```

---

## Error Codes

All backends must use these standardized error codes:

| Code | Meaning |
|------|---------|
| `NOT_FOUND` | Requested resource doesn't exist |
| `VALIDATION_ERROR` | Input failed validation |
| `NO_CHANGES` | Update requested but no changes provided |

All errors must include:
- `code` — Machine-readable error code
- `message` — Human-readable description
- `suggestion` — Actionable recovery hint (recommended)

---

## Conformance Test Cases

Tests will be defined in `test-cases.json` with this structure:

```json
{
  "tests": [
    {
      "name": "create_basic",
      "description": "Create a todo with minimal fields",
      "setup": [],
      "command": "todo.create",
      "input": { "title": "Test todo" },
      "expect": {
        "success": true,
        "data.title": "Test todo",
        "data.priority": "medium",
        "data.completed": false
      }
    },
    {
      "name": "get_not_found",
      "description": "Get non-existent todo returns NOT_FOUND",
      "setup": [],
      "command": "todo.get",
      "input": { "id": "nonexistent" },
      "expect": {
        "success": false,
        "error.code": "NOT_FOUND"
      }
    }
  ]
}
```

### Test Categories

| Category | Count | Purpose |
|----------|-------|---------|
| CRUD Operations | ~15 | Basic create/read/update/delete |
| Filtering | ~8 | List with various filters |
| Batch Operations | ~10 | Batch create/delete/toggle |
| Error Handling | ~10 | All error codes triggered |
| AFD Compliance | ~5 | Verify reasoning, confidence, warnings |

---

## Tasks

- [ ] Define `commands.schema.json` with JSON Schema for all 11 commands
- [ ] Define `test-cases.json` with ~50 conformance tests
- [ ] Write `README.md` documenting the contract
- [ ] Create test runner that loads test cases and runs against any `BACKEND_URL`

---

## Validation Criteria

Phase 01 is complete when:

1. JSON Schema validates both TypeScript and Python command implementations
2. Test cases document all happy paths and error cases
3. Test runner can execute against `http://localhost:3100` and report pass/fail

---

## Next Phase

[Phase 02 - Restructure](./02-restructure.plan.md) — Reorganize folder structure
