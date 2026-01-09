# DirectClient Guide

> **When to Use**: DirectClient is for scenarios where an AI agent runs **in the same process** as your AFD application. It provides zero-transport-overhead command execution (~0.03ms vs ~2-10ms for MCP).

## When to Use DirectClient

✅ **Use DirectClient when:**
- An LLM/agent is embedded in your application (e.g., Gemini, OpenAI)
- The agent makes many sequential tool calls (each call saves ~2-10ms)
- You want the fastest possible agentic loops

❌ **Don't use DirectClient when:**
- Running tests via GitHub Actions or IDE (no co-located agent)
- The agent is in a separate process (use MCP over HTTP/SSE)
- You need cross-process communication

## Security Considerations

When exposing DirectClient over HTTP (for browser-based AI interactions), apply these hardening measures:

### 1. API Key Protection
```typescript
// Validate on startup
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey || apiKey.length < 20) {
  console.error('Invalid API key');
  process.exit(1);
}
// Mask in logs
const masked = '***' + apiKey.slice(-4);
console.log(`API Key: ${masked}`);
```

### 2. CORS Lockdown
```typescript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') ?? ['*'];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || '';
  if (!ALLOWED_ORIGINS.includes('*') && !ALLOWED_ORIGINS.includes(origin)) {
    res.writeHead(403);
    res.end('Origin not allowed');
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  return true;
}
```

### 3. Rate Limiting
```typescript
const RATE_LIMIT = 30; // requests per minute
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}
```

### 4. Input Validation
```typescript
const MAX_BODY_SIZE = 10 * 1024; // 10KB

// Validate command names
function validateCommandName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  return /^[a-zA-Z][a-zA-Z0-9-]{0,49}$/.test(name);
}

// Limit request body size
req.on('data', (chunk) => {
  size += chunk.length;
  if (size > MAX_BODY_SIZE) {
    req.destroy();
    reject(new Error('Request too large'));
  }
});
```

## Error Handling

### Retry with Exponential Backoff
```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxRetries) throw error;
      await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
    }
  }
  throw new Error('Exhausted retries');
}
```

### Error Categorization
Categorize errors for user-friendly messages:
- `rate_limit` → "Please wait a moment and try again"
- `auth` → "Check API key configuration"
- `network` → "Check your internet connection"
- `timeout` → "Try a simpler request"
- `server` → "Service temporarily unavailable"

## Observability

### Health Endpoints
```typescript
// GET /health - Basic liveness
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeMs: Date.now() - startTime });
});

// GET /ready - Comprehensive readiness
app.get('/ready', (req, res) => {
  const isReady = isGeminiConfigured();
  res.status(isReady ? 200 : 503).json({
    ready: isReady,
    checks: { gemini: isReady ? 'ok' : 'missing_key' }
  });
});
```

### Metrics Collection
Track these for production:
- Request counts (total, success, error)
- Latency percentiles (p50, p95, p99)
- Error rates by type
- Tool call counts

```typescript
// GET /metrics
app.get('/metrics', (req, res) => {
  res.json({
    requestCount: metrics.total,
    p50LatencyMs: calculatePercentile(50),
    p95LatencyMs: calculatePercentile(95),
    errorsByType: metrics.errors
  });
});
```

## Performance Comparison

| Transport | Latency per Call | Best For |
|-----------|-----------------|----------|
| DirectClient | ~0.03-0.1ms | Co-located agents |
| MCP (HTTP) | ~2-5ms | Cross-process |
| MCP (SSE) | ~5-10ms | Remote agents |

## Example: AI Copilot Integration

See `packages/examples/todo-directclient` for a complete example showing:
- Gemini 2.0 Flash + DirectClient
- Security hardening (CORS, rate limiting, input validation)
- Metrics and health endpoints
- Chat UI with tool execution display
