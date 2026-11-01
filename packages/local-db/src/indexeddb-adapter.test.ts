/**
 * IndexedDbAdapter beyond the shared contract (`adapter-contract.test.ts`): persistence, the
 * database it owns, connection handling and storage failures. Runs over fake-indexeddb.
 */

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DataAdapterError } from './adapter-support.js';
import { createIndexedDbAdapter, IndexedDbAdapter } from './indexeddb-adapter.js';

function openRaw(factory: IDBFactory, name: string, version?: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = factory.open(name, version);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

describe('IndexedDbAdapter', () => {
	it('keeps records across adapters and connections on the same database', async () => {
		const factory = new IDBFactory();
		const first = new IndexedDbAdapter({ name: 'app', indexedDB: factory });
		await first.create('users', { id: 'u1', name: 'Alice' });
		await first.close();

		const second = createIndexedDbAdapter({ name: 'app', indexedDB: factory });
		expect(await second.get('users', 'u1')).toEqual({ id: 'u1', name: 'Alice' });
		expect(await first.get('users', 'u1')).toEqual({ id: 'u1', name: 'Alice' });
		expect(await new IndexedDbAdapter({ name: 'other', indexedDB: factory }).list('users')).toEqual(
			{ data: [], total: 0 }
		);
	});

	it('creates one records store keyed by [table, id] with a table index', async () => {
		const factory = new IDBFactory();
		const adapter = new IndexedDbAdapter({ name: 'schema', indexedDB: factory });
		await adapter.health();
		await adapter.close();

		const db = await openRaw(factory, 'schema');
		const store = db.transaction('records').objectStore('records');
		expect(Array.from(db.objectStoreNames)).toEqual(['records']);
		expect(store.keyPath).toEqual(['table', 'id']);
		expect(store.index('table').keyPath).toBe('table');
		expect(db.version).toBe(1);
		db.close();
	});

	it('lists records in ID order without a sort, and generates IDs', async () => {
		const adapter = new IndexedDbAdapter({ name: 'order', indexedDB: new IDBFactory() });
		await adapter.create('items', { id: 'b' });
		await adapter.create('items', { id: 'a' });
		const generated = await adapter.create<{ id: string; value: number }>('items', { value: 1 });
		await adapter.create('items', { name: 'named' });

		expect(generated.id).toMatch(/^[0-9a-f-]{36}$/);
		const ids = (await adapter.list<{ id: string }>('items')).data.map((row) => row.id);
		expect(ids).toEqual([...ids].sort());
		expect(ids).toEqual(expect.arrayContaining(['a', 'b', 'named', generated.id]));
		expect(await adapter.health()).toEqual({ status: 'ok', version: 1, tables: 1, uptime: 0 });
	});

	it('serializes concurrent writes so none is lost', async () => {
		const adapter = new IndexedDbAdapter({ name: 'concurrent', indexedDB: new IDBFactory() });
		await adapter.update('settings', 'counter', { a: 0 });

		await Promise.all(
			Array.from({ length: 10 }, (_, index) =>
				adapter.update('settings', 'counter', { [`k${index}`]: index })
			)
		);

		const row = await adapter.get<Record<string, unknown>>('settings', 'counter');
		expect(Object.keys(row ?? {}).sort()).toEqual(
			['a', 'id', ...Array.from({ length: 10 }, (_, index) => `k${index}`)].sort()
		);
	});

	it('rejects batch operations that are not objects or have a malformed path', async () => {
		const adapter = new IndexedDbAdapter({ name: 'batch', indexedDB: new IDBFactory() });

		const notObject = await adapter.batch([null as never]);
		expect(notObject.results[0]).toMatchObject({ status: 400 });
		const malformed = await adapter.batch([{ method: 'GET', path: '/users/%E0%A4%A' }]);
		expect(malformed.results[0]).toMatchObject({ status: 400 });
		const noId = await adapter.batch([{ method: 'DELETE', path: '/users' }]);
		expect(noId.results[0]).toMatchObject({ status: 400 });
		const listed = await adapter.batch([
			{ method: 'PUT', path: '/users/a%2Fb', body: { name: 'slash' } },
			{ method: 'GET', path: '/users' },
		]);
		expect(listed.results[1]?.data).toEqual({ data: [{ id: 'a/b', name: 'slash' }], total: 1 });
	});

	it('closes when another connection upgrades the database, then reopens', async () => {
		const factory = new IDBFactory();
		const adapter = new IndexedDbAdapter({ name: 'shared', indexedDB: factory });
		await adapter.create('users', { id: 'u1' });

		// destroy() from a second adapter deletes the database; the first one lets it.
		await new IndexedDbAdapter({ name: 'shared', indexedDB: factory }).destroy();

		expect(await adapter.get('users', 'u1')).toBeNull();
		await adapter.create('users', { id: 'u2' });
		expect((await adapter.list('users')).total).toBe(1);
	});

	it('refuses a database another program created', async () => {
		const factory = new IDBFactory();
		(await openRaw(factory, 'foreign', 1)).close();
		const adapter = new IndexedDbAdapter({ name: 'foreign', indexedDB: factory });

		await expect(adapter.list('users')).rejects.toMatchObject({
			status: 500,
			code: 'STORAGE_ERROR',
			message: expect.stringContaining('not created by IndexedDbAdapter'),
		});
		// A failed open is retried, and fails the same way.
		await expect(adapter.health()).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
	});

	it('reports a failed open as STORAGE_ERROR', async () => {
		const factory = new IDBFactory();
		(await openRaw(factory, 'newer', 5)).close();
		const adapter = new IndexedDbAdapter({ name: 'newer', indexedDB: factory });

		await expect(adapter.get('users', 'u1')).rejects.toMatchObject({
			status: 500,
			code: 'STORAGE_ERROR',
			message: expect.stringContaining('VersionError'),
		});
	});

	it('rejects with STORAGE_UNAVAILABLE when there is no IndexedDB', async () => {
		expect(globalThis.indexedDB).toBeUndefined();
		const adapter = new IndexedDbAdapter({ name: 'nowhere' });

		await expect(adapter.list('users')).rejects.toBeInstanceOf(DataAdapterError);
		await expect(adapter.list('users')).rejects.toMatchObject({
			status: 503,
			code: 'STORAGE_UNAVAILABLE',
		});
		await expect(adapter.close()).resolves.toBeUndefined();
	});

	it('needs a database name', () => {
		expect(() => new IndexedDbAdapter({ name: '' })).toThrow(DataAdapterError);
		expect(() => new IndexedDbAdapter(undefined as never)).toThrow(/nonempty database name/);
	});
});
