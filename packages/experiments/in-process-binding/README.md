# In-Process Binding Experiment

> **Status**: 🧪 Experimental  
> **Goal**: Validate zero-transport-overhead command execution for co-located agents

## What We're Testing

Can we achieve **10-100x performance improvement** by allowing agents to call commands directly (in-process) instead of through MCP transport?

| Transport | Expected Latency |
|-----------|------------------|
| MCP (HTTP/SSE) | ~20-100ms |
| MCP (stdio) | ~10-50ms |
| **Direct (target)** | **~0.1-1ms** |

## Structure

```
in-process-binding/
├── backend/            # Todo backend (copied from examples)
│   ├── src/
│   │   ├── commands/   # Same commands as todo example
│   │   ├── store/      # Memory store (no file I/O for benchmarks)
│   │   ├── registry.ts # NEW: Exportable registry
│   │   ├── server.ts   # MCP server entry point
│   │   ├── index.ts    # Library entry point
│   │   └── types.ts
│   └── package.json
├── frontend/           # Vanilla UI (for manual testing)
├── benchmark/          # Transport comparison scripts
│   └── compare.ts
└── README.md           # This file
```

## Key Changes from Todo Example

1. **`registry.ts`** - Exports command registry as a library (can import without starting server)
2. **`index.ts`** - Library entry point for direct imports
3. **Memory-only store** - No file I/O to isolate transport performance
4. **Benchmark harness** - Measures direct vs. MCP latency

## Quick Start

```bash
# Build the backend
cd packages/experiments/in-process-binding/backend
pnpm build

# Run benchmarks
pnpm benchmark

# Start server for MCP comparison
pnpm start
```

## Success Criteria

1. ✅ Direct transport is 10-100x faster than MCP
2. ✅ Same `client.call()` API works for both transports
3. ✅ Registry can be imported without starting server
4. ✅ Existing MCP usage unchanged

## What Happens After Validation

If benchmarks confirm the performance gains:

1. **Phase 2**: Add `DirectTransport` to `@afd/client`
2. **Phase 3**: Port pattern back to main todo example
3. **Phase 4**: Document transport selection guidance

## Related

- [Implementation Plan](../../../PLAN/in-process-binding/00-overview.plan.md)
- [Todo Example](../../examples/todo/)
- [AFD Client](../../client/)
