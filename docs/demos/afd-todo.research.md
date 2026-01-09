# AFD Todo: Rich Task & Notes App

> Showcase app for Agent-First Development

---
status: research
created: 2026-01-09
---

## Overview

A production-quality todo/notes app that demonstrates AFD capabilities. Complex enough to test real scenarios, simple enough to ship fast.

**Goals:**
- Real app users would actually use
- Test AFD with meaningful complexity
- Publish as open-source showcase
- Less complex than Lushly, more than examples

---

## Feature Research

### Core Todo Features (from Todoist, TickTick, Things 3)

| Feature | Priority | AFD Demo Value |
|---------|----------|----------------|
| Tasks with title/description | P0 | Basic CRUD |
| Due dates + time | P0 | Date handling |
| Lists/Projects | P0 | Hierarchical data |
| Subtasks | P1 | Nested structures |
| Tags/Labels | P1 | Many-to-many relations |
| Priority levels | P1 | Enum types |
| Recurring tasks | P2 | Complex scheduling |
| Natural language input | P2 | AI integration |
| Reminders | P2 | Time-based triggers |

### Notes (Distinct from Todos)

| Characteristic | Todo | Note |
|----------------|------|------|
| Can be "completed" | ✅ | ❌ |
| Has due date | Optional | Never |
| Has checkbox | ✅ | ❌ |
| Lives in | Lists | "Notes" folder |
| Rich content | Title + desc | Full markdown |

### Views

| View | Description |
|------|-------------|
| **Inbox** | Unsorted tasks |
| **Today** | Due today + overdue |
| **Upcoming** | Calendar/timeline view |
| **Lists** | Project-based grouping |
| **Notes** | Note-only folder |
| **Completed** | Archive of done tasks |
| **Search** | Full-text across all |

### Developer Mode Features

| Feature | Purpose |
|---------|---------|
| Trust signals panel | Show confidence per command |
| Response times | Latency breakdown |
| Raw JSON toggle | See actual payloads |
| Pipeline inspector | Step-by-step pipeline view |
| Command log | History of all calls |

**Activation:** URL `?dev=true` or keyboard shortcut

---

## Data Model

### Task

```typescript
interface Task {
  id: string;
  title: string;
  description?: string;
  
  // Status
  status: 'pending' | 'completed';
  completedAt?: Date;
  
  // Organization
  listId: string;
  parentId?: string;        // For subtasks
  position: number;         // Sort order
  
  // Scheduling
  dueDate?: Date;
  dueTime?: string;         // "14:30"
  reminder?: Date;
  recurrence?: RecurrenceRule;
  
  // Metadata
  priority: 0 | 1 | 2 | 3;  // None, Low, Med, High
  tags: string[];
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### Note

```typescript
interface Note {
  id: string;
  title: string;
  content: string;          // Markdown
  
  // Organization
  folderId?: string;
  tags: string[];
  pinned: boolean;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

### List

```typescript
interface List {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  position: number;
  isArchived: boolean;
}
```

---

## Commands

### Task Commands

| Command | Description |
|---------|-------------|
| `task-create` | Create new task |
| `task-update` | Update task fields |
| `task-complete` | Mark task done |
| `task-uncomplete` | Reopen task |
| `task-delete` | Delete task |
| `task-move` | Move to different list |
| `task-reorder` | Change position in list |
| `task-list` | Query tasks with filters |

### Note Commands

| Command | Description |
|---------|-------------|
| `note-create` | Create new note |
| `note-update` | Update note content |
| `note-delete` | Delete note |
| `note-pin` | Pin/unpin note |
| `note-list` | Query notes |

### List Commands

| Command | Description |
|---------|-------------|
| `list-create` | Create new list |
| `list-update` | Update list |
| `list-delete` | Delete list (with tasks?) |
| `list-list` | Get all lists |

### Pipeline Examples

**Complete task and suggest next:**
```typescript
await client.pipe([
  { command: 'task-complete', input: { id: taskId } },
  { command: 'task-list', input: { listId: '$prev.data.listId', limit: 1 } }
]);
// Returns: completed task + next suggested task
```

**Create task from natural language:**
```typescript
await client.pipe([
  { command: 'ai-parse-task', input: { text: 'Buy milk tomorrow at 5pm' } },
  { command: 'task-create', input: '$prev.data' }
]);
// AI extracts: title="Buy milk", dueDate=tomorrow, dueTime="17:00"
```

---

## UI/UX

### Layout

```
┌────────────────────────────────────────────────────────────┐
│  ☰  AFD Todo                              🔍  ⚙️  👤       │
├─────────────┬──────────────────────────────────────────────┤
│             │                                              │
│  📥 Inbox   │  Today                                       │
│  📅 Today   │  ────────────────────────────────────────    │
│  📆 Upcoming│  ○ Buy groceries                     📅 Mon  │
│             │  ○ Call dentist             ⚡ High  📅 Today │
│  ─────────  │  ○ Review PR #42                     📅 Today │
│  📁 Work    │                                              │
│  📁 Personal│  ────────────────────────────────────────    │
│  📁 Shopping│  Overdue                                     │
│             │  ────────────────────────────────────────    │
│  ─────────  │  ○ Send invoice              🔴     📅 Dec 5 │
│  📝 Notes   │                                              │
│  ✓ Completed│                                              │
│             │                                              │
├─────────────┴──────────────────────────────────────────────┤
│  + Add task...                                    [Dev 🔧] │
└────────────────────────────────────────────────────────────┘
```

### Dev Mode Drawer

```
┌─────────────────────────────────────────┐
│  Developer Tools               [Close]  │
├─────────────────────────────────────────┤
│  Last Command: task-complete            │
│  ├─ Latency: 45ms                       │
│  ├─ Confidence: 0.98                    │
│  └─ Reasoning: "Status updated"         │
│                                         │
│  ┌─ Raw Response ────────────────────┐  │
│  │ {                                 │  │
│  │   "data": { "id": "...", ... },   │  │
│  │   "metadata": { ... }             │  │
│  │ }                                 │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Command History (last 10)              │
│  ├─ task-list (23ms)                    │
│  ├─ task-complete (45ms)                │
│  └─ task-create (67ms)                  │
└─────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vanilla JS + Lit (web components) |
| Styling | Ultraviolet (design tokens) |
| Backend | AFD Server (Node.js) |
| Client | AFD DirectClient |
| Storage | SQLite (via better-sqlite3) |
| Dev server | Vite |

## Tasks

### Wave 1: Project Setup
- [ ] **Project Setup** — Create demos/todo folder, package.json, Vite, AFD server, DirectClient connection
- [ ] **Task Commands (CRUD)** — Implement task-create, task-update, task-delete, task-list commands (depends: Project Setup)
- [ ] **List Commands** — Implement list-create, list-update, list-delete, list-list commands (depends: Project Setup)

### Wave 2: Core Features
- [ ] **Task Completion** — Implement task-complete, task-uncomplete commands (depends: Task Commands)
- [ ] **Due Dates** — Add due date/time fields and filtering (depends: Task Commands)
- [ ] **Basic UI Shell** — Sidebar with Inbox/Today/Lists, main task list view (depends: Task Commands)
- [ ] **Today/Upcoming Views** — Filter tasks by due date (depends: Due Dates, Basic UI Shell)

### Wave 3: Rich Features
- [ ] **Subtasks** — Nested task hierarchy (depends: Task Commands)
- [ ] **Tags/Labels** — Many-to-many tagging system (depends: Task Commands)
- [ ] **Priority Levels** — 0-3 priority enum (depends: Task Commands)
- [ ] **Search** — Full-text search across tasks (depends: Task Commands)

### Wave 4: Notes
- [ ] **Note Commands** — Implement note-create, note-update, note-delete, note-list (depends: Project Setup)
- [ ] **Notes Folder View** — Separate view for notes (depends: Note Commands, Basic UI Shell)
- [ ] **Markdown Editor** — Rich markdown editing for note content (depends: Note Commands)

### Wave 5: Polish
- [ ] **Dev Mode Drawer** — Trust signals, latency, raw JSON, command log (depends: Basic UI Shell)
- [ ] **Keyboard Shortcuts** — Quick add, navigation, completion (depends: Basic UI Shell)
- [ ] **Dark Mode** — Theme toggle (depends: Basic UI Shell)

---

## Phases

### Phase 1: Core Todo
- [ ] Basic CRUD for tasks
- [ ] Lists/Projects
- [ ] Due dates
- [ ] Inbox/Today/Upcoming views
- [ ] Minimal UI

### Phase 2: Rich Features
- [ ] Subtasks
- [ ] Tags
- [ ] Priority
- [ ] Search
- [ ] Recurring tasks

### Phase 3: Notes
- [ ] Note CRUD
- [ ] Markdown editor
- [ ] Notes folder view
- [ ] Pinning

### Phase 4: Polish
- [ ] Dev mode drawer
- [ ] Keyboard shortcuts
- [ ] Drag-and-drop reorder
- [ ] Animations
- [ ] Dark mode

### Phase 5: AI Features
- [ ] Natural language task creation
- [ ] Smart suggestions
- [ ] AI-powered search

### Phase 6: Personal Intelligence
- [ ] Semantic search ("tasks about database migration")
- [ ] Time queries ("what did I do last Tuesday")
- [ ] Summaries ("summarize my work this quarter")
- [ ] Spend analysis ("Home Depot costs since June")
- [ ] Insights ("what takes me longest to complete")
- [ ] Vector embeddings for all tasks/notes

### Phase 7: Connectors
- [ ] Email-in (forward to inbox@app)
- [ ] Photo OCR (receipt scanning)
- [ ] Voice transcription
- [ ] Calendar sync (Google/Outlook)
- [ ] Browser extension

---

## Roadmap Summary

```
v1: Rich Tasks & Notes (core)
    ↓
v2: Personal Intelligence (AI queries over history)
    ↓
v3: Connectors (email, photos, voice)
    ↓
v4: Integrations (calendar, bank feeds, Slack)
```

- [ ] Usable as daily todo app
- [ ] Demonstrates 10+ AFD commands
- [ ] Shows pipelines in action
- [ ] Dev mode reveals trust signals
- [ ] Publishable as open-source showcase
- [ ] <100ms response times

---

## Name Ideas

- **Forge** — Where tasks are shaped (conflicts with near-Anvil?)
- **Prism** — Tasks refracted into action
- **Spark** — Simple, fast
- **Drift** — Tasks drift to completion
- **AFD Todo** — Just obvious

---

*Research complete. Ready for spec refinement and implementation.*
