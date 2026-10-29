# Indexing and Query Optimization

Strategies for database indexing, query performance tuning, and monitoring.

---

## Index Types

### B-Tree Index (Default)

The workhorse index for equality and range queries.

```sql
-- Single column
CREATE INDEX idx_users_email ON users(email);

-- Composite (column order matters: leftmost prefix rule)
CREATE INDEX idx_posts_author_date ON posts(author_id, created_at DESC);

-- Unique
CREATE UNIQUE INDEX uq_users_email ON users(email);
```

**Column order in composite indexes**: The index is usable for queries that filter on a *leftmost prefix* of the indexed columns.

```sql
-- Index: (author_id, created_at, published)
-- Usable for:
WHERE author_id = 1                                    -- yes
WHERE author_id = 1 AND created_at > '2025-01-01'     -- yes
WHERE author_id = 1 AND created_at > '2025-01-01' AND published = true  -- yes

-- NOT usable for:
WHERE created_at > '2025-01-01'                        -- no (skips first column)
WHERE published = true                                 -- no (skips first two columns)
```

### Covering Index

Includes all columns needed by a query so the database never reads the table.

```sql
-- Query: SELECT email, name FROM users WHERE email = ?
CREATE INDEX idx_users_email_covering ON users(email) INCLUDE (name);
```

### Partial Index (PostgreSQL)

Index only rows matching a condition. Smaller, faster, more targeted.

```sql
-- Only index active users
CREATE INDEX idx_users_active ON users(email) WHERE deleted_at IS NULL;

-- Only index unprocessed orders
CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending';
```

### Expression Index

Index computed values.

```sql
-- Case-insensitive email lookup
CREATE INDEX idx_users_email_lower ON users(lower(email));

-- JSONB field extraction
CREATE INDEX idx_settings_theme ON user_settings((settings->>'theme'));
```

### GIN / GiST Indexes (PostgreSQL)

```sql
-- Full-text search
CREATE INDEX idx_posts_search ON posts USING gin(to_tsvector('english', title || ' ' || body));

-- JSONB containment queries
CREATE INDEX idx_metadata ON products USING gin(metadata jsonb_path_ops);

-- Array containment
CREATE INDEX idx_tags ON posts USING gin(tags);

-- Spatial / ltree
CREATE INDEX idx_locations ON places USING gist(coordinates);
CREATE INDEX idx_categories_path ON categories USING gist(path);
```

---

## Query Optimization Patterns

### 1. Use EXPLAIN ANALYZE

```sql
-- PostgreSQL
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT ...;

-- MySQL
EXPLAIN ANALYZE SELECT ...;
```

**Key things to look for**:
- `Seq Scan` on large tables (may need an index)
- `Nested Loop` with large row counts (consider Hash Join)
- `Sort` without index (consider adding index with matching sort order)
- High `actual rows` vs `estimated rows` (stale statistics)

### 2. Avoid Function Wrapping on Indexed Columns

```sql
-- BAD: Cannot use index on created_at
SELECT * FROM orders WHERE YEAR(created_at) = 2025;

-- GOOD: Range query uses index
SELECT * FROM orders WHERE created_at >= '2025-01-01' AND created_at < '2026-01-01';
```

### 3. Avoid SELECT *

```sql
-- BAD: Fetches all columns, prevents covering index usage
SELECT * FROM users WHERE email = 'jane@example.com';

-- GOOD: Only fetch needed columns
SELECT id, name, email FROM users WHERE email = 'jane@example.com';
```

### 4. Pagination Patterns

```sql
-- BAD: OFFSET-based pagination degrades with large offsets
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 10000;

-- GOOD: Cursor-based pagination (keyset pagination)
SELECT * FROM posts
WHERE created_at < $last_seen_created_at
ORDER BY created_at DESC
LIMIT 20;

-- GOOD: With composite cursor for tie-breaking
SELECT * FROM posts
WHERE (created_at, id) < ($last_created_at, $last_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

### 5. Batch Operations

```sql
-- BAD: N+1 queries in a loop
-- for each user_id: SELECT * FROM posts WHERE author_id = ?

-- GOOD: Batch fetch
SELECT * FROM posts WHERE author_id = ANY($1::bigint[]);

-- GOOD: Use JOIN for related data
SELECT u.*, p.title, p.created_at
FROM users u
JOIN posts p ON p.author_id = u.id
WHERE u.id = ANY($1::bigint[]);
```

### 6. Efficient Counting

```sql
-- BAD: Exact count on large table (full table scan)
SELECT COUNT(*) FROM posts WHERE published = true;

-- GOOD: Approximate count (PostgreSQL)
SELECT reltuples::bigint FROM pg_class WHERE relname = 'posts';

-- GOOD: Maintain a counter cache
-- Update a `published_post_count` column on the parent when posts change
```

### 7. Upsert Pattern

```sql
-- PostgreSQL
INSERT INTO user_settings (user_id, key, value)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, key)
DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- MySQL
INSERT INTO user_settings (user_id, `key`, value)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW();
```

---

## Index Strategy Decision Framework

```
Is this column in a WHERE, JOIN, or ORDER BY clause?
├── No  → Do NOT index
├── Yes → Is the table small (< 1000 rows)?
│   ├── Yes → Skip index (sequential scan is fine)
│   └── No  → Continue
│       ├── Is column high cardinality (many distinct values)?
│       │   ├── Yes → B-tree index (good selectivity)
│       │   └── No  → Consider partial index or skip
│       ├── Is column used in text search?
│       │   └── Yes → GIN with tsvector
│       ├── Is column JSONB?
│       │   └── Yes → GIN with jsonb_path_ops
│       ├── Is column an array?
│       │   └── Yes → GIN
│       └── Is it a composite condition?
│           └── Yes → Composite B-tree (most selective column first)
```

---

## Monitoring and Maintenance

### Identify Slow Queries

```sql
-- PostgreSQL: enable and query pg_stat_statements
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;

-- Find missing indexes (PostgreSQL)
SELECT relname, seq_scan, idx_scan,
  seq_scan - idx_scan AS too_many_seq_scans
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan AND reltuples > 10000
ORDER BY too_many_seq_scans DESC;
```

### Find Unused Indexes

```sql
-- PostgreSQL: indexes with zero scans
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE 'uq_%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Statistics Maintenance

```sql
-- PostgreSQL: update statistics for query planner
ANALYZE users;
ANALYZE posts;

-- Reindex if index bloat is suspected
REINDEX INDEX CONCURRENTLY idx_posts_author_date;
```

---

## Performance Anti-Patterns

| Anti-Pattern | Impact | Fix |
|-------------|--------|-----|
| Missing index on FK columns | Slow joins, slow cascading deletes | Index every foreign key |
| Too many indexes | Slow writes, wasted storage | Remove unused indexes, consolidate overlapping ones |
| OFFSET pagination on large datasets | Linear degradation with page depth | Cursor/keyset pagination |
| N+1 query pattern | Latency scales linearly with result count | Batch queries, JOINs, or DataLoader |
| SELECT * | Prevents covering indexes, wastes bandwidth | Select only needed columns |
| Functions on indexed columns in WHERE | Bypasses index | Rewrite as range or use expression index |
| Stale statistics | Bad query plans | Schedule regular ANALYZE |
| Index on low-cardinality columns | Index scan slower than seq scan | Partial index or skip |
