# Command Trust Config

**Status:** Draft  
**Priority:** P2  
**Depends On:** Command Protocol (Complete)

---

## Summary

Extend AFD's command options with trust metadata that triggers safety behaviors in UI layers (FAST-AF, etc.).

## Architecture

```
AFD Core defines the contract:
┌────────────────────────────────────────┐
│ CommandOptions {                       │
│   destructive?: boolean    // Flag     │
│   undoable?: boolean       // Flag     │
│   requiresAuth?: boolean   // Flag     │
│   confirmPrompt?: string   // Message  │
│ }                                      │
└────────────────────────────────────────┘
         ↓ Used by
┌────────────────────────────────────────┐
│ FAST-AF reads flags, shows UI          │
│ Other frontends can implement too      │
└────────────────────────────────────────┘
```

## Proposed Extensions

### CommandOptions

```typescript
interface CommandOptions {
  // Existing
  label?: string;
  icon?: string;
  // ...
  
  // NEW: Trust flags
  destructive?: boolean;     // Triggers confirmation UI
  undoable?: boolean;        // Command must return undo function
  requiresAuth?: boolean;    // Requires authentication first
  confirmPrompt?: string;    // Custom confirmation message
}
```

### CommandResult Undo Extension

```typescript
interface CommandResult {
  success: boolean;
  data?: any;
  // ...
  
  // NEW: Undo capability
  undo?: () => Promise<CommandResult>;  // Reverses the action
}
```

## Use Cases

| Flag | Trigger | Example |
|------|---------|---------|
| `destructive` | Show confirmation modal | Delete item |
| `undoable` | Push to undo stack | Edit, move |
| `requiresAuth` | Check auth before execute | Change settings |

## Dependencies

- None (extends existing CommandResult)

## Consumers

- [FAST-AF Command Safety](../../../fast-af/docs/features/proposed/command-safety/) — Implements UI behaviors

## Open Questions

1. Should undo be mandatory for undoable commands? (Type enforcement?)
2. Auth integration pattern (callback vs promise?)
