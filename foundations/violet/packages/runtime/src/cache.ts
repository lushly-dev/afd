/**
 * Token Cache
 *
 * IndexedDB-based caching for token data with TTL support.
 * Falls back to in-memory cache when IndexedDB is unavailable.
 */

import type { CacheEntry, Token } from './types.js';

const DB_NAME = 'violet-runtime';
const STORE_NAME = 'tokens';
const DB_VERSION = 1;

/**
 * TokenCache provides local caching for resolved tokens.
 *
 * Uses IndexedDB for persistent storage with in-memory fallback.
 * Supports TTL-based expiration.
 *
 * @example
 * ```ts
 * const cache = new TokenCache();
 * await cache.init();
 *
 * // Store tokens
 * await cache.set("xbox-web-dark", tokens, 3600);
 *
 * // Retrieve tokens
 * const cached = await cache.get("xbox-web-dark");
 * if (cached && !cache.isExpired(cached)) {
 *   // Use cached tokens
 * }
 * ```
 */
export class TokenCache {
	private db: IDBDatabase | null = null;
	private memoryCache: Map<string, CacheEntry> = new Map();
	private useIndexedDB = true;

	/**
	 * Initialize the cache.
	 * Attempts to open IndexedDB, falls back to memory if unavailable.
	 */
	async init(): Promise<void> {
		if (typeof indexedDB === 'undefined') {
			this.useIndexedDB = false;
			return;
		}

		try {
			this.db = await this.openDatabase();
		} catch {
			// IndexedDB not available (e.g., private browsing)
			this.useIndexedDB = false;
		}
	}

	/**
	 * Get cached tokens for a node.
	 */
	async get(nodeId: string): Promise<CacheEntry | null> {
		if (this.useIndexedDB && this.db) {
			return this.getFromIndexedDB(nodeId);
		}
		return this.memoryCache.get(nodeId) ?? null;
	}

	/**
	 * Store tokens in cache.
	 */
	async set(nodeId: string, tokens: Token[], ttl: number): Promise<void> {
		const entry: CacheEntry = {
			tokens,
			cachedAt: Date.now(),
			ttl,
			nodeId,
		};

		if (this.useIndexedDB && this.db) {
			await this.setInIndexedDB(entry);
		} else {
			this.memoryCache.set(nodeId, entry);
		}
	}

	/**
	 * Check if a cache entry has expired.
	 */
	isExpired(entry: CacheEntry): boolean {
		const expiresAt = entry.cachedAt + entry.ttl * 1000;
		return Date.now() > expiresAt;
	}

	/**
	 * Delete cached tokens for a node.
	 */
	async delete(nodeId: string): Promise<void> {
		if (this.useIndexedDB && this.db) {
			await this.deleteFromIndexedDB(nodeId);
		} else {
			this.memoryCache.delete(nodeId);
		}
	}

	/**
	 * Clear all cached tokens.
	 */
	async clear(): Promise<void> {
		if (this.useIndexedDB && this.db) {
			await this.clearIndexedDB();
		} else {
			this.memoryCache.clear();
		}
	}

	/**
	 * Get all cached node IDs.
	 */
	async keys(): Promise<string[]> {
		if (this.useIndexedDB && this.db) {
			return this.getKeysFromIndexedDB();
		}
		return Array.from(this.memoryCache.keys());
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}

	// Private: IndexedDB operations

	private openDatabase(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'nodeId' });
				}
			};
		});
	}

	private getFromIndexedDB(nodeId: string): Promise<CacheEntry | null> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				resolve(null);
				return;
			}

			const transaction = this.db.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(nodeId);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result ?? null);
		});
	}

	private setInIndexedDB(entry: CacheEntry): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				reject(new Error('Database not initialized'));
				return;
			}

			const transaction = this.db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.put(entry);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	private deleteFromIndexedDB(nodeId: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				resolve();
				return;
			}

			const transaction = this.db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(nodeId);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	private clearIndexedDB(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				resolve();
				return;
			}

			const transaction = this.db.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	private getKeysFromIndexedDB(): Promise<string[]> {
		return new Promise((resolve, reject) => {
			if (!this.db) {
				resolve([]);
				return;
			}

			const transaction = this.db.transaction(STORE_NAME, 'readonly');
			const store = transaction.objectStore(STORE_NAME);
			const request = store.getAllKeys();

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result as string[]);
		});
	}
}
