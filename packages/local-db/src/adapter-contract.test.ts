/**
 * One contract suite for every DataAdapter. `HttpAdapter` runs against a small REST server
 * (below) that implements the conventions its docs describe, so both adapters must agree on
 * copies, JSON values, update/remove semantics, table names and atomic batches.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { DataAdapterError } from './adapter-support.js';
import { HttpAdapter } from './http-adapter.js';
import { MemoryAdapter } from './memory-adapter.js';
import type { BatchOperation, DataAdapter } from './types.js';

type Row = Record<string, unknown>;
interface Reply {
	status: number;
	body?: unknown;
}

const API = '/api/v1';
const RESERVED = new Set(['limit', 'offset', 'sort', 'order']);

function compare(a: unknown, b: unknown): number {
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a ?? '').localeCompare(String(b ?? ''));
}

/** A REST server over plain Maps: the reference behavior for HttpAdapter. */
function createRestServer() {
	let store = new Map<string, Map<string, Row>>();
	const paths: string[] = [];

	function listRows(name: string, query: URLSearchParams): Reply {
		let rows = [...(store.get(name)?.values() ?? [])];
		for (const [key, value] of query) {
			if (!RESERVED.has(key)) rows = rows.filter((row) => String(row[key]) === value);
		}
		const total = rows.length;
		const sort = query.get('sort');
		if (sort) {
			const direction = query.get('order') === 'desc' ? -1 : 1;
			rows.sort((a, b) => compare(a[sort], b[sort]) * direction);
		}
		const offset = Number(query.get('offset') ?? 0);
		const limit = query.has('limit') ? Number(query.get('limit')) : rows.length;
		return { status: 200, body: { data: rows.slice(offset, offset + limit), total } };
	}

	function execute(
		method: string,
		segments: string[],
		body: unknown,
		query: URLSearchParams
	): Reply {
		const [name, id, ...extra] = segments;
		if (!name || id === '' || extra.length > 0) return { status: 400, body: { error: 'bad path' } };
		const rows = store.get(name) ?? new Map<string, Row>();
		const save = (key: string, row: Row): Reply => {
			rows.set(key, row);
			store.set(name, rows);
			return { status: method === 'POST' ? 201 : 200, body: row };
		};
		const input = (body ?? {}) as Row;
		if (id === undefined) {
			if (method === 'GET') return listRows(name, query);
			if (method === 'POST') {
				const key = String(input.id ?? input.name ?? input.key ?? crypto.randomUUID());
				return save(key, { ...input, id: key });
			}
			return { status: 400, body: { error: `Unknown method: ${method}` } };
		}
		const existing = rows.get(id);
		switch (method) {
			case 'GET':
				return existing
					? { status: 200, body: existing }
					: { status: 404, body: { error: 'none' } };
			case 'PATCH':
				if (!existing) return { status: 404, body: { error: 'not found' } };
				return save(id, { ...existing, ...input, id });
			case 'PUT':
				return save(id, { ...existing, ...input, id });
			case 'DELETE':
				rows.delete(id);
				return { status: 204 };
			default:
				return { status: 400, body: { error: `Unknown method: ${method}` } };
		}
	}

	function batch(operations: BatchOperation[]): Reply {
		const snapshot = structuredClone(store);
		const results: Row[] = [];
		for (const [index, operation] of operations.entries()) {
			const segments = operation.path.replace(/^\/+/, '').split('/').map(decodeURIComponent);
			const reply = execute(operation.method, segments, operation.body, new URLSearchParams());
			const readMiss = operation.method === 'GET' && reply.status === 404;
			if (reply.status >= 400 && !readMiss) {
				store = snapshot;
				const failed = { status: reply.status, error: JSON.stringify(reply.body) };
				return {
					status: 200,
					body: {
						results: operations.map((_, other) =>
							other === index ? failed : { status: 424, error: 'rolled back' }
						),
						summary: { total: operations.length, success: 0, failed: operations.length },
					},
				};
			}
			results.push(
				readMiss
					? { status: 404, data: null }
					: reply.body === undefined
						? { status: reply.status }
						: { status: reply.status, data: reply.body }
			);
		}
		return {
			status: 200,
			body: { results, summary: { total: operations.length, success: results.length, failed: 0 } },
		};
	}

	const fetch: typeof globalThis.fetch = async (input, init) => {
		const url = new URL(String(input));
		paths.push(url.pathname);
		const reply = (): Reply => {
			if (!url.pathname.startsWith(`${API}/`))
				return { status: 404, body: { error: 'outside the API' } };
			const segments = url.pathname
				.slice(API.length + 1)
				.split('/')
				.map(decodeURIComponent);
			const method = init?.method ?? 'GET';
			const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
			if (segments.join('/') === 'health' && method === 'GET') {
				return { status: 200, body: { status: 'ok', version: 1, tables: store.size, uptime: 0 } };
			}
			if (segments.join('/') === 'batch' && method === 'POST') {
				return batch((body as { operations: BatchOperation[] }).operations);
			}
			return execute(method, segments, body, url.searchParams);
		};
		const { status, body } = reply();
		return new Response(body === undefined ? null : JSON.stringify(body), { status });
	};

	return { fetch, paths };
}

interface Implementation {
	db: DataAdapter;
	/** Request paths the adapter sent, for HttpAdapter. */
	paths: string[];
}

const implementations: Array<[string, () => Implementation]> = [
	['MemoryAdapter', () => ({ db: new MemoryAdapter(), paths: [] })],
	[
		'HttpAdapter',
		() => {
			const server = createRestServer();
			return {
				db: new HttpAdapter(`http://db.test${API}`, { fetch: server.fetch }),
				paths: server.paths,
			};
		},
	],
];

describe.each(implementations)('DataAdapter contract: %s', (_name, implement) => {
	let db: DataAdapter;
	let paths: string[];

	beforeEach(() => {
		({ db, paths } = implement());
	});

	it('creates and reads records, and returns null for a missing one', async () => {
		const created = await db.create('users', { id: 'u1', name: 'Alice' });

		expect(created).toEqual({ id: 'u1', name: 'Alice' });
		expect(await db.get('users', 'u1')).toEqual({ id: 'u1', name: 'Alice' });
		expect(await db.get('users', 'missing')).toBeNull();
	});

	it('returns copies, so changing a result or an input leaves stored data alone', async () => {
		const input = { id: 'u1', tags: ['a'] };
		const created = await db.create<{ id: string; tags: string[] }>('users', input);
		input.tags.push('from-input');
		created.tags.push('from-create');
		const read = await db.get<{ tags: string[] }>('users', 'u1');
		read?.tags.push('from-get');
		const listed = await db.list<{ tags: string[] }>('users');
		listed.data[0]?.tags.push('from-list');
		const updated = await db.update<{ tags: string[] }>('users', 'u1', { tags: ['b'] });
		updated.tags.push('from-update');

		expect(await db.get('users', 'u1')).toEqual({ id: 'u1', tags: ['b'] });
	});

	it('stores values as JSON', async () => {
		await db.create('events', {
			id: 'e1',
			at: new Date(0),
			skipped: undefined,
			nested: { list: [1, { deep: true }] },
		});

		expect(await db.get('events', 'e1')).toEqual({
			id: 'e1',
			at: '1970-01-01T00:00:00.000Z',
			nested: { list: [1, { deep: true }] },
		});
	});

	it('merges update() into an existing record', async () => {
		await db.create('users', { id: 'u1', name: 'Alice', score: 1 });

		expect(await db.update('users', 'u1', { score: 2 })).toEqual({
			id: 'u1',
			name: 'Alice',
			score: 2,
		});
	});

	it('rejects update() of a missing record with a 404 and creates nothing', async () => {
		const update = db.update('users', 'ghost', { name: 'Nobody' });

		await expect(update).rejects.toBeInstanceOf(DataAdapterError);
		await expect(update).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
		expect(await db.get('users', 'ghost')).toBeNull();
	});

	it('creates a missing record with update() in an upsert table', async () => {
		expect(await db.update('settings', 'theme', { value: 'dark' })).toEqual({
			id: 'theme',
			value: 'dark',
		});
		expect(await db.get('settings', 'theme')).toEqual({ id: 'theme', value: 'dark' });
	});

	it('removes records, and removing a missing record succeeds', async () => {
		await db.create('users', { id: 'u1' });

		await db.remove('users', 'u1');
		await expect(db.remove('users', 'u1')).resolves.toBeUndefined();
		expect(await db.get('users', 'u1')).toBeNull();
	});

	it('filters, sorts and paginates list()', async () => {
		await db.create('items', { id: '1', type: 'a', value: 10 });
		await db.create('items', { id: '2', type: 'b', value: 20 });
		await db.create('items', { id: '3', type: 'a', value: 30 });

		const page = await db.list('items', { type: 'a', sort: 'value', order: 'desc', limit: 1 });

		expect(page).toEqual({ data: [{ id: '3', type: 'a', value: 30 }], total: 2 });
		expect(await db.list('empty')).toEqual({ data: [], total: 0 });
	});

	it.each(['constructor', '__proto__', 'toString', '../admin', 'a b/c?d#e'])(
		'keeps the table %j separate and inside the API',
		async (table) => {
			await db.create(table, { id: 'x', table });
			await db.create('admin', { id: 'x', table: 'admin' });

			expect(await db.get(table, 'x')).toEqual({ id: 'x', table });
			expect(await db.list(table)).toMatchObject({ total: 1 });
			expect(await db.get('admin', 'x')).toEqual({ id: 'x', table: 'admin' });
			for (const path of paths) expect(path.startsWith(`${API}/`)).toBe(true);
		}
	);

	it.each(['', '.', '..'])('rejects the table name %j with a 400', async (table) => {
		await expect(db.list(table)).rejects.toMatchObject({ status: 400, code: 'INVALID_NAME' });
		await expect(db.create(table, { id: 'x' })).rejects.toBeInstanceOf(DataAdapterError);
		await expect(db.get(table, 'x')).rejects.toMatchObject({ status: 400 });
		expect(paths).toEqual([]);
	});

	it.each(['', '.', '..'])('rejects the record ID %j with a 400', async (id) => {
		await expect(db.get('users', id)).rejects.toMatchObject({ status: 400, code: 'INVALID_NAME' });
		await expect(db.update('users', id, {})).rejects.toMatchObject({ status: 400 });
		await expect(db.remove('users', id)).rejects.toMatchObject({ status: 400 });
		expect(paths).toEqual([]);
	});

	it('applies every operation of a successful batch', async () => {
		await db.create('users', { id: 'old' });

		const result = await db.batch([
			{ method: 'POST', path: '/users', body: { id: 'u1', name: 'A' } },
			{ method: 'PATCH', path: '/users/u1', body: { name: 'B' } },
			{ method: 'PUT', path: '/users/u2', body: { name: 'C' } },
			{ method: 'DELETE', path: '/users/old' },
			{ method: 'GET', path: '/users/u1' },
		]);

		expect(result.results.map((entry) => entry.status)).toEqual([201, 200, 200, 204, 200]);
		expect(result.results[4]?.data).toEqual({ id: 'u1', name: 'B' });
		expect(result.summary).toEqual({ total: 5, success: 5, failed: 0 });
		expect((await db.list('users')).total).toBe(2);
	});

	it('applies nothing when one operation of a batch fails', async () => {
		await db.create('users', { id: 'kept', name: 'before' });

		const result = await db.batch([
			{ method: 'POST', path: '/users', body: { id: 'u1' } },
			{ method: 'PATCH', path: '/users/kept', body: { name: 'after' } },
			{ method: 'DELETE', path: '/users/kept' },
			{ method: 'PATCH', path: '/users/ghost', body: { name: 'x' } },
			{ method: 'POST', path: '/users', body: { id: 'u2' } },
		]);

		expect(result.results.map((entry) => entry.status)).toEqual([424, 424, 424, 404, 424]);
		expect(result.results[3]?.error).toBeTruthy();
		expect(result.summary).toEqual({ total: 5, success: 0, failed: 5 });
		expect(await db.list('users')).toEqual({
			data: [{ id: 'kept', name: 'before' }],
			total: 1,
		});
	});

	it('rolls back a batch with an unsupported method, including the tables it created', async () => {
		const result = await db.batch([
			{ method: 'POST', path: '/fresh', body: { id: 'f1' } },
			{ method: 'OPTIONS' as 'GET', path: '/fresh' },
		]);

		expect(result.results.map((entry) => entry.status)).toEqual([424, 400]);
		expect(await db.list('fresh')).toEqual({ data: [], total: 0 });
		expect((await db.health()).tables).toBe(0);
	});

	it('treats a batch GET of a missing record as a read, not a failure', async () => {
		const result = await db.batch([
			{ method: 'GET', path: '/users/nobody' },
			{ method: 'POST', path: '/users', body: { id: 'u1' } },
		]);

		expect(result.results).toEqual([
			{ status: 404, data: null },
			{ status: 201, data: { id: 'u1' } },
		]);
		expect(result.summary).toEqual({ total: 2, success: 2, failed: 0 });
	});

	it('reports health', async () => {
		expect(await db.health()).toMatchObject({ status: 'ok' });
	});
});
