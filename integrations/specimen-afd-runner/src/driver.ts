/**
 * Browser-safe Specimen `JobDriver` backed by `@lushly-dev/afd-testing/browser`.
 *
 * Runs AFD scenarios inside a single fresh Specimen page:
 * - Applies pre-loaded scenario fixtures through `applyFixture` via the `'afd'` runner.
 * - Drives steps through `runScenario` and `evaluateStep` with step references and
 *   structured `CommandResult` evaluation.
 * - Executes Specimen `before` person actions in an awaited `beforeStep` hook.
 * - Captures marked steps in an awaited `afterStep` hook only when the step passed and
 *   no earlier step failed (including under `continueOnFailure`).
 * - Wires Specimen's `host.signal` (`AbortSignal`) directly to cancellation.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import {
	type AppAdapter,
	applyFixture,
	type Expectation,
	evaluateStep,
	type FixtureCommandHandler,
	type FixtureData,
	runScenario,
	type Scenario,
	type Step,
} from '@lushly-dev/afd-testing/browser';
import type {
	JobDriver,
	JobDriverHost,
	JobDriverResult,
	JobDriverStepOutcome,
	JobScenario,
	ResolvedJobCapture,
} from '@lushly-dev/specimen';
import { AFD_RUNNER_ID, isCommandResult } from './runner.js';

export interface AfdJobDriverOptions {
	/** Command runner id invoked via `host.runCommand` (defaults to `entry.job.runner ?? 'afd'`). */
	runner?: string;
	/** Optional explicit fixture adapter forwarded to `applyFixture`. */
	adapter?: AppAdapter;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeExpectation(raw: unknown): Expectation {
	if (raw === undefined) {
		return { success: true };
	}
	return raw as Expectation;
}

function toAfdScenario(jobScenario: JobScenario): Scenario {
	const steps: Step[] = jobScenario.steps.map((step) => ({
		command: step.command,
		...(step.input !== undefined ? { input: step.input } : {}),
		...(step.description !== undefined ? { description: step.description } : {}),
		expect: normalizeExpectation(step.expect),
		...(step.continueOnFailure !== undefined ? { continueOnFailure: step.continueOnFailure } : {}),
	}));
	return {
		name: jobScenario.name ?? jobScenario.job,
		description: jobScenario.description ?? '',
		job: jobScenario.job,
		tags: [],
		steps,
	};
}

function parseStepNumber(stepId: string): number {
	const parsed = Number.parseInt(stepId.slice('step-'.length), 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`Unexpected stepId '${stepId}' from scenario runner.`);
	}
	return parsed;
}

function assertCommandResult(value: unknown, command: string): CommandResult<unknown> {
	if (!isCommandResult(value)) {
		throw new Error(
			`Command '${command}' did not return a structured CommandResult (expected an object with boolean 'success').`
		);
	}
	return value;
}

/** Create the in-page Specimen `JobDriver` for AFD scenarios. */
export function createAfdJobDriver(options: AfdJobDriverOptions = {}): JobDriver {
	return {
		async run(host: JobDriverHost): Promise<JobDriverResult> {
			const jobConfig = host.entry.job;
			if (!jobConfig) {
				throw new Error(`Specimen '${host.entry.id}' has no job configuration.`);
			}

			const runnerId = options.runner ?? jobConfig.runner ?? AFD_RUNNER_ID;
			const target = jobConfig.target;
			const afdScenario = toAfdScenario(host.scenario);
			const planByStep = new Map<number, ResolvedJobCapture>(
				host.capturePlan.map((capture) => [capture.step, capture])
			);
			const actionsByStep = new Map<number, number>();
			let anyStepFailed = false;

			const dispatchCommand = async (
				command: string,
				input: Record<string, unknown> | undefined,
				signal: AbortSignal
			): Promise<CommandResult<unknown>> => {
				signal.throwIfAborted();
				const raw = await host.runCommand(runnerId, target, command, input ?? {});
				signal.throwIfAborted();
				return assertCommandResult(raw, command);
			};

			const fixtureRaw = host.scenario.fixture;
			const setup =
				fixtureRaw === undefined || fixtureRaw === null
					? undefined
					: async (signal: AbortSignal) => {
							signal.throwIfAborted();
							if (!isPlainRecord(fixtureRaw)) {
								return { error: 'Job scenario fixture must be a JSON object.' };
							}
							const handler: FixtureCommandHandler = async (command, input, ctx) => {
								const activeSignal = ctx?.signal ?? signal;
								return dispatchCommand(command, input, activeSignal);
							};
							const applied = await applyFixture(fixtureRaw as FixtureData, handler, {
								signal,
								...(options.adapter ? { adapter: options.adapter } : {}),
							});
							if (!applied.success) {
								return {
									error: applied.error ?? 'Fixture setup failed.',
									...(applied.warnings ? { warnings: applied.warnings } : {}),
								};
							}
							return applied.warnings ? { warnings: applied.warnings } : {};
						};

			const scenarioResult = await runScenario(afdScenario, {
				stopOnFailure: true,
				signal: host.signal,
				...(setup ? { setup } : {}),

				async beforeStep(_step, stepId, signal) {
					signal.throwIfAborted();
					const stepNum = parseStepNumber(stepId);
					const plan = planByStep.get(stepNum);
					if (!plan || plan.before.length === 0) {
						return;
					}
					const count = await host.runActions(plan.before);
					signal.throwIfAborted();
					actionsByStep.set(stepNum, count);
				},

				async runStep(step, stepId, signal) {
					signal.throwIfAborted();
					const started = Date.now();
					const commandResult = await dispatchCommand(step.command, step.input, signal);
					return evaluateStep(step, stepId, commandResult, Date.now() - started);
				},

				async afterStep(step, result, signal) {
					if (result.outcome !== 'pass') {
						anyStepFailed = true;
						return;
					}
					if (anyStepFailed || signal.aborted) {
						return;
					}
					const stepNum = parseStepNumber(result.stepId);
					const plan = planByStep.get(stepNum);
					if (!plan) {
						return;
					}
					const actions = actionsByStep.get(stepNum);
					await host.captureStep({
						key: plan.key,
						name: plan.name,
						step: plan.step,
						...(step.description !== undefined ? { description: step.description } : {}),
						...(actions !== undefined && actions > 0 ? { actions } : {}),
					});
				},

				onStepComplete(_step, result) {
					if (result.outcome === 'fail' || result.outcome === 'error') {
						anyStepFailed = true;
					}
				},
			});

			const steps: JobDriverStepOutcome[] = scenarioResult.stepResults.map((stepResult, index) => {
				const scenarioStep = host.scenario.steps[index];
				const stepNum = scenarioStep?.step ?? index + 1;
				const actions = actionsByStep.get(stepNum);
				const status: JobDriverStepOutcome['status'] =
					stepResult.outcome === 'pass'
						? 'passed'
						: stepResult.outcome === 'skip'
							? 'skipped'
							: 'failed';
				const error =
					status === 'failed'
						? (stepResult.error?.message ?? scenarioResult.error?.message ?? 'Step failed')
						: status === 'skipped' && scenarioResult.error !== undefined
							? (stepResult.skippedReason ?? scenarioResult.error.message)
							: undefined;
				return {
					step: stepNum,
					...(scenarioStep?.description !== undefined
						? { description: scenarioStep.description }
						: {}),
					command: stepResult.command,
					status,
					...(error !== undefined ? { error } : {}),
					...(actions !== undefined && actions > 0 ? { actions } : {}),
				};
			});

			return {
				status: scenarioResult.outcome === 'pass' ? 'passed' : 'failed',
				steps,
			};
		},
	};
}
