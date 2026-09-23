/**
 * @fileoverview afd-schema bootstrap command
 *
 * Export input schemas for all commands as JSON Schema or TypeScript types.
 */

import { success } from '@lushly-dev/afd-core';
import { z } from 'zod';
import { defineCommand, type ZodCommandDefinition } from '../schema.js';
import {
	type DescribedCommand,
	describableCommands,
	type GetDescribedCommands,
} from './described-command.js';
import { generateInputTypes } from './json-schema-to-ts.js';

const inputSchema = z.object({
	format: z
		.enum(['json', 'typescript'])
		.default('json')
		.describe('Output format: JSON Schemas, or TypeScript input types in addition'),
});

interface SchemaInfo {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

interface SchemaOutput {
	schemas: SchemaInfo[];
	count: number;
	format: 'json' | 'typescript';
	/** With `format: 'typescript'`: one module declaring an input type per command. */
	typescript?: string;
}

/** Build a basic JSON Schema from core `parameters`. */
function schemaFromParameters(cmd: DescribedCommand): Record<string, unknown> {
	const parameters = cmd.parameters ?? [];
	return {
		type: 'object',
		properties: Object.fromEntries(
			parameters.map((p) => [
				p.name,
				{
					type:
						p.type === 'string'
							? 'string'
							: p.type === 'number'
								? 'number'
								: p.type === 'boolean'
									? 'boolean'
									: 'any',
					description: p.description,
				},
			])
		),
		required: parameters.filter((p) => p.required).map((p) => p.name),
	};
}

/**
 * Create the afd-schema bootstrap command.
 *
 * Exports only MCP-exposed commands.
 *
 * @param getCommands - Function to get all registered commands
 * @param getJsonSchema - Function to get JSON schema for a command
 */
export function createAfdSchemaCommand(
	getCommands: GetDescribedCommands,
	getJsonSchema?: (cmd: DescribedCommand) => Record<string, unknown>
): ZodCommandDefinition<typeof inputSchema, SchemaOutput> {
	return defineCommand({
		name: 'afd-schema',
		description: 'Export input schemas for all commands as JSON Schema or TypeScript types',
		category: 'bootstrap',
		tags: ['bootstrap', 'read', 'safe'],
		mutation: false,
		version: '1.0.0',
		expose: { mcp: true },
		input: inputSchema,

		async handler(input, context) {
			const commands = describableCommands(getCommands, context);

			const schemas: SchemaInfo[] = commands.map((cmd) => {
				let schema: Record<string, unknown>;
				if (getJsonSchema) {
					schema = getJsonSchema(cmd);
				} else if (cmd.jsonSchema) {
					schema = { ...cmd.jsonSchema };
				} else {
					schema = schemaFromParameters(cmd);
				}
				return { name: cmd.name, description: cmd.description, inputSchema: schema };
			});

			if (input.format === 'typescript') {
				const output: SchemaOutput = {
					schemas,
					count: schemas.length,
					format: 'typescript',
					typescript: generateInputTypes(schemas),
				};
				return success(output, {
					reasoning: `Exported ${schemas.length} schemas with TypeScript input types`,
					confidence: 1.0,
				});
			}

			const output: SchemaOutput = { schemas, count: schemas.length, format: 'json' };
			return success(output, {
				reasoning: `Exported JSON schemas for ${schemas.length} commands`,
				confidence: 1.0,
			});
		},
	});
}
