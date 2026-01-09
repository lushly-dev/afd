/**
 * Task Store - SQLite-backed task storage
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Task, TaskStatus, Priority } from '../types.js';

export interface TaskCreateInput {
	title: string;
	description?: string;
	listId?: string;
	dueDate?: string;
	dueTime?: string;
	priority?: Priority;
	tags?: string[];
}

export interface TaskUpdateInput {
	title?: string;
	description?: string;
	listId?: string;
	dueDate?: string;
	dueTime?: string;
	priority?: Priority;
	tags?: string[];
}

export interface TaskListFilters {
	listId?: string;
	status?: TaskStatus | 'all';
	dueDate?: string;
	limit?: number;
}

export class TaskStore {
	private db: Database.Database;

	constructor(dbPath: string = ':memory:') {
		this.db = new Database(dbPath);
		this.init();
	}

	private init(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS tasks (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				description TEXT,
				status TEXT DEFAULT 'pending',
				completedAt TEXT,
				listId TEXT DEFAULT 'inbox',
				parentId TEXT,
				position INTEGER DEFAULT 0,
				dueDate TEXT,
				dueTime TEXT,
				priority INTEGER DEFAULT 0,
				tags TEXT DEFAULT '[]',
				createdAt TEXT NOT NULL,
				updatedAt TEXT NOT NULL
			)
		`);
	}

	create(input: TaskCreateInput): Task {
		const id = randomUUID();
		const now = new Date().toISOString();
		const position = this.getNextPosition(input.listId || 'inbox');

		const task: Task = {
			id,
			title: input.title,
			description: input.description,
			status: 'pending',
			listId: input.listId || 'inbox',
			position,
			dueDate: input.dueDate,
			dueTime: input.dueTime,
			priority: input.priority || 0,
			tags: input.tags || [],
			createdAt: now,
			updatedAt: now,
		};

		this.db
			.prepare(
				`
			INSERT INTO tasks (id, title, description, status, listId, position, dueDate, dueTime, priority, tags, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`
			)
			.run(
				task.id,
				task.title,
				task.description || null,
				task.status,
				task.listId,
				task.position,
				task.dueDate || null,
				task.dueTime || null,
				task.priority,
				JSON.stringify(task.tags),
				task.createdAt,
				task.updatedAt
			);

		return task;
	}

	list(filters: TaskListFilters = {}): Task[] {
		let sql = 'SELECT * FROM tasks WHERE 1=1';
		const params: unknown[] = [];

		if (filters.listId) {
			sql += ' AND listId = ?';
			params.push(filters.listId);
		}

		if (filters.status && filters.status !== 'all') {
			sql += ' AND status = ?';
			params.push(filters.status);
		}

		if (filters.dueDate) {
			sql += ' AND date(dueDate) = date(?)';
			params.push(filters.dueDate);
		}

		sql += ' ORDER BY position ASC';

		if (filters.limit) {
			sql += ' LIMIT ?';
			params.push(filters.limit);
		}

		const rows = this.db.prepare(sql).all(...params) as DbRow[];
		return rows.map(this.rowToTask);
	}

	get(id: string): Task | null {
		const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as DbRow | undefined;
		return row ? this.rowToTask(row) : null;
	}

	update(id: string, updates: TaskUpdateInput): Task {
		const task = this.get(id);
		if (!task) {
			throw new Error(`Task ${id} not found`);
		}

		const updatedTask: Task = {
			...task,
			...updates,
			updatedAt: new Date().toISOString(),
		};

		this.db
			.prepare(
				`
			UPDATE tasks SET
				title = ?, description = ?, status = ?, completedAt = ?,
				listId = ?, parentId = ?, position = ?,
				dueDate = ?, dueTime = ?, priority = ?, tags = ?, updatedAt = ?
			WHERE id = ?
		`
			)
			.run(
				updatedTask.title,
				updatedTask.description || null,
				updatedTask.status,
				updatedTask.completedAt || null,
				updatedTask.listId,
				updatedTask.parentId || null,
				updatedTask.position,
				updatedTask.dueDate || null,
				updatedTask.dueTime || null,
				updatedTask.priority,
				JSON.stringify(updatedTask.tags),
				updatedTask.updatedAt,
				id
			);

		return updatedTask;
	}

	complete(id: string): Task {
		return this.update(id, {});
	}

	uncomplete(id: string): Task {
		return this.update(id, {});
	}

	setStatus(id: string, status: TaskStatus): Task {
		const task = this.get(id);
		if (!task) {
			throw new Error(`Task ${id} not found`);
		}

		const completedAt = status === 'completed' ? new Date().toISOString() : undefined;

		this.db
			.prepare(
				`
			UPDATE tasks SET status = ?, completedAt = ?, updatedAt = ? WHERE id = ?
		`
			)
			.run(status, completedAt || null, new Date().toISOString(), id);

		return this.get(id)!;
	}

	delete(id: string): boolean {
		const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
		return result.changes > 0;
	}

	deleteByListId(listId: string): number {
		const result = this.db.prepare('DELETE FROM tasks WHERE listId = ?').run(listId);
		return result.changes;
	}

	moveToInbox(fromListId: string): void {
		this.db.prepare('UPDATE tasks SET listId = ? WHERE listId = ?').run('inbox', fromListId);
	}

	private getNextPosition(listId: string): number {
		const row = this.db
			.prepare('SELECT MAX(position) as maxPos FROM tasks WHERE listId = ?')
			.get(listId) as { maxPos: number | null } | undefined;
		return (row?.maxPos || 0) + 1;
	}

	private rowToTask(row: DbRow): Task {
		return {
			id: row.id,
			title: row.title,
			description: row.description || undefined,
			status: row.status as TaskStatus,
			completedAt: row.completedAt || undefined,
			listId: row.listId,
			parentId: row.parentId || undefined,
			position: row.position,
			dueDate: row.dueDate || undefined,
			dueTime: row.dueTime || undefined,
			priority: row.priority as Priority,
			tags: JSON.parse(row.tags || '[]'),
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

interface DbRow {
	id: string;
	title: string;
	description: string | null;
	status: string;
	completedAt: string | null;
	listId: string;
	parentId: string | null;
	position: number;
	dueDate: string | null;
	dueTime: string | null;
	priority: number;
	tags: string;
	createdAt: string;
	updatedAt: string;
}
