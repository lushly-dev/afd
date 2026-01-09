/**
 * @fileoverview tag.list command - List all unique tags
 */

import { z } from 'zod';
import { defineCommand, success } from '@afd/server';
import { store } from '../store/index.js';

const inputSchema = z.object({});

export interface TagListResult {
	tags: string[];
	count: number;
}

export const listTags = defineCommand<typeof inputSchema, TagListResult>({
	name: 'tag-list',
	description: 'List all unique tags used across all todos',
	category: 'tag',
	tags: ['tag', 'list', 'read'],
	mutation: false,
	version: '1.0.0',
	input: inputSchema,
	errors: [],

	async handler() {
		const tags = store.getAllTags();

		return success(
			{ tags, count: tags.length },
			{
				reasoning: tags.length > 0
					? `Found ${tags.length} unique tag${tags.length === 1 ? '' : 's'}`
					: 'No tags found in any todos',
				confidence: 1.0,
			}
		);
	},
});
