# Command progress and MCP progress notifications

> **Goal**: Let a running command report progress, and deliver it to every caller: as MCP `notifications/progress` on the `tools/call` response stream, as `progress` chunks on `/stream`, and as callbacks in DirectClient.

| Field | Value |
|---|---|
| Status | Proposed 2026-10-25. Ranked 3 of 4 among the [MCP 2026-07-28 Phase 7 follow-ons](../../active/mcp-2026-07-28/proposal.md#phase-7-optional-follow-ons-each-its-own-proposal). |
| Author | jasfalk (drafted with Claude) |
| Spec | [Progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/progress), [cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/cancellation), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) |
| Packages | `spec/`, `packages/core`, `packages/server`, `packages/client`, `python/`, `packages/rust`, `packages/cpp` |
| Related | `spec/wire/stream-chunks.json`, [MCP tasks](../mcp-tasks/mcp-tasks.proposal.md) (tasks carry status messages instead of progress) |

## Why this is third

| Criterion | Assessment |
|---|---|
| Value | Medium. Long commands stop looking hung, and clients can reset their timeouts while progress arrives. Most AFD commands finish quickly, so few users need it today. |
| Readiness | High on the MCP side. All three SDKs can send a notification tied to the current request. The real work is in AFD's core, where no handler can report progress yet. |
| Effort | M. One context field in four languages, an incremental stream executor, and one forwarding hook per server. |
| Dependencies | None. Tasks reuse the progress hook for their status messages. |

## Today

- TypeScript `executeStream` is buffered. The command runs to completion, then an array result becomes one data chunk per item, followed by `complete`. No progress chunks are emitted.
- `ProgressChunk` exists as a type (`progress` from 0 to 1, plus `message`, `currentStep`, `totalSteps`, `itemsProcessed`), with a wire vector, but nothing produces it.
- `CommandContext` has `signal` and `timeout` in TypeScript, `timeout` only in Python, `timeout_ms` only in Rust, and a `CancellationToken` in C++. None has a progress callback.
- The MCP `tools/call` handler passes the request's abort signal and returns one result. No AFD server sends `notifications/progress`.
- C++ `execute_stream` is also buffered. Python and Rust have chunk types but no stream executor.

## Proposal

### A progress hook on the command context

`CommandContext` gains a `progress` function. Handlers call it while they work. It is always present, and does nothing when no caller is listening, so handlers never check for it.

```ts
handler: async (input, context) => {
  for (const [i, file] of files.entries()) {
    await convert(file);
    context.progress({ progress: (i + 1) / files.length, message: file.name });
  }
  return success({ converted: files.length });
}
```

| Language | Shape |
|---|---|
| TypeScript | `context.progress(update: ProgressUpdate): void` |
| Python | `context.progress(progress, message=None, **detail)`, plus an async-safe `CommandContext.cancelled` |
| Rust | `context.progress(ProgressUpdate)`, plus a cancellation token on the context |
| C++ | `context.progress(const ProgressUpdate&)`, next to the existing `CancellationToken` |

`ProgressUpdate` is the existing `ProgressChunk` without `type`. The executor enforces the rules that MCP requires, so every surface benefits:

- **Monotonic.** An update whose `progress` is lower than the last is dropped.
- **Rate-limited.** Updates are coalesced to at most one every 100 ms by default. The last update before completion is always sent.
- **Bounded.** Updates after the command finishes are dropped.

### Delivery

| Surface | Behavior |
|---|---|
| MCP, modern | When `_meta.progressToken` is present, each update becomes `notifications/progress` with `progress` as given, `total: 1`, and `message`. The TypeScript server sends through `ctx.mcpReq.notify`, which upgrades the response to SSE on the first notification. Python uses `report_progress`, and Rust uses `notify_progress`. |
| MCP, legacy | Same notifications, on the legacy stream. |
| MCP, `afd-batch` and `afd-pipe` | Progress counts steps: step `i` of `n`, with the running step's own progress inside it, and the step's command name as the message. |
| `/stream` | `executeStream` becomes incremental: progress chunks are interleaved with data chunks while the command runs. |
| DirectClient | An `onProgress` option on `call` and `pipe`. |

Cancellation stays as it is in TypeScript: closing the HTTP stream, or `notifications/cancelled` on stdio, aborts `context.signal`. Python and Rust gain the matching cancellation field, so that a long command can stop when its caller goes away.

### Metadata

A command that reports progress may declare `reportsProgress: true`. The field is advisory, reported in `_meta`, and lets clients decide whether to send a progress token. It replaces the unused `StreamableCommand` marker.

## Spec changes (first PR)

- `spec/command-metadata.md` gains the `reportsProgress` field.
- A new section in the streaming spec defines `ProgressUpdate`, the monotonic, rate and completion rules, and the MCP mapping.
- `spec/wire/stream-chunks.json` gains cases for interleaved progress and data chunks.

## Phases

1. Spec and vectors.
2. TypeScript core (context hook, incremental `executeStream`) and server (MCP forwarding, `/stream`, DirectClient), plus a todo command that reports progress, such as `todo-create-batch`, with conformance cases.
3. Python and Rust: context hook, cancellation, and server forwarding.
4. C++: context hook and an incremental `execute_stream` with callbacks.

## Decisions

| # | Question | Recommendation |
|---|---|---|
| P1 | Is the hook always present or optional? | Always present, as a no-op when nobody listens. |
| P2 | Is `progress` a fraction or a count? | A fraction from 0 to 1, as `ProgressChunk` already is, sent with `total: 1`. |
| P3 | Who enforces monotonic and rate rules? | The executor, for every surface. |
| P4 | What does a batch report? | Step-level progress, with nested progress inside the running step. |
| P5 | Does `executeStream` stay buffered? | No, it becomes incremental. Array results still produce one data chunk per item. |

## Out of scope

Log notifications (`notifications/message`), partial results before completion, and progress on Tasks. The Tasks extension does not carry progress, so the [Tasks proposal](../mcp-tasks/mcp-tasks.proposal.md) maps updates to the task's `statusMessage` instead.

## Sources

- [Progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/progress): `progressToken` in `_meta`, increasing `progress`, an optional `total` and `message`, nothing after completion, rate limiting.
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http): notifications on the request-scoped SSE stream, and closing the stream cancels the request.
- [Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/utilities/cancellation): `notifications/cancelled` on stdio.
- The SDKs as installed: TypeScript `ctx.mcpReq.notify` and response modes in `@modelcontextprotocol/server` 2.4.0, Python `report_progress` in `mcp` 2.3.0, `notify_progress` in rmcp 3.7.0.
