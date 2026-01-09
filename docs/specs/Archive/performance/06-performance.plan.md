# AFD Performance Plan

> **Goal**: Define performance characteristics, tradeoffs, and optimization patterns for AFD applications.

---

## Overview

AFD introduces architectural constraints that affect performance differently than traditional UI-first development. This plan documents:

1. **Honest tradeoffs** - What AFD costs vs. what it provides
2. **In-scope optimizations** - Code/infrastructure we'll add to AFD
3. **Guidance patterns** - Documentation for application developers (no AFD code changes)

---

## The Performance Reality

### What AFD Costs

| Factor               | Traditional | AFD (same-process)         | AFD (network) |
| -------------------- | ----------- | -------------------------- | ------------- |
| Button click latency | ~1-5ms      | ~5-10ms                    | ~50-100ms     |
| Memory overhead      | Lower       | Higher (registry, schemas) | Similar       |
| Bundle size          | Varies      | +Zod/validation libs       | Similar       |

### What AFD Provides

| Factor                | Traditional         | AFD                          |
| --------------------- | ------------------- | ---------------------------- |
| Horizontal scaling    | Complex             | Trivial (stateless commands) |
| Multi-surface support | Rewrite per surface | Zero backend changes         |
| Testing               | Mount components    | Direct command calls         |
| Agent integration     | Afterthought        | First-class                  |

**The tradeoff**: AFD trades micro-level interaction latency for macro-level architectural benefits.

---

## Scope Decision Matrix

| Optimization           | Code Change?            | Rationale                                                |
| ---------------------- | ----------------------- | -------------------------------------------------------- |
| Command batching       | ✅ Yes                  | Core AFD capability, enables efficient multi-command UIs |
| Streaming results      | ✅ Yes                  | Core AFD capability, enables large payload handling      |
| Horizontal scaling     | ❌ Docs only            | Infrastructure concern, not AFD code                     |
| Optimistic UI          | ❌ Docs only            | Frontend pattern, works with any command layer           |
| Local vs command state | ❌ Docs only            | Frontend architecture guidance                           |
| Caching strategies     | ⚠️ Guidance + utilities | Document patterns, maybe add helper types                |
| Debouncing             | ❌ Docs only            | Frontend concern, standard JS pattern                    |

---

## Implementation Sub-Plans

### In-Scope (Code Changes)

| Plan                                                       | Description                              | Priority | Status |
| ---------------------------------------------------------- | ---------------------------------------- | -------- | ------ |
| [06a - Command Batching](./06a-command-batching.plan.md)   | Execute multiple commands in single call | P1       | ✅ Implemented |
| [06b - Streaming Results](./06b-streaming-results.plan.md) | Handle large payloads incrementally      | P2       | ✅ Implemented |

### Documentation Only

| Plan                                                         | Description                                 | Priority |
| ------------------------------------------------------------ | ------------------------------------------- | -------- |
| [06c - Horizontal Scaling](./06c-horizontal-scaling.plan.md) | Infrastructure scaling patterns             | P1       |
| [06d - Optimistic UI](./06d-optimistic-ui.plan.md)           | Frontend patterns for perceived performance | P1       |
| [06e - State Layering](./06e-state-layering.plan.md)         | Local vs command state separation           | P2       |

---

## Success Criteria

| Metric                  | Target              | Measurement                                 |
| ----------------------- | ------------------- | ------------------------------------------- |
| Batch command overhead  | < 2x single command | Benchmark 10 commands batched vs sequential |
| Streaming first-byte    | < 100ms             | Time to first chunk for large exports       |
| Documentation coverage  | 100%                | All patterns documented with examples       |
| Developer understanding | Clear               | Devs know when to use each pattern          |

---

## Non-Goals

These are explicitly **not** goals for AFD core:

1. **Sub-millisecond latency** - AFD accepts ~3-8ms overhead for its benefits
2. **Real-time collaboration** - Use specialized tools (CRDTs, OT) alongside AFD
3. **Game-loop performance** - AFD is for business applications, not 60fps games
4. **Eliminating network latency** - Physics; use optimistic UI instead

---

## Timeline

| Phase   | Deliverable                   | Estimate |
| ------- | ----------------------------- | -------- |
| Phase 1 | Documentation (06c, 06d, 06e) | 1 day    |
| Phase 2 | Command batching (06a)        | 2-3 days |
| Phase 3 | Streaming results (06b)       | 2-3 days |

---

## Related Documents

- [Command Schema Guide](../command-schema-guide.md) - How to design commands
- [Production Considerations](../production-considerations.md) - Security, observability
- [Philosophy](../philosophy.md) - Why these tradeoffs make sense
