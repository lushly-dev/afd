# Worker-Based Parallelism

Offloading CPU-bound work to worker threads (Node.js) and ProcessPoolExecutor (Python).

---

## When to Use Workers

The async event loop is designed for I/O-bound work. CPU-bound work blocks the event loop. Use workers when:

- **Hashing / encryption** -- bcrypt, password hashing, encryption operations
- **Image / video processing** -- Resizing, format conversion, thumbnail generation
- **Data parsing** -- Large JSON/CSV parsing, XML processing
- **Mathematical computation** -- Machine learning inference, statistical analysis
- **Compression** -- gzip, brotli, zstd compression of large payloads

**Rule of thumb:** If a synchronous operation takes > 50ms, move it to a worker.

---

## TypeScript / Node.js: Worker Threads

### Basic Worker

```typescript
// worker.ts
import { parentPort, workerData } from 'worker_threads';

function heavyComputation(data: number[]): number {
  return data.reduce((sum, val) => sum + Math.sqrt(val * val + 1), 0);
}

const result = heavyComputation(workerData);
parentPort?.postMessage(result);
```

```typescript
// main.ts
import { Worker } from 'worker_threads';

function runWorker(data: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./worker.ts', {
      workerData: data,
    });

    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

const result = await runWorker([1, 2, 3, 4, 5]);
```

### Worker Pool

```typescript
import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';

interface WorkerPoolTask<T> {
  data: T;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

class WorkerPool<T = unknown> {
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private queue: WorkerPoolTask<T>[] = [];

  constructor(
    private workerScript: string,
    private poolSize: number,
  ) {
    for (let i = 0; i < poolSize; i++) {
      this.addWorker();
    }
  }

  private addWorker(): void {
    const worker = new Worker(this.workerScript);

    worker.on('message', (result) => {
      const task = (worker as any).__task as WorkerPoolTask<T>;
      task.resolve(result);
      this.freeWorkers.push(worker);
      this.processQueue();
    });

    worker.on('error', (error) => {
      const task = (worker as any).__task as WorkerPoolTask<T>;
      task?.reject(error);
      // Replace dead worker
      const index = this.workers.indexOf(worker);
      if (index >= 0) this.workers.splice(index, 1);
      this.addWorker();
    });

    this.workers.push(worker);
    this.freeWorkers.push(worker);
  }

  async execute(data: T): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue(): void {
    while (this.queue.length > 0 && this.freeWorkers.length > 0) {
      const worker = this.freeWorkers.pop()!;
      const task = this.queue.shift()!;
      (worker as any).__task = task;
      worker.postMessage(task.data);
    }
  }

  async destroy(): Promise<void> {
    await Promise.all(this.workers.map(w => w.terminate()));
  }
}

// Usage
const pool = new WorkerPool('./hash-worker.js', 4);

const results = await Promise.all(
  passwords.map(pw => pool.execute(pw))
);

await pool.destroy();
```

### SharedArrayBuffer for Zero-Copy Communication

```typescript
// main.ts
import { Worker } from 'worker_threads';

// Shared memory accessible by both main thread and worker
const sharedBuffer = new SharedArrayBuffer(1024 * Int32Array.BYTES_PER_ELEMENT);
const sharedArray = new Int32Array(sharedBuffer);

// Fill with data
for (let i = 0; i < 1024; i++) {
  sharedArray[i] = i;
}

const worker = new Worker('./compute-worker.ts', {
  workerData: { buffer: sharedBuffer },
});

worker.on('message', () => {
  // Worker modified sharedArray in place -- no copy needed
  console.log('Sum:', sharedArray[0]); // Result stored at index 0
});
```

```typescript
// compute-worker.ts
import { parentPort, workerData } from 'worker_threads';

const array = new Int32Array(workerData.buffer);

// Compute sum and store at index 0
let sum = 0;
for (let i = 1; i < array.length; i++) {
  sum += array[i];
}

// Use Atomics for thread-safe writes
Atomics.store(array, 0, sum);

parentPort?.postMessage('done');
```

### Atomics for Thread Coordination

```typescript
// Shared lock using Atomics
const lockBuffer = new SharedArrayBuffer(4);
const lock = new Int32Array(lockBuffer);

function acquireLock(lockArray: Int32Array, index: number): void {
  while (Atomics.compareExchange(lockArray, index, 0, 1) !== 0) {
    // Spin or wait
    Atomics.wait(lockArray, index, 1); // Block until notified
  }
}

function releaseLock(lockArray: Int32Array, index: number): void {
  Atomics.store(lockArray, index, 0);
  Atomics.notify(lockArray, index, 1); // Wake one waiting thread
}
```

---

## Python: ProcessPoolExecutor

### Basic Usage

```python
from concurrent.futures import ProcessPoolExecutor
import multiprocessing

def cpu_heavy(data: list[int]) -> int:
    """Must be a top-level function (picklable)."""
    return sum(x * x for x in data)

# Synchronous usage
with ProcessPoolExecutor(max_workers=4) as executor:
    futures = [executor.submit(cpu_heavy, chunk) for chunk in data_chunks]
    results = [f.result() for f in futures]

# With map (preserves order)
with ProcessPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(cpu_heavy, data_chunks))
```

### Integration with asyncio

```python
import asyncio
from concurrent.futures import ProcessPoolExecutor

# Create executor once, reuse across requests
executor = ProcessPoolExecutor(max_workers=multiprocessing.cpu_count())

async def handle_request(data: bytes) -> dict:
    loop = asyncio.get_event_loop()

    # Run CPU-bound work in process pool without blocking event loop
    result = await loop.run_in_executor(executor, cpu_heavy_parse, data)

    # Back on the event loop for async I/O
    await save_to_database(result)
    return result

# Alternative: asyncio.to_thread for I/O-bound blocking code
async def read_large_file(path: str) -> bytes:
    return await asyncio.to_thread(Path(path).read_bytes)
```

### ProcessPoolExecutor with as_completed

```python
from concurrent.futures import ProcessPoolExecutor, as_completed

def process_file(filepath: str) -> dict:
    # CPU-intensive processing
    data = parse_large_file(filepath)
    return {"file": filepath, "result": analyze(data)}

with ProcessPoolExecutor(max_workers=4) as executor:
    future_to_file = {
        executor.submit(process_file, fp): fp
        for fp in file_paths
    }

    for future in as_completed(future_to_file):
        filepath = future_to_file[future]
        try:
            result = future.result(timeout=60)
            print(f"Completed: {filepath}")
        except TimeoutError:
            print(f"Timed out: {filepath}")
        except Exception as e:
            print(f"Failed: {filepath}: {e}")
```

### asyncio.to_thread (Python 3.9+)

```python
import asyncio

def blocking_io() -> bytes:
    """Synchronous I/O that would block the event loop."""
    with open("large_file.bin", "rb") as f:
        return f.read()

def cpu_bound_sync(data: bytes) -> dict:
    """Synchronous CPU-bound work."""
    return heavy_parse(data)

async def main():
    # Run blocking I/O in a thread (uses default ThreadPoolExecutor)
    data = await asyncio.to_thread(blocking_io)

    # For CPU-bound, use ProcessPoolExecutor explicitly
    loop = asyncio.get_event_loop()
    with ProcessPoolExecutor() as pool:
        result = await loop.run_in_executor(pool, cpu_bound_sync, data)
```

---

## Choosing the Right Approach

| Scenario | TypeScript | Python |
|----------|-----------|--------|
| CPU-heavy computation | `worker_threads` | `ProcessPoolExecutor` |
| Blocking I/O in async context | `worker_threads` | `asyncio.to_thread` |
| Shared memory between workers | `SharedArrayBuffer` + `Atomics` | `multiprocessing.shared_memory` |
| Fixed worker pool | Custom WorkerPool class | `ProcessPoolExecutor(max_workers=N)` |
| One-off background task | Single `Worker` instance | `asyncio.to_thread` or `executor.submit` |

---

## Pool Sizing Guidelines

| Workload Type | Recommended Pool Size |
|---------------|----------------------|
| CPU-bound | `os.cpu_count()` or `navigator.hardwareConcurrency` |
| I/O-bound (thread pool) | `cpu_count * 5` to `cpu_count * 10` |
| Mixed | Separate pools: CPU pool = `cpu_count`, I/O pool = `cpu_count * 5` |
| Memory-heavy workers | Reduce pool size; monitor per-worker memory |

---

## Best Practices

1. **Reuse pools** -- Create `ProcessPoolExecutor` / `WorkerPool` once at startup, not per request.
2. **Use structured data for messages** -- Pass serializable objects; avoid closures or complex references.
3. **Handle worker crashes** -- Workers can segfault or OOM; detect exit codes and replace dead workers.
4. **Set timeouts on worker tasks** -- Use `future.result(timeout=N)` to prevent indefinite waits.
5. **Prefer `asyncio.to_thread` for blocking I/O** -- Simpler than explicit executor for thread-based work.
6. **Use SharedArrayBuffer sparingly** -- Only when zero-copy performance matters; adds complexity.
7. **Profile before parallelizing** -- Worker overhead (serialization, context switch) may exceed gains for small tasks.
8. **Ensure functions are picklable (Python)** -- Lambda, nested functions, and closures cannot be sent to ProcessPoolExecutor.
