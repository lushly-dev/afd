/**
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
