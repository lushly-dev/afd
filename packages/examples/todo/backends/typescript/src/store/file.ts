/**
 * @fileoverview File-based todo store with JSON persistence
 *
 * This store persists todos to a JSON file, allowing multiple server instances
 * (HTTP and stdio/MCP, or the TypeScript and Python backends) to share the same data.
 *
 * The default file, `packages/examples/todo/data/todos.json`, is gitignored. When it
 * is missing it is created from the committed seed, `data/todos.seed.json`. A custom
 * path starts empty unless a seed is passed explicitly.
 *
 * Environment variables:
 *   TODO_STORE_PATH - Path to the JSON file (default: data/todos.json)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChangeEntry, Priority, Stamp, Todo, TodoFilter, TodoStats } from '../types.js';
import { readHistoryFile, readTodoFile, writeJsonFile, writeTodoFile } from './json-file.js';
import { TodoStore } from './memory.js';

// From this file: store/ → src/ (or dist/) → typescript/ → backends/ → todo/
const EXAMPLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Default data file: gitignored, created from the seed on first run. */
export const DEFAULT_STORE_PATH = resolve(EXAMPLE_ROOT, 'data', 'todos.json');

/** Committed seed data copied into a missing default data file. */
export const DEFAULT_SEED_PATH = resolve(EXAMPLE_ROOT, 'data', 'todos.seed.json');

/**
 * Options for {@link FileStore}.
 */
export interface FileStoreOptions {
	/**
	 * JSON file whose todos initialize a missing data file. Defaults to
	 * {@link DEFAULT_SEED_PATH} for the default data file, and to none (start empty)
	 * for a custom path.
	 */
	seedPath?: string;
}

/** The deleted todos' file beside a todo file: `todos.json` → `todos.deleted.json`. */
export function deletedPathFor(filePath: string): string {
	return filePath.replace(/(\.json)?$/, '.deleted.json');
}

/** The change history's file beside a todo file: `todos.json` → `todos.history.json`. */
export function historyPathFor(filePath: string): string {
	return filePath.replace(/(\.json)?$/, '.history.json');
}

/**
 * File-based todo store with JSON persistence.
 *
 * The live todos stay in the main file, in the format the Python backend also reads. Deleted
 * todos and the change history are kept in their own files beside it
 * ({@link deletedPathFor}, {@link historyPathFor}), so a backend that knows nothing of them
 * never shows a deleted todo as live. Each operation loads the files, runs the in-memory
 * store's method on them and saves what changed.
 *
 * Each file's write is atomic (temp file + rename), but the three are separate writes, not one
 * transaction. The file a todo moves into is written first, so a crash between the writes leaves
 * it in both files rather than neither, and loading keeps the live copy of a todo found in both.
 * The move to `@lushly-dev/local-db`'s SQLite store (the to-do reference plan's D4) replaces this.
 * A file that cannot be parsed throws a `TodoStoreCorruptError` rather than being treated as
 * empty.
 */
export class FileStore {
	readonly filePath: string;
	readonly deletedPath: string;
	readonly historyPath: string;

	constructor(filePath?: string, options: FileStoreOptions = {}) {
		this.filePath = filePath ?? DEFAULT_STORE_PATH;
		this.deletedPath = deletedPathFor(this.filePath);
		this.historyPath = historyPathFor(this.filePath);
		const seedPath = options.seedPath ?? (filePath === undefined ? DEFAULT_SEED_PATH : undefined);

		mkdirSync(dirname(this.filePath), { recursive: true });

		if (!existsSync(this.filePath)) {
			const initial = seedPath && existsSync(seedPath) ? readTodoFile(seedPath) : new Map();
			writeTodoFile(this.filePath, initial);
		}

		// Fail at startup, not on the first command, when a file is unreadable.
		this.load();
	}

	/**
	 * Load every file into an in-memory store. A missing file is empty.
	 *
	 * @throws TodoStoreCorruptError when a file exists but cannot be parsed
	 */
	private load(): TodoStore {
		const todos = readOrEmpty(
			() => readTodoFile(this.filePath),
			() => new Map<string, Todo>()
		);
		const deleted = readOrEmpty(
			() => readTodoFile(this.deletedPath),
			() => new Map<string, Todo>()
		);
		// In both files only after a crash between the writes of a delete or restore: keep it live
		for (const id of todos.keys()) deleted.delete(id);
		return new TodoStore({
			todos,
			deleted,
			history: readOrEmpty(
				() => readHistoryFile(this.historyPath),
				() => []
			),
		});
	}

	/** Run a read against the files' current state. */
	private read<T>(operation: (store: TodoStore) => T): T {
		return operation(this.load());
	}

	/** Run a change against the files' current state, then save the state atomically. */
	private change<T>(operation: (store: TodoStore) => T): T {
		const store = this.load();
		const deletedBefore = new Set(store.snapshot().deleted.keys());
		const result = operation(store);
		const state = store.snapshot();
		// Write the file a todo moved into first (see the class comment)
		const intoDeleted = [...state.deleted.keys()].some((id) => !deletedBefore.has(id));
		if (intoDeleted) {
			writeTodoFile(this.deletedPath, state.deleted);
			writeTodoFile(this.filePath, state.todos);
		} else {
			writeTodoFile(this.filePath, state.todos);
			writeTodoFile(this.deletedPath, state.deleted);
		}
		writeJsonFile(this.historyPath, state.history);
		return result;
	}

	create(data: { title: string; description?: string; priority?: Priority }, stamp?: Stamp): Todo {
		return this.change((store) => store.create(data, stamp));
	}

	get(id: string): Todo | undefined {
		return this.read((store) => store.get(id));
	}

	getDeleted(id: string): Todo | undefined {
		return this.read((store) => store.getDeleted(id));
	}

	list(filter: TodoFilter = {}): Todo[] {
		return this.read((store) => store.list(filter));
	}

	update(id: string, data: Parameters<TodoStore['update']>[1], now?: string): Todo | undefined {
		return this.change((store) => store.update(id, data, now));
	}

	toggle(id: string, now?: string): Todo | undefined {
		return this.change((store) => store.toggle(id, now));
	}

	delete(id: string, now?: string): Todo | undefined {
		return this.change((store) => store.delete(id, now));
	}

	restore(id: string): Todo | undefined {
		return this.change((store) => store.restore(id));
	}

	clearCompleted(): { clearedIds: string[]; remaining: number } {
		return this.change((store) => store.clearCompleted());
	}

	clearDeleted(): { clearedIds: string[]; remaining: number } {
		return this.change((store) => store.clearDeleted());
	}

	clearAll(): { clearedIds: string[]; remaining: number } {
		return this.change((store) => store.clearAll());
	}

	getStats(): TodoStats {
		return this.read((store) => store.getStats());
	}

	record(change: Omit<ChangeEntry, 'seq'>): ChangeEntry {
		return this.change((store) => store.record(change));
	}

	history(): ChangeEntry[] {
		return this.read((store) => store.history());
	}

	/** Remove everything: live and deleted todos and the history (for tests). */
	clear(): void {
		this.change((store) => store.clear());
	}

	count(): number {
		return this.read((store) => store.count());
	}
}

/** A file's contents, or `empty()` when it does not exist (yet, or any more). */
function readOrEmpty<T>(read: () => T, empty: () => T): T {
	try {
		return read();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return empty();
		}
		throw error;
	}
}
