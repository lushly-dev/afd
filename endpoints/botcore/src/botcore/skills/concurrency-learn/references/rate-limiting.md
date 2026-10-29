# Rate Limiting

Patterns for throttling API calls, managing request budgets, and respecting external service limits.

---

## Why Rate Limit?

1. **Respect external API limits** -- Avoid 429 errors and account suspension
2. **Protect downstream services** -- Prevent overwhelming databases, APIs, or microservices
3. **Fair resource sharing** -- Ensure multiple consumers get equitable access
4. **Cost control** -- Prevent runaway API usage costs (especially LLM APIs)

---

## TypeScript Patterns

### Semaphore-Based Concurrency Limiting

```typescript
import { Semaphore } from 'async-mutex';

class RateLimitedClient {
  private semaphore: Semaphore;

  constructor(maxConcurrent: number = 5) {
    this.semaphore = new Semaphore(maxConcurrent);
  }

  async request<T>(url: string): Promise<T> {
    const [, release] = await this.semaphore.acquire();
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('Retry-After') || '1');
        await this.delay(retryAfter * 1000);
        return this.request(url); // Retry after delay
      }
      return response.json();
    } finally {
      release();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### p-limit (Minimal Dependency)

```typescript
import pLimit from 'p-limit';

const limit = pLimit(5); // Max 5 concurrent

const results = await Promise.all(
  urls.map(url => limit(() => fetch(url).then(r => r.json())))
);
```

### Token Bucket Rate Limiter

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number, // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(count: number = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      // Wait until enough tokens are available
      const waitMs = ((count - this.tokens) / this.refillRate) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}

// Usage: 10 requests per second, burst of 20
const bucket = new TokenBucket(20, 10);

async function rateLimitedFetch(url: string): Promise<Response> {
  await bucket.acquire();
  return fetch(url);
}
```

### Sliding Window Rate Limiter

```typescript
class SlidingWindowLimiter {
  private timestamps: number[] = [];

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      // Remove timestamps outside the window
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      // Wait until the oldest request exits the window
      const oldestInWindow = this.timestamps[0];
      const waitMs = this.windowMs - (now - oldestInWindow) + 1;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}

// Usage: Max 100 requests per minute
const limiter = new SlidingWindowLimiter(100, 60_000);
```

### Retry with Exponential Backoff

```typescript
async function fetchWithRetry(
  url: string,
  maxRetries: number = 3,
  signal?: AbortSignal,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, { signal });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter
          ? parseInt(retryAfter) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 30_000);

        // Add jitter to prevent thundering herd
        const jitter = Math.random() * delayMs * 0.1;
        await new Promise(r => setTimeout(r, delayMs + jitter));
        continue;
      }

      if (response.status >= 500 && attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }

      return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}
```

---

## Python Patterns

### Semaphore-Based Limiting

```python
import asyncio
import aiohttp

class RateLimitedClient:
    def __init__(self, max_concurrent: int = 5):
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self):
        self._session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, *exc):
        if self._session:
            await self._session.close()

    async def get(self, url: str) -> dict:
        async with self._semaphore:
            async with self._session.get(url) as resp:
                if resp.status == 429:
                    retry_after = int(resp.headers.get("Retry-After", "1"))
                    await asyncio.sleep(retry_after)
                    return await self.get(url)  # Retry
                resp.raise_for_status()
                return await resp.json()
```

### Token Bucket (Python)

```python
import asyncio
import time

class TokenBucket:
    def __init__(self, max_tokens: int, refill_rate: float):
        self._max_tokens = max_tokens
        self._tokens = float(max_tokens)
        self._refill_rate = refill_rate  # tokens per second
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self, count: int = 1) -> None:
        while True:
            async with self._lock:
                now = time.monotonic()
                elapsed = now - self._last_refill
                self._tokens = min(
                    self._max_tokens,
                    self._tokens + elapsed * self._refill_rate,
                )
                self._last_refill = now

                if self._tokens >= count:
                    self._tokens -= count
                    return

                wait_time = (count - self._tokens) / self._refill_rate

            await asyncio.sleep(wait_time)

# Usage: 10 requests/sec, burst of 20
bucket = TokenBucket(max_tokens=20, refill_rate=10)

async def rate_limited_call(url: str) -> dict:
    await bucket.acquire()
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            return await resp.json()
```

### Retry with Exponential Backoff (Python)

```python
import asyncio
import random

async def fetch_with_retry(
    session: aiohttp.ClientSession,
    url: str,
    max_retries: int = 3,
) -> dict:
    for attempt in range(max_retries + 1):
        try:
            async with session.get(url) as resp:
                if resp.status == 429:
                    retry_after = int(resp.headers.get("Retry-After", "1"))
                    jitter = random.uniform(0, retry_after * 0.1)
                    await asyncio.sleep(retry_after + jitter)
                    continue

                if resp.status >= 500 and attempt < max_retries:
                    delay = min(2 ** attempt, 30)
                    await asyncio.sleep(delay)
                    continue

                resp.raise_for_status()
                return await resp.json()

        except aiohttp.ClientError as e:
            if attempt == max_retries:
                raise
            delay = min(2 ** attempt, 30)
            await asyncio.sleep(delay)

    raise RuntimeError("Max retries exceeded")
```

---

## LLM / Agentic API Rate Limiting

LLM APIs have unique rate limiting characteristics:

### Dual Limits: RPM and TPM

```python
class LLMRateLimiter:
    """Enforces both requests-per-minute and tokens-per-minute limits."""

    def __init__(self, rpm: int, tpm: int):
        self._rpm_bucket = TokenBucket(max_tokens=rpm, refill_rate=rpm / 60)
        self._tpm_bucket = TokenBucket(max_tokens=tpm, refill_rate=tpm / 60)
        self._concurrent = asyncio.Semaphore(rpm // 2)  # Conservative

    async def acquire(self, estimated_tokens: int) -> None:
        async with self._concurrent:
            await self._rpm_bucket.acquire(1)
            await self._tpm_bucket.acquire(estimated_tokens)

# Usage for OpenAI API
limiter = LLMRateLimiter(rpm=500, tpm=200_000)

async def call_llm(prompt: str) -> str:
    estimated_tokens = len(prompt.split()) * 1.3  # Rough estimate
    await limiter.acquire(int(estimated_tokens))
    return await openai_client.chat(prompt)
```

### Batch API Calls with Rate Limiting

```typescript
async function batchLLMCalls(
  prompts: string[],
  maxConcurrent: number = 5,
  delayBetweenMs: number = 200,
): Promise<string[]> {
  const semaphore = new Semaphore(maxConcurrent);
  const results: string[] = [];

  await Promise.all(
    prompts.map(async (prompt, i) => {
      const [, release] = await semaphore.acquire();
      try {
        // Stagger requests to avoid burst
        if (i > 0) await new Promise(r => setTimeout(r, delayBetweenMs));
        const result = await callLLM(prompt);
        results[i] = result;
      } finally {
        release();
      }
    })
  );

  return results;
}
```

---

## Rate Limit Headers to Respect

| Header | Meaning |
|--------|---------|
| `Retry-After` | Seconds (or date) to wait before retrying |
| `X-RateLimit-Limit` | Maximum requests allowed in the window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

### Adaptive Rate Limiting

```typescript
class AdaptiveRateLimiter {
  private currentLimit: number;
  private semaphore: Semaphore;

  constructor(initialLimit: number) {
    this.currentLimit = initialLimit;
    this.semaphore = new Semaphore(initialLimit);
  }

  async request(url: string): Promise<Response> {
    const [, release] = await this.semaphore.acquire();
    try {
      const response = await fetch(url);

      // Adapt based on rate limit headers
      const remaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '999');
      if (remaining < this.currentLimit * 0.1) {
        // Below 10% -- slow down
        await new Promise(r => setTimeout(r, 1000));
      }

      return response;
    } finally {
      release();
    }
  }
}
```

---

## Best Practices

1. **Start conservative** -- Begin with low concurrency (3-5) and increase based on observed behavior.
2. **Always handle 429 responses** -- Parse `Retry-After` header and wait the specified duration.
3. **Add jitter to retries** -- Prevents thundering herd when multiple clients retry simultaneously.
4. **Separate limits per resource** -- Different APIs have different limits; use separate limiters.
5. **Estimate token usage for LLM APIs** -- Token limits (TPM) are as important as request limits (RPM).
6. **Log rate limit events** -- Track when rate limiting kicks in to tune concurrency settings.
7. **Use adaptive limiting** -- Read rate limit headers and adjust behavior dynamically.
8. **Cap max concurrent at 4-6 for CPU-bound agent tasks** -- Higher concurrency shows diminishing returns.
