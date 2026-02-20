/**
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
	tags: ['note', 'folder', 'delete', 'write', 'destructive'],
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
