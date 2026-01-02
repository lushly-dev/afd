/**
 * @afd/testing - Scenario Executor
 *
 * Executes scenario steps sequentially, evaluates results, and produces a ScenarioResult.
 * Supports fixture loading and step references.
 */

import type { CommandResult } from "@afd/core";
import type { Scenario, Step, FixtureConfig } from "../types/scenario.js";
import type {
  ScenarioResult,
  StepResult,
  StepOutcome,
  ScenarioOutcome,
} from "../types/report.js";
import { createStepError } from "../types/report.js";
import { evaluateResult } from "./evaluator.js";
import { CliWrapper, type CliConfig, type ExecuteResult } from "./cli-wrapper.js";
import { loadFixture, applyFixture, type FixtureData } from "./fixture-loader.js";

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

      return {
        stepId,
        command: step.command,
        outcome,
        durationMs,
        commandResult: executeResult.result,
        assertions: evaluation.assertions,
        error: evaluation.passed
          ? undefined
          : createStepError("expectation_mismatch", "Assertions failed", {
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

  /** Step completion callback */
  onStepComplete?: (step: Step, result: StepResult) => void;

  /** Scenario start callback */
  onScenarioStart?: (scenario: Scenario) => void;

  /** Scenario complete callback */
  onScenarioComplete?: (result: ScenarioResult) => void;

  /** Fixture loaded callback */
  onFixtureLoaded?: (fixture: FixtureData, appliedCommands: string[]) => void;
}

/**
 * Executor that runs commands in-process (no CLI subprocess).
 * Useful for faster unit testing of scenarios.
 *
 * Supports:
 * - Fixture loading and application
 * - Step references (${{ steps[0].data.id }})
 */
export class InProcessExecutor {
  private handler: CommandHandler;
  private config: Omit<InProcessExecutorConfig, "handler">;

  constructor(config: InProcessExecutorConfig) {
    this.handler = config.handler;
    this.config = {
      stopOnFailure: config.stopOnFailure ?? true,
      basePath: config.basePath,
      onStepComplete: config.onStepComplete,
      onScenarioStart: config.onScenarioStart,
      onScenarioComplete: config.onScenarioComplete,
      onFixtureLoaded: config.onFixtureLoaded,
    };
  }

  /**
   * Execute a scenario in-process.
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

    // Load and apply fixture if present
    if (scenario.fixture) {
      const fixtureResult = await this.loadAndApplyFixture(scenario.fixture);
      if (!fixtureResult.success) {
        fixtureError = fixtureResult.error;
        shouldSkipRemaining = true;
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

      return {
        stepId,
        command: step.command,
        outcome,
        durationMs,
        commandResult,
        assertions: evaluation.assertions,
        error: evaluation.passed
          ? undefined
          : createStepError("expectation_mismatch", "Assertions failed"),
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
