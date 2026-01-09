# 06d - Optimistic UI Patterns

> **Type**: Documentation Only  
> **Priority**: P1  
> **Status**: ✅ Complete

---

## Scope Note

This document provides **guidance only**. Optimistic UI is a frontend pattern that works with any command layer. No AFD code changes needed.

---

## The Problem

AFD commands add latency vs. direct state mutation:

| Approach                   | Button Click Latency |
| -------------------------- | -------------------- |
| Direct state mutation      | ~1-5ms               |
| AFD command (same process) | ~5-10ms              |
| AFD command (network)      | ~50-100ms            |

For many interactions, 50-100ms feels sluggish. Users expect instant feedback.

---

## The Solution: Optimistic Updates

**Principle**: Update UI immediately, reconcile with backend asynchronously.

```
┌───────────────────────────────────────────────────────────────┐
│                    USER PERCEIVES                             │
│  [click] → [instant UI update] → [done]                      │
├───────────────────────────────────────────────────────────────┤
│                    ACTUALLY HAPPENING                         │
│  [click] → [optimistic update] → [command executes] →        │
│            [success: done] OR [failure: rollback]            │
└───────────────────────────────────────────────────────────────┘
```

---

## Pattern 1: Simple Optimistic Update

### Example: Toggle Completion

```typescript
class TodoItem extends FASTElement {
  @observable completed = false;

  async toggleComplete() {
    // 1. Capture previous state
    const wasCompleted = this.completed;

    // 2. Optimistic update (instant)
    this.completed = !this.completed;

    // 3. Execute command (background)
    const result = await execute("todo.toggle", { id: this.id });

    // 4. Rollback on failure
    if (!result.success) {
      this.completed = wasCompleted;
      showError(result.error.message);
    }
  }
}
```

**Key points**:

- UI updates immediately (step 2)
- User doesn't wait for network
- Rollback is rare (most commands succeed)

---

## Pattern 2: Drag and Drop Reordering

### The Three-Layer Model

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1: VISUAL (frame-rate, <16ms)                         │
│  - Drag ghost position (CSS transform)                       │
│  - Drop indicators                                           │
│  - Animations                                                │
│  NO commands, NO state changes, just visual feedback         │
├──────────────────────────────────────────────────────────────┤
│  LAYER 2: LOCAL STATE (instant, <1ms)                        │
│  - Item order in array                                       │
│  - Updated immediately on drop                               │
│  User sees reordering complete instantly                     │
├──────────────────────────────────────────────────────────────┤
│  LAYER 3: COMMAND STATE (async, <500ms)                      │
│  - execute('list.reorder', {...})                            │
│  - Persists to backend                                       │
│  - Can fail → triggers rollback to Layer 2                   │
└──────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
class SortableList extends FASTElement {
  @observable items: Item[] = [];

  // Visual layer - no state changes
  private dragState = {
    dragging: null as Item | null,
    overIndex: -1,
    ghostPosition: { x: 0, y: 0 },
  };

  onDragStart(item: Item, event: DragEvent) {
    this.dragState.dragging = item;
    // Visual only: create ghost, add dragging class
  }

  onDragOver(index: number, event: DragEvent) {
    event.preventDefault();
    this.dragState.overIndex = index;
    // Visual only: show drop indicator
  }

  async onDrop() {
    const { dragging, overIndex } = this.dragState;
    if (!dragging || overIndex < 0) return;

    // Layer 2: Optimistic local update (instant)
    const previousOrder = [...this.items];
    this.items = this.reorder(this.items, dragging, overIndex);

    // Reset visual state
    this.dragState = {
      dragging: null,
      overIndex: -1,
      ghostPosition: { x: 0, y: 0 },
    };

    // Layer 3: Command (async, non-blocking)
    const result = await execute("list.reorder", {
      listId: this.listId,
      itemId: dragging.id,
      newIndex: overIndex,
    });

    // Rollback on failure
    if (!result.success) {
      this.items = previousOrder;
      showToast(`Couldn't save: ${result.error.message}`);
    }
  }

  private reorder(items: Item[], item: Item, newIndex: number): Item[] {
    const result = items.filter((i) => i.id !== item.id);
    result.splice(newIndex, 0, item);
    return result;
  }
}
```

---

## Pattern 3: Form Submission

### Without Optimistic UI (slow)

```typescript
async onSubmit() {
  this.isLoading = true;  // Show spinner

  const result = await execute('item.create', this.formData);

  this.isLoading = false;
  if (result.success) {
    this.items = [...this.items, result.data];  // Now add to list
  }
}
// User waits 50-100ms seeing a spinner
```

### With Optimistic UI (instant)

```typescript
async onSubmit() {
  // Generate temporary ID
  const tempId = `temp-${Date.now()}`;
  const optimisticItem = { ...this.formData, id: tempId, pending: true };

  // Optimistic add (instant)
  this.items = [...this.items, optimisticItem];
  this.clearForm();

  // Execute command (background)
  const result = await execute('item.create', this.formData);

  if (result.success) {
    // Replace temp item with real item
    this.items = this.items.map(item =>
      item.id === tempId ? result.data : item
    );
  } else {
    // Remove optimistic item
    this.items = this.items.filter(item => item.id !== tempId);
    showError(result.error.message);
  }
}
```

**Visual hint**: Style `pending: true` items differently (e.g., reduced opacity).

---

## Pattern 4: Debounced Commands

For rapid input (typing, sliders), don't command on every change:

```typescript
class NoteEditor extends FASTElement {
  @observable content = "";
  private saveDebounced = debounce(this.save.bind(this), 500);

  onInput(event: InputEvent) {
    // Local state: instant
    this.content = (event.target as HTMLTextAreaElement).value;

    // Command: debounced
    this.saveDebounced();
  }

  private async save() {
    const result = await execute("note.update", {
      id: this.noteId,
      content: this.content,
    });

    if (!result.success) {
      showToast("Failed to save, retrying...");
      // Retry logic
    } else {
      showToast("Saved", { duration: 1000 });
    }
  }
}
```

---

## Pattern 5: Conflict Resolution

What if the backend returns a different state than expected?

### Server Corrections

```typescript
const result = await execute("list.reorder", {
  itemId: "item-1",
  newIndex: 0,
});

if (result.success) {
  // Server might have corrected the order
  if (result.data.correctedOrder) {
    this.items = result.data.correctedOrder;
    showToast(result.reasoning); // "Item must stay below pinned items"
  }
}
```

### AFD Advantage

`CommandResult` schema supports this naturally:

```typescript
interface ReorderResult {
  success: boolean;
  data?: {
    newOrder: string[]; // Confirmed order
    correctedOrder?: string[]; // If server adjusted
  };
  reasoning?: string; // Human-readable explanation
  warnings?: Warning[]; // Non-fatal issues
}
```

---

## When NOT to Use Optimistic UI

| Scenario                  | Why Not                             | Alternative                          |
| ------------------------- | ----------------------------------- | ------------------------------------ |
| **Destructive actions**   | Can't easily undo                   | Show confirmation, wait for result   |
| **Payment/checkout**      | Must confirm before showing success | Loading state, explicit confirmation |
| **Authentication**        | Security-critical                   | Wait for server validation           |
| **Collaborative editing** | Complex conflict resolution         | Use CRDTs/OT alongside AFD           |

---

## State Separation Guide

| State Type           | Command?  | Examples                                       |
| -------------------- | --------- | ---------------------------------------------- |
| **Visual/Ephemeral** | ❌ Never  | Hover, focus, drag position, animations        |
| **UI-only**          | ❌ Never  | Modal open, accordion expanded, current tab    |
| **Local preference** | ⚠️ Maybe  | Dark mode, sidebar collapsed (persist locally) |
| **Business data**    | ✅ Always | Items, orders, tokens, nodes                   |

```typescript
class Dashboard extends FASTElement {
  // Visual - no commands
  @observable isHovered = false;
  @observable dragPosition = { x: 0, y: 0 };

  // UI-only - no commands (or localStorage)
  @observable sidebarCollapsed = false;
  @observable activeTab = "overview";

  // Business data - always via commands
  @observable items: Item[] = [];

  async loadItems() {
    const result = await execute("items.list", {});
    if (result.success) this.items = result.data;
  }

  async createItem(data: ItemInput) {
    // Optimistic pattern from above
  }
}
```

---

## Summary

| Pattern                | Latency                      | Use When                     |
| ---------------------- | ---------------------------- | ---------------------------- |
| **Optimistic toggle**  | <5ms perceived               | Binary state changes         |
| **Optimistic reorder** | <5ms perceived               | Drag and drop                |
| **Optimistic create**  | <5ms perceived               | Adding items to lists        |
| **Debounced save**     | <5ms perceived, 500ms actual | Text input, sliders          |
| **Wait for result**    | 50-100ms+                    | Destructive/critical actions |

**The rule**: Use optimistic UI for reversible, non-critical actions. Wait for confirmation on destructive or security-critical actions.

AFD doesn't prevent you from having local state—it ensures business logic stays in commands while allowing instant UI feedback.
