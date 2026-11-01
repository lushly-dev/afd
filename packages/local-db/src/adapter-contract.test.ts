/**
 * One contract suite for every DataAdapter (`runDataAdapterContract`, exported at
 * `@lushly-dev/local-db/testing`). `HttpAdapter` runs against a small REST server (below) that
 * implements the conventions its docs describe, and `IndexedDbAdapter` over fake-indexeddb, so
 * every adapter must agree on copies, JSON values, update/remove semantics, table names and
 * atomic batches.
 */

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { HttpAdapter } from './http-adapter.js';
import { IndexedDbAdapter } from './indexeddb-adapter.js';
import { MemoryAdapter } from './memory-adapter.js';
import { runDataAdapterContract } from './testing.js';
import type { BatchOperation } from './types.js';

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

function createHttpAdapter() {
	const server = createRestServer();
	return {
		db: new HttpAdapter(`http://db.test${API}`, { fetch: server.fetch }),
		paths: server.paths,
	};
}

runDataAdapterContract('MemoryAdapter', () => new MemoryAdapter());
runDataAdapterContract('HttpAdapter', () => createHttpAdapter().db);
runDataAdapterContract('IndexedDbAdapter', () => {
	const adapter = new IndexedDbAdapter({ name: 'contract', indexedDB: new IDBFactory() });
	return { adapter, dispose: () => adapter.close() };
});

describe('HttpAdapter request paths', () => {
	it.each(['constructor', '__proto__', 'toString', '../admin', 'a b/c?d#e'])(
		'keeps the table %j inside the API',
		async (table) => {
			const { db, paths } = createHttpAdapter();
			await db.create(table, { id: 'x' });
			await db.get(table, 'x');
			await db.list(table);

			expect(paths).toHaveLength(3);
			for (const path of paths) expect(path.startsWith(`${API}/`)).toBe(true);
		}
	);

	it.each(['', '.', '..'])('sends no request for the table or record ID %j', async (name) => {
		const { db, paths } = createHttpAdapter();
		await expect(db.list(name)).rejects.toMatchObject({ status: 400 });
		await expect(db.create(name, { id: 'x' })).rejects.toMatchObject({ status: 400 });
		await expect(db.get('users', name)).rejects.toMatchObject({ status: 400 });
		await expect(db.update('users', name, {})).rejects.toMatchObject({ status: 400 });
		await expect(db.remove('users', name)).rejects.toMatchObject({ status: 400 });

		expect(paths).toEqual([]);
	});
});
