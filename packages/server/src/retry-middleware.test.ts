/**
 * Retry middleware: capped exponential backoff with jitter, abortable through
 * `context.signal`. The old middleware backed off linearly (`retryDelay * n`)
 * although it documented exponential backoff, and ignored the signal.
 */
import { type CommandContext, type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { composeMiddleware, createRetryMiddleware, type RetryOptions } from './middleware.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

const transient: CommandResult = {
	success: false,
	error: { code: 'TRANSIENT_ERROR', message: 'Try again', retryable: true },
};

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/**
 * Run the middleware over a handler that fails transiently `failures` times,
 * recording the fake-clock time of every attempt. Called directly, outside the
 * engine, the middleware cannot read `mutation`, so these set `retryMutations`.
 */
function run(options: RetryOptions, failures: number, context: CommandContext = {}) {
	const attemptTimes: number[] = [];
	const next = vi.fn(async (): Promise<CommandResult> => {
		attemptTimes.push(Date.now());
		return attemptTimes.length <= failures ? transient : { success: true, data: 'done' };
	});
	const result = createRetryMiddleware({ retryMutations: true, ...options })(
		'item-get',
		{},
		context,
		next
	);
	return { result, next, attemptTimes };
}

describe('createRetryMiddleware backoff', () => {
	it('doubles the wait for each retry without jitter', async () => {
		vi.setSystemTime(0);
		const { result, attemptTimes } = run({ retryDelay: 100, jitter: false, maxRetries: 4 }, 4);

		await vi.runAllTimersAsync();

		expect((await result).success).toBe(true);
		const waits = attemptTimes.slice(1).map((time, i) => time - (attemptTimes[i] ?? 0));
		expect(waits).toEqual([100, 200, 400, 800]);
	});

	it('caps every wait at maxDelay', async () => {
		vi.setSystemTime(0);
		const { result, attemptTimes } = run(
			{ retryDelay: 100, maxDelay: 250, jitter: false, maxRetries: 4 },
			4
		);

		await vi.runAllTimersAsync();

		await result;
		const waits = attemptTimes.slice(1).map((time, i) => time - (attemptTimes[i] ?? 0));
		expect(waits).toEqual([100, 200, 250, 250]);
	});

	it('waits between half and all of the backoff with jitter (the default)', async () => {
		vi.setSystemTime(0);
		const random = vi.spyOn(Math, 'random');
		random.mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0.75);
		const { result, attemptTimes } = run({ retryDelay: 100 }, 3);

		await vi.runAllTimersAsync();

		expect((await result).success).toBe(true);
		const waits = attemptTimes.slice(1).map((time, i) => time - (attemptTimes[i] ?? 0));
		// Backoffs 100, 200, 400: jitter keeps each wait in [backoff / 2, backoff].
		expect(waits).toEqual([50, 150, 350]);
	});

	it('does not retry before the first backoff has elapsed', async () => {
		const { result, next } = run({ retryDelay: 100, jitter: false }, 1);

		await vi.advanceTimersByTimeAsync(99);
		expect(next).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(next).toHaveBeenCalledTimes(2);
		expect((await result).success).toBe(true);
	});

	it('returns the last failure after maxRetries retries', async () => {
		const { result, next } = run({ maxRetries: 2, jitter: false }, 10);

		await vi.runAllTimersAsync();

		expect(await result).toBe(transient);
		expect(next).toHaveBeenCalledTimes(3);
	});

	it('does not retry successes, non-retryable codes, or with maxRetries 0', async () => {
		const permanent: CommandResult = {
			success: false,
			error: { code: 'NOT_FOUND', message: 'Missing' },
		};
		const next = vi.fn(async () => permanent);
		expect(await createRetryMiddleware()('item-get', {}, {}, next)).toBe(permanent);
		expect(next).toHaveBeenCalledTimes(1);

		const once = run({ maxRetries: 0 }, 1);
		expect(await once.result).toBe(transient);
		expect(once.next).toHaveBeenCalledTimes(1);

		const custom = vi.fn(async () => permanent);
		const retried = createRetryMiddleware({
			maxRetries: 1,
			jitter: false,
			shouldRetry: (code) => code === 'NOT_FOUND',
			retryMutations: true,
		})('item-get', {}, {}, custom);
		await vi.runAllTimersAsync();
		expect(await retried).toBe(permanent);
		expect(custom).toHaveBeenCalledTimes(2);
	});

	it('rejects invalid options when created', () => {
		expect(() => createRetryMiddleware({ maxRetries: -1 })).toThrow(/maxRetries/);
		expect(() => createRetryMiddleware({ maxRetries: 1.5 })).toThrow(/maxRetries/);
		expect(() => createRetryMiddleware({ retryDelay: -1 })).toThrow(/retryDelay/);
		expect(() => createRetryMiddleware({ retryDelay: Number.NaN })).toThrow(/retryDelay/);
		expect(() => createRetryMiddleware({ maxDelay: Number.POSITIVE_INFINITY })).toThrow(/maxDelay/);
	});
});

describe('createRetryMiddleware cancellation', () => {
	it('stops waiting and returns the last failure when the signal aborts', async () => {
		const controller = new AbortController();
		const { result, next } = run({ retryDelay: 10_000, jitter: false }, 3, {
			signal: controller.signal,
		});

		await vi.advanceTimersByTimeAsync(10);
		controller.abort();

		expect(await result).toBe(transient);
		expect(next).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('does not retry when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const { result, next } = run({ retryDelay: 100 }, 3, { signal: controller.signal });

		expect(await result).toBe(transient);
		expect(next).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('removes its abort listener after a completed wait', async () => {
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		const { result } = run({ retryDelay: 100, jitter: false }, 1, { signal: controller.signal });

		await vi.runAllTimersAsync();

		expect((await result).success).toBe(true);
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
	});
});

describe('createRetryMiddleware and mutations (#2673)', () => {
	/** A server whose `kind` command fails with `code` once, then succeeds, counting its runs. */
	function host(mutation: boolean, options: RetryOptions, code = 'TIMEOUT', compose = false) {
		let runs = 0;
		const command = defineCommand({
			name: mutation ? 'order-place' : 'order-get',
			description: 'Fails once, then succeeds',
			input: z.object({}),
			mutation,
			handler: async () =>
				++runs === 1
					? failure({ code, message: 'Timed out', suggestion: 'Retry later' })
					: success({ runs }),
		});
		const retry = createRetryMiddleware({ retryDelay: 0, jitter: false, ...options });
		const server = createMcpServer({
			name: 'retry',
			version: '1',
			commands: [command],
			middleware: [compose ? composeMiddleware(retry) : retry],
		});
		return { run: () => server.execute(command.name, {}), runs: () => runs };
	}

	it('retries a read that timed out', async () => {
		vi.useRealTimers();
		const { run, runs } = host(false, {});
		expect((await run()).success).toBe(true);
		expect(runs()).toBe(2);
	});

	it('never repeats a mutation by default, for TIMEOUT or TRANSIENT_ERROR', async () => {
		vi.useRealTimers();
		for (const code of ['TIMEOUT', 'TRANSIENT_ERROR']) {
			const { run, runs } = host(true, {}, code);
			const result = await run();
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe(code);
			expect(runs()).toBe(1);
		}
	});

	it('repeats a mutation only with retryMutations', async () => {
		vi.useRealTimers();
		const { run, runs } = host(true, { retryMutations: true });
		expect((await run()).success).toBe(true);
		expect(runs()).toBe(2);
	});

	it('reads the declaration through composeMiddleware too', async () => {
		vi.useRealTimers();
		const read = host(false, {}, 'TIMEOUT', true);
		expect((await read.run()).success).toBe(true);
		expect(read.runs()).toBe(2);
		const write = host(true, {}, 'TIMEOUT', true);
		expect((await write.run()).success).toBe(false);
		expect(write.runs()).toBe(1);
	});

	it('counts a call outside the engine as a mutation, whatever its name', async () => {
		const next = vi.fn(async () => transient);
		const result = await createRetryMiddleware({ retryDelay: 0 })('order-get', {}, {}, next);
		expect(result).toBe(transient);
		expect(next).toHaveBeenCalledOnce();
	});
});
