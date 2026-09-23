/**
 * @fileoverview Tests for the JSON file store: seeding, atomic writes and corrupt files.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SEED_PATH, FileStore } from './file.js';
import { TodoStoreCorruptError } from './json-file.js';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'todo-file-store-'));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe('FileStore', () => {
	it('starts empty when a custom path is missing', () => {
		const path = join(dir, 'nested', 'todos.json');
		const store = new FileStore(path);

		expect(store.count()).toBe(0);
		expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual([]);
	});

	it('creates a missing file from the seed', () => {
		const path = join(dir, 'todos.json');
		const store = new FileStore(path, { seedPath: DEFAULT_SEED_PATH });
		const seed = JSON.parse(readFileSync(DEFAULT_SEED_PATH, 'utf-8'));

		expect(seed.length).toBeGreaterThan(0);
		expect(store.count()).toBe(seed.length);
		expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(seed);
	});

	it('leaves an existing file alone instead of reseeding it', () => {
		const path = join(dir, 'todos.json');
		writeFileSync(path, '[]');

		expect(new FileStore(path, { seedPath: DEFAULT_SEED_PATH }).count()).toBe(0);
	});

	it('persists changes across instances without leaving temp files', () => {
		const path = join(dir, 'todos.json');
		const created = new FileStore(path).create({ title: 'Persisted', priority: 'high' });

		const reopened = new FileStore(path);
		expect(reopened.get(created.id)?.title).toBe('Persisted');
		expect(readdirSync(dir)).toEqual(['todos.json']);
	});

	it('reads the older { id: todo } object format', () => {
		const path = join(dir, 'todos.json');
		const todo = {
			id: 'todo-1',
			title: 'Legacy',
			priority: 'low',
			completed: false,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		writeFileSync(path, JSON.stringify({ 'todo-1': todo }));

		expect(new FileStore(path).get('todo-1')).toEqual(todo);
	});

	it('refuses to start on a corrupt file and leaves it unchanged', () => {
		const path = join(dir, 'todos.json');
		writeFileSync(path, '[{"id": "todo-1", "title": "trunc');

		expect(() => new FileStore(path)).toThrow(TodoStoreCorruptError);
		expect(readFileSync(path, 'utf-8')).toBe('[{"id": "todo-1", "title": "trunc');
	});

	it('rejects entries that are not todos', () => {
		const path = join(dir, 'todos.json');
		writeFileSync(path, '[{"title": "no id"}]');

		expect(() => new FileStore(path)).toThrow(/invalid todo at index 0/);
	});

	it('does not erase data when the file is corrupted while running', () => {
		const path = join(dir, 'todos.json');
		const store = new FileStore(path);
		store.create({ title: 'Keep me' });
		writeFileSync(path, 'not json');

		expect(() => store.create({ title: 'Overwrite?' })).toThrow(TodoStoreCorruptError);
		expect(readFileSync(path, 'utf-8')).toBe('not json');
	});

	it('recreates an empty store when the file is deleted while running', () => {
		const path = join(dir, 'todos.json');
		const store = new FileStore(path);
		store.create({ title: 'Gone' });
		rmSync(path);

		expect(store.count()).toBe(0);
		store.create({ title: 'Fresh' });
		expect(new FileStore(path).count()).toBe(1);
	});
});
