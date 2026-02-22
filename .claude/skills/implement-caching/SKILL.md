---
name: implement-caching
source: botcore
description: >
  Guides caching strategy selection and implementation across the full stack including HTTP caching, application-level caching (Redis, in-memory), frontend data caching (SWR, TanStack Query), LLM response caching (prompt caching, semantic caching), database query caching, cache invalidation patterns, and distributed cache architectures. Covers cache-aside, read-through, write-through, write-behind patterns, eviction policies (LRU/LFU), and agentic workflow caching considerations. Use when adding caching to an application, choosing a caching strategy, debugging stale data, optimizing API response times, reducing LLM costs, or designing distributed cache topologies. Triggers: cache, caching, Redis, CDN, TTL, cache invalidation, stale data, Cache-Control, ETag, SWR, TanStack Query, prompt caching, semantic cache, LRU, write-through, cache-aside, materialized view.

version: 1.0.0
triggers:
  - cache
  - caching
  - Redis
  - CDN
  - TTL
  - cache invalidation
  - stale data
  - Cache-Control
  - ETag
  - SWR
  - TanStack Query
  - prompt caching
  - semantic cache
  - LRU
  - LFU
  - write-through
  - write-behind
  - cache-aside
  - read-through
  - materialized view
  - in-memory cache
  - distributed cache
  - eviction policy
portable: true
---

# Implementing Caching

Expert guidance for caching strategy selection, implementation, and invalidation across HTTP, application, frontend, database, and LLM layers.

## Capabilities

1. **HTTP Caching** -- Cache-Control headers, ETags, stale-while-revalidate, CDN edge caching, and s-maxage configuration
2. **Application-Level Caching** -- Redis patterns, in-memory caching, two-tier cache architectures, eviction policies (LRU/LFU), and connection pooling
3. **Caching Patterns** -- Cache-aside (lazy loading), read-through, write-through, write-behind (write-back), and refresh-ahead strategies
4. **Frontend Data Caching** -- SWR, TanStack Query, service workers, browser storage APIs, and optimistic updates
5. **LLM Response Caching** -- Anthropic prompt caching, semantic caching with embeddings, agentic plan caching, and workflow-level caching
6. **Database Query Caching** -- Materialized views, query result caching, connection pooling, and read replicas
7. **Cache Invalidation** -- TTL-based, event-driven, tag-based, versioned keys, and hybrid invalidation strategies
8. **Distributed Caching** -- Cache topology, replication, partitioning, consistency models, and failure handling

## Routing Logic

| Request type | Load reference |
|---|---|
| HTTP headers, CDN, Cache-Control, ETags, browser caching | [references/http-and-cdn-caching.md](references/http-and-cdn-caching.md) |
| Redis, in-memory, LRU/LFU, eviction, two-tier cache | [references/application-level-caching.md](references/application-level-caching.md) |
| SWR, TanStack Query, service workers, browser storage | [references/frontend-data-caching.md](references/frontend-data-caching.md) |
| Prompt caching, semantic caching, LLM cost reduction, agentic caching | [references/llm-and-agentic-caching.md](references/llm-and-agentic-caching.md) |
| Materialized views, query caching, database read optimization | [references/database-query-caching.md](references/database-query-caching.md) |
| TTL, event-driven, tag-based, versioned invalidation strategies | [references/cache-invalidation.md](references/cache-invalidation.md) |

## Core Principles

### 1. Cache Strategically, Not Universally

Not everything should be cached. Cache data that is read frequently, expensive to compute, tolerant of brief staleness, and unlikely to change between reads. Caching mutable, low-read data adds complexity without benefit.

**Decision test:** If the data is read 10x more than it is written and a few seconds of staleness is acceptable, it is a strong caching candidate.

### 2. Choose the Right Caching Pattern

| Pattern | How it works | Best for |
|---------|-------------|----------|
| **Cache-aside** | App checks cache, on miss reads DB, writes to cache | General purpose; simple, widely understood |
| **Read-through** | Cache itself loads from DB on miss | Frameworks with cache-provider abstraction |
| **Write-through** | Writes go to cache and DB synchronously | Strong consistency requirements |
| **Write-behind** | Writes go to cache, async flush to DB | Write-heavy workloads; eventual consistency OK |
| **Refresh-ahead** | Cache proactively refreshes before expiry | Predictable access patterns; low-latency reads |

**Default recommendation:** Start with cache-aside. It is the simplest, most portable, and gives the application full control over caching behavior.

### 3. Choose the Right Eviction Policy

| Policy | Evicts | Best when |
|--------|--------|-----------|
| **LRU** (Least Recently Used) | Oldest-accessed entries | Recency predicts future access |
| **LFU** (Least Frequently Used) | Least-accessed entries | Popularity predicts future access (skewed workloads) |
| **TTL** (Time-To-Live) | Expired entries | Data has a known freshness window |
| **Random** | Random entries | Uniform access distribution |

**Default recommendation:** Use `allkeys-lru` for Redis. It handles the common case (Pareto distribution) well. Add TTL as a safety net on all entries.

### 4. Layer Your Caches

Apply caching at multiple layers, each serving a different purpose:

```
Browser Cache -> CDN Edge -> API Gateway -> App In-Memory -> Redis -> Database
```

- **Browser cache** -- Eliminates network requests entirely for returning users
- **CDN edge** -- Serves static and semi-static content from the nearest PoP
- **Application in-memory** -- Sub-millisecond reads for hot data (bounded by process memory)
- **Distributed cache (Redis)** -- Shared across instances, survives restarts, millisecond reads
- **Database** -- Source of truth; materialized views and query caching reduce load

### 5. Invalidation is Harder Than Caching

"There are only two hard things in Computer Science: cache invalidation and naming things." Start with TTL-based expiration and layer on event-driven invalidation for critical data paths. Never rely solely on manual invalidation.

### 6. Agentic Workflow Considerations

When an AI agent is implementing or reasoning about caching:

- **Identify the consistency requirement first** -- Ask whether the consumer tolerates stale data and for how long before choosing a strategy.
- **Prefer explicit TTLs over unbounded caching** -- Every cache entry should have an expiration. Zombie entries from missing invalidation logic are a common production incident.
- **Consider cache warming on deploy** -- Cold caches after deployment cause latency spikes. Pre-populate critical entries.
- **Log cache hit/miss ratios** -- If hit ratio drops below 80%, the cache may be poorly sized or the key space too large.
- **Test invalidation paths** -- Cache bugs are often invisible until stale data causes user-facing issues. Include invalidation in integration tests.
- **When caching LLM responses** -- Evaluate whether prompt caching (provider-level, exact prefix match) or semantic caching (application-level, similarity match) is appropriate. Prompt caching is cheaper and simpler; semantic caching handles paraphrased queries.

## Workflow

1. **Identify** -- Determine what data is a caching candidate (high read-to-write ratio, expensive to compute, tolerant of staleness).
2. **Select layer** -- Choose the appropriate cache layer(s): HTTP, CDN, in-memory, distributed, or database.
3. **Select pattern** -- Pick a caching pattern (cache-aside, read-through, write-through, write-behind) based on consistency needs.
4. **Configure eviction** -- Set eviction policy (LRU/LFU), max memory, and TTL values.
5. **Implement invalidation** -- Define how and when cached data is invalidated (TTL, event-driven, tag-based, versioned keys).
6. **Instrument** -- Add metrics for cache hit/miss ratio, latency, eviction rate, and memory usage.
7. **Test** -- Verify cache behavior under load, test invalidation correctness, and simulate cache failures.
8. **Monitor** -- Track hit ratios in production; tune TTLs and cache sizes based on observed patterns.

## Quick Reference

### Cache-Aside Pattern (Most Common)

```typescript
async function getUser(userId: string): Promise<User> {
  // 1. Check cache
  const cached = await redis.get(`user:${userId}`);
  if (cached) return JSON.parse(cached);

  // 2. Cache miss -- read from database
  const user = await db.users.findById(userId);
  if (!user) throw new NotFoundError('User not found');

  // 3. Populate cache with TTL
  await redis.set(`user:${userId}`, JSON.stringify(user), 'EX', 300); // 5 min TTL

  return user;
}

async function updateUser(userId: string, data: Partial<User>): Promise<User> {
  // 1. Update database (source of truth)
  const user = await db.users.update(userId, data);

  // 2. Invalidate cache
  await redis.del(`user:${userId}`);

  return user;
}
```

### HTTP Cache-Control Cheat Sheet

```
# Static assets (fingerprinted filenames)
Cache-Control: public, max-age=31536000, immutable

# HTML pages
Cache-Control: no-cache
ETag: "abc123"

# API responses (short-lived, revalidatable)
Cache-Control: private, max-age=0, must-revalidate
ETag: "v2-abc123"

# API responses (CDN-friendly)
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60

# Sensitive data (never cache)
Cache-Control: no-store
```

### TTL Guidelines

| Data type | Suggested TTL | Rationale |
|-----------|--------------|-----------|
| Static assets (versioned) | 1 year (immutable) | Filename changes on content change |
| User profile | 5-15 minutes | Moderate change frequency |
| Product catalog | 1-5 minutes | Balances freshness and performance |
| Session data | Match session timeout | Must not outlive session |
| API rate limit counters | Window duration | Must be exact |
| LLM prompt cache | 5 min (Anthropic default) | Cost vs. freshness tradeoff |
| Search results | 30-60 seconds | High change frequency |
| Configuration/feature flags | 30-60 seconds | Must propagate quickly |

### Cache Key Design

```
# Pattern: {entity}:{identifier}:{optional-variant}
user:usr_123
user:usr_123:profile
product:prod_456:en-US
search:sha256(query_params)
api:v2:users:list:page=1&limit=20

# Rules:
# - Use prefixed IDs for entity type clarity
# - Include locale/version when responses vary
# - Hash complex query parameters
# - Keep keys under 512 bytes
# - Use colons as delimiters (Redis convention)
```

### Common Anti-Patterns

| Avoid | Instead |
|-------|---------|
| Caching without TTL | Always set a TTL, even a long one, as a safety net |
| Caching mutable data with no invalidation | Implement event-driven invalidation for writes |
| Using object serialization for cache keys | Use deterministic string keys with consistent ordering |
| Storing entire objects when only fields are needed | Cache only the fields that are read |
| Unbounded in-memory cache | Set max size with LRU/LFU eviction |
| Cache stampede on expiration | Use locks, jitter, or stale-while-revalidate |
| Ignoring cache failures | Degrade gracefully; fall through to source of truth |
| Same TTL for all data types | Tune TTL per data type based on change frequency |

### Cache Stampede Prevention

```typescript
// Mutex/lock pattern to prevent thundering herd
async function getWithLock(key: string, fetchFn: () => Promise<string>): Promise<string> {
  const cached = await redis.get(key);
  if (cached) return cached;

  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 10, 'NX');

  if (acquired) {
    try {
      const value = await fetchFn();
      await redis.set(key, value, 'EX', 300);
      return value;
    } finally {
      await redis.del(lockKey);
    }
  }

  // Another process holds the lock; wait and retry
  await sleep(50);
  return getWithLock(key, fetchFn);
}
```

## Checklist

Before shipping a caching implementation, verify:

- [ ] Caching candidates identified (high read:write ratio, expensive, staleness-tolerant)
- [ ] Caching pattern selected and documented (cache-aside, read-through, write-through, write-behind)
- [ ] TTL set on every cache entry (no unbounded entries)
- [ ] Eviction policy configured (LRU/LFU with max memory limit)
- [ ] Cache invalidation strategy implemented and tested
- [ ] Cache key design is deterministic, namespaced, and under 512 bytes
- [ ] Cache stampede prevention in place (locks, jitter, or stale-while-revalidate)
- [ ] Graceful degradation on cache failure (falls through to source of truth)
- [ ] Cache hit/miss ratio instrumented and alerted (target > 80% hit ratio)
- [ ] HTTP Cache-Control headers set appropriately for each response type
- [ ] Static assets served with immutable + long max-age + fingerprinted filenames
- [ ] Sensitive data excluded from caching (no-store on PII, auth tokens)
- [ ] Cache warming strategy for cold starts / deployments considered
- [ ] Serialization format chosen (JSON for debuggability, MessagePack/Protobuf for performance)
- [ ] Load tested with cache cold, warm, and under invalidation pressure

## When to Escalate

- **Distributed consistency requirements** -- If the system requires strong consistency across cache nodes (not just eventual), consult with the architecture team. Distributed cache coherence protocols add significant complexity.
- **Cache infrastructure sizing** -- When Redis memory exceeds available RAM, data partitioning (clustering) and eviction tuning require infrastructure expertise. Estimate working set size before provisioning.
- **Multi-region cache replication** -- Cross-region cache replication introduces latency tradeoffs and conflict resolution challenges. Requires infrastructure and networking review.
- **Cache-related data incidents** -- If stale cached data causes user-facing data integrity issues (e.g., showing another user's data, stale financial data), treat as a severity-1 incident and involve the platform team.
- **LLM caching cost optimization** -- When prompt caching savings plateau and semantic caching is under consideration, evaluate embedding model costs, vector DB infrastructure, and cache hit quality thresholds with the ML platform team.
- **Framework-level caching abstractions** -- If the framework provides built-in caching (e.g., Next.js ISR, Rails fragment caching), prefer framework conventions over custom implementations and consult framework documentation.
