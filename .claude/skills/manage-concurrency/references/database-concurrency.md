# Database Concurrency

Optimistic and pessimistic locking, connection pool management, and conflict resolution patterns.

---

## Optimistic vs Pessimistic Locking

### Decision Guide

| Factor | Optimistic | Pessimistic |
|--------|-----------|-------------|
| Read-to-write ratio | High reads, few writes | Frequent writes |
| Conflict probability | Low (< 5%) | High (> 5%) |
| Lock duration | No locks held | Locks held during transaction |
| Deadlock risk | None | Moderate to high |
| Retry cost | Must retry on conflict | No retries needed |
| Throughput | Higher when conflicts rare | Higher when conflicts frequent |
| User experience | May fail on save (conflict) | May wait on load (blocking) |

**Default recommendation:** Start with optimistic locking. Switch to pessimistic only when conflict retry rates exceed 5-10%.

---

## Optimistic Locking

The system assumes conflicts are rare. It allows concurrent reads and detects conflicts at write time using a version column.

### TypeScript: Version-Based Optimistic Locking

```typescript
// Schema: add a version column
// CREATE TABLE products (
//   id UUID PRIMARY KEY,
//   name TEXT,
//   price DECIMAL,
//   version INTEGER NOT NULL DEFAULT 0
// );

interface Product {
  id: string;
  name: string;
  price: number;
  version: number;
}

async function updatePrice(
  db: Database,
  productId: string,
  newPrice: number,
  maxRetries: number = 3,
): Promise<Product> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 1. Read current state
    const product = await db.query<Product>(
      'SELECT * FROM products WHERE id = $1',
      [productId],
    );

    // 2. Update with version check
    const result = await db.query<Product>(
      `UPDATE products
       SET price = $1, version = version + 1
       WHERE id = $2 AND version = $3
       RETURNING *`,
      [newPrice, productId, product.version],
    );

    if (result.rowCount > 0) {
      return result.rows[0]; // Success
    }

    // 3. Conflict detected -- retry with fresh data
    if (attempt < maxRetries - 1) {
      // Optional: exponential backoff
      await new Promise(r => setTimeout(r, 50 * Math.pow(2, attempt)));
    }
  }

  throw new Error('Optimistic lock conflict: max retries exceeded');
}
```

### Python: SQLAlchemy Optimistic Locking

```python
from sqlalchemy import Column, Integer, String, Numeric
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(DeclarativeBase):
    pass

class Product(Base):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    price: Mapped[float] = mapped_column(Numeric(10, 2))
    version_id: Mapped[int] = mapped_column(Integer, default=0)

    __mapper_args__ = {
        "version_id_col": version_id,  # SQLAlchemy auto-manages this
    }

# SQLAlchemy automatically checks version on flush
async def update_price(session, product_id: str, new_price: float) -> Product:
    product = await session.get(Product, product_id)
    product.price = new_price
    try:
        await session.commit()
        return product
    except StaleDataError:
        await session.rollback()
        raise ConflictError("Product was modified by another transaction")
```

### ETag-Based Optimistic Locking (API Layer)

```typescript
// Read: Return ETag header
app.get('/products/:id', async (req, res) => {
  const product = await db.getProduct(req.params.id);
  const etag = `"${product.version}"`;
  res.set('ETag', etag);
  res.json(product);
});

// Update: Require If-Match header
app.put('/products/:id', async (req, res) => {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) {
    return res.status(428).json({ error: 'If-Match header required' });
  }

  const expectedVersion = parseInt(ifMatch.replace(/"/g, ''));

  try {
    const updated = await updateWithVersion(
      req.params.id,
      req.body,
      expectedVersion,
    );
    res.set('ETag', `"${updated.version}"`);
    res.json(updated);
  } catch (error) {
    if (error instanceof ConflictError) {
      res.status(409).json({ error: 'Resource was modified' });
    }
  }
});
```

---

## Pessimistic Locking

The system acquires locks before reading, preventing concurrent modifications.

### SQL SELECT FOR UPDATE

```sql
-- Lock the row for the duration of the transaction
BEGIN;
SELECT * FROM accounts WHERE id = 'acct_123' FOR UPDATE;
-- Other transactions trying to read this row with FOR UPDATE will block
UPDATE accounts SET balance = balance - 100 WHERE id = 'acct_123';
COMMIT;
```

### TypeScript: Pessimistic Lock with Timeout

```typescript
async function transferFunds(
  db: Database,
  fromId: string,
  toId: string,
  amount: number,
): Promise<void> {
  // Consistent ordering prevents deadlocks
  const [firstId, secondId] = [fromId, toId].sort();

  await db.transaction(async (tx) => {
    // Lock both accounts in consistent order
    const first = await tx.query(
      'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
      [firstId],
    );
    const second = await tx.query(
      'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
      [secondId],
    );

    const from = fromId === firstId ? first.rows[0] : second.rows[0];
    const to = toId === firstId ? first.rows[0] : second.rows[0];

    if (from.balance < amount) {
      throw new Error('Insufficient funds');
    }

    await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, fromId]);
    await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, toId]);
  });
}
```

### Lock Timeout (PostgreSQL)

```sql
-- Set lock timeout to prevent indefinite waiting
SET lock_timeout = '5s';

BEGIN;
SELECT * FROM accounts WHERE id = 'acct_123' FOR UPDATE;
-- Raises error if lock not acquired within 5 seconds
COMMIT;
```

### SKIP LOCKED (Queue Pattern)

```sql
-- Process queue items without blocking other workers
BEGIN;
SELECT * FROM job_queue
WHERE status = 'pending'
ORDER BY created_at
LIMIT 1
FOR UPDATE SKIP LOCKED;
-- Other workers skip this row and pick the next one

UPDATE job_queue SET status = 'processing' WHERE id = <selected_id>;
COMMIT;
```

```python
# Python: Job queue with SKIP LOCKED
async def claim_next_job(session) -> Job | None:
    result = await session.execute(
        text("""
            SELECT * FROM job_queue
            WHERE status = 'pending'
            ORDER BY priority, created_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        """)
    )
    row = result.fetchone()
    if row:
        await session.execute(
            text("UPDATE job_queue SET status = 'processing' WHERE id = :id"),
            {"id": row.id},
        )
        await session.commit()
        return Job.from_row(row)
    return None
```

---

## Connection Pool Management

### TypeScript: pg Pool Configuration

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Pool sizing
  max: 20,                    // Max connections in pool
  min: 5,                     // Min idle connections
  idleTimeoutMillis: 30_000,  // Close idle connections after 30s
  connectionTimeoutMillis: 5_000,  // Error if connection not available in 5s

  // Statement timeout (prevent runaway queries)
  statement_timeout: 30_000,
});

// Monitor pool health
pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
});
```

### Python: SQLAlchemy Async Pool

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

engine = create_async_engine(
    "postgresql+asyncpg://user:pass@localhost/db",
    pool_size=20,           # Max connections
    max_overflow=5,         # Extra connections allowed beyond pool_size
    pool_timeout=5,         # Seconds to wait for connection
    pool_recycle=3600,      # Recycle connections after 1 hour
    pool_pre_ping=True,     # Verify connections before use
    echo=False,
)

async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Usage
async with async_session() as session:
    async with session.begin():
        result = await session.execute(query)
```

### Pool Sizing Guidelines

| Factor | Guidance |
|--------|----------|
| Default pool size | `CPU cores * 2 + disk spindles` (PostgreSQL recommendation) |
| Web servers | Match to expected concurrent requests (often 10-25) |
| Background workers | 2-5 per worker process |
| Max overflow | 25-50% of pool_size for burst handling |
| Connection timeout | 3-10 seconds (fail fast, don't queue indefinitely) |
| Idle timeout | 30-300 seconds depending on connection cost |

**Warning:** More connections is NOT always better. Each PostgreSQL connection uses ~10MB RAM. Hundreds of connections cause context switching overhead.

---

## Conflict Resolution Strategies

### Last-Writer-Wins (LWW)

```sql
-- Simple but lossy: last write overwrites everything
UPDATE products SET price = 9.99, updated_at = NOW()
WHERE id = 'prod_123';
```

### Merge on Conflict

```typescript
// When conflict detected, merge non-conflicting fields
function mergeConflict(base: Product, theirs: Product, ours: Product): Product {
  const merged: Partial<Product> = {};

  for (const key of Object.keys(base) as (keyof Product)[]) {
    if (ours[key] !== base[key] && theirs[key] === base[key]) {
      merged[key] = ours[key]; // We changed, they didn't
    } else if (theirs[key] !== base[key] && ours[key] === base[key]) {
      merged[key] = theirs[key]; // They changed, we didn't
    } else if (ours[key] !== theirs[key]) {
      throw new ConflictError(`Field ${key} modified by both parties`);
    } else {
      merged[key] = ours[key]; // Same value
    }
  }

  return merged as Product;
}
```

### CRDT-Style Counters

```sql
-- Instead of read-modify-write, use atomic increments
UPDATE products SET stock = stock - 1 WHERE id = 'prod_123' AND stock > 0;
-- No version check needed; the operation is commutative
```

---

## Best Practices

1. **Start optimistic** -- Use version columns by default; switch to pessimistic only when conflict rates are high.
2. **Always use consistent lock ordering** -- Sort resources by ID before locking to prevent deadlocks.
3. **Set lock timeouts** -- Never wait indefinitely for a lock; configure `lock_timeout` in PostgreSQL.
4. **Use SKIP LOCKED for queues** -- It is purpose-built for job queue patterns and prevents worker contention.
5. **Size pools carefully** -- Too small starves the application; too large wastes resources and hurts database performance.
6. **Enable pool pre-ping** -- Detect stale connections before they cause query failures.
7. **Monitor connection usage** -- Track pool exhaustion, wait times, and connection lifecycle metrics.
8. **Use advisory locks for application-level coordination** -- `pg_advisory_lock()` for cross-transaction coordination without row locking.
