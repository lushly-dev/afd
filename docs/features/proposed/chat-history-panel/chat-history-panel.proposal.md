# Chat History Panel

> Proposal: Multi-session chat history with slide-out sidebar navigation

---
status: captured
created: 2026-01-12
origin: Chat UI reorganization discussion
effort: M (3-5 days)
---

## Problem

Currently there's only a single chat session with no way to start fresh conversations or browse previous ones. Users lose context when they need to reference past AI interactions.

## Proposed Solution

**Slide-out History Sidebar** — accessible via 📜 icon in chat header:

### Core Features

| Feature | Description |
|---------|-------------|
| Multi-session support | Each [+] creates a new session |
| Session list | Scrollable list with title + timestamp |
| Session switching | Click to load, auto-saves current |
| Session titles | Auto-generated from first message |

### Data Model

```typescript
interface ChatSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}
```

### Storage Strategy

- **Phase 1**: localStorage with session index
- **Phase 2**: Convex-backed for cross-device sync

## UI Layout

```
┌─────────────────────┬──────────────────────┐
│ Myoso        [+] [📜]│ Chat History         │
├─────────────────────┤──────────────────────│
│                     │ 📝 Create todos      │
│  [Chat messages...] │    Today, 12:30 PM   │
│                     │──────────────────────│
│                     │ 📝 List my tasks     │
│                     │    Yesterday         │
├─────────────────────┤                      │
│ [Input area...]     │                      │
└─────────────────────┴──────────────────────┘
```

## Implementation Plan

- [ ] Add `ChatSession` type and session storage utils
- [ ] Create `ChatHistoryPanel` component
- [ ] Add session state management (current, list)
- [ ] Wire [+] button to create new session
- [ ] Wire 📜 button to toggle history panel
- [ ] Implement session switching with auto-save
- [ ] Add session title extraction from first message

## Benefits

- Users can start fresh without losing history
- Easy reference to past AI interactions
- Foundation for cross-device sync (Phase 2)

---

*Status: Captured — awaiting prioritization*
