/**
 * @lushly-dev/afd-testing - Shared scenario run loop
 *
 * One loop for `ScenarioExecutor` (CLI) and `InProcessExecutor`: fixture
 * setup, step reference resolution, cancellation, timeouts, skipping and the
 * scenario outcome all behave the same whichever way steps are executed.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import { InvalidExpectationError } from '../types/matchers.js';
import type {
	AssertionResult,
	ScenarioError,
	ScenarioOutcome,
	ScenarioResult,
	StepError,
	StepResult,
} from '../types/report.js';
import { createStepError } from '../types/report.js';
import type { Scenario, Step } from '../types/scenario.js';
import { UNSUPPORTED_SCENARIO_FIELDS } from '../types/scenario.js';
import { evaluateResult } from './evaluator.js';
import { resolveStepReferences, StepReferenceError } from './step-references.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for a single `execute()` call.
 */
export interface ExecuteScenarioOptions {
	/**
	 * Cancels the run. The running step is abandoned (a handler that accepts
	 * the signal can stop early), the remaining steps are skipped, and the
	 * scenario is reported as an `error` with the abort reason.
	 */
	signal?: AbortSignal;
}

/** Lifecycle callbacks shared by both executors. */
interface ScenarioHooks {
	onStepComplete?: (step: Step, result: StepResult) => void;
	onScenarioStart?: (scenario: Scenario) => void;
	onScenarioComplete?: (result: ScenarioResult) => void;
}

/** Result of preparing a scenario (fixture setup). */
export interface SetupOutcome {
	/** When set, setup failed and no step runs */
	error?: string;
	/** Non-fatal warnings to report on the scenario result */
	warnings?: string[];
}

interface RunConfig extends ScenarioHooks {
	stopOnFailure: boolean;
	dryRun?: boolean;
	signal?: AbortSignal;
	setup?: (signal: AbortSignal) => Promise<SetupOutcome>;
	runStep: (step: Step, stepId: string, signal: AbortSignal) => Promise<StepResult>;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatValue(value: unknown): string {
	if (value === undefined) return 'undefined';
	if (value === null) return 'null';
	if (typeof value === 'string') {
		return value.length > 40 ? `"${value.slice(0, 40)}..."` : `"${value}"`;
	}
	if (typeof value === 'object') {
		try {
			const str = JSON.stringify(value);
			return str.length > 60 ? `${str.slice(0, 60)}...` : str;
		} catch {
			return '[object]';
		}
	}
	return String(value);
}

/**
 * Format failed assertions into a human-readable error message.
 */
function formatAssertionFailures(failures: AssertionResult[]): string {
	const [first] = failures;
	if (!first) {
		return 'Assertions failed';
	}
	if (failures.length === 1) {
		return `${first.path}: expected ${formatValue(first.expected)}, got ${formatValue(first.actual)}`;
	}
	const lines = failures.map(
		(f) => `  - ${f.path}: expected ${formatValue(f.expected)}, got ${formatValue(f.actual)}`
	);
	return `${failures.length} assertions failed:\n${lines.join('\n')}`;
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// ============================================================================
// Step evaluation
// ============================================================================

/**
 * Evaluate a command result against a step's expectation.
 *
 * A malformed expectation is reported as a step `error` of type `parse_error`.
 */
export function evaluateStep(
	step: Step,
	stepId: string,
	commandResult: CommandResult<unknown>,
	durationMs: number,
	withDetails = false
): StepResult {
	let evaluation: ReturnType<typeof evaluateResult>;
	try {
		evaluation = evaluateResult(commandResult, step.expect);
	} catch (err) {
		if (!(err instanceof InvalidExpectationError)) throw err;
		return {
			stepId,
			command: step.command,
			outcome: 'error',
			durationMs,
			commandResult,
			assertions: [],
			error: createStepError('parse_error', `Invalid expectation: ${err.message}`),
		};
	}

	const failed = evaluation.assertions.filter((a) => !a.passed);
	return {
		stepId,
		command: step.command,
		outcome: evaluation.passed ? 'pass' : 'fail',
		durationMs,
		commandResult,
		assertions: evaluation.assertions,
		error: evaluation.passed
			? undefined
			: createStepError(
					'expectation_mismatch',
					formatAssertionFailures(failed),
					withDetails ? { expected: step.expect, actual: commandResult } : undefined
				),
	};
}

function errorStep(
	step: Step,
	stepId: string,
	startTime: number,
	type: StepError['type'],
	message: string
): StepResult {
	return {
		stepId,
		command: step.command,
		outcome: 'error',
		durationMs: Date.now() - startTime,
		error: createStepError(type, message),
		assertions: [],
	};
}

/**
 * Determine the overall scenario outcome from step counts.
 */
export function determineOutcome(passed: number, failed: number, skipped: number): ScenarioOutcome {
	if (failed === 0 && skipped === 0) return 'pass';
	if (passed === 0) return 'fail';
	if (failed > 0) return 'partial';
	return 'fail';
}

// ============================================================================
// Cancellation
// ============================================================================

/** Abort reason used for scenario timeouts. */
class ScenarioTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TimeoutError';
	}
}

/**
 * Create an abort reason for a timeout, recognised as a `timeout` error.
 */
export function createTimeoutReason(timeoutMs: number): Error {
	return new ScenarioTimeoutError(`Scenario timed out after ${timeoutMs}ms`);
}

function describeAbort(signal: AbortSignal): ScenarioError {
	const reason: unknown = signal.reason;
	const name = typeof reason === 'object' && reason !== null && 'name' in reason ? reason.name : '';
	const message = reason instanceof Error && reason.message ? reason.message : '';
	if (name === 'TimeoutError') {
		return { type: 'timeout', message: message || 'Scenario timed out' };
	}
	return {
		type: 'aborted',
		message: message ? `Scenario aborted: ${message}` : 'Scenario aborted',
	};
}

/**
 * Combine the caller's signal and the scenario's own timeout. `dispose()`
 * clears the timer and the listener so nothing outlives the run.
 */
function createRunSignal(
	timeoutMs: number | undefined,
	parent: AbortSignal | undefined
): { signal: AbortSignal; dispose: () => void } {
	const controller = new AbortController();
	const forward = () => controller.abort(parent?.reason);
	if (parent?.aborted) {
		forward();
	} else {
		parent?.addEventListener('abort', forward, { once: true });
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	if (timeoutMs !== undefined && !controller.signal.aborted) {
		timer = setTimeout(() => controller.abort(createTimeoutReason(timeoutMs)), timeoutMs);
	}

	return {
		signal: controller.signal,
		dispose: () => {
			if (timer !== undefined) clearTimeout(timer);
			parent?.removeEventListener('abort', forward);
		},
	};
}

/**
 * Settle with the promise, or reject with the abort reason as soon as the
 * signal aborts, whichever happens first.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(signal.reason);
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(err: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(err);
			}
		);
	});
}

// ============================================================================
// Run loop
// ============================================================================

/**
 * Report scenario fields the runner cannot honour instead of ignoring them.
 */
function configurationError(scenario: Scenario): ScenarioError | undefined {
	const declared: Record<string, unknown> = {
		verify: scenario.verify,
		isolation: scenario.isolation,
		dependsOn: scenario.dependsOn,
	};
	for (const [field, message] of Object.entries(UNSUPPORTED_SCENARIO_FIELDS)) {
		if (declared[field] !== undefined) {
			return { type: 'unsupported', message };
		}
	}
	const { timeout } = scenario;
	if (timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0)) {
		return {
			type: 'unsupported',
			message: "'timeout' must be a positive number of milliseconds",
		};
	}
	return undefined;
}

async function executeStep(
	step: Step,
	stepId: string,
	stepOutputs: ReadonlyArray<CommandResult<unknown>>,
	signal: AbortSignal,
	config: RunConfig
): Promise<StepResult> {
	const startTime = Date.now();

	let input: Record<string, unknown> | undefined;
	try {
		input = resolveStepReferences(step.input, stepOutputs);
	} catch (err) {
		const type = err instanceof StepReferenceError ? 'reference_error' : 'unknown';
		return errorStep(step, stepId, startTime, type, messageOf(err));
	}

	try {
		return await raceAbort(config.runStep({ ...step, input }, stepId, signal), signal);
	} catch (err) {
		if (signal.aborted) {
			const reason = describeAbort(signal);
			return errorStep(
				step,
				stepId,
				startTime,
				reason.type === 'timeout' ? 'timeout' : 'unknown',
				reason.message
			);
		}
		return errorStep(step, stepId, startTime, 'unknown', messageOf(err));
	}
}

/**
 * Run a scenario: setup, then each step in order.
 */
export async function runScenario(scenario: Scenario, config: RunConfig): Promise<ScenarioResult> {
	const startedAt = new Date();
	const startTime = Date.now();
	config.onScenarioStart?.(scenario);

	const run = createRunSignal(scenario.timeout, config.signal);
	const stepResults: StepResult[] = [];
	const stepOutputs: Array<CommandResult<unknown>> = [];
	let passedSteps = 0;
	let failedSteps = 0;
	let skippedSteps = 0;
	let scenarioError = configurationError(scenario);
	let skipReason = scenarioError?.message;
	let warnings: string[] | undefined;

	try {
		if (!scenarioError && config.setup) {
			try {
				const setup = await raceAbort(config.setup(run.signal), run.signal);
				warnings = setup.warnings && setup.warnings.length > 0 ? setup.warnings : undefined;
				if (setup.error) {
					scenarioError = { type: 'fixture_failed', message: setup.error };
				}
			} catch (err) {
				scenarioError = run.signal.aborted
					? describeAbort(run.signal)
					: { type: 'fixture_failed', message: `Fixture setup failed: ${messageOf(err)}` };
			}
			skipReason = scenarioError?.message;
		}

		for (const [index, step] of scenario.steps.entries()) {
			const stepId = `step-${index + 1}`;
			if (!skipReason && run.signal.aborted) {
				scenarioError = describeAbort(run.signal);
				skipReason = scenarioError.message;
			}

			let result: StepResult;
			if (skipReason) {
				result = {
					stepId,
					command: step.command,
					outcome: 'skip',
					durationMs: 0,
					assertions: [],
					skippedReason: skipReason,
				};
			} else if (config.dryRun) {
				result = { stepId, command: step.command, outcome: 'pass', durationMs: 0, assertions: [] };
			} else {
				result = await executeStep(step, stepId, stepOutputs, run.signal, config);
				if (run.signal.aborted) {
					scenarioError = describeAbort(run.signal);
					skipReason = scenarioError.message;
				}
			}

			stepResults.push(result);
			stepOutputs.push(result.commandResult ?? { success: result.outcome === 'pass' });

			switch (result.outcome) {
				case 'pass':
					passedSteps++;
					break;
				case 'fail':
				case 'error':
					failedSteps++;
					if (!skipReason && config.stopOnFailure && !step.continueOnFailure) {
						skipReason = 'Previous step failed';
					}
					break;
				case 'skip':
					skippedSteps++;
					break;
			}

			config.onStepComplete?.(step, result);
		}
	} finally {
		run.dispose();
	}

	const result: ScenarioResult = {
		scenarioPath: scenario.sourcePath ?? '',
		jobName: scenario.job,
		jobDescription: scenario.description,
		outcome: scenarioError ? 'error' : determineOutcome(passedSteps, failedSteps, skippedSteps),
		durationMs: Date.now() - startTime,
		stepResults,
		passedSteps,
		failedSteps,
		skippedSteps,
		startedAt,
		completedAt: new Date(),
		...(scenarioError ? { error: scenarioError } : {}),
		...(warnings ? { warnings } : {}),
	};

	config.onScenarioComplete?.(result);
	return result;
}
