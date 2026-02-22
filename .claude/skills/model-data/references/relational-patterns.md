# Relational Database Patterns

Schema design patterns, normalization strategies, and relational modeling best practices.

---

## Normalization Forms

### When to Normalize (OLTP / Transactional Systems)

- Data integrity is paramount (banking, healthcare, logistics)
- Write-heavy workloads where update anomalies are costly
- Schema needs to evolve frequently
- Storage efficiency matters
- Canonical data store that feeds downstream systems

### When to Denormalize (OLAP / Analytical Systems)

- Read-heavy dashboards and reporting
- Real-time query performance is critical
- ML feature stores requiring low-latency access
- Data warehouse / data lake landing zones
- Pre-computed aggregations for API responses

### Normal Forms Quick Reference

| Form | Rule | Practical Check |
|------|------|-----------------|
| 1NF | Atomic values, no repeating groups | Every column holds a single value; no arrays in relational columns |
| 2NF | 1NF + no partial dependencies | Every non-key column depends on the *entire* primary key |
| 3NF | 2NF + no transitive dependencies | Non-key columns do not depend on other non-key columns |
| BCNF | Every determinant is a candidate key | Stricter 3NF; eliminates remaining anomalies |
| 4NF | No multi-valued dependencies | Separate independent multi-valued facts into own tables |

**Practical target**: Most OLTP schemas should reach 3NF. Go to BCNF when the domain has complex candidate keys. 4NF and 5NF are rarely needed outside academic or highly regulated contexts.

---

## Core Relational Patterns

### 1. Surrogate Key Pattern

Use auto-generated surrogate keys (UUIDs or identity columns) as primary keys rather than natural keys.

```sql
-- PostgreSQL: prefer identity columns over serial (modern standard)
CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- When UUIDs are needed (distributed systems, public-facing IDs)
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  total_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**When to use UUIDs vs identity**:
- Identity (BIGINT): Better index performance, smaller storage, sequential inserts
- UUID v7: Distributed ID generation, no coordination needed, time-sortable
- UUID v4: When ordering does not matter and collision resistance is key

### 2. Polymorphic Association Pattern

Model entities that can relate to multiple parent types.

```sql
-- Approach A: Shared foreign key table (preferred for integrity)
CREATE TABLE comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body TEXT NOT NULL,
  commentable_type VARCHAR(50) NOT NULL,  -- 'post', 'ticket', 'order'
  commentable_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approach B: Separate FK columns (better referential integrity)
CREATE TABLE comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body TEXT NOT NULL,
  post_id BIGINT REFERENCES posts(id),
  ticket_id BIGINT REFERENCES tickets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT one_parent CHECK (
    (post_id IS NOT NULL)::int + (ticket_id IS NOT NULL)::int = 1
  )
);
```

### 3. Soft Delete Pattern

```sql
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;

-- Partial index for active records (PostgreSQL)
CREATE INDEX idx_users_active ON users(email) WHERE deleted_at IS NULL;
```

### 4. Audit Trail / Temporal Pattern

```sql
CREATE TABLE users_history (
  history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL,
  email VARCHAR(255),
  name VARCHAR(255),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by BIGINT,
  operation VARCHAR(10) NOT NULL  -- INSERT, UPDATE, DELETE
);
```

### 5. Enum / Lookup Table Pattern

```sql
-- For small, stable sets: use CHECK constraints or PostgreSQL enums
CREATE TYPE order_status AS ENUM ('pending', 'processing', 'shipped', 'delivered', 'cancelled');

-- For sets that change: use a lookup table
CREATE TABLE order_statuses (
  id SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0
);
```

### 6. Many-to-Many with Metadata

```sql
CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by BIGINT REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id)
);
```

### 7. Tree / Hierarchy Patterns

```sql
-- Adjacency List (simplest, recursive queries needed)
CREATE TABLE categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id BIGINT REFERENCES categories(id),
  name VARCHAR(255) NOT NULL
);

-- Materialized Path (fast reads, complex writes)
CREATE TABLE categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path TEXT NOT NULL,  -- e.g., '/1/5/12/'
  name VARCHAR(255) NOT NULL
);

-- ltree (PostgreSQL-specific, best of both worlds)
CREATE TABLE categories (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path ltree NOT NULL,  -- e.g., 'root.electronics.phones'
  name VARCHAR(255) NOT NULL
);
CREATE INDEX idx_categories_path ON categories USING gist(path);
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Tables | Plural, snake_case | `user_accounts`, `order_items` |
| Columns | Singular, snake_case | `first_name`, `created_at` |
| Primary keys | `id` | `users.id` |
| Foreign keys | `<singular_table>_id` | `user_id`, `order_id` |
| Booleans | `is_` or `has_` prefix | `is_active`, `has_verified_email` |
| Timestamps | `_at` suffix | `created_at`, `updated_at`, `deleted_at` |
| Counts / amounts | Descriptive with unit | `total_cents`, `quantity`, `retry_count` |
| Indexes | `idx_<table>_<columns>` | `idx_users_email` |
| Unique constraints | `uq_<table>_<columns>` | `uq_users_email` |

---

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| EAV (Entity-Attribute-Value) | Impossible to enforce types/constraints, slow queries | Use JSONB column or proper relational modeling |
| God table | Single table with 50+ columns, most nullable | Decompose into focused entities |
| Implicit joins via string matching | No referential integrity, typo-prone | Use proper foreign keys |
| Storing money as float | Rounding errors | Use BIGINT (cents) or DECIMAL(19,4) |
| Missing timestamps | Cannot audit or debug | Add `created_at` and `updated_at` to every table |
| Over-normalization | Excessive joins destroy read performance | Denormalize read-heavy paths with materialized views |
| No indexes on foreign keys | Slow joins and cascading deletes | Index every FK column |
