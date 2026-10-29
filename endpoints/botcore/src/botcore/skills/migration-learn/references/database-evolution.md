# Database Schema Evolution Reference

## Expand-Contract Pattern

The expand-contract pattern (also called parallel change) executes breaking schema changes in multiple non-breaking steps. Each step is independently deployable and reversible.

### The Three Phases

```
Phase 1: EXPAND           Phase 2: MIGRATE          Phase 3: CONTRACT
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ old_col │new_col│       │ old_col │new_col│       │         │new_col│
│─────────│───────│       │─────────│───────│       │         │───────│
│  data   │ NULL  │       │  data   │ data  │       │         │ data  │
│  data   │ NULL  │       │  data   │ data  │       │         │ data  │
└─────────────────┘       └─────────────────┘       └─────────────────┘
Add new column             Backfill + dual write     Drop old column
```

### Detailed Steps

#### Phase 1: Expand

1. **Add the new column/table** -- Create the new structure alongside the old one. Use `ALTER TABLE ADD COLUMN` with a default or nullable constraint.
2. **Deploy dual-write code** -- Update the application to write to both old and new columns on every write operation.
3. **Verify writes** -- Confirm that new writes populate both columns correctly.

```sql
-- Step 1: Add new column
ALTER TABLE users ADD COLUMN email_normalized VARCHAR(255);

-- Application code now writes to both:
-- UPDATE users SET email = ?, email_normalized = LOWER(?) WHERE id = ?
```

#### Phase 2: Migrate

4. **Backfill existing data** -- Run a migration script that copies/transforms data from the old column to the new column for all existing rows.
5. **Verify backfill** -- Run a reconciliation query to confirm all rows have been migrated.
6. **Switch reads** -- Update the application to read from the new column instead of the old one.

```sql
-- Step 4: Backfill
UPDATE users SET email_normalized = LOWER(email)
WHERE email_normalized IS NULL;

-- Step 5: Verify
SELECT COUNT(*) FROM users WHERE email_normalized IS NULL;
-- Should return 0
```

#### Phase 3: Contract

7. **Stop writing to old column** -- Deploy code that only writes to the new column.
8. **Wait** -- Keep the old column for 24-72 hours as a safety net. If issues are found, reads can be reverted to the old column.
9. **Stop reading old column** -- Remove all references to the old column from application code.
10. **Drop old column** -- Remove the old column from the schema.

```sql
-- Step 10: Drop old column (only after all code is updated)
ALTER TABLE users DROP COLUMN email;

-- Optionally rename
ALTER TABLE users RENAME COLUMN email_normalized TO email;
```

### Timing Between Phases

| Transition | Minimum wait | Why |
|---|---|---|
| Expand -> Migrate | Until dual-write is deployed to all instances | Ensures no writes are lost |
| Migrate -> Contract (stop writes) | Until reads are switched and verified | Ensures no reads depend on old column |
| Contract (stop writes) -> Drop | 24-72 hours | Safety window for rollback |

## Renaming a Column

Renaming is a common migration that demonstrates expand-contract:

```
1. Add new column (new_name)
2. Deploy code that writes to both old_name and new_name
3. Backfill: UPDATE table SET new_name = old_name WHERE new_name IS NULL
4. Deploy code that reads from new_name
5. Deploy code that stops writing to old_name
6. Wait 24-48 hours
7. Drop old_name column
```

Total deployments required: 4 (one per code change)

## Changing a Column Type

```
1. Add new column with the target type
2. Deploy code that writes to both columns (converting type on write)
3. Backfill: convert and copy all existing data
4. Add any new constraints or indexes on the new column
5. Switch reads to new column
6. Stop writes to old column
7. Drop old column
```

### Example: Integer to UUID

```sql
-- Step 1
ALTER TABLE orders ADD COLUMN order_uuid UUID DEFAULT gen_random_uuid();

-- Step 3: Backfill
UPDATE orders SET order_uuid = gen_random_uuid() WHERE order_uuid IS NULL;

-- Step 4: Index
CREATE UNIQUE INDEX idx_orders_uuid ON orders(order_uuid);

-- Step 7: After all code migrated
ALTER TABLE orders DROP COLUMN order_id;
ALTER TABLE orders RENAME COLUMN order_uuid TO order_id;
```

## Splitting a Table

When a table grows too large or serves multiple bounded contexts:

```
1. Create the new table with the extracted columns
2. Deploy code that writes to both tables
3. Backfill the new table from the old table
4. Add foreign keys or references as needed
5. Switch reads to join or query the new table
6. Stop writing extracted columns to the old table
7. Drop extracted columns from the old table
```

## Adding a NOT NULL Constraint

Cannot add NOT NULL directly if existing rows have NULLs:

```sql
-- Step 1: Add column as nullable with default
ALTER TABLE products ADD COLUMN sku VARCHAR(50) DEFAULT '';

-- Step 2: Backfill
UPDATE products SET sku = CONCAT('LEGACY-', id) WHERE sku = '' OR sku IS NULL;

-- Step 3: Verify
SELECT COUNT(*) FROM products WHERE sku IS NULL OR sku = '';

-- Step 4: Add constraint (after all rows populated)
ALTER TABLE products ALTER COLUMN sku SET NOT NULL;
```

## Index Management

### Adding Indexes Without Downtime

Large tables can lock for extended periods during index creation. Use concurrent index creation:

```sql
-- PostgreSQL
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);

-- MySQL (InnoDB supports online DDL)
ALTER TABLE users ADD INDEX idx_email (email), ALGORITHM=INPLACE, LOCK=NONE;
```

### Dropping Indexes Safely

1. Remove the index from query hints or forced index usage in application code
2. Monitor query performance for 24 hours
3. Drop the index

## Migration Tooling

### Schema Migration Frameworks

| Tool | Language/Platform | Key feature |
|---|---|---|
| Flyway | Java, SQL | Versioned SQL scripts, baseline support |
| Liquibase | Java, XML/SQL | Changelog-based, rollback generation |
| Alembic | Python (SQLAlchemy) | Auto-generated migrations from models |
| Knex | Node.js | JS-based migrations, batch support |
| Prisma Migrate | Node.js (Prisma) | Schema-diff migrations from Prisma schema |
| pgroll | PostgreSQL | Automated expand-contract with versioned schemas |
| Django Migrations | Python (Django) | Auto-detected from model changes |
| Entity Framework | .NET (C#) | Code-first migrations from DbContext |
| Diesel | Rust | SQL-based migrations with type safety |
| Goose | Go | SQL or Go-based migrations |

### pgroll: Automated Expand-Contract

pgroll is a tool that automates the expand-contract pattern for PostgreSQL:

```bash
# Define migration in JSON
cat > migration.json << 'EOF'
{
  "name": "rename_email_column",
  "operations": [
    {
      "rename_column": {
        "table": "users",
        "from": "email",
        "to": "email_address"
      }
    }
  ]
}
EOF

# Start migration (creates versioned schema)
pgroll start migration.json

# Complete migration (drops old schema version)
pgroll complete
```

pgroll handles:
- Creating versioned schema views
- Dual-write triggers between old and new schemas
- Backfill of existing data
- Cleanup of old schema version on completion

## Anti-Patterns

| Anti-pattern | Problem | Correct approach |
|---|---|---|
| Drop column then deploy code | Application crashes reading missing column | Deploy code first, then drop column |
| Add NOT NULL without default | Existing rows violate constraint | Add nullable, backfill, then add constraint |
| Rename column in one step | Application using old name crashes | Expand-contract with 4 deployments |
| Run backfill during peak hours | Locks tables, degrades performance | Run during low-traffic window with batching |
| Skip verification step | Corrupt or missing data goes unnoticed | Always reconcile after backfill |
| Mix schema and data changes | Rollback becomes impossible | Separate schema DDL from data DML migrations |

## Backfill Best Practices

### Batched Updates

Never update all rows in a single transaction -- this locks the table and can exhaust resources:

```sql
-- BAD: Single massive update
UPDATE users SET email_normalized = LOWER(email);

-- GOOD: Batched update
DO $$
DECLARE
  batch_size INT := 1000;
  affected INT;
BEGIN
  LOOP
    UPDATE users
    SET email_normalized = LOWER(email)
    WHERE email_normalized IS NULL
    AND id IN (
      SELECT id FROM users
      WHERE email_normalized IS NULL
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    COMMIT;
    PERFORM pg_sleep(0.1);  -- Brief pause to reduce load
  END LOOP;
END $$;
```

### Progress Tracking

For large backfills, track progress:

```typescript
async function backfillBatched(
  batchSize: number,
  onProgress: (processed: number, total: number) => void
): Promise<void> {
  const total = await db.query("SELECT COUNT(*) FROM users WHERE email_normalized IS NULL");
  let processed = 0;

  while (true) {
    const result = await db.query(`
      UPDATE users SET email_normalized = LOWER(email)
      WHERE id IN (
        SELECT id FROM users WHERE email_normalized IS NULL LIMIT $1
      ) RETURNING id
    `, [batchSize]);

    if (result.rowCount === 0) break;
    processed += result.rowCount;
    onProgress(processed, total);
    await sleep(100); // Throttle
  }
}
```

## Rollback Strategy

Every schema migration should have a documented rollback plan:

| Migration type | Rollback approach |
|---|---|
| Add column | Drop column (safe if no reads depend on it) |
| Add index | Drop index |
| Rename column | Reverse rename (if within contract window) |
| Change type | Reverse type change (may lose precision) |
| Drop column | **Cannot rollback** -- data is gone. Requires backup restore |
| Drop table | **Cannot rollback** -- requires backup restore |

For irreversible migrations (drops), always:
1. Take a backup before executing
2. Require explicit sign-off from a senior engineer or DBA
3. Keep the backup available for at least 30 days
