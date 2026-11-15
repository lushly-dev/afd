/**
 * @fileoverview Store factory - selects the appropriate store based on configuration
 *
 * Environment variables:
 *   TODO_STORE_TYPE - "memory" or "file" (default: "file")
 *   TODO_STORE_PATH - Path to the JSON file (default: data/todos.json, which is
 *                     gitignored and created from data/todos.seed.json)
 *
 * The server (`server.ts`) chooses its store at startup with `setStore(createStore())`; the default
 * there is "file", so MCP (stdio) and HTTP servers share data. Importing this module touches no
 * file: until a store is set, commands use an empty in-memory one, which is what tests and the
 * replay module (`registry.ts`) want.
 */

import { FileStore } from './file.js';
import { TodoStore } from './memory.js';

/**
 * Store interface - common API for both memory and file stores.
 */
export type Store = TodoStore | FileStore;

/**
 * Create the store `TODO_STORE_TYPE` and `TODO_STORE_PATH` select (default: the shared file).
 *
 * @returns A TodoStore (memory) or FileStore (file) instance
 */
export function createStore(env: NodeJS.ProcessEnv = process.env): Store {
	if ((env.TODO_STORE_TYPE ?? 'file') === 'memory') {
		console.error('[Store] Using in-memory storage (isolated per process)');
		return new TodoStore();
	}

	const store = new FileStore(env.TODO_STORE_PATH || undefined);
	console.error(`[Store] Using file storage at ${store.filePath} (shared across processes)`);
	return store;
}

/**
 * The store every command uses. The server sets it at startup; until then it is an empty
 * in-memory store.
 *
 * This ensures all commands within a single process share the same store.
 * For file-based storage, multiple processes will share the same JSON file.
 */
export let store: Store = new TodoStore();

/**
 * Replace the store the commands use: the server's choice at startup, or a fresh one for a
 * replay or a test. Commands read the `store` binding on each call, so the change applies to
 * every command in the process at once, including any server already running in it.
 */
export function setStore(next: Store): void {
	store = next;
}

export { FileStore } from './file.js';
export { TodoStoreCorruptError } from './json-file.js';
// Re-export types for convenience
export { TodoStore } from './memory.js';
