import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VioletRuntime } from '../client.js';
import type { RuntimeEventData, Token } from '../types.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function tok(id: string, value: Token['value']): Token {
	return { id, value, resolvedAt: 'global' };
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

const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('VioletRuntime caching and document application', () => {
	beforeEach(() => {
		mockFetch.mockReset();
		document.documentElement.removeAttribute('style');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const make = (overrides: Record<string, unknown> = {}) =>
		new VioletRuntime({ nodeId: 'brand', apiUrl: 'https://api.test.com', ...overrides });

	describe('load() from cache', () => {
		it('serves a fresh cached entry without a request and emits cache:hit, not load', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'green')]));
			await runtime.load();

			const events: string[] = [];
			for (const type of ['load', 'cache:hit', 'cache:miss', 'cache:update'] as const) {
				runtime.on(type, (event) => events.push(event.type));
			}
			document.documentElement.removeAttribute('style');

			const tokens = await runtime.load();

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(tokens).toEqual([tok('color.primary', 'green')]);
			expect(events).toEqual(['cache:hit']);
			// autoApply still applies cached tokens.
			expect(cssVar('--color-primary')).toBe('green');
		});

		it('refetches once the entry has outlived cacheTtl', async () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			const runtime = make({ cacheTtl: 60 });
			mockFetch
				.mockResolvedValueOnce(okResponse([tok('color.primary', 'old')]))
				.mockResolvedValueOnce(okResponse([tok('color.primary', 'new')]));
			await runtime.load();

			vi.setSystemTime(Date.now() + 61_000);
			const misses = vi.fn();
			runtime.on('cache:miss', misses);
			await runtime.load();

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(misses).toHaveBeenCalledOnce();
			expect(runtime.getValue('color.primary')).toBe('new');
		});

		it('scopes entries by apiUrl regardless of a trailing slash', async () => {
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));
			const runtime = make({ apiUrl: 'https://api.test.com/' });
			await runtime.load();

			// Same runtime, same backend: invalidating via the slash-free key works.
			await runtime.invalidateCache();
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '2')]));
			await runtime.load();

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(runtime.getValue('a')).toBe('2');
		});
	});

	describe('preload()', () => {
		it('skips the request when the node is already cached and fresh', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));
			await runtime.preload('brand-dark');

			await runtime.preload('brand-dark');

			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it('does not touch the current node, tokens or document', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'red')]));

			await runtime.preload('brand-dark');

			expect(runtime.getCurrentNodeId()).toBe('brand');
			expect(runtime.getAll()).toEqual([]);
			expect(cssVar('--color-primary')).toBe('');
		});

		it('makes the following switchNode a cache hit', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'red')]));
			await runtime.preload('brand-dark');
			const loads = vi.fn();
			runtime.on('load', loads);

			await runtime.switchNode('brand-dark');

			expect(mockFetch).toHaveBeenCalledOnce();
			expect(loads).not.toHaveBeenCalled();
			expect(cssVar('--color-primary')).toBe('red');
		});

		it('always fetches and never caches when the cache is disabled', async () => {
			const runtime = make({ cacheEnabled: false });
			mockFetch.mockResolvedValue(okResponse([tok('a', '1')]));

			await runtime.preload('brand-dark');
			await runtime.preload('brand-dark');

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('propagates a failed request', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable' });

			await expect(runtime.preload('brand-dark')).rejects.toThrow('HTTP 503: Unavailable');
		});
	});

	describe('invalidateCache() and clearCache()', () => {
		it('invalidates the current node by default', async () => {
			const runtime = make();
			mockFetch.mockResolvedValue(okResponse([tok('a', '1')]));
			await runtime.load();

			await runtime.invalidateCache();
			await runtime.load();

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('invalidates only the named node', async () => {
			const runtime = make();
			mockFetch.mockResolvedValue(okResponse([tok('a', '1')]));
			await runtime.load();
			await runtime.preload('other');

			await runtime.invalidateCache('other');
			await runtime.load();
			await runtime.preload('other');

			// load() hit the cache; only the invalidated node was refetched.
			expect(mockFetch).toHaveBeenCalledTimes(3);
			expect(mockFetch.mock.calls[2][0]).toBe('https://api.test.com/api/v1/nodes/other/tokens');
		});

		it('clearCache() forces every node to be refetched', async () => {
			const runtime = make();
			mockFetch.mockResolvedValue(okResponse([tok('a', '1')]));
			await runtime.load();
			await runtime.preload('other');

			await runtime.clearCache();
			await runtime.load();
			await runtime.preload('other');

			expect(mockFetch).toHaveBeenCalledTimes(4);
		});
	});

	describe('document application', () => {
		it('prefixes variables with cssPrefix and skips composite values', async () => {
			const runtime = make({ cacheEnabled: false, cssPrefix: 'vi' });
			mockFetch.mockResolvedValueOnce(
				okResponse([
					tok('color.brand.primary', '#107C10'),
					tok('space.md', 16),
					tok('typography.body', { fontFamily: 'Segoe UI', fontSize: 14 }),
				]),
			);

			await runtime.load();

			expect(cssVar('--vi-color-brand-primary')).toBe('#107C10');
			expect(cssVar('--vi-space-md')).toBe('16');
			expect(cssVar('--vi-typography-body')).toBe('');
			expect(cssVar('--color-brand-primary')).toBe('');
		});

		it('does not apply tokens when autoApply is off until asked', async () => {
			const runtime = make({ cacheEnabled: false, autoApply: false });
			mockFetch.mockResolvedValueOnce(okResponse([tok('color.primary', 'blue')]));

			await runtime.load();
			expect(cssVar('--color-primary')).toBe('');

			runtime.applyToDocument();
			expect(cssVar('--color-primary')).toBe('blue');
		});

		it('removeFromDocument() removes only the prefixed variables it set', async () => {
			const runtime = make({ cacheEnabled: false, cssPrefix: 'vi' });
			mockFetch.mockResolvedValueOnce(
				okResponse([tok('color.primary', 'blue'), tok('space.md', 4)]),
			);
			await runtime.load();
			document.documentElement.style.setProperty('--app-own', 'keep');

			runtime.removeFromDocument();

			expect(cssVar('--vi-color-primary')).toBe('');
			expect(cssVar('--vi-space-md')).toBe('');
			expect(cssVar('--app-own')).toBe('keep');
		});

		it('drops variables the new node does not define when switching', async () => {
			const runtime = make({ cacheEnabled: false });
			mockFetch
				.mockResolvedValueOnce(okResponse([tok('color.primary', 'blue'), tok('only.light', 'x')]))
				.mockResolvedValueOnce(okResponse([tok('color.primary', 'navy')]));
			await runtime.load();

			await runtime.switchNode('brand-dark');

			expect(cssVar('--color-primary')).toBe('navy');
			expect(cssVar('--only-light')).toBe('');
		});
	});

	describe('events', () => {
		it('a throwing listener does not break loading or other listeners', async () => {
			const runtime = make({ cacheEnabled: false });
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));
			const received: RuntimeEventData[] = [];
			runtime.on('load', () => {
				throw new Error('listener bug');
			});
			runtime.on('load', (event) => received.push(event));

			await expect(runtime.load()).resolves.toHaveLength(1);
			expect(received).toHaveLength(1);
			expect(received[0]).toMatchObject({ type: 'load', nodeId: 'brand' });
		});

		it('reports the target node on cache events during a switch', async () => {
			const runtime = make();
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));
			const seen: Array<[string, string]> = [];
			for (const type of ['cache:miss', 'cache:update', 'theme:change'] as const) {
				runtime.on(type, (event) => seen.push([event.type, event.nodeId]));
			}

			await runtime.switchNode('brand-dark');

			expect(seen).toEqual([
				['cache:miss', 'brand-dark'],
				['cache:update', 'brand-dark'],
				['theme:change', 'brand-dark'],
			]);
		});
	});

	describe('fetch failures', () => {
		it('reports UNKNOWN when an unsuccessful response carries no error', async () => {
			const runtime = make({ cacheEnabled: false });
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ success: false }),
			});

			await expect(runtime.load()).rejects.toThrow('UNKNOWN: Unknown error');
		});

		it('treats a successful response without data as an error', async () => {
			const runtime = make({ cacheEnabled: false });
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({ success: true, error: { code: 'EMPTY', message: 'No data' } }),
			});

			await expect(runtime.load()).rejects.toThrow('EMPTY: No data');
		});

		it('passes the underlying error through when no timeout fired', async () => {
			const runtime = make({ cacheEnabled: false });
			const networkError = new TypeError('Failed to fetch');
			mockFetch.mockRejectedValueOnce(networkError);
			const errors = vi.fn();
			runtime.on('load:error', errors);

			await expect(runtime.load()).rejects.toBe(networkError);
			expect(errors.mock.calls[0][0].data).toBe(networkError);
		});

		it('sets no timer when timeout is 0', async () => {
			const runtime = make({ cacheEnabled: false, timeout: 0 });
			const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
			mockFetch.mockResolvedValueOnce(okResponse([tok('a', '1')]));

			await runtime.load();

			expect(setTimeoutSpy).not.toHaveBeenCalled();
			setTimeoutSpy.mockRestore();
		});

		it('encodes the node ID in the request path', async () => {
			const runtime = make({ cacheEnabled: false, nodeId: 'brand/dark mode' });
			mockFetch.mockResolvedValueOnce(okResponse([]));

			await runtime.load();

			expect(mockFetch.mock.calls[0][0]).toBe(
				'https://api.test.com/api/v1/nodes/brand%2Fdark%20mode/tokens',
			);
		});
	});

	describe('init()', () => {
		it('is idempotent', async () => {
			const runtime = make({ cacheEnabled: false });
			await runtime.init();
			await expect(runtime.init()).resolves.toBeUndefined();
		});
	});
});
