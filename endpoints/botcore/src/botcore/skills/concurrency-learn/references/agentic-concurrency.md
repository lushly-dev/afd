# Agentic Concurrency

Patterns for parallel tool execution, fan-out/fan-in workflows, and safe concurrency in AI agent systems.

---

## Core Principle: Classify Before Parallelizing

Agentic tool calls fall into two categories:

| Category | Examples | Concurrency |
|----------|----------|-------------|
| **Read-only** | File reads, web searches, API GETs, database SELECTs | Safe to parallelize |
| **Stateful/Write** | File writes, API POSTs, database mutations, shell commands | Must serialize or coordinate |

**Rule:** Run read-only tools concurrently; run stateful tools sequentially unless explicitly safe to parallelize.

---

## Fan-Out / Fan-In Pattern

The fundamental agentic concurrency pattern: split work across multiple parallel operations, then merge results.

### TypeScript: Agent Fan-Out

```typescript
interface ToolResult {
  tool: string;
  result: unknown;
  error?: Error;
}

async function agentFanOut(
  tools: Array<{ name: string; fn: () => Promise<unknown> }>,
  signal?: AbortSignal,
): Promise<ToolResult[]> {
  const results = await Promise.allSettled(
    tools.map(async (tool) => {
      signal?.throwIfAborted();
      const result = await tool.fn();
      return { tool: tool.name, result };
    })
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    return {
      tool: tools[i].name,
      result: null,
      error: r.reason,
    };
  });
}

// Usage: Research phase (all read-only, safe to parallelize)
const researchResults = await agentFanOut([
  { name: 'search_web', fn: () => searchWeb(query) },
  { name: 'read_docs', fn: () => readDocumentation(topic) },
  { name: 'check_examples', fn: () => findExamples(topic) },
]);
```

### Python: Agent Fan-Out with TaskGroup

```python
import asyncio
from dataclasses import dataclass

@dataclass
class ToolResult:
    tool: str
    result: object | None
    error: Exception | None = None

async def agent_fan_out(
    tools: list[tuple[str, callable]],
) -> list[ToolResult]:
    results: list[ToolResult] = []

    async def run_tool(name: str, fn: callable) -> None:
        try:
            result = await fn()
            results.append(ToolResult(tool=name, result=result))
        except Exception as e:
            results.append(ToolResult(tool=name, result=None, error=e))

    # Use gather with return_exceptions for partial failure tolerance
    await asyncio.gather(
        *[run_tool(name, fn) for name, fn in tools],
        return_exceptions=True,
    )

    return results
```

---

## Orchestrator-Worker Pattern

A central orchestrator agent breaks work into subtasks, dispatches to specialized workers, then synthesizes results.

### TypeScript: Orchestrator

```typescript
interface AgentTask {
  id: string;
  type: 'research' | 'generate' | 'review';
  input: unknown;
  dependencies: string[]; // Task IDs that must complete first
}

interface AgentResult {
  taskId: string;
  output: unknown;
}

class AgentOrchestrator {
  private completed = new Map<string, AgentResult>();
  private semaphore: Semaphore;

  constructor(maxConcurrent: number = 4) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  async execute(tasks: AgentTask[]): Promise<Map<string, AgentResult>> {
    // Topological sort: group tasks by dependency level
    const levels = this.topologicalLevels(tasks);

    for (const level of levels) {
      // Tasks within a level can run in parallel
      await Promise.allSettled(
        level.map(task => this.runTask(task))
      );
    }

    return this.completed;
  }

  private async runTask(task: AgentTask): Promise<void> {
    // Wait for dependencies
    for (const depId of task.dependencies) {
      if (!this.completed.has(depId)) {
        throw new Error(`Dependency ${depId} not completed`);
      }
    }

    const [, release] = await this.semaphore.acquire();
    try {
      const depResults = task.dependencies.map(id => this.completed.get(id)!);
      const output = await this.dispatch(task, depResults);
      this.completed.set(task.id, { taskId: task.id, output });
    } finally {
      release();
    }
  }

  private async dispatch(
    task: AgentTask,
    deps: AgentResult[],
  ): Promise<unknown> {
    switch (task.type) {
      case 'research': return this.researchWorker(task.input, deps);
      case 'generate': return this.generateWorker(task.input, deps);
      case 'review': return this.reviewWorker(task.input, deps);
    }
  }

  private topologicalLevels(tasks: AgentTask[]): AgentTask[][] {
    const levels: AgentTask[][] = [];
    const completed = new Set<string>();

    while (completed.size < tasks.length) {
      const level = tasks.filter(
        t => !completed.has(t.id) &&
             t.dependencies.every(d => completed.has(d))
      );
      if (level.length === 0) throw new Error('Circular dependency');
      level.forEach(t => completed.add(t.id));
      levels.push(level);
    }

    return levels;
  }
}
```

### Python: DAG-Based Task Orchestration

```python
import asyncio
from collections import defaultdict

class TaskDAG:
    def __init__(self, max_concurrent: int = 4):
        self._tasks: dict[str, callable] = {}
        self._deps: dict[str, set[str]] = defaultdict(set)
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._results: dict[str, object] = {}

    def add_task(self, name: str, fn: callable, depends_on: list[str] = None):
        self._tasks[name] = fn
        if depends_on:
            self._deps[name] = set(depends_on)

    async def execute(self) -> dict[str, object]:
        levels = self._topological_levels()

        for level in levels:
            async with asyncio.TaskGroup() as tg:
                for task_name in level:
                    tg.create_task(self._run_task(task_name))

        return self._results

    async def _run_task(self, name: str) -> None:
        async with self._semaphore:
            dep_results = {d: self._results[d] for d in self._deps.get(name, [])}
            self._results[name] = await self._tasks[name](dep_results)

    def _topological_levels(self) -> list[list[str]]:
        levels = []
        completed = set()
        remaining = set(self._tasks.keys())

        while remaining:
            level = [
                t for t in remaining
                if self._deps.get(t, set()).issubset(completed)
            ]
            if not level:
                raise ValueError("Circular dependency detected")
            completed.update(level)
            remaining -= set(level)
            levels.append(level)

        return levels

# Usage
dag = TaskDAG(max_concurrent=4)
dag.add_task("research", research_fn)
dag.add_task("outline", outline_fn, depends_on=["research"])
dag.add_task("draft", draft_fn, depends_on=["outline"])
dag.add_task("examples", examples_fn, depends_on=["research"])  # Parallel with outline
dag.add_task("review", review_fn, depends_on=["draft", "examples"])

results = await dag.execute()
```

---

## Rate-Limiting Agent API Calls

Agents making LLM or API calls need rate limiting to avoid 429 errors and cost overruns.

### Combined Concurrency + Rate Limiting

```typescript
class AgentAPILimiter {
  private concurrency: Semaphore;
  private bucket: TokenBucket;

  constructor(
    maxConcurrent: number = 4,
    requestsPerMinute: number = 60,
  ) {
    this.concurrency = new Semaphore(maxConcurrent);
    this.bucket = new TokenBucket(requestsPerMinute, requestsPerMinute / 60);
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    await this.bucket.acquire(); // Rate limit
    const [, release] = await this.concurrency.acquire(); // Concurrency limit
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const limiter = new AgentAPILimiter(4, 60);

// All agent tool calls go through the limiter
const results = await Promise.all(
  tasks.map(task => limiter.call(() => executeTool(task)))
);
```

---

## Parallel Tool Execution Safety

### Read-Only Tool Detection

```typescript
const READ_ONLY_TOOLS = new Set([
  'search_web',
  'read_file',
  'list_directory',
  'get_api',
  'query_database',  // SELECT only
]);

const STATEFUL_TOOLS = new Set([
  'write_file',
  'execute_command',
  'post_api',
  'update_database',
  'create_resource',
]);

function classifyToolCalls(
  calls: ToolCall[],
): { parallel: ToolCall[]; sequential: ToolCall[] } {
  const parallel = calls.filter(c => READ_ONLY_TOOLS.has(c.name));
  const sequential = calls.filter(c => !READ_ONLY_TOOLS.has(c.name));
  return { parallel, sequential };
}

async function executeToolCalls(calls: ToolCall[]): Promise<ToolResult[]> {
  const { parallel, sequential } = classifyToolCalls(calls);

  // Run read-only tools concurrently
  const parallelResults = await Promise.allSettled(
    parallel.map(call => executeTool(call))
  );

  // Run stateful tools one at a time
  const sequentialResults: ToolResult[] = [];
  for (const call of sequential) {
    sequentialResults.push(await executeTool(call));
  }

  return [...formatResults(parallelResults), ...sequentialResults];
}
```

### Idempotency for Safe Retries

```typescript
// Make agent tool calls idempotent with deduplication
class IdempotentExecutor {
  private cache = new Map<string, { result: unknown; timestamp: number }>();
  private ttlMs: number;

  constructor(ttlMs: number = 300_000) { // 5 min default
    this.ttlMs = ttlMs;
  }

  async execute(
    idempotencyKey: string,
    fn: () => Promise<unknown>,
  ): Promise<unknown> {
    const cached = this.cache.get(idempotencyKey);
    if (cached && Date.now() - cached.timestamp < this.ttlMs) {
      return cached.result; // Return cached result
    }

    const result = await fn();
    this.cache.set(idempotencyKey, { result, timestamp: Date.now() });
    return result;
  }
}
```

---

## Conflict Resolution in Multi-Agent Systems

When multiple agents operate on the same resource:

### Optimistic Approach

```python
async def agent_update_with_version(
    resource_id: str,
    transform_fn: callable,
    max_retries: int = 3,
) -> dict:
    for attempt in range(max_retries):
        # Read current state
        resource = await db.get(resource_id)
        version = resource["version"]

        # Transform
        updated = await transform_fn(resource)

        # Write with version check
        success = await db.update_if_version(
            resource_id, updated, expected_version=version
        )
        if success:
            return updated

        # Another agent modified it; retry with fresh state
        await asyncio.sleep(0.1 * (2 ** attempt))

    raise ConflictError(f"Could not update {resource_id} after {max_retries} retries")
```

### Pessimistic Approach (Advisory Lock)

```python
async def agent_exclusive_update(resource_id: str, transform_fn: callable) -> dict:
    # Acquire advisory lock keyed on resource
    lock_key = hash(resource_id) % (2**31)
    await db.execute(f"SELECT pg_advisory_lock({lock_key})")
    try:
        resource = await db.get(resource_id)
        updated = await transform_fn(resource)
        await db.update(resource_id, updated)
        return updated
    finally:
        await db.execute(f"SELECT pg_advisory_unlock({lock_key})")
```

---

## Performance Guidelines

| Guideline | Recommendation |
|-----------|---------------|
| Max parallel agent tasks | 4-6 (diminishing returns beyond this) |
| Max parallel LLM calls | 3-5 (API rate limits are the bottleneck) |
| Max parallel read-only tool calls | 10-20 (I/O bound, higher concurrency OK) |
| Max parallel file operations | 5-10 (OS file descriptor limits) |
| Stagger burst requests | Add 100-500ms delay between batches |
| Timeout per tool call | 30-60 seconds for API calls, 5-10 for local |

---

## Best Practices

1. **Always classify tools as read-only or stateful** -- This is the foundation of safe agent parallelism.
2. **Use allSettled, not all, for agent fan-out** -- Partial results are usually better than total failure in agentic workflows.
3. **Cap concurrent LLM calls at 3-5** -- API rate limits and token reservation cause throttling at higher concurrency.
4. **Implement idempotency keys** -- Agent retries are common; ensure repeated calls produce the same result.
5. **Log all parallel execution decisions** -- Track which tools ran in parallel vs sequential for debugging.
6. **Use DAG-based orchestration** -- Model task dependencies explicitly to maximize safe parallelism.
7. **Set per-tool timeouts** -- A hung tool call should not block the entire agent workflow.
8. **Merge results carefully** -- After fan-out, validate and reconcile potentially conflicting results before proceeding.
