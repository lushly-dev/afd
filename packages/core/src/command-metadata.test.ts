import { describe, expect, it } from 'vitest';
import { commandResultOutputSchema, commandToolAnnotations } from './command-metadata.js';
import { type CommandDefinition, commandToMcpTool, type JsonSchema } from './commands.js';
import type { McpTool } from './mcp.js';
import { success } from './result.js';

/** Existing schema consumers accept arbitrary JSON Schema keywords through a Record. */
function readSchema(schema: Record<string, unknown>) {
	return { type: schema.type, definitions: schema.$defs };
}

describe('MCP command metadata compatibility', () => {
	it('keeps core conversion assignable to MCP tools and existing Record consumers', () => {
		const outputSchema: JsonSchema = { type: 'object', properties: { id: { type: 'string' } } };
		const command: CommandDefinition = {
			name: 'item-read',
			description: 'Read an item',
			parameters: [],
			returns: outputSchema,
			handler: async () => success({ id: 'one' }),
		};
		const converted = commandToMcpTool(command);
		// Both assignments are compile-time regressions for the compatibility boundary.
		const coreSchema: Record<string, unknown> = converted._meta?.outputSchema ?? {};
		const tool: McpTool = converted;
		expect(coreSchema).toEqual(outputSchema);
		expect(readSchema(tool._meta?.outputSchema ?? {})).toEqual({
			type: 'object',
			definitions: undefined,
		});
	});

	it('preserves arbitrary external MCP schema keywords for existing consumers', () => {
		const tool: McpTool = {
			name: 'external-tool',
			inputSchema: { type: 'object' },
			_meta: { outputSchema: { $ref: '#/$defs/Result', $defs: { Result: { type: 'string' } } } },
		};
		const schema = tool._meta?.outputSchema;
		expect(schema?.$defs).toEqual({ Result: { type: 'string' } });
		expect(readSchema(schema ?? {}).definitions).toEqual({ Result: { type: 'string' } });
	});
});

describe('commandToolAnnotations', () => {
	it('reports only what the command sets', () => {
		expect(commandToolAnnotations({})).toBeUndefined();
		expect(commandToolAnnotations({ destructive: true })).toBeUndefined();
		expect(commandToolAnnotations({ mutation: false })).toEqual({ readOnlyHint: true });
		expect(commandToolAnnotations({ mutation: true })).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
		});
		expect(commandToolAnnotations({ mutation: true, destructive: true })).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
		});
	});
});

describe('commandResultOutputSchema', () => {
	it('wraps the data schema in the CommandResult envelope', () => {
		const data = {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
		} as const;
		expect(commandResultOutputSchema(data as never)).toEqual({
			type: 'object',
			properties: {
				success: { type: 'boolean' },
				data: { type: 'object' },
				error: { type: 'object' },
				metadata: { type: 'object' },
			},
			required: ['success'],
		});
	});
});
