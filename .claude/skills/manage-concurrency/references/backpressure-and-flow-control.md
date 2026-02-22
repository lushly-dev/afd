# Backpressure and Flow Control

Patterns for managing data flow when producers outpace consumers.

---

## What Is Backpressure?

Backpressure is the mechanism by which a consumer signals a producer to slow down. Without it, fast producers create unbounded in-memory queues that eventually cause OOM crashes, increased latency, and cascading failures.

**Rule: If a producer can ever be faster than its consumer, you need backpressure.**

---

## TypeScript / Node.js Patterns

### Stream Backpressure (Node.js)

Node.js streams have built-in backpressure via the `highWaterMark` and `drain` event.

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

// GOOD: pipeline handles backpressure automatically
await pipeline(
  createReadStream('input.csv'),
  transformStream,
  createWriteStream('output.csv'),
);

// BAD: Manual piping without backpressure handling
readStream.on('data', (chunk) => {
  writeStream.write(chunk); // Ignores return value!
});
```

### Manual Drain Handling

```typescript
import { Writable } from 'stream';

async function writeWithBackpressure(
  writable: Writable,
  items: AsyncIterable<Buffer>,
): Promise<void> {
  for await (const chunk of items) {
    const canContinue = writable.write(chunk);
    if (!canContinue) {
      // Buffer full -- wait for drain before continuing
      await new Promise<void>(resolve => writable.once('drain', resolve));
    }
  }
  writable.end();
}
```

### Async Iterator Backpressure

```typescript
// Modern approach: async iterators with for-await-of
// Backpressure is implicit -- the loop awaits each iteration
async function processStream(readable: ReadableStream<Uint8Array>) {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await processChunk(value); // Slow consumer naturally applies backpressure
    }
  } finally {
    reader.releaseLock();
  }
}
```

### Web Streams API (Browser + Node.js 18+)

```typescript
// TransformStream with backpressure
const transform = new TransformStream<string, string>(
  {
    async transform(chunk, controller) {
      const result = await expensiveOperation(chunk);
      controller.enqueue(result);
    },
  },
  // Writable side strategy (incoming buffer)
  new CountQueuingStrategy({ highWaterMark: 10 }),
  // Readable side strategy (outgoing buffer)
  new CountQueuingStrategy({ highWaterMark: 5 }),
);

await source.pipeThrough(transform).pipeTo(destination);
```

---

## Python Patterns

### asyncio.Queue (Bounded)

```python
import asyncio

async def producer(queue: asyncio.Queue[str], items: list[str]) -> None:
    for item in items:
        await queue.put(item)  # Blocks when queue is full
    await queue.put(None)  # Sentinel to signal completion

async def consumer(queue: asyncio.Queue[str]) -> list[str]:
    results: list[str] = []
    while True:
        item = await queue.get()
        if item is None:
            break
        result = await process(item)
        results.append(result)
        queue.task_done()
    return results

async def main():
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=10)  # Bounded!

    async with asyncio.TaskGroup() as tg:
        tg.create_task(producer(queue, items))
        tg.create_task(consumer(queue))
```

### Multiple Consumers (Worker Pool)

```python
async def worker_pool(
    items: list[str],
    num_workers: int = 5,
    queue_size: int = 20,
) -> list[dict]:
    queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=queue_size)
    results: list[dict] = []
    lock = asyncio.Lock()

    async def worker() -> None:
        while True:
            item = await queue.get()
            if item is None:
                queue.task_done()
                break
            result = await process(item)
            async with lock:
                results.append(result)
            queue.task_done()

    async def feeder() -> None:
        for item in items:
            await queue.put(item)  # Backpressure when queue is full
        # Send poison pills for each worker
        for _ in range(num_workers):
            await queue.put(None)

    async with asyncio.TaskGroup() as tg:
        tg.create_task(feeder())
        for _ in range(num_workers):
            tg.create_task(worker())

    return results
```

### Async Generator with Backpressure

```python
async def paginated_fetch(base_url: str, page_size: int = 100):
    """Async generator -- consumer controls the pace."""
    page = 0
    while True:
        url = f"{base_url}?page={page}&size={page_size}"
        data = await fetch_json(url)
        if not data["items"]:
            break
        for item in data["items"]:
            yield item  # Consumer pulls one at a time
        page += 1

# Usage -- consumer applies natural backpressure
async def slow_consumer():
    async for item in paginated_fetch("/api/records"):
        await expensive_transform(item)  # Controls fetch rate
```

---

## Queue-Based Processing Patterns

### Bounded Work Queue (TypeScript)

```typescript
class BoundedWorkQueue<T, R> {
  private queue: T[] = [];
  private processing = 0;
  private results: R[] = [];
  private resolveAll?: (results: R[]) => void;

  constructor(
    private worker: (item: T) => Promise<R>,
    private maxConcurrency: number,
    private maxQueueSize: number,
  ) {}

  async add(item: T): Promise<void> {
    while (this.queue.length >= this.maxQueueSize) {
      // Backpressure: wait until queue has space
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          if (this.queue.length < this.maxQueueSize) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });
    }
    this.queue.push(item);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing >= this.maxConcurrency || this.queue.length === 0) return;

    this.processing++;
    const item = this.queue.shift()!;

    try {
      const result = await this.worker(item);
      this.results.push(result);
    } finally {
      this.processing--;
      this.processNext();
    }
  }
}
```

### Priority Queue (Python)

```python
import asyncio
from dataclasses import dataclass, field

@dataclass(order=True)
class PrioritizedItem:
    priority: int
    item: str = field(compare=False)

async def priority_processor(max_concurrent: int = 3):
    queue: asyncio.PriorityQueue[PrioritizedItem] = asyncio.PriorityQueue(
        maxsize=50
    )
    semaphore = asyncio.Semaphore(max_concurrent)

    async def worker():
        while True:
            pitem = await queue.get()
            async with semaphore:
                await process(pitem.item)
            queue.task_done()

    # Higher priority (lower number) items are processed first
    await queue.put(PrioritizedItem(priority=1, item="urgent"))
    await queue.put(PrioritizedItem(priority=10, item="low"))
```

---

## Batching for Efficiency

### TypeScript: Micro-Batch Processor

```typescript
class MicroBatcher<T, R> {
  private batch: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Array<{
    resolve: (r: R) => void;
    reject: (e: Error) => void;
  }> = [];

  constructor(
    private processBatch: (items: T[]) => Promise<R[]>,
    private maxBatchSize: number = 50,
    private maxWaitMs: number = 100,
  ) {}

  async add(item: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.batch.push(item);
      this.pending.push({ resolve, reject });

      if (this.batch.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    const items = this.batch.splice(0);
    const callbacks = this.pending.splice(0);

    try {
      const results = await this.processBatch(items);
      results.forEach((r, i) => callbacks[i].resolve(r));
    } catch (error) {
      callbacks.forEach(cb => cb.reject(error as Error));
    }
  }
}
```

---

## Monitoring Backpressure

Track these metrics to detect backpressure issues:

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Queue depth | < 50% of max | 50-80% | > 80% or growing |
| Consumer latency (p99) | Stable | Increasing | Spiking |
| Producer wait time | < 10ms | 10-100ms | > 100ms |
| Dropped items | 0 | Low rate | Any (if no drop policy) |
| Memory usage | Stable | Growing | Unbounded growth |

---

## Best Practices

1. **Always set `maxsize` on queues** -- `asyncio.Queue()` without maxsize is unbounded and dangerous.
2. **Use `pipeline()` for Node.js streams** -- It handles backpressure, errors, and cleanup automatically.
3. **Prefer async iterators** -- `for await...of` and async generators provide natural backpressure.
4. **Batch for throughput** -- Micro-batching amortizes per-item overhead while keeping latency bounded.
5. **Monitor queue depth** -- Rising queue depth means the consumer cannot keep up; scale consumers or throttle producers.
6. **Define a drop policy** -- When queues are full, decide: block producer (backpressure), drop oldest, drop newest, or error.
7. **Test with slow consumers** -- Simulate slow processing to verify backpressure kicks in correctly.
