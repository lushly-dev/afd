const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, 'packages/examples/todo/backends/typescript/src/commands');

const noteCreate = `/**
 * @fileoverview note-create command
 */

import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Note } from '../types.js';

const inputSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
	content: z.string().max(50000).default(''),
	folderId: z.string().optional(),
});

export const createNote = defineCommand<typeof inputSchema, Note>({
	name: 'note-create',
	description: 'Create a new note',
	category: 'note',
	tags: ['note', 'create', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['VALIDATION_ERROR', 'FOLDER_NOT_FOUND'],

	async handler(input) {
		if (input.folderId) {
			const folder = store.getNoteFolder(input.folderId);
			if (!folder) {
				return { success: false, error: { code: 'FOLDER_NOT_FOUND', message: 'Folder not found: ' + input.folderId, suggestion: 'Create the folder first or omit folderId' } };
			}
		}
		const note = store.createNote({ title: input.title, content: input.content, folderId: input.folderId });
		return success(note, { reasoning: 'Created note "' + note.title + '"', confidence: 1.0 });
	},
});
`;

const noteGet = `/**
 * @fileoverview note-get command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Note } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Note ID is required'),
});

export const getNote = defineCommand<typeof inputSchema, Note>({
	name: 'note-get',
	description: 'Get a note by ID',
	category: 'note',
	tags: ['note', 'get', 'read', 'single'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const note = store.getNote(input.id);
		if (!note) {
			return failure({ code: 'NOT_FOUND', message: 'Note not found: ' + input.id, suggestion: 'Check the note ID or list all notes' });
		}
		return success(note, { reasoning: 'Retrieved note "' + note.title + '"', confidence: 1.0 });
	},
});
`;

const noteList = `/**
 * @fileoverview note-list command
 */

import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Note } from '../types.js';

export interface NoteListResult {
	notes: Note[];
	total: number;
}

const inputSchema = z.object({
	search: z.string().optional(),
	folderId: z.string().nullable().optional(),
	sortBy: z.enum(['createdAt', 'updatedAt', 'title']).default('createdAt'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

export const listNotes = defineCommand<typeof inputSchema, NoteListResult>({
	name: 'note-list',
	description: 'List notes with optional filtering',
	category: 'note',
	tags: ['note', 'list', 'read', 'multiple'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: [],

	async handler(input) {
		const notes = store.listNotes({
			search: input.search,
			folderId: input.folderId,
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
			limit: input.limit,
			offset: input.offset,
		});
		const total = store.countNotes();
		let reasoning = 'Found ' + notes.length + ' notes';
		if (input.search) reasoning += ' matching "' + input.search + '"';
		return success({ notes, total }, { reasoning, confidence: 1.0 });
	},
});
`;

const noteUpdate = `/**
 * @fileoverview note-update command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { Note } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Note ID is required'),
	title: z.string().min(1).max(200).optional(),
	content: z.string().max(50000).optional(),
	folderId: z.string().nullable().optional(),
});

export const updateNote = defineCommand<typeof inputSchema, Note>({
	name: 'note-update',
	description: 'Update an existing note',
	category: 'note',
	tags: ['note', 'update', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND', 'FOLDER_NOT_FOUND'],

	async handler(input) {
		const existing = store.getNote(input.id);
		if (!existing) {
			return failure({ code: 'NOT_FOUND', message: 'Note not found: ' + input.id, suggestion: 'Check the note ID or list all notes' });
		}
		if (input.folderId) {
			const folder = store.getNoteFolder(input.folderId);
			if (!folder) {
				return failure({ code: 'FOLDER_NOT_FOUND', message: 'Folder not found: ' + input.folderId, suggestion: 'Create the folder first' });
			}
		}
		const note = store.updateNote(input.id, { title: input.title, content: input.content, folderId: input.folderId });
		return success(note, { reasoning: 'Updated note "' + note.title + '"', confidence: 1.0 });
	},
});
`;

const noteDelete = `/**
 * @fileoverview note-delete command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';

export interface NoteDeleteResult {
	id: string;
	deleted: boolean;
}

const inputSchema = z.object({
	id: z.string().min(1, 'Note ID is required'),
});

export const deleteNote = defineCommand<typeof inputSchema, NoteDeleteResult>({
	name: 'note-delete',
	description: 'Delete a note',
	category: 'note',
	tags: ['note', 'delete', 'write', 'single'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const note = store.getNote(input.id);
		if (!note) {
			return failure({ code: 'NOT_FOUND', message: 'Note not found: ' + input.id, suggestion: 'Check the note ID or list all notes' });
		}
		const deleted = store.deleteNote(input.id);
		return success({ id: input.id, deleted }, { reasoning: 'Deleted note "' + note.title + '"', confidence: 1.0 });
	},
});
`;

const noteFolderCreate = `/**
 * @fileoverview notefolder-create command
 */

import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { NoteFolder } from '../types.js';

const inputSchema = z.object({
	name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
	description: z.string().max(500).optional(),
});

export const createNoteFolder = defineCommand<typeof inputSchema, NoteFolder>({
	name: 'notefolder-create',
	description: 'Create a new note folder',
	category: 'note',
	tags: ['note', 'folder', 'create', 'write'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['VALIDATION_ERROR'],

	async handler(input) {
		const folder = store.createNoteFolder({ name: input.name, description: input.description });
		return success(folder, { reasoning: 'Created folder "' + folder.name + '"', confidence: 1.0 });
	},
});
`;

const noteFolderGet = `/**
 * @fileoverview notefolder-get command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { NoteFolder, Note } from '../types.js';

interface NoteFolderWithNotes extends NoteFolder {
	notes: Note[];
}

const inputSchema = z.object({
	id: z.string().min(1, 'Folder ID is required'),
	includeNotes: z.boolean().default(false),
});

export const getNoteFolder = defineCommand<typeof inputSchema, NoteFolderWithNotes>({
	name: 'notefolder-get',
	description: 'Get a note folder by ID',
	category: 'note',
	tags: ['note', 'folder', 'get', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const folder = store.getNoteFolder(input.id);
		if (!folder) {
			return failure({ code: 'NOT_FOUND', message: 'Folder not found: ' + input.id, suggestion: 'Check the folder ID or list all folders' });
		}
		const notes = input.includeNotes ? store.getNotesInFolder(input.id) : [];
		return success({ ...folder, notes }, { reasoning: 'Retrieved folder "' + folder.name + '"' + (input.includeNotes ? ' with ' + notes.length + ' notes' : ''), confidence: 1.0 });
	},
});
`;

const noteFolderList = `/**
 * @fileoverview notefolder-list command
 */

import { z } from 'zod';
import { defineCommand, success } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { NoteFolder } from '../types.js';

export interface NoteFolderListResult {
	folders: NoteFolder[];
	total: number;
}

const inputSchema = z.object({
	search: z.string().optional(),
	sortBy: z.enum(['createdAt', 'updatedAt', 'name']).default('createdAt'),
	sortOrder: z.enum(['asc', 'desc']).default('desc'),
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

export const listNoteFolders = defineCommand<typeof inputSchema, NoteFolderListResult>({
	name: 'notefolder-list',
	description: 'List note folders with optional filtering',
	category: 'note',
	tags: ['note', 'folder', 'list', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: [],

	async handler(input) {
		const folders = store.listNoteFolders({
			search: input.search,
			sortBy: input.sortBy,
			sortOrder: input.sortOrder,
			limit: input.limit,
			offset: input.offset,
		});
		const total = store.countNoteFolders();
		let reasoning = 'Found ' + folders.length + ' folders';
		if (input.search) reasoning += ' matching "' + input.search + '"';
		return success({ folders, total }, { reasoning, confidence: 1.0 });
	},
});
`;

const noteFolderUpdate = `/**
 * @fileoverview notefolder-update command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';
import type { NoteFolder } from '../types.js';

const inputSchema = z.object({
	id: z.string().min(1, 'Folder ID is required'),
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional(),
});

export const updateNoteFolder = defineCommand<typeof inputSchema, NoteFolder>({
	name: 'notefolder-update',
	description: 'Update an existing note folder',
	category: 'note',
	tags: ['note', 'folder', 'update', 'write'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const existing = store.getNoteFolder(input.id);
		if (!existing) {
			return failure({ code: 'NOT_FOUND', message: 'Folder not found: ' + input.id, suggestion: 'Check the folder ID or list all folders' });
		}
		const folder = store.updateNoteFolder(input.id, { name: input.name, description: input.description });
		return success(folder, { reasoning: 'Updated folder "' + folder.name + '"', confidence: 1.0 });
	},
});
`;

const noteFolderDelete = `/**
 * @fileoverview notefolder-delete command
 */

import { z } from 'zod';
import { defineCommand, success, failure } from '@lushly-dev/afd-server';
import { store } from '../store/index.js';

export interface NoteFolderDeleteResult {
	id: string;
	deleted: boolean;
	notesOrphaned: number;
}

const inputSchema = z.object({
	id: z.string().min(1, 'Folder ID is required'),
});

export const deleteNoteFolder = defineCommand<typeof inputSchema, NoteFolderDeleteResult>({
	name: 'notefolder-delete',
	description: 'Delete a note folder (notes in the folder are moved to root)',
	category: 'note',
	tags: ['note', 'folder', 'delete', 'write'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],

	async handler(input) {
		const folder = store.getNoteFolder(input.id);
		if (!folder) {
			return failure({ code: 'NOT_FOUND', message: 'Folder not found: ' + input.id, suggestion: 'Check the folder ID or list all folders' });
		}
		const notesInFolder = store.getNotesInFolder(input.id);
		for (const note of notesInFolder) {
			store.updateNote(note.id, { folderId: null });
		}
		const deleted = store.deleteNoteFolder(input.id);
		return success({ id: input.id, deleted, notesOrphaned: notesInFolder.length }, { reasoning: 'Deleted folder "' + folder.name + '", moved ' + notesInFolder.length + ' notes to root', confidence: 1.0 });
	},
});
`;

const files = {
	'note-create.ts': noteCreate,
	'note-get.ts': noteGet,
	'note-list.ts': noteList,
	'note-update.ts': noteUpdate,
	'note-delete.ts': noteDelete,
	'notefolder-create.ts': noteFolderCreate,
	'notefolder-get.ts': noteFolderGet,
	'notefolder-list.ts': noteFolderList,
	'notefolder-update.ts': noteFolderUpdate,
	'notefolder-delete.ts': noteFolderDelete,
};

for (const [filename, content] of Object.entries(files)) {
	fs.writeFileSync(path.join(commandsPath, filename), content, 'utf-8');
	console.log('Created ' + filename);
}

// Update index.ts
const indexPath = path.join(commandsPath, 'index.ts');
let indexContent = fs.readFileSync(indexPath, 'utf-8');

// Fix @afd/server imports to @lushly-dev/afd-server
indexContent = indexContent.replace(/@afd\/server/g, '@lushly-dev/afd-server');
indexContent = indexContent.replace(/@afd\/core/g, '@lushly-dev/afd-core');

if (!indexContent.includes('createNote')) {
	// Add exports before "// Re-export as array"
	const noteExports = `
// Note operations
export { createNote } from './note-create.js';
export { getNote } from './note-get.js';
export { listNotes, type NoteListResult } from './note-list.js';
export { updateNote } from './note-update.js';
export { deleteNote, type NoteDeleteResult } from './note-delete.js';

// Note folder operations
export { createNoteFolder } from './notefolder-create.js';
export { getNoteFolder } from './notefolder-get.js';
export { listNoteFolders, type NoteFolderListResult } from './notefolder-list.js';
export { updateNoteFolder } from './notefolder-update.js';
export { deleteNoteFolder, type NoteFolderDeleteResult } from './notefolder-delete.js';
`;
	indexContent = indexContent.replace(/\/\/ Re-export as array for convenience/, noteExports + '\n// Re-export as array for convenience');

	// Add imports before "import type { ZodCommandDefinition }"
	const noteImports = `// Note operations
import { createNote } from './note-create.js';
import { getNote } from './note-get.js';
import { listNotes } from './note-list.js';
import { updateNote } from './note-update.js';
import { deleteNote } from './note-delete.js';
// Note folder operations
import { createNoteFolder } from './notefolder-create.js';
import { getNoteFolder } from './notefolder-get.js';
import { listNoteFolders } from './notefolder-list.js';
import { updateNoteFolder } from './notefolder-update.js';
import { deleteNoteFolder } from './notefolder-delete.js';
`;
	indexContent = indexContent.replace(/import type \{ ZodCommandDefinition \}/, noteImports + 'import type { ZodCommandDefinition }');

	// Add to allCommands array
	indexContent = indexContent.replace(
		/\tmoveSubtask,\n\] as unknown as ZodCommandDefinition\[\];/,
		`	moveSubtask,
	// Note operations
	createNote,
	getNote,
	listNotes,
	updateNote,
	deleteNote,
	// Note folder operations
	createNoteFolder,
	getNoteFolder,
	listNoteFolders,
	updateNoteFolder,
	deleteNoteFolder,
] as unknown as ZodCommandDefinition[];`
	);
}

fs.writeFileSync(indexPath, indexContent, 'utf-8');
console.log('Updated index.ts');

console.log('Done!');
