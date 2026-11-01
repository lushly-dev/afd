import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenCache } from '../cache.js';
import { VioletRuntime } from '../client.js';
import type { CacheEntry, Token } from '../types.js';

/**
 * A minimal in-memory IndexedDB: enough of open/upgrade, transactions and object-store
 * requests to drive TokenCache's persistent path. Databases outlive connections, so a
 * second TokenCache sees what the first one stored, as with a real browser profile.
 */
type StoreOp = 'get' | 'put' | 'delete' | 'clear' | 'getAllKeys';

class FakeRequest<T> {
	result: T | undefined;
	error: Error | null = null;
	onsuccess: ((event: { target: FakeRequest<T> }) => void) | null = null;
	onerror: ((event: { target: FakeRequest<T> }) => void) | null = null;
	onupgradeneeded: ((event: { target: FakeRequest<T> }) => void) | null = null;

	succeed(result: T): void {
		this.result = result;
		queueMicrotask(() => this.onsuccess?.({ target: this }));
	}

	fail(error: Error): void {
		this.error = error;
		queueMicrotask(() => this.onerror?.({ target: this }));
	}
}

class FakeDatabase {
	readonly stores = new Map<string, { keyPath: string; rows: Map<string, unknown> }>();
	readonly createdStores: string[] = [];
	closed = 0;

	constructor(
		readonly name: string,
		public version: number,
		private readonly failures: Set<StoreOp>,
	) {}

	readonly objectStoreNames = {
		contains: (name: string) => this.stores.has(name),
	};

	createObjectStore(name: string, options: { keyPath: string }) {
		this.createdStores.push(name);
		this.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
	}

	transaction(name: string, _mode: IDBTransactionMode) {
		const store = this.stores.get(name);
		if (!store) throw new DOMException(`No object store named ${name}`, 'NotFoundError');
		const run = <T>(op: StoreOp, action: () => T) => {
			const request = new FakeRequest<T>();
			if (this.failures.has(op)) request.fail(new DOMException(`${op} failed`, 'UnknownError'));
			else request.succeed(action());
			return request;
		};
		return {
			objectStore: () => ({
				get: (key: string) => run('get', () => structuredClone(store.rows.get(key))),
				put: (value: Record<string, unknown>) =>
					run('put', () => {
						const key = String(value[store.keyPath]);
						store.rows.set(key, structuredClone(value));
						return key;
					}),
				delete: (key: string) => run('delete', () => void store.rows.delete(key)),
				clear: () => run('clear', () => void store.rows.clear()),
				getAllKeys: () => run('getAllKeys', () => Array.from(store.rows.keys())),
			}),
		};
	}

	close(): void {
		this.closed++;
	}
}

class FakeIndexedDB {
	readonly databases = new Map<string, FakeDatabase>();
	readonly failures = new Set<StoreOp>();
	openError: Error | null = null;
	openThrows: Error | null = null;
	readonly open = vi.fn((name: string, version: number) => {
		if (this.openThrows) throw this.openThrows;
		const request = new FakeRequest<FakeDatabase>();
		if (this.openError) {
			request.fail(this.openError);
			return request;
		}
		let db = this.databases.get(name);
		const upgrade = !db || db.version < version;
		if (!db || upgrade) {
			const previous = db;
			db = new FakeDatabase(name, version, this.failures);
			for (const [storeName, store] of previous?.stores ?? []) db.stores.set(storeName, store);
			this.databases.set(name, db);
		}
		const opened = db;
		queueMicrotask(() => {
			request.result = opened;
			if (upgrade) request.onupgradeneeded?.({ target: request });
			request.succeed(opened);
		});
		return request;
	});

	rows(): Map<string, unknown> {
		return this.databases.get('violet-runtime')?.stores.get('tokens')?.rows ?? new Map();
	}
}

const TOKENS: Token[] = [
	{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' },
	{ id: 'space.md', value: 16, resolvedAt: 'brand' },
];

describe('TokenCache with IndexedDB', () => {
	let idb: FakeIndexedDB;
	const caches: TokenCache[] = [];

	const openCache = async () => {
		const cache = new TokenCache();
		caches.push(cache);
		await cache.init();
		return cache;
	};

	beforeEach(() => {
		idb = new FakeIndexedDB();
		vi.stubGlobal('indexedDB', idb);
	});

	afterEach(() => {
		for (const cache of caches.splice(0)) cache.close();
		vi.unstubAllGlobals();
	});

	describe('init()', () => {
		it('opens the violet-runtime database and creates the tokens store keyed by nodeId', async () => {
			await openCache();

			expect(idb.open).toHaveBeenCalledWith('violet-runtime', 1);
			const db = idb.databases.get('violet-runtime');
			expect(db?.createdStores).toEqual(['tokens']);
			expect(db?.stores.get('tokens')?.keyPath).toBe('nodeId');
		});

		it('does not recreate the store when an upgrade finds it already present', async () => {
			const first = await openCache();
			first.close();
			// Simulate an older on-disk version so the next open runs an upgrade over a
			// profile that already has the store.
			(idb.databases.get('violet-runtime') as FakeDatabase).version = 0;

			await openCache();

			const db = idb.databases.get('violet-runtime');
			expect(db?.objectStoreNames.contains('tokens')).toBe(true);
			expect(db?.createdStores).toEqual([]);
		});

		it('falls back to memory when the open request fails (e.g. private browsing)', async () => {
			idb.openError = new DOMException('blocked', 'InvalidStateError');
			const cache = await openCache();

			await cache.set('node-a', TOKENS, 60);

			expect((await cache.get('node-a'))?.tokens).toEqual(TOKENS);
			expect(await cache.keys()).toEqual(['node-a']);
			expect(idb.databases.size).toBe(0);
		});

		it('falls back to memory when indexedDB.open throws synchronously', async () => {
			idb.openThrows = new DOMException('denied', 'SecurityError');
			const cache = await openCache();

			await cache.set('node-a', TOKENS, 60);

			expect((await cache.get('node-a'))?.nodeId).toBe('node-a');
		});
	});

	describe('persistent operations', () => {
		it('stores entries in the object store and reads them back', async () => {
			const cache = await openCache();
			const before = Date.now();

			await cache.set('brand-dark', TOKENS, 3600);
			const entry = await cache.get('brand-dark');

			expect(entry).toMatchObject({ nodeId: 'brand-dark', ttl: 3600, tokens: TOKENS });
			expect(entry?.cachedAt).toBeGreaterThanOrEqual(before);
			expect(idb.rows().has('brand-dark')).toBe(true);
			expect(cache.isExpired(entry as CacheEntry)).toBe(false);
		});

		it('returns null for a node that was never cached', async () => {
			const cache = await openCache();
			expect(await cache.get('missing')).toBeNull();
		});

		it('shares entries across cache instances, unlike the memory fallback', async () => {
			const writer = await openCache();
			await writer.set('brand-light', TOKENS, 3600);
			writer.close();

			const reader = await openCache();

			expect((await reader.get('brand-light'))?.tokens).toEqual(TOKENS);
		});

		it('overwrites an existing entry for the same node', async () => {
			const cache = await openCache();
			await cache.set('node', TOKENS, 10);
			await cache.set('node', [TOKENS[0]], 20);

			const entry = await cache.get('node');
			expect(entry?.tokens).toEqual([TOKENS[0]]);
			expect(entry?.ttl).toBe(20);
			expect(await cache.keys()).toEqual(['node']);
		});

		it('deletes one entry, lists the remaining keys and clears the rest', async () => {
			const cache = await openCache();
			await cache.set('a', TOKENS, 60);
			await cache.set('b', TOKENS, 60);
			await cache.set('c', TOKENS, 60);

			await cache.delete('b');
			expect((await cache.keys()).sort()).toEqual(['a', 'c']);
			expect(await cache.get('b')).toBeNull();

			await cache.clear();
			expect(await cache.keys()).toEqual([]);
			expect(idb.rows().size).toBe(0);
		});

		it('treats deleting an absent node as a no-op', async () => {
			const cache = await openCache();
			await cache.set('a', TOKENS, 60);

			await expect(cache.delete('never-stored')).resolves.toBeUndefined();
			expect(await cache.keys()).toEqual(['a']);
		});
	});

	describe('request errors', () => {
		it.each([
			['get', (cache: TokenCache) => cache.get('a')],
			['put', (cache: TokenCache) => cache.set('a', TOKENS, 60)],
			['delete', (cache: TokenCache) => cache.delete('a')],
			['clear', (cache: TokenCache) => cache.clear()],
			['getAllKeys', (cache: TokenCache) => cache.keys()],
		] as const)('rejects with the request error when %s fails', async (op, call) => {
			const cache = await openCache();
			idb.failures.add(op);

			await expect(call(cache)).rejects.toThrow(`${op} failed`);
		});
	});

	describe('close()', () => {
		it('closes the connection once and tolerates repeated calls', async () => {
			const cache = await openCache();
			const db = idb.databases.get('violet-runtime') as FakeDatabase;

			cache.close();
			cache.close();

			expect(db.closed).toBe(1);
		});

		it('keeps working in memory after the connection is closed', async () => {
			const cache = await openCache();
			await cache.set('persisted', TOKENS, 60);
			cache.close();

			await cache.set('after-close', TOKENS, 60);

			expect(await cache.keys()).toEqual(['after-close']);
			expect(idb.rows().has('after-close')).toBe(false);
			expect(idb.rows().has('persisted')).toBe(true);
		});
	});

	describe('through VioletRuntime', () => {
		const mockFetch = vi.fn();

		beforeEach(() => {
			mockFetch.mockReset();
			vi.stubGlobal('fetch', mockFetch);
			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: { tokens: TOKENS, nodeId: 'brand', ancestry: [], tokenCount: TOKENS.length },
					}),
			});
		});

		it('serves a second runtime from the persisted cache without a request', async () => {
			const config = { nodeId: 'brand', apiUrl: 'https://api.test.com', autoApply: false };
			await new VioletRuntime(config).load();
			expect(mockFetch).toHaveBeenCalledOnce();
			expect(idb.rows().has('https://api.test.com::brand')).toBe(true);

			const second = new VioletRuntime(config);
			const hits = vi.fn();
			second.on('cache:hit', hits);
			const tokens = await second.load();

			expect(tokens).toEqual(TOKENS);
			expect(mockFetch).toHaveBeenCalledOnce();
			expect(hits).toHaveBeenCalledOnce();
		});

		it('still loads from the network when every cache request fails', async () => {
			idb.failures.add('get');
			idb.failures.add('put');
			const runtime = new VioletRuntime({ nodeId: 'brand', apiUrl: 'https://api.test.com' });
			const updates = vi.fn();
			runtime.on('cache:update', updates);

			await expect(runtime.load()).resolves.toEqual(TOKENS);
			expect(runtime.getValue('space.md')).toBe(16);
			expect(updates).not.toHaveBeenCalled();
		});
	});
});
