/**
 * @lushly-dev/afd-testing - Scenario Executor
 *
 * Executes scenario steps sequentially, evaluates results, and produces a ScenarioResult.
 * Supports fixture loading and step references.
 */

import type { CommandResult } from "@lushly-dev/afd-core";
import type { Scenario, Step, FixtureConfig } from "../types/scenario.js";
import type {
  ScenarioResult,
  StepResult,
  StepOutcome,
  ScenarioOutcome,
  AssertionResult,
} from "../types/report.js";
import { createStepError } from "../types/report.js";
import { evaluateResult } from "./evaluator.js";
import { CliWrapper, type CliConfig, type ExecuteResult } from "./cli-wrapper.js";
import { loadFixture, applyFixture, type FixtureData, type AppliedCommand } from "./fixture-loader.js";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format failed assertions into a human-readable error message.
 * Shows expected vs actual values for each failure.
 */
function formatAssertionFailures(failures: AssertionResult[]): string {
  if (failures.length === 0) {
    return "Assertions failed";
  }

  if (failures.length === 1 && failures[0]) {
    const f = failures[0];
    return `${f.path}: expected ${formatValue(f.expected)}, got ${formatValue(f.actual)}`;
  }

  const lines = failures.map((f) => {
    return `  - ${f.path}: expected ${formatValue(f.expected)}, got ${formatValue(f.actual)}`;
  });

  return `${failures.length} assertions failed:\n${lines.join("\n")}`;
}

/**
 * Format a value for error message display.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.length > 40 ? `"${value.slice(0, 40)}..."` : `"${value}"`;
  }
  if (typeof value === "object") {
    try {
      const str = JSON.stringify(value);
      return str.length > 60 ? str.slice(0, 60) + "..." : str;
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

// ============================================================================
// Executor Configuration
// ============================================================================

export interface ExecutorConfig extends CliConfig {
  /** Stop execution on first failure (default: true unless step has continueOnFailure) */
  stopOnFailure?: boolean;

  /** Callback for step completion */
  onStepComplete?: (step: Step, result: StepResult) => void;

  /** Callback for scenario start */
  onScenarioStart?: (scenario: Scenario) => void;

  /** Callback for scenario complete */
  onScenarioComplete?: (result: ScenarioResult) => void;
}

// ============================================================================
// Scenario Executor Class
// ============================================================================

/**
 * Executes JTBD scenarios against an MCP server.
 *
 * @example
 * ```typescript
 * const executor = new ScenarioExecutor({
 *   serverUrl: "http://localhost:3000/mcp"
 * });
 * const result = await executor.execute(scenario);
 * console.log(`${result.outcome}: ${result.passedSteps}/${result.stepResults.length} passed`);
 * ```
 */
export class ScenarioExecutor {
  private cli: CliWrapper;
  private config: ExecutorConfig;

  constructor(config: ExecutorConfig = {}) {
    this.config = {
      stopOnFailure: config.stopOnFailure ?? true,
      ...config,
    };
    this.cli = new CliWrapper(config);
  }

  /**
   * Execute a single scenario.
   */
  async execute(scenario: Scenario): Promise<ScenarioResult> {
    const startedAt = new Date();
    const startTime = Date.now();
    const stepResults: StepResult[] = [];

    let passedSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;
    let shouldSkipRemaining = false;

    // Notify scenario start
    this.config.onScenarioStart?.(scenario);

    // Execute each step
    for (const [index, step] of scenario.steps.entries()) {
      // Check if we should skip this step
      if (shouldSkipRemaining) {
        const skippedResult: StepResult = {
          stepId: `step-${index + 1}`,
          command: step.command,
          outcome: "skip",
          durationMs: 0,
          assertions: [],
          skippedReason: "Previous step failed",
        };
        stepResults.push(skippedResult);
        skippedSteps++;
        this.config.onStepComplete?.(step, skippedResult);
        continue;
      }

      // Execute the step
      const stepResult = await this.executeStep(step, index + 1);
      stepResults.push(stepResult);

      // Update counters
      switch (stepResult.outcome) {
        case "pass":
          passedSteps++;
          break;
        case "fail":
        case "error":
          failedSteps++;
          // Determine if we should skip remaining steps
          if (this.config.stopOnFailure && !step.continueOnFailure) {
            shouldSkipRemaining = true;
          }
          break;
        case "skip":
          skippedSteps++;
          break;
      }

      // Notify step completion
      this.config.onStepComplete?.(step, stepResult);
    }

    const completedAt = new Date();
    const durationMs = Date.now() - startTime;

    // Determine overall outcome
    const outcome = this.determineOutcome(passedSteps, failedSteps, skippedSteps, scenario.steps.length);

    const result: ScenarioResult = {
      scenarioPath: "", // Will be set by caller
      jobName: scenario.job,
      jobDescription: scenario.description,
      outcome,
      durationMs,
      stepResults,
      passedSteps,
      failedSteps,
      skippedSteps,
      startedAt,
      completedAt,
    };

    // Notify scenario completion
    this.config.onScenarioComplete?.(result);

    return result;
  }

  /**
   * Execute a single step.
   */
  private async executeStep(step: Step, stepNum: number): Promise<StepResult> {
    const stepId = `step-${stepNum}`;
    const startTime = Date.now();

    try {
      // Execute command via CLI
      const executeResult: ExecuteResult = await this.cli.execute(step.command, step.input);
      const durationMs = Date.now() - startTime;

      if (!executeResult.success) {
        // CLI execution itself failed
        return {
          stepId,
          command: step.command,
          outcome: "error",
          durationMs,
          error: executeResult.error,
          assertions: [],
        };
      }

      // CLI execution succeeded, now evaluate against expectations
      const evaluation = evaluateResult(executeResult.result, step.expect);

      const outcome: StepOutcome = evaluation.passed ? "pass" : "fail";

      // Build detailed error message for failed assertions
      let errorMessage: string | undefined;
      if (!evaluation.passed) {
        const failedAssertions = evaluation.assertions.filter((a) => !a.passed);
        errorMessage = formatAssertionFailures(failedAssertions);
      }

      return {
        stepId,
        command: step.command,
        outcome,
        durationMs,
        commandResult: executeResult.result,
        assertions: evaluation.assertions,
        error: evaluation.passed
          ? undefined
          : createStepError("expectation_mismatch", errorMessage ?? "Assertions failed", {
              expected: step.expect,
              actual: executeResult.result,
            }),
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      return {
        stepId,
        command: step.command,
        outcome: "error",
        durationMs,
        error: createStepError("unknown", message, {
          cause: err instanceof Error ? err : undefined,
        }),
        assertions: [],
      };
    }
  }

  /**
   * Determine overall scenario outcome.
   */
  private determineOutcome(
    passed: number,
    failed: number,
    skipped: number,
    total: number
  ): ScenarioOutcome {
    if (failed === 0 && skipped === 0) {
      return "pass";
    }

    if (passed === 0) {
      return "fail";
    }

    if (failed > 0 && passed > 0) {
      return "partial";
    }

    return "fail";
  }

  /**
   * Execute multiple scenarios.
   */
  async executeAll(scenarios: Scenario[]): Promise<ScenarioResult[]> {
    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const result = await this.execute(scenario);
      results.push(result);
    }

    return results;
  }

  /**
   * Update CLI configuration.
   */
  configure(config: Partial<ExecutorConfig>): void {
    if (config.stopOnFailure !== undefined) {
      this.config.stopOnFailure = config.stopOnFailure;
    }
    if (config.onStepComplete !== undefined) {
      this.config.onStepComplete = config.onStepComplete;
    }
    if (config.onScenarioStart !== undefined) {
      this.config.onScenarioStart = config.onScenarioStart;
    }
    if (config.onScenarioComplete !== undefined) {
      this.config.onScenarioComplete = config.onScenarioComplete;
    }
    this.cli.configure(config);
  }
}

// ============================================================================
// In-Process Execution (Alternative to CLI)
// ============================================================================

/**
 * Command handler function signature for in-process execution.
 */
export type CommandHandler = (
  command: string,
  input?: Record<string, unknown>
) => Promise<CommandResult<unknown>>;

/**
 * Executor config for in-process mode.
 */
export interface InProcessExecutorConfig {
  /** Command handler function */
  handler: CommandHandler;

  /** Stop on first failure */
  stopOnFailure?: boolean;

  /** Base path for resolving fixture files */
  basePath?: string;

  /**
   * Dry run mode - validate scenario structure without executing commands.
   * Useful for CI validation and pre-flight checks.
   */
  dryRun?: boolean;

  /** Step completion callback */
  onStepComplete?: (step: Step, result: StepResult) => void;

  /** Scenario start callback */
  onScenarioStart?: (scenario: Scenario) => void;

  /** Scenario complete callback */
  onScenarioComplete?: (result: ScenarioResult) => void;

  /** Fixture loaded callback with detailed command data */
  onFixtureLoaded?: (
    fixture: FixtureData,
    appliedCommands: Array<{ command: string; input?: unknown }>
  ) => void;
}

/**
 * Executor that runs commands in-process (no CLI subprocess).
 * Useful for faster unit testing of scenarios.
 *
 * Supports:
 * - Fixture loading and application
 * - Step references (${{ steps[0].data.id }})
 * - Dry run mode for validation without execution
 */
export class InProcessExecutor {
  private handler: CommandHandler;
  private config: Omit<InProcessExecutorConfig, "handler">;

  constructor(config: InProcessExecutorConfig) {
    this.handler = config.handler;
    this.config = {
      stopOnFailure: config.stopOnFailure ?? true,
      basePath: config.basePath,
      dryRun: config.dryRun ?? false,
      onStepComplete: config.onStepComplete,
      onScenarioStart: config.onScenarioStart,
      onScenarioComplete: config.onScenarioComplete,
      onFixtureLoaded: config.onFixtureLoaded,
    };
  }

  /**
   * Execute a scenario in-process.
   * If dryRun is true, validates scenario structure without executing commands.
   */
  async execute(scenario: Scenario): Promise<ScenarioResult> {
    const startedAt = new Date();
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    /** Store step outputs for reference resolution */
    const stepOutputs: Array<CommandResult<unknown>> = [];

    let passedSteps = 0;
    let failedSteps = 0;
    let skippedSteps = 0;
    let shouldSkipRemaining = false;
    let fixtureError: string | undefined;

    this.config.onScenarioStart?.(scenario);

    // In dry run mode, validate fixture exists but don't apply
    if (scenario.fixture) {
      if (this.config.dryRun) {
        const loadResult = await loadFixture(scenario.fixture, {
          basePath: this.config.basePath,
        });
        if (!loadResult.success) {
          fixtureError = `Fixture validation failed: ${loadResult.error}`;
          shouldSkipRemaining = true;
        }
      } else {
        const fixtureResult = await this.loadAndApplyFixture(scenario.fixture);
        if (!fixtureResult.success) {
          fixtureError = fixtureResult.error;
          shouldSkipRemaining = true;
        }
      }
    }

    for (const [index, step] of scenario.steps.entries()) {
      if (shouldSkipRemaining) {
        const skippedResult: StepResult = {
          stepId: `step-${index + 1}`,
          command: step.command,
          outcome: "skip",
          durationMs: 0,
          assertions: [],
          skippedReason: fixtureError ?? "Previous step failed",
        };
        stepResults.push(skippedResult);
        stepOutputs.push({ success: false });
        skippedSteps++;
        this.config.onStepComplete?.(step, skippedResult);
        continue;
      }

      // In dry run mode, validate step structure without execution
      if (this.config.dryRun) {
        const dryRunResult: StepResult = {
          stepId: `step-${index + 1}`,
          command: step.command,
          outcome: "pass", // Validated successfully
          durationMs: 0,
          assertions: [],
        };
        stepResults.push(dryRunResult);
        stepOutputs.push({ success: true, data: {} }); // Mock output for references
        passedSteps++;
        this.config.onStepComplete?.(step, dryRunResult);
        continue;
      }

      // Resolve step references in input
      const resolvedInput = this.resolveStepReferences(step.input, stepOutputs);

      const stepResult = await this.executeStepInProcess(
        { ...step, input: resolvedInput },
        index + 1
      );
      stepResults.push(stepResult);
      stepOutputs.push(stepResult.commandResult ?? { success: stepResult.outcome === "pass" });

      switch (stepResult.outcome) {
        case "pass":
          passedSteps++;
          break;
        case "fail":
        case "error":
          failedSteps++;
          if (this.config.stopOnFailure && !step.continueOnFailure) {
            shouldSkipRemaining = true;
          }
          break;
        case "skip":
          skippedSteps++;
          break;
      }

      this.config.onStepComplete?.(step, stepResult);
    }

    const completedAt = new Date();
    const durationMs = Date.now() - startTime;

    const outcome = this.determineOutcome(passedSteps, failedSteps, skippedSteps);

    const result: ScenarioResult = {
      scenarioPath: "",
      jobName: scenario.job,
      jobDescription: scenario.description,
      outcome,
      durationMs,
      stepResults,
      passedSteps,
      failedSteps,
      skippedSteps,
      startedAt,
      completedAt,
    };

    this.config.onScenarioComplete?.(result);
    return result;
  }

  private async executeStepInProcess(step: Step, stepNum: number): Promise<StepResult> {
    const stepId = `step-${stepNum}`;
    const startTime = Date.now();

    try {
      const commandResult = await this.handler(step.command, step.input);
      const durationMs = Date.now() - startTime;

      const evaluation = evaluateResult(commandResult, step.expect);
      const outcome: StepOutcome = evaluation.passed ? "pass" : "fail";

      // Build detailed error message for failed assertions
      let errorMessage: string | undefined;
      if (!evaluation.passed) {
        const failedAssertions = evaluation.assertions.filter((a) => !a.passed);
        errorMessage = formatAssertionFailures(failedAssertions);
      }

      return {
        stepId,
        command: step.command,
        outcome,
        durationMs,
        commandResult,
        assertions: evaluation.assertions,
        error: evaluation.passed
          ? undefined
          : createStepError("expectation_mismatch", errorMessage ?? "Assertions failed"),
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      return {
        stepId,
        command: step.command,
        outcome: "error",
        durationMs,
        error: createStepError("command_failed", message),
        assertions: [],
      };
    }
  }

  /**
   * Load and apply a fixture.
   */
  private async loadAndApplyFixture(
    fixtureConfig: FixtureConfig
  ): Promise<{ success: boolean; error?: string }> {
    // Load fixture file
    const loadResult = await loadFixture(fixtureConfig, {
      basePath: this.config.basePath,
    });

    if (!loadResult.success) {
      return { success: false, error: loadResult.error };
    }

    // Apply fixture via command handler
    const applyResult = await applyFixture(loadResult.data, this.handler);

    if (!applyResult.success) {
      return { success: false, error: applyResult.error };
    }

    // Notify callback
    this.config.onFixtureLoaded?.(loadResult.data, applyResult.appliedCommands);

    return { success: true };
  }

  /**
   * Resolve step references in input values.
   *
   * Supports syntax like:
   * - ${{ steps[0].data.id }} - Reference data from step 0
   * - ${{ steps[1].data.items[0].name }} - Nested path access
   */
  private resolveStepReferences(
    input: Record<string, unknown> | undefined,
    stepOutputs: Array<CommandResult<unknown>>
  ): Record<string, unknown> | undefined {
    if (!input) return undefined;

    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      resolved[key] = this.resolveValue(value, stepOutputs);
    }

    return resolved;
  }

  /**
   * Resolve a single value, recursively handling objects and arrays.
   */
  private resolveValue(
    value: unknown,
    stepOutputs: Array<CommandResult<unknown>>
  ): unknown {
    if (typeof value === "string") {
      return this.resolveStringReferences(value, stepOutputs);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveValue(item, stepOutputs));
    }

    if (typeof value === "object" && value !== null) {
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        resolved[k] = this.resolveValue(v, stepOutputs);
      }
      return resolved;
    }

    return value;
  }

  /**
   * Resolve step references in a string value.
   *
   * Pattern: ${{ steps[N].path.to.value }}
   */
  private resolveStringReferences(
    value: string,
    stepOutputs: Array<CommandResult<unknown>>
  ): unknown {
    // Check for exact match (entire string is a reference)
    const exactMatch = value.match(/^\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}$/);
    if (exactMatch && exactMatch[1] !== undefined && exactMatch[2] !== undefined) {
      const stepIndex = parseInt(exactMatch[1], 10);
      const path = exactMatch[2];
      return this.getValueAtPath(stepOutputs[stepIndex], path);
    }

    // Check for embedded references (replace within string)
    const refPattern = /\$\{\{\s*steps\[(\d+)\]\.(.+?)\s*\}\}/g;
    if (refPattern.test(value)) {
      // Reset lastIndex after test
      refPattern.lastIndex = 0;
      return value.replace(refPattern, (_, stepIdx, path) => {
        const stepIndex = parseInt(stepIdx as string, 10);
        const resolved = this.getValueAtPath(stepOutputs[stepIndex], path as string);
        return String(resolved ?? "");
      });
    }

    return value;
  }

  /**
   * Get a value at a dot-notation path from an object.
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array index access like "items[0]"
      const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch && arrayMatch[1] !== undefined && arrayMatch[2] !== undefined) {
        const propName = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        current = (current as Record<string, unknown>)[propName];
        if (Array.isArray(current)) {
          current = current[index];
        } else {
          return undefined;
        }
      } else {
        current = (current as Record<string, unknown>)[part];
      }
    }

    return current;
  }

  private determineOutcome(passed: number, failed: number, skipped: number): ScenarioOutcome {
    if (failed === 0 && skipped === 0) return "pass";
    if (passed === 0) return "fail";
    if (failed > 0 && passed > 0) return "partial";
    return "fail";
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a CLI-based scenario executor.
 */
export function createExecutor(config?: ExecutorConfig): ScenarioExecutor {
  return new ScenarioExecutor(config);
}

/**
 * Create an in-process scenario executor.
 */
export function createInProcessExecutor(config: InProcessExecutorConfig): InProcessExecutor {
  return new InProcessExecutor(config);
}

/**
 * Validation result from validateScenario.
 */
export interface ScenarioValidationResult {
  /** Whether scenario is valid */
  valid: boolean;

  /** Validation errors (if any) */
  errors: string[];

  /** Validation warnings (if any) */
  warnings: string[];

  /** Scenario metadata */
  metadata: {
    name: string;
    job: string;
    stepCount: number;
    hasFixture: boolean;
    tags: string[];
  };
}

/**
 * Validate a scenario without executing it.
 * Useful for CI/CD validation and pre-flight checks.
 *
 * @param scenario - The scenario to validate
 * @param options - Validation options
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = await validateScenario(scenario, {
 *   basePath: './scenarios',
 *   checkFixtures: true,
 * });
 * if (!result.valid) {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
export async function validateScenario(
  scenario: Scenario,
  options: { basePath?: string; checkFixtures?: boolean } = {}
): Promise<ScenarioValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic structural validation
  if (!scenario.name) {
    errors.push("Missing required field: name");
  }

  if (!scenario.job) {
    errors.push("Missing required field: job");
  }

  if (!scenario.steps || scenario.steps.length === 0) {
    errors.push("Scenario must have at least one step");
  }

  // Validate each step
  for (const [index, step] of (scenario.steps ?? []).entries()) {
    const stepNum = index + 1;

    if (!step.command) {
      errors.push(`Step ${stepNum}: Missing required field 'command'`);
    }

    if (!step.expect) {
      warnings.push(`Step ${stepNum}: Missing 'expect' - step result won't be validated`);
    }

    // Check for invalid step references
    if (step.input) {
      const refs = JSON.stringify(step.input).match(/\$\{\{\s*steps\[(\d+)\]/g);
      if (refs) {
        for (const ref of refs) {
          const match = ref.match(/steps\[(\d+)\]/);
          if (match && match[1]) {
            const refIndex = parseInt(match[1], 10);
            if (refIndex >= index) {
              errors.push(`Step ${stepNum}: Invalid reference to step ${refIndex} (can only reference earlier steps)`);
            }
          }
        }
      }
    }
  }

  // Validate fixture if present and checkFixtures is enabled
  if (scenario.fixture && options.checkFixtures !== false) {
    const fixtureResult = await loadFixture(scenario.fixture, {
      basePath: options.basePath,
    });

    if (!fixtureResult.success) {
      errors.push(`Fixture error: ${fixtureResult.error}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      name: scenario.name,
      job: scenario.job,
      stepCount: scenario.steps?.length ?? 0,
      hasFixture: !!scenario.fixture,
      tags: scenario.tags ?? [],
    },
  };
}
