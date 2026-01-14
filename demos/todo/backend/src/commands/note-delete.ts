/**
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
	tags: ['note', 'delete', 'write', 'single', 'destructive'],
	mutation: true,
	version: '1.0.0',
	input: inputSchema,
	errors: ['NOT_FOUND'],
	destructive: true,
	confirmPrompt: 'This note will be permanently deleted.',

	async handler(input) {
		const note = store.getNote(input.id);
		if (!note) {
			return failure({ code: 'NOT_FOUND', message: 'Note not found: ' + input.id, suggestion: 'Check the note ID or list all notes' });
		}
		const deleted = store.deleteNote(input.id);
		return success({ id: input.id, deleted }, { reasoning: 'Deleted note "' + note.title + '"', confidence: 1.0 });
	},
});
