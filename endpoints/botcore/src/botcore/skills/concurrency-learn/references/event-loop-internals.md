# Event Loop Internals

Understanding microtask/macrotask ordering in JavaScript and asyncio scheduling in Python.

---

## JavaScript Event Loop

### Architecture

```
┌─────────────────────────────────┐
│         Call Stack               │
│  (synchronous execution)         │
└────────────┬────────────────────┘
             │ empty?
             ▼
┌─────────────────────────────────┐
│       Microtask Queue            │
│  Promise.then, queueMicrotask   │
│  MutationObserver                │
│  (ALL drained before next step)  │
└────────────┬────────────────────┘
             │ empty?
             ▼
┌─────────────────────────────────┐
│       Macrotask Queue            │
│  setTimeout, setInterval         │
│  I/O callbacks, setImmediate     │
│  UI rendering (browser)          │
│  (ONE task per iteration)        │
└────────────┬────────────────────┘
             │
             └──► back to microtask check
```

### Execution Order Rules

1. Execute the current synchronous code on the call stack
2. When the call stack is empty, drain ALL microtasks
3. Execute ONE macrotask
4. Drain ALL microtasks again
5. Render (browser) / check I/O (Node.js)
6. Repeat

**Critical insight:** Microtasks that enqueue more microtasks will ALL execute before any macrotask runs. This can starve macrotasks and block rendering.

### Microtask Sources

| Source | Type |
|--------|------|
| `Promise.then/catch/finally` | Microtask |
| `queueMicrotask()` | Microtask |
| `MutationObserver` | Microtask |
| `await` (after the awaited promise resolves) | Microtask |

### Macrotask Sources

| Source | Type |
|--------|------|
| `setTimeout` / `setInterval` | Macrotask |
| `setImmediate` (Node.js) | Macrotask |
| I/O callbacks | Macrotask |
| UI rendering (browser) | Between macrotasks |
| `requestAnimationFrame` (browser) | Before render |

### Common Ordering Gotchas

```typescript
console.log('1 - sync');

setTimeout(() => console.log('2 - macrotask'), 0);

Promise.resolve().then(() => console.log('3 - microtask'));

queueMicrotask(() => console.log('4 - microtask'));

console.log('5 - sync');

// Output order: 1, 5, 3, 4, 2
// Sync first, then all microtasks, then macrotask
```

```typescript
// Microtask starvation example
function starve() {
  queueMicrotask(starve); // Infinite microtasks
}
starve();
// setTimeout callbacks NEVER run, UI NEVER updates
```

### Node.js Event Loop Phases

Node.js has a more detailed loop than the browser:

```
   ┌───────────────────────────┐
┌─>│         timers             │  setTimeout, setInterval
│  └────────────┬──────────────┘
│  ┌────────────▼──────────────┐
│  │     pending callbacks      │  System-level callbacks
│  └────────────┬──────────────┘
│  ┌────────────▼──────────────┐
│  │       idle, prepare        │  Internal
│  └────────────┬──────────────┘
│  ┌────────────▼──────────────┐
│  │         poll               │  I/O events, incoming connections
│  └────────────┬──────────────┘
│  ┌────────────▼──────────────┐
│  │         check              │  setImmediate
│  └────────────┬──────────────┘
│  ┌────────────▼──────────────┐
│  │     close callbacks        │  socket.on('close')
│  └────────────┬──────────────┘
│               │
└───────────────┘
   (microtasks drain between EACH phase)
```

### process.nextTick vs queueMicrotask

```typescript
// process.nextTick runs BEFORE other microtasks
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
// Output: nextTick, promise

// Prefer queueMicrotask over process.nextTick for new code
// process.nextTick can starve I/O if used recursively
```

### Yielding to the Event Loop

```typescript
// Break up long synchronous work to keep the event loop responsive

// Method 1: setTimeout (yields to macrotask queue)
function yieldMacro(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// Method 2: setImmediate (Node.js, yields after I/O)
function yieldImmediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// Method 3: Scheduler API (browsers, 2024+)
async function yieldToMain(): Promise<void> {
  if ('scheduler' in globalThis && 'yield' in (globalThis as any).scheduler) {
    await (globalThis as any).scheduler.yield();
  } else {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

// Usage: yield periodically in CPU-heavy work
async function processLargeArray(items: Item[]): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    processItem(items[i]);
    if (i % 100 === 0) await yieldMacro(); // Let other work run
  }
}
```

---

## Python asyncio Event Loop

### Architecture

```
┌─────────────────────────────────┐
│       Running Coroutine          │
│  (executes until next await)     │
└────────────┬────────────────────┘
             │ await
             ▼
┌─────────────────────────────────┐
│        Ready Queue               │
│  Coroutines ready to resume      │
│  (callbacks from completed I/O)  │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│       I/O Selector               │
│  epoll/kqueue/IOCP               │
│  Waits for I/O events or timers  │
└────────────┬────────────────────┘
             │ events ready
             ▼
┌─────────────────────────────────┐
│     Scheduled Callbacks          │
│  call_later, call_at             │
│  (sorted by scheduled time)      │
└─────────────────────────────────┘
```

### How asyncio Schedules Tasks

```python
import asyncio

async def example():
    # 1. This coroutine runs until the first await
    print("step 1")

    # 2. await suspends this coroutine, event loop picks next ready task
    await asyncio.sleep(0.1)

    # 3. After 0.1s, this coroutine is placed back in ready queue
    print("step 2")

    # 4. await gives other tasks a chance to run
    data = await fetch_data()

    # 5. Resumes after fetch_data completes
    print("step 3")
```

### asyncio.sleep(0) -- Yielding Control

```python
# Yield to other tasks without actual delay
async def long_computation(data: list[int]) -> int:
    total = 0
    for i, item in enumerate(data):
        total += expensive_calc(item)
        if i % 1000 == 0:
            await asyncio.sleep(0)  # Let other tasks run
    return total
```

### Task Scheduling Details

```python
# create_task schedules immediately (next iteration)
async def main():
    task1 = asyncio.create_task(coro1())  # Scheduled, not running yet
    task2 = asyncio.create_task(coro2())  # Scheduled after task1

    # Tasks start running when we await (or any suspend point)
    await task1  # Now task1 starts; task2 may also start if task1 suspends
    await task2

# call_soon -- schedule a regular callback
loop = asyncio.get_event_loop()
loop.call_soon(callback, arg1, arg2)

# call_later -- schedule after delay
loop.call_later(5.0, callback, arg1)
```

### Debug Mode

```python
# Enable asyncio debug mode to catch common mistakes
import asyncio

asyncio.run(main(), debug=True)
# Or set environment variable: PYTHONASYNCIODEBUG=1

# Debug mode warns about:
# - Coroutines that were never awaited
# - Callbacks that take too long (> 100ms)
# - Unawaited tasks
```

### Common asyncio Mistakes

```python
# MISTAKE 1: Forgetting to await
async def bad():
    asyncio.create_task(some_coro())  # Task created but might be GC'd!

# FIX: Keep a reference
async def good():
    task = asyncio.create_task(some_coro())
    await task  # Or add to a set/list

# MISTAKE 2: Blocking the event loop
async def bad():
    time.sleep(5)  # Blocks entire event loop!

# FIX: Use async sleep or run in executor
async def good():
    await asyncio.sleep(5)  # Non-blocking
    # Or for sync I/O:
    result = await asyncio.to_thread(blocking_io_function)

# MISTAKE 3: Creating tasks without structured concurrency
async def bad():
    for item in items:
        asyncio.create_task(process(item))  # Fire and forget!
    # Function returns before tasks complete

# FIX: Use TaskGroup
async def good():
    async with asyncio.TaskGroup() as tg:
        for item in items:
            tg.create_task(process(item))
    # All tasks guaranteed complete here
```

---

## Comparison: JS vs Python Event Loops

| Aspect | JavaScript (Node.js) | Python (asyncio) |
|--------|---------------------|-----------------|
| Thread model | Single-threaded + libuv thread pool | Single-threaded + optional executor |
| Microtask equivalent | Promise.then, queueMicrotask | Awaited coroutine resume |
| Macrotask equivalent | setTimeout, I/O callbacks | call_later, I/O callbacks |
| Yielding | `await new Promise(r => setTimeout(r, 0))` | `await asyncio.sleep(0)` |
| Blocking detection | No built-in (use --prof) | Debug mode warns > 100ms |
| I/O multiplexer | libuv (epoll/kqueue/IOCP) | selectors (epoll/kqueue/IOCP) |
| CPU offload | worker_threads | ProcessPoolExecutor / asyncio.to_thread |
| Multiple loops | One per isolate | One per thread (asyncio.run creates one) |

---

## Best Practices

1. **Never block the event loop** -- No `time.sleep()` in asyncio, no synchronous I/O in Node.js. Use `asyncio.to_thread()` or `worker_threads`.
2. **Yield periodically in CPU work** -- Use `await asyncio.sleep(0)` or `setTimeout(r, 0)` to prevent starving other tasks.
3. **Prefer queueMicrotask over process.nextTick** -- nextTick can starve I/O; queueMicrotask integrates better with promises.
4. **Enable asyncio debug mode during development** -- Catches unawaited coroutines and blocking calls early.
5. **Keep task references** -- Unreferenced asyncio tasks can be garbage collected before completion.
6. **Understand ordering** -- Microtasks (JS) always run before macrotasks; asyncio ready queue is FIFO.
7. **Monitor event loop lag** -- In Node.js use `monitorEventLoopDelay`; in Python measure time between scheduled and actual execution.
