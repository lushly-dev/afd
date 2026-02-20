/**
 * @fileoverview note-create command
 */

import { defineCommand, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
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
				return {
					success: false,
					error: {
						code: 'FOLDER_NOT_FOUND',
						message: `Folder not found: ${input.folderId}`,
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
		return success(note, { reasoning: `Created note "${note.title}"`, confidence: 1.0 });
	},
});
