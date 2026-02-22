# Document and Graph Database Patterns

Schema design patterns for document databases (MongoDB, DynamoDB, Firestore) and graph databases (Neo4j, Amazon Neptune).

---

## Document Database Patterns

### Core Decision: Embed vs Reference

| Factor | Embed | Reference |
|--------|-------|-----------|
| Read pattern | Data always read together | Data read independently |
| Data size | Subdocument < 16MB (MongoDB limit) | Large or unbounded child collections |
| Update frequency | Child data rarely changes | Child data updates independently |
| Cardinality | One-to-few or one-to-many (bounded) | One-to-many (unbounded) or many-to-many |
| Consistency need | Atomic updates needed | Eventual consistency acceptable |

### Pattern 1: Embedded Document (Denormalized)

```json
{
  "_id": "order_001",
  "customer": {
    "id": "cust_123",
    "name": "Jane Doe",
    "email": "jane@example.com"
  },
  "items": [
    { "sku": "WIDGET-A", "name": "Widget A", "quantity": 2, "price_cents": 1999 },
    { "sku": "GADGET-B", "name": "Gadget B", "quantity": 1, "price_cents": 4999 }
  ],
  "total_cents": 8997,
  "status": "shipped",
  "created_at": "2025-01-15T10:30:00Z"
}
```

**Use when**: Order items are always read with the order, item count is bounded, and atomicity matters.

### Pattern 2: Referenced Document (Normalized)

```json
// users collection
{ "_id": "user_123", "name": "Jane Doe", "email": "jane@example.com" }

// posts collection
{ "_id": "post_456", "author_id": "user_123", "title": "...", "body": "..." }
```

**Use when**: Users and posts are queried independently, user profile changes should not require updating every post.

### Pattern 3: Bucket Pattern (Time-Series)

```json
{
  "_id": "sensor_001_2025-01-15",
  "sensor_id": "sensor_001",
  "date": "2025-01-15",
  "readings": [
    { "time": "10:00:00", "value": 23.5 },
    { "time": "10:01:00", "value": 23.7 }
  ],
  "count": 2,
  "sum": 47.2
}
```

**Use when**: High-volume time-series data; group readings into time buckets (hour, day) to reduce document count and enable pre-aggregation.

### Pattern 4: Computed / Extended Reference Pattern

```json
{
  "_id": "post_456",
  "author_id": "user_123",
  "author_name": "Jane Doe",     // Denormalized for display
  "author_avatar": "/img/123.jpg", // Denormalized for display
  "title": "My Post",
  "body": "...",
  "comment_count": 42             // Pre-computed aggregate
}
```

**Use when**: Frequently displayed fields from related documents can be cached in the parent to avoid joins / lookups. Accept eventual consistency for these cached fields.

### Pattern 5: Outlier Pattern

Handle documents that exceed typical patterns differently.

```json
// Normal movie document
{
  "_id": "movie_123",
  "title": "Normal Movie",
  "actors": ["actor_1", "actor_2", "actor_3"]
}

// Outlier movie with 500+ actors
{
  "_id": "movie_456",
  "title": "Huge Cast Movie",
  "actors": ["actor_1", "actor_2", "...first 20..."],
  "has_overflow": true
}

// Overflow collection
{
  "movie_id": "movie_456",
  "actors": ["actor_21", "actor_22", "...remaining..."]
}
```

---

## DynamoDB / Single-Table Design

### Access Pattern-First Design

1. List all access patterns before designing the schema
2. Design the partition key (PK) and sort key (SK) to serve the most common patterns
3. Use Global Secondary Indexes (GSIs) for alternative access patterns

```
| PK              | SK                    | Data                          |
|-----------------|-----------------------|-------------------------------|
| USER#123        | PROFILE               | { name, email, ... }          |
| USER#123        | ORDER#2025-01-15#001  | { total, status, ... }        |
| USER#123        | ORDER#2025-01-16#002  | { total, status, ... }        |
| ORDER#001       | ITEM#SKU-A            | { quantity, price, ... }      |
| ORDER#001       | ITEM#SKU-B            | { quantity, price, ... }      |
```

**Key principles**:
- Composite sort keys enable range queries (e.g., all orders for a user in a date range)
- Overload PK/SK with type prefixes to store multiple entity types in one table
- Use GSIs for inverted access patterns

---

## Graph Database Patterns

### When to Use Graph Databases

- Relationship traversal is the primary query pattern
- Depth of relationships varies (friends of friends, shortest path)
- Schema is highly connected with many-to-many relationships
- Fraud detection, social networks, recommendation engines, knowledge graphs

### Pattern 1: Property Graph Model (Neo4j / Cypher)

```cypher
// Nodes with labels and properties
CREATE (u:User {id: 'user_123', name: 'Jane', email: 'jane@example.com'})
CREATE (p:Post {id: 'post_456', title: 'My Post', created_at: datetime()})
CREATE (t:Tag {name: 'database'})

// Relationships with properties
CREATE (u)-[:AUTHORED {at: datetime()}]->(p)
CREATE (p)-[:TAGGED]->(t)
CREATE (u)-[:FOLLOWS {since: date('2025-01-01')}]->(otherUser)
```

### Pattern 2: Traversal Queries

```cypher
// Friends of friends who are not already friends
MATCH (me:User {id: 'user_123'})-[:FOLLOWS]->()-[:FOLLOWS]->(suggestion:User)
WHERE NOT (me)-[:FOLLOWS]->(suggestion) AND me <> suggestion
RETURN DISTINCT suggestion.name, count(*) AS mutual_friends
ORDER BY mutual_friends DESC
LIMIT 10

// Shortest path between two nodes
MATCH path = shortestPath(
  (a:User {id: 'user_123'})-[:FOLLOWS*..6]-(b:User {id: 'user_789'})
)
RETURN path
```

### Pattern 3: Labeled Relationships for Access Control

```cypher
CREATE (user)-[:HAS_ROLE {scope: 'org_123'}]->(role:Role {name: 'admin'})
CREATE (role)-[:HAS_PERMISSION]->(perm:Permission {action: 'write', resource: 'posts'})

// Check permission
MATCH (u:User {id: $userId})-[:HAS_ROLE]->(r:Role)-[:HAS_PERMISSION]->(p:Permission)
WHERE p.action = $action AND p.resource = $resource
RETURN count(p) > 0 AS has_access
```

---

## Choosing the Right Database Paradigm

| Criterion | Relational | Document | Graph |
|-----------|-----------|----------|-------|
| Data structure | Highly structured, consistent schemas | Semi-structured, variable schemas | Highly connected, relationship-heavy |
| Query patterns | Complex joins, aggregations, transactions | Key-value lookups, nested reads | Traversals, path finding, pattern matching |
| Schema evolution | ALTER TABLE migrations | Flexible, schema-on-read | Labels and properties, additive |
| ACID transactions | Strong (multi-table) | Single-document atomic; multi-doc varies | Varies by engine |
| Scalability model | Vertical (sharding is complex) | Horizontal (built-in sharding) | Varies; some shard, some replicate |
| Best for | Financial, ERP, CRM, general-purpose | Content management, catalogs, IoT, user profiles | Social, fraud, recommendations, knowledge |

---

## Agent Considerations for Document/Graph Schemas

- **Document schemas**: Always define a validation schema (JSON Schema, Mongoose schema, Zod) even though the database does not enforce it. Agents rely on predictable structure.
- **Graph schemas**: Document the node labels, relationship types, and expected properties. Agents need a "schema map" to write correct traversal queries.
- **Hybrid approaches**: Many production systems use relational for transactional core + document for flexible metadata + graph for relationship queries. Design clear boundaries between them.
- **Version fields**: Include a `schema_version` field in documents so agents and code can handle schema evolution gracefully.
