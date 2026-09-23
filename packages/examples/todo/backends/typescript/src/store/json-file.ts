/**
 * @fileoverview Safe reads and writes of the JSON todo file.
 *
 * - A file that cannot be parsed raises {@link TodoStoreCorruptError} instead of
 *   being treated as empty, so the next write cannot erase data that is merely
 *   unreadable.
 * - Writes go to a temporary file in the same directory that is then renamed over
 *   the data file, so readers never see a half-written file.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Todo } from '../types.js';

/**
 * The todo file exists but does not contain a list of todos.
 */
export class TodoStoreCorruptError extends Error {
	constructor(
		readonly filePath: string,
		reason: string
	) {
		super(
			`Todo store ${filePath} ${reason}. The file was left unchanged: fix it, or delete it to start from the seed data.`
		);
		this.name = 'TodoStoreCorruptError';
	}
}

function isTodo(value: unknown): value is Todo {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.id === 'string' && typeof candidate.title === 'string';
}

/**
 * Read todos from a JSON file: an array of todos, or the older `{ id: todo }` map.
 *
 * @throws NodeJS.ErrnoException with code `ENOENT` when the file does not exist
 * @throws TodoStoreCorruptError when the file is not valid JSON or not a list of todos
 */
export function readTodoFile(filePath: string): Map<string, Todo> {
	const text = readFileSync(filePath, 'utf-8');

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new TodoStoreCorruptError(filePath, `is not valid JSON (${reason})`);
	}

	let entries: unknown[];
	if (Array.isArray(parsed)) {
		entries = parsed;
	} else if (typeof parsed === 'object' && parsed !== null) {
		entries = Object.values(parsed);
	} else {
		throw new TodoStoreCorruptError(filePath, 'must contain a JSON array of todos');
	}

	const todos = new Map<string, Todo>();
	for (const [index, entry] of entries.entries()) {
		if (!isTodo(entry)) {
			throw new TodoStoreCorruptError(
				filePath,
				`has an invalid todo at index ${index} (expected string "id" and "title")`
			);
		}
		todos.set(entry.id, entry);
	}
	return todos;
}

/**
 * Write todos atomically: write a temporary sibling file, then rename it over `filePath`.
 */
export function writeTodoFile(filePath: string, todos: Map<string, Todo>): void {
	const tempPath = join(
		dirname(filePath),
		`.${basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
	);
	try {
		writeFileSync(tempPath, `${JSON.stringify(Array.from(todos.values()), null, 2)}\n`, 'utf-8');
		renameSync(tempPath, filePath);
	} catch (error) {
		rmSync(tempPath, { force: true });
		throw error;
	}
}
