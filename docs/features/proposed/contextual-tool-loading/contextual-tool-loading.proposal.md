# Contextual Tool Loading

> Proposal: Dynamic tool scoping for complex applications with 100s-1000s of commands

---
status: captured
created: 2026-01-11
origin: Discussion on scaling AFD command systems for Word/Figma-class applications
effort: L (1-2 weeks)
---

## Problem

AFD's command-first architecture scales linearly: 10 commands are trivial, 100 are manageable, but Word/Figma-class applications with **500-2000 commands** create:

| Issue | Impact |
|-------|--------|
| Prompt bloat | Command schemas consume context window |
| Decision paralysis | Agent struggles to choose from 47 document commands |
| Hallucination risk | Agent invents commands that don't exist |
| Over-privilege | Background review agents don't need write access |

## Proposed Solution

**Dynamic context scoping**: Instead of exposing all commands at once, agents work within **contexts** — dynamically-loaded subsets of available tools.

```
┌─────────────────────────────────────────────────────────────────┐
│                        UNIVERSAL TOOLS                          │
│  afd-help, afd-context-list, afd-context-enter, afd-context-exit│
│  (Always available - the "lobby" of the toolset)                │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │  document-  │     │   print     │     │  settings   │
   │   editing   │     │             │     │             │
   │  (42 tools) │     │ (12 tools)  │     │ (28 tools)  │
   └─────────────┘     └─────────────┘     └─────────────┘
```

### Key Distinctions

| Concept | Purpose | Example |
|---------|---------|---------|
| **Category** | Static organization for discovery | `category: 'document'` |
| **Tag** | Filtering and grouping | `tags: ['formatting', 'text']` |
| **Context** | Dynamic runtime tool scoping | `context: 'document-editing'` |

Categories and tags are **metadata**. Context is **access control**.

## Core Patterns

### 1. Universal Tools (Always Available)

| Tool | Description |
|------|-------------|
| `afd-help` | List commands (existing) |
| `afd-context-list` | List available contexts |
| `afd-context-enter` | Load a context's tools |
| `afd-context-exit` | Return to previous context |
| `afd-context-suggest` | AI-powered context recommendation |

### 2. Default Context from UI State

Active context determined by **user's current UI location**:

| User Location | Default Context |
|---------------|-----------------|
| Document editor | `document-editing` |
| Print dialog | `print-preview` |
| Settings panel | `settings` |

### 3. Lazy Loading Pattern

When agent needs tools outside current context:

```
User: "print this for me"

Agent (has document-editing context):
  1. Doesn't see print-execute in current tools
  2. Calls afd-context-list → discovers "print" context
  3. Calls afd-context-enter { context: 'print' }
  4. Now has print-* tools loaded
  5. Executes print-execute { copies: 1 }
  6. Calls afd-context-exit to return
```

### 4. Fuzzy Match Integration

AFD already has fuzzy matching in `DirectClient` for typo recovery:

```typescript
// Agent calls "document x print" (not a real command)
const result = await client.call('document-x-print', {});
// Returns UnknownToolError with:
// - suggestions: ['document-print', 'print-document']
// - hint: "Did you mean 'document-print'?"
```

Extend to suggest context switches when no match in current context:

```typescript
{
  error: 'UNKNOWN_TOOL',
  suggestions: [],
  contextHint: {
    suggestedContext: 'print',
    confidence: 0.85,
    reason: 'The term "print" matches the print context'
  }
}
```

### 5. Background Agent Scoping

Background agents receive read-only context subsets:

```typescript
// Document review agent - runs every minute
const reviewContext = await afdContextEnter({
  context: 'document-reading',
  scope: 'read-only',
});
// Agent can only use: document-get, document-analyze
// Cannot use: document-update, document-delete
```

### 6. Multi-Context Membership

Commands can belong to multiple contexts:

```typescript
defineCommand({
  name: 'undo',
  contexts: ['document-editing', 'print-preview', 'settings'],
});
```

## API Design (Summary)

```typescript
// Command declaration
defineCommand({
  name: 'format-bold',
  category: 'document',
  contexts: ['document-editing', 'text-styling'],  // NEW
  tags: ['formatting'],
  // ...
});

// Context configuration
interface ContextConfig {
  name: string;
  parent?: string;           // Hierarchical nesting
  priority: number;          // Higher = suggested first
  triggers: string[];        // Keywords that suggest this context
  readOnly?: boolean;        // For background agents
}
```

## Benefits

| Scenario | Without Context | With Context |
|----------|-----------------|--------------|
| Word-class app | 500 tools in prompt | 30-50 per context |
| Background reviewer | Full write access risk | Read-only scoped |
| Cross-context request | Agent guesses | Lazy loading pattern |
| Typo recovery | Suggestions only | Suggestions + context hints |

## Implementation Plan

### Phase 1: Core Infrastructure
- [ ] Add `contexts` field to CommandDefinition
- [ ] Implement `afd-context-list` command
- [ ] Implement `afd-context-enter` command  
- [ ] Implement `afd-context-exit` command
- [ ] Update DirectClient to filter by active context

### Phase 2: Integration
- [ ] Extend fuzzy match to suggest context switches
- [ ] Add read-only scope enforcement
- [ ] Implement hierarchical context resolution

### Phase 3: Intelligence
- [ ] Implement `afd-context-suggest` with keyword matching
- [ ] Default context from UI state signal
- [ ] Priority/weighting system

### Phase 4: Demo & Documentation  
- [ ] Extend todo demo with contexts
- [ ] Document context design patterns
- [ ] Add conformance tests

## Open Questions

1. **Context inheritance**: Should child contexts include parent commands?
2. **Context conflicts**: What if a command name exists in multiple contexts?
3. **Context persistence**: Should context survive across sessions?

## Related Work

- **Existing fuzzy match**: [DirectClient](file:///d:/Github/lushly-dev/AFD/packages/client/src/direct.test.ts#L224-L232)
- **Tag-based filtering**: Already in `afd-help` command
- **Corporate Context Service**: Same pattern for knowledge scoping (Vision docs)

---

*Status: Draft — awaiting review*
