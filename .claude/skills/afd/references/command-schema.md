# Command Schema Design Guide

This guide explains how to design command schemas in AFD that enable good agent user experiences. Well-designed commands don't just "work"---they return data that enables transparency, trust, and effective human-agent collaboration.

## Why Schema Design Matters

In AFD, commands are the product. Every agent interaction, every UI action, every automated workflow---all invoke commands. The data your commands return directly impacts:

- **Can users trust the agent?** -> Return confidence scores and reasoning
- **Can users understand what happened?** -> Return structured, inspectable results
- **Can users see the plan?** -> Return step-by-step breakdowns
- **Can users verify sources?** -> Return attribution data
- **Can users recover from errors?** -> Return actionable error information

## The CommandResult Interface

Every command should return a structured result that includes both the core data and UX-enabling metadata:

```typescript
interface CommandResult<T> {
  // CORE FIELDS (Required)
  success: boolean;
  data?: T;
  error?: CommandError;

  // UX-ENABLING FIELDS (Recommended)
  confidence?: number;       // 0-1, enables confidence indicators
  reasoning?: string;        // Explains "why" for transparency
  sources?: Source[];        // Information sources for verification
  plan?: PlanStep[];         // Steps in multi-step operations
  alternatives?: Alternative<T>[]; // Other options considered
  warnings?: Warning[];      // Non-fatal issues to surface
  metadata?: {
    executionTimeMs?: number;
    commandVersion?: string;
    traceId?: string;
  };
}
```

## Supporting Types

```typescript
interface CommandError {
  code: string;
  message: string;
  suggestion?: string;    // What the user can do about it
  retryable?: boolean;
  details?: Record<string, unknown>;
}

interface Source {
  type: string;           // 'document', 'url', 'database', 'user_input'
  id?: string;
  title?: string;
  url?: string;
  location?: string;      // Specific location within source
}

interface PlanStep {
  id: string;
  action: string;
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';
  description?: string;
  dependsOn?: string[];
  result?: unknown;
  error?: CommandError;
}

interface Alternative<T> {
  data: T;
  reason: string;         // Why this wasn't chosen
  confidence?: number;
}

interface Warning {
  code: string;
  message: string;
  severity?: 'info' | 'warning' | 'caution';
}
```

## Command Naming Conventions

Command names must be compatible with the MCP specification: `^[a-zA-Z0-9_-]{1,64}$`.

| Rule | Example | Rationale |
|------|---------|-----------|
| Use hyphens as separators | `todo-create`, `user-update` | MCP-compatible, IDE-friendly |
| Keep names lowercase | `todo-list` not `Todo-List` | Consistency, CLI-friendly |
| Use `namespace-action` pattern | `todo-create`, `auth-login` | Groups related commands |
| Max 64 characters | `user-profile-update` | MCP limit |
| No dots | ~~`todo.create`~~ | Dots not allowed by MCP regex |

## Command Tags

Commands can include a `tags` array for filtering, grouping, and permission control:

```typescript
defineCommand({
  name: 'todo-delete',
  category: 'todo',
  tags: ['todo', 'delete', 'write', 'single', 'destructive'],
  mutation: true,
});
```

### Standard Tag Categories

| Category | Example Tags | Purpose |
|----------|-------------|---------|
| **Entity** | `todo`, `user`, `document` | Domain grouping |
| **Action** | `create`, `read`, `update`, `delete`, `list` | CRUD classification |
| **Scope** | `single`, `batch` | Operation cardinality |
| **Risk** | `destructive`, `safe` | Agent safety hints |
| **Access** | `bootstrap`, `admin`, `public` | Permission filtering |

## Command Prerequisites

Commands can declare planning-order dependencies via the `requires` field. This is metadata only — not enforced at runtime — and helps agents reason about execution order.

```typescript
defineCommand({
  name: 'order-create',
  description: 'Creates a new order for the authenticated user',
  requires: ['auth-sign-in'],  // Agent should call auth-sign-in first
  mutation: true,
  input: z.object({ items: z.array(z.string()) }),
  async handler(input) { /* ... */ },
});
```

**Key rules:**
- `requires` entries must reference commands registered in the same surface (validated by `unresolved-prerequisite` rule)
- No circular dependencies allowed (validated by `circular-prerequisite` rule)
- Prerequisites are exposed via MCP tool `_meta.requires` and `afd-help` full format

## Design Principles

### 1. Return Data for the UI You Want

| If the UI needs to show... | Your command should return... |
|---------------------------|------------------------------|
| A confidence meter | `confidence: 0.87` |
| "Why did the agent do this?" | `reasoning: "Because..."` |
| A list of sources | `sources: [...]` |
| A progress indicator | `plan: [{ status: 'in_progress' }, ...]` |
| "Other options" | `alternatives: [...]` |
| Warning banners | `warnings: [...]` |

### 2. Errors Should Be Actionable

```json
// Bad
{ "success": false, "error": { "code": "ERROR", "message": "Failed" } }

// Good
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "API rate limit exceeded",
    "suggestion": "Wait 60 seconds and try again, or upgrade to a higher tier",
    "retryable": true,
    "details": { "retryAfterSeconds": 60, "currentTier": "free" }
  }
}
```

### 3. Confidence Should Be Calibrated

| Confidence | Meaning | UI Treatment |
|------------|---------|--------------|
| 0.9 - 1.0 | Very high | Auto-apply safe |
| 0.7 - 0.9 | High | Show as recommendation |
| 0.5 - 0.7 | Moderate | Require confirmation |
| < 0.5 | Low | Show alternatives prominently |

### 4. Sources Enable Verification

Always include sources when the result depends on external information.

### 5. Plans Enable Oversight

For multi-step operations, return the plan so users can see what will happen, track progress, and understand failures.

## Command Categories

Different command types emphasize different UX fields:

| Category | Key UX Fields |
|----------|---------------|
| **Query** (read-only) | `confidence`, `sources`, `alternatives` |
| **Mutation** (write) | `plan`, `warnings`, error `retryable` |
| **Analysis** (AI-powered) | `confidence`, `reasoning`, `sources`, `alternatives` |
| **Long-Running** | `plan` with real-time status, `metadata.traceId` |
| **Batch** | Partial failure handling, `warnings`, calibrated `confidence` |

### Batch Commands

Batch commands process multiple items with best-effort execution. They return per-item results rather than all-or-nothing.

```typescript
interface BatchResult<T> {
  succeeded: T[];
  failed: FailedItem[];
  summary: { total: number; successCount: number; failureCount: number; };
}
```

Key patterns:
1. **Confidence reflects success rate**: `successCount / total`
2. **Always return `success: true`**: Even with partial failures
3. **Failed items include index**: So agents/UIs can identify which input failed
4. **Use warnings for partial success**: `PARTIAL_SUCCESS` warning

## What is NOT a Command

Not everything should be a command. Over-commanding creates noise and bloats the registry.

### Not Commands:
- **Ephemeral UI state**: Hover, focus, scroll, tooltip visibility
- **View preferences** (unless persisted): Sort order, column visibility, list/grid toggle
- **Derived/computed values**: Totals from line items, date formatting, local filtering
- **Framework events**: Component lifecycle, route transitions, render cycles

### The Litmus Test

1. **Would an agent ever need to do this?** If no, not a command.
2. **Does it have side effects or fetch data?** If no, not a command.
3. **Could this be done entirely client-side with existing data?** If yes, not a command.
4. **Would you write a CLI script for this?** If that seems absurd, not a command.

| Action | Command? | Why |
|--------|----------|-----|
| Get document list | Yes | Fetches data |
| Create document | Yes | Has side effects |
| Sort documents locally | No | Client-side, no fetch |
| Set sort preference (persisted) | Yes | Persists preference |
| Show tooltip on hover | No | Ephemeral UI state |
| Toggle dark mode (persisted) | Yes | Persists preference |
| Calculate order total | No | Derived from existing data |

## Validation Checklist

Before shipping a command:

- [ ] Success case returns meaningful `data`
- [ ] Error case has actionable `error.suggestion`
- [ ] AI-powered commands include `confidence` and `reasoning`
- [ ] External data commands include `sources`
- [ ] Multi-step commands include `plan`
- [ ] Uncertain results include `alternatives`
- [ ] Non-fatal issues surface as `warnings`
- [ ] CLI test passes with structured output
