---
name: afd-directclient
description: >
  DirectClient transport for zero-overhead command execution when AI agents
  are co-located in the same Node.js process. Covers when to use, security
  hardening, error handling, and observability patterns.
  Triggers: directclient, in-process, zero overhead, co-located agent,
  embedded agent, gemini integration, chat server.
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

## Basic Usage

```typescript
import { DirectClient } from '@lushly-dev/afd-client';
import { registry } from './registry.js';

const client = new DirectClient(registry);

// Execute commands with zero transport overhead
const result = await client.call<Todo>('todo-create', {
  title: 'Fast task',
  priority: 'high'
});
// ~0.03ms vs 2-10ms for MCP

if (result.success) {
  console.log('Created:', result.data);
} else {
  console.error('Error:', result.error);
}
```

## AI Chat Integration

```typescript
import { GoogleGenAI } from '@google/genai';
import { DirectClient } from '@lushly-dev/afd-client';

const directClient = new DirectClient(registry);

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

```typescript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') ?? ['*'];

function setCorsHeaders(req, res): boolean {
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.includes('*') && !ALLOWED_ORIGINS.includes(origin)) {
    res.writeHead(403);
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  return true;
}
```

### Rate Limiting

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

## Related

- `afd-typescript` - TypeScript command patterns
- `afd-developer` - Core AFD methodology
- DirectClient guide content is included in this skill
- `packages/examples/todo-directclient` - Working example
