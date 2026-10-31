/**
 * @fileoverview afd-help bootstrap command
 *
 * List all available commands with tags and grouping.
 */

import type { CommandExample } from '@lushly-dev/afd-core';
import { AFD_CONTRACT_VERSION, success } from '@lushly-dev/afd-core';
import { z } from 'zod';
import { defineCommand, type ZodCommandDefinition } from '../schema.js';
import type { ToolStrategy } from '../server-types.js';
import { describableCommands, type GetDescribedCommands } from './described-command.js';

const inputSchema = z.object({
	filter: z.string().optional().describe('Tag filter: e.g., "todo" or "read"'),
	format: z.enum(['brief', 'full']).default('brief').describe('Output format'),
});

interface CommandInfo {
	name: string;
	description: string;
	category?: string;
	tags?: string[];
	mutation?: boolean;
	destructive?: boolean;
	undoable?: boolean;
	requires?: string[];
	examples?: CommandExample[];
	/** `true` for a first-class command of a hybrid server; omitted otherwise. */
	firstClass?: true;
}

interface HelpOutput {
	/** The AFD contract version this server implements (`AFD_CONTRACT_VERSION`). */
	contractVersion: string;
	/** How the server lists its tools; omitted when `afd-help` is not served by an MCP server. */
	toolStrategy?: ToolStrategy;
	/** The first-class command names in list order; hybrid servers only. */
	firstClassTools?: string[];
	commands: CommandInfo[];
	total: number;
	filtered: boolean;
	groupedByCategory: Record<string, CommandInfo[]>;
}

/** How the server lists its tools, which `afd-help` reports (`spec/tool-strategies.md`, H8). */
export interface ToolSurface {
	toolStrategy: ToolStrategy;
	/** The hybrid strategy's first-class command names, in list order. */
	firstClassTools?: readonly string[];
}

/**
 * Create the afd-help bootstrap command.
 *
 * Lists only MCP-exposed commands. `requires` is always included when set.
 * The output also carries the AFD contract version the server implements, and, given
 * `toolSurface`, the tool strategy (with the first-class set on a hybrid server).
 *
 * @param getCommands - Function to get all registered commands
 * @param toolSurface - How the MCP server lists its tools; omit when not served by one
 */
export function createAfdHelpCommand(
	getCommands: GetDescribedCommands,
	toolSurface?: ToolSurface
): ZodCommandDefinition<typeof inputSchema, HelpOutput> {
	return defineCommand({
		name: 'afd-help',
		description: 'List all available commands with tags and grouping',
		category: 'bootstrap',
		tags: ['bootstrap', 'read', 'safe'],
		mutation: false,
		version: '1.0.0',
		expose: { mcp: true },
		input: inputSchema,

		async handler(input, context) {
			const allCommands = describableCommands(getCommands, context);

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

			const firstClass = new Set(
				toolSurface?.toolStrategy === 'hybrid' ? (toolSurface.firstClassTools ?? []) : []
			);

			// Map to output format
			const commandInfos: CommandInfo[] = commands.map((cmd) => {
				const info: CommandInfo = {
					name: cmd.name,
					description: cmd.description,
				};

				if (cmd.requires?.length) {
					info.requires = cmd.requires;
				}

				if (firstClass.has(cmd.name)) {
					info.firstClass = true;
				}

				if (input.format === 'full') {
					info.category = cmd.category;
					info.tags = cmd.tags;
					info.mutation = cmd.mutation;
					info.destructive = cmd.destructive;
					info.undoable = cmd.undoable;
					info.examples = cmd.examples;
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
				contractVersion: AFD_CONTRACT_VERSION,
				...(toolSurface && { toolStrategy: toolSurface.toolStrategy }),
				...(toolSurface?.toolStrategy === 'hybrid' && {
					firstClassTools: [...(toolSurface.firstClassTools ?? [])],
				}),
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
	});
}
