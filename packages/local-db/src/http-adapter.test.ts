import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpAdapter, createHttpAdapter } from './http-adapter.js';
import type { DataAdapter } from './types.js';

function mockFetch(responses: Record<string, { status: number; body?: unknown }>) {
	return vi.fn(async (url: string, init?: RequestInit) => {
		const key = `${init?.method ?? 'GET'} ${url}`;
		// Find matching response by checking if URL starts with any key
		const match = Object.entries(responses).find(
			([k]) => key.startsWith(k) || url.includes(k),
		);
		const response = match?.[1] ?? { status: 404, body: { error: 'Not found' } };
		return {
			ok: response.status >= 200 && response.status < 300,
			status: response.status,
			statusText: response.status === 200 ? 'OK' : 'Error',
			json: async () => response.body,
			text: async () => JSON.stringify(response.body ?? ''),
		} as Response;
	});
}

describe('HttpAdapter', () => {
	it('constructs with default base URL', () => {
		const adapter = new HttpAdapter();
		expect(adapter).toBeInstanceOf(HttpAdapter);
	});

	it('get calls correct URL', async () => {
		const fetch = mockFetch({
			'/api/v1/accounts/u1': { status: 200, body: { id: 'u1', name: 'Alice' } },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		const result = await adapter.get('accounts', 'u1');
		expect(result).toEqual({ id: 'u1', name: 'Alice' });
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('get returns null on 404', async () => {
		const fetch = mockFetch({});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		const result = await adapter.get('accounts', 'missing');
		expect(result).toBeNull();
	});

	it('list passes query params', async () => {
		const fetch = mockFetch({
			'/api/v1/flags': { status: 200, body: { data: [], total: 0 } },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		await adapter.list('flags', { type: 'release', limit: 10 });
		const url = fetch.mock.calls[0]![0] as string;
		expect(url).toContain('type=release');
		expect(url).toContain('limit=10');
	});

	it('create sends POST', async () => {
		const fetch = mockFetch({
			POST: { status: 201, body: { id: 'new', name: 'test' } },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		const result = await adapter.create('accounts', { name: 'test' });
		expect(result).toEqual({ id: 'new', name: 'test' });
		expect(fetch.mock.calls[0]![1]?.method).toBe('POST');
	});

	it('update uses PUT for upsert tables', async () => {
		const fetch = mockFetch({
			PUT: { status: 200, body: { name: 'release/test', enabled: true } },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		await adapter.update('flags', 'release/test', { enabled: true });
		expect(fetch.mock.calls[0]![1]?.method).toBe('PUT');
	});

	it('update uses PATCH for regular tables', async () => {
		const fetch = mockFetch({
			PATCH: { status: 200, body: { id: 'u1', name: 'updated' } },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		await adapter.update('accounts', 'u1', { name: 'updated' });
		expect(fetch.mock.calls[0]![1]?.method).toBe('PATCH');
	});

	it('remove sends DELETE', async () => {
		const fetch = mockFetch({
			DELETE: { status: 204 },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		await adapter.remove('accounts', 'u1');
		expect(fetch.mock.calls[0]![1]?.method).toBe('DELETE');
	});

	it('throws on server error', async () => {
		const fetch = mockFetch({
			'/api/v1/accounts': { status: 500, body: { error: 'Internal error' } },
		});
		const adapter = new HttpAdapter('/api/v1', { fetch });
		await expect(adapter.list('accounts')).rejects.toThrow('HTTP 500');
	});

	it('uses custom path map', async () => {
		const fetch = mockFetch({
			'/api/v1/custom-path': { status: 200, body: { data: [], total: 0 } },
		});
		const adapter = new HttpAdapter('/api/v1', {
			fetch,
			pathMap: { my_table: '/custom-path' },
		});
		await adapter.list('my_table');
		expect(fetch.mock.calls[0]![0] as string).toContain('/custom-path');
	});
});

describe('createHttpAdapter', () => {
	it('returns an HttpAdapter instance', () => {
		const adapter = createHttpAdapter('/api');
		expect(adapter).toBeInstanceOf(HttpAdapter);
	});

	it('satisfies DataAdapter interface', () => {
		const adapter: DataAdapter = createHttpAdapter();
		expect(typeof adapter.get).toBe('function');
		expect(typeof adapter.list).toBe('function');
	});
});
