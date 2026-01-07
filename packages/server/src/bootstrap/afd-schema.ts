/**
 * @fileoverview afd-schema bootstrap command
 * 
 * Export JSON schemas for all commands.
 */

import { z } from 'zod';
import type { CommandDefinition } from '@lushly-dev/afd-core';
import { success } from '@lushly-dev/afd-core';

const inputSchema = z.object({
	format: z.enum(['json', 'typescript']).default('json').describe('Output format'),
});

type InputType = z.infer<typeof inputSchema>;

interface SchemaInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

interface SchemaOutput {
	schemas: SchemaInfo[];
	count: number;
	format: 'json' | 'typescript';
}

/**
 * Create the afd-schema bootstrap command.
 * 
 * @param getCommands - Function to get all registered commands
 * @param getJsonSchema - Function to get JSON schema for a command
 */
export function createAfdSchemaCommand(
	getCommands: () => CommandDefinition[],
	getJsonSchema?: (cmd: CommandDefinition) => Record<string, unknown>
): CommandDefinition<InputType, SchemaOutput> {
	return {
		name: 'afd-schema',
		description: 'Export JSON schemas for all commands',
		category: 'bootstrap',
		tags: ['bootstrap', 'read', 'safe'],
		mutation: false,
		version: '1.0.0',
		parameters: [
			{ name: 'format', type: 'string', required: false, description: 'Output format' },
		],

		async handler(input: InputType) {
			const commands = getCommands();
			
			const schemas: SchemaInfo[] = commands.map(cmd => {
				// Try to get JSON schema from the command or use getJsonSchema function
				let schema: Record<string, unknown> = {};
				
				if (getJsonSchema) {
					schema = getJsonSchema(cmd);
				} else if ('jsonSchema' in cmd && cmd.jsonSchema) {
					schema = cmd.jsonSchema as Record<string, unknown>;
				} else if (cmd.parameters) {
					// Build basic schema from parameters
					schema = {
						type: 'object',
						properties: Object.fromEntries(
							cmd.parameters.map(p => [
								p.name,
								{
									type: p.type === 'string' ? 'string' : 
									      p.type === 'number' ? 'number' :
									      p.type === 'boolean' ? 'boolean' : 'any',
									description: p.description,
								}
							])
						),
						required: cmd.parameters
							.filter(p => p.required)
							.map(p => p.name),
					};
				}

				return {
					name: cmd.name,
					description: cmd.description,
					inputSchema: schema,
				};
			});

			// TODO: TypeScript format generation
			if (input.format === 'typescript') {
				// For now, just return JSON with a note
				return success(
					{ schemas, count: schemas.length, format: 'typescript' },
					{
						reasoning: `Exported ${schemas.length} schemas (TypeScript format coming soon)`,
						confidence: 0.8,
					}
				);
			}

			return success(
				{ schemas, count: schemas.length, format: 'json' },
				{
					reasoning: `Exported JSON schemas for ${schemas.length} commands`,
					confidence: 1.0,
				}
			);
		},
	};
}
