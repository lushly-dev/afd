---
name: model-data
source: botcore
description: >
  Guides database schema design, migration strategies, query optimization, ORM patterns, and data validation for relational, document, and graph databases. Covers normalization, indexing, event sourcing, CQRS, and boundary validation with agent-friendly modeling practices. Use when designing new schemas, planning migrations, optimizing queries, choosing between database paradigms, or setting up data validation. Triggers: schema, database, migration, model, ORM, Prisma, Drizzle, index, query optimization, normalization, event sourcing, CQRS, validation, Zod, Pydantic.

version: 1.0.0
triggers:
  - schema
  - database
  - migration
  - data model
  - ORM
  - Prisma
  - Drizzle
  - Knex
  - Alembic
  - Atlas
  - index
  - query optimization
  - normalization
  - denormalization
  - event sourcing
  - CQRS
  - validation
  - Zod
  - Pydantic
  - relational
  - document database
  - graph database
  - PostgreSQL
  - MongoDB
  - Neo4j
portable: true
---

# Modeling Data

Best practices for database schema design, migration strategies, query optimization, ORM patterns, and data validation across relational, document, and graph databases.

## Capabilities

1. Design relational schemas with proper normalization, naming conventions, and constraint strategies
2. Model document database schemas (MongoDB, DynamoDB, Firestore) with embed-vs-reference decisions
3. Design graph database models (Neo4j, Neptune) for relationship-heavy domains
4. Plan and execute safe database migrations using Prisma, Drizzle, Alembic, Knex, or Atlas
5. Optimize queries through indexing strategies, EXPLAIN analysis, and pagination patterns
6. Implement event sourcing and CQRS patterns for audit-heavy or event-driven systems
7. Set up boundary validation with Zod (TypeScript), Pydantic (Python), or JSON Schema
8. Advise on database paradigm selection (relational vs document vs graph) for a given domain

## Routing Logic

| Topic | Reference |
|-------|-----------|
| Normalization, relational patterns, naming conventions, anti-patterns | `{baseDir}/references/relational-patterns.md` |
| Document DB patterns (embed vs reference, DynamoDB single-table), graph DB models | `{baseDir}/references/document-graph-patterns.md` |
| Migration strategies, ORM workflows (Prisma, Drizzle, Alembic, Knex, Atlas) | `{baseDir}/references/migrations-and-orms.md` |
| Indexing types, query optimization, EXPLAIN, pagination, monitoring | `{baseDir}/references/indexing-and-optimization.md` |
| Event sourcing, CQRS, aggregates, projections, snapshots | `{baseDir}/references/event-sourcing-cqrs.md` |
| Zod, Pydantic, JSON Schema, database constraints, validation layers | `{baseDir}/references/data-validation.md` |

## Core Principles

- **Schema is the contract** -- The database schema is the most durable API in any system. Design it deliberately; everything else adapts to it.
- **Validate at every boundary** -- Never trust input from any source. Validate at the API boundary (Zod/Pydantic), enforce with application logic, and backstop with database constraints.
- **Normalize by default, denormalize by measurement** -- Start with 3NF for transactional tables. Only denormalize when profiling proves joins are a bottleneck, and use materialized views or read replicas rather than corrupting the source schema.
- **Migrations are deployments** -- Treat schema changes with the same rigor as application deployments: version them, review them, test them on production-sized data, and ensure rollback paths.
- **Index with intent** -- Every index has a write-cost. Create indexes to serve specific query patterns, verify with EXPLAIN, and remove unused ones.
- **Choose the right paradigm** -- Relational for structured transactional data, document for flexible semi-structured data, graph for relationship-heavy traversal queries. Hybrid is often the answer.
- **Design for agents and automation** -- Use consistent naming, explicit types, descriptive constraints, and machine-readable schema definitions. Agents rely on predictable, well-documented schemas.

## Workflow

### New Schema Design

1. **Gather requirements** -- Identify entities, relationships, access patterns, and consistency needs.
2. **Choose paradigm** -- Relational, document, graph, or hybrid based on the domain (see reference: document-graph-patterns).
3. **Model entities** -- Define tables/collections/nodes with proper naming conventions.
4. **Define relationships** -- Foreign keys (relational), embedded docs or references (document), edges (graph).
5. **Apply normalization** -- Target 3NF for transactional schemas; document rationale for any intentional denormalization.
6. **Add constraints** -- NOT NULL, UNIQUE, CHECK, foreign keys. These are your safety net.
7. **Plan indexes** -- Index foreign keys, unique fields, and columns in frequent WHERE/ORDER BY clauses.
8. **Set up validation** -- Define Zod/Pydantic schemas that mirror the database schema at the API boundary.
9. **Write migration** -- Use the project's ORM migration tool to generate and review the migration SQL.
10. **Review and test** -- Review generated SQL, test on production-sized data, verify rollback.

### Schema Change (Existing System)

1. **Assess impact** -- Which tables, queries, and application code are affected?
2. **Choose strategy** -- Additive change (safe), or expand-and-contract for breaking changes.
3. **Write migration** -- Generate with ORM tool, customize if needed (data migration, backfill).
4. **Test migration** -- Run on a copy of production data; measure duration and lock behavior.
5. **Deploy** -- Apply migration before deploying new application code (expand phase).
6. **Verify** -- Confirm data integrity, query performance, and application behavior.
7. **Clean up** -- Remove old columns/tables after verification period (contract phase).

## Quick Reference

### Database Paradigm Selection

| Signal | Recommended Paradigm |
|--------|---------------------|
| Structured data, ACID transactions, complex joins | **Relational** (PostgreSQL, MySQL) |
| Variable schema, nested objects, key-value access | **Document** (MongoDB, DynamoDB, Firestore) |
| Deep relationship traversal, social graphs, recommendations | **Graph** (Neo4j, Neptune) |
| Time-series, high-volume append | **Time-series** (TimescaleDB, InfluxDB) or document buckets |
| Full-text search as primary access | **Search engine** (Elasticsearch, Typesense) |
| Mixed requirements | **Hybrid**: relational core + specialized stores for specific patterns |

### Normalization Quick Guide

| Form | Rule | Target? |
|------|------|---------|
| 1NF | Atomic values, no repeating groups | Always |
| 2NF | No partial key dependencies | Always |
| 3NF | No transitive dependencies | Default target for OLTP |
| BCNF | Every determinant is a candidate key | When complex keys exist |

### ORM Migration Commands

| Tool | Generate | Apply (Dev) | Apply (Prod) | Rollback |
|------|----------|-------------|-------------- |----------|
| Prisma | `prisma migrate dev` | `prisma migrate dev` | `prisma migrate deploy` | Manual |
| Drizzle | `drizzle-kit generate` | `drizzle-kit push` | `drizzle-kit migrate` | Manual |
| Alembic | `alembic revision --autogenerate` | `alembic upgrade head` | `alembic upgrade head` | `alembic downgrade -1` |
| Knex | `knex migrate:make` | `knex migrate:latest` | `knex migrate:latest` | `knex migrate:rollback` |
| Atlas | `atlas migrate diff` | `atlas schema apply` | `atlas migrate apply` | `atlas schema apply --to` |

### Index Decision Quick Check

```
Column appears in WHERE, JOIN, or ORDER BY?
  No  → Do not index
  Yes → Table > 1000 rows?
    No  → Skip (seq scan is fine)
    Yes → High cardinality?
      Yes → B-tree index
      No  → Partial index or skip
    Text search? → GIN + tsvector
    JSONB?       → GIN + jsonb_path_ops
    Composite?   → Composite B-tree (most selective column first)
```

### Validation Tool Selection

| Language | Tool | Key Feature |
|----------|------|-------------|
| TypeScript | Zod | Runtime validation with `z.infer<>` for type inference |
| Python | Pydantic v2 | Rust-powered validation, ORM integration via `from_attributes` |
| Any / Cross-service | JSON Schema | Language-agnostic contract, OpenAPI compatible |
| Database | CHECK + UNIQUE + FK | Last-resort integrity enforcement |

### Common Schema Patterns

| Pattern | When to Use |
|---------|------------|
| Surrogate keys (identity/UUID) | Almost always; UUIDs for distributed, identity for single-DB |
| Soft delete (`deleted_at`) | When records must be recoverable; add partial index on active rows |
| Audit trail / history table | Compliance, debugging; consider event sourcing for complex cases |
| Polymorphic association | Comments, attachments that relate to multiple entity types |
| Many-to-many with metadata | Join tables needing extra fields (granted_at, expires_at) |
| Tree / hierarchy (ltree) | Categories, org charts; prefer ltree on PostgreSQL |
| Expand-and-contract | Zero-downtime breaking schema changes in production |

## Agentic Workflow Considerations

When an AI agent is designing or modifying schemas:

- **Explain reasoning** -- Always state *why* a particular normalization level, index, or paradigm was chosen, not just *what* was chosen.
- **Generate validation schemas alongside migrations** -- When creating a new table, also generate the corresponding Zod/Pydantic schema. Keep them in sync.
- **Prefer additive changes** -- When modifying existing schemas, prefer adding new columns/tables over altering or dropping existing ones. This is safer for zero-downtime deployments.
- **Include rollback plans** -- Every migration should have a documented rollback path, even if it is "drop the new column."
- **Use descriptive naming** -- Agents and humans both benefit from `user_account_id` over `uaid`. Self-documenting names reduce errors.
- **Annotate schemas for discoverability** -- Use Zod `.describe()`, Pydantic `Field(description=...)`, and SQL `COMMENT ON` to make schemas machine-readable.
- **Validate AI-generated data** -- When an agent produces data to insert, always run it through the validation schema first. Use strict mode to reject unexpected fields.
- **Check existing patterns** -- Before creating a new table or migration, check the existing codebase for naming conventions, ORM choice, and migration patterns. Follow established conventions.

## Checklist

### New Schema

- [ ] Entities and relationships identified from requirements
- [ ] Database paradigm chosen with documented rationale
- [ ] Naming conventions consistent with project standards
- [ ] Normalization level appropriate (3NF default for OLTP)
- [ ] All foreign keys have indexes
- [ ] NOT NULL applied to all required columns
- [ ] CHECK constraints for value ranges and enums
- [ ] UNIQUE constraints where business rules require them
- [ ] Timestamps (`created_at`, `updated_at`) on all tables
- [ ] Validation schemas (Zod/Pydantic) mirror database constraints
- [ ] Migration file generated and SQL reviewed

### Schema Change

- [ ] Impact assessment completed (affected tables, queries, code)
- [ ] Migration strategy chosen (additive or expand-and-contract)
- [ ] Migration backward-compatible with current application code
- [ ] No table locks on large tables during peak hours
- [ ] Rollback migration written and tested
- [ ] Data backfill tested on production-sized dataset
- [ ] Validation schemas updated to match new schema
- [ ] Indexes added CONCURRENTLY where supported

### Query Performance

- [ ] EXPLAIN ANALYZE run on slow queries
- [ ] Indexes serve the identified query patterns
- [ ] No N+1 query patterns in application code
- [ ] Pagination uses cursor/keyset (not OFFSET for large datasets)
- [ ] No functions wrapping indexed columns in WHERE clauses
- [ ] Unused indexes identified and removed
- [ ] Statistics up to date (ANALYZE run recently)

## When to Escalate

- **Cross-database distributed transactions** -- If the design requires ACID transactions spanning multiple database systems (e.g., PostgreSQL + MongoDB), escalate to a senior architect. This requires saga patterns or two-phase commit, which are beyond routine schema work.
- **Sharding or horizontal partitioning** -- When a single database instance cannot handle the data volume or throughput, sharding decisions have deep architectural implications. Escalate to infrastructure/platform team.
- **Data sovereignty and compliance** -- If schema design must comply with GDPR, HIPAA, SOC2, or data residency requirements, involve legal/compliance stakeholders before finalizing the schema.
- **Event sourcing adoption** -- If the team has no prior event sourcing experience, adopting it requires significant training and infrastructure changes. Propose it but escalate the adoption decision.
- **Production data migration over 1 hour** -- Large data migrations that require extended maintenance windows or complex rollback procedures should involve a DBA or platform engineer.
- **Performance issues after optimization** -- If query performance remains poor after applying indexing and optimization strategies from this skill, escalate to a DBA for deep analysis (lock contention, connection pooling, hardware constraints).
