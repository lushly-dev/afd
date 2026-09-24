/**
 * @lushly-dev/afd-testing - Scenario Executor
 *
 * Executes scenario steps through the AFD CLI, evaluates results, and
 * produces a ScenarioResult. Fixtures, step references, timeouts and
 * cancellation behave exactly as in `InProcessExecutor`: both use the shared
 * scenario run loop.
 */

import { dirname } from 'node:path';
import { type CommandResult, failure } from '@lushly-dev/afd-core';
import type { ScenarioResult, StepResult } from '../types/report.js';
import type { Scenario, Step } from '../types/scenario.js';
import { type CliConfig, CliWrapper } from './cli-wrapper.js';
import { applyFixture, loadFixture } from './fixture-loader.js';
import {
	type ExecuteScenarioOptions,
	evaluateStep,
	runScenario,
	type SetupOutcome,
} from './scenario-runner.js';

// ============================================================================
// Executor Configuration
// ============================================================================

export interface ExecutorConfig extends CliConfig {
	/** Stop execution on first failure (default: true unless step has continueOnFailure) */
	stopOnFailure?: boolean;

	/**
	 * Base path for resolving relative fixture paths of scenarios that were not
	 * parsed from a file. Scenarios from `parseScenarioFile` resolve fixtures
	 * against their own directory.
	 */
	basePath?: string;

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
	async execute(scenario: Scenario, options: ExecuteScenarioOptions = {}): Promise<ScenarioResult> {
		return runScenario(scenario, {
			stopOnFailure: this.config.stopOnFailure ?? true,
			signal: options.signal,
			onStepComplete: this.config.onStepComplete,
			onScenarioStart: this.config.onScenarioStart,
			onScenarioComplete: this.config.onScenarioComplete,
			setup: scenario.fixture ? (signal) => this.setupFixture(scenario, signal) : undefined,
			runStep: (step, stepId, signal) => this.runStep(step, stepId, signal),
		});
	}

	/**
	 * Execute a single step through the CLI.
	 */
	private async runStep(step: Step, stepId: string, signal: AbortSignal): Promise<StepResult> {
		const executeResult = await this.cli.execute(step.command, step.input, { signal });

		if (!executeResult.success) {
			// CLI execution itself failed
			return {
				stepId,
				command: step.command,
				outcome: 'error',
				durationMs: executeResult.durationMs,
				error: executeResult.error,
				assertions: [],
			};
		}

		return evaluateStep(step, stepId, executeResult.result, executeResult.durationMs, true);
	}

	/**
	 * Load the scenario's fixture and apply it through the CLI.
	 */
	private async setupFixture(scenario: Scenario, signal: AbortSignal): Promise<SetupOutcome> {
		if (!scenario.fixture) {
			return {};
		}
		const loadResult = await loadFixture(scenario.fixture, {
			basePath: scenario.sourcePath ? dirname(scenario.sourcePath) : this.config.basePath,
		});
		if (!loadResult.success) {
			return { error: `Fixture failed to load: ${loadResult.error}` };
		}

		const applyResult = await applyFixture(
			loadResult.data,
			async (command, input): Promise<CommandResult<unknown>> => {
				const executed = await this.cli.execute(command, input, { signal });
				return executed.success
					? executed.result
					: failure({
							code: 'CLI_ERROR',
							message: executed.error.message,
							suggestion: 'Check that the AFD CLI can reach the server under test',
						});
			},
			{ signal }
		);
		const warnings = applyResult.warnings ?? [];
		if (!applyResult.success) {
			return { error: applyResult.error ?? 'Fixture failed to apply', warnings };
		}
		return { warnings };
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
		if (config.basePath !== undefined) {
			this.config.basePath = config.basePath;
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

export {
	type CommandHandler,
	createInProcessExecutor,
	InProcessExecutor,
	type InProcessExecutorConfig,
} from './in-process-executor.js';
export type { ExecuteScenarioOptions } from './scenario-runner.js';
// Re-export validation from dedicated module
export { type ScenarioValidationResult, validateScenario } from './validator.js';

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a CLI-based scenario executor.
 */
export function createExecutor(config?: ExecutorConfig): ScenarioExecutor {
	return new ScenarioExecutor(config);
}
