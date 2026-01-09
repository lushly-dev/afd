/**
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
