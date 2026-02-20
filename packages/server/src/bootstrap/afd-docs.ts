/**
 * @fileoverview afd-docs bootstrap command
 *
 * Generate markdown documentation for commands.
 */

import type { CommandDefinition } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';
import { z } from 'zod';

const inputSchema = z.object({
	command: z.string().optional().describe('Specific command name, or omit for all'),
});

type InputType = z.infer<typeof inputSchema>;

interface DocsOutput {
	markdown: string;
	commandCount: number;
}

/**
 * Create the afd-docs bootstrap command.
 *
 * @param getCommands - Function to get all registered commands
 */
export function createAfdDocsCommand(
	getCommands: () => CommandDefinition[]
): CommandDefinition<InputType, DocsOutput> {
	return {
		name: 'afd-docs',
		description: 'Get detailed documentation for commands',
		category: 'bootstrap',
		tags: ['bootstrap', 'read', 'safe'],
		mutation: false,
		version: '1.0.0',
		parameters: [
			{ name: 'command', type: 'string', required: false, description: 'Specific command name' },
		],

		async handler(input: InputType) {
			const allCommands = getCommands();

			// Filter to specific command if provided
			const commands = input.command
				? allCommands.filter((cmd) => cmd.name === input.command)
				: allCommands;

			if (input.command && commands.length === 0) {
				return success(
					{ markdown: '', commandCount: 0 },
					{ reasoning: `Command "${input.command}" not found`, confidence: 1.0 }
				);
			}

			// Generate markdown
			const lines: string[] = [];
			lines.push('# Command Documentation');
			lines.push('');

			// Group by category
			const byCategory: Record<string, CommandDefinition[]> = {};
			for (const cmd of commands) {
				const category = cmd.category || 'General';
				if (!byCategory[category]) {
					byCategory[category] = [];
				}
				byCategory[category].push(cmd);
			}

			for (const [category, cmds] of Object.entries(byCategory).sort()) {
				lines.push(`## ${category}`);
				lines.push('');

				for (const cmd of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
					lines.push(`### \`${cmd.name}\``);
					lines.push('');
					lines.push(cmd.description);
					lines.push('');

					// Tags
					if (cmd.tags && cmd.tags.length > 0) {
						lines.push(`**Tags:** ${cmd.tags.map((t) => `\`${t}\``).join(', ')}`);
						lines.push('');
					}

					// Mutation info
					if (cmd.mutation !== undefined) {
						lines.push(`**Mutation:** ${cmd.mutation ? 'Yes' : 'No (read-only)'}`);
						lines.push('');
					}

					// Parameters
					if (cmd.parameters && cmd.parameters.length > 0) {
						lines.push('**Parameters:**');
						lines.push('');
						lines.push('| Name | Type | Required | Description |');
						lines.push('|------|------|----------|-------------|');
						for (const param of cmd.parameters) {
							const required = param.required ? 'Yes' : 'No';
							lines.push(
								`| ${param.name} | ${param.type} | ${required} | ${param.description || ''} |`
							);
						}
						lines.push('');
					}

					lines.push('---');
					lines.push('');
				}
			}

			const markdown = lines.join('\n');

			return success(
				{ markdown, commandCount: commands.length },
				{
					reasoning: input.command
						? `Generated documentation for "${input.command}"`
						: `Generated documentation for ${commands.length} commands`,
					confidence: 1.0,
				}
			);
		},
	};
}
