# Structured Concurrency

Patterns that ensure concurrent tasks have bounded lifetimes and automatic cleanup.

## Core Principle

Every concurrent task must have a parent scope that:
1. Waits for all child tasks to complete
2. Cancels remaining children if any child fails
3. Propagates errors to the parent
4. Never allows orphaned/dangling tasks

This mirrors how structured programming eliminated `goto` -- structured concurrency eliminates "fire-and-forget" async.

---

## Python: asyncio.TaskGroup (3.11+)

### Basic Pattern

```python
import asyncio

async def process_batch(items: list[str]) -> list[dict]:
    results: list[dict] = []

    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(process_one(item, results))

    # This line only executes if ALL tasks succeeded
    return results

async def process_one(item: str, results: list[dict]) -> None:
    data = await fetch_data(item)
    results.append(data)
```

### Error Handling with ExceptionGroup

```python
async def robust_batch(items: list[str]) -> tuple[list[dict], list[Exception]]:
    results: list[dict] = []
    errors: list[Exception] = []

    try:
        async with asyncio.TaskGroup() as tg:
            for item in items:
                tg.create_task(process_one(item, results))
    except* ValueError as eg:
        # Handle ValueError exceptions from the group
        errors.extend(eg.exceptions)
    except* ConnectionError as eg:
        # Handle connection errors separately
        errors.extend(eg.exceptions)

    return results, errors
```

### Nested TaskGroups

```python
async def pipeline(data: list[str]) -> list[dict]:
    """Two-phase pipeline: fetch then transform."""
    raw_results: list[bytes] = []
    final_results: list[dict] = []

    # Phase 1: Fetch all data concurrently
    async with asyncio.TaskGroup() as tg:
        for item in data:
            tg.create_task(fetch(item, raw_results))

    # Phase 2: Transform all results concurrently
    async with asyncio.TaskGroup() as tg:
        for raw in raw_results:
            tg.create_task(transform(raw, final_results))

    return final_results
```

### TaskGroup with Timeout

```python
async def fetch_with_timeout(urls: list[str], timeout: float = 30.0):
    results: list[bytes] = []

    async with asyncio.timeout(timeout):
        async with asyncio.TaskGroup() as tg:
            for url in urls:
                tg.create_task(fetch_url(url, results))

    return results
```

### TaskGroup vs asyncio.gather

| Feature | TaskGroup | asyncio.gather |
|---------|-----------|----------------|
| Auto-cancel on failure | Yes | No |
| Error aggregation | ExceptionGroup with `except*` | First exception or `return_exceptions=True` |
| Structured lifetime | Yes (context manager) | No (tasks may outlive caller) |
| Dynamic task creation | Yes (call `create_task` anytime in scope) | No (must know all tasks upfront) |
| Python version | 3.11+ | 3.4+ |
| Recommended for | New code | Legacy compatibility or partial-failure tolerance |

---

## TypeScript: AbortController Scoping

TypeScript/JavaScript does not have a built-in TaskGroup equivalent, but structured concurrency can be approximated using AbortController.

### Basic Structured Pattern

```typescript
async function withScope<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs) {
    timeoutId = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
  }

  try {
    return await fn(signal);
  } finally {
    controller.abort(); // Cancel any remaining work
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Usage
const results = await withScope(async (signal) => {
  return Promise.all([
    fetch('/api/users', { signal }),
    fetch('/api/orders', { signal }),
    fetch('/api/products', { signal }),
  ]);
}, 10_000);
```

### Fan-Out with Cancellation

```typescript
async function fanOut<T, R>(
  items: T[],
  fn: (item: T, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  const controller = new AbortController();

  try {
    return await Promise.all(
      items.map(item => fn(item, controller.signal))
    );
  } catch (error) {
    controller.abort();
    throw error;
  }
}

// Usage
const pages = await fanOut(urls, async (url, signal) => {
  const res = await fetch(url, { signal });
  return res.json();
});
```

### AbortSignal Composition (Node.js 20+)

```typescript
// Combine multiple abort signals
const userCancel = new AbortController();
const timeout = AbortSignal.timeout(5000);

const combined = AbortSignal.any([userCancel.signal, timeout]);

const response = await fetch(url, { signal: combined });
```

### Nested Scopes

```typescript
async function processWorkflow(signal: AbortSignal) {
  // Phase 1: Gather data (child scope)
  const data = await withScope(async (childSignal) => {
    // Abort if parent OR child signals
    const linked = AbortSignal.any([signal, childSignal]);
    return Promise.all([
      fetchUsers(linked),
      fetchOrders(linked),
    ]);
  }, 5000);

  signal.throwIfAborted(); // Check parent still active

  // Phase 2: Process data (child scope)
  return withScope(async (childSignal) => {
    const linked = AbortSignal.any([signal, childSignal]);
    return transformData(data, linked);
  }, 10_000);
}
```

---

## Python: Trio and AnyIO

### Trio Nursery Pattern

```python
import trio

async def fetch_all(urls: list[str]) -> list[bytes]:
    results: list[bytes] = []

    async with trio.open_nursery() as nursery:
        for url in urls:
            nursery.start_soon(fetch_one, url, results)

    return results  # All tasks guaranteed complete
```

### AnyIO (Portable Across asyncio and Trio)

```python
import anyio

async def portable_concurrency(items: list[str]) -> list[dict]:
    results: list[dict] = []

    async with anyio.create_task_group() as tg:
        for item in items:
            tg.start_soon(process_item, item, results)

    return results
```

AnyIO is recommended when writing libraries that should work on both asyncio and Trio backends.

---

## Cancellation Patterns

### Python: Graceful Cancellation

```python
async def cancellable_work(data: str) -> dict:
    try:
        result = await long_computation(data)
        return result
    except asyncio.CancelledError:
        # Cleanup resources before propagating
        await cleanup_temp_files()
        raise  # Always re-raise CancelledError
```

### TypeScript: AbortSignal-Aware Functions

```typescript
async function cancellableWork(
  data: string,
  signal: AbortSignal,
): Promise<Result> {
  for (const chunk of splitIntoChunks(data)) {
    signal.throwIfAborted(); // Check between chunks
    await processChunk(chunk);
  }
  return finalResult();
}

// Listen for abort in long-running operations
function longOperation(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', handler, { once: true });

    doWork().then(resolve).catch(reject);
  });
}
```

---

## Best Practices

1. **Always use structured concurrency for new code** -- TaskGroup in Python, AbortController scopes in TypeScript.
2. **Handle CancelledError / AbortError explicitly** -- Clean up resources, close connections, delete temp files.
3. **Set timeouts on every scope** -- `asyncio.timeout()` in Python, `AbortSignal.timeout()` in TypeScript.
4. **Never catch and swallow cancellation** -- Always re-raise `CancelledError` in Python; let `AbortError` propagate in TypeScript.
5. **Use ExceptionGroup / AggregateError** -- Multiple concurrent failures produce multiple errors; handle them all.
6. **Prefer TaskGroup over gather** -- For new Python 3.11+ code, TaskGroup provides stronger safety guarantees.
7. **Link child signals to parent signals** -- Use `AbortSignal.any()` to propagate cancellation through nested scopes.
