/**
 * @fileoverview Store factory - selects the appropriate store based on configuration
 *
 * Environment variables:
 *   TODO_STORE_TYPE - "memory" or "file" (default: "file")
 *   TODO_STORE_PATH - Path to the JSON file (default: data/todos.json, which is
 *                     gitignored and created from data/todos.seed.json)
 *
 * The default is "file" to enable MCP (stdio) and HTTP servers to share data.
 * Use "memory" for testing or isolated instances.
 */

import { FileStore } from './file.js';
import { TodoStore } from './memory.js';

// Store type from environment (default: file for shared storage)
const STORE_TYPE = process.env.TODO_STORE_TYPE ?? 'file';
const STORE_PATH = process.env.TODO_STORE_PATH || undefined;

/**
 * Store interface - common API for both memory and file stores.
 */
export type Store = TodoStore | FileStore;

/**
 * Create a store instance based on environment configuration.
 *
 * @returns A TodoStore (memory) or FileStore (file) instance
 */
export function createStore(): Store {
	if (STORE_TYPE === 'memory') {
		console.error('[Store] Using in-memory storage (isolated per process)');
		return new TodoStore();
	}

	const store = new FileStore(STORE_PATH);
	console.error(`[Store] Using file storage at ${store.filePath} (shared across processes)`);
	return store;
}

/**
 * The store every command uses, chosen at startup.
 *
 * This ensures all commands within a single process share the same store.
 * For file-based storage, multiple processes will share the same JSON file.
 */
export let store: Store = createStore();

/**
 * Replace the store the commands use, for a replay or a test that needs a fresh one. Commands
 * read the `store` binding on each call, so the change applies to every command at once.
 */
export function setStore(next: Store): void {
	store = next;
}

export { FileStore } from './file.js';
export { TodoStoreCorruptError } from './json-file.js';
// Re-export types for convenience
export { TodoStore } from './memory.js';
