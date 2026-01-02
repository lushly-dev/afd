# Phase 2: Full Command Suite

> **Goal**: Complete the scenario management command set with creation, listing, evaluation, and coverage.

---

## Overview

Phase 2 expands on the MVP to provide full scenario lifecycle management:

- Create scenarios from templates
- List and filter scenarios
- Batch evaluation with parallel execution
- Coverage metrics

**Success Criteria**: Can manage a library of 20+ scenarios with meaningful coverage metrics.

---

## Commands to Implement

| Command             | Description          | Priority | Status      |
| ------------------- | -------------------- | -------- | ----------- |
| `scenario.create`   | Create from template | P1       | ✅ Complete |
| `scenario.list`     | List all scenarios   | P1       | ✅ Complete |
| `scenario.evaluate` | Batch execution      | P1       | ✅ Complete |
| `scenario.coverage` | Coverage metrics     | P1       | ✅ Complete |

---

## Command Specifications

### scenario.create

Creates a new scenario file from template.

**Input Schema**:

```typescript
interface ScenarioCreateInput {
  /** Scenario name (kebab-case recommended) */
  name: string;

  /** Job this scenario tests */
  job: string;

  /** Human-readable description */
  description: string;

  /** Template to use */
  template?: "basic" | "error-case" | "journey";

  /** Target fixture file */
  fixture?: string;

  /** Output path (default: scenarios/{name}.scenario.yaml) */
  output?: string;

  /** Tags to add */
  tags?: string[];
}
```

**Output Schema**:

```typescript
interface ScenarioCreateOutput {
  /** Path to created file */
  path: string;

  /** Generated scenario */
  scenario: Scenario;
}
```

**CLI Usage**:

```bash
# Basic creation
afd scenario create --name "add-token" --job "add-token" --description "Add a new token to a node"

# With template
afd scenario create --name "invalid-parent" --job "error-handling" --template error-case

# With fixture
afd scenario create --name "override-token" --job "override-token" --fixture "fixtures/product-hierarchy.yaml"
```

**Implementation**:

```typescript
// src/commands/create.ts

export const scenarioCreateCommand: CommandDefinition<
  ScenarioCreateInput,
  ScenarioCreateOutput
> = {
  name: "scenario.create",
  description: "Create a new scenario file",
  category: "testing",

  inputSchema: z.object({
    name: z.string().regex(/^[a-z0-9-]+$/, "Use kebab-case"),
    job: z.string(),
    description: z.string(),
    template: z.enum(["basic", "error-case", "journey"]).default("basic"),
    fixture: z.string().optional(),
    output: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),

  outputSchema: z.object({
    path: z.string(),
    scenario: ScenarioSchema,
  }),

  async handler(input) {
    const template = getTemplate(input.template);
    const scenario = {
      ...template,
      name: formatName(input.name),
      description: input.description,
      job: input.job,
      tags: input.tags,
      fixture: input.fixture ? { file: input.fixture } : template.fixture,
    };

    const outputPath = input.output ?? `scenarios/${input.name}.scenario.yaml`;
    await fs.writeFile(outputPath, yaml.stringify(scenario));

    return {
      success: true,
      data: { path: outputPath, scenario },
      reasoning: `Created scenario "${input.name}" from ${input.template} template`,
    };
  },
};
```

---

### scenario.list

Lists available scenarios with filtering.

**Input Schema**:

```typescript
interface ScenarioListInput {
  /** Filter by job */
  job?: string;

  /** Filter by tags (AND logic) */
  tags?: string[];

  /** Filter by status (last run) */
  status?: "passed" | "failed" | "never-run";

  /** Scenario directory */
  directory?: string;

  /** Output format */
  format?: "table" | "json" | "names";
}
```

**Output Schema**:

```typescript
interface ScenarioListOutput {
  /** Total count */
  total: number;

  /** Filtered count */
  filtered: number;

  /** Scenario summaries */
  scenarios: ScenarioSummary[];
}

interface ScenarioSummary {
  name: string;
  job: string;
  tags: string[];
  lastRun?: string;
  lastStatus?: "passed" | "failed" | "skipped";
  stepCount: number;
}
```

**CLI Usage**:

```bash
# List all scenarios
afd scenario list

# Filter by job
afd scenario list --job "token-management"

# Filter by tag
afd scenario list --tags "smoke"

# Filter by status
afd scenario list --status failed

# Output as table
afd scenario list --format table
```

**Implementation**:

```typescript
// src/commands/list.ts

export const scenarioListCommand: CommandDefinition<
  ScenarioListInput,
  ScenarioListOutput
> = {
  name: "scenario.list",
  description: "List available scenarios",
  category: "testing",

  inputSchema: z.object({
    job: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["passed", "failed", "never-run"]).optional(),
    directory: z.string().default("scenarios"),
    format: z.enum(["table", "json", "names"]).default("table"),
  }),

  async handler(input) {
    const allScenarios = await loadAllScenarios(input.directory);
    const history = await loadRunHistory();

    let filtered = allScenarios;

    // Apply filters
    if (input.job) {
      filtered = filtered.filter((s) => s.job === input.job);
    }
    if (input.tags?.length) {
      filtered = filtered.filter((s) =>
        input.tags!.every((tag) => s.tags.includes(tag))
      );
    }
    if (input.status) {
      filtered = filtered.filter((s) => {
        const lastRun = history.get(s.name);
        if (input.status === "never-run") return !lastRun;
        return lastRun?.status === input.status;
      });
    }

    const summaries = filtered.map((s) => ({
      name: s.name,
      job: s.job,
      tags: s.tags,
      lastRun: history.get(s.name)?.timestamp,
      lastStatus: history.get(s.name)?.status,
      stepCount: s.steps.length,
    }));

    return {
      success: true,
      data: {
        total: allScenarios.length,
        filtered: summaries.length,
        scenarios: summaries,
      },
    };
  },
};
```

---

### scenario.evaluate

Runs multiple scenarios with parallel execution.

**Input Schema**:

```typescript
interface ScenarioEvaluateInput {
  /** CLI command prefix */
  cli: string;

  /** Specific scenarios to run (default: all) */
  scenarios?: string[];

  /** Filter by job */
  job?: string;

  /** Filter by tags */
  tags?: string[];

  /** Concurrency limit */
  concurrency?: number;

  /** Stop on first failure */
  failFast?: boolean;

  /** Output format */
  format?: "terminal" | "json" | "junit" | "markdown";

  /** Output file */
  output?: string;
}
```

**Output Schema**:

```typescript
interface ScenarioEvaluateOutput {
  /** Test report */
  report: TestReport;

  /** Exit code recommendation */
  exitCode: number;
}
```

**CLI Usage**:

```bash
# Run all scenarios
afd scenario evaluate --cli "violet --memory"

# Run specific scenarios
afd scenario evaluate --cli "violet --memory" --scenarios "add-token,override-token"

# Run by tag
afd scenario evaluate --cli "violet --memory" --tags "smoke"

# Parallel execution
afd scenario evaluate --cli "violet --memory" --concurrency 4

# Fail fast
afd scenario evaluate --cli "violet --memory" --fail-fast

# Output to file
afd scenario evaluate --cli "violet --memory" --format junit --output test-results.xml
```

**Implementation**:

```typescript
// src/commands/evaluate.ts

import pLimit from "p-limit";

export const scenarioEvaluateCommand: CommandDefinition<
  ScenarioEvaluateInput,
  ScenarioEvaluateOutput
> = {
  name: "scenario.evaluate",
  description: "Run multiple scenarios",
  category: "testing",

  inputSchema: z.object({
    cli: z.string(),
    scenarios: z.array(z.string()).optional(),
    job: z.string().optional(),
    tags: z.array(z.string()).optional(),
    concurrency: z.number().min(1).max(10).default(1),
    failFast: z.boolean().default(false),
    format: z
      .enum(["terminal", "json", "junit", "markdown"])
      .default("terminal"),
    output: z.string().optional(),
  }),

  async handler(input) {
    // Load and filter scenarios
    let scenarios = await loadAllScenarios();

    if (input.scenarios) {
      scenarios = scenarios.filter((s) => input.scenarios!.includes(s.name));
    }
    if (input.job) {
      scenarios = scenarios.filter((s) => s.job === input.job);
    }
    if (input.tags?.length) {
      scenarios = scenarios.filter((s) =>
        input.tags!.every((tag) => s.tags.includes(tag))
      );
    }

    // Sort by dependencies
    scenarios = topologicalSort(scenarios);

    // Execute with concurrency
    const limit = pLimit(input.concurrency);
    const results: ScenarioResult[] = [];
    let shouldStop = false;

    const tasks = scenarios.map((scenario) =>
      limit(async () => {
        if (shouldStop) {
          return {
            scenario: scenario.name,
            status: "skipped" as const,
            duration: 0,
            steps: [],
          };
        }

        const result = await executeScenario(scenario, { cli: input.cli });
        results.push(result);

        if (result.status === "failed" && input.failFast) {
          shouldStop = true;
        }

        return result;
      })
    );

    await Promise.all(tasks);

    // Generate report
    const report = generateReport(results);

    // Output
    if (input.output) {
      await writeReport(report, input.format, input.output);
    }

    return {
      success: report.failed === 0,
      data: {
        report,
        exitCode: report.failed > 0 ? 1 : 0,
      },
      reasoning: `${report.passed}/${report.total} scenarios passed`,
    };
  },
};
```

---

### scenario.coverage

Reports coverage metrics across multiple dimensions.

**Input Schema**:

```typescript
interface ScenarioCoverageInput {
  /** CLI to analyze commands from */
  cli: string;

  /** Scenario directory */
  directory?: string;

  /** Coverage dimensions */
  dimensions?: Array<"commands" | "errors" | "jobs">;

  /** Include detailed breakdown */
  detailed?: boolean;

  /** Output format */
  format?: "terminal" | "json" | "badge";
}
```

**Output Schema**:

```typescript
interface ScenarioCoverageOutput {
  /** Overall coverage percentage */
  overall: number;

  /** Coverage by dimension */
  dimensions: {
    commands?: CommandCoverage;
    errors?: ErrorCoverage;
    jobs?: JobCoverage;
  };

  /** Uncovered items */
  gaps: CoverageGap[];
}

interface CommandCoverage {
  /** Percentage of commands covered */
  percentage: number;

  /** Commands covered */
  covered: string[];

  /** Commands not covered */
  uncovered: string[];
}

interface ErrorCoverage {
  /** Percentage of error codes covered */
  percentage: number;

  /** Error codes tested */
  covered: string[];

  /** Error codes not tested */
  uncovered: string[];
}

interface JobCoverage {
  /** Percentage of defined jobs covered */
  percentage: number;

  /** Jobs with scenarios */
  covered: string[];

  /** Jobs without scenarios */
  uncovered: string[];
}

interface CoverageGap {
  /** Dimension */
  dimension: "command" | "error" | "job";

  /** What's missing */
  item: string;

  /** Suggested scenario */
  suggestion?: string;
}
```

**CLI Usage**:

```bash
# Full coverage report
afd scenario coverage --cli "violet --memory"

# Specific dimensions
afd scenario coverage --cli "violet --memory" --dimensions commands,errors

# Detailed breakdown
afd scenario coverage --cli "violet --memory" --detailed

# Generate badge
afd scenario coverage --cli "violet --memory" --format badge --output coverage.svg
```

**Implementation**:

```typescript
// src/commands/coverage.ts

export const scenarioCoverageCommand: CommandDefinition<
  ScenarioCoverageInput,
  ScenarioCoverageOutput
> = {
  name: "scenario.coverage",
  description: "Calculate test coverage",
  category: "testing",

  inputSchema: z.object({
    cli: z.string(),
    directory: z.string().default("scenarios"),
    dimensions: z
      .array(z.enum(["commands", "errors", "jobs"]))
      .default(["commands", "errors", "jobs"]),
    detailed: z.boolean().default(false),
    format: z.enum(["terminal", "json", "badge"]).default("terminal"),
  }),

  async handler(input) {
    // Get available commands from CLI
    const availableCommands = await getAvailableCommands(input.cli);
    const errorCodes = await getErrorCodes(input.cli);
    const definedJobs = await getDefinedJobs();

    // Load scenarios
    const scenarios = await loadAllScenarios(input.directory);

    // Extract coverage data
    const usedCommands = new Set<string>();
    const testedErrors = new Set<string>();
    const coveredJobs = new Set<string>();

    for (const scenario of scenarios) {
      coveredJobs.add(scenario.job);

      for (const step of scenario.steps) {
        const command = parseCommand(step.command);
        usedCommands.add(command);

        if (step.expect.error?.code) {
          testedErrors.add(step.expect.error.code);
        }
      }
    }

    // Calculate metrics
    const commandCoverage = calculateCoverage(availableCommands, usedCommands);
    const errorCoverage = calculateCoverage(errorCodes, testedErrors);
    const jobCoverage = calculateCoverage(definedJobs, coveredJobs);

    // Identify gaps
    const gaps: CoverageGap[] = [];

    for (const cmd of commandCoverage.uncovered) {
      gaps.push({
        dimension: "command",
        item: cmd,
        suggestion: `Create scenario testing "${cmd}"`,
      });
    }

    for (const error of errorCoverage.uncovered) {
      gaps.push({
        dimension: "error",
        item: error,
        suggestion: `Create error scenario triggering "${error}"`,
      });
    }

    // Calculate overall
    const overall =
      commandCoverage.percentage * 0.4 +
      errorCoverage.percentage * 0.3 +
      jobCoverage.percentage * 0.3;

    return {
      success: true,
      data: {
        overall,
        dimensions: {
          commands: input.dimensions.includes("commands")
            ? commandCoverage
            : undefined,
          errors: input.dimensions.includes("errors")
            ? errorCoverage
            : undefined,
          jobs: input.dimensions.includes("jobs") ? jobCoverage : undefined,
        },
        gaps,
      },
      reasoning: `Overall coverage: ${overall.toFixed(1)}%`,
    };
  },
};
```

---

## Report Formats

### Terminal Report

```
JTBD Scenario Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Onboard New Product Line              245ms
✓ Override Token for Platform           189ms
✓ Export Tokens to CSS                  312ms
✗ Invalid Parent Reference               45ms
  └─ Step 2 failed: Expected NODE_NOT_FOUND, got success

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Scenarios: 4 total, 3 passed, 1 failed
Duration: 791ms
Coverage: 87% commands, 62% errors, 100% jobs
```

### JUnit XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="JTBD Scenarios" tests="4" failures="1" time="0.791">
  <testsuite name="token-management" tests="2" failures="0">
    <testcase name="Onboard New Product Line" time="0.245"/>
    <testcase name="Override Token for Platform" time="0.189"/>
  </testsuite>
  <testsuite name="export" tests="1" failures="0">
    <testcase name="Export Tokens to CSS" time="0.312"/>
  </testsuite>
  <testsuite name="error-handling" tests="1" failures="1">
    <testcase name="Invalid Parent Reference" time="0.045">
      <failure message="Step 2 failed">Expected NODE_NOT_FOUND, got success</failure>
    </testcase>
  </testsuite>
</testsuites>
```

### Markdown Report

```markdown
# JTBD Scenario Results

**Date**: 2025-01-15 14:32:00  
**Duration**: 791ms  
**Result**: 3/4 passed (75%)

## Summary

| Status     | Count |
| ---------- | ----- |
| ✅ Passed  | 3     |
| ❌ Failed  | 1     |
| ⏭️ Skipped | 0     |

## Failed Scenarios

### Invalid Parent Reference

- **Job**: error-handling
- **Failed Step**: Step 2
- **Expected**: `NODE_NOT_FOUND` error
- **Actual**: Command succeeded

## Coverage

- Commands: 87% (26/30)
- Error Paths: 62% (8/13)
- Jobs: 100% (5/5)
```

---

## Test Cases

| Test               | Description                                   |
| ------------------ | --------------------------------------------- |
| `create.test.ts`   | Template selection, path generation           |
| `list.test.ts`     | Filtering, sorting, history lookup            |
| `evaluate.test.ts` | Parallel execution, fail-fast, output formats |
| `coverage.test.ts` | Metric calculation, gap identification        |
| `snapshot.test.ts` | Snapshot comparison, update workflow          |

---

## Snapshot Updates

Add `--update-snapshots` flag to `scenario.run` (similar to Jest):

```bash
# Run scenario and update snapshots if they differ
afd scenario run --scenario onboard-product-line --cli "violet --memory" --update-snapshots
```

**Implementation in `scenario.run`:**

```typescript
interface ScenarioRunInput {
  // ... existing fields
  
  /** Update snapshots if they differ from actual */
  updateSnapshots?: boolean;
}

// In executor, after all steps pass:
if (options.updateSnapshots && scenario.verify?.snapshot) {
  const actualState = await captureState(options.cli);
  await fs.writeFile(scenario.verify.snapshot, JSON.stringify(actualState, null, 2));
  console.log(`  📸 Updated snapshot: ${scenario.verify.snapshot}`);
}
```

**Workflow for developers:**

1. Run scenario → fails due to snapshot mismatch
2. Review the diff in the report
3. If changes are intentional: `afd scenario run --scenario foo --update-snapshots`
4. Commit updated snapshot

**Workflow for agents:**

```typescript
// Agent can ask user before updating
const result = await scenario_run({ scenario: "foo", cli: "violet --memory" });
if (result.error?.code === "SNAPSHOT_MISMATCH") {
  // Ask user: "Snapshot differs. Should I update it?"
  // If yes: await scenario_run({ ...same, updateSnapshots: true });
}
```

---

## Assertion DSL Reference

Document the full assertion syntax for scenarios:

| Syntax | Example | Description |
|--------|---------|-------------|
| **Exact match** | `data.id: "xbox"` | Value equals exactly |
| **Nested path** | `data.tokens.color.value: "#107C10"` | JSONPath navigation |
| **Contains** | `reasoning: contains "override"` | String contains substring |
| **Matches** | `reasoning: matches "Created.*node"` | Regex pattern match |
| **Length** | `data.nodes: length 3` | Array length equals |
| **Includes** | `data.nodes: includes "xbox"` | Array contains value |
| **Array index** | `data.nodes[0].id: "global"` | Access by index |
| **Greater/equal** | `data.count: gte 5` | Numeric comparison |
| **Less/equal** | `data.count: lte 10` | Numeric comparison |
| **Between** | `data.rate: between 0.9 1.0` | Range (inclusive) |
| **Exists** | `data.createdAt: exists` | Field is present |
| **Not exists** | `data.deletedAt: not_exists` | Field is absent |

**Implementation notes:**

- Assertions are evaluated left-to-right
- First failure stops evaluation (fail-fast)
- All assertions logged in verbose mode

---

## Files to Create/Update

```
packages/testing/src/
├── commands/
│   ├── create.ts          # NEW
│   ├── list.ts            # NEW
│   ├── evaluate.ts        # NEW
│   ├── coverage.ts        # NEW
│   └── index.ts           # UPDATE
├── reporters/
│   ├── terminal.ts        # NEW
│   ├── junit.ts           # NEW
│   ├── markdown.ts        # NEW
│   └── badge.ts           # NEW
├── analyzers/
│   ├── command-parser.ts  # NEW
│   └── coverage.ts        # NEW
└── templates/
    ├── basic.yaml         # NEW
    ├── error-case.yaml    # NEW
    └── journey.yaml       # NEW
```

---

## Dependencies

**Blocks**: Phase 3 (Agent Integration)

**Blocked by**: Phase 1 (Core Framework)

**New dependencies**:

- `p-limit` - Concurrency control
- `badge-maker` - SVG badge generation

---

## Estimated Effort

| Task                     | Estimate      |
| ------------------------ | ------------- |
| scenario.create          | 2 hours       |
| scenario.list            | 2 hours       |
| scenario.evaluate        | 4 hours       |
| scenario.coverage        | 4 hours       |
| Snapshot update workflow | 2 hours       |
| Report formatters        | 3 hours       |
| Templates                | 1 hour        |
| Tests                    | 3 hours       |
| **Total**                | **~21 hours** |

---

## Next Phase

After Phase 2:

- [Phase 3: Agent Integration](./03-agent-integration.plan.md)
