/**
 * @fileoverview Store factory - selects the appropriate store based on configuration
 *
 * Environment variables:
 *   TODO_STORE_TYPE - "sqlite", "file" or "memory" (default: "sqlite")
 *   TODO_STORE_PATH - Path to the SQLite database (default: data/todos.db) or to the JSON file
 *                     (default: data/todos.json). Both defaults are gitignored and start from
 *                     data/todos.seed.json; a custom path starts empty.
 *
 * The server (`server.ts`) chooses its store at startup with `setStore(createStore())`; the default
 * there is the SQLite database, which the Python backend opens too (the to-do reference plan's
 * D4), so MCP (stdio) and HTTP servers, in either language, share data. Importing this module
 * touches no file: until a store is set, commands use an empty in-memory one, which is what tests
 * and the replay module (`registry.ts`) want.
 */

import { DEFAULT_SEED_PATH, DEFAULT_STORE_PATH, FileStore } from './file.js';
import { TodoStore } from './memory.js';
import { SqliteStore } from './sqlite.js';

/**
 * Store interface - common API for both memory and file stores.
 */
export type Store = TodoStore | FileStore | SqliteStore;

/**
 * The SQLite database beside the JSON file: `data/todos.db`, gitignored. The Python backend
 * resolves the same file (`todo_backend/store/__init__.py`).
 */
export const DEFAULT_SQLITE_PATH = DEFAULT_STORE_PATH.replace(/\.json$/, '.db');

/**
 * Create the store `TODO_STORE_TYPE` and `TODO_STORE_PATH` select (default: the shared SQLite
 * database).
 *
 * @returns A SqliteStore (sqlite), FileStore (file) or TodoStore (memory)
 */
export function createStore(env: NodeJS.ProcessEnv = process.env): Store {
	const type = env.TODO_STORE_TYPE ?? 'sqlite';
	if (type === 'memory') {
		console.error('[Store] Using in-memory storage (isolated per process)');
		return new TodoStore();
	}
	if (type === 'sqlite') {
		const sqlite = env.TODO_STORE_PATH
			? new SqliteStore(env.TODO_STORE_PATH)
			: new SqliteStore(DEFAULT_SQLITE_PATH, { seedPath: DEFAULT_SEED_PATH });
		console.error(`[Store] Using SQLite storage at ${sqlite.path} (shared across processes)`);
		return sqlite;
	}
	if (type !== 'file') {
		throw new Error(`TODO_STORE_TYPE must be memory, file or sqlite, not "${type}"`);
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
export { SqliteStore } from './sqlite.js';
