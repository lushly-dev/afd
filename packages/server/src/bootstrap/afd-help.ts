/**
 * @fileoverview afd-help bootstrap command
 *
 * List all available commands with tags and grouping.
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { z } from 'zod';

const inputSchema = z.object({
	filter: z.string().optional().describe('Tag filter: e.g., "todo" or "read"'),
	format: z.enum(['brief', 'full']).default('brief').describe('Output format'),
});

type InputType = z.infer<typeof inputSchema>;

interface CommandInfo {
	name: string;
	description: string;
	category?: string;
	tags?: string[];
	mutation?: boolean;
	requires?: string[];
}

interface HelpOutput {
	commands: CommandInfo[];
	total: number;
	filtered: boolean;
	groupedByCategory: Record<string, CommandInfo[]>;
}

/**
 * Create the afd-help bootstrap command.
 *
 * @param getCommands - Function to get all registered commands
 */
export function createAfdHelpCommand(
	getCommands: () => CommandDefinition[]
): CommandDefinition<InputType, HelpOutput> {
	return {
		name: 'afd-help',
		description: 'List all available commands with tags and grouping',
		category: 'bootstrap',
		tags: ['bootstrap', 'read', 'safe'],
		mutation: false,
		version: '1.0.0',
		parameters: [
			{ name: 'filter', type: 'string', required: false, description: 'Tag filter' },
			{ name: 'format', type: 'string', required: false, description: 'Output format' },
		],

		async handler(input: InputType) {
			const allCommands = getCommands();

			// Filter by tag if provided
			let commands = allCommands;
			const filtered = !!input.filter;

			if (input.filter) {
				const filterTag = input.filter.toLowerCase();
				commands = allCommands.filter(
					(cmd) =>
						cmd.tags?.some((tag) => tag.toLowerCase().includes(filterTag)) ||
						cmd.category?.toLowerCase().includes(filterTag) ||
						cmd.name.toLowerCase().includes(filterTag)
				);
			}

			// Map to output format
			const commandInfos: CommandInfo[] = commands.map((cmd) => {
				const info: CommandInfo = {
					name: cmd.name,
					description: cmd.description,
				};

				if (input.format === 'full') {
					info.category = cmd.category;
					info.tags = cmd.tags;
					info.mutation = cmd.mutation;
					info.requires = cmd.requires;
				}

				return info;
			});

			// Group by category
			const groupedByCategory: Record<string, CommandInfo[]> = {};
			for (const cmd of commandInfos) {
				const category = cmd.category || 'uncategorized';
				if (!groupedByCategory[category]) {
					groupedByCategory[category] = [];
				}
				groupedByCategory[category].push(cmd);
			}

			const output: HelpOutput = {
				commands: commandInfos,
				total: commandInfos.length,
				filtered,
				groupedByCategory,
			};

			return success(output, {
				reasoning: filtered
					? `Found ${commandInfos.length} commands matching "${input.filter}"`
					: `Listing all ${commandInfos.length} available commands`,
				confidence: 1.0,
			});
		},
	};
}
