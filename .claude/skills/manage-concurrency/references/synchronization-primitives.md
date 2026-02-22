# Synchronization Primitives

Mutexes, semaphores, locks, and deadlock prevention for TypeScript and Python.

---

## When You Need Synchronization

Single-threaded async runtimes (Node.js event loop, Python asyncio) do NOT have data races from true parallelism. However, you still need synchronization when:

1. **Interleaved async operations** -- Two coroutines read-modify-write shared state with `await` between read and write.
2. **Resource limiting** -- Only N concurrent operations should access a resource (API endpoint, database pool, file handle).
3. **Ordering guarantees** -- Operations must execute in a specific sequence despite concurrent scheduling.
4. **Worker threads / multiprocessing** -- True parallelism introduces real data races requiring locks or atomics.

---

## Mutex (Mutual Exclusion)

A mutex allows only one holder at a time. All other acquirers wait.

### TypeScript: async-mutex

```typescript
import { Mutex } from 'async-mutex';

class AccountService {
  private balanceMutex = new Mutex();
  private balance = 100;

  async transfer(amount: number): Promise<void> {
    // Without mutex: two concurrent transfers could both read 100,
    // then both write 100 - amount, losing one transfer.
    const release = await this.balanceMutex.acquire();
    try {
      const current = this.balance; // Read
      await someAsyncValidation(amount);  // Yield point!
      this.balance = current - amount; // Write
    } finally {
      release();
    }
  }
}
```

#### Using runExclusive (preferred shorthand)

```typescript
import { Mutex } from 'async-mutex';

const mutex = new Mutex();

const result = await mutex.runExclusive(async () => {
  const data = await readSharedResource();
  await writeSharedResource(data + 1);
  return data + 1;
});
```

### Python: asyncio.Lock

```python
import asyncio

class AccountService:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._balance = 100

    async def transfer(self, amount: float) -> None:
        async with self._lock:
            current = self._balance
            await self._validate(amount)  # Yield point
            self._balance = current - amount
```

---

## Semaphore (Counting Lock)

A semaphore allows up to N concurrent holders. Used for resource pooling and concurrency limiting.

### TypeScript: async-mutex Semaphore

```typescript
import { Semaphore } from 'async-mutex';

// Allow max 3 concurrent database connections
const dbSemaphore = new Semaphore(3);

async function queryDatabase(sql: string): Promise<Row[]> {
  const [value, release] = await dbSemaphore.acquire();
  try {
    const conn = await pool.getConnection();
    try {
      return await conn.query(sql);
    } finally {
      conn.release();
    }
  } finally {
    release();
  }
}
```

#### Batch Processing with Bounded Concurrency

```typescript
import { Semaphore } from 'async-mutex';

async function processBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = 5,
): Promise<R[]> {
  const semaphore = new Semaphore(concurrency);

  return Promise.all(
    items.map(async (item) => {
      const [, release] = await semaphore.acquire();
      try {
        return await fn(item);
      } finally {
        release();
      }
    })
  );
}
```

### Python: asyncio.Semaphore

```python
import asyncio

# Allow max 5 concurrent HTTP requests
http_semaphore = asyncio.Semaphore(5)

async def fetch_url(url: str) -> bytes:
    async with http_semaphore:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                return await resp.read()

# Process many URLs with bounded concurrency
async def fetch_all(urls: list[str]) -> list[bytes]:
    return await asyncio.gather(*[fetch_url(url) for url in urls])
```

#### BoundedSemaphore (Safety Variant)

```python
# BoundedSemaphore raises ValueError if released more times than acquired
sem = asyncio.BoundedSemaphore(5)
# Prevents bugs where release() is called without matching acquire()
```

---

## Read-Write Lock

Allows multiple concurrent readers OR one exclusive writer. Useful when reads vastly outnumber writes.

### TypeScript Implementation

```typescript
class ReadWriteLock {
  private readers = 0;
  private writer = false;
  private waitQueue: Array<{ resolve: () => void; type: 'read' | 'write' }> = [];

  async acquireRead(): Promise<() => void> {
    while (this.writer) {
      await new Promise<void>(resolve =>
        this.waitQueue.push({ resolve, type: 'read' })
      );
    }
    this.readers++;
    return () => this.releaseRead();
  }

  private releaseRead(): void {
    this.readers--;
    if (this.readers === 0) this.notifyNext();
  }

  async acquireWrite(): Promise<() => void> {
    while (this.writer || this.readers > 0) {
      await new Promise<void>(resolve =>
        this.waitQueue.push({ resolve, type: 'write' })
      );
    }
    this.writer = true;
    return () => this.releaseWrite();
  }

  private releaseWrite(): void {
    this.writer = false;
    this.notifyNext();
  }

  private notifyNext(): void {
    // Wake all waiting readers, or one writer
    const nextWriter = this.waitQueue.findIndex(w => w.type === 'write');
    if (this.waitQueue.length > 0 && this.waitQueue[0].type === 'read') {
      // Wake all consecutive readers
      while (this.waitQueue.length > 0 && this.waitQueue[0].type === 'read') {
        this.waitQueue.shift()!.resolve();
      }
    } else if (nextWriter >= 0) {
      this.waitQueue.splice(nextWriter, 1)[0].resolve();
    }
  }
}
```

### Python Implementation

```python
import asyncio

class ReadWriteLock:
    def __init__(self):
        self._readers = 0
        self._writer = False
        self._lock = asyncio.Lock()
        self._readers_ok = asyncio.Condition(self._lock)
        self._writer_ok = asyncio.Condition(self._lock)

    async def acquire_read(self):
        async with self._lock:
            while self._writer:
                await self._readers_ok.wait()
            self._readers += 1

    async def release_read(self):
        async with self._lock:
            self._readers -= 1
            if self._readers == 0:
                self._writer_ok.notify()

    async def acquire_write(self):
        async with self._lock:
            while self._writer or self._readers > 0:
                await self._writer_ok.wait()
            self._writer = True

    async def release_write(self):
        async with self._lock:
            self._writer = False
            self._readers_ok.notify_all()
            self._writer_ok.notify()
```

---

## Event and Condition Variables

### Event (One-Time or Resettable Signal)

```python
# Python
event = asyncio.Event()

async def waiter():
    await event.wait()  # Blocks until set
    print("Event fired!")

async def setter():
    await asyncio.sleep(1)
    event.set()  # All waiters wake up
```

```typescript
// TypeScript: Simple event using promise
class AsyncEvent {
  private resolve!: () => void;
  private promise: Promise<void>;

  constructor() {
    this.promise = new Promise(r => { this.resolve = r; });
  }

  wait(): Promise<void> { return this.promise; }
  set(): void { this.resolve(); }
}
```

### Condition Variable (Wait for a Predicate)

```python
# Python: Wait until queue is non-empty
cond = asyncio.Condition()

async def consumer():
    async with cond:
        await cond.wait_for(lambda: len(queue) > 0)
        item = queue.pop(0)

async def producer(item):
    async with cond:
        queue.append(item)
        cond.notify()  # Wake one waiter
```

---

## Deadlock Prevention

### The Four Conditions for Deadlock

All four must hold simultaneously:
1. **Mutual exclusion** -- Resource held exclusively
2. **Hold and wait** -- Holding one resource while waiting for another
3. **No preemption** -- Resources cannot be forcibly taken
4. **Circular wait** -- A cycle in the wait-for graph

### Prevention Strategies

**1. Consistent Lock Ordering**

```python
# BAD: Inconsistent ordering causes deadlock
# Task A: acquire(lock_a) -> acquire(lock_b)
# Task B: acquire(lock_b) -> acquire(lock_a)

# GOOD: Always acquire in the same order
async def transfer(from_acct: Account, to_acct: Account, amount: float):
    # Order by account ID to prevent deadlock
    first, second = sorted([from_acct, to_acct], key=lambda a: a.id)
    async with first.lock:
        async with second.lock:
            from_acct.balance -= amount
            to_acct.balance += amount
```

**2. Timeout on Lock Acquisition**

```typescript
import { Mutex, withTimeout } from 'async-mutex';

const mutex = withTimeout(new Mutex(), 5000); // 5 second timeout

try {
  const release = await mutex.acquire();
  // ... critical section ...
  release();
} catch (error) {
  // Lock acquisition timed out -- handle gracefully
  console.error('Could not acquire lock within timeout');
}
```

```python
# Python: Lock with timeout
try:
    await asyncio.wait_for(lock.acquire(), timeout=5.0)
    try:
        # critical section
        pass
    finally:
        lock.release()
except asyncio.TimeoutError:
    print("Could not acquire lock within timeout")
```

**3. Try-Lock (Non-Blocking)**

```python
# Python: Non-blocking lock attempt
if lock.locked():
    # Skip or use alternative path
    return fallback_result()

async with lock:
    return await compute_result()
```

**4. Avoid Nested Locks**

```typescript
// BAD: Nested locks
async function bad() {
  await lockA.runExclusive(async () => {
    await lockB.runExclusive(async () => { // Deadlock risk!
      // ...
    });
  });
}

// GOOD: Acquire all locks at once or restructure
async function good() {
  const dataA = await lockA.runExclusive(() => readA());
  const dataB = await lockB.runExclusive(() => readB());
  // Process without holding locks
  const result = process(dataA, dataB);
  await lockA.runExclusive(() => writeA(result));
}
```

---

## When to Use What

| Primitive | Use Case |
|-----------|----------|
| Mutex | Protecting shared mutable state from interleaved async modifications |
| Semaphore | Limiting concurrent access to a pool of N resources |
| Read-Write Lock | Many concurrent readers, infrequent writers |
| Event | Signaling that something happened (one-shot or resettable) |
| Condition | Waiting until a complex predicate becomes true |
| No lock needed | Immutable data, message passing, single synchronous operation (no await between read and write) |
