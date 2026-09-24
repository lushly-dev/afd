import { describe, expect, it, vi } from 'vitest';
import { executePipeline } from './pipeline-executor.js';
import type { CommandResult } from './result.js';

describe('pipeline execution boundaries', () => {
	it.each(['skipped', 'failure'])('preserves original indices after a %s step', async (status) => {
		const result = await executePipeline(
			{
				options: { continueOnFailure: true },
				steps: [
					{
						command: 'first',
						when: status === 'skipped' ? { $eq: ['$input.enabled', true] } : undefined,
						as: 'first',
					},
					{ command: 'second', as: 'second' },
					{
						command: 'echo',
						input: {
							zero: '$steps[0].id',
							one: '$steps[1].id',
							alias: '$steps.second.id',
							first: '$first.id',
							previous: '$prev.id',
						},
					},
				],
			},
			async (name, input) =>
				name === 'first'
					? { success: false, error: { code: 'FAIL', message: 'Failed', suggestion: 'Retry' } }
					: { success: true, data: name === 'second' ? { id: 'second' } : input }
		);
		expect(result.steps[0]?.status).toBe(status);
		expect(result.data).toEqual({
			zero: undefined,
			one: 'second',
			alias: 'second',
			first: undefined,
			previous: 'second',
		});
	});
	it('keeps $prev at the last successful step when a later step fails', async () => {
		const result = await executePipeline(
			{
				options: { continueOnFailure: true },
				steps: [
					{ command: 'ok' },
					{ command: 'fail' },
					{ command: 'echo', input: { previous: '$prev.id', failed: '$steps[1].id' } },
				],
			},
			async (name, input) =>
				name === 'fail'
					? { success: false }
					: { success: true, data: name === 'ok' ? { id: 'ok' } : input }
		);
		expect(result.data).toEqual({ previous: 'ok', failed: undefined });
	});
	it('times out the final pending step and propagates cancellation', async () => {
		let signal: AbortSignal | undefined;
		const execution = executePipeline(
			{ options: { timeoutMs: 10 }, steps: [{ command: 'slow' }] },
			async (_name, _input, context) => {
				signal = context.signal as AbortSignal;
				return new Promise<CommandResult>(() => {});
			}
		);
		const result = await execution;
		expect(result.steps[0]?.error?.code).toBe('PIPELINE_TIMEOUT');
		expect(signal?.aborted).toBe(true);
	});
	it('rejects parallel execution before running any command', async () => {
		const execute = vi.fn(async () => ({ success: true }));
		const result = await executePipeline(
			{ options: { parallel: true }, steps: [{ command: 'one' }, { command: 'two' }] },
			execute
		);
		expect(result.steps[0]?.error?.code).toBe('UNSUPPORTED_OPTION');
		expect(result.steps[1]?.status).toBe('skipped');
		expect(execute).not.toHaveBeenCalled();
	});
	it('rejects a streaming step before running any command', async () => {
		const execute = vi.fn(async () => ({ success: true }));
		const result = await executePipeline(
			{
				steps: [
					{ command: 'one', as: 'first' },
					{ command: 'two', stream: true },
					{ command: 'three', stream: true },
				],
			},
			execute
		);

		expect(execute).not.toHaveBeenCalled();
		expect(result.steps.map((step) => step.status)).toEqual(['skipped', 'failure', 'skipped']);
		expect(result.steps[0]).toMatchObject({ index: 0, alias: 'first', command: 'one' });
		expect(result.steps[1]?.error).toMatchObject({
			code: 'UNSUPPORTED_OPTION',
			message: expect.stringContaining('step 1'),
			suggestion: expect.stringContaining('Remove stream'),
		});
		expect(result.data).toBeUndefined();
		expect(result.metadata).toMatchObject({ completedSteps: 0, totalSteps: 3 });
	});
	it('accepts stream: false and never calls onProgress', async () => {
		const onProgress = vi.fn();
		const result = await executePipeline(
			{ options: { onProgress }, steps: [{ command: 'one', stream: false }] },
			async () => ({ success: true, data: [1, 2] })
		);

		expect(result.steps[0]?.status).toBe('success');
		expect(result.data).toEqual([1, 2]);
		expect(onProgress).not.toHaveBeenCalled();
	});
	it('blames step 0 for parallel even when a later step streams', async () => {
		const result = await executePipeline(
			{
				options: { parallel: true },
				steps: [{ command: 'one' }, { command: 'two', stream: true }],
			},
			async () => ({ success: true })
		);

		expect(result.steps[0]?.error?.message).toBe('Parallel pipeline execution is not supported');
		expect(result.steps[1]?.status).toBe('skipped');
	});
	it('converts executor exceptions to structured step failures', async () => {
		const result = await executePipeline({ steps: [{ command: 'throws' }] }, async () => {
			throw new Error('handler exploded');
		});

		expect(result.steps[0]?.status).toBe('failure');
		expect(result.steps[0]?.error).toMatchObject({
			code: 'COMMAND_EXECUTION_ERROR',
			message: 'handler exploded',
		});
	});
});
