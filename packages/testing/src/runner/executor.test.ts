import { describe, expect, it, vi } from 'vitest';
import type { Scenario, Step } from '../types/scenario.js';
import type { CommandHandler } from './executor.js';
import { InProcessExecutor, validateScenario } from './executor.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makePassingHandler(): CommandHandler {
	return async (command, input) => ({
		success: true,
		data: { id: '123', command, ...(input ?? {}) },
		confidence: 1.0,
		reasoning: 'Test passed',
	});
}

function makeFailingHandler(): CommandHandler {
	return async () => ({
		success: false,
		error: {
			code: 'TEST_FAIL',
			message: 'Intentional failure',
		},
	});
}

function makeThrowingHandler(): CommandHandler {
	return async () => {
		throw new Error('Handler exploded');
	};
}

function makeScenario(overrides?: Partial<Scenario>): Scenario {
	return {
		name: 'Test Scenario',
		description: 'A test scenario',
		job: 'test-job',
		tags: ['test'],
		steps: [
			{
				command: 'test-cmd',
				input: { title: 'Hello' },
				expect: { success: true },
			},
		],
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// InProcessExecutor
// ═══════════════════════════════════════════════════════════════════════════════

describe('InProcessExecutor', () => {
	it('executes passing scenario', async () => {
		const executor = new InProcessExecutor({
			handler: makePassingHandler(),
		});

		const result = await executor.execute(makeScenario());

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(1);
		expect(result.failedSteps).toBe(0);
		expect(result.skippedSteps).toBe(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.jobName).toBe('test-job');
	});

	it('handles failing command', async () => {
		const executor = new InProcessExecutor({
			handler: makeFailingHandler(),
		});

		const scenario = makeScenario({
			steps: [
				{
					command: 'test-cmd',
					input: {},
					expect: { success: true },
				},
			],
		});

		const result = await executor.execute(scenario);

		expect(result.outcome).toBe('fail');
		expect(result.failedSteps).toBe(1);
	});

	it('handles handler exception as error', async () => {
		const executor = new InProcessExecutor({
			handler: makeThrowingHandler(),
		});

		const result = await executor.execute(makeScenario());

		expect(result.outcome).toBe('fail');
		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.message).toContain('Handler exploded');
	});

	it('stopOnFailure skips remaining steps', async () => {
		const handler: CommandHandler = async (command) => {
			if (command === 'fail-cmd') {
				return { success: false, error: { code: 'FAIL', message: 'fail' } };
			}
			return { success: true, data: 'ok' };
		};

		const executor = new InProcessExecutor({
			handler,
			stopOnFailure: true,
		});

		const scenario = makeScenario({
			steps: [
				{ command: 'fail-cmd', input: {}, expect: { success: true } },
				{ command: 'pass-cmd', input: {}, expect: { success: true } },
				{ command: 'pass-cmd', input: {}, expect: { success: true } },
			],
		});

		const result = await executor.execute(scenario);

		expect(result.failedSteps).toBe(1);
		expect(result.skippedSteps).toBe(2);
		expect(result.stepResults[1]?.outcome).toBe('skip');
		expect(result.stepResults[1]?.skippedReason).toBe('Previous step failed');
	});

	it('continueOnFailure does not skip remaining', async () => {
		const handler: CommandHandler = async (command) => {
			if (command === 'fail-cmd') {
				return { success: false, error: { code: 'FAIL', message: 'fail' } };
			}
			return { success: true, data: 'ok' };
		};

		const executor = new InProcessExecutor({
			handler,
			stopOnFailure: true,
		});

		const scenario = makeScenario({
			steps: [
				{
					command: 'fail-cmd',
					input: {},
					expect: { success: true },
					continueOnFailure: true,
				},
				{ command: 'pass-cmd', input: {}, expect: { success: true } },
			],
		});

		const result = await executor.execute(scenario);

		expect(result.failedSteps).toBe(1);
		expect(result.skippedSteps).toBe(0);
		expect(result.passedSteps).toBe(1);
		expect(result.outcome).toBe('partial');
	});

	it('resolves step references', async () => {
		const handler: CommandHandler = async (_command, input) => ({
			success: true,
			data: { id: 'abc-123', ...(input ?? {}) },
		});

		const executor = new InProcessExecutor({ handler });

		const scenario = makeScenario({
			steps: [
				{
					command: 'create-cmd',
					input: { title: 'Test' },
					expect: { success: true },
				},
				{
					command: 'get-cmd',
					input: { id: '${{ steps[0].data.id }}' },
					expect: { success: true },
				},
			],
		});

		const result = await executor.execute(scenario);

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(2);
		// The second step should have received the resolved id
		const secondStep = result.stepResults[1];
		expect(secondStep?.commandResult?.data).toEqual({ id: 'abc-123' });
	});

	it('dry run validates without executing', async () => {
		const handler = vi.fn(makePassingHandler());

		const executor = new InProcessExecutor({
			handler,
			dryRun: true,
		});

		const result = await executor.execute(makeScenario());

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(1);
		expect(handler).not.toHaveBeenCalled();
	});

	it('calls callbacks', async () => {
		const onScenarioStart = vi.fn();
		const onStepComplete = vi.fn();
		const onScenarioComplete = vi.fn();

		const executor = new InProcessExecutor({
			handler: makePassingHandler(),
			onScenarioStart,
			onStepComplete,
			onScenarioComplete,
		});

		await executor.execute(makeScenario());

		expect(onScenarioStart).toHaveBeenCalledOnce();
		expect(onStepComplete).toHaveBeenCalledOnce();
		expect(onScenarioComplete).toHaveBeenCalledOnce();
	});

	it('determineOutcome returns correct values', async () => {
		const handler: CommandHandler = async (command) => {
			if (command === 'fail-cmd') {
				return { success: false, error: { code: 'FAIL', message: 'fail' } };
			}
			return { success: true, data: 'ok' };
		};

		// All pass
		const executor1 = new InProcessExecutor({ handler, stopOnFailure: false });
		const allPass = await executor1.execute(
			makeScenario({
				steps: [
					{ command: 'pass-cmd', input: {}, expect: { success: true } },
					{ command: 'pass-cmd', input: {}, expect: { success: true } },
				],
			})
		);
		expect(allPass.outcome).toBe('pass');

		// All fail
		const allFail = await executor1.execute(
			makeScenario({
				steps: [
					{ command: 'fail-cmd', input: {}, expect: { success: true } },
					{ command: 'fail-cmd', input: {}, expect: { success: true } },
				],
			})
		);
		expect(allFail.outcome).toBe('fail');

		// Partial
		const partial = await executor1.execute(
			makeScenario({
				steps: [
					{ command: 'pass-cmd', input: {}, expect: { success: true } },
					{ command: 'fail-cmd', input: {}, expect: { success: true } },
				],
			})
		);
		expect(partial.outcome).toBe('partial');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateScenario
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateScenario', () => {
	it('valid scenario passes validation', async () => {
		const result = await validateScenario(makeScenario(), { checkFixtures: false });
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('reports missing name', async () => {
		const result = await validateScenario(makeScenario({ name: '' }), { checkFixtures: false });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Missing required field: name');
	});

	it('reports missing job', async () => {
		const result = await validateScenario(makeScenario({ job: '' }), { checkFixtures: false });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Missing required field: job');
	});

	it('reports empty steps', async () => {
		const result = await validateScenario(makeScenario({ steps: [] }), { checkFixtures: false });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Scenario must have at least one step');
	});

	it('reports missing step command', async () => {
		const result = await validateScenario(
			makeScenario({
				steps: [{ command: '', input: {}, expect: { success: true } }],
			}),
			{ checkFixtures: false }
		);
		expect(result.errors.some((e) => e.includes("Missing required field 'command'"))).toBe(true);
	});

	it('warns about missing expect', async () => {
		const result = await validateScenario(
			makeScenario({
				steps: [{ command: 'test-cmd' } as Step],
			}),
			{ checkFixtures: false }
		);
		expect(result.warnings.some((w) => w.includes("Missing 'expect'"))).toBe(true);
	});

	it('reports forward step references', async () => {
		const result = await validateScenario(
			makeScenario({
				steps: [
					{
						command: 'cmd-one',
						input: { ref: '${{ steps[1].data.id }}' },
						expect: { success: true },
					},
					{ command: 'cmd-two', input: {}, expect: { success: true } },
				],
			}),
			{ checkFixtures: false }
		);
		expect(result.errors.some((e) => e.includes('Invalid reference'))).toBe(true);
	});

	it('returns metadata', async () => {
		const result = await validateScenario(makeScenario(), { checkFixtures: false });
		expect(result.metadata.name).toBe('Test Scenario');
		expect(result.metadata.job).toBe('test-job');
		expect(result.metadata.stepCount).toBe(1);
		expect(result.metadata.hasFixture).toBe(false);
		expect(result.metadata.tags).toEqual(['test']);
	});
});
