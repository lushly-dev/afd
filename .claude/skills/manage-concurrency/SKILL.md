---
name: manage-concurrency
source: botcore
description: >
  Provides guidance on concurrency and async patterns for TypeScript and Python applications. Covers structured concurrency, parallel execution, race condition prevention, backpressure, rate limiting, event loop internals, database locking strategies, and agent-safe concurrent operations. Use when implementing async workflows, parallelizing tasks, preventing race conditions, managing connection pools, rate-limiting API calls, or building concurrent agentic pipelines. Triggers: concurrency, async, parallel, race condition, deadlock, semaphore, mutex, backpressure, rate limit, event loop, worker threads, asyncio, TaskGroup, Promise.all, connection pool, optimistic locking.

version: 1.0.0
triggers:
  - concurrency
  - async
  - await
  - parallel
  - race condition
  - deadlock
  - semaphore
  - mutex
  - backpressure
  - rate limit
  - event loop
  - worker threads
  - asyncio
  - TaskGroup
  - Promise.all
  - Promise.allSettled
  - connection pool
  - optimistic locking
  - structured concurrency
  - fan-out fan-in
portable: true
---

# Managing Concurrency

Concurrency and async patterns for TypeScript and Python -- structured concurrency, parallel execution, race condition prevention, backpressure, rate limiting, and agent-safe concurrent operations.

## Capabilities

1. **Structured Concurrency** -- Implement TaskGroup (Python) and AbortController-scoped (TypeScript) patterns that guarantee child task cleanup
2. **Parallel Execution** -- Choose between Promise.all/allSettled/race (TS) and asyncio.gather/TaskGroup (Python) based on error semantics
3. **Synchronization Primitives** -- Apply mutexes, semaphores, and locks to prevent race conditions in both languages
4. **Backpressure and Flow Control** -- Implement queue-based processing with bounded concurrency and streaming backpressure
5. **Rate Limiting** -- Throttle API calls using semaphore-based limiters, token buckets, and sliding windows
6. **Event Loop Mastery** -- Understand microtask/macrotask ordering (JS) and asyncio scheduling (Python) to avoid subtle bugs
7. **Database Concurrency** -- Choose between optimistic and pessimistic locking, manage connection pools, resolve conflicts
8. **Worker-Based Parallelism** -- Offload CPU-bound work to worker threads (Node.js) or ProcessPoolExecutor (Python)
9. **Agentic Concurrency** -- Design fan-out/fan-in patterns, classify read-only vs stateful tool calls, and parallelize agent workflows safely

## Routing Logic

| Topic | Reference |
|-------|-----------|
| Structured concurrency, TaskGroup, AbortController scoping | `{baseDir}/references/structured-concurrency.md` |
| Mutexes, semaphores, locks, deadlock prevention | `{baseDir}/references/synchronization-primitives.md` |
| Backpressure, streaming, queue-based flow control | `{baseDir}/references/backpressure-and-flow-control.md` |
| Rate limiting, throttling, API call management | `{baseDir}/references/rate-limiting.md` |
| Database locking, connection pools, conflict resolution | `{baseDir}/references/database-concurrency.md` |
| Event loop internals, microtasks, macrotasks, asyncio scheduling | `{baseDir}/references/event-loop-internals.md` |
| Worker threads, ProcessPoolExecutor, CPU-bound parallelism | `{baseDir}/references/worker-parallelism.md` |
| Agentic concurrency, parallel tool execution, fan-out/fan-in | `{baseDir}/references/agentic-concurrency.md` |

## Core Principles

- **Structured over unstructured** -- Every concurrent task must have a clear owner and bounded lifetime. Prefer TaskGroup/AbortController scoping over fire-and-forget. Dangling tasks are bugs.
- **Fail fast, cancel siblings** -- When one task in a group fails, cancel the remaining siblings immediately. Use TaskGroup (Python) or Promise.all + AbortController (TS) to get this behavior.
- **Classify before parallelizing** -- Separate read-only operations (safe to parallelize) from stateful/write operations (serialize or coordinate). This applies equally to database queries and agent tool calls.
- **Bound everything** -- Every queue, pool, and concurrent operation needs an upper bound. Unbounded concurrency leads to resource exhaustion, OOM, and cascading failures.
- **Backpressure is mandatory** -- If a producer can outpace a consumer, implement backpressure. Never rely on unbounded in-memory queues.
- **Measure contention** -- Locks that are rarely contended are cheap. Locks that are always contended indicate a design problem. Profile before optimizing.

## Workflow

1. **Identify concurrency needs** -- Determine whether the task is I/O-bound (use async), CPU-bound (use workers/processes), or mixed.
2. **Choose the right primitive** -- Select from the decision table below based on error handling, cancellation, and ordering requirements.
3. **Set bounds** -- Define maximum concurrency, queue depth, timeout, and retry limits before writing code.
4. **Implement with structure** -- Use structured concurrency (TaskGroup, AbortController scope) so tasks cannot outlive their parent.
5. **Add synchronization** -- Apply mutexes/semaphores only where shared mutable state requires coordination.
6. **Test under load** -- Simulate concurrent access, slow consumers, network failures, and partial failures.
7. **Monitor in production** -- Track queue depth, wait times, lock contention, and task completion rates.

## Quick Reference

### Choosing a Parallel Execution Strategy

| Need | TypeScript | Python |
|------|-----------|--------|
| Run all, fail if any fails | `Promise.all(tasks)` | `async with TaskGroup() as tg:` |
| Run all, collect all results | `Promise.allSettled(tasks)` | `asyncio.gather(*tasks, return_exceptions=True)` |
| First to complete wins | `Promise.race(tasks)` | `asyncio.wait(tasks, return_when=FIRST_COMPLETED)` |
| Limited concurrency | `p-limit` or custom semaphore | `asyncio.Semaphore(n)` |
| CPU-bound parallelism | `worker_threads` + pool | `ProcessPoolExecutor` / `run_in_executor` |
| Cancellation | `AbortController` + `signal` | `task.cancel()` / `TaskGroup` auto-cancel |

### TypeScript: Structured Parallel Execution

```typescript
// Fan-out with fail-fast and cancellation
async function fetchAll(urls: string[]): Promise<Response[]> {
  const controller = new AbortController();
  try {
    return await Promise.all(
      urls.map(url => fetch(url, { signal: controller.signal }))
    );
  } catch (error) {
    controller.abort(); // Cancel remaining requests
    throw error;
  }
}

// Fan-out with partial failure tolerance
async function fetchAllSettled(urls: string[]) {
  const results = await Promise.allSettled(
    urls.map(url => fetch(url))
  );
  const successes = results.filter(r => r.status === 'fulfilled');
  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    console.warn(`${failures.length} requests failed`);
  }
  return successes.map(r => r.value);
}
```

### Python: Structured Concurrency with TaskGroup

```python
import asyncio

# Structured concurrency -- all tasks complete or all cancel
async def fetch_all(urls: list[str]) -> list[bytes]:
    results: list[bytes] = []

    async with asyncio.TaskGroup() as tg:
        async def fetch_one(url: str) -> None:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    results.append(await resp.read())

        for url in urls:
            tg.create_task(fetch_one(url))

    return results  # Only reached if ALL tasks succeed

# Handle partial failures with gather
async def fetch_tolerant(urls: list[str]):
    results = await asyncio.gather(
        *[fetch(url) for url in urls],
        return_exceptions=True
    )
    successes = [r for r in results if not isinstance(r, Exception)]
    failures = [r for r in results if isinstance(r, Exception)]
    return successes, failures
```

### Concurrency-Limiting Pattern (Both Languages)

```typescript
// TypeScript: Semaphore-based concurrency limiter
import { Semaphore } from 'async-mutex';

const semaphore = new Semaphore(5); // Max 5 concurrent

async function rateLimitedFetch(url: string): Promise<Response> {
  const [, release] = await semaphore.acquire();
  try {
    return await fetch(url);
  } finally {
    release();
  }
}
```

```python
# Python: Semaphore-based concurrency limiter
semaphore = asyncio.Semaphore(5)  # Max 5 concurrent

async def rate_limited_fetch(url: str) -> bytes:
    async with semaphore:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                return await resp.read()
```

### Common Anti-Patterns

| Avoid | Instead |
|-------|---------|
| Fire-and-forget promises/tasks | Use structured concurrency (TaskGroup, AbortController scope) |
| Unbounded `Promise.all` on large arrays | Limit concurrency with semaphore or `p-limit` |
| `asyncio.gather` without `return_exceptions` when partial failure is acceptable | Use `return_exceptions=True` or `TaskGroup` with `except*` |
| Shared mutable state without synchronization | Use mutex/lock or message passing |
| Polling loops with `sleep(0.1)` | Use proper awaitable signals (Event, Condition) |
| Catching errors silently in concurrent tasks | Log, propagate, or aggregate errors explicitly |
| Global semaphore for unrelated resources | Scope semaphores to specific resource types |

## Checklist

- [ ] Concurrency type identified (I/O-bound -> async, CPU-bound -> workers/processes, mixed -> both)
- [ ] Maximum concurrency limits defined and enforced via semaphore or pool size
- [ ] Structured concurrency used -- no orphaned tasks or dangling promises
- [ ] Error handling strategy chosen (fail-fast vs partial-failure-tolerant)
- [ ] Cancellation propagated -- AbortController (TS) or TaskGroup auto-cancel (Python)
- [ ] Shared mutable state protected by mutex/lock or eliminated via message passing
- [ ] Backpressure implemented for producer-consumer flows (bounded queues, stream highWaterMark)
- [ ] Timeouts set on all async operations (network, locks, database queries)
- [ ] Rate limits respected for external API calls (semaphore + delay)
- [ ] Database access uses appropriate locking strategy (optimistic for reads-heavy, pessimistic for writes-heavy)
- [ ] Connection pools sized appropriately (not too small to starve, not too large to exhaust)
- [ ] Deadlock prevention verified -- consistent lock ordering, no nested locks where avoidable
- [ ] Agentic tool calls classified as read-only (parallelize) or stateful (serialize)
- [ ] Load tested under realistic concurrency levels with failure injection
- [ ] Monitoring in place for queue depth, lock contention, task latency, and error rates

## When to Escalate

- **Distributed concurrency** -- When coordination spans multiple services or machines (distributed locks, consensus), escalate to infrastructure/platform team. Single-node primitives do not work across network boundaries.
- **Persistent deadlocks** -- If deadlocks recur despite lock ordering, the resource dependency graph may need architectural redesign. Consult senior engineering.
- **GIL-bound Python performance** -- If Python asyncio throughput is bottlenecked by the GIL for CPU work and `ProcessPoolExecutor` is insufficient, consider rewriting hot paths in Rust/C extensions or switching to a multi-process architecture.
- **Database contention at scale** -- When optimistic locking retry rates exceed 5-10%, or pessimistic locks cause widespread blocking, the data model or access pattern needs rethinking with a database specialist.
- **Backpressure cascading failures** -- If bounded queues cause upstream failures that propagate through the system, circuit breaker and load shedding patterns are needed at the architecture level.
- **Real-time ordering guarantees** -- When strict global ordering of concurrent events is required (e.g., financial transactions), this requires distributed consensus (Raft, Paxos) or serializable isolation -- consult with the data team.
