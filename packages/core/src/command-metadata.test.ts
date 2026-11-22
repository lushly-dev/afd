import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	commandResultOutputSchema,
	commandToolAnnotations,
	commandToolMeta,
} from './command-metadata.js';
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

describe('commandToolMeta', () => {
	it('omits task when unset and reports explicit task values', () => {
		expect(commandToolMeta({})).toBeUndefined();
		expect(commandToolMeta({ task: 'never' })).toEqual({ task: 'never' });
		expect(commandToolMeta({ task: 'optional' })).toEqual({ task: 'optional' });
		expect(commandToolMeta({ task: 'required' })).toEqual({ task: 'required' });
	});
});

describe('commandResultOutputSchema', () => {
	const specEnvelope = JSON.parse(
		readFileSync(new URL('../../../spec/schema/output-envelope.json', import.meta.url), 'utf8')
	) as {
		type: string;
		properties: Record<string, unknown>;
		required: string[];
	};

	it('wraps the data schema in the CommandResult envelope from spec/schema/output-envelope.json', () => {
		const data = {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
		} as const;
		expect(commandResultOutputSchema(data as never)).toEqual({
			type: specEnvelope.type,
			properties: {
				...specEnvelope.properties,
				data: { type: 'object' },
			},
			required: specEnvelope.required,
		});
		expect(commandResultOutputSchema(data as never).properties?.error).toEqual({
			type: 'object',
			properties: {
				code: { type: 'string' },
				message: { type: 'string' },
				suggestion: { type: 'string' },
				retryable: { type: 'boolean' },
			},
			required: ['code', 'message'],
		});
	});

	it('moves $defs and definitions to the envelope, where their references resolve', () => {
		const tag = { type: 'object', properties: { name: { type: 'string' } } };
		const data = {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			type: 'object',
			properties: {
				tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
				owner: { $ref: '#/definitions/Owner' },
			},
			$defs: { Tag: tag },
			definitions: { Owner: tag },
		};
		const schema = commandResultOutputSchema(data as never) as unknown as Record<string, unknown>;
		expect(schema.$defs).toEqual({ Tag: tag });
		expect(schema.definitions).toEqual({ Owner: tag });
		expect((schema.properties as Record<string, unknown>).data).toEqual({
			type: 'object',
			properties: data.properties,
		});
		// The caller's schema is not changed.
		expect(data.$defs).toEqual({ Tag: tag });
	});

	it('keeps definitions with data when it has its own $id', () => {
		const data = {
			$id: 'https://example.com/item',
			type: 'object',
			properties: { tag: { type: 'string', $ref: '#/$defs/Tag' } },
			$defs: { Tag: { $ref: '#/definitions/Name' } },
			definitions: { Name: { minLength: 1 } },
		} as const;
		const original = structuredClone(data);
		const schema = commandResultOutputSchema(data);
		expect(data).toEqual(original);
		expect(schema.properties?.data).toEqual(original);
		expect(schema).not.toHaveProperty('$defs');
		expect(schema).not.toHaveProperty('definitions');
	});
});
