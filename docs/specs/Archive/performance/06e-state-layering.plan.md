# 06e - State Layering Strategy

> **Type**: Documentation Only  
> **Priority**: P2  
> **Status**: ✅ Complete

---

## Scope Note

This document provides **guidance only**. State layering is a frontend architecture pattern. No AFD code changes needed.

---

## The Challenge

AFD's principle is "commands are the application." But not all state belongs in commands:

```typescript
// This would be absurd
await execute("ui.setHoverState", { element: "button-1", hovered: true });
await execute("ui.setModalOpen", { modalId: "settings", open: true });
await execute("ui.setAnimationFrame", { frame: 42 });
```

We need clear guidance on what state goes where.

---

## The Four Layers

```
┌────────────────────────────────────────────────────────────────────┐
│  LAYER 1: VISUAL STATE (Frame-rate, ephemeral)                     │
│  Lifetime: Milliseconds to seconds                                 │
│  Examples: Hover, focus, drag position, animation frames           │
│  Storage: Component instance, CSS, RAF                             │
│  Commands: NEVER                                                   │
├────────────────────────────────────────────────────────────────────┤
│  LAYER 2: UI STATE (Session, user interaction)                     │
│  Lifetime: Page session                                            │
│  Examples: Modal open, accordion expanded, selected tab            │
│  Storage: Component instance or context                            │
│  Commands: NEVER (or rarely, for analytics)                        │
├────────────────────────────────────────────────────────────────────┤
│  LAYER 3: LOCAL PREFERENCE STATE (Cross-session, user-specific)    │
│  Lifetime: Persistent, user device                                 │
│  Examples: Theme preference, sidebar collapsed, last viewed        │
│  Storage: localStorage, IndexedDB                                  │
│  Commands: OPTIONAL (sync across devices)                          │
├────────────────────────────────────────────────────────────────────┤
│  LAYER 4: BUSINESS STATE (Source of truth)                         │
│  Lifetime: Persistent, shared                                      │
│  Examples: Todos, orders, tokens, users                            │
│  Storage: Backend database via commands                            │
│  Commands: ALWAYS                                                  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Visual State

**Characteristics**:

- Changes at 60fps (every 16ms)
- Never persisted
- Pure CSS or requestAnimationFrame

**Examples**:

```typescript
class DraggableItem extends FASTElement {
  // Visual state - never commands
  private ghostPosition = { x: 0, y: 0 };
  private animationId: number | null = null;

  onDrag(event: DragEvent) {
    // Direct DOM manipulation, no state system
    this.ghostPosition = { x: event.clientX, y: event.clientY };
    this.updateGhostPosition();
  }

  private updateGhostPosition() {
    // CSS transform - browser optimized
    this.ghost.style.transform = `translate(${this.ghostPosition.x}px, ${this.ghostPosition.y}px)`;
  }
}
```

**CSS-only visual state**:

```css
.button:hover {
  background: var(--hover-color);
}
.input:focus {
  outline: 2px solid var(--focus-color);
}
.item.dragging {
  opacity: 0.5;
}
```

**Rule**: If it changes faster than 100ms, it's visual state. No commands.

---

## Layer 2: UI State

**Characteristics**:

- Changes on user interaction
- Resets on page refresh
- Affects component rendering

**Examples**:

```typescript
class SettingsPanel extends FASTElement {
  // UI state - component instance
  @observable isOpen = false;
  @observable activeTab = "general";
  @observable expandedSections = new Set<string>();

  openPanel() {
    this.isOpen = true; // No command, instant
  }

  selectTab(tab: string) {
    this.activeTab = tab; // No command, instant
  }

  toggleSection(id: string) {
    // No command, instant
    if (this.expandedSections.has(id)) {
      this.expandedSections.delete(id);
    } else {
      this.expandedSections.add(id);
    }
  }
}
```

**When UI state crosses components** (React context, signals, stores):

```typescript
// UI state store - no commands
const uiStore = {
  modals: signal<Set<string>>(new Set()),
  sidebar: signal({ collapsed: false }),
  currentRoute: signal("/"),
};

// Components read/write directly
function openModal(id: string) {
  uiStore.modals.value = new Set([...uiStore.modals.value, id]);
}
```

**Rule**: If it's about "how to show things" not "what things exist," it's UI state.

---

## Layer 3: Local Preference State

**Characteristics**:

- Survives page refresh
- User-specific, device-specific
- Often synced to account (optional)

**Examples**:

```typescript
class UserPreferences {
  // LocalStorage backed
  private storage = localStorage;

  get theme(): "light" | "dark" {
    return (this.storage.getItem("theme") as any) || "light";
  }

  set theme(value: "light" | "dark") {
    this.storage.setItem("theme", value);
    // Optional: sync to account
    execute("preferences.sync", { theme: value }).catch(() => {
      // Sync failed, still works locally
    });
  }

  get sidebarCollapsed(): boolean {
    return this.storage.getItem("sidebar") === "collapsed";
  }

  set sidebarCollapsed(value: boolean) {
    this.storage.setItem("sidebar", value ? "collapsed" : "expanded");
  }
}
```

**Hybrid approach** (local-first, sync-optional):

```typescript
class PreferenceManager {
  async setTheme(theme: "light" | "dark") {
    // Always update locally first (instant)
    localStorage.setItem("theme", theme);
    document.documentElement.dataset.theme = theme;

    // Optionally sync to account (background)
    if (this.isLoggedIn) {
      await execute("preferences.set", { key: "theme", value: theme });
    }
  }

  async loadPreferences() {
    // Start with local
    const localTheme = localStorage.getItem("theme");
    if (localTheme) {
      document.documentElement.dataset.theme = localTheme;
    }

    // Sync from server if logged in
    if (this.isLoggedIn) {
      const result = await execute("preferences.get", {});
      if (result.success && result.data.theme) {
        localStorage.setItem("theme", result.data.theme);
        document.documentElement.dataset.theme = result.data.theme;
      }
    }
  }
}
```

**Rule**: If it's user preference that should survive refresh, it's local preference. Command sync is optional.

---

## Layer 4: Business State

**Characteristics**:

- Shared across users/devices
- Source of truth is backend
- All mutations via commands

**Examples**:

```typescript
class TodoApp extends FASTElement {
  @observable todos: Todo[] = [];

  // Load via command
  async connectedCallback() {
    const result = await execute("todos.list", {});
    if (result.success) {
      this.todos = result.data;
    }
  }

  // Create via command (with optimistic UI)
  async createTodo(title: string) {
    const tempId = `temp-${Date.now()}`;
    const optimistic = { id: tempId, title, completed: false, pending: true };

    this.todos = [...this.todos, optimistic];

    const result = await execute("todo.create", { title });

    if (result.success) {
      this.todos = this.todos.map((t) => (t.id === tempId ? result.data : t));
    } else {
      this.todos = this.todos.filter((t) => t.id !== tempId);
    }
  }

  // Update via command
  async toggleTodo(id: string) {
    const todo = this.todos.find((t) => t.id === id);
    if (!todo) return;

    // Optimistic
    this.todos = this.todos.map((t) =>
      t.id === id ? { ...t, completed: !t.completed } : t
    );

    const result = await execute("todo.toggle", { id });

    if (!result.success) {
      // Rollback
      this.todos = this.todos.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      );
    }
  }
}
```

**Rule**: If it's data that exists regardless of UI, it's business state. Always use commands.

---

## Decision Flowchart

```
Is this state...
│
├─ Changing at 60fps (animations, drag)?
│  └─ YES → Layer 1 (Visual) → No commands, CSS/RAF
│
├─ About how to display things (not what exists)?
│  └─ YES → Layer 2 (UI) → No commands, component state
│
├─ User preference that survives refresh?
│  └─ YES → Layer 3 (Local Preference) → localStorage, optional sync
│
└─ Data that exists regardless of UI?
   └─ YES → Layer 4 (Business) → Always commands
```

---

## Complete Example

```typescript
@customElement({
  name: "task-board",
  template: html`...`,
  styles: css`
    /* Layer 1: Visual state via CSS */
    .card:hover {
      box-shadow: var(--shadow-lg);
    }
    .card.dragging {
      opacity: 0.5;
    }
  `,
})
class TaskBoard extends FASTElement {
  // Layer 2: UI state
  @observable selectedColumn: string | null = null;
  @observable isFilterPanelOpen = false;

  // Layer 3: Local preferences (with localStorage)
  @observable viewMode: "board" | "list" =
    (localStorage.getItem("viewMode") as any) || "board";

  // Layer 4: Business state
  @observable columns: Column[] = [];
  @observable tasks: Task[] = [];

  // Layer 1: Visual state (not observable, direct DOM)
  private dragGhost: HTMLElement | null = null;

  async connectedCallback() {
    super.connectedCallback();
    await this.loadData(); // Layer 4
    this.loadPreferences(); // Layer 3
  }

  // Layer 4: Business operations (commands)
  private async loadData() {
    const result = await execute("board.get", { id: this.boardId });
    if (result.success) {
      this.columns = result.data.columns;
      this.tasks = result.data.tasks;
    }
  }

  async moveTask(taskId: string, toColumn: string) {
    // Optimistic update
    const previousTasks = [...this.tasks];
    this.tasks = this.tasks.map((t) =>
      t.id === taskId ? { ...t, columnId: toColumn } : t
    );

    // Command
    const result = await execute("task.move", { taskId, toColumn });
    if (!result.success) {
      this.tasks = previousTasks;
      showError(result.error.message);
    }
  }

  // Layer 3: Preference operations (local + optional sync)
  setViewMode(mode: "board" | "list") {
    this.viewMode = mode;
    localStorage.setItem("viewMode", mode);
    // Optional: execute('preferences.set', { viewMode: mode })
  }

  private loadPreferences() {
    const saved = localStorage.getItem("viewMode");
    if (saved) this.viewMode = saved as any;
  }

  // Layer 2: UI operations (no persistence)
  selectColumn(id: string) {
    this.selectedColumn = id;
  }

  toggleFilterPanel() {
    this.isFilterPanelOpen = !this.isFilterPanelOpen;
  }

  // Layer 1: Visual operations (direct DOM)
  onDragMove(event: DragEvent) {
    if (this.dragGhost) {
      this.dragGhost.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    }
  }
}
```

---

## Summary Table

| Layer         | Persistence | Commands? | Examples                            |
| ------------- | ----------- | --------- | ----------------------------------- |
| 1. Visual     | None        | Never     | Hover, drag position, animations    |
| 2. UI         | Session     | Never     | Modal open, selected tab, expanded  |
| 3. Local Pref | Device      | Optional  | Theme, collapsed sidebar, last view |
| 4. Business   | Backend     | Always    | Tasks, users, orders, tokens        |

**The AFD principle refined**: Commands are for Layer 4 (business state). Layers 1-3 are frontend concerns that don't need commands.

---

## Related Documents

- [Command Schema Guide - "What is NOT a Command"](../../command-schema-guide.md#what-is-not-a-command) - Detailed examples and litmus tests
- [Optimistic UI Patterns](./06d-optimistic-ui.plan.md) - How to use local state for perceived performance
- [AFD Philosophy](../../philosophy.md) - Why "commands ARE the application" applies to business logic
