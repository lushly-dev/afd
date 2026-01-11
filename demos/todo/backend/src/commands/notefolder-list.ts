/**
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
		if (input.search) reasoning += ' matching "' + input.search + '"';
		return success({ folders, total }, { reasoning, confidence: 1.0 });
	},
});
