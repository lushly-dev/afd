# Part 5: Testing Strategy

> **Goal**: Comprehensive testing from type conformance (foundation) through behavioral validation (user jobs), ensuring all AFD implementations and UI heads work correctly across languages and platforms.

## The Problem

AFD apps can be written in three languages and distributed to 12+ targets. Without rigorous testing:
- Commands might behave differently in Rust vs Python
- UI heads might invoke commands incorrectly
- Service adapters might have subtle differences
- User workflows might break even when unit tests pass
- Releases might break existing functionality

## Testing Layers

AFD testing is organized into **four layers**, each with a specific purpose:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    JTBD Scenarios (Behavior)                        │  ← User Jobs
│              "Does the complete workflow succeed?"                  │
│                                                                     │
│  See: PLAN/Archive/jtbd-testing/00-overview.plan.md               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Depends on
┌───────────────────────────────┼─────────────────────────────────────┐
│                    Integration Tests                                │  ← Adapters
│              "Do service adapters behave identically?"              │
│                                                                     │
│  SQLite ≡ D1 ≡ Postgres                                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Depends on
┌───────────────────────────────┼─────────────────────────────────────┐
│                    Unit Tests                                       │  ← Commands
│              "Does each command work with mocks?"                   │
│                                                                     │
│  Success paths, error paths, edge cases                            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Depends on
┌───────────────────────────────┼─────────────────────────────────────┐
│                    Conformance Tests                                │  ← Foundation
│              "Do all implementations serialize identically?"        │
│                                                                     │
│  TypeScript ≡ Python ≡ Rust                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Purpose | Speed | Runs When |
|-------|---------|-------|-----------|
| **Conformance** | Type parity across languages | Fast (< 5s) | Every commit |
| **Unit** | Command logic with mocks | Fast (< 30s) | Every commit |
| **Integration** | Adapter parity with real services | Medium (< 2m) | PR + merge |
| **JTBD** | Complete user workflows | Medium (< 10m) | PR + merge |

---

## Layer 1: Conformance Tests (Foundation)

**Purpose**: Ensure all AFD implementations (TypeScript, Python, Rust) serialize types identically.

### Why This Matters

If `CommandResult<T>` serializes differently in Rust vs TypeScript:
- MCP clients will receive different JSON
- JTBD scenarios will fail unpredictably
- Cross-language commands won't interoperate

### Shared Test Specification

All implementations must pass the same test cases, defined in JSON:

```json
// spec/conformance/command-result.json
{
  "suite": "CommandResult",
  "cases": [
    {
      "name": "success_with_data",
      "input": {
        "type": "success",
        "data": { "id": "123", "name": "Test" }
      },
      "expected_json": {
        "success": true,
        "data": { "id": "123", "name": "Test" }
      },
      "assertions": [
        { "path": "$.success", "equals": true },
        { "path": "$.data.id", "equals": "123" },
        { "path": "$.error", "is_absent": true }
      ]
    },
    {
      "name": "error_with_suggestion",
      "input": {
        "type": "error",
        "code": "NOT_FOUND",
        "message": "Item not found",
        "suggestion": "Check the ID"
      },
      "expected_json": {
        "success": false,
        "error": {
          "code": "NOT_FOUND",
          "message": "Item not found",
          "suggestion": "Check the ID"
        }
      }
    },
    {
      "name": "camelCase_serialization",
      "input": {
        "type": "success",
        "data": {},
        "confidence": 0.95,
        "reasoning": "High confidence match"
      },
      "expected_json_contains": ["\"confidence\"", "\"reasoning\""],
      "expected_json_not_contains": ["\"Confidence\"", "\"Reasoning\"", "\"_\""]
    }
  ]
}
```

### Language-Specific Test Runners

Each implementation has a runner that loads the JSON spec:

**TypeScript Runner:**
```typescript
// packages/core/tests/conformance.test.ts
import { describe, it, expect } from 'vitest';
import { success, failure, CommandError } from '@afd/core';
import conformanceSpec from '../../../spec/conformance/command-result.json';

describe('Conformance: CommandResult', () => {
  for (const testCase of conformanceSpec.cases) {
    it(testCase.name, () => {
      const result = createResultFromInput(testCase.input);
      const json = JSON.stringify(result);
      
      if (testCase.expected_json) {
        expect(JSON.parse(json)).toEqual(testCase.expected_json);
      }
      
      for (const assertion of testCase.assertions ?? []) {
        assertJsonPath(json, assertion);
      }
    });
  }
});
```

**Python Runner:**
```python
# python/tests/test_conformance.py
import pytest
import json
from pathlib import Path
from afd import success, failure, CommandError

spec_path = Path(__file__).parent.parent.parent / "spec/conformance/command-result.json"
spec = json.loads(spec_path.read_text())

@pytest.mark.parametrize("case", spec["cases"], ids=lambda c: c["name"])
def test_conformance(case):
    result = create_result_from_input(case["input"])
    result_json = result.model_dump_json()
    
    if "expected_json" in case:
        assert json.loads(result_json) == case["expected_json"]
    
    for assertion in case.get("assertions", []):
        assert_json_path(result_json, assertion)
```

**Rust Runner:**
```rust
// packages/rust/tests/conformance.rs
use afd::{success, failure, CommandError, CommandResult};
use serde_json::Value;

const SPEC: &str = include_str!("../../../spec/conformance/command-result.json");

#[test]
fn test_conformance() {
    let spec: Value = serde_json::from_str(SPEC).unwrap();
    
    for case in spec["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let result = create_result_from_input(&case["input"]);
        let json = serde_json::to_string(&result).unwrap();
        
        if let Some(expected) = case.get("expected_json") {
            let actual: Value = serde_json::from_str(&json).unwrap();
            assert_eq!(&actual, expected, "Failed: {}", name);
        }
        
        if let Some(assertions) = case.get("assertions") {
            for assertion in assertions.as_array().unwrap() {
                assert_json_path(&json, assertion, name);
            }
        }
    }
}
```

### Conformance Test Categories

```
spec/conformance/
├── command-result.json      # CommandResult<T> serialization
├── command-error.json       # CommandError structure
├── metadata.json            # Source, PlanStep, Alternative types
├── validation.json          # Input validation behavior
├── error-codes.json         # Standard error code handling
└── mcp-protocol.json        # MCP request/response format
```

---

## Layer 2: Unit Tests (Commands)

**Purpose**: Test individual commands with mock services.

### Command Tests

Every command should have unit tests covering success, validation errors, and service failures:

```rust
// src/commands/items/create.test.rs

#[tokio::test]
async fn test_create_item_success() {
    let ctx = MockAppContext::new();
    let input = CreateItemInput { 
        name: "Test".to_string(),
        data: None,
    };
    
    let result = create_item(&ctx, input).await;
    
    assert!(result.success);
    assert!(result.data.is_some());
    assert_eq!(result.data.unwrap().name, "Test");
}

#[tokio::test]
async fn test_create_item_validation_error() {
    let ctx = MockAppContext::new();
    let input = CreateItemInput { 
        name: "".to_string(),  // Empty name should fail
        data: None,
    };
    
    let result = create_item(&ctx, input).await;
    
    assert!(!result.success);
    assert_eq!(result.error.unwrap().code, "VALIDATION_ERROR");
}

#[tokio::test]
async fn test_create_item_database_error() {
    let mut ctx = MockAppContext::new();
    ctx.database_mut().set_should_fail(true);
    
    let input = CreateItemInput { 
        name: "Test".to_string(),
        data: None,
    };
    
    let result = create_item(&ctx, input).await;
    
    assert!(!result.success);
    assert!(result.error.unwrap().retryable.unwrap_or(false));
}
```

### Mock Service Adapters

```rust
// src/testing/mocks.rs

pub struct MockDatabase {
    data: HashMap<String, Value>,
    should_fail: bool,
    call_log: Vec<MockCall>,
}

impl MockDatabase {
    pub fn new() -> Self {
        Self {
            data: HashMap::new(),
            should_fail: false,
            call_log: Vec::new(),
        }
    }
    
    pub fn set_should_fail(&mut self, fail: bool) {
        self.should_fail = fail;
    }
    
    pub fn seed(&mut self, key: &str, value: Value) {
        self.data.insert(key.to_string(), value);
    }
    
    pub fn calls(&self) -> &[MockCall] {
        &self.call_log
    }
}

#[async_trait]
impl Database for MockDatabase {
    async fn execute(&self, sql: &str, params: &[Value]) -> Result<ExecuteResult, DatabaseError> {
        self.call_log.push(MockCall::Execute { sql: sql.to_string(), params: params.to_vec() });
        
        if self.should_fail {
            return Err(DatabaseError::Connection("Mock failure".to_string()));
        }
        
        Ok(ExecuteResult { rows_affected: 1, last_insert_id: Some(1) })
    }
    // ... other methods
}
```

---

## Layer 3: Integration Tests (Adapters)

**Purpose**: Ensure all service adapters behave identically with real backends.

### Cross-Adapter Parity Tests

The same test suite runs against all adapter implementations:

```rust
// tests/integration/adapter_parity.rs

async fn run_database_parity_tests(db: &dyn Database) {
    // Test 1: Basic CRUD
    db.execute("INSERT INTO items (id, name) VALUES (?, ?)", &["1".into(), "Test".into()]).await.unwrap();
    
    let items: Vec<Item> = db.query("SELECT * FROM items", &[]).await.unwrap();
    assert_eq!(items.len(), 1);
    
    // Test 2: Transaction rollback
    let result = db.transaction(|tx| {
        Box::pin(async move {
            tx.execute("INSERT INTO items (id, name) VALUES (?, ?)", &["2".into(), "Test2".into()]).await?;
            Err(DatabaseError::Custom("Rollback".to_string()))
        })
    }).await;
    
    assert!(result.is_err());
    let items: Vec<Item> = db.query("SELECT * FROM items", &[]).await.unwrap();
    assert_eq!(items.len(), 1); // Rollback should have prevented insert
}

#[tokio::test]
async fn test_sqlite_parity() {
    let db = SqliteDatabase::new(":memory:").await.unwrap();
    setup_schema(&db).await;
    run_database_parity_tests(&db).await;
}

#[tokio::test]
#[ignore]
async fn test_d1_parity() {
    let db = D1Database::new(test_env().d1("DB").unwrap());
    setup_schema(&db).await;
    run_database_parity_tests(&db).await;
}

#[tokio::test]
#[ignore]
async fn test_postgres_parity() {
    let db = PostgresDatabase::connect(&std::env::var("DATABASE_URL").unwrap()).await.unwrap();
    setup_schema(&db).await;
    run_database_parity_tests(&db).await;
}
```

---

## Layer 4: JTBD Scenarios (Behavior)

**Purpose**: Validate complete user workflows end-to-end.

> **Full specification**: [JTBD Testing Framework](../Archive/jtbd-testing/00-overview.plan.md)

### Integration with Rust Distribution

JTBD scenarios are the **top layer** of testing. They depend on all lower layers passing:

```
                    Conformance passes
                           ↓
                      Unit tests pass
                           ↓
                  Integration tests pass
                           ↓
                    JTBD scenarios run
```

### How JTBD Uses Lower Layers

| Lower Layer | JTBD Dependency |
|-------------|-----------------|
| Conformance | Scenarios parse CLI output as JSON |
| Unit Tests | Scenarios assume commands work individually |
| Integration | Scenarios use real services via CLI |

### JTBD Fixture Format

JTBD fixtures can seed integration test databases:

```json
{
  "$schema": "https://afd.dev/schemas/fixture.json",
  "app": "violet",
  "version": "1.0",
  "nodes": [
    { "id": "global-base", "name": "Global Base", "type": "root" }
  ],
  "operations": [
    { "nodeId": "global-base", "type": "add", "token": "color.accent.primary", "value": "#0078D4" }
  ]
}
```

### Running JTBD Scenarios

```bash
# Via AFD CLI
afd scenario run --scenario onboard-product-line --cli "violet --memory"

# Via Mint (aggregates all layers)
mint test --jtbd                    # JTBD scenarios only
mint test --all                     # All layers
mint test --tag smoke               # Smoke tests only
```

---

## CI/CD Pipeline

### Three-Tier Strategy

| Tier | Trigger | Layers | Target Time |
|------|---------|--------|-------------|
| **Smoke** | Every commit | Conformance + Unit | < 30s |
| **Full** | PR + Merge | All 4 layers | < 10m |
| **Nightly** | Scheduled | All + Extended | < 30m |

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  # Layer 1: Conformance (runs on every commit)
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # TypeScript conformance
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm test:conformance
      
      # Python conformance
      - uses: actions/setup-python@v5
      - run: pip install -e python/
      - run: pytest python/tests/test_conformance.py
      
      # Rust conformance
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test conformance

  # Layer 2: Unit tests
  unit-tests:
    needs: conformance
    strategy:
      matrix:
        lang: [typescript, python, rust]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/test-${{ matrix.lang }}.sh

  # Layer 3: Integration tests (PR only)
  integration-tests:
    needs: unit-tests
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - run: cargo test --test integration -- --ignored

  # Layer 4: JTBD scenarios (PR only)
  jtbd-scenarios:
    needs: integration-tests
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install && pnpm build
      - run: afd scenario run --tag affected --cli "violet --memory"
      - run: afd scenario report --format markdown --output report.md
      - uses: actions/upload-artifact@v4
        with:
          name: jtbd-report
          path: report.md

  # Full suite on merge to main
  full-jtbd:
    needs: [conformance, unit-tests]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: afd scenario run --all --cli "violet --memory"

  coverage:
    needs: unit-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo install cargo-tarpaulin
      - run: cargo tarpaulin --out Xml
      - uses: codecov/codecov-action@v4
```

---

## Test Coverage Requirements

| Layer | Area | Minimum | Target |
|-------|------|---------|--------|
| **Conformance** | Core types | 100% | 100% |
| **Unit** | Commands | 80% | 90% |
| **Integration** | Adapters | 70% | 85% |
| **JTBD** | User jobs | 80% command coverage | 95% |

---

## Mint Integration

```bash
# Run all layers
mint test

# Run specific layers
mint test --conformance       # Layer 1 only
mint test --unit              # Layer 2 only
mint test --integration       # Layer 3 only
mint test --jtbd              # Layer 4 only

# Run by tag
mint test --tag smoke         # Fast tests for dev
mint test --tag p0            # Critical path tests

# Coverage report
mint test --coverage

# Watch mode for development
mint test --watch
```

---

## Implementation Phases

### Phase 5.1: Conformance Foundation (Day 1)
- [ ] Create `spec/conformance/` directory
- [ ] Write CommandResult test cases
- [ ] Write CommandError test cases
- [ ] Create TypeScript runner
- [ ] Create Python runner
- [ ] Create Rust runner

### Phase 5.2: Mock Adapters (Day 2)
- [ ] MockDatabase implementation
- [ ] MockStorage implementation
- [ ] MockCache implementation
- [ ] MockQueue implementation
- [ ] MockAuth implementation
- [ ] MockAppContext factory

### Phase 5.3: Integration Test Framework (Day 3)
- [ ] Adapter parity test suite
- [ ] Service integration tests
- [ ] CI configuration for services

### Phase 5.4: JTBD Integration (Day 4)
- [ ] Link to JTBD framework
- [ ] Fixture seeding for integration tests
- [ ] CI workflow for JTBD scenarios

### Phase 5.5: CI/CD Pipeline (Day 5)
- [ ] GitHub Actions workflows (tiered)
- [ ] Coverage reporting
- [ ] Mint CLI integration

---

## Success Criteria

1. **Conformance Passes**: All three languages pass identical test cases
2. **Coverage Met**: Minimum coverage thresholds enforced in CI
3. **Adapter Parity**: All service adapters pass same behavioral tests
4. **JTBD Green**: User job scenarios pass across all heads
5. **Fast Feedback**: Smoke tests complete in < 30 seconds
6. **Clear Reporting**: Failed scenarios produce actionable output
