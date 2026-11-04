# Command schema design

A command's result is what the agent and the UI can show. Design it for the UI you want: if
the screen needs a confidence meter, the command returns `confidence`.

The canonical shapes are the wire fixtures: [`spec/wire/result-success-full.json`](../../../../spec/wire/result-success-full.json)
sets every optional field, and [`spec/wire/result-failure.json`](../../../../spec/wire/result-failure.json) a full
`CommandError`. The TypeScript types are in `packages/core/src/result.ts`, `metadata.ts` and
`errors.ts`. Unset optional fields are omitted on the wire, never `null`.

## CommandResult fields

| Field | Use it when the caller needs |
|-------|------------------------------|
| `success`, `data`, `error` | The outcome (required: `success`) |
| `reasoning` | "Why did it do this?" in a sentence |
| `confidence` | A 0-1 reliability signal (see below) |
| `warnings` | Non-fatal side effects: `{ code, message, severity?: 'info' \| 'warning' \| 'caution', details? }` |
| `suggestions` | Next steps, as strings |
| `sources` | Attribution: `{ type, id?, title?, url?, location?, accessedAt?, relevance? }` |
| `plan` | Progress of a multi-step operation: steps with `id`, `action`, `status` (`pending`, `in_progress`, `complete`, `failed`, `skipped`), `dependsOn`, `progress` |
| `alternatives` | Other options considered: `{ data, reason, confidence?, label? }` |
| `undoCommand`, `undoArgs` | A serializable undo (see [command-trust-config.md](command-trust-config.md)) |
| `metadata` | Set by the engine: `executionTimeMs`, `commandVersion`, `traceId`, `actorKind` |

`CommandError` is `{ code, message, suggestion?, retryable?, details?, cause? }`. Make every error
actionable:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "API rate limit exceeded",
    "suggestion": "Wait 60 seconds and try again",
    "retryable": true,
    "details": { "retryAfterSeconds": 60 }
  }
}
```

Use a code from the shared catalog (`ErrorCodes`, documented in [`spec/error-codes.md`](../../../../spec/error-codes.md))
before inventing one; the core helpers (`rateLimitError()`, `timeoutError()`, `notFoundError()`)
set the recommended `retryable` value.

## Which fields to fill

| Command kind | Emphasise |
|--------------|-----------|
| Query | `confidence`, `sources`, `alternatives` |
| Mutation | `warnings`, `plan`, error `retryable` |
| AI-generated | `confidence`, `reasoning`, `sources`, `alternatives` |
| Long-running | `plan` with live status |
| Batch | Per-item results (below) |

**Calibrate confidence.** 0.9 or more: safe to apply automatically. 0.7 to 0.9: show as a
recommendation. 0.5 to 0.7: ask for confirmation. Below 0.5: show the alternatives first. A command
that always returns 1.0 or 0.5 tells the caller nothing.

**Batch commands** (the todo example's `todo-create-batch`) run best-effort and return
`success: true` even when some items fail. `data` is `{ succeeded, failed, summary: { total,
successCount, failureCount } }`, each failed item carries its input index, `confidence` is
`successCount / total`, and a partial failure adds a `PARTIAL_SUCCESS` warning.

## Definition metadata

Every definition field, its default and the surfaces that report it are in
[`spec/command-metadata.md`](../../../../spec/command-metadata.md). `destructive`, `confirmPrompt`,
`approval`, `expose` and `undoable` are in [command-trust-config.md](command-trust-config.md). The
others agents plan with:

- **`output`** (Python `output_schema`) describes `data`, not the envelope. It appears as
  `_meta.outputSchema` and in `afd-detail`; agents use it to check pipeline references.
- **`requires: ['auth-sign-in']`** declares planning order. It is metadata only, never enforced.
  `afd validate --surface` reports names not in the surface (`unresolved-prerequisite`) and cycles
  (`circular-prerequisite`).
- **`contexts`** limits where a command is available. A command without `contexts` is available in
  every context.
- **`examples: [{ title, input }]`**: each `input` must pass the input schema when the command is
  defined.
- **`tags`** for filtering: entity (`todo`), action (`create`, `list`), scope (`single`, `batch`),
  risk (`destructive`, `safe`), access (`bootstrap`, `admin`). `handoff: true` and
  `handoffProtocol` add the `handoff` and `handoff:<protocol>` tags themselves. `afd-discover`
  filters on `tag` (with `tagMode: 'all' | 'any'`); `afd-help`'s `filter` is a substring match on
  tags, category and name.

## What is not a command

Over-commanding bloats the surface agents must choose from. Not commands: ephemeral UI state
(hover, focus, scroll, tooltips), view preferences that are not persisted, values derived from data
the client already has (totals, formatting, local sorting) and framework events.

Ask: would an agent ever need to do this? Does it fetch data or have a side effect? Could it be
done entirely client-side? Would a CLI script for it be absurd? Persisting a sort order or a theme
is a command; sorting the visible list is not.
