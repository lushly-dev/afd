/**
 * Shared run loop behaviour, exercised through both executors: timeouts and
 * cancellation, fixtures, unresolved step references, unsupported fields.
 */

import { chmodSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandResult } from '@lushly-dev/afd-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scenario } from '../types/scenario.js';
import { type CommandHandler, InProcessExecutor, ScenarioExecutor } from './executor.js';
import {
	createTimeoutReason,
	determineOutcome,
	evaluateStep,
	runScenario,
} from './scenario-runner.js';

const cliFixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'fixtures',
	'fake-afd-cli.mjs'
);

beforeAll(() => chmodSync(cliFixturePath, 0o755));

function scenario(overrides: Partial<Scenario> = {}): Scenario {
	return {
		name: 'Runner',
		description: 'Runner behaviour',
		job: 'runner',
		tags: [],
		steps: [
			{ command: 'step-one', expect: { success: true } },
			{ command: 'step-two', expect: { success: true } },
		],
		...overrides,
	};
}

const ok = (data: unknown = {}): CommandResult<unknown> => ({ success: true, data });

describe('scenario timeout and cancellation', () => {
	it('stops a timed-out scenario: no later step runs and the error is recorded', async () => {
		const calls: string[] = [];
		let signalSeen: AbortSignal | undefined;
		const handler: CommandHandler = async (command, _input, context) => {
			calls.push(command);
			if (command === 'slow-step') {
				signalSeen = context?.signal;
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
			return ok();
		};

		const result = await new InProcessExecutor({ handler }).execute(
			scenario({
				timeout: 30,
				steps: [
					{ command: 'slow-step', expect: { success: true } },
					{ command: 'mutating-step', expect: { success: true } },
				],
			})
		);
		// Give the abandoned slow step time to finish: the next step must still not run
		await new Promise((resolve) => setTimeout(resolve, 250));

		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({ type: 'timeout', message: 'Scenario timed out after 30ms' });
		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'timeout'],
			['skip', undefined],
		]);
		expect(result.stepResults[1]?.skippedReason).toBe('Scenario timed out after 30ms');
		expect(calls).toEqual(['slow-step']);
		expect(signalSeen?.aborted).toBe(true);
	});

	it('cancels through the caller signal between steps', async () => {
		const controller = new AbortController();
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({
			handler,
			onStepComplete: () => controller.abort(new Error('user cancelled')),
		}).execute(scenario(), { signal: controller.signal });

		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({ type: 'aborted', message: 'Scenario aborted: user cancelled' });
		expect(result.stepResults.map((s) => s.outcome)).toEqual(['pass', 'skip']);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('abandons the running step when cancelled during it', async () => {
		const controller = new AbortController();
		const handler: CommandHandler = async () => {
			controller.abort();
			return ok();
		};

		const result = await new InProcessExecutor({ handler }).execute(scenario(), {
			signal: controller.signal,
		});

		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'unknown'],
			['skip', undefined],
		]);
		expect(result.error?.message).toContain('Scenario aborted');
	});

	it('does nothing when the signal is already aborted', async () => {
		const handler = vi.fn(async () => ok());
		const controller = new AbortController();
		controller.abort();

		const result = await new InProcessExecutor({ handler }).execute(scenario(), {
			signal: controller.signal,
		});

		expect(handler).not.toHaveBeenCalled();
		expect(result.error?.type).toBe('aborted');
		expect(result.skippedSteps).toBe(2);
	});

	it('classifies AbortSignal.timeout and createTimeoutReason as timeouts', async () => {
		const handler: CommandHandler = async () => ok();

		for (const reason of [
			createTimeoutReason(5),
			AbortSignal.abort(createTimeoutReason(7)).reason,
		]) {
			const controller = new AbortController();
			controller.abort(reason);
			const result = await new InProcessExecutor({ handler }).execute(scenario(), {
				signal: controller.signal,
			});
			expect(result.error?.type).toBe('timeout');
		}
	});

	it('clears the scenario timer when the scenario finishes first', async () => {
		vi.useFakeTimers();
		try {
			const result = await new InProcessExecutor({ handler: async () => ok() }).execute(
				scenario({ timeout: 60_000 })
			);

			expect(result.outcome).toBe('pass');
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('kills a hanging CLI step when the scenario times out', async () => {
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
		});
		const started = Date.now();

		const result = await executor.execute(
			scenario({
				timeout: 300,
				steps: [{ command: 'hang', input: { wait: true }, expect: { success: true } }],
			})
		);

		expect(result.error?.type).toBe('timeout');
		expect(result.stepResults[0]?.error?.type).toBe('timeout');
		expect(Date.now() - started).toBeLessThan(5000);
	});
});

describe('unsupported and invalid scenario fields', () => {
	it.each([
		['verify', { verify: { assertions: ['all done'] } }],
		['isolation', { isolation: 'chained' as const }],
		['dependsOn', { dependsOn: ['other'] }],
	])('reports %s as unsupported instead of passing without it', async (field, extra) => {
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({ handler }).execute(scenario(extra));

		expect(result.outcome).toBe('error');
		expect(result.error?.type).toBe('unsupported');
		expect(result.error?.message).toContain(`'${field}' is not supported`);
		expect(handler).not.toHaveBeenCalled();
	});

	it('reports a non-positive timeout', async () => {
		const result = await new InProcessExecutor({ handler: async () => ok() }).execute(
			scenario({ timeout: 0 })
		);

		expect(result.error).toEqual({
			type: 'unsupported',
			message: "'timeout' must be a positive number of milliseconds",
		});
	});
});

describe('step references', () => {
	it('errors on a reference that does not resolve instead of sending an empty value', async () => {
		const inputs: unknown[] = [];
		const handler: CommandHandler = async (_command, input) => {
			inputs.push(input);
			return ok({ id: 'abc' });
		};

		const result = await new InProcessExecutor({ handler, stopOnFailure: false }).execute(
			scenario({
				steps: [
					{ command: 'item-create', expect: { success: true } },
					{
						command: 'item-get',
						input: { id: '${{ steps[0].data.missing }}' },
						expect: { success: true },
					},
					{
						command: 'item-rename',
						input: { name: 'copy of ${{ steps[0].data.nothing }}' },
						expect: { success: true },
					},
					{
						command: 'item-delete',
						input: { id: '${{ steps[9].data.id }}' },
						expect: { success: true },
					},
				],
			})
		);

		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['pass', undefined],
			['error', 'reference_error'],
			['error', 'reference_error'],
			['error', 'reference_error'],
		]);
		expect(result.stepResults[1]?.error?.message).toContain(
			"steps[0] has no value at 'data.missing'"
		);
		expect(result.stepResults[3]?.error?.message).toContain('step 9 has not run');
		// Only the first step reached the handler
		expect(inputs).toEqual([undefined]);
	});

	it('resolves references through the CLI executor too', async () => {
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
		});

		const result = await executor.execute(
			scenario({
				steps: [
					{ command: 'seed', input: { id: 'abc-1' }, expect: { success: true } },
					{
						command: 'echo',
						input: { ref: '${{ steps[0].data.id }}', label: 'id=${{ steps[0].data.id }}' },
						expect: { success: true, data: { ref: 'abc-1', label: 'id=abc-1' } },
					},
				],
			})
		);

		expect(result.outcome).toBe('pass');
	});
});

describe('fixtures', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'afd-runner-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('applies fixtures through the CLI and fails at the fixture step on a failed command', async () => {
		// The fake CLI expects a positional JSON input on every call
		const input = { n: 1 };
		const steps = [{ command: 'step-one', input, expect: { success: true } }];
		await writeFile(join(dir, 'ok.json'), JSON.stringify({ setup: [{ command: 'seed', input }] }));
		await writeFile(
			join(dir, 'bad.json'),
			JSON.stringify({
				setup: [
					{ command: 'fail-command', input },
					{ command: 'seed', input },
				],
			})
		);
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
			basePath: dir,
		});

		const passing = await executor.execute(scenario({ steps, fixture: { file: 'ok.json' } }));
		const failing = await executor.execute(scenario({ steps, fixture: { file: 'bad.json' } }));
		const missing = await executor.execute(scenario({ steps, fixture: { file: 'none.json' } }));

		expect(passing.outcome).toBe('pass');
		expect(failing.outcome).toBe('error');
		expect(failing.error?.message).toBe(
			"Fixture command 'fail-command' failed with EXPECTED_FAILURE: Expected failure"
		);
		expect(failing.stepResults.every((s) => s.outcome === 'skip')).toBe(true);
		expect(missing.error?.message).toContain('Fixture failed to load');
	});

	it('resolves fixtures next to the scenario file, not the working directory', async () => {
		await writeFile(join(dir, 'seed.json'), JSON.stringify({ setup: [{ command: 'seed-it' }] }));
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({ handler, basePath: '/nowhere' }).execute(
			scenario({ fixture: { file: './seed.json' }, sourcePath: join(dir, 'a.scenario.yaml') })
		);

		expect(result.outcome).toBe('pass');
		expect(handler).toHaveBeenCalledWith('seed-it', {}, expect.anything());
	});

	it('reports adapter warnings on the result and to onFixtureLoaded', async () => {
		await writeFile(join(dir, 'seed.json'), JSON.stringify({ setup: [{ nope: true }] }));
		const onFixtureLoaded = vi.fn();

		const result = await new InProcessExecutor({
			handler: async () => ok(),
			basePath: dir,
			onFixtureLoaded,
		}).execute(scenario({ fixture: { file: 'seed.json' } }));

		expect(result.warnings).toEqual(["Skipped a fixture entry without a string 'command'"]);
		expect(onFixtureLoaded).toHaveBeenCalledWith(expect.anything(), [], result.warnings);
	});

	it('only loads the fixture in a dry run', async () => {
		await writeFile(join(dir, 'seed.json'), JSON.stringify({ setup: [{ command: 'seed' }] }));
		const handler = vi.fn(async () => ok());

		const dry = await new InProcessExecutor({ handler, basePath: dir, dryRun: true }).execute(
			scenario({ fixture: { file: 'seed.json' } })
		);
		const dryMissing = await new InProcessExecutor({
			handler,
			basePath: dir,
			dryRun: true,
		}).execute(scenario({ fixture: { file: 'none.json' } }));

		expect(dry.outcome).toBe('pass');
		expect(handler).not.toHaveBeenCalled();
		expect(dryMissing.error?.message).toContain('Fixture validation failed');
	});

	it('confines fixtures to fixtureRoot', async () => {
		const handler = vi.fn(async () => ok());

		const result = await new InProcessExecutor({ handler, fixtureRoot: dir }).execute(
			scenario({ fixture: { file: '../../etc/passwd' }, sourcePath: join(dir, 'a.scenario.yaml') })
		);

		expect(result.error?.type).toBe('fixture_failed');
		expect(result.error?.message).toContain('outside the allowed directory');
		expect(handler).not.toHaveBeenCalled();
	});
});

describe('invalid expectations and outcomes', () => {
	it('reports a malformed expectation as a step error, not a pass', async () => {
		const result = await new InProcessExecutor({ handler: async () => ok({ user: {} }) }).execute(
			scenario({
				steps: [
					{
						command: 'user-get',
						expect: { success: true, data: { user: { exists: true, name: 'Bob' } } },
					},
				],
			})
		);

		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.type).toBe('parse_error');
	});

	it('determines outcomes from step counts', () => {
		expect(determineOutcome(2, 0, 0)).toBe('pass');
		expect(determineOutcome(0, 1, 1)).toBe('fail');
		expect(determineOutcome(1, 1, 0)).toBe('partial');
		expect(determineOutcome(1, 0, 1)).toBe('fail');
	});
});

describe('awaited beforeStep and afterStep hooks', () => {
	it('awaits beforeStep and afterStep in strict step order with resolved inputs and signal', async () => {
		const events: string[] = [];
		const signalsSeen: AbortSignal[] = [];

		const result = await runScenario(
			scenario({
				steps: [
					{
						description: 'Create note',
						command: 'note-create',
						input: { title: 'Hello' },
						expect: { success: true },
					},
					{
						description: 'Update note',
						command: 'note-update',
						input: { id: '${{ steps[0].data.id }}' },
						expect: { success: true },
					},
				],
			}),
			{
				stopOnFailure: true,
				beforeStep: async (step, stepId, signal) => {
					signalsSeen.push(signal);
					events.push(`before-start:${stepId}:${JSON.stringify(step.input)}`);
					await new Promise((resolve) => setTimeout(resolve, 15));
					events.push(`before-end:${stepId}`);
				},
				runStep: async (step, stepId) => {
					events.push(`run:${stepId}:${step.command}`);
					return evaluateStep(step, stepId, ok({ id: 'note-42' }), 1);
				},
				afterStep: async (step, stepResult, signal) => {
					signalsSeen.push(signal);
					events.push(`after-start:${stepResult.stepId}:${step.command}:${stepResult.outcome}`);
					await new Promise((resolve) => setTimeout(resolve, 15));
					events.push(`after-end:${stepResult.stepId}`);
				},
				onStepComplete: (_step, stepResult) => {
					events.push(`complete:${stepResult.stepId}:${stepResult.outcome}`);
				},
			}
		);

		expect(result.outcome).toBe('pass');
		expect(signalsSeen).toHaveLength(4);
		expect(signalsSeen.every((s) => s instanceof AbortSignal && !s.aborted)).toBe(true);
		expect(events).toEqual([
			'before-start:step-1:{"title":"Hello"}',
			'before-end:step-1',
			'run:step-1:note-create',
			'after-start:step-1:note-create:pass',
			'after-end:step-1',
			'complete:step-1:pass',
			'before-start:step-2:{"id":"note-42"}',
			'before-end:step-2',
			'run:step-2:note-update',
			'after-start:step-2:note-update:pass',
			'after-end:step-2',
			'complete:step-2:pass',
		]);
	});

	it('does not call beforeStep or afterStep for skipped steps after a failure, while leaving onStepComplete unchanged', async () => {
		const beforeCalls: string[] = [];
		const afterCalls: Array<[string, string]> = [];
		const completeCalls: Array<[string, string]> = [];

		const result = await runScenario(
			scenario({
				steps: [
					{ command: 'step-one', expect: { success: true } },
					{ command: 'step-two', expect: { success: true } },
					{ command: 'step-three', expect: { success: true } },
				],
			}),
			{
				stopOnFailure: true,
				beforeStep: async (step, stepId) => {
					beforeCalls.push(`${stepId}:${step.command}`);
				},
				runStep: async (step, stepId) => {
					const cmdResult =
						step.command === 'step-two'
							? { success: false, error: { code: 'BOOM', message: 'failed' } }
							: ok();
					return evaluateStep(step, stepId, cmdResult, 1);
				},
				afterStep: async (step, stepResult) => {
					afterCalls.push([stepResult.stepId, `${step.command}:${stepResult.outcome}`]);
				},
				onStepComplete: (_step, stepResult) => {
					completeCalls.push([stepResult.stepId, stepResult.outcome]);
				},
			}
		);

		expect(result.outcome).toBe('partial');
		expect(result.stepResults.map((s) => s.outcome)).toEqual(['pass', 'fail', 'skip']);
		expect(beforeCalls).toEqual(['step-1:step-one', 'step-2:step-two']);
		expect(afterCalls).toEqual([
			['step-1', 'step-one:pass'],
			['step-2', 'step-two:fail'],
		]);
		expect(completeCalls).toEqual([
			['step-1', 'pass'],
			['step-2', 'fail'],
			['step-3', 'skip'],
		]);
	});

	it('still calls beforeStep and afterStep for steps that run after a continueOnFailure step', async () => {
		const beforeCalls: string[] = [];
		const afterCalls: Array<[string, string]> = [];

		const result = await runScenario(
			scenario({
				steps: [
					{ command: 'step-one', expect: { success: true }, continueOnFailure: true },
					{ command: 'step-two', expect: { success: true } },
				],
			}),
			{
				stopOnFailure: true,
				beforeStep: async (_step, stepId) => {
					beforeCalls.push(stepId);
				},
				runStep: async (step, stepId) => {
					const cmdResult =
						step.command === 'step-one'
							? { success: false, error: { code: 'FAIL', message: 'nope' } }
							: ok();
					return evaluateStep(step, stepId, cmdResult, 1);
				},
				afterStep: async (_step, stepResult) => {
					afterCalls.push([stepResult.stepId, stepResult.outcome]);
				},
			}
		);

		expect(result.outcome).toBe('partial');
		expect(beforeCalls).toEqual(['step-1', 'step-2']);
		expect(afterCalls).toEqual([
			['step-1', 'fail'],
			['step-2', 'pass'],
		]);
	});

	it('does not call beforeStep or afterStep when steps are skipped due to setup failure, unsupported fields, pre-aborted signal, or dryRun', async () => {
		const beforeStep = vi.fn();
		const afterStep = vi.fn();
		const onStepComplete = vi.fn();
		const runStep = vi.fn(async (step, stepId) => evaluateStep(step, stepId, ok(), 1));

		const failedSetup = await runScenario(scenario(), {
			stopOnFailure: true,
			setup: async () => ({ error: 'boom' }),
			beforeStep,
			afterStep,
			onStepComplete,
			runStep,
		});
		expect(failedSetup.outcome).toBe('error');
		expect(failedSetup.skippedSteps).toBe(2);

		const unsupported = await runScenario(scenario({ verify: { assertions: ['x'] } }), {
			stopOnFailure: true,
			beforeStep,
			afterStep,
			onStepComplete,
			runStep,
		});
		expect(unsupported.outcome).toBe('error');
		expect(unsupported.skippedSteps).toBe(2);

		const preAborted = new AbortController();
		preAborted.abort(new Error('already cancelled'));
		const aborted = await runScenario(scenario(), {
			stopOnFailure: true,
			signal: preAborted.signal,
			beforeStep,
			afterStep,
			onStepComplete,
			runStep,
		});
		expect(aborted.outcome).toBe('error');
		expect(aborted.skippedSteps).toBe(2);

		const dry = await runScenario(scenario(), {
			stopOnFailure: true,
			dryRun: true,
			beforeStep,
			afterStep,
			onStepComplete,
			runStep,
		});
		expect(dry.outcome).toBe('pass');

		expect(beforeStep).not.toHaveBeenCalled();
		expect(afterStep).not.toHaveBeenCalled();
		expect(runStep).not.toHaveBeenCalled();
		expect(onStepComplete).toHaveBeenCalledTimes(8);
	});

	it('abandons a pending beforeStep on AbortSignal cancellation and skips runStep, afterStep and later steps', async () => {
		const controller = new AbortController();
		const runStep = vi.fn(async (step, stepId) => evaluateStep(step, stepId, ok(), 1));
		const afterStep = vi.fn();
		const beforeSteps: string[] = [];
		let signalSeen: AbortSignal | undefined;
		let hookSettled = false;
		let releaseHook: (() => void) | undefined;

		const result = await runScenario(scenario(), {
			stopOnFailure: true,
			signal: controller.signal,
			beforeStep: async (_step, stepId, signal) => {
				beforeSteps.push(stepId);
				signalSeen = signal;
				queueMicrotask(() => controller.abort(new Error('cancelled in beforeStep')));
				await new Promise<void>((resolve) => {
					releaseHook = resolve;
				});
				hookSettled = true;
			},
			runStep,
			afterStep,
		});

		expect(hookSettled).toBe(false);
		expect(signalSeen?.aborted).toBe(true);
		releaseHook?.();
		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({
			type: 'aborted',
			message: 'Scenario aborted: cancelled in beforeStep',
		});
		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'unknown'],
			['skip', undefined],
		]);
		expect(beforeSteps).toEqual(['step-1']);
		expect(runStep).not.toHaveBeenCalled();
		expect(afterStep).not.toHaveBeenCalled();
	});

	it('does not dispatch runStep when cancellation lands between beforeStep and dispatch', async () => {
		const controller = new AbortController();
		const runStep = vi.fn(async (step, stepId) => evaluateStep(step, stepId, ok(), 1));
		const afterStep = vi.fn();

		const result = await runScenario(scenario(), {
			stopOnFailure: true,
			signal: controller.signal,
			beforeStep: async () => {
				await new Promise<void>((resolve) => {
					queueMicrotask(() => {
						resolve();
						controller.abort(new Error('cancelled after beforeStep'));
					});
				});
			},
			runStep,
			afterStep,
		});

		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({
			type: 'aborted',
			message: 'Scenario aborted: cancelled after beforeStep',
		});
		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'unknown'],
			['skip', undefined],
		]);
		expect(runStep).not.toHaveBeenCalled();
		expect(afterStep).not.toHaveBeenCalled();
	});

	it('skips afterStep and observes rejected promises when cancelled synchronously inside runStep', async () => {
		const controller = new AbortController();
		const beforeSteps: string[] = [];
		const afterStep = vi.fn();
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);

		try {
			const result = await runScenario(scenario(), {
				stopOnFailure: true,
				signal: controller.signal,
				beforeStep: async (_step, stepId) => {
					beforeSteps.push(stepId);
				},
				runStep: () => {
					controller.abort(new Error('cancelled during runStep'));
					return Promise.reject(new Error('transport closed on abort'));
				},
				afterStep,
			});
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(result.outcome).toBe('error');
			expect(result.error?.type).toBe('aborted');
			expect(result.stepResults.map((s) => s.outcome)).toEqual(['error', 'skip']);
			expect(beforeSteps).toEqual(['step-1']);
			expect(afterStep).not.toHaveBeenCalled();
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	it('abandons a pending afterStep on scenario timeout and skips later steps without hooks', async () => {
		const beforeSteps: string[] = [];
		const afterSteps: string[] = [];
		let signalSeen: AbortSignal | undefined;
		let hookSettled = false;
		let releaseHook: (() => void) | undefined;

		const result = await runScenario(scenario({ timeout: 25 }), {
			stopOnFailure: true,
			beforeStep: async (_step, stepId) => {
				beforeSteps.push(stepId);
			},
			runStep: async (step, stepId) => evaluateStep(step, stepId, ok(), 1),
			afterStep: async (_step, stepResult, signal) => {
				afterSteps.push(stepResult.stepId);
				signalSeen = signal;
				await new Promise<void>((resolve) => {
					releaseHook = resolve;
				});
				hookSettled = true;
			},
		});

		expect(hookSettled).toBe(false);
		expect(signalSeen?.aborted).toBe(true);
		releaseHook?.();
		expect(result.outcome).toBe('error');
		expect(result.error).toEqual({
			type: 'timeout',
			message: 'Scenario timed out after 25ms',
		});
		expect(result.stepResults.map((s) => [s.outcome, s.error?.type])).toEqual([
			['error', 'timeout'],
			['skip', undefined],
		]);
		expect(beforeSteps).toEqual(['step-1']);
		expect(afterSteps).toEqual(['step-1']);
	});

	it('does not call beforeStep or afterStep on remaining steps when cancelled between steps', async () => {
		const controller = new AbortController();
		const beforeSteps: string[] = [];
		const afterSteps: string[] = [];

		const result = await runScenario(scenario(), {
			stopOnFailure: true,
			signal: controller.signal,
			beforeStep: async (_step, stepId) => {
				beforeSteps.push(stepId);
			},
			runStep: async (step, stepId) => evaluateStep(step, stepId, ok(), 1),
			afterStep: async (_step, stepResult) => {
				afterSteps.push(stepResult.stepId);
			},
			onStepComplete: (_step, stepResult) => {
				if (stepResult.stepId === 'step-1') {
					controller.abort(new Error('stop between steps'));
				}
			},
		});

		expect(result.outcome).toBe('error');
		expect(result.stepResults.map((s) => s.outcome)).toEqual(['pass', 'skip']);
		expect(beforeSteps).toEqual(['step-1']);
		expect(afterSteps).toEqual(['step-1']);
	});

	it('records a step error when beforeStep throws without invoking runStep or afterStep', async () => {
		const runStep = vi.fn(async (step, stepId) => evaluateStep(step, stepId, ok(), 1));
		const afterStep = vi.fn();

		const result = await runScenario(scenario(), {
			stopOnFailure: true,
			beforeStep: async () => {
				throw new Error('editor element missing');
			},
			runStep,
			afterStep,
		});

		expect(result.outcome).toBe('fail');
		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.message).toBe('editor element missing');
		expect(result.stepResults[1]?.outcome).toBe('skip');
		expect(runStep).not.toHaveBeenCalled();
		expect(afterStep).not.toHaveBeenCalled();
	});

	it('records a step error when afterStep throws while preserving commandResult and skips later steps', async () => {
		const beforeSteps: string[] = [];

		const result = await runScenario(scenario(), {
			stopOnFailure: true,
			beforeStep: async (_step, stepId) => {
				beforeSteps.push(stepId);
			},
			runStep: async (step, stepId) => evaluateStep(step, stepId, ok({ saved: true }), 1),
			afterStep: async () => {
				throw new Error('capture IPC failed');
			},
		});

		expect(result.outcome).toBe('fail');
		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.message).toBe('capture IPC failed');
		expect(result.stepResults[0]?.commandResult).toEqual({ success: true, data: { saved: true } });
		expect(result.stepResults[1]?.outcome).toBe('skip');
		expect(beforeSteps).toEqual(['step-1']);
	});

	it('skips beforeStep and afterStep when step reference resolution fails', async () => {
		const beforeStep = vi.fn();
		const afterStep = vi.fn();

		const result = await runScenario(
			scenario({
				steps: [
					{
						command: 'item-get',
						input: { id: '${{ steps[9].data.id }}' },
						expect: { success: true },
					},
				],
			}),
			{
				stopOnFailure: true,
				beforeStep,
				afterStep,
				runStep: async (step, stepId) => evaluateStep(step, stepId, ok(), 1),
			}
		);

		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.type).toBe('reference_error');
		expect(beforeStep).not.toHaveBeenCalled();
		expect(afterStep).not.toHaveBeenCalled();
	});

	it('invokes afterStep with the synthesized error result when runStep rejects without abort', async () => {
		const afterCalls: Array<[string, string, string | undefined]> = [];

		const result = await runScenario(scenario(), {
			stopOnFailure: true,
			runStep: async () => {
				throw new Error('transport offline');
			},
			afterStep: async (_step, stepResult) => {
				afterCalls.push([stepResult.stepId, stepResult.outcome, stepResult.error?.message]);
			},
		});

		expect(result.outcome).toBe('fail');
		expect(result.stepResults.map((s) => s.outcome)).toEqual(['error', 'skip']);
		expect(afterCalls).toEqual([['step-1', 'error', 'transport offline']]);
	});

	it('does not mutate the original scenario step when beforeStep mutates its step argument', async () => {
		const parsed = scenario({
			steps: [{ command: 'step-one', expect: { success: true } }],
		});
		const completeCommands: string[] = [];

		const result = await runScenario(parsed, {
			stopOnFailure: true,
			beforeStep: (step) => {
				step.command = 'mutated-in-hook';
			},
			runStep: async (step, stepId) => evaluateStep(step, stepId, ok(), 1),
			onStepComplete: (step) => {
				completeCommands.push(step.command);
			},
		});

		expect(result.outcome).toBe('pass');
		expect(parsed.steps[0]?.command).toBe('step-one');
		expect(completeCommands).toEqual(['step-one']);
	});

	it('guards afterStep against an untyped custom runStep returning outcome skip', async () => {
		const afterStep = vi.fn();

		const result = await runScenario(
			scenario({ steps: [{ command: 'step-one', expect: { success: true } }] }),
			{
				stopOnFailure: true,
				runStep: async (step, stepId) =>
					({
						stepId,
						command: step.command,
						outcome: 'skip',
						durationMs: 0,
						assertions: [],
					}) as unknown as ReturnType<typeof evaluateStep>,
				afterStep,
			}
		);

		expect(result.stepResults[0]?.outcome).toBe('skip');
		expect(afterStep).not.toHaveBeenCalled();
	});

	it('forwards beforeStep and afterStep through InProcessExecutor', async () => {
		const events: string[] = [];

		const result = await new InProcessExecutor({
			handler: async (command) => {
				events.push(`handler:${command}`);
				return ok({ command });
			},
			beforeStep: async (_step, stepId) => {
				await Promise.resolve();
				events.push(`before:${stepId}`);
			},
			afterStep: async (_step, stepResult) => {
				await Promise.resolve();
				events.push(`after:${stepResult.stepId}:${stepResult.outcome}`);
			},
		}).execute(scenario());

		expect(result.outcome).toBe('pass');
		expect(events).toEqual([
			'before:step-1',
			'handler:step-one',
			'after:step-1:pass',
			'before:step-2',
			'handler:step-two',
			'after:step-2:pass',
		]);
	});

	it('forwards and reconfigures beforeStep and afterStep through ScenarioExecutor', async () => {
		const events: string[] = [];
		const executor = new ScenarioExecutor({
			cliPath: cliFixturePath,
			serverUrl: 'http://test.example/mcp',
			transport: 'http',
		});
		executor.configure({
			beforeStep: async (step, stepId) => {
				await Promise.resolve();
				events.push(`before:${stepId}:${step.command}`);
			},
			afterStep: async (_step, stepResult) => {
				await Promise.resolve();
				events.push(`after:${stepResult.stepId}:${stepResult.outcome}`);
			},
		});

		const result = await executor.execute(
			scenario({
				steps: [{ command: 'seed', input: { id: 'cli-1' }, expect: { success: true } }],
			})
		);

		expect(result.outcome).toBe('pass');
		expect(events).toEqual(['before:step-1:seed', 'after:step-1:pass']);
	});
});
