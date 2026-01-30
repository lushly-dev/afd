---
proposal: command-exposure-undo
reviewer: Claude Opus 4.5
date: 2026-01-24
round: 2
verdict: APPROVED (comment only)
---

# Command Exposure & Undo Metadata — Review Round 2

## Context

Follow-up review of `docs/features/proposed/command-exposure-undo/proposal.md` (round 2) verifying resolution of three blockers from initial review.

**Previous Verdict:** REVISE REQUIRED

---

## Blocker Verification

### Blocker 1: `list()` Filter API Inconsistent

**Original Issue:** Proposed `list(filter?: { expose?: keyof ExposeOptions })` broke existing method conventions (`listByCategory`, `listByTags`).

**Resolution in v2:**
```typescript
// Lines 119-129: New method following existing patterns
listByExposure(interface: keyof ExposeOptions): CommandDefinition[] {
  return Array.from(commands.values()).filter(cmd => {
    const expose = cmd.expose ?? defaultExpose;
    return expose[interface] === true;
  });
}
```

**Status:** RESOLVED

The proposal now uses a dedicated method matching the established `listByX()` pattern. Filter logic correctly applies `defaultExpose` when `cmd.expose` is undefined.

---

### Blocker 2: Missing Blocked Call Behavior

**Original Issue:** No specification for what happens when a command is invoked through a non-exposed interface.

**Resolution in v2:**
```typescript
// Lines 150-166: Explicit error handling in execute()
if (context.interface) {
  const expose = cmd.expose ?? defaultExpose;
  if (!expose[context.interface]) {
    return failure({
      code: 'COMMAND_NOT_EXPOSED',
      message: `Command '${id}' is not exposed to ${context.interface}`,
      retryable: false,
    });
  }
}
```

**Status:** RESOLVED

Implements Option A from original review (structured error return) which is correct for headless compatibility. Agents and MCP clients can handle gracefully without try/catch.

---

### Blocker 3: No Undo Validation

**Original Issue:** `undoable: true` is purely declarative with no mechanism to validate the undo handler exists.

**Resolution in v2:**
```typescript
// Lines 103-109: Optional validation at registration
registry.register(command, {
  validateUndo: true  // Warns if undoable but no undo handler resolvable
});
```

**Status:** RESOLVED

Validation is opt-in at registration time, which is appropriate—it warns during development but doesn't force all consumers to use it.

---

## Incorporated Suggestions

The proposal also adopted two suggestions from the initial review:

### 1. Frozen Default Object

```typescript
// Lines 62-68
export const defaultExpose: Readonly<ExposeOptions> = Object.freeze({
  palette: true,
  agent: true,
  mcp: false,
  cli: false,
});
```

Prevents accidental mutation of defaults.

### 2. Headless Detection Helper

```typescript
// Lines 173-178
export function isHeadlessContext(ctx: CommandContext): boolean {
  return ctx.interface === 'cli' || ctx.interface === 'mcp';
}
```

Utility for consumers to adapt output format.

---

## Implementation Quality Notes

1. **Task breakdown is complete** — Tasks 1-7 cover all required changes
2. **File changes table accurate** — Three files modified, locations specified
3. **CommandResult undo fields** — Kept at top level (not nested in metadata); acceptable trade-off for discoverability
4. **Defaults rationale clear** — `mcp: false` and `cli: false` are security-conscious opt-in defaults

---

## Verdict

**APPROVED (comment only)**

All three blockers have been properly addressed:
- `listByExposure()` follows existing registry patterns
- `COMMAND_NOT_EXPOSED` error provides graceful failure path
- `validateUndo` option catches missing undo handlers at registration

Proposal is ready for implementation. Note: Proposals cannot be merged; this approval is for documentation purposes only.

---

## Cross-Reference

| Document | Status |
|----------|--------|
| Initial review | `command-exposure-undo.review.md` — REVISE REQUIRED |
| This review | `command-exposure-undo-review-v2.md` — APPROVED |
| Proposal | `proposal.md` — `status: approved` (line 2) |
