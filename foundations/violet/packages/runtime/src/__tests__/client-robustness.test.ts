import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenCache } from '../cache.js';
import { VioletRuntime } from '../client.js';
import type { Token } from '../types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function tok(id: string, value: string, resolvedAt = 'global'): Token {
	return { id, value, resolvedAt };
}

function okResponse(tokens: Token[]) {
	return {
		ok: true,
		json: () =>
			Promise.resolve({
				success: true,
				data: { tokens, nodeId: 'x', ancestry: [], tokenCount: tokens.length },
			}),
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('VioletRuntime robustness', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	const make = (overrides: Record<string, unknown> = {}) =>
		new VioletRuntime({
			nodeId: 'start',
			apiUrl: 'https://api.test.com',
			cacheEnabled: false,
			...overrides,
		});

	describe('stale response race', () => {
		it('only applies the latest switchNode when an earlier one resolves last', async () => {
			const runtime = make();
			const a = deferred<unknown>();
			const b = deferred<unknown>();
			mockFetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

			const pA = runtime.switchNode('A');
			const pB = runtime.switchNode('B');

			b.resolve(okResponse([tok('color.primary', 'blue')]));
			await pB;
			expect(runtime.getCurrentNodeId()).toBe('B');
			expect(cssVar('--color-primary')).toBe('blue');

			// Slow request for A finally arrives
			a.resolve(okResponse([tok('color.primary', 'red')]));
			await pA;

			expect(runtime.getCurrentNodeId()).toBe('B');
			expect(cssVar('--color-primary')).toBe('blue');
			expect(runtime.getValue('color.primary')).toBe('blue');
		});

		it('does not cache A tokens under B key', async () => {
			const setSpy = vi.spyOn(TokenCache.prototype, 'set');
			const runtime = make({ cacheEnabled: true });
			const a = deferred<unknown>();
			const b = deferred<unknown>();
			mockFetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

			const pA = runtime.switchNode('A');
			const pB = runtime.switchNode('B');
			b.resolve(okResponse([tok('t', 'b-value')]));
			await pB;
			a.resolve(okResponse([tok('t', 'a-value')]));
			await pA;

			const byKey = new Map(setSpy.mock.calls.map(([key, tokens]) => [key, tokens]));
			const keyA = [...byKey.keys()].find((k) => k.endsWith('::A'));
			const keyB = [...byKey.keys()].find((k) => k.endsWith('::B'));
			expect(byKey.get(keyA as string)?.[0].value).toBe('a-value');
			expect(byKey.get(keyB as string)?.[0].value).toBe('b-value');
		});

		it('does not emit theme:change for a superseded switch', async () => {
			const runtime = make();
			const listener = vi.fn();
			runtime.on('theme:change', listener);
			const a = deferred<unknown>();
			mockFetch.mockReturnValueOnce(a.promise).mockResolvedValueOnce(okResponse([tok('t', 'b')]));

			const pA = runtime.switchNode('A');
			await runtime.switchNode('B');
			a.resolve(okResponse([tok('t', 'a')]));
			await pA;

			expect(listener).toHaveBeenCalledOnce();
			expect(listener.mock.calls[0][0].data).toMatchObject({ to: 'B' });
		});
	});

	describe('failed switchNode', () => {
		it('keeps the previous theme and node when the switch fails', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'red')]));
			await runtime.load();
			expect(cssVar('--color-primary')).toBe('red');

			mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Boom' });
			await expect(runtime.switchNode('broken')).rejects.toThrow('HTTP 500');

			expect(runtime.getCurrentNodeId()).toBe('start');
			expect(cssVar('--color-primary')).toBe('red');
			expect(runtime.getValue('color.primary')).toBe('red');
		});
	});

	describe('best-effort cache I/O', () => {
		it('still applies tokens when cache.set throws (quota)', async () => {
			vi.spyOn(TokenCache.prototype, 'set').mockRejectedValue(new Error('QuotaExceededError'));
			const runtime = make({ cacheEnabled: true });
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'green')]));

			const tokens = await runtime.load();

			expect(tokens).toHaveLength(1);
			expect(cssVar('--color-primary')).toBe('green');
		});

		it('treats a throwing cache.get as a miss', async () => {
			vi.spyOn(TokenCache.prototype, 'get').mockRejectedValue(new Error('idb broke'));
			const runtime = make({ cacheEnabled: true });
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'green')]));

			await expect(runtime.load()).resolves.toHaveLength(1);
			expect(cssVar('--color-primary')).toBe('green');
		});

		it('preload() ignores cache write failures', async () => {
			vi.spyOn(TokenCache.prototype, 'set').mockRejectedValue(new Error('QuotaExceededError'));
			const runtime = make({ cacheEnabled: true });
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));
			await expect(runtime.preload('other')).resolves.toBeUndefined();
		});
	});

	describe('cache key', () => {
		it('includes apiUrl so different backends do not share entries', async () => {
			const setSpy = vi.spyOn(TokenCache.prototype, 'set');
			mockFetch.mockResolvedValue(okResponse([tok('a', '1')]));

			await make({ cacheEnabled: true, apiUrl: 'https://staging.test.com' }).load();
			await make({ cacheEnabled: true, apiUrl: 'https://prod.test.com' }).load();

			const keys = setSpy.mock.calls.map(([key]) => key);
			expect(keys).toHaveLength(2);
			expect(keys[0]).not.toBe(keys[1]);
			expect(keys[0]).toContain('staging.test.com');
			expect(keys[1]).toContain('prod.test.com');
			expect(keys[0]).toContain('start');
		});

		it('reads back from the same backend-scoped key', async () => {
			const runtime = make({ cacheEnabled: true });
			mockFetch.mockResolvedValue(okResponse([tok('a', '1')]));
			await runtime.load();
			await runtime.load();
			expect(mockFetch).toHaveBeenCalledTimes(1); // second load served from cache
		});
	});

	describe('fetch timeout', () => {
		it('aborts a hung request after the configured timeout', async () => {
			vi.useFakeTimers();
			mockFetch.mockImplementation(
				(_url: string, init: { signal: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener('abort', () =>
							reject(new DOMException('The operation was aborted.', 'AbortError')),
						);
					}),
			);
			const runtime = make({ timeout: 500 });
			const listener = vi.fn();
			runtime.on('load:error', listener);

			const promise = runtime.load();
			const assertion = expect(promise).rejects.toThrow(/timed out after 500ms/);
			await vi.advanceTimersByTimeAsync(500);
			await assertion;
			expect(listener).toHaveBeenCalledOnce();
		});

		it('defaults to 10 seconds', async () => {
			vi.useFakeTimers();
			mockFetch.mockImplementation(
				(_url: string, init: { signal: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener('abort', () => reject(new Error('aborted')));
					}),
			);
			const runtime = make();
			const promise = runtime.load();
			const assertion = expect(promise).rejects.toThrow(/timed out after 10000ms/);
			await vi.advanceTimersByTimeAsync(9_999);
			expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await assertion;
		});

		it('clears the timer after a successful response', async () => {
			vi.useFakeTimers();
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));
			const runtime = make({ timeout: 500 });
			await runtime.load();
			expect(vi.getTimerCount()).toBe(0);
		});
	});

	describe('load:error', () => {
		it('is emitted exactly once for an API-level error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: false, error: { code: 'NOPE', message: 'denied' } }),
			});
			const runtime = make();
			const listener = vi.fn();
			runtime.on('load:error', listener);

			await expect(runtime.load()).rejects.toThrow('NOPE: denied');
			expect(listener).toHaveBeenCalledOnce();
		});

		it('is emitted exactly once for an HTTP error', async () => {
			mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });
			const runtime = make();
			const listener = vi.fn();
			runtime.on('load:error', listener);

			await expect(runtime.load()).rejects.toThrow('HTTP 503');
			expect(listener).toHaveBeenCalledOnce();
		});
	});

	describe('getByPattern()', () => {
		let runtime: VioletRuntime;

		beforeEach(async () => {
			runtime = make();
			mockFetch.mockResolvedValueOnce(
				okResponse([
					tok('color.primary', '#1'),
					tok('color.secondary', '#2'),
					tok('bgcolor.primary', '#3'),
					tok('color(x)', '#4'),
					tok('colorXprimary', '#5'),
					tok('spacing.small', '4'),
				]),
			);
			await runtime.load();
		});

		it('anchors the pattern so color.* does not match bgcolor.*', () => {
			const ids = runtime.getByPattern('color.*').map((t) => t.id);
			expect(ids).toEqual(['color.primary', 'color.secondary']);
		});

		it('treats regex metacharacters literally and does not throw', () => {
			expect(() => runtime.getByPattern('color(')).not.toThrow();
			expect(runtime.getByPattern('color(')).toEqual([]);
			expect(runtime.getByPattern('color(x)').map((t) => t.id)).toEqual(['color(x)']);
		});

		it('treats "." literally', () => {
			expect(runtime.getByPattern('colorXprimary').map((t) => t.id)).toEqual(['colorXprimary']);
			expect(runtime.getByPattern('color.primary').map((t) => t.id)).toEqual(['color.primary']);
		});

		it('supports * anywhere', () => {
			expect(runtime.getByPattern('*.primary').map((t) => t.id)).toEqual([
				'color.primary',
				'bgcolor.primary',
			]);
			expect(runtime.getByPattern('*')).toHaveLength(6);
		});
	});
});
