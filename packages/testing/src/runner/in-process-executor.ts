/**
 * @lushly-dev/afd-testing - In-process scenario executor
 *
 * Runs scenario steps by calling a command handler directly (no CLI
 * subprocess). Supports fixtures, step references, dry runs, timeouts and
 * cancellation through the shared scenario run loop.
 */

import { dirname } from 'node:path';
import type { CommandResult } from '@lushly-dev/afd-core';
import type { ScenarioResult, StepResult } from '../types/report.js';
import { createStepError } from '../types/report.js';
import type { Scenario, Step } from '../types/scenario.js';
import { applyFixture, type FixtureData, loadFixture } from './fixture-loader.js';
import {
	type ExecuteScenarioOptions,
	evaluateStep,
	runScenario,
	type SetupOutcome,
} from './scenario-runner.js';

/**
 * Command handler function signature for in-process execution.
 *
 * The optional third argument carries the run's `AbortSignal`, so a handler
 * can stop work when a scenario times out or is cancelled.
 */
export type CommandHandler = (
	command: string,
	input?: Record<string, unknown>,
	context?: { signal?: AbortSignal }
) => Promise<CommandResult<unknown>>;

/**
 * Executor config for in-process mode.
 */
export interface InProcessExecutorConfig {
	/** Command handler function */
	handler: CommandHandler;

	/** Stop on first failure */
	stopOnFailure?: boolean;

	/**
	 * Base path for resolving relative fixture paths of scenarios that were not
	 * parsed from a file. Scenarios from `parseScenarioFile` resolve fixtures
	 * against their own directory.
	 */
	basePath?: string;

	/**
	 * Reject fixture files that resolve outside this directory (used to
	 * sandbox evaluations started through the MCP tools).
	 */
	fixtureRoot?: string;

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

	/** Fixture loaded callback with the applied commands and any adapter warnings */
	onFixtureLoaded?: (
		fixture: FixtureData,
		appliedCommands: Array<{ command: string; input?: unknown }>,
		warnings: string[]
	) => void;
}

/**
 * Executor that runs commands in-process (no CLI subprocess).
 * Useful for faster unit testing of scenarios.
 *
 * Supports:
 * - Fixture loading and application (a failed fixture command fails the scenario)
 * - Step references (${{ steps[0].data.id }}); unresolved references are errors
 * - Scenario `timeout` and cancellation through `execute(scenario, { signal })`
 * - Dry run mode for validation without execution
 */
export class InProcessExecutor {
	private handler: CommandHandler;
	private config: Omit<InProcessExecutorConfig, 'handler'>;

	constructor(config: InProcessExecutorConfig) {
		this.handler = config.handler;
		this.config = {
			stopOnFailure: config.stopOnFailure ?? true,
			basePath: config.basePath,
			fixtureRoot: config.fixtureRoot,
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
	async execute(scenario: Scenario, options: ExecuteScenarioOptions = {}): Promise<ScenarioResult> {
		const { fixture } = scenario;
		return runScenario(scenario, {
			stopOnFailure: this.config.stopOnFailure ?? true,
			dryRun: this.config.dryRun,
			signal: options.signal,
			onStepComplete: this.config.onStepComplete,
			onScenarioStart: this.config.onScenarioStart,
			onScenarioComplete: this.config.onScenarioComplete,
			setup: fixture ? (signal) => this.setupFixture(scenario, signal) : undefined,
			runStep: (step, stepId, signal) => this.runStep(step, stepId, signal),
		});
	}

	private async runStep(step: Step, stepId: string, signal: AbortSignal): Promise<StepResult> {
		const startTime = Date.now();
		let commandResult: CommandResult<unknown>;
		try {
			commandResult = await this.handler(step.command, step.input, { signal });
		} catch (err) {
			return {
				stepId,
				command: step.command,
				outcome: 'error',
				durationMs: Date.now() - startTime,
				error: createStepError('command_failed', err instanceof Error ? err.message : String(err)),
				assertions: [],
			};
		}
		return evaluateStep(step, stepId, commandResult, Date.now() - startTime);
	}

	/**
	 * Load the scenario's fixture and, unless this is a dry run, apply it.
	 */
	private async setupFixture(scenario: Scenario, signal: AbortSignal): Promise<SetupOutcome> {
		if (!scenario.fixture) {
			return {};
		}
		const loadResult = await loadFixture(scenario.fixture, {
			basePath: scenario.sourcePath ? dirname(scenario.sourcePath) : this.config.basePath,
			rootDir: this.config.fixtureRoot,
		});
		if (!loadResult.success) {
			const prefix = this.config.dryRun ? 'Fixture validation failed' : 'Fixture failed to load';
			return { error: `${prefix}: ${loadResult.error}` };
		}
		if (this.config.dryRun) {
			return {};
		}

		const applyResult = await applyFixture(loadResult.data, this.handler, { signal });
		const warnings = applyResult.warnings ?? [];
		if (!applyResult.success) {
			return { error: applyResult.error ?? 'Fixture failed to apply', warnings };
		}

		this.config.onFixtureLoaded?.(loadResult.data, applyResult.appliedCommands, warnings);
		return { warnings };
	}
}

/**
 * Create an in-process scenario executor.
 */
export function createInProcessExecutor(config: InProcessExecutorConfig): InProcessExecutor {
	return new InProcessExecutor(config);
}
