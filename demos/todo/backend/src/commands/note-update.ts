/**
 * @fileoverview note-update command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
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
				message: `Note not found: ${input.id}`,
				suggestion: 'Check the note ID or list all notes',
			});
		}
		if (input.folderId) {
			const folder = store.getNoteFolder(input.folderId);
			if (!folder) {
				return failure({
					code: 'FOLDER_NOT_FOUND',
					message: `Folder not found: ${input.folderId}`,
					suggestion: 'Create the folder first',
				});
			}
		}
		const note = store.updateNote(input.id, {
			title: input.title,
			content: input.content,
			folderId: input.folderId,
		})!;
		return success(note, { reasoning: `Updated note "${note.title}"`, confidence: 1.0 });
	},
});
