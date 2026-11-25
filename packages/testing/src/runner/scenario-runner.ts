/**
 * @lushly-dev/afd-testing - Shared scenario run loop
 *
 * One loop for `ScenarioExecutor` (CLI) and `InProcessExecutor`: fixture
 * setup, step reference resolution, cancellation, timeouts, skipping and the
 * scenario outcome all behave the same whichever way steps are executed.
 */

import type { CommandResult, Recovery } from '@lushly-dev/afd-core';
import { isCommandRecovery } from '@lushly-dev/afd-core/errors';
import { InvalidExpectationError } from '../types/matchers.js';
import type {
	AssertionResult,
	ScenarioError,
	ScenarioOutcome,
	ScenarioResult,
	StepError,
	StepOutcome,
	StepResult,
} from '../types/report.js';
import { createStepError } from '../types/report.js';
import type { Expectation, FollowExpectation, Scenario, Step } from '../types/scenario.js';
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

/** Step outcomes produced by executing a step (never `'skip'`, which the runner owns). */
export type ExecutedStepOutcome = Exclude<StepOutcome, 'skip'>;

/** Result of executing a non-skipped step. */
export type ExecutedStepResult = Omit<StepResult, 'outcome'> & {
	outcome: ExecutedStepOutcome;
};

/** Lifecycle callbacks shared by executors and `runScenario`. */
export interface ScenarioHooks {
	/**
	 * Awaited hook invoked immediately before a non-skipped step executes (after
	 * step references resolve). Not called for skipped steps, reference-resolution
	 * errors, or during dry runs.
	 */
	beforeStep?: (step: Step, stepId: string, signal: AbortSignal) => Promise<void> | void;
	/**
	 * Awaited hook invoked immediately after a non-skipped step finishes (including
	 * expectation failures and non-abort step errors), unless reference resolution
	 * failed, `beforeStep` failed, or the run was aborted. Not called for skipped
	 * steps or during dry runs.
	 */
	afterStep?: (step: Step, result: StepResult, signal: AbortSignal) => Promise<void> | void;
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

/** Configuration for `runScenario`. */
export interface RunConfig extends ScenarioHooks {
	stopOnFailure: boolean;
	dryRun?: boolean;
	signal?: AbortSignal;
	setup?: (signal: AbortSignal) => Promise<SetupOutcome>;
	runStep: (step: Step, stepId: string, signal: AbortSignal) => Promise<ExecutedStepResult>;
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
		return formatAssertionFailure(first);
	}
	const lines = failures.map((f) => `  - ${formatAssertionFailure(f)}`);
	return `${failures.length} assertions failed:\n${lines.join('\n')}`;
}

function formatAssertionFailure(failure: AssertionResult): string {
	// An unreadable recovery can look like the expected one, so say why it fails.
	if (failure.matcher === 'readable' && failure.description) {
		return `${failure.description}; got ${formatValue(failure.actual)}`;
	}
	return `${failure.path}: expected ${formatValue(failure.expected)}, got ${formatValue(failure.actual)}`;
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
): ExecutedStepResult {
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
): ExecutedStepResult {
	return {
		stepId,
		command: step.command,
		outcome: 'error',
		durationMs: Date.now() - startTime,
		error: createStepError(type, message),
		assertions: [],
	};
}

// ============================================================================
// Following a recovery
// ============================================================================

const SUCCEEDS: Expectation = { success: true };

/** The refused step's result, failed with `message` and the follow calls made so far. */
function followFailed(
	result: StepResult,
	message: string,
	follow: StepResult[] = []
): ExecutedStepResult {
	return {
		...(result as ExecutedStepResult),
		outcome: 'fail',
		error: createStepError('expectation_mismatch', `follow: ${message}`),
		...(follow.length > 0 ? { follow } : {}),
	};
}

/** Whether a followed call came straight back to the refusal it was meant to get past. */
function sameRefusal(refused: Step, refusal: CommandResult<unknown>, call: StepResult): boolean {
	const result = call.commandResult;
	return (
		call.command === refused.command &&
		result?.success === false &&
		result.error?.code !== undefined &&
		result.error.code === refusal.error?.code
	);
}

/**
 * Take the step a refusal's structured recovery describes and judge whether it got further
 * (`spec/recovery.md`, "What a test can check"). The calls run through the executor like any
 * step, so they change the state later steps see, as following the advice would.
 */
async function followRecovery(
	step: Step,
	follow: FollowExpectation,
	stepId: string,
	result: StepResult,
	signal: AbortSignal,
	config: RunConfig
): Promise<StepResult> {
	const refusal = result.commandResult;
	const recovery: unknown = refusal?.error?.recovery;
	if (refusal?.success !== false) {
		return followFailed(result, 'the step did not return a refusal to follow');
	}
	if (recovery == null) {
		return followFailed(result, `the ${refusal.error?.code} refusal carries no recovery to follow`);
	}
	if (!isCommandRecovery(recovery)) {
		return followFailed(result, `the ${refusal.error?.code} refusal's recovery is unreadable`);
	}
	const kind = (recovery as Recovery).kind;
	if (kind === 'external' || kind === 'stop') {
		return followFailed(
			result,
			`a ${kind} recovery has nothing a program can follow; assert it with expect.error.recovery`
		);
	}
	if (follow.retry && !(recovery.kind === 'call' && recovery.thenRetry)) {
		return followFailed(result, "'follow.retry' needs a call recovery with thenRetry");
	}
	const recoveryInput = 'input' in recovery ? (recovery.input ?? {}) : {};
	const needs = 'needs' in recovery ? (recovery.needs ?? []) : [];
	// Rule 3: what the recovery knows goes in input, what the caller chooses in needs, never both.
	const both = needs.filter((field) => Object.hasOwn(recoveryInput, field));
	if (both.length > 0) {
		return followFailed(result, `the recovery names ${both.join(', ')} in both input and needs`);
	}
	// The scenario chooses only what the recovery leaves to the caller, so it cannot correct a
	// recovery that is wrong.
	const unneeded = Object.keys(follow.input ?? {}).filter((field) => !needs.includes(field));
	if (unneeded.length > 0) {
		return followFailed(
			result,
			`follow.input gives ${unneeded.join(', ')}, which the recovery does not leave to the caller`
		);
	}
	const missing = needs.filter((field) => follow.input?.[field] === undefined);
	if (missing.length > 0) {
		return followFailed(
			result,
			`the recovery needs ${missing.join(', ')}; give ${missing.length > 1 ? 'them' : 'it'} in follow.input`
		);
	}

	const calls: Step[] = [];
	if (recovery.kind === 'call') {
		calls.push({
			command: recovery.command,
			input: { ...recoveryInput, ...follow.input },
			expect: follow.expect ?? SUCCEEDS,
		});
		if (recovery.thenRetry) {
			calls.push({ command: step.command, input: step.input, expect: follow.retry ?? SUCCEEDS });
		}
	} else if (recovery.kind === 'fix-input') {
		calls.push({
			command: step.command,
			input: { ...step.input, ...recoveryInput, ...follow.input },
			expect: follow.expect ?? SUCCEEDS,
		});
	} else {
		calls.push({ command: step.command, input: step.input, expect: follow.expect ?? SUCCEEDS });
	}

	const made: StepResult[] = [];
	for (const [index, call] of calls.entries()) {
		const outcome = await runWithAbort(
			() => config.runStep(call, `${stepId}.follow.${index + 1}`, signal),
			signal
		);
		made.push(outcome);
		if (sameRefusal(step, refusal, outcome)) {
			return followFailed(
				result,
				`${call.command} came back with the same ${refusal.error?.code} refusal`,
				made
			);
		}
		if (outcome.outcome !== 'pass') {
			const why = outcome.error?.message ?? 'its expectation did not hold';
			return followFailed(result, `${call.command}: ${why}`, made);
		}
	}
	return { ...result, follow: made };
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
 * Invoke `fn` only if `signal` is not already aborted, then settle with its
 * result or reject with the abort reason as soon as `signal` aborts.
 *
 * When `fn` aborts synchronously and returns a rejecting promise, the returned
 * promise is still observed so it never leaks an unhandled rejection.
 */
function runWithAbort<T>(fn: () => Promise<T> | T, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(signal.reason);
	}
	let returned: Promise<T> | T;
	try {
		returned = fn();
	} catch (err) {
		return Promise.reject(err);
	}
	const promise = Promise.resolve(returned);
	if (signal.aborted) {
		promise.catch(() => {});
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
	let followInput: Record<string, unknown> | undefined;
	try {
		input = resolveStepReferences(step.input, stepOutputs);
		followInput = resolveStepReferences(step.follow?.input, stepOutputs);
	} catch (err) {
		const type = err instanceof StepReferenceError ? 'reference_error' : 'unknown';
		return errorStep(step, stepId, startTime, type, messageOf(err));
	}

	// Always pass a shallow copy so hooks or executors cannot mutate the parsed Scenario.
	const resolvedStep: Step = input !== undefined ? { ...step, input } : { ...step };
	if (step.follow && followInput !== undefined) {
		resolvedStep.follow = { ...step.follow, input: followInput };
	}

	const abortOrError = (
		err: unknown,
		existing?: Pick<StepResult, 'commandResult' | 'assertions'>
	): StepResult => {
		const base = signal.aborted
			? (() => {
					const reason = describeAbort(signal);
					return errorStep(
						step,
						stepId,
						startTime,
						reason.type === 'timeout' ? 'timeout' : 'unknown',
						reason.message
					);
				})()
			: errorStep(step, stepId, startTime, 'unknown', messageOf(err));

		return {
			...base,
			...(existing?.commandResult !== undefined ? { commandResult: existing.commandResult } : {}),
			...(existing?.assertions ? { assertions: existing.assertions } : {}),
		};
	};

	if (config.beforeStep) {
		try {
			await runWithAbort(() => config.beforeStep?.(resolvedStep, stepId, signal), signal);
		} catch (err) {
			return abortOrError(err);
		}
	}

	let result: StepResult;
	try {
		result = await runWithAbort(() => config.runStep(resolvedStep, stepId, signal), signal);
	} catch (err) {
		if (signal.aborted) {
			return abortOrError(err);
		}
		// Non-abort rejections become error step results and flow through afterStep
		// just like executors that catch and return an error StepResult.
		result = errorStep(step, stepId, startTime, 'unknown', messageOf(err));
	}

	if (signal.aborted) {
		return abortOrError(signal.reason, result);
	}

	if (resolvedStep.follow && result.outcome === 'pass') {
		try {
			result = await followRecovery(
				resolvedStep,
				resolvedStep.follow,
				stepId,
				result,
				signal,
				config
			);
		} catch (err) {
			return abortOrError(err, result);
		}
		if (signal.aborted) {
			return abortOrError(signal.reason, result);
		}
	}

	if (config.afterStep && result.outcome !== 'skip') {
		try {
			await runWithAbort(() => config.afterStep?.(resolvedStep, result, signal), signal);
		} catch (err) {
			return abortOrError(err, result);
		}
	}

	return result;
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
			const setupFn = config.setup;
			try {
				const setup = await runWithAbort(() => setupFn(run.signal), run.signal);
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
