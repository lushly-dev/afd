# Database Query Caching

Materialized views, query result caching, read replicas, and connection pooling for database performance optimization.

## Materialized Views

A materialized view stores the precomputed result of a query as a physical table, trading storage for read performance on expensive joins and aggregations.

### When to Use Materialized Views

| Use when | Avoid when |
|----------|-----------|
| Expensive aggregations run frequently | Data must be real-time fresh |
| Join-heavy queries with stable underlying data | Underlying tables change very frequently |
| Dashboard and reporting queries | Storage is severely constrained |
| Read-heavy workloads (high read:write ratio) | Write-heavy workloads |

### PostgreSQL Materialized Views

```sql
-- Create a materialized view for an expensive aggregation
CREATE MATERIALIZED VIEW daily_sales_summary AS
SELECT
    date_trunc('day', created_at) AS sale_date,
    product_id,
    COUNT(*) AS total_orders,
    SUM(amount) AS total_revenue,
    AVG(amount) AS avg_order_value
FROM orders
WHERE status = 'completed'
GROUP BY date_trunc('day', created_at), product_id;

-- Create indexes on the materialized view for fast lookups
CREATE INDEX idx_daily_sales_date ON daily_sales_summary (sale_date);
CREATE INDEX idx_daily_sales_product ON daily_sales_summary (product_id);

-- Refresh the materialized view (blocking: locks reads during refresh)
REFRESH MATERIALIZED VIEW daily_sales_summary;

-- Refresh concurrently (non-blocking: requires a unique index)
CREATE UNIQUE INDEX idx_daily_sales_unique
    ON daily_sales_summary (sale_date, product_id);

REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales_summary;
```

### Refresh Strategies

| Strategy | How | Best for |
|----------|-----|----------|
| **Manual refresh** | Trigger via cron or application code | Infrequent updates, batch processing |
| **Scheduled refresh** | pg_cron or external scheduler | Periodic reports (hourly, daily) |
| **Event-driven refresh** | Trigger refresh on data change events | Near-real-time freshness needs |
| **Incremental refresh** | Update only changed rows (custom logic) | Large views with frequent small changes |

```sql
-- Scheduled refresh using pg_cron
SELECT cron.schedule('refresh_sales', '0 * * * *',  -- Every hour
    'REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales_summary');

-- Event-driven refresh using triggers (be careful with performance)
CREATE OR REPLACE FUNCTION refresh_sales_on_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Debounce: only refresh if last refresh was > 5 minutes ago
    IF NOT EXISTS (
        SELECT 1 FROM pg_stat_user_tables
        WHERE relname = 'daily_sales_summary'
        AND last_analyze > NOW() - INTERVAL '5 minutes'
    ) THEN
        REFRESH MATERIALIZED VIEW CONCURRENTLY daily_sales_summary;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

### Freshness Contract

Frame materialized view freshness as a contract:

```
"This dashboard shows data that is at most 1 hour old."
```

- Document the refresh interval for consumers
- Display "Last updated: {timestamp}" in UIs backed by materialized views
- Monitor refresh duration and alert if it exceeds expected time

---

## Application-Level Query Caching

### Cache Query Results in Redis

```typescript
class QueryCache {
  constructor(
    private redis: Redis,
    private db: Database,
    private defaultTtl: number = 300,
  ) {}

  async query<T>(sql: string, params: unknown[], options?: {
    ttl?: number;
    tags?: string[];
    key?: string;
  }): Promise<T[]> {
    const cacheKey = options?.key || this.buildKey(sql, params);

    // Check cache
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Execute query
    const result = await this.db.query<T>(sql, params);

    // Cache result
    const ttl = options?.ttl ?? this.defaultTtl;
    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', ttl);

    // Store tag associations for group invalidation
    if (options?.tags) {
      for (const tag of options.tags) {
        await this.redis.sadd(`tag:${tag}`, cacheKey);
        await this.redis.expire(`tag:${tag}`, ttl + 60);
      }
    }

    return result;
  }

  async invalidateByTag(tag: string): Promise<void> {
    const keys = await this.redis.smembers(`tag:${tag}`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
      await this.redis.del(`tag:${tag}`);
    }
  }

  private buildKey(sql: string, params: unknown[]): string {
    const hash = createHash('sha256')
      .update(sql + JSON.stringify(params))
      .digest('hex')
      .slice(0, 16);
    return `query:${hash}`;
  }
}

// Usage
const cache = new QueryCache(redis, db);

const users = await cache.query<User>(
  'SELECT * FROM users WHERE org_id = $1 AND active = true',
  [orgId],
  { ttl: 300, tags: ['users', `org:${orgId}`] }
);

// On user update, invalidate related caches
await cache.invalidateByTag(`org:${orgId}`);
```

### ORM-Level Caching

```typescript
// Prisma with Redis caching middleware
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient().$extends({
  query: {
    user: {
      async findUnique({ args, query }) {
        const cacheKey = `user:${args.where.id}`;
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const result = await query(args);
        if (result) {
          await redis.set(cacheKey, JSON.stringify(result), 'EX', 300);
        }
        return result;
      },
    },
  },
});
```

---

## Read Replicas

Distribute read load across database replicas:

```typescript
// Connection configuration for read replicas
const writeDb = new Pool({
  host: 'primary.db.example.com',
  port: 5432,
  database: 'app',
  max: 20,
});

const readDb = new Pool({
  host: 'replica.db.example.com',
  port: 5432,
  database: 'app',
  max: 50,   // More connections for reads
});

// Route queries by type
class DatabaseRouter {
  async query<T>(sql: string, params: unknown[], options?: { write?: boolean }): Promise<T[]> {
    const pool = options?.write ? writeDb : readDb;
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await writeDb.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
```

**Replication lag considerations:**
- Read-after-write consistency: After a write, read from primary for a short window (1-2s) before falling back to replica
- Monitor replication lag; alert if it exceeds acceptable threshold
- For critical reads requiring freshness, always use the primary

---

## Connection Pooling

### Application-Level Pooling

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: 'db.example.com',
  port: 5432,
  database: 'app',
  user: 'app_user',
  password: process.env.DB_PASSWORD,
  max: 20,                    // Max connections in pool
  min: 5,                     // Min idle connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail if connection not available in 5s
  maxUses: 7500,              // Close connection after N uses (prevent leaks)
});

// Monitor pool health
setInterval(() => {
  console.log({
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 10000);
```

### External Connection Poolers

For serverless or high-connection environments, use an external pooler:

| Tool | Protocol | Best for |
|------|----------|----------|
| **PgBouncer** | PostgreSQL | High connection count, serverless |
| **PgCat** | PostgreSQL | Load balancing, multi-tenant |
| **ProxySQL** | MySQL | Read/write splitting, query caching |

```
# PgBouncer configuration
[databases]
app = host=primary.db.example.com port=5432 dbname=app

[pgbouncer]
pool_mode = transaction       # Release connection after each transaction
max_client_conn = 1000        # Max client connections
default_pool_size = 20        # Connections per user/database pair
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
server_idle_timeout = 600
```

**Pool mode comparison:**

| Mode | Releases connection | Best for |
|------|-------------------|----------|
| `session` | On client disconnect | Long-lived connections, prepared statements |
| `transaction` | After each transaction | Most web applications (recommended) |
| `statement` | After each statement | Simple queries only; no multi-statement transactions |

---

## Caching Strategy Selection by Query Type

| Query type | Caching approach | TTL | Invalidation |
|-----------|-----------------|-----|--------------|
| Dashboard aggregations | Materialized view | 15-60 min | Scheduled refresh |
| User profile lookup | Redis cache-aside | 5-15 min | Event-driven on update |
| Search results | Redis with sorted sets | 30-60 sec | TTL-based |
| Configuration/settings | In-memory (process) | 30-60 sec | Event-driven or TTL |
| Session data | Redis | Session timeout | On logout/expiry |
| Rate limit counters | Redis INCR with EXPIRE | Window duration | Automatic TTL |
| Expensive joins | Materialized view or Redis | Minutes to hours | Tag-based invalidation |
| Reporting queries | Materialized view | Hours | Scheduled refresh |
