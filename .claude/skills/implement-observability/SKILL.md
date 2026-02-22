---
name: implement-observability
source: botcore
description: >
  Guides implementation of structured logging, metrics collection, and distributed tracing for production services. Covers the three pillars of observability (logs, metrics, traces), OpenTelemetry integration, correlation ID propagation, alerting thresholds, and common anti-patterns. Use when adding monitoring to a service, debugging production issues, improving error visibility, setting up alerting, or instrumenting business metrics. Triggers: observability, logging, metrics, tracing, monitoring, OpenTelemetry, alerts, instrumentation, structured logs, correlation ID.

version: 1.0.0
triggers:
  - observability
  - logging
  - metrics
  - tracing
  - monitoring
  - OpenTelemetry
  - alerts
  - instrumentation
  - structured logs
  - correlation ID
portable: true
---

# Implementing Observability

Best practices for structured logging, metrics collection, and distributed tracing in production services.

## Capabilities

1. Design structured logging with proper log levels and JSON output
2. Implement correlation ID propagation across service boundaries
3. Instrument services with counters, gauges, and histograms
4. Set up OpenTelemetry for automatic and manual instrumentation
5. Define alerting thresholds using RED and USE methodologies
6. Identify and avoid common observability anti-patterns
7. Build dashboards covering rate, errors, and duration

## Core Principles

- **Three Pillars** -- Observability rests on logs (event records), metrics (numeric measurements), and traces (request flow). Each pillar serves a distinct debugging purpose; all three are needed for full visibility.
- **Structure Over Strings** -- Always emit structured JSON logs rather than interpolated strings. Structured logs are searchable, parseable, and machine-readable.
- **Correlation Everywhere** -- Every request must carry a correlation ID that propagates across all downstream services and appears in every log entry, metric label, and trace span.
- **Bounded Cardinality** -- Metric labels must use bounded value sets. Unbounded labels (user IDs, request paths with parameters) cause metric explosion and storage issues.
- **Actionable Alerts Only** -- Every alert must have a clear owner, a runbook, and a required action. If an alert fires and nobody needs to act, remove it.
- **Sensitive Data Exclusion** -- Never log PII, secrets, tokens, or credentials. Redact or mask sensitive fields before they reach the logging pipeline.

## Quick Reference

### Log Levels

| Level | Use For |
|-------|---------|
| `error` | Failures requiring immediate attention |
| `warn` | Recoverable issues, deprecations |
| `info` | Business events (user created, payment processed) |
| `debug` | Development troubleshooting |
| `trace` | Detailed execution flow |

### Metric Types

| Type | Behavior | Example |
|------|----------|---------|
| Counter | Monotonic, always increases | `ordersTotal.inc({ status: "completed" })` |
| Gauge | Can increase or decrease | `activeConnections.set(pool.size)` |
| Histogram | Distribution of values | `requestDuration.observe(elapsed)` |

### Methodology Frameworks

| Framework | Applies To | Measures |
|-----------|-----------|----------|
| **RED** | Services | Rate, Errors, Duration |
| **USE** | Resources | Utilization, Saturation, Errors |
| **Business** | Product | Signups, Orders, Revenue |

## Workflow

### 1. Structured Logging

```typescript
// BAD: Unstructured string interpolation
console.log(`User ${userId} failed to login: ${error}`);

// GOOD: Structured JSON with context
logger.error({
  event: "login_failed",
  userId,
  error: error.message,
  stack: error.stack,
  requestId: ctx.requestId,
});
```

### 2. Correlation ID Propagation

```typescript
// Middleware to inject and propagate correlation ID
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
});

// Include in every log entry
logger.info({ correlationId: req.correlationId, event: "order_placed" });
```

### 3. OpenTelemetry Setup

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'my-service',
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

### 4. Alerting Thresholds

| Alert Type | Threshold | Response |
|------------|-----------|----------|
| Error rate | > 1% for 5 min | Page on-call |
| Latency p99 | > 2s for 10 min | Investigate |
| Saturation | > 80% for 15 min | Scale up |

### Anti-Patterns to Avoid

| Avoid | Instead |
|-------|---------|
| Logging PII or secrets | Redact sensitive data before logging |
| High-cardinality metric labels | Use bounded label values only |
| Logging in hot paths without sampling | Sample or aggregate high-frequency events |
| Noisy or non-actionable alerts | Ensure every alert has an owner and runbook |

## Checklist

- [ ] Structured JSON logging configured with appropriate log levels
- [ ] Correlation ID generated at ingress and propagated to all downstream calls
- [ ] Error context captured including stack traces and request metadata
- [ ] Key business metrics instrumented (signups, orders, revenue)
- [ ] RED metrics instrumented for all services (rate, errors, duration)
- [ ] USE metrics instrumented for critical resources (CPU, memory, connections)
- [ ] Health check endpoints exposed and monitored
- [ ] Alerting rules configured with clear thresholds and response procedures
- [ ] Dashboards created for RED metrics and business KPIs
- [ ] Sensitive data redacted from all log output
- [ ] Metric label cardinality verified as bounded
- [ ] OpenTelemetry or equivalent tracing SDK initialized

## When to Escalate

- **Infrastructure team** -- When setting up centralized log aggregation, metric storage backends (Prometheus, Datadog), or tracing collectors (Jaeger, Zipkin) at the platform level.
- **Security team** -- When uncertain whether a data field constitutes PII or when logging requirements conflict with compliance obligations (GDPR, HIPAA).
- **SRE / On-call team** -- When defining SLOs, error budgets, or paging thresholds that affect incident response workflows.
- **Architecture team** -- When introducing a new observability vendor or making cross-cutting changes to the instrumentation strategy across multiple services.
