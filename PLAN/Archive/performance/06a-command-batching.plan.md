# 06a - Command Batching

> **Type**: Code Implementation  
> **Priority**: P1  
> **Status**: ✅ Implemented

---

## Implementation Summary

**Completed**: All phases implemented and tested.

| Component | File | Status |
|-----------|------|--------|
| Core types | `packages/core/src/batch.ts` | ✅ Created |
| Registry extension | `packages/core/src/commands.ts` | ✅ Modified - `executeBatch()` |
| Core exports | `packages/core/src/index.ts` | ✅ Modified |
| Server MCP tool | `packages/server/src/server.ts` | ✅ `afd.batch` tool |
| Server HTTP | `packages/server/src/server.ts` | ✅ `POST /batch` endpoint |
| Client method | `packages/client/src/client.ts` | ✅ `batch()` method |
| CLI command | `packages/cli/src/commands/batch.ts` | ✅ `afd batch` command |
| Tests | `packages/core/src/batch.test.ts` | ✅ 18 tests passing |

**Key Design Decisions**:
- Aggregated confidence: `(successRatio * 0.5) + (avgCommandConfidence * 0.5)`
- Partial success semantics with `stopOnError` option
- BatchSummary tracks `successCount`, `failureCount`, `skippedCount`
- BatchTiming with `startedAt`, `completedAt`, `totalMs`, `averageMs`

---

## Problem Statement

UIs often need multiple commands to render a view:

```typescript
// Current: 3 sequential roundtrips
const node = await execute("node.get", { id: "xbox" });
const tokens = await execute("tokens.resolve", { node: "xbox" });
const constraints = await execute("constraints.list", { node: "xbox" });
// Total: ~150-300ms over network
```

This creates unnecessary latency for common UI patterns.

---

## Solution

Add `executeBatch()` to AFD core that executes multiple commands in a single roundtrip:

```typescript
// Proposed: 1 roundtrip
const results = await executeBatch([
  { command: "node.get", input: { id: "xbox" } },
  { command: "tokens.resolve", input: { node: "xbox" } },
  { command: "constraints.list", input: { node: "xbox" } },
]);
// Total: ~50-100ms over network
```

---

## API Design

### Input Schema

```typescript
interface BatchRequest {
  commands: BatchCommand[];
  options?: BatchOptions;
}

interface BatchCommand {
  id?: string; // Optional client-provided ID for correlation
  command: string; // Command name
  input: unknown; // Command input (validated per-command)
}

interface BatchOptions {
  stopOnError?: boolean; // Stop executing remaining commands on first error (default: false)
  parallel?: boolean; // Execute commands in parallel (default: true for reads, false for mutations)
}
```

### Output Schema

```typescript
interface BatchResult {
  success: boolean; // All commands succeeded
  results: BatchCommandResult[];
  timing: {
    totalMs: number;
    perCommandMs: number[];
  };
}

interface BatchCommandResult {
  id?: string; // Echoed from input
  command: string;
  result: CommandResult<unknown>;
}
```

---

## Implementation

### Phase 1: Core Types

Add to `@afd/core`:

```typescript
// packages/core/src/batch.ts
export interface BatchCommand { ... }
export interface BatchRequest { ... }
export interface BatchResult { ... }

export function createBatchRequest(commands: BatchCommand[]): BatchRequest;
export function isBatchResult(value: unknown): value is BatchResult;
```

### Phase 2: Registry Support

Add to `CommandRegistry`:

```typescript
class CommandRegistry {
  // Existing
  async execute<T>(name: string, input: unknown): Promise<CommandResult<T>>;

  // New
  async executeBatch(request: BatchRequest): Promise<BatchResult>;
}
```

Implementation:

```typescript
async executeBatch(request: BatchRequest): Promise<BatchResult> {
  const { commands, options = {} } = request;
  const { stopOnError = false, parallel = true } = options;

  const startTime = performance.now();
  const results: BatchCommandResult[] = [];
  const timings: number[] = [];

  if (parallel && !this.hasMutations(commands)) {
    // Parallel execution for read-only commands
    const promises = commands.map(async (cmd, i) => {
      const cmdStart = performance.now();
      const result = await this.execute(cmd.command, cmd.input);
      timings[i] = performance.now() - cmdStart;
      return { id: cmd.id, command: cmd.command, result };
    });
    results.push(...await Promise.all(promises));
  } else {
    // Sequential execution for mutations or when requested
    for (const cmd of commands) {
      const cmdStart = performance.now();
      const result = await this.execute(cmd.command, cmd.input);
      timings.push(performance.now() - cmdStart);
      results.push({ id: cmd.id, command: cmd.command, result });

      if (stopOnError && !result.success) break;
    }
  }

  return {
    success: results.every(r => r.result.success),
    results,
    timing: {
      totalMs: performance.now() - startTime,
      perCommandMs: timings
    }
  };
}

private hasMutations(commands: BatchCommand[]): boolean {
  return commands.some(cmd => {
    const def = this.commands.get(cmd.command);
    return def?.mutation === true;
  });
}
```

### Phase 3: Transport Support

Each transport needs to support batch requests:

| Transport  | Implementation                               |
| ---------- | -------------------------------------------- |
| In-process | Direct `registry.executeBatch()` call        |
| HTTP/REST  | `POST /batch` endpoint                       |
| MCP        | `tools/batch` tool                           |
| WebSocket  | `{ type: 'batch', commands: [...] }` message |

### Phase 4: Client SDK

```typescript
// packages/client/src/index.ts
class AFDClient {
  async batch(
    commands: BatchCommand[],
    options?: BatchOptions
  ): Promise<BatchResult>;
}

// Usage
const client = new AFDClient("http://localhost:3000");
const results = await client.batch([
  { command: "node.get", input: { id: "xbox" } },
  { command: "tokens.resolve", input: { node: "xbox" } },
]);
```

---

## Dependency Detection (Future Enhancement)

For advanced use cases, detect dependencies between commands:

```typescript
// Commands with dependencies - must be sequential
const results = await executeBatch([
  { id: "create", command: "node.create", input: { name: "test" } },
  {
    id: "add-token",
    command: "token.add",
    input: { node: "$create.data.id", token: "x" },
  },
]);
```

> **Note**: This is a future enhancement. Initial implementation assumes independent commands.

---

## Testing

```typescript
describe("executeBatch", () => {
  it("executes multiple commands in one call", async () => {
    const result = await registry.executeBatch({
      commands: [
        { command: "node.get", input: { id: "root" } },
        { command: "node.list", input: {} },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].result.success).toBe(true);
  });

  it("stops on error when stopOnError is true", async () => {
    const result = await registry.executeBatch({
      commands: [
        { command: "node.get", input: { id: "nonexistent" } },
        { command: "node.list", input: {} },
      ],
      options: { stopOnError: true },
    });

    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(1); // Stopped after first
  });

  it("executes read commands in parallel", async () => {
    const startTime = performance.now();

    await registry.executeBatch({
      commands: [
        { command: "slow.read", input: { delayMs: 100 } },
        { command: "slow.read", input: { delayMs: 100 } },
        { command: "slow.read", input: { delayMs: 100 } },
      ],
    });

    const elapsed = performance.now() - startTime;
    expect(elapsed).toBeLessThan(200); // Parallel, not 300ms
  });
});
```

---

## Success Criteria

| Metric         | Target                                     |
| -------------- | ------------------------------------------ |
| Batch 10 reads | < 2x single read latency                   |
| API surface    | Minimal, consistent with existing patterns |
| Test coverage  | 100% of batch logic                        |
| Documentation  | Usage examples in docs                     |

---

## Files to Create/Modify

| File                            | Action                       |
| ------------------------------- | ---------------------------- |
| `packages/core/src/batch.ts`    | Create - Types and utilities |
| `packages/core/src/registry.ts` | Modify - Add `executeBatch`  |
| `packages/core/src/index.ts`    | Modify - Export batch types  |
| `packages/server/src/server.ts` | Modify - Add batch tool      |
| `packages/client/src/index.ts`  | Modify - Add batch method    |
| `docs/command-schema-guide.md`  | Modify - Document batching   |

---

## Agent-Specific Guidance

### When Agents Should Use Batching

| Scenario | Recommendation |
| -------- | -------------- |
| Rendering a view (multiple queries) | ✅ Batch - reduces latency |
| Creating related items | ✅ Batch with `stopOnError: true` |
| Independent operations | ✅ Batch for efficiency |
| Sequential dependencies | ❌ Don't batch - use separate calls |
| Operations needing individual reasoning | ❌ Don't batch - lose per-command context |

### Aggregate Metadata Considerations

When batching, individual command metadata (confidence, reasoning) is preserved per-result:

```typescript
const result = await executeBatch({
  commands: [
    { command: 'content.analyze', input: { text: 'A' } },
    { command: 'content.analyze', input: { text: 'B' } },
  ]
});

// Each result maintains its own metadata
result.results[0].result.confidence; // 0.85
result.results[0].result.reasoning;  // "Based on..."
result.results[1].result.confidence; // 0.72
result.results[1].result.reasoning;  // "Based on..."
```

**Aggregate confidence** (optional enhancement): For batch operations on related items, consider computing aggregate confidence:

```typescript
interface BatchResult {
  // ... existing fields
  aggregateConfidence?: number; // Average or minimum of individual confidences
}
```

### CLI Testing for Agents

Agents should validate batch behavior via CLI before relying on it:

```bash
# Test batch execution
afd call batch '[
  {"command": "node.get", "input": {"id": "xbox"}},
  {"command": "tokens.resolve", "input": {"node": "xbox"}}
]'

# Test partial failure handling
afd call batch '[
  {"command": "node.get", "input": {"id": "valid"}},
  {"command": "node.get", "input": {"id": "invalid"}}
]' --stop-on-error

# Verify timing benefits
afd call batch '[...]' --format json | jq '.timing'
```

### Agent Workflow Patterns

**Pattern 1: View Hydration**
```typescript
// Agent fetching data for a UI view
const viewData = await client.batch([
  { command: 'user.get', input: { id: userId } },
  { command: 'preferences.get', input: { userId } },
  { command: 'notifications.list', input: { userId, limit: 5 } },
]);
```

**Pattern 2: Bulk Creation with Validation**
```typescript
// Agent creating multiple items, stopping on first error
const created = await client.batch({
  commands: items.map(item => ({ 
    command: 'item.create', 
    input: item 
  })),
  options: { stopOnError: true }
});

if (!created.success) {
  // Report which item failed and why
  const failed = created.results.find(r => !r.result.success);
  console.log(`Failed at item ${failed.id}: ${failed.result.error.message}`);
}
```

---

## Open Questions

1. **Max batch size?** - Should we limit commands per batch? (Proposal: 100)
2. **Timeout per command?** - Should batch have per-command timeouts?
3. **Partial results?** - If parallel execution, how to handle partial failures?
4. **Aggregate confidence?** - Should batch results include computed aggregate confidence?
