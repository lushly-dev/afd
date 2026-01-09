/**
 * Script to create note command files
 */
const fs = require('fs');
const path = require('path');

const commandsPath = path.join(__dirname, 'packages', 'examples', 'todo', 'backends', 'typescript', 'src', 'commands');

// note-create.ts
const noteCreateContent = `/**
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
		// Validate folder exists if provided
		if (input.folderId) {
			const folder = store.getNoteFolder(input.folderId);
			if (!folder) {
				return {
					success: false,
					error: {
						code: 'FOLDER_NOT_FOUND',
						message: 'Folder not found: ' + input.folderId,
						suggestion: 'Create the folder first or omit folderId',
					},
				};
			}
		}

		const note = store.createNote({
			title: input.title,
			content: input.content,
			folderId: input.folderId,
		});

		const folderText = input.folderId ? ' in folder' : '';
		return success(note, {
			reasoning: 'Created note "' + note.title + '"' + folderText,
			confidence: 1.0,
		});
	},
});
`;

// note-get.ts
const noteGetContent = `/**
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
			return failure({
				code: 'NOT_FOUND',
				message: 'Note not found: ' + input.id,
				suggestion: 'Check the note ID or list all notes',
			});
		}

		return success(note, {
			reasoning: 'Retrieved note "' + note.title + '"',
			confidence: 1.0,
		});
	},
});
`;

// note-list.ts
const noteListContent = `/**
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
		if (input.search) {
			reasoning += ' matching "' + input.search + '"';
		}
		if (input.folderId) {
			reasoning += ' in folder';
		}

		return success(
			{ notes, total },
			{
				reasoning,
				confidence: 1.0,
			}
		);
	},
});
`;

// note-update.ts
const noteUpdateContent = `/**
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
			return failure({
				code: 'NOT_FOUND',
				message: 'Note not found: ' + input.id,
				suggestion: 'Check the note ID or list all notes',
			});
		}

		// Validate folder exists if provided
		if (input.folderId) {
			const folder = store.getNoteFolder(input.folderId);
			if (!folder) {
				return failure({
					code: 'FOLDER_NOT_FOUND',
					message: 'Folder not found: ' + input.folderId,
					suggestion: 'Create the folder first',
				});
			}
		}

		const note = store.updateNote(input.id, {
			title: input.title,
			content: input.content,
			folderId: input.folderId,
		});

		const changes: string[] = [];
		if (input.title) changes.push('title');
		if (input.content !== undefined) changes.push('content');
		if (input.folderId !== undefined) changes.push('folder');

		return success(note!, {
			reasoning: 'Updated note "' + note!.title + '" (' + changes.join(', ') + ')',
			confidence: 1.0,
		});
	},
});
`;

// note-delete.ts
const noteDeleteContent = `/**
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
			return failure({
				code: 'NOT_FOUND',
				message: 'Note not found: ' + input.id,
				suggestion: 'Check the note ID or list all notes',
			});
		}

		const deleted = store.deleteNote(input.id);

		return success(
			{ id: input.id, deleted },
			{
				reasoning: 'Deleted note "' + note.title + '"',
				confidence: 1.0,
			}
		);
	},
});
`;

// notefolder-create.ts
const noteFolderCreateContent = `/**
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
		const folder = store.createNoteFolder({
			name: input.name,
			description: input.description,
		});

		return success(folder, {
			reasoning: 'Created folder "' + folder.name + '"',
			confidence: 1.0,
		});
	},
});
`;

// notefolder-get.ts
const noteFolderGetContent = `/**
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
			return failure({
				code: 'NOT_FOUND',
				message: 'Folder not found: ' + input.id,
				suggestion: 'Check the folder ID or list all folders',
			});
		}

		const notes = input.includeNotes ? store.getNotesInFolder(input.id) : [];

		return success(
			{ ...folder, notes },
			{
				reasoning: 'Retrieved folder "' + folder.name + '"' + (input.includeNotes ? ' with ' + notes.length + ' notes' : ''),
				confidence: 1.0,
			}
		);
	},
});
`;

// notefolder-list.ts
const noteFolderListContent = `/**
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
		if (input.search) {
			reasoning += ' matching "' + input.search + '"';
		}

		return success(
			{ folders, total },
			{
				reasoning,
				confidence: 1.0,
			}
		);
	},
});
`;

// notefolder-update.ts
const noteFolderUpdateContent = `/**
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
			return failure({
				code: 'NOT_FOUND',
				message: 'Folder not found: ' + input.id,
				suggestion: 'Check the folder ID or list all folders',
			});
		}

		const folder = store.updateNoteFolder(input.id, {
			name: input.name,
			description: input.description,
		});

		const changes: string[] = [];
		if (input.name) changes.push('name');
		if (input.description !== undefined) changes.push('description');

		return success(folder!, {
			reasoning: 'Updated folder "' + folder!.name + '" (' + changes.join(', ') + ')',
			confidence: 1.0,
		});
	},
});
`;

// notefolder-delete.ts
const noteFolderDeleteContent = `/**
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
			return failure({
				code: 'NOT_FOUND',
				message: 'Folder not found: ' + input.id,
				suggestion: 'Check the folder ID or list all folders',
			});
		}

		// Move all notes to root before deleting folder
		const notesInFolder = store.getNotesInFolder(input.id);
		for (const note of notesInFolder) {
			store.updateNote(note.id, { folderId: null });
		}

		const deleted = store.deleteNoteFolder(input.id);

		return success(
			{ id: input.id, deleted, notesOrphaned: notesInFolder.length },
			{
				reasoning: 'Deleted folder "' + folder.name + '", moved ' + notesInFolder.length + ' notes to root',
				confidence: 1.0,
			}
		);
	},
});
`;

// Write all files
const files = {
	'note-create.ts': noteCreateContent,
	'note-get.ts': noteGetContent,
	'note-list.ts': noteListContent,
	'note-update.ts': noteUpdateContent,
	'note-delete.ts': noteDeleteContent,
	'notefolder-create.ts': noteFolderCreateContent,
	'notefolder-get.ts': noteFolderGetContent,
	'notefolder-list.ts': noteFolderListContent,
	'notefolder-update.ts': noteFolderUpdateContent,
	'notefolder-delete.ts': noteFolderDeleteContent,
};

for (const [filename, content] of Object.entries(files)) {
	const filePath = path.join(commandsPath, filename);
	fs.writeFileSync(filePath, content, 'utf-8');
	console.log('Created ' + filename);
}

// Update index.ts
const indexPath = path.join(commandsPath, 'index.ts');
let indexContent = fs.readFileSync(indexPath, 'utf-8');

// Add exports
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

if (!indexContent.includes('createNote')) {
	// Add exports before "// Re-export as array"
	indexContent = indexContent.replace(
		/\/\/ Re-export as array for convenience/,
		noteExports + '\n// Re-export as array for convenience'
	);

	// Add imports before "import type { ZodCommandDefinition }"
	indexContent = indexContent.replace(
		/import type \{ ZodCommandDefinition \}/,
		noteImports + 'import type { ZodCommandDefinition }'
	);

	// Add to allCommands array before closing bracket
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

// Fix @afd/server to @lushly-dev/afd-server
indexContent = indexContent.replace(/@afd\/server/g, '@lushly-dev/afd-server');

fs.writeFileSync(indexPath, indexContent, 'utf-8');
console.log('Updated index.ts');

console.log('Done! Run "git add" to stage the changes.');
