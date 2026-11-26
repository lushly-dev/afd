import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	ConsoleTelemetrySink,
	composeMiddleware,
	createLoggingMiddleware,
	createRateLimitMiddleware,
	createRetryMiddleware,
} from './middleware.js';

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('middleware lifecycle', () => {
	it('runs downstream gates and cleanup on every composed retry', async () => {
		const events: string[] = [];
		let attempts = 0;
		const middleware = composeMiddleware(
			// Called outside the engine, which alone tells it a command is not a mutation.
			createRetryMiddleware({ maxRetries: 1, retryDelay: 1, retryMutations: true }),
			async (_name, _input, _context, next) => {
				events.push('gate');
				try {
					return await next();
				} finally {
					events.push('cleanup');
				}
			}
		);
		const result = await middleware('item-get', {}, {}, async () => {
			attempts++;
			events.push('handler');
			return attempts === 1
				? { success: false, error: { code: 'TRANSIENT_ERROR', message: 'Retry', retryable: true } }
				: { success: true };
		});
		expect(result.success).toBe(true);
		expect(events).toEqual(['gate', 'handler', 'cleanup', 'gate', 'handler', 'cleanup']);
	});
	it('keeps default diagnostics off the stdio protocol channel', async () => {
		const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
		const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
		await createLoggingMiddleware()('item-get', {}, {}, async () => ({ success: true }));
		new ConsoleTelemetrySink().record({
			commandName: 'item-get',
			startedAt: '',
			completedAt: '',
			durationMs: 1,
			success: true,
		});
		expect(stdout).not.toHaveBeenCalled();
		expect(stderr).toHaveBeenCalledTimes(3);
	});
	it('expires one-shot keys without evicting live request counts', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const limit = createRateLimitMiddleware({
			maxRequests: 1,
			windowMs: 100,
			maxKeys: 2,
			keyFn: (context) => context.traceId ?? '',
		});
		const run = (key: string) =>
			limit('item-get', {}, { traceId: key }, async () => ({ success: true }));
		expect((await run('old')).success).toBe(true);
		vi.setSystemTime(50);
		expect((await run('live')).success).toBe(true);
		expect((await run('blocked')).success).toBe(false);
		vi.setSystemTime(100);
		expect((await run('new')).success).toBe(true);
		expect((await run('live')).success).toBe(false);
		for (let time = 200; time < 1000; time += 100) {
			vi.setSystemTime(time);
			expect((await run(`visitor-${time}`)).success).toBe(true);
		}
	});
});
