# Spec Review: Command Trust Config

**Spec:** `docs/features/proposed/command-trust-config/command-trust-config.spec.md`
**Proposal:** `docs/features/proposed/command-trust-config/command-trust-config.proposal.md`
**Reviewer:** Claude Opus 4.5 (Fresh Agent)
**Date:** 2025-01
**Status:** ~~REVISE REQUIRED~~ → APPROVED (blockers fixed)

---

## Review Summary

The spec is well-structured and follows the established pattern from `platform-utils.spec.md`. It correctly implements the proposal's approach of flowing trust metadata through the streaming pipeline. However, there are several issues that need resolution before implementation.

---

## 🔴 BLOCKERS (Must Fix)

### 1. Missing `ZodCommandDefinition` Interface Update

**Evidence:** Section 4.1 updates `ZodCommandOptions` but does not mention updating `ZodCommandDefinition`. The interface at `packages/server/src/schema.ts:78` must also include `destructive` and `confirmPrompt` fields for them to be available on the command object after `defineCommand()`.

**Fix:** Add to Section 4.1:
```typescript
// Also update ZodCommandDefinition interface
export interface ZodCommandDefinition<TInput, TOutput> {
  // ... existing fields ...
  destructive?: boolean;
  confirmPrompt?: string;
}
```

---

### 2. Open Question #4 Unresolved - Sync Issue on Cancel

**Evidence:** The proposal identifies a critical issue: "What if user cancels after backend executed? The action already happened on the backend (Convex). Cancelling only prevents local UI update. May cause sync issues."

The spec does not address this. If user cancels, the todo IS deleted in Convex but NOT in the local Zustand store. On next sync, the deleted item will reappear (ghost item) or cause confusion.

**Fix:** Add one of these approaches to Section 4.6:
- **Option A (Recommended):** On cancel, show a message: "Action was already performed. Refreshing..." and force a sync
- **Option B:** Add a `localStore.sync()` call when user cancels to reconcile state
- **Option C:** Document this as expected behavior with a warning to users

Add to Section 4.6 or a new Section 4.7:
```typescript
// When user cancels a destructive action
const handleDestructiveConfirm = useCallback(async (confirmed: boolean) => {
  if (!pendingDestructive) return;

  if (confirmed) {
    executeLocalAction(...);
  } else {
    // Backend already executed - sync to reconcile state
    // Option A: Force sync
    await localStore.forceSync();
    // Option B: Show warning
    toast.info('Action was performed on the server. Syncing...');
  }

  setPendingDestructive(null);
}, [...]);
```

---

### 3. Missing Note Commands in Checklist

**Evidence:** Section 7 Checklist includes `todo-delete`, `todo-clear`, `todo-deleteBatch` but the codebase also has destructive note commands:
- `demos/todo/backend/src/commands/note-delete.ts`
- `demos/todo/backend/src/commands/notefolder-delete.ts`

**Fix:** Add to Section 7 Checklist:
```markdown
- [ ] `note-delete` command has `destructive: true`
- [ ] `notefolder-delete` command has `destructive: true`
```

Also update Section 4.5 "Similarly Update Other Destructive Commands" to include note commands.

---

## 🟡 SUGGESTIONS (Take or Leave)

### 1. Consider `toolsInProgress` Typing

**Current:** Section 4.6 references `toolsInProgress.get(eventData.name)?.args` but doesn't specify the Map type.

**Suggestion:** If `toolsInProgress` doesn't store args, this would be undefined. Consider storing args in `tool_start` handler:
```typescript
// In tool_start handler
toolsInProgress.set(eventData.name, { startTime: Date.now(), args: eventData.args });
```

Verify current implementation stores args or adjust the spec accordingly.

---

### 2. Consider Reusing Existing `useConfirm` Hook

**Current:** Section 4.6 creates new state (`pendingDestructive`) and handler for confirmation.

**Suggestion:** The frontend already has `demos/todo/frontend/src/hooks/useConfirm.ts`. Consider reusing it:
```typescript
const { confirm } = useConfirm();

// In tool_end handler
if (eventData.metadata?.destructive) {
  const confirmed = await confirm(
    "Confirm Agent Action",
    eventData.metadata.confirmPrompt || `Confirm ${eventData.name}?`,
    "This action was performed by the AI assistant."
  );
  if (!confirmed) {
    await localStore.forceSync(); // Handle sync issue
    return;
  }
}
executeLocalAction(...);
```

This reduces code duplication and ensures consistent UI.

---

### 3. Add `list-delete` to Destructive Commands

**Evidence:** Section 4.5 mentions `list-delete.ts` in "Similarly Update Other Destructive Commands" but the checklist in Section 7 doesn't include it.

**Suggestion:** Add to checklist:
```markdown
- [ ] `list-delete` command has `destructive: true`
```

---

### 4. Consider Adding `error` Field to tool_end When Cancelled

**Current:** When user cancels, the local action is simply not applied.

**Suggestion:** Consider emitting a synthetic event or logging when action is cancelled so the chat history shows what happened:
```typescript
// Add a chat message indicating cancellation
addMessage({
  role: 'system',
  content: `User cancelled: ${pendingDestructive.name}`,
});
```

---

## 🟢 OUT OF SCOPE (Noted, Not Actioned)

1. **Warning-based signaling (`severity: 'caution'`)** — The proposal recommends supporting both approaches, but the spec only implements the `destructive: boolean` flag. The warning-based approach can be added in a follow-up.

2. **Phase 3 features (undoable, requiresAuth)** — Correctly deferred per proposal.

3. **`onToolStart` args parameter** — The spec mentions passing `args` to `onToolStart` in Section 3.4 but this change isn't detailed in the implementation section. Low priority since args are available from the function call itself.

4. **Mermaid diagram** — The spec uses ASCII art for architecture. A Mermaid diagram would be more maintainable but ASCII is acceptable.

---

## Recommendation

**REVISE REQUIRED**

The spec is solid overall but has three blockers:
1. Missing `ZodCommandDefinition` interface update will cause TypeScript errors
2. Sync issue on cancel is a UX bug that needs addressing
3. Note deletion commands are missing from scope

After addressing the 🔴 blockers, the spec will be ready for implementation.

---

## 📋 ACTION NOTES

| Finding | Disposition | Agent Instructions |
|---------|-------------|-------------------|
| #1 ZodCommandDefinition | ✅ Fixed | Added `ZodCommandDefinition` interface update to Section 4.1 |
| #2 Sync on Cancel | ✅ Fixed | Added `handleCancelledDestructiveAction` to Section 4.6 |
| #3 Note Commands | ✅ Fixed | Added `note-delete`, `notefolder-delete` to Section 4.5 and checklist |
| S1 toolsInProgress | 📝 Deferred | Implementation should verify args storage |
| S2 useConfirm reuse | ✅ Applied | Section 4.6 now reuses existing `useConfirm` hook |
| S3 list-delete checklist | ✅ Applied | Added to checklist |
| S4 Cancel logging | ✅ Applied | System message added in `handleCancelledDestructiveAction` |

**All blockers resolved. Spec status: READY**
