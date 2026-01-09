# Phase 1: Core Framework (MVP)

> **Goal**: Basic scenario running and reporting for Violet as the first consumer.

---

## Overview

Phase 1 delivers the minimum viable JTBD testing framework:

- Parse YAML scenario files
- Execute commands via CLI wrapper
- Compare results against expectations
- Generate pass/fail reports

**Success Criteria**: Can run one Violet scenario and get a meaningful report.

---

## Commands to Implement

| Command           | Description             | Priority | Status      |
| ----------------- | ----------------------- | -------- | ----------- |
| `scenario.run`    | Execute single scenario | P0       | ✅ Complete |
| `scenario.report` | Terminal output         | P0       | ✅ Complete |

---

## Types to Define

### Scenario

```typescript
// src/types/scenario.ts

export interface Scenario {
  /** Human-readable name */
  name: string;

  /** What job this accomplishes (user story format) */
  description: string;

  /** Job identifier (kebab-case) */
  job: string;

  /** Categorization tags */
  tags: string[];

  /** Schema version */
  version: string;

  /** Starting state configuration */
  fixture: FixtureConfig;

  /** Isolation mode */
  isolation: "fresh" | "chained";

  /** Dependencies (if chained) */
  dependsOn?: string[];

  /** Per-scenario timeout in ms */
  timeout?: number;

  /** Steps to execute */
  steps: Step[];

  /** Final verification */
  verify?: Verification;
}

export interface FixtureConfig {
  /** Path to fixture file */
  file: string;

  /** Optional base fixture to inherit from */
  base?: string;

  /** Inline overrides */
  overrides?: Record<string, unknown>;
}

export interface Step {
  /** CLI command to run */
  command: string;

  /** Optional description */
  description?: string;

  /** Expected results */
  expect: Expectation;

  /** Continue even if this step fails */
  continueOnFailure?: boolean;
}

export interface Expectation {
  /** Did command succeed? */
  success: boolean;

  /** JSONPath assertions on data */
  data?: Record<string, unknown>;

  /** Expected error (for failure tests) */
  error?: {
    code?: string;
    message?: string;
  };

  /** Pattern match on reasoning field */
  reasoning?: string;
}

export interface Verification {
  /** Path to expected state snapshot */
  snapshot?: string;

  /** Human-readable assertions */
  assertions?: string[];

  /** Path to custom verification script */
  custom?: string;
}
```

### Fixture

```typescript
// src/types/fixture.ts

export interface Fixture {
  /** JSON Schema reference */
  $schema?: string;

  /** Target application */
  app: string;

  /** Fixture format version */
  version: string;

  /** Human-readable description */
  description: string;

  /** App-specific data (varies by app) */
  [key: string]: unknown;
}

/** Violet-specific fixture */
export interface VioletFixture extends Fixture {
  app: "violet";
  nodes: VioletNode[];
  operations?: VioletOperation[];
  constraints?: VioletConstraint[];
}

export interface VioletNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  includes?: string[];
  tags?: string[];
}

export interface VioletOperation {
  nodeId: string;
  type: "add" | "override" | "subtract" | "reset" | "copy";
  token: string;
  value?: string;
  sourceNodeId?: string;
  ancestorId?: string;
}

export interface VioletConstraint {
  nodeId: string;
  id: string;
  type: "enum" | "range" | "pattern" | "contrast" | "custom";
  tokens: string[];
  [key: string]: unknown;
}
```

### Report

```typescript
// src/types/report.ts

export interface ScenarioResult {
  /** Scenario name */
  scenario: string;

  /** Execution status */
  status: "passed" | "failed" | "skipped" | "timeout";

  /** Duration in ms */
  duration: number;

  /** Individual step results */
  steps: StepResult[];

  /** Error details if failed */
  error?: StepError;
}

export interface StepResult {
  /** Step index (0-based) */
  index: number;

  /** Command that was run */
  command: string;

  /** Step status */
  status: "passed" | "failed" | "skipped";

  /** Duration in ms */
  duration: number;

  /** Actual output from command */
  actual?: unknown;

  /** Expected output */
  expected?: unknown;

  /** 
   * Confidence in this step's result (0-1).
   * Propagated from the command's output if present.
   * Enables agents to identify low-confidence steps.
   */
  confidence?: number;

  /**
   * Reasoning from the command's output.
   * Helps agents understand what the command did.
   */
  reasoning?: string;
}

export interface StepError {
  /** Which step failed */
  step: number;

  /** Command that failed */
  command: string;

  /** What we expected */
  expected: unknown;

  /** What we got */
  actual: unknown;

  /** Diff if applicable */
  diff?: string;

  /** Suggested fix */
  suggestion?: string;
}

export interface TestReport {
  /** When report was generated */
  timestamp: string;

  /** Total scenarios */
  total: number;

  /** Passed count */
  passed: number;

  /** Failed count */
  failed: number;

  /** Skipped count */
  skipped: number;

  /** Total duration in ms */
  duration: number;

  /** Individual scenario results */
  results: ScenarioResult[];
}
```

---

## Implementation Details

### CLI Wrapper

The CLI wrapper executes commands and captures structured output.

```typescript
// src/runner/cli-wrapper.ts

import { spawn } from "child_process";

export interface CliOptions {
  /** CLI command prefix (e.g., "violet --memory") */
  cli: string;

  /** Working directory */
  cwd?: string;

  /** Timeout in ms */
  timeout?: number;

  /** Environment variables */
  env?: Record<string, string>;
}

export interface CliResult {
  /** Exit code */
  exitCode: number;

  /** Parsed JSON output (if valid) */
  output?: unknown;

  /** Raw stdout */
  stdout: string;

  /** Raw stderr */
  stderr: string;

  /** Duration in ms */
  duration: number;
}

export async function runCommand(
  command: string,
  options: CliOptions
): Promise<CliResult> {
  const startTime = Date.now();
  const fullCommand = `${options.cli} ${command}`;
  const parts = fullCommand.split(" ");
  const executable = parts[0];
  const args = parts.slice(1);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timer = options.timeout
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`Command timed out after ${options.timeout}ms`));
        }, options.timeout)
      : null;

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);

      const duration = Date.now() - startTime;
      let output: unknown;

      try {
        output = JSON.parse(stdout);
      } catch {
        // Not JSON output, that's okay
      }

      resolve({
        exitCode: exitCode ?? 1,
        output,
        stdout,
        stderr,
        duration,
      });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
```

### Fixture Lifecycle

Each scenario runs in complete isolation with a defined lifecycle:

```typescript
// src/runner/fixture-lifecycle.ts

export interface FixtureLifecycle {
  /** Create fresh in-memory database instance */
  create(): Promise<DatabaseInstance>;

  /** Seed the database with fixture data */
  seed(db: DatabaseInstance, fixture: Fixture): Promise<void>;

  /** Tear down and release resources */
  teardown(db: DatabaseInstance): Promise<void>;
}

/**
 * Default lifecycle for apps using in-memory SQLite.
 * Apps can override with custom implementations.
 */
export const defaultLifecycle: FixtureLifecycle = {
  async create() {
    // Create fresh in-memory database
    return createMemoryDatabase();
  },

  async seed(db, fixture) {
    // Apply fixture data via CLI commands or direct insertion
    for (const entity of fixture.entities ?? []) {
      await db.insert(entity.table, entity.data);
    }
  },

  async teardown(db) {
    // Close connections, release memory
    await db.close();
  },
};
```

**Lifecycle execution order:**

```
1. lifecycle.create()     → Fresh database instance
2. lifecycle.seed()       → Apply fixture data
3. Execute scenario steps → Run commands against database
4. lifecycle.teardown()   → Clean up (always runs, even on failure)
```

### Scenario Executor

Runs scenarios step by step with proper lifecycle management.

```typescript
// src/runner/executor.ts

import { Scenario, Step, ScenarioResult, StepResult } from "../types";
import { runCommand, CliOptions } from "./cli-wrapper";
import { loadFixture } from "./fixture-loader";
import { evaluateStep } from "./evaluator";
import { defaultLifecycle, FixtureLifecycle } from "./fixture-lifecycle";

export interface ExecutorOptions extends CliOptions {
  /** Verbose output */
  verbose?: boolean;

  /** Custom fixture lifecycle (defaults to in-memory SQLite) */
  lifecycle?: FixtureLifecycle;
}

export async function executeScenario(
  scenario: Scenario,
  options: ExecutorOptions
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const stepResults: StepResult[] = [];
  const lifecycle = options.lifecycle ?? defaultLifecycle;

  // 1. Create fresh database
  const db = await lifecycle.create();

  try {
    // 2. Seed with fixture data
    if (scenario.fixture) {
      const fixture = await loadFixture(scenario.fixture);
      await lifecycle.seed(db, fixture);
    }

    // 3. Execute steps
    let failed = false;
    let error: StepError | undefined;

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];

      if (failed && !step.continueOnFailure) {
        stepResults.push({
          index: i,
          command: step.command,
          status: "skipped",
          duration: 0,
        });
        continue;
      }

      if (options.verbose) {
        console.log(`  Step ${i + 1}: ${step.command}`);
      }

      const result = await runCommand(step.command, options);
      const evaluation = evaluateStep(step, result);

      stepResults.push({
        index: i,
        command: step.command,
        status: evaluation.passed ? "passed" : "failed",
        duration: result.duration,
        actual: result.output,
        expected: step.expect,
      });

      if (!evaluation.passed) {
        failed = true;
        error = {
          step: i,
          command: step.command,
          expected: step.expect,
          actual: result.output,
          diff: evaluation.diff,
          suggestion: evaluation.suggestion,
        };
      }
    }

    return {
      scenario: scenario.name,
      status: failed ? "failed" : "passed",
      duration: Date.now() - startTime,
      steps: stepResults,
      error,
    };
  } finally {
    // 4. Always tear down, even on failure
    await lifecycle.teardown(db);
  }
}
```

### Step Evaluator

Compares actual results against expectations.

```typescript
// src/runner/evaluator.ts

import { Step, Expectation } from "../types";
import { CliResult } from "./cli-wrapper";
import { matchPattern, getByPath } from "../utils";

export interface EvaluationResult {
  passed: boolean;
  diff?: string;
  suggestion?: string;
}

export function evaluateStep(step: Step, result: CliResult): EvaluationResult {
  const expect = step.expect;
  const output = result.output as Record<string, unknown> | undefined;

  // Check success field
  if (output && "success" in output) {
    if (output.success !== expect.success) {
      return {
        passed: false,
        diff: `Expected success=${expect.success}, got success=${output.success}`,
        suggestion: expect.success
          ? "Command failed unexpectedly. Check error details."
          : "Command succeeded but was expected to fail.",
      };
    }
  }

  // Check data assertions
  if (expect.data && output?.data) {
    for (const [path, expected] of Object.entries(expect.data)) {
      const actual = getByPath(output.data, path);

      if (!matchValue(actual, expected)) {
        return {
          passed: false,
          diff: `At path "${path}": expected ${JSON.stringify(
            expected
          )}, got ${JSON.stringify(actual)}`,
        };
      }
    }
  }

  // Check error assertions
  if (expect.error && output?.error) {
    const error = output.error as Record<string, unknown>;

    if (expect.error.code && error.code !== expect.error.code) {
      return {
        passed: false,
        diff: `Expected error code "${expect.error.code}", got "${error.code}"`,
      };
    }
  }

  // Check reasoning pattern
  if (expect.reasoning && output?.reasoning) {
    if (!matchPattern(output.reasoning as string, expect.reasoning)) {
      return {
        passed: false,
        diff: `Reasoning "${output.reasoning}" did not match pattern "${expect.reasoning}"`,
      };
    }
  }

  return { passed: true };
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "string") {
    // Check for pattern syntax
    if (expected.startsWith("contains ")) {
      const pattern = expected.slice(9);
      return String(actual).includes(pattern);
    }
    if (expected.startsWith("matches ")) {
      const pattern = expected.slice(8);
      return new RegExp(pattern).test(String(actual));
    }
    if (expected === "exists") {
      return actual !== undefined && actual !== null;
    }
    if (expected === "not_exists") {
      return actual === undefined || actual === null;
    }
  }

  // Deep equality
  return JSON.stringify(actual) === JSON.stringify(expected);
}
```

---

## CLI Validation Checkpoints

After Phase 1 is complete, these commands should work:

```bash
# Run a single scenario
afd scenario run --scenario onboard-product-line --cli "violet --memory"

# Expected output:
# ✓ Onboard New Product Line (245ms)
#   ✓ Step 1: node create --name xbox --parent global-base --type product
#   ✓ Step 2: token add --node xbox --token color.xbox.green --value "#107C10"
#   ✓ Step 3: token override --node xbox --token color.accent.primary --value "#107C10"
#   ✓ Step 4: tokens xbox
#
# 1 scenario passed

# Run with verbose output
afd scenario run --scenario onboard-product-line --cli "violet --memory" --verbose

# Generate report
afd scenario report --format terminal
```

---

## Test Cases

### Unit Tests

| Test                  | Description                              |
| --------------------- | ---------------------------------------- |
| `cli-wrapper.test.ts` | Command execution, timeout handling      |
| `evaluator.test.ts`   | Expectation matching, patterns           |
| `executor.test.ts`    | Step sequencing, failure handling        |
| `lifecycle.test.ts`   | Create/seed/teardown, cleanup on failure |

### Integration Tests

| Test                      | Description                         |
| ------------------------- | ----------------------------------- |
| `run-scenario.test.ts`    | Full scenario execution with Violet |
| `fixture-loading.test.ts` | Fixture parsing and application     |

---

## Files to Create

```
packages/testing/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── scenario.ts
│   │   ├── fixture.ts
│   │   ├── report.ts
│   │   └── index.ts
│   ├── commands/
│   │   ├── run.ts
│   │   ├── report.ts
│   │   └── index.ts
│   ├── runner/
│   │   ├── cli-wrapper.ts
│   │   ├── executor.ts
│   │   ├── evaluator.ts
│   │   ├── fixture-loader.ts
│   │   └── fixture-lifecycle.ts   # NEW: Lifecycle management
│   ├── parsers/
│   │   └── yaml.ts
│   └── utils/
│       ├── jsonpath.ts
│       └── patterns.ts
└── tests/
    ├── cli-wrapper.test.ts
    ├── evaluator.test.ts
    └── executor.test.ts
```

---

## Dependencies

**Blocks**: Nothing (first phase)

**Blocked by**: Nothing

**New dependencies to add**:

- `yaml` - YAML parsing
- `fast-deep-equal` - Object comparison
- `diff` - Generate diffs for failures

---

## Estimated Effort

| Task                    | Estimate      |
| ----------------------- | ------------- |
| Types                   | 1 hour        |
| CLI wrapper             | 2 hours       |
| Fixture lifecycle       | 1.5 hours     |
| Executor                | 2 hours       |
| Evaluator               | 2 hours       |
| YAML parser             | 1 hour        |
| Terminal reporter       | 1 hour        |
| Tests                   | 2.5 hours     |
| Integration with Violet | 2 hours       |
| **Total**               | **~15 hours** |

---

## Next Phase

After Phase 1:

- [Phase 2: Full Command Suite](./02-command-suite.plan.md)
