# Phase 03 - Backends

> **Goal**: Ensure both TypeScript and Python backends implement the full API spec and pass conformance tests.

---

## Current State

| Backend | Commands | Status |
|---------|----------|--------|
| TypeScript | 11/11 | Complete |
| Python | 6/11 | Missing 5 commands |

### Python Missing Commands

| Command | Complexity |
|---------|------------|
| `todo.update` | Medium - partial updates |
| `todo.clear` | Easy - filter and delete |
| `todo.createBatch` | Medium - batch with partial failure |
| `todo.deleteBatch` | Medium - batch with partial failure |
| `todo.toggleBatch` | Medium - batch with optional target state |

---

## TypeScript Backend Tasks

The TypeScript backend is complete but needs minor updates after restructure:

### Task 1: Update imports after move

Update import paths in all command files:

```typescript
// Before (if any relative imports to old locations)
import { store } from '../store/memory.js';

// After (same, but verify paths work)
import { store } from '../store/memory.js';
```

### Task 2: Verify server endpoints

Ensure server exposes:
- `GET /health` — Returns `{ status: "ok", name: "...", version: "..." }`
- `POST /message` — MCP JSON-RPC endpoint
- `GET /sse` — SSE transport for MCP

### Task 3: Add conformance test script

Add to `package.json`:

```json
{
  "scripts": {
    "test:conformance": "cd ../../.. && pnpm example:todo:test"
  }
}
```

---

## Python Backend Tasks

### Task 1: Restructure into commands module

Current single-file `todo_server.py` should become:

```
backends/python/
├── src/
│   ├── __init__.py
│   ├── commands/
│   │   ├── __init__.py
│   │   ├── create.py
│   │   ├── list.py
│   │   ├── get.py
│   │   ├── update.py      # NEW
│   │   ├── toggle.py
│   │   ├── delete.py
│   │   ├── clear.py       # NEW
│   │   ├── stats.py
│   │   ├── create_batch.py  # NEW
│   │   ├── delete_batch.py  # NEW
│   │   └── toggle_batch.py  # NEW
│   ├── store.py           # In-memory store
│   ├── types.py           # Pydantic models
│   └── server.py          # MCP server setup
├── pyproject.toml
└── README.md
```

### Task 2: Implement missing commands

#### todo.update

```python
@server.command(
    name="todo.update",
    description="Update a todo item",
    mutation=True,
)
async def update_todo(input: UpdateTodoInput) -> CommandResult[Todo]:
    todo = store.get(input.id)
    if not todo:
        return error(
            code="NOT_FOUND",
            message=f"Todo '{input.id}' not found",
            suggestion="Use 'todo.list' to see available todos",
        )
    
    changes = []
    if input.title is not None:
        todo.title = input.title
        changes.append(f"title='{input.title}'")
    if input.description is not None:
        todo.description = input.description
        changes.append("description updated")
    if input.priority is not None:
        todo.priority = input.priority
        changes.append(f"priority='{input.priority}'")
    if input.completed is not None:
        todo.completed = input.completed
        changes.append(f"completed={input.completed}")
    
    if not changes:
        return error(
            code="NO_CHANGES",
            message="No fields to update",
            suggestion="Provide at least one field to update",
        )
    
    todo.updated_at = datetime.now().isoformat()
    store.update(todo)
    
    return success(
        data=todo,
        reasoning=f"Updated todo: {', '.join(changes)}",
    )
```

#### todo.clear

```python
@server.command(
    name="todo.clear",
    description="Clear all completed todos",
    mutation=True,
)
async def clear_completed(input: dict = None) -> CommandResult[dict]:
    completed = [t for t in store.list() if t.completed]
    count = len(completed)
    
    for todo in completed:
        store.delete(todo.id)
    
    remaining = len(store.list())
    
    return success(
        data={"cleared": count, "remaining": remaining},
        reasoning=f"Cleared {count} completed todos, {remaining} remaining",
        warnings=[
            Warning(
                code="BULK_DELETE",
                message=f"Permanently deleted {count} todos",
                severity="caution",
            )
        ] if count > 0 else None,
    )
```

#### todo.createBatch

```python
@server.command(
    name="todo.createBatch",
    description="Create multiple todos at once",
    mutation=True,
)
async def create_batch(input: CreateBatchInput) -> CommandResult[BatchCreateResult]:
    succeeded = []
    failed = []
    
    for i, item in enumerate(input.todos):
        try:
            todo = store.create(
                title=item.title,
                description=item.description,
                priority=item.priority or "medium",
            )
            succeeded.append(todo)
        except Exception as e:
            failed.append(FailedItem(
                index=i,
                input=item.dict(),
                error={"code": "VALIDATION_ERROR", "message": str(e)},
            ))
    
    total = len(input.todos)
    success_count = len(succeeded)
    failure_count = len(failed)
    confidence = success_count / total if total > 0 else 1.0
    
    return success(
        data=BatchCreateResult(
            succeeded=succeeded,
            failed=failed,
            summary=BatchSummary(
                total=total,
                successCount=success_count,
                failureCount=failure_count,
            ),
        ),
        reasoning=f"Created {success_count} of {total} todos" + 
                  (f". {failure_count} failed." if failure_count > 0 else ""),
        confidence=confidence,
        warnings=[
            Warning(
                code="PARTIAL_SUCCESS",
                message=f"{failure_count} of {total} items could not be created",
                severity="warning",
            )
        ] if failure_count > 0 else None,
    )
```

#### todo.deleteBatch

```python
@server.command(
    name="todo.deleteBatch",
    description="Delete multiple todos at once",
    mutation=True,
)
async def delete_batch(input: DeleteBatchInput) -> CommandResult[BatchDeleteResult]:
    deleted_ids = []
    failed = []
    
    for i, id in enumerate(input.ids):
        todo = store.get(id)
        if todo:
            store.delete(id)
            deleted_ids.append(id)
        else:
            failed.append(FailedDelete(
                index=i,
                id=id,
                error={"code": "NOT_FOUND", "message": "Todo not found"},
            ))
    
    total = len(input.ids)
    success_count = len(deleted_ids)
    failure_count = len(failed)
    confidence = success_count / total if total > 0 else 1.0
    
    warnings = []
    if success_count > 0:
        warnings.append(Warning(
            code="DESTRUCTIVE_BATCH",
            message=f"Permanently deleted {success_count} todos",
            severity="caution",
        ))
    if failure_count > 0:
        warnings.append(Warning(
            code="PARTIAL_SUCCESS",
            message=f"{failure_count} of {total} items could not be deleted",
            severity="warning",
        ))
    
    return success(
        data=BatchDeleteResult(
            deletedIds=deleted_ids,
            failed=failed,
            summary=BatchSummary(
                total=total,
                successCount=success_count,
                failureCount=failure_count,
            ),
        ),
        reasoning=f"Deleted {success_count} of {total} todos" +
                  (f". {failure_count} were not found." if failure_count > 0 else ""),
        confidence=confidence,
        warnings=warnings if warnings else None,
    )
```

#### todo.toggleBatch

```python
@server.command(
    name="todo.toggleBatch",
    description="Toggle multiple todos, or set all to specific state",
    mutation=True,
)
async def toggle_batch(input: ToggleBatchInput) -> CommandResult[BatchToggleResult]:
    succeeded = []
    failed = []
    marked_complete = 0
    marked_incomplete = 0
    
    for i, id in enumerate(input.ids):
        todo = store.get(id)
        if not todo:
            failed.append(FailedToggle(
                index=i,
                id=id,
                error={"code": "NOT_FOUND", "message": "Todo not found"},
            ))
            continue
        
        # Determine new state
        if input.completed is not None:
            new_state = input.completed
        else:
            new_state = not todo.completed
        
        # Track what changed
        if new_state and not todo.completed:
            marked_complete += 1
        elif not new_state and todo.completed:
            marked_incomplete += 1
        
        todo.completed = new_state
        todo.updated_at = datetime.now().isoformat()
        if new_state:
            todo.completed_at = datetime.now().isoformat()
        else:
            todo.completed_at = None
        
        store.update(todo)
        succeeded.append(todo)
    
    total = len(input.ids)
    success_count = len(succeeded)
    failure_count = len(failed)
    confidence = success_count / total if total > 0 else 1.0
    
    # Build reasoning
    if input.completed is not None:
        action = "complete" if input.completed else "incomplete"
        reasoning = f"Successfully set to {action} all {success_count} todos"
    else:
        reasoning = f"Toggled {success_count} todos"
    
    return success(
        data=BatchToggleResult(
            succeeded=succeeded,
            failed=failed,
            summary=ToggleBatchSummary(
                total=total,
                successCount=success_count,
                failureCount=failure_count,
                markedComplete=marked_complete,
                markedIncomplete=marked_incomplete,
            ),
        ),
        reasoning=reasoning,
        confidence=confidence,
    )
```

### Task 3: Update store implementation

Ensure Python store has these methods:

```python
class TodoStore:
    def create(self, title: str, description: str = None, priority: str = "medium") -> Todo
    def get(self, id: str) -> Optional[Todo]
    def list(self, **filters) -> List[Todo]
    def update(self, todo: Todo) -> Todo
    def delete(self, id: str) -> bool
    def toggle(self, id: str) -> Optional[Todo]
    def clear_completed(self) -> int
    def get_stats(self) -> TodoStats
```

### Task 4: Match TypeScript response format

Ensure Python returns identical JSON structure:

```python
# Timestamps must be ISO 8601
todo.created_at = datetime.utcnow().isoformat() + "Z"

# Field names must match (camelCase in JSON)
class Todo(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    priority: str = "medium"
    completed: bool = False
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")
    completed_at: Optional[str] = Field(None, alias="completedAt")
    
    class Config:
        populate_by_name = True
```

### Task 5: Expose HTTP endpoints

Python server must expose same endpoints as TypeScript:

```python
# Using FastAPI + FastMCP
from fastapi import FastAPI
from fastmcp import FastMCP

app = FastAPI()
mcp = FastMCP("todo-app")

# Health check
@app.get("/health")
async def health():
    return {"status": "ok", "name": "todo-app", "version": "1.0.0"}

# MCP endpoint
@app.post("/message")
async def message(request: dict):
    return await mcp.handle_message(request)

# SSE endpoint
@app.get("/sse")
async def sse():
    return mcp.sse_handler()
```

---

## Conformance Testing

Both backends must pass the same test suite:

```bash
# Start TypeScript backend
pnpm --filter @afd/example-todo-ts start &

# Run conformance tests
BACKEND_URL=http://localhost:3100 pnpm example:todo:test

# Stop, start Python backend
cd packages/examples/todo/backends/python
python -m src.server &

# Run same tests
BACKEND_URL=http://localhost:3100 pnpm example:todo:test
```

---

## Tasks

### TypeScript
- [ ] Update imports after restructure
- [ ] Verify all endpoints work
- [ ] Add conformance test script

### Python
- [ ] Create modular folder structure
- [ ] Implement `todo.update`
- [ ] Implement `todo.clear`
- [ ] Implement `todo.createBatch`
- [ ] Implement `todo.deleteBatch`
- [ ] Implement `todo.toggleBatch`
- [ ] Update store with all required methods
- [ ] Match JSON response format (camelCase)
- [ ] Expose HTTP endpoints
- [ ] Pass conformance tests

---

## Validation Criteria

Phase 03 is complete when:

1. Both backends expose identical HTTP endpoints
2. Both backends implement all 11 commands
3. Both backends pass the conformance test suite
4. Response JSON structure is identical between backends

---

## Next Phase

[Phase 04 - Frontends](./04-frontends.plan.md) — Update Vanilla JS and add React frontend
