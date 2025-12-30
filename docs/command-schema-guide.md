# Command Schema Design Guide

This guide explains how to design command schemas in AFD that enable good agent user experiences. Well-designed commands don't just "work"—they return data that enables transparency, trust, and effective human-agent collaboration.

## Why Schema Design Matters

In AFD, commands are the product. Every agent interaction, every UI action, every automated workflow—all invoke commands. The data your commands return directly impacts:

- **Can users trust the agent?** → Return confidence scores and reasoning
- **Can users understand what happened?** → Return structured, inspectable results
- **Can users see the plan?** → Return step-by-step breakdowns
- **Can users verify sources?** → Return attribution data
- **Can users recover from errors?** → Return actionable error information

## The CommandResult Interface

Every command should return a structured result that includes both the core data and UX-enabling metadata:

```typescript
interface CommandResult<T> {
  // ═══════════════════════════════════════════════════════════════
  // CORE FIELDS (Required)
  // ═══════════════════════════════════════════════════════════════
  
  /** Whether the command succeeded */
  success: boolean;
  
  /** The primary result data (type varies by command) */
  data?: T;
  
  /** Error information if success is false */
  error?: CommandError;

  // ═══════════════════════════════════════════════════════════════
  // UX-ENABLING FIELDS (Recommended)
  // ═══════════════════════════════════════════════════════════════
  
  /** 
   * Agent's confidence in this result (0-1)
   * Enables: Confidence indicators in UI
   * Example: 0.95 for high confidence, 0.6 for uncertain
   */
  confidence?: number;
  
  /**
   * Why this result was produced
   * Enables: Transparency, "why did the agent do this?"
   * Example: "Selected this option because it matches your stated preference for brevity"
   * 
   * ⚠️ Production Note: Raw reasoning may contain sensitive information
   * (document excerpts, internal policies). Consider sanitizing for production.
   * See: docs/production-considerations.md#sensitive-information-in-reasoning
   */
  reasoning?: string;
  
  /**
   * Information sources used
   * Enables: Source attribution, verification
   * Example: [{ type: 'document', id: 'doc-123', title: 'Style Guide' }]
   */
  sources?: Source[];
  
  /**
   * Steps in a multi-step operation
   * Enables: Plan visualization, progress tracking
   * Example: [{ id: '1', action: 'fetch', status: 'complete' }, ...]
   */
  plan?: PlanStep[];
  
  /**
   * Other options the agent considered
   * Enables: Alternative exploration, user choice
   * Example: [{ option: 'B', reason: 'More formal tone' }, ...]
   */
  alternatives?: Alternative<T>[];
  
  /**
   * Non-fatal issues to surface
   * Enables: Proactive transparency
   * Example: [{ code: 'OUTDATED_SOURCE', message: 'Style guide is 6 months old' }]
   */
  warnings?: Warning[];
  
  /**
   * Execution metadata
   * Enables: Performance monitoring, debugging
   */
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
  /** Machine-readable error code */
  code: string;
  
  /** Human-readable error message */
  message: string;
  
  /** What the user can do about it */
  suggestion?: string;
  
  /** Whether retrying might succeed */
  retryable?: boolean;
  
  /** Technical details for debugging */
  details?: Record<string, unknown>;
}

interface Source {
  /** Source type: 'document', 'url', 'database', 'user_input', etc. */
  type: string;
  
  /** Unique identifier */
  id?: string;
  
  /** Human-readable title */
  title?: string;
  
  /** URL if applicable */
  url?: string;
  
  /** Specific location within source */
  location?: string;
}

interface PlanStep {
  /** Step identifier */
  id: string;
  
  /** What this step does */
  action: string;
  
  /** Current status */
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';
  
  /** Human-readable description */
  description?: string;
  
  /** Steps this depends on */
  dependsOn?: string[];
  
  /** Result of this step if complete */
  result?: unknown;
  
  /** Error if failed */
  error?: CommandError;
}

interface Alternative<T> {
  /** The alternative result */
  data: T;
  
  /** Why this wasn't chosen */
  reason: string;
  
  /** Confidence in this alternative */
  confidence?: number;
}

interface Warning {
  /** Warning code */
  code: string;
  
  /** Human-readable message */
  message: string;
  
  /** Severity level */
  severity?: 'info' | 'warning' | 'caution';
}
```

## Design Principles

### 1. Return Data for the UI You Want

Before implementing a command, ask: "What does the UI need to display a good experience?"

| If the UI needs to show... | Your command should return... |
|---------------------------|------------------------------|
| A confidence meter | `confidence: 0.87` |
| "Why did the agent do this?" | `reasoning: "Because..."` |
| A list of sources | `sources: [...]` |
| A progress indicator | `plan: [{ status: 'in_progress' }, ...]` |
| "Other options" | `alternatives: [...]` |
| Warning banners | `warnings: [...]` |

### 2. Errors Should Be Actionable

Bad error:
```json
{ "success": false, "error": { "code": "ERROR", "message": "Failed" } }
```

Good error:
```json
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

Don't return `confidence: 1.0` unless you're absolutely certain. Well-calibrated confidence:

| Confidence | Meaning | UI Treatment |
|------------|---------|--------------|
| 0.9 - 1.0 | Very high confidence | Auto-apply safe |
| 0.7 - 0.9 | High confidence | Show as recommendation |
| 0.5 - 0.7 | Moderate confidence | Require confirmation |
| < 0.5 | Low confidence | Show alternatives prominently |

### 4. Sources Enable Verification

Always include sources when the result depends on external information:

```typescript
// Good: User can verify
{
  data: { recommendation: "Use sentence case for headings" },
  sources: [
    { type: 'document', title: 'Microsoft Style Guide', location: 'Chapter 3.2' }
  ]
}

// Bad: User can't verify
{
  data: { recommendation: "Use sentence case for headings" }
}
```

### 5. Plans Enable Oversight

For multi-step operations, return the plan so users can:
- See what will happen before it happens
- Track progress during execution
- Understand what went wrong if it fails

```typescript
{
  success: true,
  data: { documentsProcessed: 15 },
  plan: [
    { id: '1', action: 'scan', status: 'complete', description: 'Scanned folder for documents' },
    { id: '2', action: 'filter', status: 'complete', description: 'Filtered to .md files' },
    { id: '3', action: 'process', status: 'complete', description: 'Processed 15 documents' },
    { id: '4', action: 'report', status: 'complete', description: 'Generated summary report' }
  ]
}
```

## Command Categories

Different command types emphasize different UX fields:

### Query Commands (Read-only)
Emphasis: `confidence`, `sources`, `alternatives`

```typescript
// Example: search.documents
{
  success: true,
  data: { results: [...] },
  confidence: 0.85,
  sources: [{ type: 'index', title: 'Document Index' }],
  alternatives: [
    { data: { results: [...] }, reason: 'Broader search criteria' }
  ]
}
```

### Mutation Commands (Write)
Emphasis: `plan`, `warnings`, error `retryable`

```typescript
// Example: document.update
{
  success: true,
  data: { updated: true },
  plan: [
    { id: '1', action: 'validate', status: 'complete' },
    { id: '2', action: 'backup', status: 'complete' },
    { id: '3', action: 'update', status: 'complete' }
  ],
  warnings: [
    { code: 'LARGE_CHANGE', message: '47 lines modified', severity: 'info' }
  ]
}
```

### Analysis Commands (AI-powered)
Emphasis: `confidence`, `reasoning`, `sources`, `alternatives`

```typescript
// Example: content.review
{
  success: true,
  data: { 
    issues: [...],
    suggestions: [...]
  },
  confidence: 0.78,
  reasoning: "Based on the Microsoft Style Guide and your team's custom terminology list",
  sources: [
    { type: 'document', title: 'Microsoft Style Guide' },
    { type: 'document', title: 'Team Terminology', id: 'term-001' }
  ],
  alternatives: [
    { 
      data: { issues: [...], suggestions: [...] },
      reason: 'Stricter interpretation of style rules',
      confidence: 0.65
    }
  ]
}
```

### Long-Running Commands
Emphasis: `plan` with real-time status, `metadata.traceId`

```typescript
// Initial response
{
  success: true,
  data: { jobId: 'job-123' },
  plan: [
    { id: '1', action: 'initialize', status: 'complete' },
    { id: '2', action: 'process', status: 'in_progress', description: 'Processing 1000 items...' },
    { id: '3', action: 'finalize', status: 'pending' }
  ],
  metadata: { traceId: 'trace-abc-123' }
}
```

## What is NOT a Command

Not everything should be a command. Over-commanding creates noise, bloats your registry, and confuses the boundary between application logic and UI state.

### Ephemeral UI State

**Not commands:**
- Hover states
- Focus/blur events
- Scroll position
- Tooltip visibility
- Modal open/close (unless it persists state)

**Why**: These are transient UI interactions with no business logic. They may *trigger* commands, but they aren't commands themselves.

```
User hovers → UI shows preview → UI calls document.getSummary (this IS a command)
                                 ↑ The command exists; hover is just a trigger
```

### View Preferences (Unless Persisted)

**Not commands** (if session-only):
- Sort order
- Column visibility
- List vs grid view
- Filter selections

**ARE commands** (if persisted):
- `preferences.save --sortOrder "date-desc"`
- `view.configure --columns ["name", "date", "status"]`

**Rule of thumb**: If it survives a page refresh, it's probably backed by a command.

### Derived/Computed Values

**Not commands:**
- Calculating a total from line items
- Formatting a date for display
- Filtering a local array
- Sorting already-fetched data

**Why**: If the data already exists and the computation is pure, it's a UI concern. Commands are for actions that have effects or retrieve data.

### Internal Framework Events

**Not commands:**
- Component lifecycle (mount, unmount)
- Route transitions
- State subscription setup
- Render cycles

**Why**: These are framework plumbing, not application actions.

### The Litmus Test

Ask yourself:

1. **Would an agent ever need to do this?** If no, probably not a command.
2. **Does it have side effects or fetch data?** If no, probably not a command.
3. **Could this be done entirely client-side with existing data?** If yes, probably not a command.
4. **Would you write a CLI script for this?** If that seems absurd, it's not a command.

### Examples

| Action | Command? | Why |
|--------|----------|-----|
| "Get document list" | ✅ Yes | Fetches data |
| "Create document" | ✅ Yes | Has side effects |
| "Sort documents by date" (local) | ❌ No | Client-side, no fetch |
| "Set sort preference" (persisted) | ✅ Yes | Persists user preference |
| "Show tooltip on hover" | ❌ No | Ephemeral UI state |
| "Expand accordion section" | ❌ No | Local UI state |
| "Toggle dark mode" (persisted) | ✅ Yes | Persists preference |
| "Calculate order total" | ❌ No | Derived from existing data |

## Validation Checklist

Before shipping a command, verify:

- [ ] **Success case** returns meaningful `data`
- [ ] **Error case** has actionable `error.suggestion`
- [ ] **AI-powered commands** include `confidence` and `reasoning`
- [ ] **External data** commands include `sources`
- [ ] **Multi-step commands** include `plan`
- [ ] **Uncertain results** include `alternatives`
- [ ] **Non-fatal issues** surface as `warnings`
- [ ] **CLI test** passes with structured output

## CLI Validation

Test your commands via CLI to ensure the schema is correct:

```bash
# Call command and inspect full result
afd call content.review --input "Check this text" --format json

# Verify specific fields exist
afd call content.review --input "Check this text" | jq '.confidence, .reasoning, .sources'

# Test error handling
afd call content.review --input "" --expect-error
```

## Related

- [Trust Through Validation](./trust-through-validation.md) - Why CLI validation matters
- [Implementation Phases](./implementation-phases.md) - When to add which fields
- [Production Considerations](./production-considerations.md) - Security, mutation safety, sensitive reasoning
- [Agentic AI UX Design Principles](/Agentic%20AI%20UX%20Design%20Principles/) - The UX principles these schemas enable
