/**
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
