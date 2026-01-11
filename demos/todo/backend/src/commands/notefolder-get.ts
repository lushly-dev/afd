/**
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
