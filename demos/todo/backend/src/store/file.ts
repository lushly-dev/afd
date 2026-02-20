/**
 * @fileoverview File-based todo store with JSON persistence
 *
 * This store persists todos to a JSON file, allowing multiple server instances
 * (HTTP and stdio/MCP) to share the same data.
 *
 * Environment variables:
 *   TODO_STORE_PATH - Path to the JSON file (default: ./data/todos.json)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
	List,
	ListFilter,
	Note,
	NoteFilter,
	NoteFolder,
	NoteFolderFilter,
	Priority,
	Todo,
	TodoFilter,
	TodoStats,
} from '../types.js';

// Get the directory of this file for consistent path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Generate a unique ID.
 */
function generateId(prefix: string = 'todo'): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current ISO timestamp.
 */
function now(): string {
	return new Date().toISOString();
}

/**
 * File-based todo store with JSON persistence.
 */
export class FileStore {
	private filePath: string;
	private listsFilePath: string;
	private notesFilePath: string;
	private noteFoldersFilePath: string;

	constructor(filePath?: string) {
		// Default path: packages/examples/todo/data/todos.json
		// From this file: store/file.ts → src/ → typescript/ → backends/ → todo/ → data/
		this.filePath = filePath ?? resolve(__dirname, '..', '..', '..', '..', 'data', 'todos.json');
		this.listsFilePath = filePath
			? filePath.replace(/\.json$/, '-lists.json')
			: resolve(__dirname, '..', '..', '..', '..', 'data', 'lists.json');
		this.notesFilePath = filePath
			? filePath.replace(/\.json$/, '-notes.json')
			: resolve(__dirname, '..', '..', '..', '..', 'data', 'notes.json');
		this.noteFoldersFilePath = filePath
			? filePath.replace(/\.json$/, '-notefolders.json')
			: resolve(__dirname, '..', '..', '..', '..', 'data', 'notefolders.json');

		// Ensure the directory exists
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		// Initialize empty files if they don't exist
		if (!existsSync(this.filePath)) {
			this.saveTodos(new Map());
		}
		if (!existsSync(this.listsFilePath)) {
			this.saveLists(new Map());
		}
		if (!existsSync(this.notesFilePath)) {
			this.saveNotes(new Map());
		}
		if (!existsSync(this.noteFoldersFilePath)) {
			this.saveNoteFolders(new Map());
		}
	}

	/**
	 * Load todos from file.
	 */
	private loadTodos(): Map<string, Todo> {
		try {
			const data = readFileSync(this.filePath, 'utf-8');
			const parsed = JSON.parse(data);

			// Handle both array format and object format
			if (Array.isArray(parsed)) {
				const map = new Map<string, Todo>();
				for (const todo of parsed) {
					map.set(todo.id, todo);
				}
				return map;
			}

			// Object format: { "id": todo }
			return new Map(Object.entries(parsed));
		} catch {
			return new Map();
		}
	}

	/**
	 * Save todos to file.
	 */
	private saveTodos(todos: Map<string, Todo>): void {
		// Save as array for better readability
		const data = Array.from(todos.values());
		writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	/**
	 * Create a new todo.
	 */
	create(data: {
		title: string;
		description?: string;
		priority?: Priority;
		dueDate?: string;
		parentId?: string;
	}): Todo {
		const todos = this.loadTodos();

		const todo: Todo = {
			id: generateId(),
			title: data.title,
			description: data.description,
			priority: data.priority ?? 2,
			completed: false,
			dueDate: data.dueDate,
			parentId: data.parentId,
			createdAt: now(),
			updatedAt: now(),
		};

		todos.set(todo.id, todo);
		this.saveTodos(todos);
		return todo;
	}

	/**
	 * Get a todo by ID.
	 */
	get(id: string): Todo | undefined {
		const todos = this.loadTodos();
		return todos.get(id);
	}

	/**
	 * List todos with optional filtering.
	 */
	list(filter: TodoFilter = {}): Todo[] {
		const todos = this.loadTodos();
		let results = Array.from(todos.values());

		// Filter by completion status
		if (filter.completed !== undefined) {
			results = results.filter((t) => t.completed === filter.completed);
		}

		// Filter by priority
		if (filter.priority) {
			results = results.filter((t) => t.priority === filter.priority);
		}

		// Search in title/description
		if (filter.search) {
			const search = filter.search.toLowerCase();
			results = results.filter(
				(t) =>
					t.title.toLowerCase().includes(search) || t.description?.toLowerCase().includes(search)
			);
		}

		// Filter by due date - before
		if (filter.dueBefore) {
			const beforeDate = new Date(filter.dueBefore);
			results = results.filter((t) => t.dueDate && new Date(t.dueDate) < beforeDate);
		}

		// Filter by due date - after
		if (filter.dueAfter) {
			const afterDate = new Date(filter.dueAfter);
			results = results.filter((t) => t.dueDate && new Date(t.dueDate) > afterDate);
		}

		// Filter by overdue status
		if (filter.overdue !== undefined) {
			const currentTime = new Date();
			if (filter.overdue) {
				results = results.filter(
					(t) => t.dueDate && !t.completed && new Date(t.dueDate) < currentTime
				);
			} else {
				results = results.filter(
					(t) => !t.dueDate || t.completed || new Date(t.dueDate) >= currentTime
				);
			}
		}

		// Filter by parent ID
		if (filter.parentId !== undefined) {
			if (filter.parentId === null) {
				// Root-level todos only (no parent)
				results = results.filter((t) => !t.parentId);
			} else {
				// Subtasks of a specific parent
				results = results.filter((t) => t.parentId === filter.parentId);
			}
		}

		// Sort
		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';

		results.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'priority':
					comparison = a.priority - b.priority;
					break;
				case 'title':
					comparison = a.title.localeCompare(b.title);
					break;
				case 'updatedAt':
					comparison = a.updatedAt.localeCompare(b.updatedAt);
					break;
				default:
					comparison = a.createdAt.localeCompare(b.createdAt);
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		// Pagination
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? 100;
		results = results.slice(offset, offset + limit);

		return results;
	}

	/**
	 * Update a todo.
	 */
	update(
		id: string,
		data: Partial<Pick<Todo, 'title' | 'description' | 'priority' | 'completed'>> & {
			dueDate?: string | null;
			parentId?: string | null;
		}
	): Todo | undefined {
		const todos = this.loadTodos();
		const todo = todos.get(id);
		if (!todo) {
			return undefined;
		}

		// Filter out undefined values to avoid overwriting existing properties
		const filteredData: Partial<
			Pick<Todo, 'title' | 'description' | 'priority' | 'completed' | 'dueDate' | 'parentId'>
		> = {};
		if (data.title !== undefined) filteredData.title = data.title;
		if (data.description !== undefined) filteredData.description = data.description;
		if (data.priority !== undefined) filteredData.priority = data.priority;
		if (data.completed !== undefined) filteredData.completed = data.completed;
		// Handle dueDate: null clears it, undefined leaves it unchanged
		if (data.dueDate !== undefined) {
			filteredData.dueDate = data.dueDate === null ? undefined : data.dueDate;
		}
		// Handle parentId: null promotes to root level, undefined leaves it unchanged
		if (data.parentId !== undefined) {
			filteredData.parentId = data.parentId === null ? undefined : data.parentId;
		}

		const updated: Todo = {
			...todo,
			...filteredData,
			updatedAt: now(),
		};

		// Handle completedAt timestamp
		if (data.completed !== undefined) {
			if (data.completed && !todo.completed) {
				updated.completedAt = now();
			} else if (!data.completed && todo.completed) {
				updated.completedAt = undefined;
			}
		}

		todos.set(id, updated);
		this.saveTodos(todos);
		return updated;
	}

	/**
	 * Toggle todo completion status.
	 */
	toggle(id: string): Todo | undefined {
		const todos = this.loadTodos();
		const todo = todos.get(id);
		if (!todo) {
			return undefined;
		}

		const completed = !todo.completed;
		const updated: Todo = {
			...todo,
			completed,
			completedAt: completed ? now() : undefined,
			updatedAt: now(),
		};

		todos.set(id, updated);
		this.saveTodos(todos);
		return updated;
	}

	/**
	 * Delete a todo.
	 */
	delete(id: string): boolean {
		const todos = this.loadTodos();
		const existed = todos.delete(id);
		if (existed) {
			this.saveTodos(todos);
		}
		return existed;
	}

	/**
	 * Clear completed todos.
	 */
	clearCompleted(): { cleared: number; remaining: number } {
		const todos = this.loadTodos();
		let cleared = 0;
		for (const [id, todo] of todos) {
			if (todo.completed) {
				todos.delete(id);
				cleared++;
			}
		}
		this.saveTodos(todos);
		return { cleared, remaining: todos.size };
	}

	/**
	 * Get todo statistics.
	 */
	getStats(): TodoStats {
		const todos = this.loadTodos();
		const allTodos = Array.from(todos.values());
		const completed = allTodos.filter((t) => t.completed).length;
		const pending = allTodos.length - completed;
		const currentTime = new Date();
		const overdue = allTodos.filter(
			(t) => t.dueDate && !t.completed && new Date(t.dueDate) < currentTime
		).length;

		return {
			total: allTodos.length,
			completed,
			pending,
			overdue,
			byPriority: {
				0: allTodos.filter((t) => t.priority === 0).length,
				1: allTodos.filter((t) => t.priority === 1).length,
				2: allTodos.filter((t) => t.priority === 2).length,
				3: allTodos.filter((t) => t.priority === 3).length,
			},
			completionRate: allTodos.length > 0 ? completed / allTodos.length : 0,
		};
	}

	/**
	 * Clear all todos, lists, notes, and note folders (for testing).
	 */
	clear(): void {
		this.saveTodos(new Map());
		this.saveLists(new Map());
		this.saveNotes(new Map());
		this.saveNoteFolders(new Map());
	}

	/**
	 * Get count of todos.
	 */
	count(): number {
		return this.loadTodos().size;
	}

	/**
	 * Get all subtasks of a todo (direct children only).
	 */
	getSubtasks(parentId: string): Todo[] {
		const todos = this.loadTodos();
		return Array.from(todos.values()).filter((t) => t.parentId === parentId);
	}

	/**
	 * Get all descendants of a todo (subtasks, their subtasks, etc.).
	 */
	getDescendants(parentId: string): Todo[] {
		const todos = this.loadTodos();
		const descendants: Todo[] = [];
		const stack = [parentId];

		while (stack.length > 0) {
			const currentId = stack.pop();
			if (!currentId) break;
			const children = Array.from(todos.values()).filter((t) => t.parentId === currentId);
			for (const child of children) {
				descendants.push(child);
				stack.push(child.id);
			}
		}

		return descendants;
	}

	/**
	 * Check if moving a todo to a new parent would create a circular reference.
	 */
	wouldCreateCycle(todoId: string, newParentId: string): boolean {
		// Check if the new parent is the todo itself
		if (todoId === newParentId) {
			return true;
		}

		// Check if the new parent is a descendant of the todo
		const descendants = this.getDescendants(todoId);
		return descendants.some((d) => d.id === newParentId);
	}

	/**
	 * Delete a todo and optionally its subtasks.
	 * @param id Todo ID to delete
	 * @param cascade If true, delete all subtasks recursively
	 * @returns Object with deleted count and IDs
	 */
	deleteWithSubtasks(id: string, cascade: boolean = false): { deleted: number; ids: string[] } {
		const todos = this.loadTodos();
		const todo = todos.get(id);
		if (!todo) {
			return { deleted: 0, ids: [] };
		}

		const deletedIds: string[] = [id];

		if (cascade) {
			// Get all descendants and delete them
			const descendants = this.getDescendants(id);
			for (const descendant of descendants) {
				todos.delete(descendant.id);
				deletedIds.push(descendant.id);
			}
		} else {
			// Promote subtasks to the deleted todo's parent (or root level)
			const subtasks = this.getSubtasks(id);
			for (const subtask of subtasks) {
				const updated = { ...subtask, parentId: todo.parentId, updatedAt: now() };
				todos.set(subtask.id, updated);
			}
		}

		todos.delete(id);
		this.saveTodos(todos);
		return { deleted: deletedIds.length, ids: deletedIds };
	}

	// ==================== List Methods ====================

	/**
	 * Load lists from file.
	 */
	private loadLists(): Map<string, List> {
		try {
			const data = readFileSync(this.listsFilePath, 'utf-8');
			const parsed = JSON.parse(data);

			// Handle both array format and object format
			if (Array.isArray(parsed)) {
				const map = new Map<string, List>();
				for (const list of parsed) {
					map.set(list.id, list);
				}
				return map;
			}

			// Object format: { "id": list }
			return new Map(Object.entries(parsed));
		} catch {
			return new Map();
		}
	}

	/**
	 * Save lists to file.
	 */
	private saveLists(lists: Map<string, List>): void {
		// Save as array for better readability
		const data = Array.from(lists.values());
		writeFileSync(this.listsFilePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	/**
	 * Create a new list.
	 */
	createList(data: { name: string; description?: string; todoIds?: string[] }): List {
		const lists = this.loadLists();

		const list: List = {
			id: generateId('list'),
			name: data.name,
			description: data.description,
			todoIds: data.todoIds ?? [],
			createdAt: now(),
			updatedAt: now(),
		};

		lists.set(list.id, list);
		this.saveLists(lists);
		return list;
	}

	/**
	 * Get a list by ID.
	 */
	getList(id: string): List | undefined {
		const lists = this.loadLists();
		return lists.get(id);
	}

	/**
	 * List all lists with optional filtering.
	 */
	listLists(filter: ListFilter = {}): List[] {
		const lists = this.loadLists();
		let results = Array.from(lists.values());

		// Search in name/description
		if (filter.search) {
			const search = filter.search.toLowerCase();
			results = results.filter(
				(l) =>
					l.name.toLowerCase().includes(search) || l.description?.toLowerCase().includes(search)
			);
		}

		// Sort
		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';

		results.sort((a, b) => {
			let comparison = 0;

			switch (sortBy) {
				case 'name':
					comparison = a.name.localeCompare(b.name);
					break;
				case 'updatedAt':
					comparison = a.updatedAt.localeCompare(b.updatedAt);
					break;
				default:
					comparison = a.createdAt.localeCompare(b.createdAt);
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});

		// Pagination
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? 100;
		results = results.slice(offset, offset + limit);

		return results;
	}

	/**
	 * Update a list.
	 */
	updateList(
		id: string,
		data: Partial<Pick<List, 'name' | 'description' | 'todoIds'>>
	): List | undefined {
		const lists = this.loadLists();
		const list = lists.get(id);
		if (!list) {
			return undefined;
		}

		// Filter out undefined values
		const filteredData: Partial<Pick<List, 'name' | 'description' | 'todoIds'>> = {};
		if (data.name !== undefined) filteredData.name = data.name;
		if (data.description !== undefined) filteredData.description = data.description;
		if (data.todoIds !== undefined) filteredData.todoIds = data.todoIds;

		const updated: List = {
			...list,
			...filteredData,
			updatedAt: now(),
		};

		lists.set(id, updated);
		this.saveLists(lists);
		return updated;
	}

	/**
	 * Delete a list.
	 */
	deleteList(id: string): boolean {
		const lists = this.loadLists();
		const existed = lists.delete(id);
		if (existed) {
			this.saveLists(lists);
		}
		return existed;
	}

	/**
	 * Get count of lists.
	 */
	countLists(): number {
		return this.loadLists().size;
	}

	/**
	 * Clear all lists (for testing).
	 */
	clearLists(): void {
		this.saveLists(new Map());
	}

	// ==================== Note Methods ====================

	private loadNotes(): Map<string, Note> {
		try {
			const data = readFileSync(this.notesFilePath, 'utf-8');
			const parsed = JSON.parse(data);
			if (Array.isArray(parsed)) {
				const map = new Map<string, Note>();
				for (const note of parsed) {
					map.set(note.id, note);
				}
				return map;
			}
			return new Map(Object.entries(parsed));
		} catch {
			return new Map();
		}
	}

	private saveNotes(notes: Map<string, Note>): void {
		const data = Array.from(notes.values());
		writeFileSync(this.notesFilePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	createNote(data: { title: string; content: string; folderId?: string }): Note {
		const notes = this.loadNotes();
		const note: Note = {
			id: generateId('note'),
			title: data.title,
			content: data.content,
			folderId: data.folderId,
			createdAt: now(),
			updatedAt: now(),
		};
		notes.set(note.id, note);
		this.saveNotes(notes);
		return note;
	}

	getNote(id: string): Note | undefined {
		return this.loadNotes().get(id);
	}

	listNotes(filter: NoteFilter = {}): Note[] {
		const notes = this.loadNotes();
		let results = Array.from(notes.values());
		if (filter.search) {
			const search = filter.search.toLowerCase();
			results = results.filter(
				(n) => n.title.toLowerCase().includes(search) || n.content.toLowerCase().includes(search)
			);
		}
		if (filter.folderId !== undefined) {
			if (filter.folderId === null) {
				results = results.filter((n) => !n.folderId);
			} else {
				results = results.filter((n) => n.folderId === filter.folderId);
			}
		}
		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';
		results.sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'title':
					cmp = a.title.localeCompare(b.title);
					break;
				case 'updatedAt':
					cmp = a.updatedAt.localeCompare(b.updatedAt);
					break;
				default:
					cmp = a.createdAt.localeCompare(b.createdAt);
			}
			return sortOrder === 'asc' ? cmp : -cmp;
		});
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? 100;
		return results.slice(offset, offset + limit);
	}

	updateNote(
		id: string,
		data: Partial<Pick<Note, 'title' | 'content'>> & { folderId?: string | null }
	): Note | undefined {
		const notes = this.loadNotes();
		const note = notes.get(id);
		if (!note) return undefined;
		const filtered: Partial<Pick<Note, 'title' | 'content' | 'folderId'>> = {};
		if (data.title !== undefined) filtered.title = data.title;
		if (data.content !== undefined) filtered.content = data.content;
		if (data.folderId !== undefined)
			filtered.folderId = data.folderId === null ? undefined : data.folderId;
		const updated: Note = { ...note, ...filtered, updatedAt: now() };
		notes.set(id, updated);
		this.saveNotes(notes);
		return updated;
	}

	deleteNote(id: string): boolean {
		const notes = this.loadNotes();
		const existed = notes.delete(id);
		if (existed) this.saveNotes(notes);
		return existed;
	}

	countNotes(): number {
		return this.loadNotes().size;
	}
	clearNotes(): void {
		this.saveNotes(new Map());
	}
	getNotesInFolder(folderId: string): Note[] {
		return Array.from(this.loadNotes().values()).filter((n) => n.folderId === folderId);
	}

	// ==================== NoteFolder Methods ====================

	private loadNoteFolders(): Map<string, NoteFolder> {
		try {
			const data = readFileSync(this.noteFoldersFilePath, 'utf-8');
			const parsed = JSON.parse(data);
			if (Array.isArray(parsed)) {
				const map = new Map<string, NoteFolder>();
				for (const folder of parsed) {
					map.set(folder.id, folder);
				}
				return map;
			}
			return new Map(Object.entries(parsed));
		} catch {
			return new Map();
		}
	}

	private saveNoteFolders(folders: Map<string, NoteFolder>): void {
		const data = Array.from(folders.values());
		writeFileSync(this.noteFoldersFilePath, JSON.stringify(data, null, 2), 'utf-8');
	}

	createNoteFolder(data: { name: string; description?: string }): NoteFolder {
		const folders = this.loadNoteFolders();
		const folder: NoteFolder = {
			id: generateId('folder'),
			name: data.name,
			description: data.description,
			createdAt: now(),
			updatedAt: now(),
		};
		folders.set(folder.id, folder);
		this.saveNoteFolders(folders);
		return folder;
	}

	getNoteFolder(id: string): NoteFolder | undefined {
		return this.loadNoteFolders().get(id);
	}

	listNoteFolders(filter: NoteFolderFilter = {}): NoteFolder[] {
		const folders = this.loadNoteFolders();
		let results = Array.from(folders.values());
		if (filter.search) {
			const search = filter.search.toLowerCase();
			results = results.filter(
				(f) =>
					f.name.toLowerCase().includes(search) || f.description?.toLowerCase().includes(search)
			);
		}
		const sortBy = filter.sortBy ?? 'createdAt';
		const sortOrder = filter.sortOrder ?? 'desc';
		results.sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'name':
					cmp = a.name.localeCompare(b.name);
					break;
				case 'updatedAt':
					cmp = a.updatedAt.localeCompare(b.updatedAt);
					break;
				default:
					cmp = a.createdAt.localeCompare(b.createdAt);
			}
			return sortOrder === 'asc' ? cmp : -cmp;
		});
		const offset = filter.offset ?? 0;
		const limit = filter.limit ?? 100;
		return results.slice(offset, offset + limit);
	}

	updateNoteFolder(
		id: string,
		data: Partial<Pick<NoteFolder, 'name' | 'description'>>
	): NoteFolder | undefined {
		const folders = this.loadNoteFolders();
		const folder = folders.get(id);
		if (!folder) return undefined;
		const filtered: Partial<Pick<NoteFolder, 'name' | 'description'>> = {};
		if (data.name !== undefined) filtered.name = data.name;
		if (data.description !== undefined) filtered.description = data.description;
		const updated: NoteFolder = { ...folder, ...filtered, updatedAt: now() };
		folders.set(id, updated);
		this.saveNoteFolders(folders);
		return updated;
	}

	deleteNoteFolder(id: string): boolean {
		const folders = this.loadNoteFolders();
		const existed = folders.delete(id);
		if (existed) this.saveNoteFolders(folders);
		return existed;
	}

	countNoteFolders(): number {
		return this.loadNoteFolders().size;
	}
	clearNoteFolders(): void {
		this.saveNoteFolders(new Map());
	}
}
