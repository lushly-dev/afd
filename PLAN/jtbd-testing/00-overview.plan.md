# JTBD Testing Framework - Overview

> **Goal**: Provide a reusable, agent-first testing framework for validating complete user workflows (Jobs-to-Be-Done) across any AFD application via CLI.

---

## Vision

Traditional testing focuses on isolated units. JTBD testing validates **complete user journeys**—the actual jobs users hire software to do.

```
Traditional:  test(function) → mock dependencies → assert output
JTBD:         seed(state) → run(workflow) → verify(outcome)
```

AFD makes this natural: **if all functionality is CLI-accessible, we can script and verify entire workflows without UI dependencies.**

### Core Insight

> "If it works via CLI, it works everywhere."

JTBD scenarios ARE the specification. They document what the system does, prove it works, and serve as regression tests—all in one artifact.

---

## The Problem

| Current State         | Pain                                           |
| --------------------- | ---------------------------------------------- |
| Unit tests pass       | But user workflows break                       |
| 80% code coverage     | But critical paths untested                    |
| Tests are brittle     | Because they test implementation, not behavior |
| Tests require mocks   | So they miss integration issues                |
| Tests written by devs | So they miss user mental models                |

**The gap**: Tests verify code correctness, not job completion.

---

## The Solution: JTBD Scenario Testing

### What is a JTBD Scenario?

A JTBD scenario describes:

1. **The Job** – What the user is trying to accomplish
2. **The Starting State** – Fixture/seed data
3. **The Steps** – CLI commands in sequence
4. **The Expected Outcome** – Verifiable end state

### Example Scenario

```yaml
# scenarios/onboard-product-line.scenario.yaml
name: Onboard New Product Line
description: >
  As a design system manager, I want to create a new product line
  so that product teams have a customized token set that inherits from global.

job: product-onboarding
tags: [core, onboarding, p0]

fixture: fixtures/global-base.json

steps:
  - command: node create --name xbox --parent global-base --type product
    expect:
      success: true
      data.id: xbox

  - command: token add --node xbox --token color.xbox.green --value "#107C10"
    expect:
      success: true

  - command: token override --node xbox --token color.accent.primary --value "#107C10"
    expect:
      success: true
      reasoning: contains "override"

  - command: tokens xbox
    expect:
      success: true
      data.tokens.color.xbox.green.value: "#107C10"
      data.tokens.color.accent.primary.source: xbox

verify:
  snapshot: snapshots/xbox-onboarded.json
  assertions:
    - node "xbox" exists
    - node "xbox" has 2 local operations
    - token "color.accent.primary" resolves to "#107C10"
```

---

## Success Criteria

| Criteria           | Measurement                                    |
| ------------------ | ---------------------------------------------- |
| **Reusability**    | Works for Violet, Noisett, and future AFD apps |
| **Agent-First**    | Scenarios can be created, run, evaluated by AI |
| **Human-Readable** | Non-developers can understand scenarios        |
| **Fast**           | Full suite runs in < 60 seconds                |
| **Isolated**       | Each scenario runs in fresh state              |
| **CI-Ready**       | Integrates with GitHub Actions                 |

---

## Architecture

```
@afd/testing
├── Core Types
│   ├── Scenario          # Job definition
│   ├── Fixture           # Starting state
│   ├── Step              # CLI command + expectations
│   ├── Expectation       # Assertion definitions
│   └── Report            # Execution results
│
├── Commands (AFD-style)
│   ├── scenario.create   # Parse natural language → scenario
│   ├── scenario.run      # Execute scenario via CLI
│   ├── scenario.evaluate # Compare actual vs expected
│   ├── scenario.report   # Generate human-readable summary
│   ├── scenario.list     # List all scenarios
│   ├── scenario.suggest  # AI suggests missing scenarios
│   └── scenario.coverage # Report coverage metrics
│
├── CLI
│   └── afd test          # Run scenarios
│
└── Adapters
    ├── violet            # Violet-specific fixture/assertion helpers
    ├── noisett           # Noisett-specific helpers
    └── generic           # App-agnostic fallback (extensible for future apps)
```

---

## Key Design Decisions

### 1. AFD Methodology, Not App-Specific

The testing framework lives in `@afd/testing`, not in Violet or Noisett. Benefits:

- Reusable across all AFD projects
- Forces good abstraction
- Testing framework itself follows AFD patterns

### 2. Agent-First Test Management

The testing framework IS an AFD application:

- All operations exposed as commands
- MCP-accessible for AI integration
- AI can generate, run, and evaluate scenarios

```
Human: "Create a scenario for updating brand colors"
Agent: → scenario.create --job "update-brand-colors" --description "..."
       → scenario.run --scenario update-brand-colors
       → scenario.report --format markdown
Human: Reviews report
```

### 3. Fixture Per JTBD

Each job gets its own fixture directory:

```
scenarios/
├── jobs/
│   ├── onboard-product-line/
│   │   ├── fixture.json       # Starting state
│   │   ├── scenario.yaml      # Steps + expectations
│   │   └── snapshot.json      # Expected end state
│   ├── update-brand-colors/
│   └── export-for-release/
└── shared/
    └── global-base.fixture.json
```

Benefits:

- Isolation between jobs
- Clear naming (fixture = job = test)
- Easy to add new jobs over time

### 4. Fresh State by Default

Each scenario runs against a fresh database:

```yaml
isolation: fresh # Default: seed fixture, run, tear down
```

Opt-in chaining for journey tests:

```yaml
isolation: chained
depends_on:
  - onboard-product-line # Must run first
```

**Rationale**: Fresh state enables parallelization, debugging, and CI reliability.

### 5. Three-Tier CI Strategy

| Tier         | Trigger       | Scenarios                        | Target Time |
| ------------ | ------------- | -------------------------------- | ----------- |
| **Smoke**    | Every commit  | 3-5 critical paths               | < 30s       |
| **Affected** | Every PR      | Scenarios using changed commands | < 2min      |
| **Full**     | Merge to main | All scenarios                    | < 10min     |

Scenarios are fast (<1s each) because they run against in-memory databases.

### 6. File Format Conventions

| File Type | Format | Purpose |
|-----------|--------|---------|
| Scenarios | YAML (`.scenario.yaml`) | Human-readable workflow definitions |
| Fixtures | JSON (`.fixture.json`) | Structured seed data for databases |
| Snapshots | JSON (`.snapshot.json`) | Expected end-state for verification |

**Why YAML for scenarios?** Scenarios are documentation as much as tests. YAML's readability and support for multi-line strings makes them easier to write and review.

**Why JSON for fixtures/snapshots?** Fixtures are data, not documentation. JSON is unambiguous, easily validated against schemas, and directly usable by code.

### 7. Command Distinction

| Command | Purpose | Scope |
|---------|---------|-------|
| `scenario.run` | Execute a **single** scenario | One scenario, detailed output |
| `scenario.evaluate` | Execute **multiple** scenarios | Batch, parallel, CI-focused |

`scenario.run` is for development and debugging. `scenario.evaluate` is for CI and coverage reports.

---

## Scenario Schema

### Full Schema Definition

```yaml
# scenario.schema.yaml
name: string # Human-readable name
description: string # What job this accomplishes (user story)
job: string # Job identifier (kebab-case)
tags: string[] # Categorization [core, p0, regression, etc.]
version: string # Schema version (e.g., "1.0")

# Starting state
fixture:
  file: string # Path to fixture JSON
  base: string? # Optional: inherit from shared fixture
  overrides: object? # Optional: inline modifications

# Execution
isolation: fresh | chained # Default: fresh
depends_on: string[]? # Only if chained
timeout: number? # Per-scenario timeout (ms)

# Steps
steps:
  - command: string # CLI command to run
    description: string? # Optional: explain this step
    expect:
      success: boolean # Required: did command succeed?
      data: object? # JSONPath assertions on data
      error: object? # Expected error (for failure tests)
      reasoning: string? # Pattern match on reasoning field
    continue_on_failure: bool? # Default: false

# Final verification
verify:
  snapshot: string? # Path to expected state snapshot
  assertions: string[] # Human-readable assertions
  custom: string? # Path to custom verification script
```

### Assertion Syntax

```yaml
expect:
  # Exact match
  success: true
  data.id: "xbox"

  # Nested path
  data.tokens.color.accent.primary.value: "#107C10"

  # Pattern matching
  reasoning: contains "override"
  reasoning: matches "Created.*node"

  # Array assertions
  data.nodes: length 3
  data.nodes: includes "xbox"
  data.nodes[0].id: "global-base"

  # Numeric comparisons
  data.count: gte 5
  data.compliance: between 0.9 1.0

  # Existence
  data.createdAt: exists
  data.deletedAt: not_exists
```

---

## Commands Specification

### scenario.create

Parse natural language or structured input into a scenario file.

```bash
# From natural language
afd scenario create --job "onboard-product" \
  --description "Create Xbox product line with brand colors" \
  --steps "create node, add tokens, verify inheritance"

# From template
afd scenario create --template product-onboarding --name xbox

# Interactive (agent-guided)
afd scenario create --interactive
```

**Input Schema:**

```typescript
interface ScenarioCreateInput {
  job: string;
  description: string;
  template?: string;
  steps?: string[];
  fixture?: string;
  output?: string; // Where to save
}
```

**Output:**

```typescript
interface ScenarioCreateOutput {
  path: string; // Where scenario was saved
  scenario: Scenario; // Parsed scenario object
  suggestions?: string[]; // AI suggestions for improvement
}
```

### scenario.run

Execute a scenario against the target application.

```bash
# Run single scenario
afd scenario run --scenario onboard-product-line

# Run by tag
afd scenario run --tag p0

# Run all
afd scenario run --all

# Run with specific app CLI
afd scenario run --scenario onboard-product-line --cli "violet --memory"
```

**Input Schema:**

```typescript
interface ScenarioRunInput {
  scenario?: string; // Scenario name or path
  tag?: string; // Run all with tag
  all?: boolean; // Run all scenarios
  cli: string; // CLI command prefix (e.g., "violet --memory")
  parallel?: boolean; // Run in parallel (default: false)
  timeout?: number; // Override default timeout
  verbose?: boolean; // Show step-by-step output
}
```

**Output:**

```typescript
interface ScenarioRunOutput {
  scenario: string;
  status: "passed" | "failed" | "skipped" | "timeout";
  duration: number; // ms
  steps: StepResult[];
  error?: {
    step: number;
    command: string;
    expected: any;
    actual: any;
    diff?: string;
  };
}
```

### scenario.evaluate

Compare actual execution results against expected outcomes.

```bash
afd scenario evaluate --scenario onboard-product-line --results results.json
```

### scenario.report

Generate human-readable reports from execution results.

```bash
# Markdown report
afd scenario report --format markdown --output report.md

# JSON for CI
afd scenario report --format json --output report.json

# Terminal summary
afd scenario report --format terminal
```

**Report Contents:**

````markdown
# JTBD Scenario Report

## Summary

- **Total**: 12 scenarios
- **Passed**: 11 (92%)
- **Failed**: 1
- **Duration**: 8.3s

## Failed Scenarios

### ❌ update-brand-colors

**Step 3 failed**: `token override --node xbox --token color.accent.primary`

Expected:

```json
{ "success": true, "data": { "source": "xbox" } }
```
````

Actual:

```json
{ "success": false, "error": { "code": "TOKEN_NOT_FOUND" } }
```

**Suggestion**: Ensure token exists at ancestor before overriding.

## Coverage

- Commands: 35/35 (100%)
- Error paths: 89/112 (79%)
- Jobs defined: 12

````

### scenario.list

List all available scenarios with status.

```bash
afd scenario list
afd scenario list --tag p0
afd scenario list --job onboard
````

### scenario.suggest

AI suggests missing scenarios based on command analysis.

```bash
afd scenario suggest --app violet
```

**Output:**

```yaml
suggestions:
  - job: webhook-failure-handling
    reason: "webhooks.test command has no failure scenario"
    priority: high

  - job: circular-reference-prevention
    reason: "NODE_CIRCULAR_REFERENCE error path untested"
    priority: medium
```

### scenario.coverage

Report coverage metrics across three dimensions.

```bash
afd scenario coverage --app violet
```

**Output:**

```yaml
coverage:
  commands:
    total: 35
    covered: 28
    percentage: 80%
    missing:
      - webhooks.test
      - webhooks.logs

  error_paths:
    total: 112
    covered: 89
    percentage: 79%
    missing:
      - NODE_CIRCULAR_REFERENCE
      - CONSTRAINT_CONFLICT

  jobs:
    defined: 12
    passing: 11
    percentage: 92%
```

---

## Fixture Format

Fixtures are app-specific JSON files that seed the database.

### Violet Fixture Example

```json
{
  "$schema": "https://afd.dev/schemas/fixture.json",
  "app": "violet",
  "version": "1.0",
  "description": "Global base with common tokens",

  "nodes": [
    {
      "id": "global-base",
      "name": "Global Base",
      "type": "root",
      "parentId": null
    }
  ],

  "operations": [
    {
      "nodeId": "global-base",
      "type": "add",
      "token": "color.accent.primary",
      "value": "#0078D4"
    },
    {
      "nodeId": "global-base",
      "type": "add",
      "token": "color.background.primary",
      "value": "#FFFFFF"
    }
  ],

  "constraints": [
    {
      "nodeId": "global-base",
      "id": "brand-colors",
      "type": "enum",
      "tokens": ["color.accent.*"],
      "values": ["#0078D4", "#107C10", "#FFB900"]
    }
  ]
}
```

### Noisett Fixture Example

```json
{
  "$schema": "https://afd.dev/schemas/fixture.json",
  "app": "noisett",
  "version": "1.0",
  "description": "Base models and pending job",

  "models": [
    {
      "id": "flux-schnell",
      "name": "FLUX Schnell",
      "provider": "fireworks",
      "status": "active"
    }
  ],

  "jobs": [
    {
      "id": "job_pending_001",
      "status": "pending",
      "prompt": "A cloud computing concept illustration",
      "model": "flux-schnell"
    }
  ]
}
```

### Fixture Inheritance

```yaml
fixture:
  base: shared/global-base.fixture.json
  overrides:
    nodes:
      - id: xbox
        name: Xbox
        type: product
        parentId: global-base
```

---

## Implementation Phases

### Phase 1: Core Framework (MVP)

**Goal**: Basic scenario running and reporting.

| Task            | Description                                            | Status      |
| --------------- | ------------------------------------------------------ | ----------- |
| Types           | `Scenario`, `Fixture`, `Step`, `Expectation`, `Report` | ✅ Complete |
| CLI wrapper     | Run commands, capture structured output                | ✅ Complete |
| scenario.run    | Execute single scenario                                | ✅ Complete |
| scenario.report | Terminal output                                        | ✅ Complete |
| Violet adapter  | Fixture loader for Violet                              | ✅ Complete |

**Deliverable**: Can run one Violet scenario via CLI.

### Phase 2: Full Command Suite

**Goal**: Complete JTBD testing commands.

| Task                | Description                   | Status      |
| ------------------- | ----------------------------- | ----------- |
| scenario.create     | Generate scenarios from input | ✅ Complete |
| scenario.list       | List scenarios with filters   | ✅ Complete |
| scenario.evaluate   | Detailed comparison           | ✅ Complete |
| scenario.coverage   | Three-dimension metrics       | ✅ Complete |
| YAML parser         | Parse scenario files          | ✅ Complete |
| Snapshot comparison | Diff actual vs expected       | ✅ Complete |

**Deliverable**: Full scenario management workflow.

### Phase 3: Agent Integration

**Goal**: AI can manage scenarios.

| Task              | Description             | Status      |
| ----------------- | ----------------------- | ----------- |
| MCP tools         | Expose commands via MCP | ✅ Complete |
| scenario.suggest  | AI gap analysis         | ✅ Complete |
| Agent hints       | AI-friendly metadata    | ✅ Complete |
| Report generation | AI-friendly output      | ✅ Complete |

**Deliverable**: AI can create, run, and analyze scenarios.

### Phase 4: Multi-App Support

**Goal**: Works for any AFD application.

| Task              | Description                | Status      |
| ----------------- | -------------------------- | ----------- |
| Noisett adapter   | Fixture loader for Noisett | Not Started |
| Violas adapter    | Fixture loader for Violas  | Not Started |
| Generic adapter   | App-agnostic fallback      | Not Started |
| Schema validation | Validate fixture format    | Not Started |

**Deliverable**: Reusable across AFD ecosystem.

---

## Package Structure

```
packages/testing/
├── package.json
├── tsconfig.json
├── README.md
│
├── src/
│   ├── index.ts              # Public exports
│   │
│   ├── types/
│   │   ├── scenario.ts       # Scenario, Step, Expectation
│   │   ├── fixture.ts        # Fixture types
│   │   ├── report.ts         # Report types
│   │   └── index.ts
│   │
│   ├── commands/
│   │   ├── create.ts         # scenario.create
│   │   ├── run.ts            # scenario.run
│   │   ├── evaluate.ts       # scenario.evaluate
│   │   ├── report.ts         # scenario.report
│   │   ├── list.ts           # scenario.list
│   │   ├── suggest.ts        # scenario.suggest
│   │   ├── coverage.ts       # scenario.coverage
│   │   └── index.ts
│   │
│   ├── runner/
│   │   ├── cli-wrapper.ts    # Execute CLI commands
│   │   ├── executor.ts       # Run scenario steps
│   │   ├── evaluator.ts      # Compare results
│   │   └── reporter.ts       # Generate reports
│   │
│   ├── parsers/
│   │   ├── yaml.ts           # Parse scenario YAML
│   │   ├── fixture.ts        # Parse fixture JSON
│   │   └── assertions.ts     # Parse assertion syntax
│   │
│   ├── adapters/
│   │   ├── violet.ts         # Violet-specific logic
│   │   ├── noisett.ts        # Noisett-specific logic
│   │   └── generic.ts        # App-agnostic fallback
│   │
│   └── utils/
│       ├── diff.ts           # Snapshot diffing
│       ├── jsonpath.ts       # JSONPath queries
│       └── patterns.ts       # String pattern matching
│
└── tests/
    ├── commands/
    ├── runner/
    └── fixtures/
```

---

## CI Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/jtbd-tests.yml
name: JTBD Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - run: afd scenario run --tag smoke --cli "violet --memory"

  full:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm build
      - run: afd scenario run --all --cli "violet --memory"
      - run: afd scenario report --format markdown --output report.md
      - uses: actions/upload-artifact@v4
        with:
          name: jtbd-report
          path: report.md
```

### Affected Scenarios Detection

```yaml
affected:
  runs-on: ubuntu-latest
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - run: |
        # Get changed files
        CHANGED=$(git diff --name-only origin/main...HEAD)

        # Extract affected commands
        COMMANDS=$(echo "$CHANGED" | grep "commands/" | xargs -I {} basename {} .ts)

        # Run affected scenarios
        afd scenario run --commands "$COMMANDS" --cli "violet --memory"
```

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| **Fixture format** | JSON only. YAML for scenarios, JSON for data. |
| **Snapshot updates** | `--update-snapshots` flag on `scenario.run` (like Jest). |
| **Cross-app failures** | Configurable per scenario via `on_failure: stop \| continue \| rollback`. |

## Open Questions

1. **Assertion language** – JSONPath is powerful but verbose. Custom DSL for common patterns?
2. **Parallel execution** – How to handle shared state in parallel runs? (Current: fresh isolation by default)
3. **Debugging** – Interactive step-through for failed scenarios? (Future: `scenario.debug` command)

---

## References

- [AFD Philosophy](../philosophy.md)
- [Command Schema Guide](../command-schema-guide.md)
- [Trust Through Validation](../trust-through-validation.md)
- [Violet Implementation](../../../../dsas/AGENTS.md)
- [Noisett Implementation](../../../../Noisett/AGENTS.md)
