import { describe, expect, it } from 'vitest';
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
