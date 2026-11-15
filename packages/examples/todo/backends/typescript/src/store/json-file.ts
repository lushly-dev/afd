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
import type { ChangeEntry, Todo } from '../types.js';

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
 * Write a value as JSON atomically: write a temporary sibling file, then rename it over
 * `filePath`, so a reader never sees a half-written file.
 */
export function writeJsonFile(filePath: string, value: unknown): void {
	const tempPath = join(
		dirname(filePath),
		`.${basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
	);
	try {
		writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
		renameSync(tempPath, filePath);
	} catch (error) {
		rmSync(tempPath, { force: true });
		throw error;
	}
}

/**
 * Write todos atomically, as a JSON array.
 */
export function writeTodoFile(filePath: string, todos: Map<string, Todo>): void {
	writeJsonFile(filePath, Array.from(todos.values()));
}

function isChange(value: unknown): value is ChangeEntry {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.seq === 'number' &&
		typeof candidate.command === 'string' &&
		Array.isArray(candidate.ids)
	);
}

/**
 * Read the change history, a JSON array of changes, oldest first.
 *
 * @throws NodeJS.ErrnoException with code `ENOENT` when the file does not exist
 * @throws TodoStoreCorruptError when the file is not valid JSON or not a list of changes
 */
export function readHistoryFile(filePath: string): ChangeEntry[] {
	const text = readFileSync(filePath, 'utf-8');
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new TodoStoreCorruptError(filePath, `is not valid JSON (${reason})`);
	}
	if (!Array.isArray(parsed)) {
		throw new TodoStoreCorruptError(filePath, 'must contain a JSON array of changes');
	}
	for (const [index, entry] of parsed.entries()) {
		if (!isChange(entry)) {
			throw new TodoStoreCorruptError(
				filePath,
				`has an invalid change at index ${index} (expected number "seq", string "command" and array "ids")`
			);
		}
	}
	return parsed;
}
