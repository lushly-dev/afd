/** Socket-level REST evidence. The server delegates storage to the actual MemoryAdapter. */
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataAdapterError } from './adapter-support.js';
import { HttpAdapter } from './http-adapter.js';
import { MemoryAdapter } from './memory-adapter.js';
import type { BatchOperation, QueryParams } from './types.js';

describe('HttpAdapter over a real loopback socket', () => {
	let server: Server;
	let storage: MemoryAdapter;
	let db: HttpAdapter;
	let requests: string[];

	beforeEach(async () => {
		storage = new MemoryAdapter();
		requests = [];
		server = createServer(async (request, response) => {
			try {
				const url = new URL(request.url ?? '/', 'http://localhost');
				requests.push(`${request.method} ${url.pathname}`);
				const chunks: Buffer[] = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
				const [table = '', id] = url.pathname
					.slice('/api/v1/'.length)
					.split('/')
					.map(decodeURIComponent);
				let result: unknown;
				let status = 200;
				if (table === 'health') result = await storage.health();
				else if (table === 'batch')
					result = await storage.batch(body.operations as BatchOperation[]);
				else if (request.method === 'GET') {
					const params: QueryParams = Object.fromEntries(url.searchParams);
					for (const key of ['limit', 'offset'] as const) {
						if (params[key] !== undefined) params[key] = Number(params[key]);
					}
					result =
						id === undefined ? await storage.list(table, params) : await storage.get(table, id);
					if (result === null) status = 404;
				} else if (request.method === 'POST') {
					result = await storage.create(table, body);
					status = 201;
				} else if (request.method === 'DELETE' && id !== undefined) {
					await storage.remove(table, id);
					status = 204;
				} else if ((request.method === 'PUT' || request.method === 'PATCH') && id !== undefined) {
					result = await storage.update(table, id, body);
				} else throw new DataAdapterError(400, 'Unsupported request');
				response.writeHead(status, { 'content-type': 'application/json' });
				response.end(status === 204 ? undefined : JSON.stringify(result));
			} catch (error) {
				response.writeHead(error instanceof DataAdapterError ? error.status : 500, {
					'content-type': 'application/json',
				});
				response.end(
					JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
				);
			}
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected loopback address');
		// No injected fetch: this uses the platform network stack.
		db = new HttpAdapter(`http://127.0.0.1:${address.port}/api/v1`);
	});

	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve()))
		);
		storage.clear();
	});

	it('round-trips CRUD, query parameters, JSON copies and settings upserts', async () => {
		await db.create('items', { id: 'a', kind: 'fruit', score: 1, nested: { value: 1 } });
		await db.create('items', { id: 'b', kind: 'fruit', score: 2 });
		await db.create('items', { id: 'c', kind: 'other', score: 3 });
		expect(
			await db.list('items', { kind: 'fruit', sort: 'score', order: 'desc', limit: 1, offset: 1 })
		).toEqual({ data: [{ id: 'a', kind: 'fruit', score: 1, nested: { value: 1 } }], total: 2 });
		const read = await db.get<{ nested: { value: number } }>('items', 'a');
		if (read) read.nested.value = 99;
		expect(await storage.get('items', 'a')).toMatchObject({ nested: { value: 1 } });
		expect(await db.update('items', 'a', { score: 4 })).toMatchObject({ id: 'a', score: 4 });
		expect(await db.update('settings', 'theme', { value: 'dark' })).toEqual({
			id: 'theme',
			value: 'dark',
		});
		await db.remove('items', 'a');
		await db.remove('items', 'a');
		expect(await db.get('items', 'a')).toBeNull();
		expect(requests).toContain('PUT /api/v1/settings/theme');
		expect(requests).toContain('PATCH /api/v1/items/a');
		expect(await db.health()).toMatchObject({ status: 'ok', tables: 2 });
	});

	it('preserves encoded table/id segments and maps actual HTTP errors', async () => {
		await db.create('a b/c?d#e', { id: 'record/with spaces', value: true });
		expect(await db.get('a b/c?d#e', 'record/with spaces')).toMatchObject({ value: true });
		expect(requests).toContain('GET /api/v1/a%20b%2Fc%3Fd%23e/record%2Fwith%20spaces');
		const failed = db.update('items', 'missing', { value: 1 });
		await expect(failed).rejects.toBeInstanceOf(DataAdapterError);
		await expect(failed).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
		expect(await storage.get('items', 'missing')).toBeNull();
	});

	it('commits ordered batches and independently reads back rollback after a failure', async () => {
		const committed = await db.batch([
			{ method: 'POST', path: '/items', body: { id: 'a', value: 1 } },
			{ method: 'PATCH', path: '/items/a', body: { value: 2 } },
			{ method: 'GET', path: '/items/a' },
		]);
		expect(committed.summary).toEqual({ total: 3, success: 3, failed: 0 });
		expect(committed.results[2]?.data).toEqual({ id: 'a', value: 2 });
		expect(await storage.get('items', 'a')).toEqual({ id: 'a', value: 2 });
		const rolledBack = await db.batch([
			{ method: 'PATCH', path: '/items/a', body: { value: 99 } },
			{ method: 'POST', path: '/items', body: { id: 'b' } },
			{ method: 'PATCH', path: '/items/missing', body: {} },
		]);
		expect(rolledBack.results.map((result) => result.status)).toEqual([424, 424, 404]);
		expect(rolledBack.summary).toEqual({ total: 3, success: 0, failed: 3 });
		expect(await storage.list('items')).toEqual({ data: [{ id: 'a', value: 2 }], total: 1 });
		expect(await db.list('items')).toEqual(await storage.list('items'));
		expect(requests.filter((request) => request === 'POST /api/v1/batch')).toHaveLength(2);
	});
});
