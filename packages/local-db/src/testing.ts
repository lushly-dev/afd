/**
 * The DataAdapter contract suite, for any adapter: `MemoryAdapter`, `HttpAdapter`,
 * `IndexedDbAdapter` or your own.
 *
 * Import it from `@lushly-dev/local-db/testing` in a Vitest suite. It imports `describe`, `it`,
 * `expect`, `beforeEach` and `afterEach` from `vitest` (an optional peer dependency), so it runs
 * the same in Node.js and in Vitest's browser mode; it uses no Node.js builtin.
 *
 * @example
 * ```ts
 * import { IndexedDbAdapter } from '@lushly-dev/local-db/indexeddb';
 * import { runDataAdapterContract } from '@lushly-dev/local-db/testing';
 *
 * runDataAdapterContract('IndexedDbAdapter', () => {
 *   const adapter = new IndexedDbAdapter({ name: `contract-${crypto.randomUUID()}` });
 *   return { adapter, dispose: () => adapter.destroy() };
 * });
 * ```
 *
 * @module @lushly-dev/local-db/testing
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataAdapterError } from './adapter-support.js';
import type { DataAdapter } from './types.js';

/** An adapter under test, with an optional cleanup that runs after each test. */
export interface DataAdapterContractSubject {
	adapter: DataAdapter;
	/** Called after each test, for example to close or delete a database. */
	dispose?: () => void | Promise<void>;
}

/**
 * Makes the adapter for one test. Every call must return an empty adapter that shares no data
 * with the adapters of earlier calls.
 */
export type DataAdapterContractFactory = () =>
	| DataAdapter
	| DataAdapterContractSubject
	| Promise<DataAdapter | DataAdapterContractSubject>;

function isSubject(
	value: DataAdapter | DataAdapterContractSubject
): value is DataAdapterContractSubject {
	return typeof (value as Partial<DataAdapter>).get !== 'function';
}

/**
 * Register the DataAdapter contract tests, in a `describe` block named
 * `DataAdapter contract: <name>`. `create` runs before each test.
 *
 * The contract: records are JSON copies (never live references to stored data); `update()` of a
 * missing record rejects with a 404 except in the upsert tables; removing a missing record
 * succeeds; `list()` filters, sorts and paginates; table names are arbitrary strings except
 * `''`, `.` and `..`, which reject with a 400, as do those record IDs; `batch()` is atomic; and
 * `health()` reports `status: 'ok'`.
 */
export function runDataAdapterContract(name: string, create: DataAdapterContractFactory): void {
	describe(`DataAdapter contract: ${name}`, () => {
		let db: DataAdapter;
		let dispose: (() => void | Promise<void>) | undefined;

		beforeEach(async () => {
			const made = await create();
			if (isSubject(made)) {
				db = made.adapter;
				dispose = made.dispose;
			} else {
				db = made;
				dispose = undefined;
			}
		});

		afterEach(async () => {
			await dispose?.();
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
			'keeps the table %j separate from every other table',
			async (table) => {
				await db.create(table, { id: 'x', table });
				await db.create('admin', { id: 'x', table: 'admin' });

				expect(await db.get(table, 'x')).toEqual({ id: 'x', table });
				expect(await db.list(table)).toMatchObject({ total: 1 });
				expect(await db.get('admin', 'x')).toEqual({ id: 'x', table: 'admin' });
			}
		);

		it.each(['', '.', '..'])('rejects the table name %j with a 400', async (table) => {
			await expect(db.list(table)).rejects.toMatchObject({ status: 400, code: 'INVALID_NAME' });
			await expect(db.create(table, { id: 'x' })).rejects.toBeInstanceOf(DataAdapterError);
			await expect(db.get(table, 'x')).rejects.toMatchObject({ status: 400 });
		});

		it.each(['', '.', '..'])('rejects the record ID %j with a 400', async (id) => {
			await expect(db.get('users', id)).rejects.toMatchObject({
				status: 400,
				code: 'INVALID_NAME',
			});
			await expect(db.update('users', id, {})).rejects.toMatchObject({ status: 400 });
			await expect(db.remove('users', id)).rejects.toMatchObject({ status: 400 });
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
}
