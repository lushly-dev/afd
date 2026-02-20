/**
 * @fileoverview notefolder-update command
 */

import { defineCommand, failure, success } from '@lushly-dev/afd-server';
import { z } from 'zod';
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
				message: `Folder not found: ${input.id}`,
				suggestion: 'Check the folder ID or list all folders',
			});
		}
		const folder = store.updateNoteFolder(input.id, {
			name: input.name,
			description: input.description,
		});
		if (!folder) {
			return failure({
				code: 'NOT_FOUND',
				message: `Folder not found after update: ${input.id}`,
				suggestion: 'Check the folder ID or list all folders',
			});
		}
		return success(folder, { reasoning: `Updated folder "${folder.name}"`, confidence: 1.0 });
	},
});
