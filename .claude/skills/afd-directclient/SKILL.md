---
name: afd-directclient
description: >
  DirectClient transport for zero-overhead command execution when AI agents
  are co-located in the same Node.js process. Covers the validating
  createDirectRegistry, when to use, security hardening, error handling, and
  observability patterns.
  Triggers: directclient, in-process, zero overhead, co-located agent,
  embedded agent, gemini integration, chat server, createDirectRegistry,
  DirectRegistry.
---

# AFD DirectClient Patterns

DirectClient bypasses MCP transport for ~0.03ms command execution (vs ~2-10ms MCP).

## When to Use

```
✅ Use DirectClient when:
- LLM/agent runs in same process as your app
- Agent makes many sequential tool calls
- Need fastest possible agentic loops

❌ Don't use when:
- Running tests (GitHub Actions, IDE) — use CLI/MCP
- Agent is in separate process — use HTTP/SSE
- Cross-process communication needed
```

## The Registry: Always `createDirectRegistry`

Build the registry with `createDirectRegistry` from `@lushly-dev/afd-server`.
It runs every call through the same engine as `createMcpServer`:

- **Zod validation** of the full input before the handler runs (nested objects,
  wrong types, lengths, enums, defaults and transforms)
- **Middleware** (logging, tracing, rate limiting, auth), plus `onCommand`/`onError`
- **Error sanitization**: exception text stays out of results unless `devMode: true`
- **Exposure**: only commands exposed to the chosen interface (`'agent'` by
  default) are listed or run; others get `COMMAND_NOT_EXPOSED`

```typescript
// registry.ts
import { createDirectRegistry } from '@lushly-dev/afd-server';
import { allCommands } from './commands/index.js';

export const registry = createDirectRegistry(allCommands, {
  interface: 'agent',            // default
  middleware: [/* same middleware as your MCP server */],
});
```

❌ **Never hand-roll a registry** that calls `command.handler(input)`. It skips
Zod validation (so `{ "title": { "nested": true } }` reaches your store), skips
middleware, leaks exception messages, and lets the agent call commands you
marked `expose: { agent: false }`.

Exposure flags a command leaves out fall back to `defaultExpose` (`palette` and
`agent` on, `mcp` and `cli` off). `expose: { mcp: true }` therefore stays
available to in-app agents; use `expose: { agent: false }` for commands the AI
must not run (for example destructive admin commands).

## Basic Usage

```typescript
import { isSuccess } from '@lushly-dev/afd-core';
import { DirectClient, isUnknownToolError } from '@lushly-dev/afd-client';
import { registry } from './registry.js';

const client = new DirectClient(registry);

// Execute commands with zero transport overhead
const result = await client.call<Todo>('todo-create', {
  title: 'Fast task',
  priority: 'high'
});
// ~0.03ms vs 2-10ms for MCP

if (isUnknownToolError(result)) {
  console.error('Unknown command:', result.data?.hint);
} else if (isSuccess(result)) {
  console.log('Created:', result.data.id); // CommandResult<Todo>
} else {
  console.error('Error:', result.error);
}
```

`call<T>()` returns `CommandResult<T> | CommandResult<UnknownToolError>`; rule
out the unknown-tool case with `isUnknownToolError(result)` before reading
`result.data` as `T`.

### Narrowing What the Agent May Call

```typescript
const client = new DirectClient(registry, {
  allow: (name) => name.startsWith('todo-') && name !== 'todo-clear',
});
// Refused names return COMMAND_NOT_ALLOWED and are hidden from
// listCommands(), listCommandNames() and hasCommand().
```

### Timeouts and Cancellation

```typescript
const result = await client.call('report-build', input, {
  timeout: 5_000,               // enforced; per step in pipe()
  signal: request.signal,       // combined with the timeout
});
if (result.error?.code === 'TIMEOUT') {
  // The handler's signal was aborted, but it may still have finished:
  // check a mutation's effect before retrying.
}
```

## AI Chat Integration

```typescript
import { GoogleGenAI } from '@google/genai';
import { DirectClient } from '@lushly-dev/afd-client';

const directClient = new DirectClient(registry); // from createDirectRegistry

// Execute function calls from Gemini
for (const functionCall of response.functionCalls) {
  const commandName = functionCall.name.replace(/_/g, '-');
  const result = await directClient.call(commandName, functionCall.args);
  // Feed result back to Gemini
}
```

## Security Hardening (HTTP Exposure)

When exposing DirectClient over HTTP (for browser-based AI):

### API Key Protection

```typescript
function validateApiKey(): void {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey || apiKey.length < 20) {
    console.error('Invalid API key');
    process.exit(1);
  }
  // Mask in logs
  console.log(`API Key: ***${apiKey.slice(-4)}`);
}
```

### CORS Lockdown

Default to an explicit localhost allowlist, never `*`, and never reflect an
origin that is not on the list (including `null`). Bind the server to
`127.0.0.1` unless it must be reachable from elsewhere.

```typescript
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

function setCorsHeaders(req, res): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // same-origin or non-browser client
  if (!ALLOWED_ORIGINS.has(origin)) {
    res.writeHead(403);
    res.end();
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  return true;
}

server.listen(PORT, '127.0.0.1');
```

### Rate Limiting

Key the limit on the socket address (`req.socket.remoteAddress`), not on
`X-Forwarded-For`, unless a trusted proxy sets that header; clients can rotate
it to bypass the limit. Prune expired entries so the map stays bounded.

```typescript
const RATE_LIMIT = 30; // per minute
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (entry && entry.resetAt <= now) {
    rateLimits.delete(ip);
    entry = undefined;
  }
  if (!entry) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}
```

### Input Validation

Command inputs are validated by `createDirectRegistry` (each command's Zod
schema). At the HTTP boundary, also check the envelope:

```typescript
// Validate command names (prevent injection)
function validateCommandName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  return /^[a-zA-Z][a-zA-Z0-9-]{0,49}$/.test(name);
}

// Limit request body size
const MAX_BODY_SIZE = 10 * 1024; // 10KB
```

## Error Handling

### Retry with Exponential Backoff

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, baseDelayMs = 1000, requestId = '' }
): Promise<T> {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = categorizeError(error);
      if (!lastError.retryable) throw lastError;
      if (attempt >= maxRetries) throw lastError;
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
```

### Error Categorization

```typescript
type ErrorCategory = 'rate_limit' | 'auth' | 'network' | 'timeout' | 'server' | 'unknown';

function categorizeError(error: unknown): CategorizedError {
  const msg = error instanceof Error ? error.message : String(error);
  
  if (msg.includes('429') || msg.includes('rate limit')) {
    return { category: 'rate_limit', retryable: true,
      userMessage: 'Please wait and try again' };
  }
  if (msg.includes('401') || msg.includes('API key')) {
    return { category: 'auth', retryable: false,
      userMessage: 'Check API key configuration' };
  }
  // ... more categories
}
```

## Observability

### Health Endpoints

```typescript
// GET /health - Basic liveness
if (req.url === '/health') {
  res.json({ status: 'ok', uptimeMs: Date.now() - startTime });
}

// GET /ready - Component readiness
if (req.url === '/ready') {
  const ready = isGeminiConfigured();
  res.status(ready ? 200 : 503).json({
    ready,
    checks: { gemini: ready ? 'ok' : 'missing_key' }
  });
}
```

### Metrics Collection

```typescript
const metrics = {
  requestCount: 0,
  successCount: 0,
  errorCount: 0,
  toolCallCount: 0,
  latencies: [], // Keep last 100
  errorsByType: {},
};

// GET /metrics
res.json({
  ...metrics,
  p50LatencyMs: calculatePercentile(50),
  p95LatencyMs: calculatePercentile(95),
  p99LatencyMs: calculatePercentile(99),
});
```

## Performance Comparison

| Transport     | Latency     | Use Case |
|---------------|-------------|----------|
| DirectClient  | ~0.03ms     | Co-located agents |
| MCP (HTTP)    | ~2-5ms      | Cross-process |
| MCP (SSE)     | ~5-10ms     | Remote agents |

## Pipeline Execution

DirectClient supports `pipe()` for declarative command chaining:

```typescript
const result = await client.pipe([
  { command: 'user-get', input: { id: 1 }, as: 'user' },
  { command: 'order-list', input: { userId: '$prev.id' } },
]);
```

Variable resolution follows `spec/pipeline-variables.md`:

- References are whole strings: `$prev` (last successful step), `$first`, `$steps[n]`, `$steps.alias`
  and `$input`, each optionally followed by `.path` (`$prev.items[0].id`, `$prev.items.0`).
- `$input` is the request's own `input` field, passed as `client.pipe({ input, steps })`. It is **not**
  the `context` argument of `pipe()`: that context still reaches each command, but no reference can read
  it. (Before this change `$input` resolved to the caller's whole context, so auth or other secrets could
  be copied into command inputs.)
- Other `$` strings (`'$9.99'`, `'$HOME'`) are literals; `'$$prev'` sends the literal `'$prev'`.
- Only own keys of plain JSON objects and in-bounds indices resolve; `constructor`, `__proto__` and
  `__`-prefixed segments never do.
- Unresolved references are omitted from objects, `null` in arrays, and make `when` comparisons false.
- Inputs nested deeper than 64 levels fail with `VALIDATION_ERROR` before any command runs.
- Step data is copied between steps, so a handler that mutates its input cannot change another step's data.

```typescript
const result = await client.pipe(
  {
    input: { userId: 1 },
    steps: [
      { command: 'user-get', input: { id: '$input.userId' }, as: 'user' },
      { command: 'order-list', input: { userId: '$steps.user.id' } },
    ],
  },
  { traceId: 'trace-123' } // reaches handlers as context; not visible to $input
);
```

Options: `continueOnFailure`, `when` clauses for conditional steps, and `timeoutMs`.
Each step goes through `call()`, so `allow`, the registry's Zod validation and
a `timeout` passed in the pipe context (applied per step) all hold for pipelines.

## Related

- `afd-typescript` - TypeScript command patterns
- `afd-developer` - Core AFD methodology
- [Myoso](https://github.com/lushly-dev/myoso) - Standalone app with DirectClient + Gemini chat integration
