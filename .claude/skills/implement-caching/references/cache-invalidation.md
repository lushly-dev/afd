# Cache Invalidation

TTL-based, event-driven, tag-based, versioned key, and hybrid invalidation strategies for maintaining cache consistency.

## The Invalidation Problem

Cache invalidation is fundamentally about answering: "When cached data changes at the source, how do we ensure consumers stop seeing stale data?" The strategies below trade off between simplicity, consistency, and operational overhead.

---

## Strategy 1: TTL-Based Invalidation

The simplest approach. Every cache entry has an expiration time after which it is automatically removed.

### Implementation

```typescript
// Simple TTL-based caching
await redis.set('product:prod_123', JSON.stringify(product), 'EX', 300); // 5 min TTL

// TTL with jitter to prevent thundering herd
function ttlWithJitter(baseTtl: number, jitterPercent: number = 0.1): number {
  const jitter = baseTtl * jitterPercent;
  return Math.floor(baseTtl + (Math.random() * 2 - 1) * jitter);
}

await redis.set('product:prod_123', JSON.stringify(product), 'EX', ttlWithJitter(300));
```

### When to Use

- Default safety net on all cache entries (even with other strategies)
- Data that changes infrequently and brief staleness is acceptable
- External data where you cannot receive change notifications

### TTL Selection Guide

| Staleness tolerance | TTL range | Example data |
|--------------------|-----------|-------------|
| None (real-time) | Do not cache, or < 5 seconds | Stock prices, live scores |
| Seconds | 10-60 seconds | Search results, product listings |
| Minutes | 1-15 minutes | User profiles, API responses |
| Hours | 1-24 hours | Configuration, reference data |
| Days+ | 1-30 days | Static content, rarely changed settings |

### Pitfalls

- **Too short TTL** -- High miss rate, cache provides little benefit
- **Too long TTL** -- Stale data served for extended periods
- **Same TTL for everything** -- Different data types have different change rates
- **No TTL at all** -- Zombie entries persist forever if invalidation logic has bugs

**Rule of thumb:** Always set a TTL, even a long one. It is your last line of defense against stale data.

---

## Strategy 2: Event-Driven Invalidation

Invalidate cache entries in response to data change events, providing near-real-time consistency.

### Direct Invalidation (Write-Path)

```typescript
// Invalidate on write -- simplest event-driven approach
async function updateProduct(productId: string, data: Partial<Product>): Promise<Product> {
  // 1. Update source of truth
  const product = await db.products.update(productId, data);

  // 2. Invalidate cache immediately
  await redis.del(`product:${productId}`);

  // 3. Optionally invalidate related caches
  await redis.del(`products:category:${product.categoryId}`);
  await redis.del('products:featured');

  return product;
}
```

### Pub/Sub Invalidation (Multi-Instance)

```typescript
// Publisher: broadcast invalidation events
async function publishInvalidation(entity: string, id: string): Promise<void> {
  await redis.publish('cache:invalidate', JSON.stringify({ entity, id }));
}

// Subscriber: listen and invalidate local caches
const subscriber = new Redis();
subscriber.subscribe('cache:invalidate');

subscriber.on('message', (channel, message) => {
  const { entity, id } = JSON.parse(message);

  // Invalidate in-memory (L1) cache
  localCache.delete(`${entity}:${id}`);

  // Invalidate Redis (L2) cache
  redis.del(`${entity}:${id}`);
});
```

### Change Data Capture (CDC)

For systems where writes happen outside your application (direct DB access, migrations):

```typescript
// Debezium-style CDC: listen to database WAL/binlog
// and invalidate caches based on table changes

interface CDCEvent {
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

async function handleCDCEvent(event: CDCEvent): Promise<void> {
  const invalidationMap: Record<string, (event: CDCEvent) => string[]> = {
    'users': (e) => [
      `user:${e.after?.id || e.before?.id}`,
      `users:org:${e.after?.org_id || e.before?.org_id}`,
    ],
    'products': (e) => [
      `product:${e.after?.id || e.before?.id}`,
      `products:category:${e.after?.category_id || e.before?.category_id}`,
      'products:featured',
    ],
    'orders': (e) => [
      `order:${e.after?.id || e.before?.id}`,
      `user:${e.after?.user_id || e.before?.user_id}:orders`,
    ],
  };

  const keysToInvalidate = invalidationMap[event.table]?.(event) ?? [];
  if (keysToInvalidate.length > 0) {
    await redis.del(...keysToInvalidate);
  }
}
```

### When to Use

- Data where staleness is unacceptable (user permissions, inventory, pricing)
- Systems with clear write paths where you control the data mutation
- Microservices architectures using event buses (Kafka, RabbitMQ, SNS)

### Pitfalls

- **Missed events** -- If an invalidation event is lost (network partition, subscriber down), stale data persists until TTL expires. Always pair with TTL as a safety net.
- **Cascading invalidation** -- One write can trigger many cache invalidations. Map dependencies carefully.
- **Ordering** -- Events may arrive out of order. Use version numbers or timestamps to avoid re-caching older data.

---

## Strategy 3: Tag-Based Invalidation

Associate cache entries with tags (labels) so that related entries can be invalidated as a group.

### Implementation

```typescript
class TaggedCache {
  constructor(private redis: Redis) {}

  async set(key: string, value: string, ttl: number, tags: string[]): Promise<void> {
    const pipeline = this.redis.pipeline();

    // Store the value
    pipeline.set(key, value, 'EX', ttl);

    // Associate tags
    for (const tag of tags) {
      pipeline.sadd(`tag:${tag}`, key);
      pipeline.expire(`tag:${tag}`, ttl + 60); // Tag set outlives entries slightly
    }

    await pipeline.exec();
  }

  async invalidateByTag(tag: string): Promise<number> {
    // Get all keys associated with this tag
    const keys = await this.redis.smembers(`tag:${tag}`);
    if (keys.length === 0) return 0;

    // Delete all associated keys and the tag set
    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      pipeline.del(key);
    }
    pipeline.del(`tag:${tag}`);
    await pipeline.exec();

    return keys.length;
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    for (const tag of tags) {
      await this.invalidateByTag(tag);
    }
  }
}

// Usage
const cache = new TaggedCache(redis);

// Cache a product with tags
await cache.set(
  'product:prod_123',
  JSON.stringify(product),
  300,
  ['products', `category:${product.categoryId}`, `brand:${product.brandId}`]
);

// On category update, invalidate all products in that category
await cache.invalidateByTag(`category:cat_456`);

// On brand update, invalidate all products for that brand
await cache.invalidateByTag(`brand:brand_789`);
```

### When to Use

- Data with complex relationships (products belong to categories, brands, collections)
- CMS content where a template change affects many pages
- APIs where a single update should invalidate multiple cached responses

### Pitfalls

- **Tag set growth** -- Tag sets can grow unbounded. Expire them and periodically clean up.
- **Orphaned tags** -- If a cache entry expires via TTL but the tag set still references it, subsequent invalidation attempts harmlessly delete non-existent keys.
- **Performance at scale** -- Invalidating a tag with thousands of associated keys can be slow. Consider batching.

---

## Strategy 4: Versioned Keys

Embed a version number in cache keys. Incrementing the version effectively invalidates all entries under the old version without explicitly deleting them.

### Implementation

```typescript
class VersionedCache {
  constructor(private redis: Redis) {}

  async get(entity: string, id: string): Promise<string | null> {
    const version = await this.getVersion(entity);
    return this.redis.get(`${entity}:v${version}:${id}`);
  }

  async set(entity: string, id: string, value: string, ttl: number): Promise<void> {
    const version = await this.getVersion(entity);
    await this.redis.set(`${entity}:v${version}:${id}`, value, 'EX', ttl);
  }

  async invalidateAll(entity: string): Promise<void> {
    // Increment version -- all old keys become orphaned and expire via TTL
    await this.redis.incr(`version:${entity}`);
  }

  private async getVersion(entity: string): Promise<number> {
    const version = await this.redis.get(`version:${entity}`);
    return version ? parseInt(version, 10) : 1;
  }
}

// Usage
const cache = new VersionedCache(redis);

await cache.set('product', 'prod_123', JSON.stringify(product), 3600);
const cached = await cache.get('product', 'prod_123');

// After a major data migration, invalidate ALL product cache entries
await cache.invalidateAll('product');
// Old entries (v1) become orphaned and expire via TTL
// New entries are written under v2
```

### When to Use

- Bulk invalidation scenarios (schema migration, data import, config change)
- When explicit deletion of thousands of keys is too slow
- Simple global invalidation without tracking individual keys

### Pitfalls

- **Orphaned keys waste memory** -- Old version keys stay in Redis until TTL expires. Set reasonable TTLs.
- **Extra round trip** -- Every cache access requires fetching the current version number. Mitigate by caching the version in-memory with a short TTL.
- **Not for per-key invalidation** -- Versioned keys invalidate all entries for an entity, not individual entries.

---

## Hybrid Strategy (Recommended)

Combine strategies based on data characteristics:

```typescript
// Recommended production setup
class HybridCache {
  // 1. TTL on everything (safety net)
  private defaultTtl = 300;

  // 2. Event-driven for critical data
  async onUserUpdate(userId: string): Promise<void> {
    await redis.del(`user:${userId}`);
    await redis.del(`user:${userId}:permissions`);
    this.publishInvalidation('user', userId);
  }

  // 3. Tag-based for related data
  async onCategoryUpdate(categoryId: string): Promise<void> {
    await this.taggedCache.invalidateByTag(`category:${categoryId}`);
  }

  // 4. Versioned for bulk operations
  async onDataMigration(): Promise<void> {
    await this.versionedCache.invalidateAll('products');
  }
}
```

### Decision Matrix

| Data characteristic | Primary strategy | Backup strategy |
|--------------------|--------------------|-----------------|
| Changes rarely, brief staleness OK | TTL (long) | None needed |
| Changes on user action, staleness not OK | Event-driven | TTL (short) |
| Complex relationships, group invalidation | Tag-based | TTL (medium) |
| Bulk changes, migration, config updates | Versioned keys | TTL (medium) |
| External data, no change notifications | TTL (tuned to source) | Polling |

---

## Testing Cache Invalidation

```typescript
describe('Cache Invalidation', () => {
  it('should serve fresh data after write', async () => {
    // Seed cache
    await cache.set('user:1', JSON.stringify({ name: 'Alice' }), 300);

    // Update via application (triggers invalidation)
    await userService.update('1', { name: 'Bob' });

    // Verify cache returns fresh data (or miss)
    const cached = await cache.get('user:1');
    if (cached) {
      expect(JSON.parse(cached).name).toBe('Bob');
    }
    // If null (cache miss), next read will fetch from DB
  });

  it('should invalidate related caches on write', async () => {
    await cache.set('users:list', JSON.stringify([user1, user2]), 300, ['users']);
    await cache.set('user:1', JSON.stringify(user1), 300, ['users']);

    // Invalidate all user-related caches
    await cache.invalidateByTag('users');

    expect(await cache.get('users:list')).toBeNull();
    expect(await cache.get('user:1')).toBeNull();
  });

  it('should expire entries after TTL', async () => {
    await cache.set('temp', 'value', 1); // 1 second TTL

    expect(await cache.get('temp')).toBe('value');

    await sleep(1500);

    expect(await cache.get('temp')).toBeNull();
  });
});
```
