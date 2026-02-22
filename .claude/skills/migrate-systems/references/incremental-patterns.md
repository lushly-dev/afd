# Incremental Migration Patterns Reference

## Strangler Fig Pattern

The strangler fig pattern incrementally replaces a legacy system by routing requests through a facade that directs traffic to either the old or new implementation. Over time, more routes point to the new system until the legacy system is fully decommissioned.

### Architecture

```
                    ┌──────────┐
   Clients ───────> │  Facade  │
                    │ (Router) │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              v                     v
        ┌───────────┐        ┌───────────┐
        │  Legacy   │        │    New    │
        │  System   │        │  System   │
        └───────────┘        └───────────┘
```

### Implementation Steps

1. **Introduce the facade** -- Place a reverse proxy, API gateway, or routing layer in front of the legacy system. Initially, 100% of traffic flows through to the legacy system unchanged.

2. **Identify the first slice** -- Choose a well-bounded piece of functionality with clear inputs and outputs. Prefer slices that:
   - Have low coupling to other parts of the legacy system
   - Have good test coverage or easily verifiable behavior
   - Deliver standalone business value when migrated

3. **Build the new implementation** -- Develop the replacement behind the facade. The new service must match the legacy system's API contract exactly (same request/response format).

4. **Route traffic** -- Update the facade to route requests for the migrated slice to the new implementation. All other traffic continues to the legacy system.

5. **Verify and stabilize** -- Monitor error rates, latency, and correctness. Run parallel verification if possible.

6. **Repeat** -- Select the next slice and repeat steps 2-5 until all traffic routes to the new system.

7. **Decommission** -- Once no traffic reaches the legacy system, remove it.

### Facade Implementation Options

| Facade type | Best for | Example |
|---|---|---|
| Reverse proxy (nginx, Envoy) | HTTP API migrations | Route by URL path prefix |
| API gateway (Kong, AWS API Gateway) | Microservice extractions | Route by endpoint + headers |
| In-app router | Monolith-internal migrations | Route by feature flag or module |
| CDN/edge function | Frontend migrations | Route by URL pattern at the edge |

### Common Pitfalls

- **Shared database coupling** -- If old and new systems share a database, schema changes for the new system can break the old system. Use views or an anti-corruption layer.
- **Session/state leakage** -- If user sessions span old and new systems, ensure session data is shared or replicated.
- **Batch job migration** -- Background jobs and cron tasks are easy to forget. Inventory all async processes, not just HTTP endpoints.
- **Testing the facade** -- The routing layer itself needs tests. Verify that routing rules correctly direct traffic based on path, header, or flag state.

## Parallel Run Pattern

Both old and new systems process every request simultaneously. Outputs are compared to verify behavioral equivalence before cutting over.

### Architecture

```
                    ┌──────────────┐
   Request ───────> │  Comparator  │ ───> Response (from primary)
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    v              v
              ┌──────────┐  ┌──────────┐
              │  Primary │  │ Secondary│
              │ (Legacy) │  │  (New)   │
              └──────────┘  └──────────┘
```

### How It Works

1. The comparator receives the incoming request
2. It forwards the request to both the primary (legacy) and secondary (new) systems
3. The primary's response is returned to the client (the secondary's response is discarded)
4. Both responses are compared asynchronously
5. Mismatches are logged for investigation

### Comparison Strategies

| Strategy | When to use |
|---|---|
| Exact match | Deterministic outputs (lookups, calculations) |
| Semantic equivalence | Outputs differ in format but mean the same thing |
| Threshold-based | Numeric outputs that may differ within tolerance |
| Subset validation | New system returns a superset of old system's data |

### Implementation Considerations

- **Performance overhead** -- Processing every request twice doubles compute cost. Run parallel mode for a bounded period, not indefinitely.
- **Side effects** -- Secondary system must NOT produce real side effects (no emails, no payments, no external API calls). Use dry-run or sandbox mode.
- **Asynchronous comparison** -- Compare outputs off the critical path to avoid adding latency to client responses.
- **Sampling** -- For high-traffic systems, compare a random sample rather than every request.
- **Non-determinism** -- Timestamps, random IDs, and ordering differences require normalization before comparison.

### Example Comparison Framework

```typescript
interface ComparisonResult {
  requestId: string;
  matched: boolean;
  primaryResponse: unknown;
  secondaryResponse: unknown;
  differences: Diff[];
  timestamp: string;
}

async function parallelRun<T>(
  request: Request,
  primary: (req: Request) => Promise<T>,
  secondary: (req: Request) => Promise<T>,
  compare: (a: T, b: T) => ComparisonResult
): Promise<T> {
  const [primaryResult, secondaryResult] = await Promise.allSettled([
    primary(request),
    secondary(request),
  ]);

  // Always return primary result to client
  if (primaryResult.status === "rejected") throw primaryResult.reason;

  // Compare asynchronously -- do not block the response
  if (secondaryResult.status === "fulfilled") {
    setImmediate(() => {
      const result = compare(primaryResult.value, secondaryResult.value);
      if (!result.matched) logMismatch(result);
    });
  } else {
    logSecondaryFailure(secondaryResult.reason);
  }

  return primaryResult.value;
}
```

## Shadow Traffic Pattern

A copy of production traffic is sent to the new system without affecting the client experience. Unlike parallel run, the new system's responses are never compared inline -- they are evaluated separately.

### Use Cases

- **Load testing** -- Verify the new system handles production-scale traffic
- **Performance benchmarking** -- Compare latency distributions between old and new
- **Smoke testing** -- Confirm the new system does not crash under real workloads
- **Data migration verification** -- Ensure the new system produces correct results from migrated data

### Implementation

```
   Client ──────> Legacy System ──────> Response
                       │
                       │ (async copy)
                       v
                  New System (results discarded)
```

Traffic mirroring can be implemented at:
- **Load balancer level** (nginx `mirror`, Envoy shadow policy)
- **Application level** (middleware that duplicates and forwards requests)
- **Infrastructure level** (AWS VPC traffic mirroring, service mesh)

### Safety Rules

- Shadow traffic must never produce real side effects
- Shadow responses must never be returned to clients
- Shadow system failures must not impact the primary system
- Shadow traffic volume should be controllable (start at 1%, ramp up)

## Feature-Flag-Gated Migration

Use feature flags to control which code path executes during a migration. This enables gradual rollout, instant rollback, and per-user or per-cohort testing.

### Migration Flag Lifecycle

```
1. Deploy new code behind flag (flag OFF)
2. Enable flag for internal users / canary group
3. Expand to 10% → 25% → 50% → 100% of traffic
4. Monitor at each stage for errors, latency, correctness
5. Once at 100% and stable, remove the flag and old code path
```

### Migration-Specific Flag Schema

```typescript
interface MigrationFlag {
  name: string;           // e.g., "migration/search-v2"
  description: string;    // What is being migrated and why
  enabled: boolean;       // Current state
  rolloutPercentage?: number;  // 0-100 for gradual rollout
  startedAt: string;      // When migration began
  targetDate: string;     // When migration should complete
  rollbackProcedure: string;   // How to revert if issues arise
}
```

### Combining Flags with Other Patterns

Feature flags work well as the control mechanism for other patterns:
- **Strangler fig** -- The flag determines which backend the facade routes to
- **Expand-contract** -- The flag controls whether the app reads from old or new columns
- **Parallel run** -- The flag enables/disables the comparison mode
- **Codemod rollout** -- Deploy codemod output behind a flag to verify in production

## Dual-Write Pattern

During data store migration, writes are sent to both old and new stores simultaneously to maintain consistency during the transition.

### Phases

1. **Dual write** -- Application writes to both old and new data stores
2. **Backfill** -- Historical data is copied from old store to new store
3. **Verification** -- Reconciliation job compares both stores for consistency
4. **Read cutover** -- Switch reads from old store to new store (behind a flag)
5. **Write cutover** -- Stop writing to old store
6. **Decommission** -- Remove old store after retention period

### Consistency Considerations

| Approach | Consistency | Complexity |
|---|---|---|
| Synchronous dual write | Strong (both succeed or fail) | High -- distributed transaction |
| Async replication | Eventual | Medium -- needs reconciliation |
| Change data capture (CDC) | Eventual | Low -- infrastructure handles it |
| Event sourcing | Strong (replay events) | High -- architectural change |

### Reconciliation

Run a periodic reconciliation job that:
1. Compares record counts between old and new stores
2. Samples records and compares field values
3. Identifies missing, extra, or divergent records
4. Produces a report for human review

```typescript
interface ReconciliationReport {
  timestamp: string;
  oldStoreCount: number;
  newStoreCount: number;
  sampledRecords: number;
  matchedRecords: number;
  mismatches: RecordMismatch[];
  missingInNew: string[];  // IDs present in old but not new
  missingInOld: string[];  // IDs present in new but not old
}
```

## Choosing the Right Pattern

```
Is the migration user-facing?
  ├── Yes: Start with feature-flag-gated rollout
  │         └── Need behavioral verification? Add parallel run
  └── No: Is it a data store change?
           ├── Yes: Use dual-write + expand-contract
           └── No: Is it a service/module replacement?
                    ├── Yes: Use strangler fig
                    └── No: Is it a code-level refactor?
                             ├── Yes: Use codemods
                             └── No: Evaluate case-by-case
```
