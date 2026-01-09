# 06b - Streaming Results

> **Type**: Code Implementation  
> **Priority**: P2  
> **Status**: ✅ Implemented

---

## Implementation Summary

**Completed**: All phases implemented and tested.

| Component | File | Status |
|-----------|------|--------|
| Core types | `packages/core/src/streaming.ts` | ✅ Created |
| Registry extension | `packages/core/src/commands.ts` | ✅ Modified - `executeStream()` |
| Core exports | `packages/core/src/index.ts` | ✅ Modified |
| Server SSE | `packages/server/src/server.ts` | ✅ `GET /stream/:command` endpoint |
| Client methods | `packages/client/src/client.ts` | ✅ `stream()`, `streamWithCallbacks()` |
| CLI command | `packages/cli/src/commands/stream.ts` | ✅ `afd stream` command |
| Tests | `packages/core/src/streaming.test.ts` | ✅ 29 tests passing |

**Key Design Decisions**:
- Discriminated union: `StreamChunk<T> = ProgressChunk | DataChunk<T> | CompleteChunk<T> | ErrorChunk`
- AbortSignal support for cancellation
- ErrorChunk includes `chunksBeforeError`, `recoverable`, optional `resumeFrom`
- CLI supports Ctrl+C cancellation with SIGINT/SIGTERM handling
- Non-streaming commands automatically wrapped in single CompleteChunk

---

## Problem Statement

Some commands return large payloads:

```typescript
// Exporting 10,000 tokens takes several seconds
const result = await execute("export", {
  node: "global",
  format: "json",
  includeInherited: true,
});
// User waits 5+ seconds with no feedback
```

Large payloads cause:

1. **Poor perceived performance** - No progress indication
2. **Memory pressure** - Entire result buffered before delivery
3. **Timeout risk** - Long operations may exceed transport limits

---

## Solution

Add streaming support to AFD for commands that opt-in:

```typescript
// Stream chunks as they're ready
const stream = await executeStream("export", {
  node: "global",
  format: "json",
});

for await (const chunk of stream) {
  if (chunk.type === "progress") {
    updateProgressBar(chunk.progress);
  } else if (chunk.type === "data") {
    appendToOutput(chunk.data);
  }
}
```

---

## API Design

### Stream Chunk Types

```typescript
type StreamChunk<T> =
  | ProgressChunk
  | DataChunk<T>
  | CompleteChunk<T>
  | ErrorChunk;

interface ProgressChunk {
  type: "progress";
  progress: number; // 0-1
  message?: string; // "Processing node 150 of 10000"
  estimatedMs?: number; // Estimated time remaining
}

interface DataChunk<T> {
  type: "data";
  data: T; // Partial result
  index?: number; // Chunk index for ordering
}

interface CompleteChunk<T> {
  type: "complete";
  result: CommandResult<T>; // Final result with metadata
}

interface ErrorChunk {
  type: "error";
  error: CommandError;
  partial?: unknown; // Any partial results before error
}
```

### Command Definition

Commands opt-in to streaming:

```typescript
const exportCommand: CommandDefinition = {
  name: "export",
  description: "Export tokens in various formats",
  inputSchema: ExportInputSchema,
  outputSchema: ExportOutputSchema,

  // New: streaming support
  streaming: true,

  // Handler returns AsyncGenerator instead of Promise
  async *handler(
    input: ExportInput
  ): AsyncGenerator<StreamChunk<ExportOutput>> {
    const nodes = await getAllNodes(input.node);
    const total = nodes.length;

    for (let i = 0; i < nodes.length; i++) {
      // Yield progress
      yield {
        type: "progress",
        progress: i / total,
        message: `Processing ${nodes[i].name}`,
      };

      // Process and yield data chunks
      const tokens = await resolveTokens(nodes[i]);
      yield { type: "data", data: formatTokens(tokens, input.format) };
    }

    // Yield final result
    yield {
      type: "complete",
      result: { success: true, data: { totalTokens: total } },
    };
  },
};
```

---

## Implementation

### Phase 1: Core Types

```typescript
// packages/core/src/streaming.ts
export type StreamChunk<T> =
  | ProgressChunk
  | DataChunk<T>
  | CompleteChunk<T>
  | ErrorChunk;

export interface StreamableCommand<TInput, TOutput>
  extends CommandDefinition<TInput, TOutput> {
  streaming: true;
  handler(input: TInput): AsyncGenerator<StreamChunk<TOutput>>;
}

export function isStreamableCommand(
  cmd: unknown
): cmd is StreamableCommand<unknown, unknown>;
```

### Phase 2: Registry Support

```typescript
class CommandRegistry {
  // Existing
  async execute<T>(name: string, input: unknown): Promise<CommandResult<T>>;

  // New: streaming execution
  async *executeStream<T>(
    name: string,
    input: unknown
  ): AsyncGenerator<StreamChunk<T>> {
    const command = this.commands.get(name);

    if (!command) {
      yield {
        type: "error",
        error: {
          code: "COMMAND_NOT_FOUND",
          message: `Unknown command: ${name}`,
        },
      };
      return;
    }

    if (!isStreamableCommand(command)) {
      // Non-streaming command: wrap in single complete chunk
      const result = await this.execute<T>(name, input);
      yield { type: "complete", result };
      return;
    }

    // Streaming command: forward chunks
    try {
      yield* command.handler(input);
    } catch (error) {
      yield { type: "error", error: normalizeError(error) };
    }
  }
}
```

### Phase 3: Transport Support

| Transport  | Implementation                          |
| ---------- | --------------------------------------- |
| In-process | Direct `AsyncGenerator` consumption     |
| HTTP/REST  | Server-Sent Events (SSE)                |
| MCP        | `notifications/progress` + final result |
| WebSocket  | Stream of JSON messages                 |

**HTTP/SSE Example:**

```typescript
// Server
app.get("/stream/:command", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  const stream = registry.executeStream(req.params.command, req.body);

  for await (const chunk of stream) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  res.end();
});

// Client
const eventSource = new EventSource("/stream/export?node=global");
eventSource.onmessage = (event) => {
  const chunk = JSON.parse(event.data);
  handleChunk(chunk);
};
```

### Phase 4: Client SDK

```typescript
class AFDClient {
  // Existing
  async execute<T>(name: string, input: unknown): Promise<CommandResult<T>>;

  // New
  async *stream<T>(
    name: string,
    input: unknown
  ): AsyncGenerator<StreamChunk<T>>;

  // Convenience: stream with callbacks
  streamWithCallbacks<T>(
    name: string,
    input: unknown,
    callbacks: {
      onProgress?: (progress: number, message?: string) => void;
      onData?: (data: T) => void;
      onComplete?: (result: CommandResult<T>) => void;
      onError?: (error: CommandError) => void;
    }
  ): AbortController;
}
```

---

## Use Cases

### 1. Large Exports

```typescript
const stream = client.stream("export", { node: "global", format: "json" });
const chunks: string[] = [];

for await (const chunk of stream) {
  if (chunk.type === "progress") {
    progressBar.value = chunk.progress;
  } else if (chunk.type === "data") {
    chunks.push(chunk.data);
  }
}

const fullExport = chunks.join("");
```

### 2. Long-Running Operations

```typescript
const controller = client.streamWithCallbacks(
  "lora.train",
  { loraId: "xyz" },
  {
    onProgress: (progress, message) => {
      console.log(`${(progress * 100).toFixed(0)}%: ${message}`);
    },
    onComplete: (result) => {
      console.log("Training complete!", result.data);
    },
  }
);

// Cancel if needed
cancelButton.onclick = () => controller.abort();
```

### 3. Incremental Search Results

```typescript
for await (const chunk of client.stream("search", { query: "color" })) {
  if (chunk.type === "data") {
    // Render results as they arrive
    renderSearchResult(chunk.data);
  }
}
```

---

## Non-Streaming Fallback

Commands without `streaming: true` work transparently:

```typescript
// Non-streaming command
const stream = client.stream("node.get", { id: "xbox" });

for await (const chunk of stream) {
  // Only receives one 'complete' chunk
  if (chunk.type === "complete") {
    console.log(chunk.result);
  }
}
```

---

## Testing

```typescript
describe("executeStream", () => {
  it("streams progress updates", async () => {
    const chunks: StreamChunk<unknown>[] = [];

    for await (const chunk of registry.executeStream("slow.export", {
      count: 10,
    })) {
      chunks.push(chunk);
    }

    const progressChunks = chunks.filter((c) => c.type === "progress");
    expect(progressChunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1].type).toBe("complete");
  });

  it("handles errors mid-stream", async () => {
    const chunks: StreamChunk<unknown>[] = [];

    for await (const chunk of registry.executeStream("failing.export", {})) {
      chunks.push(chunk);
    }

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
  });

  it("wraps non-streaming commands", async () => {
    const chunks: StreamChunk<unknown>[] = [];

    for await (const chunk of registry.executeStream("node.get", {
      id: "root",
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("complete");
  });
});
```

---

## Success Criteria

| Metric                 | Target                               |
| ---------------------- | ------------------------------------ |
| Time to first chunk    | < 100ms for streaming commands       |
| Memory overhead        | Stream without buffering full result |
| Backward compatibility | Non-streaming commands unchanged     |
| Cancellation           | Streams can be aborted mid-flight    |

---

## Files to Create/Modify

| File                             | Action                          |
| -------------------------------- | ------------------------------- |
| `packages/core/src/streaming.ts` | Create - Types and utilities    |
| `packages/core/src/registry.ts`  | Modify - Add `executeStream`    |
| `packages/core/src/index.ts`     | Modify - Export streaming types |
| `packages/server/src/server.ts`  | Modify - Add SSE endpoint       |
| `packages/client/src/index.ts`   | Modify - Add stream methods     |
| `docs/command-schema-guide.md`   | Modify - Document streaming     |

---

## MCP Streaming Support (Research Complete)

MCP has **native progress notification support** via JSON-RPC, not SSE. This is the recommended approach for MCP transport.

### MCP Progress Protocol

**Request with progress token:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "export",
    "arguments": { "node": "global", "format": "json" },
    "_meta": {
      "progressToken": "export-abc123"
    }
  }
}
```

**Progress notifications (sent during execution):**
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": {
    "progressToken": "export-abc123",
    "progress": 50,
    "total": 100
  }
}
```

**Final result (normal response):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{...}" }]
  }
}
```

### MCP Implementation Strategy

| AFD Chunk Type | MCP Mapping |
| -------------- | ----------- |
| `ProgressChunk` | `notifications/progress` with `progressToken` |
| `DataChunk` | Not directly supported - embed in progress or final result |
| `CompleteChunk` | Normal JSON-RPC response |
| `ErrorChunk` | JSON-RPC error response |

**Implementation in `@afd/server`:**

```typescript
// MCP tool handler with progress support
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args, _meta } = request.params;
  const progressToken = _meta?.progressToken;
  
  const command = registry.get(name);
  
  if (isStreamableCommand(command) && progressToken) {
    // Stream progress via MCP notifications
    for await (const chunk of command.handler(args)) {
      if (chunk.type === 'progress') {
        await server.notification({
          method: 'notifications/progress',
          params: {
            progressToken,
            progress: chunk.progress * 100,
            total: 100
          }
        });
      }
    }
  }
  
  // Return final result
  const result = await registry.execute(name, args);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

### Transport Comparison

| Transport | Streaming Mechanism | Data Chunks | Progress |
| --------- | ------------------- | ----------- | -------- |
| In-process | `AsyncGenerator` | ✅ Native | ✅ Native |
| HTTP/REST | Server-Sent Events (SSE) | ✅ Via events | ✅ Via events |
| MCP | `notifications/progress` | ⚠️ Limited | ✅ Native |
| WebSocket | JSON messages | ✅ Via messages | ✅ Via messages |

**MCP Limitation**: MCP's progress notifications are designed for progress tracking, not streaming data chunks. For large data exports via MCP:
1. Use progress notifications for status updates
2. Return chunked data in final result, or
3. Return a URL/reference where client can fetch streamed data

---

## Open Questions

1. **Backpressure** - Should consumers be able to pause streams?
2. **Chunk size** - Should we enforce max chunk sizes?
3. **MCP data streaming** - Should we extend MCP protocol for data chunks, or use hybrid approach (progress via MCP, data via separate endpoint)?
