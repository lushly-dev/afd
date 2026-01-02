# 06c - Horizontal Scaling Patterns

> **Type**: Documentation Only  
> **Priority**: P1  
> **Status**: ✅ Complete

---

## Scope Note

This document provides **guidance only**. Horizontal scaling is an infrastructure concern, not an AFD code change. These patterns work naturally with AFD's architecture.

---

## Why AFD Scales Horizontally

AFD commands are inherently stateless:

```
┌────────────┐     ┌────────────────┐     ┌──────────────────────┐
│ CLI        │────▶│                │────▶│ Instance 1           │
│ MCP        │────▶│  Load Balancer │────▶│ Instance 2           │
│ REST API   │────▶│                │────▶│ Instance 3           │
│ Web UI     │────▶│                │────▶│ ...                  │
└────────────┘     └────────────────┘     └──────────────────────┘
                                                    │
                                                    ▼
                                          ┌──────────────────┐
                                          │  Shared State    │
                                          │  (Database)      │
                                          └──────────────────┘
```

Each command execution is independent:

- No server-side session state
- No command depends on which instance handles it
- Database is the single source of truth

---

## Scaling Patterns

### Pattern 1: Stateless Instances Behind Load Balancer

**When to use**: Default pattern for most AFD applications.

```yaml
# kubernetes deployment example
apiVersion: apps/v1
kind: Deployment
metadata:
  name: afd-api
spec:
  replicas: 3 # Scale horizontally
  template:
    spec:
      containers:
        - name: api
          image: my-afd-app:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: url
---
apiVersion: v1
kind: Service
metadata:
  name: afd-api
spec:
  type: LoadBalancer
  selector:
    app: afd-api
  ports:
    - port: 80
      targetPort: 3000
```

**Benefits**:

- Simple to implement
- Works with any cloud provider
- No code changes needed

### Pattern 2: Surface-Specific Scaling

**When to use**: Different surfaces have different load characteristics.

```
┌────────────────────────────────────────────────────────────┐
│                     Load Characteristics                   │
├────────────────────────────────────────────────────────────┤
│  MCP (AI Agents)     │  Low volume, long requests         │
│  REST API (Web UI)   │  High volume, mixed requests       │
│  CLI                 │  Sporadic, often batch operations  │
└────────────────────────────────────────────────────────────┘
```

Deploy separate instances per surface:

```yaml
# MCP instances (fewer, longer timeout)
afd-mcp:
  replicas: 2
  timeout: 300s
  resources:
    memory: 2Gi

# REST API instances (more, shorter timeout)
afd-api:
  replicas: 10
  timeout: 30s
  resources:
    memory: 512Mi
```

**Benefits**:

- Optimize resources per surface
- Isolate failures (MCP outage doesn't affect Web UI)
- Different scaling policies

### Pattern 3: Read/Write Splitting

**When to use**: Read-heavy workloads.

```
                      ┌─────────────────┐
                      │ Command Router  │
                      └────────┬────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ Read Replicas   │             │ Write Primary   │
    │ (10 instances)  │             │ (2 instances)   │
    │                 │             │                 │
    │ node.get        │             │ node.create     │
    │ node.list       │             │ token.add       │
    │ tokens.resolve  │             │ token.override  │
    └────────┬────────┘             └────────┬────────┘
             │                                │
             ▼                                ▼
    ┌─────────────────┐             ┌─────────────────┐
    │ Read Replica DB │◄────────────│ Primary DB      │
    └─────────────────┘  replication└─────────────────┘
```

**Implementation hint**: Tag commands in registry:

```typescript
const nodeGetCommand = {
  name: "node.get",
  mutation: false, // Route to read replicas
  // ...
};

const nodeCreateCommand = {
  name: "node.create",
  mutation: true, // Route to write primary
  // ...
};
```

### Pattern 4: Geographic Distribution

**When to use**: Global user base, latency-sensitive.

```
┌─────────────────────────────────────────────────────────────┐
│                        Global                               │
├───────────────┬───────────────┬───────────────┬────────────┤
│   US West     │   US East     │   EU          │   APAC     │
│   (Primary)   │   (Replica)   │   (Replica)   │  (Replica) │
├───────────────┼───────────────┼───────────────┼────────────┤
│ Full R/W      │ Read-only +   │ Read-only +   │ Read-only +│
│               │ Forward writes│ Forward writes│ Fwd writes │
└───────────────┴───────────────┴───────────────┴────────────┘
```

**Considerations**:

- Eventual consistency for reads
- Writes forwarded to primary region
- Use case: Violet Design tokens (read-heavy, infrequent writes)

---

## Caching Layers

### Command-Level Caching

AFD commands have deterministic inputs → cacheable:

```typescript
// Cache key = hash(command + input)
const cacheKey = hash("node.get", { id: "xbox" });

// Check cache before executing
const cached = await cache.get(cacheKey);
if (cached) return cached;

// Execute and cache
const result = await registry.execute("node.get", { id: "xbox" });
await cache.set(cacheKey, result, { ttl: 60 });

return result;
```

**Cache invalidation**: Mutation commands invalidate related caches:

```typescript
const nodeCreateCommand = {
  name: "node.create",
  mutation: true,
  invalidates: ["node.get", "node.list"], // Invalidate these on success
  // ...
};
```

### CDN Caching for Exports

```
┌────────────┐     ┌─────────┐     ┌──────────────┐
│ Client     │────▶│ CDN     │────▶│ AFD Server   │
│            │     │ (edge)  │     │              │
└────────────┘     └─────────┘     └──────────────┘

Cache rules:
- export?format=css&node=xbox  → Cache 1 hour
- export?format=json&node=*    → Cache 15 minutes
- node.create, token.add       → Never cache, always forward
```

---

## Database Considerations

### Connection Pooling

With multiple instances, manage database connections:

```typescript
// Bad: Each instance opens many connections
const db = new Database({ maxConnections: 100 });
// 10 instances × 100 = 1000 connections (may exceed DB limits)

// Better: Use connection pooler (PgBouncer, ProxySQL)
const db = new Database({
  host: "pgbouncer.internal", // Pooler, not direct DB
  maxConnections: 20,
});
```

### Database per Surface (Advanced)

For extreme isolation:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Web UI DB   │     │ MCP DB      │     │ CLI DB      │
│ (replica)   │     │ (replica)   │     │ (replica)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────┴──────┐
                    │ Primary DB  │
                    └─────────────┘
```

---

## Monitoring and Observability

### Key Metrics per Instance

```typescript
// Expose metrics endpoint
app.get("/metrics", (req, res) => {
  res.json({
    instance: process.env.INSTANCE_ID,
    uptime: process.uptime(),
    commands: {
      total: metrics.commandsTotal,
      byName: metrics.commandsByName,
      avgLatencyMs: metrics.avgLatencyMs,
    },
    errors: {
      total: metrics.errorsTotal,
      byCode: metrics.errorsByCode,
    },
  });
});
```

### Distributed Tracing

Correlate requests across instances:

```typescript
// Incoming request gets trace ID
const traceId = req.headers["x-trace-id"] || generateTraceId();

// Pass to command execution
const result = await registry.execute("node.get", input, { traceId });

// Include in logs
logger.info("Command executed", {
  traceId,
  command: "node.get",
  durationMs: 42,
});
```

---

## Anti-Patterns to Avoid

### ❌ In-Memory State

```typescript
// Bad: State lives in instance memory
class TokenCache {
  private cache = new Map(); // Lost on restart, not shared
}

// Good: Use external cache
class TokenCache {
  constructor(private redis: Redis) {}
  async get(key: string) {
    return this.redis.get(key);
  }
}
```

### ❌ Sticky Sessions

```typescript
// Bad: Requires same instance
app.use(
  session({
    store: new MemoryStore(), // Instance-specific!
  })
);

// Good: External session store
app.use(
  session({
    store: new RedisStore({ client: redis }),
  })
);
```

### ❌ Local File Storage

```typescript
// Bad: Files on instance filesystem
await fs.writeFile("/tmp/export.json", data);

// Good: Blob storage
await blobStorage.upload("exports/export.json", data);
```

---

## Summary

| Pattern          | Use When                | AFD Code Change?         |
| ---------------- | ----------------------- | ------------------------ |
| Load balancer    | Default scaling         | No                       |
| Surface-specific | Different load profiles | No                       |
| Read/write split | Read-heavy (90%+ reads) | No (use `mutation` flag) |
| Geographic       | Global users            | No                       |
| Command caching  | Repeated queries        | No (middleware)          |
| CDN              | Static exports          | No                       |

AFD's stateless command model makes all these patterns work without modifying core AFD code.
