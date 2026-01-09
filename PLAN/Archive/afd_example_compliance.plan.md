---
name: AFD Example Compliance
overview: Update the Todo example app to fully demonstrate AFD principles, fixing "do as I say, not as I do" gaps by making the UI display all UX-enabling metadata (confidence, warnings, suggestions) and adding proper confirmation flows for destructive actions.
todos:
  - id: server-execution-time
    content: Add metadata.executionTimeMs to all command responses in server.ts
    status: completed
  - id: ui-confidence
    content: Add confidence indicator to UI (toast/badge after operations)
    status: completed
  - id: ui-warnings
    content: Display warnings from command results (especially delete warning)
    status: completed
  - id: ui-confirmation
    content: Add confirmation dialog for destructive actions (delete)
    status: completed
  - id: ui-error-suggestions
    content: Show error.suggestion in error displays
    status: completed
  - id: command-alternatives
    content: Add alternatives example to todo.list when filters applied
    status: completed
  - id: update-readme
    content: Document which AFD patterns the example demonstrates
    status: completed
  - id: verify-compliance
    content: Test all patterns work via CLI and UI
    status: completed
---

# AFD Example Compliance: Practice What We Preach

Make the Todo example a compelling demonstration of AFD principles by having the UI actually use the UX-enabling metadata that commands return.

## Problem Statement

The current Todo example documents AFD patterns but doesn't fully implement them:

- Commands return `confidence`, `warnings`, `reasoning`, `suggestions` - but UI ignores most of it
- Delete is destructive but has no confirmation despite returning a warning
- Error suggestions exist but aren't shown to users
- `metadata.executionTimeMs` is never populated

## Key Files to Modify

### UI Layer

- [packages/examples/todo-app/ui/app.js](packages/examples/todo-app/ui/app.js) - Main UI logic
- [packages/examples/todo-app/ui/index.html](packages/examples/todo-app/ui/index.html) - Add UI elements for metadata display
- [packages/examples/todo-app/ui/styles.css](packages/examples/todo-app/ui/styles.css) - Styles for new components

### Server Layer  

- [packages/server/src/server.ts](packages/server/src/server.ts) - Add executionTimeMs to responses

### Commands (minor tweaks)

- [packages/examples/todo-app/src/commands/list.ts](packages/examples/todo-app/src/commands/list.ts) - Add alternatives example

## Implementation

### Phase 1: Server - Add Execution Time

Update `createMcpServer` to automatically add `metadata.executionTimeMs` to all command results.

```typescript
// In server.ts - wrap handler execution
const startTime = performance.now();
const result = await cmd.handler(validInput, context);
const executionTimeMs = performance.now() - startTime;

// Merge into result
result.metadata = { ...result.metadata, executionTimeMs };
```

### Phase 2: UI - Display Confidence Indicator

Add a small confidence badge that appears after operations:

```html
<!-- Toast/notification area -->
<div id="toast" class="toast hidden">
  <span class="toast-message"></span>
  <span class="toast-confidence" title="Command confidence"></span>
</div>
```

Show confidence as a visual indicator (e.g., checkmark color intensity, or explicit percentage for lower confidence).

### Phase 3: UI - Display Warnings

When commands return warnings, show them prominently:

```javascript
if (result.warnings?.length > 0) {
  showWarnings(result.warnings);
}

function showWarnings(warnings) {
  warnings.forEach(w => {
    const toast = createToast(w.message, w.severity);
    // Show for 5 seconds
  });
}
```

### Phase 4: UI - Confirmation for Delete

Before calling `todo.delete`, show a confirmation dialog:

```javascript
async function deleteTodo(id) {
  const confirmed = await showConfirmation(
    'Delete Todo',
    'This action cannot be undone. Continue?'
  );
  
  if (!confirmed) return;
  
  const result = await callTool('todo.delete', { id });
  // ... handle result
}
```

### Phase 5: UI - Show Error Suggestions

When errors occur, display the `suggestion` field:

```javascript
if (!result.success) {
  const suggestion = result.error?.suggestion;
  showError(result.error.message, suggestion);
}
```

### Phase 6: Commands - Add Alternatives Example

Update `todo.list` to demonstrate alternatives pattern when filters are applied:

```typescript
// In list.ts handler
if (input.priority || input.completed !== undefined) {
  alternatives.push({
    data: { todos: allTodos, total: allTodos.length, hasMore: false },
    reason: 'All todos without filters',
    confidence: 1.0,
  });
}

return success(
  { todos, total, hasMore },
  { reasoning, confidence: 1.0, alternatives }
);
```

### Phase 7: Documentation

Add a section to the Todo app README explaining how the UI demonstrates each pattern:

```markdown
## AFD Patterns Demonstrated

| Pattern | Where | How |
|---------|-------|-----|
| Confidence indicators | Toast notifications | Shows confidence score after operations |
| Warnings | Alert banners | Delete shows "permanent action" warning |
| Error suggestions | Error dialog | Shows recovery steps when errors occur |
| Alternatives | Filter hints | Suggests alternative queries when filtering |
| Execution time | Log panel | Shows ms for each operation |
```

## Verification Checklist

After implementation, verify via CLI and UI:

- [ ] `afd call todo.delete` returns warning; UI shows it before confirming
- [ ] `afd call todo.get '{"id":"invalid"}'` returns suggestion; UI shows it
- [ ] `afd call todo.list '{"priority":"high"}'` returns alternatives; UI offers them
- [ ] All operations show confidence in toast
- [ ] All operations show executionTimeMs in log
- [ ] Delete requires confirmation click

## Out of Scope

- `sources` - Not applicable for a todo app (no external data)
- `plan` steps - Keep simple for this example (consider for future batch operations)
- WebSocket/SSE streaming - Simple HTTP is sufficient for demonstration