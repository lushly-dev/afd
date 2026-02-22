# Application-Level Caching

Redis patterns, in-memory caching, two-tier cache architectures, eviction policies, and distributed cache design.

## Redis Caching Patterns

### Basic Get/Set with TTL

```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: 'redis.example.com',
  port: 6379,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

// Set with TTL (EX = seconds, PX = milliseconds)
await redis.set('user:usr_123', JSON.stringify(user), 'EX', 300);

// Get with automatic deserialization
const cached = await redis.get('user:usr_123');
const user = cached ? JSON.parse(cached) : null;

// Set only if not exists (useful for locks)
await redis.set('lock:resource', '1', 'EX', 10, 'NX');

// Set only if exists (useful for updates)
await redis.set('user:usr_123', JSON.stringify(updated), 'EX', 300, 'XX');
```

### Hash-Based Caching (Partial Updates)

```typescript
// Store object fields individually for granular access
await redis.hset('user:usr_123', {
  name: 'Alice',
  email: 'alice@example.com',
  plan: 'pro',
});
await redis.expire('user:usr_123', 300);

// Read specific fields without deserializing entire object
const name = await redis.hget('user:usr_123', 'name');

// Update single field without reading/writing entire object
await redis.hset('user:usr_123', 'plan', 'enterprise');

// Read all fields
const user = await redis.hgetall('user:usr_123');
```

### Sorted Set for Ranked/Time-Based Data

```typescript
// Leaderboard or time-series cache
await redis.zadd('leaderboard', score, 'player:123');

// Get top 10
const top10 = await redis.zrevrange('leaderboard', 0, 9, 'WITHSCORES');

// Time-based expiration of set members
await redis.zadd('recent:searches', Date.now(), searchQuery);
// Remove entries older than 1 hour
await redis.zremrangebyscore('recent:searches', '-inf', Date.now() - 3600000);
```

### Pipeline and Multi for Batch Operations

```typescript
// Pipeline: batch commands for reduced round trips
const pipeline = redis.pipeline();
pipeline.get('user:usr_123');
pipeline.get('user:usr_456');
pipeline.get('user:usr_789');
const results = await pipeline.exec();

// Multi/Exec: atomic operations
const multi = redis.multi();
multi.set('user:usr_123', JSON.stringify(user), 'EX', 300);
multi.del('user:usr_123:sessions');
multi.sadd('updated:users', 'usr_123');
await multi.exec();
```

---

## Cache-Aside Implementation

```typescript
class CacheAside<T> {
  constructor(
    private redis: Redis,
    private prefix: string,
    private ttlSeconds: number,
  ) {}

  async get(key: string, fetchFn: () => Promise<T | null>): Promise<T | null> {
    const cacheKey = `${this.prefix}:${key}`;

    // 1. Try cache
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }

    // 2. Fetch from source
    const value = await fetchFn();
    if (value === null) return null;

    // 3. Populate cache (fire-and-forget; cache failure should not break reads)
    this.redis.set(cacheKey, JSON.stringify(value), 'EX', this.ttlSeconds).catch((err) => {
      console.error(`Cache set failed for ${cacheKey}:`, err);
    });

    return value;
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(`${this.prefix}:${key}`);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    // Use SCAN to avoid blocking Redis with KEYS
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', `${this.prefix}:${pattern}`, 'COUNT', 100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }
}

// Usage
const userCache = new CacheAside<User>(redis, 'user', 300);
const user = await userCache.get('usr_123', () => db.users.findById('usr_123'));
```

---

## In-Memory Caching (Process-Level)

### LRU Cache Implementation

```typescript
// Using lru-cache package (most popular Node.js LRU)
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, User>({
  max: 1000,                    // Max entries
  maxSize: 50 * 1024 * 1024,   // 50MB max memory
  sizeCalculation: (value) => JSON.stringify(value).length,
  ttl: 5 * 60 * 1000,          // 5 minutes
  allowStale: false,            // Do not return expired entries
  updateAgeOnGet: true,         // Refresh TTL on access
  updateAgeOnHas: false,
});

cache.set('usr_123', user);
const cached = cache.get('usr_123'); // undefined if evicted or expired
cache.delete('usr_123');
cache.clear();

// Stats
console.log(`Size: ${cache.size}, Calculated size: ${cache.calculatedSize}`);
```

### Map-Based Simple Cache (No Dependencies)

```typescript
class SimpleCache<T> {
  private cache = new Map<string, { value: T; expiresAt: number }>();
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  set(key: string, value: T, ttlMs: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

---

## Two-Tier Cache Architecture

Combine in-memory (L1) and Redis (L2) for optimal performance:

```typescript
class TwoTierCache<T> {
  private l1: LRUCache<string, T>;
  private l2: Redis;
  private prefix: string;
  private ttlSeconds: number;

  constructor(redis: Redis, prefix: string, ttlSeconds: number) {
    this.l1 = new LRUCache<string, T>({
      max: 500,
      ttl: ttlSeconds * 1000,
    });
    this.l2 = redis;
    this.prefix = prefix;
    this.ttlSeconds = ttlSeconds;
  }

  async get(key: string, fetchFn: () => Promise<T | null>): Promise<T | null> {
    // L1: Check in-memory (sub-millisecond)
    const l1Value = this.l1.get(key);
    if (l1Value !== undefined) return l1Value;

    // L2: Check Redis (1-2ms)
    const l2Key = `${this.prefix}:${key}`;
    const l2Value = await this.l2.get(l2Key);
    if (l2Value !== null) {
      const parsed = JSON.parse(l2Value) as T;
      this.l1.set(key, parsed); // Promote to L1
      return parsed;
    }

    // Miss: Fetch from source
    const value = await fetchFn();
    if (value === null) return null;

    // Populate both tiers
    this.l1.set(key, value);
    await this.l2.set(l2Key, JSON.stringify(value), 'EX', this.ttlSeconds);

    return value;
  }

  async invalidate(key: string): Promise<void> {
    this.l1.delete(key);
    await this.l2.del(`${this.prefix}:${key}`);
  }
}
```

**Tradeoff:** L1 is per-process and not shared. In multi-instance deployments, L1 caches can diverge briefly after invalidation. Keep L1 TTL short (30-60s) or use pub/sub for cross-instance invalidation.

---

## Eviction Policies

### Redis Eviction Configuration

```
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru

# Available policies:
# noeviction       - Return errors when memory limit is reached
# allkeys-lru      - Evict least recently used keys (recommended default)
# allkeys-lfu      - Evict least frequently used keys
# volatile-lru     - LRU only among keys with TTL set
# volatile-lfu     - LFU only among keys with TTL set
# allkeys-random   - Random eviction
# volatile-random  - Random eviction among keys with TTL
# volatile-ttl     - Evict keys with shortest remaining TTL
```

### Choosing a Policy

| Scenario | Recommended policy |
|----------|--------------------|
| General purpose cache | `allkeys-lru` |
| Skewed access (few hot keys, many cold) | `allkeys-lfu` |
| Mix of persistent and cached data | `volatile-lru` or `volatile-lfu` |
| Data with known expiration schedules | `volatile-ttl` |
| Must never lose data silently | `noeviction` (handle errors in app) |

### Redis LFU Tuning

```
# redis.conf
# lfu-log-factor: higher = slower frequency counter growth (default 10)
lfu-log-factor 10

# lfu-decay-time: minutes to halve the frequency counter (default 1)
# Higher values = longer memory of past access patterns
lfu-decay-time 1
```

---

## Connection Pooling

```typescript
// ioredis with connection pool
import Redis from 'ioredis';

const redis = new Redis({
  host: 'redis.example.com',
  port: 6379,
  // Connection pool settings
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 10) return null; // Stop retrying
    return Math.min(times * 100, 3000);
  },
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ECONNRESET'];
    return targetErrors.some(e => err.message.includes(e));
  },
});

// Cluster mode for distributed cache
const cluster = new Redis.Cluster([
  { host: 'node1.redis.example.com', port: 6379 },
  { host: 'node2.redis.example.com', port: 6379 },
  { host: 'node3.redis.example.com', port: 6379 },
], {
  scaleReads: 'slave',           // Read from replicas
  maxRedirections: 16,
  retryDelayOnFailover: 300,
});
```

---

## Serialization Formats

| Format | Size | Speed | Debuggability | Use when |
|--------|------|-------|---------------|----------|
| JSON | Large | Moderate | Excellent | Default choice; human-readable |
| MessagePack | Small | Fast | Poor | High throughput; bandwidth-sensitive |
| Protocol Buffers | Smallest | Fastest | Poor | Schema-defined data; cross-language |

```typescript
// MessagePack example
import { encode, decode } from '@msgpack/msgpack';

await redis.set('user:123', Buffer.from(encode(user)), 'EX', 300);
const cached = await redis.getBuffer('user:123');
const user = cached ? decode(cached) : null;
```

---

## Health Checks and Monitoring

```typescript
// Redis health check
async function healthCheck(): Promise<{ status: string; latency: number }> {
  const start = performance.now();
  try {
    await redis.ping();
    return { status: 'healthy', latency: performance.now() - start };
  } catch (err) {
    return { status: 'unhealthy', latency: performance.now() - start };
  }
}

// Key metrics to monitor
// - redis_used_memory / redis_maxmemory (target < 80%)
// - keyspace_hits / (keyspace_hits + keyspace_misses) (target > 80%)
// - evicted_keys (should be near 0 if properly sized)
// - connected_clients (watch for connection leaks)
// - instantaneous_ops_per_sec (baseline for capacity planning)
```
