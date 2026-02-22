# Evolutionary Architecture

Fitness functions, automated governance, and practices for architectures that evolve safely over time.

## Core Idea

An evolutionary architecture supports guided, incremental change across multiple dimensions. Instead of a fixed upfront design, the architecture is designed to change -- and fitness functions protect its key qualities as it evolves.

## Fitness Functions

A fitness function is any mechanism that provides an objective integrity assessment of an architectural characteristic.

### Types of Fitness Functions

| Type | Description | Example |
|---|---|---|
| **Atomic** | Tests a single characteristic | "No cyclic dependencies between modules" |
| **Holistic** | Tests multiple characteristics together | "Response time < 200ms AND availability > 99.9%" |
| **Triggered** | Runs on a specific event (commit, deploy) | CI pipeline architecture test |
| **Continuous** | Runs constantly in production | Latency monitoring with alerts |
| **Static** | Analyzes code without running it | Dependency analysis, linting rules |
| **Dynamic** | Requires running code | Load tests, chaos engineering |

### Fitness Function Examples

#### Modularity

```
FUNCTION: No cross-module internal imports
TYPE: Static, Triggered (CI)
MEASURE: Count of imports from other modules' internal/ directories
THRESHOLD: 0 violations
TOOL: ArchUnit, dependency-cruiser, custom lint rule
```

#### Performance

```
FUNCTION: API response time p95
TYPE: Dynamic, Continuous
MEASURE: 95th percentile response time per endpoint
THRESHOLD: < 200ms for read, < 500ms for write
TOOL: APM (Datadog, New Relic), load testing (k6, Locust)
```

#### Coupling

```
FUNCTION: Service coupling score
TYPE: Static, Triggered (CI)
MEASURE: Number of synchronous inter-service calls per request path
THRESHOLD: Max 2 synchronous hops per user-facing request
TOOL: Distributed trace analysis, architecture tests
```

#### Security

```
FUNCTION: Dependency vulnerability scan
TYPE: Static, Triggered (CI)
MEASURE: Count of HIGH/CRITICAL CVEs in dependencies
THRESHOLD: 0 for CRITICAL, resolve HIGH within 7 days
TOOL: Snyk, Dependabot, Trivy
```

#### Data Isolation

```
FUNCTION: No cross-context database access
TYPE: Static, Triggered (CI)
MEASURE: Database queries that reference tables owned by another bounded context
THRESHOLD: 0 violations
TOOL: Custom SQL analysis, schema ownership manifest
```

#### Code Size

```
FUNCTION: File size limit
TYPE: Static, Triggered (CI)
MEASURE: Lines of code per file
THRESHOLD: Max 500 lines per file
TOOL: Custom lint rule, ESLint max-lines
```

### Implementing Fitness Functions

#### In CI/CD Pipeline

```yaml
# Example: GitHub Actions fitness function stage
fitness-functions:
  runs-on: ubuntu-latest
  steps:
    - name: Modularity check
      run: npx dependency-cruiser --validate .dependency-cruiser.cjs src/

    - name: File size check
      run: |
        find src -name "*.ts" -exec wc -l {} + | awk '$1 > 500 {print "VIOLATION:", $0; exit 1}'

    - name: No circular dependencies
      run: npx madge --circular --extensions ts src/

    - name: API contract validation
      run: npx openapi-diff previous-spec.json current-spec.json

    - name: Dependency vulnerability scan
      run: npx audit-ci --critical
```

#### As Architecture Tests (in code)

```typescript
// Example: ArchUnit-style test (conceptual)
describe('Architecture Fitness Functions', () => {
  it('modules do not import from other modules internal directories', () => {
    const violations = findImports({
      pattern: /modules\/(\w+)\/internal/,
      excludeSameModule: true
    });
    expect(violations).toHaveLength(0);
  });

  it('domain layer has no infrastructure imports', () => {
    const violations = findImports({
      from: 'src/**/domain/**',
      to: ['src/**/adapters/**', 'node_modules/pg', 'node_modules/express']
    });
    expect(violations).toHaveLength(0);
  });

  it('no aggregate spans more than 3 entities', () => {
    const aggregates = analyzeAggregates('src/**/domain/entities/**');
    aggregates.forEach(agg => {
      expect(agg.entityCount).toBeLessThanOrEqual(3);
    });
  });
});
```

## Architectural Governance

### Governance Levels

| Level | Mechanism | Enforcement |
|---|---|---|
| **Automated** | Fitness functions in CI | Build fails on violation |
| **Documented** | ADRs and architecture guidelines | Team review |
| **Observed** | Metrics and dashboards | Alerts on degradation |
| **Reviewed** | Architecture review meetings | Periodic human judgment |

### Governance Automation Priority

Automate the most critical and most frequently violated rules first:

1. **Module boundaries** -- Prevent coupling creep (highest ROI)
2. **Dependency vulnerabilities** -- Security is non-negotiable
3. **API contract compatibility** -- Prevent breaking changes
4. **Code size limits** -- Prevent complexity accumulation
5. **Performance budgets** -- Prevent degradation

### Handling Violations

```
Fitness function fails
  |
  +-- Is it a false positive?
  |     +-- Yes: Adjust the fitness function and document why (ADR)
  |     +-- No: Continue
  |
  +-- Is the violation intentional (architecture change)?
  |     +-- Yes: Write an ADR, update the fitness function, get review
  |     +-- No: Fix the violation before merging
  |
  +-- Can it be fixed quickly?
        +-- Yes: Fix in this PR
        +-- No: Create a tech debt ticket with deadline
```

## Evolutionary Patterns

### Sacrificial Architecture

Build components knowing they will be replaced. Design boundaries so that replacement is isolated.

- Prototype in a simple pattern (monolith module)
- Validate assumptions with real usage
- Replace with production-grade implementation when requirements are clear
- The boundary (port/adapter) stays; the implementation changes

### Incremental Migration

Never do a big-bang rewrite. Instead:

1. Define the target architecture
2. Identify the highest-value extraction candidate
3. Build the new component alongside the old one
4. Route traffic gradually (strangler fig)
5. Decommission the old component
6. Repeat

### Architecture Review Cadence

| Frequency | Focus |
|---|---|
| **Every PR** | Fitness functions (automated) |
| **Monthly** | Review fitness function results, identify trends |
| **Quarterly** | Review ADRs, assess whether constraints still hold |
| **Annually** | Strategic architecture review, technology radar update |

## Key Architectural Characteristics

Choose the characteristics that matter most for your system and build fitness functions for them:

| Characteristic | Description | Fitness Function Type |
|---|---|---|
| **Modularity** | Loose coupling, high cohesion | Static (dependency analysis) |
| **Performance** | Response time, throughput | Dynamic (load tests) |
| **Scalability** | Handles increased load | Dynamic (stress tests) |
| **Security** | Resistant to attacks | Static (scans) + Dynamic (pen tests) |
| **Reliability** | Uptime, fault tolerance | Continuous (monitoring) |
| **Deployability** | Time from commit to production | Triggered (pipeline metrics) |
| **Testability** | Ease of writing and running tests | Static (coverage) + Dynamic (test execution time) |
| **Observability** | Ability to understand system state | Continuous (trace completeness) |
| **Maintainability** | Ease of making changes | Static (complexity metrics, code size) |
| **Evolvability** | Ability to change architecture | Holistic (combination of above) |
