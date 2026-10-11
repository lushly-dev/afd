import { describe, expect, it, vi } from 'vitest';
import { executeBatch } from './command-execution.js';
import { executePipeline } from './pipeline-executor.js';
import { failure, success } from './result.js';

const cancelledError = {
	code: 'COMMAND_CANCELLED',
	message: 'Command cancelled before starting',
	suggestion: 'Start the command again if the result is still needed',
	retryable: false,
};

function barrier() {
	let release = () => {};
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { wait, release };
}

describe('caller cancellation scheduling', () => {
	it('starts no batch commands when already cancelled', async () => {
		const execute = vi.fn(async () => success(null));
		const result = await executeBatch(
			{
				commands: [
					{ command: 'work-one', input: {} },
					{ command: 'work-two', input: {} },
				],
				options: { parallelism: 2 },
			},
			execute,
			{ signal: AbortSignal.abort() }
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.results.map((entry) => entry.result.error)).toEqual([
			cancelledError,
			cancelledError,
		]);
		expect(result.results.map((entry) => entry.durationMs)).toEqual([0, 0]);
		expect(result.summary).toMatchObject({ total: 2, failureCount: 2, skippedCount: 0 });
	});

	it.each([false, true])(
		'preserves started batch outcomes with stopOnError=%s',
		async (stopOnError) => {
			const controller = new AbortController();
			const bothStarted = barrier();
			const releasePeer = barrier();
			const calls: string[] = [];
			let peerSignal: AbortSignal | undefined;
			const pending = executeBatch(
				{
					commands: ['work-fail', 'work-peer', 'work-queued'].map((command) => ({
						command,
						input: {},
					})),
					options: { parallelism: 2, stopOnError },
				},
				async (name, _input, context) => {
					calls.push(name);
					if (name === 'work-fail') {
						await bothStarted.wait;
						controller.abort();
						return failure({ code: 'FAILED', message: 'Failed', suggestion: 'Inspect result' });
					}
					peerSignal = context.signal as AbortSignal;
					bothStarted.release();
					await releasePeer.wait;
					return success('peer completed');
				},
				{ signal: controller.signal }
			);
			await bothStarted.wait;
			await Promise.resolve();
			expect(peerSignal?.aborted).toBe(true);
			releasePeer.release();
			const result = await pending;
			expect(calls).toEqual(['work-fail', 'work-peer']);
			expect(result.results[0]?.result.error?.code).toBe('FAILED');
			expect(result.results[1]?.result).toMatchObject({ success: true, data: 'peer completed' });
			expect(result.results[2]).toMatchObject({
				result: { success: false, error: cancelledError },
				durationMs: 0,
			});
		}
	);

	it('keeps the batch deadline active while cancelled started work drains', async () => {
		const controller = new AbortController();
		const result = await executeBatch(
			{
				commands: [
					{ command: 'work-wait', input: {} },
					{ command: 'work-queued', input: {} },
				],
				options: { timeout: 10 },
			},
			async () => {
				controller.abort();
				return new Promise(() => {});
			},
			{ signal: controller.signal }
		);
		expect(result.results.map((entry) => entry.result.error?.code)).toEqual([
			'BATCH_TIMEOUT',
			'BATCH_TIMEOUT',
		]);
	});

	it('starts no pipeline steps when already cancelled, including conditional steps', async () => {
		const execute = vi.fn(async () => success(null));
		const result = await executePipeline(
			{
				steps: [
					{ command: 'work-one', when: { $eq: ['$input.enabled', true] } },
					{ command: 'work-two', input: {} },
				],
			},
			execute,
			{ signal: AbortSignal.abort() }
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.steps.map((step) => step.status)).toEqual(['skipped', 'skipped']);
		expect(result.steps.map((step) => step.error)).toEqual([cancelledError, cancelledError]);
		expect(result.steps.map((step) => step.executionTimeMs)).toEqual([0, 0]);
	});

	it.each([false, true])(
		'preserves started pipeline outcomes with continueOnFailure=%s',
		async (continueOnFailure) => {
			for (const fail of [false, true]) {
				const controller = new AbortController();
				const execute = vi.fn(async (_name, _input, context) => {
					controller.abort();
					expect(context.signal.aborted).toBe(true);
					return fail
						? failure({ code: 'FAILED', message: 'Failed', suggestion: 'Inspect result' })
						: success('completed');
				});
				const result = await executePipeline(
					{
						steps: [{ command: 'work-started' }, { command: 'work-queued', input: {} }],
						options: { continueOnFailure },
					},
					execute,
					{ signal: controller.signal }
				);
				expect(execute).toHaveBeenCalledTimes(1);
				expect(result.steps[0]?.status).toBe(fail ? 'failure' : 'success');
				expect(result.steps[1]).toMatchObject({
					status: 'skipped',
					error: cancelledError,
					executionTimeMs: 0,
				});
			}
		}
	);

	it('keeps the pipeline deadline active after caller cancellation', async () => {
		const controller = new AbortController();
		const execute = vi.fn(async () => {
			controller.abort();
			return new Promise<ReturnType<typeof success>>(() => {});
		});
		const result = await executePipeline(
			{
				steps: [
					{ command: 'work-wait', input: {} },
					{ command: 'work-queued', input: {} },
				],
				options: { timeoutMs: 10, continueOnFailure: true },
			},
			execute,
			{ signal: controller.signal }
		);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(result.steps.map((step) => step.error?.code)).toEqual([
			'PIPELINE_TIMEOUT',
			'PIPELINE_TIMEOUT',
		]);
	});
});
