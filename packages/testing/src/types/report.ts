/**
 * @afd/testing - Scenario execution result types
 *
 * Types for representing the outcome of running JTBD scenarios,
 * including step results, errors, and aggregate reports.
 */

import type { CommandResult } from "@afd/core";

// ============================================================================
// Step Result Types
// ============================================================================

/**
 * Outcome of a single step execution
 */
export type StepOutcome = "pass" | "fail" | "skip" | "error";

/**
 * Detailed error information from a step
 */
export interface StepError {
  /** Error type classification */
  type: "command_failed" | "expectation_mismatch" | "timeout" | "parse_error" | "unknown";

  /** Human-readable error message */
  message: string;

  /** Expected value (for expectation mismatches) */
  expected?: unknown;

  /** Actual value received */
  actual?: unknown;

  /** JSON path to the failing assertion */
  path?: string;

  /** Original error if available */
  cause?: Error;
}

/**
 * Result of executing a single step in a scenario
 */
export interface StepResult {
  /** Step identifier (from scenario file) */
  stepId: string;

  /** Command that was invoked */
  command: string;

  /** Step execution outcome */
  outcome: StepOutcome;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Raw command result (if execution succeeded) */
  commandResult?: CommandResult<unknown>;

  /** Detailed error information (if outcome is fail/error) */
  error?: StepError;

  /** Individual assertion results */
  assertions: AssertionResult[];

  /** Step was skipped due to previous failure */
  skippedReason?: string;
}

/**
 * Result of a single assertion check
 */
export interface AssertionResult {
  /** Path being checked (e.g., "data.items.length") */
  path: string;

  /** Matcher used (e.g., "equals", "contains", "greaterThan") */
  matcher: string;

  /** Whether the assertion passed */
  passed: boolean;

  /** Expected value */
  expected: unknown;

  /** Actual value */
  actual: unknown;

  /** Human-readable description of the assertion */
  description?: string;
}

// ============================================================================
// Scenario Result Types
// ============================================================================

/**
 * Overall scenario outcome
 */
export type ScenarioOutcome = "pass" | "fail" | "error" | "partial";

/**
 * Result of executing an entire scenario
 */
export interface ScenarioResult {
  /** Scenario file path */
  scenarioPath: string;

  /** Job name from the scenario */
  jobName: string;

  /** Job description */
  jobDescription?: string;

  /** Overall scenario outcome */
  outcome: ScenarioOutcome;

  /** Total execution duration in milliseconds */
  durationMs: number;

  /** Results for each step */
  stepResults: StepResult[];

  /** Number of steps that passed */
  passedSteps: number;

  /** Number of steps that failed */
  failedSteps: number;

  /** Number of steps that were skipped */
  skippedSteps: number;

  /** Fixture that was used */
  fixture?: string;

  /** Verification results (if verification block was present) */
  verification?: VerificationResult;

  /** Timestamp when scenario started */
  startedAt: Date;

  /** Timestamp when scenario completed */
  completedAt: Date;
}

/**
 * Result of running verification queries after scenario completion
 */
export interface VerificationResult {
  /** Whether all verification queries passed */
  passed: boolean;

  /** Individual query results */
  queryResults: VerificationQueryResult[];
}

/**
 * Result of a single verification query
 */
export interface VerificationQueryResult {
  /** The command that was run for verification */
  command: string;

  /** Whether the verification passed */
  passed: boolean;

  /** Expected assertion */
  expected: unknown;

  /** Actual value */
  actual: unknown;

  /** Error message if verification failed */
  error?: string;
}

// ============================================================================
// Test Report Types
// ============================================================================

/**
 * Aggregated report for multiple scenarios
 */
export interface TestReport {
  /** Report title/name */
  title: string;

  /** Total execution duration in milliseconds */
  durationMs: number;

  /** All scenario results */
  scenarios: ScenarioResult[];

  /** Summary statistics */
  summary: TestSummary;

  /** Report generation timestamp */
  generatedAt: Date;

  /** Environment information */
  environment?: EnvironmentInfo;
}

/**
 * Summary statistics for a test report
 */
export interface TestSummary {
  /** Total number of scenarios */
  totalScenarios: number;

  /** Scenarios that passed */
  passedScenarios: number;

  /** Scenarios that failed */
  failedScenarios: number;

  /** Scenarios with errors (not assertion failures) */
  errorScenarios: number;

  /** Total number of steps across all scenarios */
  totalSteps: number;

  /** Steps that passed */
  passedSteps: number;

  /** Steps that failed */
  failedSteps: number;

  /** Steps that were skipped */
  skippedSteps: number;

  /** Overall pass rate (0-1) */
  passRate: number;
}

/**
 * Environment information for reproducibility
 */
export interface EnvironmentInfo {
  /** Node.js version */
  nodeVersion: string;

  /** Operating system */
  platform: string;

  /** AFD CLI version */
  afdVersion?: string;

  /** Target application being tested */
  targetApp?: string;

  /** Working directory */
  cwd: string;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an empty test summary
 */
export function createEmptySummary(): TestSummary {
  return {
    totalScenarios: 0,
    passedScenarios: 0,
    failedScenarios: 0,
    errorScenarios: 0,
    totalSteps: 0,
    passedSteps: 0,
    failedSteps: 0,
    skippedSteps: 0,
    passRate: 0,
  };
}

/**
 * Calculate summary from scenario results
 */
export function calculateSummary(scenarios: ScenarioResult[]): TestSummary {
  const summary = createEmptySummary();

  for (const scenario of scenarios) {
    summary.totalScenarios++;
    summary.totalSteps += scenario.stepResults.length;
    summary.passedSteps += scenario.passedSteps;
    summary.failedSteps += scenario.failedSteps;
    summary.skippedSteps += scenario.skippedSteps;

    switch (scenario.outcome) {
      case "pass":
        summary.passedScenarios++;
        break;
      case "fail":
      case "partial":
        summary.failedScenarios++;
        break;
      case "error":
        summary.errorScenarios++;
        break;
    }
  }

  summary.passRate =
    summary.totalScenarios > 0 ? summary.passedScenarios / summary.totalScenarios : 0;

  return summary;
}

/**
 * Create a step error from an Error object
 */
export function createStepError(
  type: StepError["type"],
  message: string,
  details?: Partial<StepError>
): StepError {
  return {
    type,
    message,
    ...details,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a StepResult
 */
export function isStepResult(value: unknown): value is StepResult {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.stepId === "string" &&
    typeof obj.command === "string" &&
    typeof obj.outcome === "string" &&
    ["pass", "fail", "skip", "error"].includes(obj.outcome as string) &&
    typeof obj.durationMs === "number" &&
    Array.isArray(obj.assertions)
  );
}

/**
 * Check if a value is a ScenarioResult
 */
export function isScenarioResult(value: unknown): value is ScenarioResult {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.scenarioPath === "string" &&
    typeof obj.jobName === "string" &&
    typeof obj.outcome === "string" &&
    ["pass", "fail", "error", "partial"].includes(obj.outcome as string) &&
    typeof obj.durationMs === "number" &&
    Array.isArray(obj.stepResults)
  );
}
