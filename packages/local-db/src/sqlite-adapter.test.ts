/**
 * P6-E7 (Loam phase 6 specification, section 19): `SqliteAdapter` on `node:sqlite` passes the
 * DataAdapter contract, every case; a batch is one transaction; and the database keeps section 4's
 * settings, `synchronous = FULL` in WAL mode. `loam.yml`'s `AFD's host path` step runs this file
 * verbose, so each title is in its log.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataAdapterError } from './adapter-support.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { runDataAdapterContract } from './testing.js';

const directories: string[] = [];
const adapters: SqliteAdapter[] = [];

function databasePath(): string {
	const directory = mkdtempSync(join(tmpdir(), 'local-db-sqlite-'));
	directories.push(directory);
	return join(directory, 'data.sqlite');
}

function open(path: string, options: { busyTimeoutMs?: number } = {}): SqliteAdapter {
	const adapter = new SqliteAdapter({ path, ...options });
	adapters.push(adapter);
	return adapter;
}

afterEach(() => {
	for (const adapter of adapters.splice(0)) adapter.close();
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('P6-E7: SqliteAdapter on node:sqlite', () => {
	runDataAdapterContract('SqliteAdapter', () => {
		const adapter = new SqliteAdapter({ path: databasePath() });
		return { adapter, dispose: () => adapter.close() };
	});
});

describe('P6-E7: SqliteAdapter, durability and transactions', () => {
	it('P6-E7: runs in WAL mode with synchronous = FULL, and one records table WITHOUT ROWID', async () => {
		const path = databasePath();
		const adapter = open(path);
		await adapter.create('items', { id: 'a', value: 1 });
		const database = new DatabaseSync(path, { readOnly: true });
		try {
			expect(database.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
			const tables = database
				.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table'")
				.all() as Array<{ name: string; sql: string }>;
			expect(tables.map(({ name }) => name)).toEqual(['records']);
			expect(tables[0]?.sql).toMatch(/PRIMARY KEY \(tbl, id\)\s*\) WITHOUT ROWID$/);
			expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
		} finally {
			database.close();
		}
		// `synchronous` is per connection: the adapter's own reads FULL (2).
		const own = (adapter as unknown as { database: DatabaseSync }).database;
		expect(own.prepare('PRAGMA synchronous').get()).toEqual({ synchronous: 2 });
	});

	it('P6-E7: keeps every committed write across close and reopen', async () => {
		const path = databasePath();
		const first = open(path);
		await first.create('items', { id: 'a', value: 1 });
		await first.update('items', 'a', { value: 2 });
		await first.batch([
			{ method: 'POST', path: '/items', body: { id: 'b', value: 3 } },
			{ method: 'PUT', path: '/settings/theme', body: { value: 'dark' } },
		]);
		await first.remove('items', 'b');
		first.close();
		const second = open(path);
		expect(await second.get('items', 'a')).toEqual({ id: 'a', value: 2 });
		expect(await second.get('items', 'b')).toBeNull();
		expect(await second.get('settings', 'theme')).toEqual({ id: 'theme', value: 'dark' });
		expect(await second.health()).toEqual({ status: 'ok', version: 1, tables: 2, uptime: 0 });
		// A closed adapter opens again on its next call.
		first.close();
		expect(await first.get('items', 'a')).toEqual({ id: 'a', value: 2 });
	});

	it('P6-E7: a batch is one transaction: a fault mid-batch leaves nothing, on disk too', async () => {
		const path = databasePath();
		const adapter = open(path);
		await adapter.create('items', { id: 'kept', value: 0 });
		const result = await adapter.batch([
			{ method: 'POST', path: '/items', body: { id: 'a', value: 1 } },
			{ method: 'PATCH', path: '/items/kept', body: { value: 9 } },
			{ method: 'PATCH', path: '/items/missing', body: { value: 2 } },
			{ method: 'POST', path: '/items', body: { id: 'b', value: 3 } },
		]);
		expect(result.summary).toEqual({ total: 4, success: 0, failed: 4 });
		expect(result.results[2]?.status).toBe(404);
		adapter.close();
		const reopened = open(path);
		expect((await reopened.list('items')).data).toEqual([{ id: 'kept', value: 0 }]);
	});

	it('P6-E7: a thrown error inside a transaction rolls it back and leaves the adapter usable', async () => {
		const path = databasePath();
		const adapter = open(path);
		await adapter.create('items', { id: 'a', value: 1 });
		// A value JSON cannot hold makes the write throw after the transaction began.
		const cyclic: Record<string, unknown> = { id: 'c' };
		cyclic.self = cyclic;
		await expect(adapter.create('items', cyclic)).rejects.toThrow();
		expect((await adapter.list('items')).total).toBe(1);
		await adapter.create('items', { id: 'b', value: 2 });
		expect((await adapter.list('items')).data.map((row) => (row as { id: string }).id)).toEqual([
			'a',
			'b',
		]);
	});

	it('P6-E7: two adapters on one file, in one process, interleave their writes and lose none', async () => {
		const path = databasePath();
		const [left, right] = [open(path), open(path)];
		await Promise.all(
			Array.from({ length: 50 }, (_, index) =>
				(index % 2 === 0 ? left : right).batch([
					{ method: 'POST', path: '/items', body: { id: `i${index}`, value: index } },
					{ method: 'PUT', path: '/counters/c', body: { [`seen${index}`]: true } },
				])
			)
		);
		const { total } = await left.list('items');
		expect(total).toBe(50);
		const counter = (await right.get('counters', 'c')) as Record<string, unknown>;
		expect(Object.keys(counter).filter((key) => key.startsWith('seen'))).toHaveLength(50);
	});

	it('P6-E7: a write that waits past the busy timeout for another connection fails as STORAGE_ERROR', async () => {
		const path = databasePath();
		const adapter = open(path, { busyTimeoutMs: 50 });
		await adapter.create('items', { id: 'a', value: 1 });
		const holder = new DatabaseSync(path);
		holder.exec('BEGIN IMMEDIATE');
		try {
			await expect(adapter.create('items', { id: 'b' })).rejects.toMatchObject({
				status: 500,
				code: 'STORAGE_ERROR',
			});
			// Reads go on under WAL while another connection writes.
			expect(await adapter.get('items', 'a')).toEqual({ id: 'a', value: 1 });
		} finally {
			holder.exec('ROLLBACK');
			holder.close();
		}
		await adapter.create('items', { id: 'b' });
		expect((await adapter.list('items')).total).toBe(2);
	});

	it('P6-E7: lists in ID order without a sort, and filters, sorts and paginates through queryRows', async () => {
		const adapter = open(databasePath());
		for (const id of ['c', 'a', 'b']) await adapter.create('items', { id, group: 'x', rank: id });
		await adapter.create('other', { id: 'z' });
		expect((await adapter.list('items')).data.map((row) => (row as { id: string }).id)).toEqual([
			'a',
			'b',
			'c',
		]);
		const page = await adapter.list('items', { group: 'x', sort: 'rank', order: 'desc', limit: 2 });
		expect(page).toEqual({
			data: [
				{ id: 'c', group: 'x', rank: 'c' },
				{ id: 'b', group: 'x', rank: 'b' },
			],
			total: 3,
		});
	});

	it('refuses a database another program created, and an empty path', async () => {
		const path = databasePath();
		const foreign = new DatabaseSync(path);
		foreign.exec('CREATE TABLE notes (text TEXT)');
		foreign.close();
		await expect(open(path).get('items', 'a')).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
		const versioned = databasePath();
		const other = new DatabaseSync(versioned);
		other.exec('PRAGMA user_version = 7');
		other.close();
		await expect(open(versioned).health()).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
		expect(() => new SqliteAdapter({ path: '' })).toThrow(DataAdapterError);
	});

	it('reports STORAGE_UNAVAILABLE where node:sqlite is missing, as before Node.js 22.13', async () => {
		const spy = vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined as never);
		try {
			await expect(open(databasePath()).get('items', 'a')).rejects.toMatchObject({
				status: 503,
				code: 'STORAGE_UNAVAILABLE',
			});
		} finally {
			spy.mockRestore();
		}
	});

	it('fails to open a path it cannot create as STORAGE_ERROR', async () => {
		const directory = databasePath();
		writeFileSync(directory, '');
		await expect(open(join(directory, 'inside.sqlite')).get('items', 'a')).rejects.toMatchObject({
			code: 'STORAGE_ERROR',
		});
	});

	it('creates the table once when two adapters open a new file at the same time', async () => {
		const path = databasePath();
		const [left, right] = [open(path), open(path)];
		await Promise.all([left.create('items', { id: 'a' }), right.create('items', { id: 'b' })]);
		expect((await left.list('items')).total).toBe(2);
	});
});
