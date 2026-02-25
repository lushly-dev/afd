import { describe, expect, it } from 'vitest';
import type { CommandExecutor } from './pipeline-executor.js';
import { executePipeline } from './pipeline-executor.js';
import { failure, success } from './result.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CORE PIPELINE EXECUTOR TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('executePipeline', () => {
	/** Simple executor that maps command names to results */
	function createMockExecutor(
		handlers: Record<string, (input: unknown) => ReturnType<CommandExecutor>>
	): CommandExecutor {
		return async (name, input, _ctx) => {
			const handler = handlers[name];
			if (!handler) {
				return failure({
					code: 'COMMAND_NOT_FOUND',
					message: `Command '${name}' not found`,
				});
			}
			return handler(input);
		};
	}

	it('returns empty result for empty steps', async () => {
		const executor = createMockExecutor({});
		const result = await executePipeline({ steps: [] }, executor);

		expect(result.steps).toHaveLength(0);
		expect(result.metadata.totalSteps).toBe(0);
		expect(result.metadata.completedSteps).toBe(0);
	});

	it('executes a single step', async () => {
		const executor = createMockExecutor({
			'user-get': () => success({ id: 1, name: 'Alice' }, { confidence: 0.9 }),
		});

		const result = await executePipeline(
			{ steps: [{ command: 'user-get', input: { id: 1 } }] },
			executor
		);

		expect(result.data).toEqual({ id: 1, name: 'Alice' });
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0]?.status).toBe('success');
		expect(result.metadata.completedSteps).toBe(1);
		expect(result.metadata.totalSteps).toBe(1);
	});

	it('chains steps with $prev variable resolution', async () => {
		const executor = createMockExecutor({
			'user-get': () => success({ id: 42, name: 'Bob' }),
			'order-list': (input) => {
				const typedInput = input as { userId: number };
				return success([{ orderId: 1, userId: typedInput.userId }]);
			},
		});

		const result = await executePipeline(
			{
				steps: [
					{ command: 'user-get', input: { id: 42 } },
					{ command: 'order-list', input: { userId: '$prev.id' } },
				],
			},
			executor
		);

		expect(result.data).toEqual([{ orderId: 1, userId: 42 }]);
		expect(result.steps).toHaveLength(2);
		expect(result.steps[0]?.status).toBe('success');
		expect(result.steps[1]?.status).toBe('success');
	});

	it('stops on failure by default', async () => {
		const executor = createMockExecutor({
			'step-a': () => success({ ok: true }),
			'step-b': () =>
				failure({ code: 'FAIL', message: 'Step B failed', suggestion: 'Fix it' }),
			'step-c': () => success({ ok: true }),
		});

		const result = await executePipeline(
			{
				steps: [{ command: 'step-a' }, { command: 'step-b' }, { command: 'step-c' }],
			},
			executor
		);

		expect(result.steps[0]?.status).toBe('success');
		expect(result.steps[1]?.status).toBe('failure');
		expect(result.steps[2]?.status).toBe('skipped');
		expect(result.metadata.completedSteps).toBe(1);
		expect(result.metadata.totalSteps).toBe(3);
	});

	it('continues on failure when continueOnFailure is true', async () => {
		const executor = createMockExecutor({
			'step-a': () => success('a'),
			'step-b': () => failure({ code: 'FAIL', message: 'nope', suggestion: 'retry' }),
			'step-c': () => success('c'),
		});

		const result = await executePipeline(
			{
				steps: [{ command: 'step-a' }, { command: 'step-b' }, { command: 'step-c' }],
				options: { continueOnFailure: true },
			},
			executor
		);

		expect(result.steps[0]?.status).toBe('success');
		expect(result.steps[1]?.status).toBe('failure');
		expect(result.steps[2]?.status).toBe('success');
		expect(result.data).toBe('c');
		expect(result.metadata.completedSteps).toBe(2);
	});

	it('skips steps when when condition is false', async () => {
		const executor = createMockExecutor({
			'step-a': () => success({ hasEmail: false }),
			'send-email': () => success({ sent: true }),
		});

		const result = await executePipeline(
			{
				steps: [
					{ command: 'step-a' },
					{
						command: 'send-email',
						when: { $eq: ['$prev.hasEmail', true] },
					},
				],
			},
			executor
		);

		expect(result.steps[0]?.status).toBe('success');
		expect(result.steps[1]?.status).toBe('skipped');
	});

	it('supports step aliases with $steps.alias', async () => {
		const executor = createMockExecutor({
			'user-get': () => success({ id: 7, name: 'Charlie' }),
			'order-list': (input) => {
				const typedInput = input as { userId: number };
				return success([{ userId: typedInput.userId }]);
			},
		});

		const result = await executePipeline(
			{
				steps: [
					{ command: 'user-get', input: { id: 7 }, as: 'user' },
					{ command: 'order-list', input: { userId: '$steps.user.id' } },
				],
			},
			executor
		);

		expect(result.data).toEqual([{ userId: 7 }]);
	});

	it('aggregates confidence using weakest-link principle', async () => {
		const executor = createMockExecutor({
			'step-a': () => success('a', { confidence: 0.95 }),
			'step-b': () => success('b', { confidence: 0.7 }),
			'step-c': () => success('c', { confidence: 0.85 }),
		});

		const result = await executePipeline(
			{
				steps: [{ command: 'step-a' }, { command: 'step-b' }, { command: 'step-c' }],
			},
			executor
		);

		expect(result.metadata.confidence).toBe(0.7);
	});

	it('returns data from last successful step', async () => {
		const executor = createMockExecutor({
			'step-a': () => success('first'),
			'step-b': () => success('second'),
		});

		const result = await executePipeline(
			{
				steps: [{ command: 'step-a' }, { command: 'step-b' }],
			},
			executor
		);

		expect(result.data).toBe('second');
	});

	it('passes context through to executor', async () => {
		let receivedCtx: Record<string, unknown> | undefined;
		const executor: CommandExecutor = async (_name, _input, ctx) => {
			receivedCtx = ctx;
			return success('ok');
		};

		await executePipeline({ steps: [{ command: 'test' }] }, executor, {
			traceId: 'custom-trace',
			userId: 'u1',
		});

		expect(receivedCtx?.traceId).toBe('custom-trace');
		expect(receivedCtx?.userId).toBe('u1');
	});

	it('skips remaining steps when timeoutMs is exceeded', async () => {
		const executor = createMockExecutor({
			'slow-step': async () => {
				await new Promise((r) => setTimeout(r, 50));
				return success('done');
			},
			'step-after': () => success('after'),
		});

		const result = await executePipeline(
			{
				steps: [
					{ command: 'slow-step' },
					{ command: 'step-after' },
				],
				options: { timeoutMs: 10 },
			},
			executor
		);

		expect(result.steps[0]?.status).toBe('success');
		expect(result.steps[1]?.status).toBe('skipped');
		expect(result.steps[1]?.error?.code).toBe('PIPELINE_TIMEOUT');
		expect(result.steps[1]?.error?.retryable).toBe(true);
		expect(result.steps[1]?.error?.suggestion).toBeDefined();
	});
});
