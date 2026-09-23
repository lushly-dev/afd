/**
 * Grouped tool strategy: afd-detail is listed, per-action schemas and metadata are
 * discoverable in `_meta.actions`, and small groups inline them as `params.anyOf`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, type ZodCommandDefinition } from './schema.js';
import { createToolRouter } from './tool-router.js';
import { GROUPED_PARAMS_SCHEMA_BUDGET, getToolsList } from './tools.js';

const create = defineCommand({
	name: 'todo-create',
	description: 'Create a todo',
	category: 'todo',
	expose: { mcp: true },
	mutation: true,
	requires: ['auth-sign-in'],
	examples: [{ title: 'Basic', input: { title: 'Buy milk' } }],
	input: z.object({
		title: z.string().describe('Todo title'),
		priority: z.enum(['low', 'high']).default('low'),
	}),
	output: z.object({ id: z.string() }),
	handler: async (input) => ({ success: true, data: { id: input.title } }),
});
const list = defineCommand({
	name: 'todo-list',
	description: 'List todos',
	category: 'todo',
	expose: { mcp: true },
	input: z.object({}),
	handler: async () => ({ success: true, data: [] }),
});

function groupTool(commands: ZodCommandDefinition[], name = 'todo') {
	const tool = getToolsList(commands, 'grouped').find((t) => t.name === name);
	if (!tool) throw new Error(`No grouped tool ${name}`);
	return tool;
}

describe('grouped strategy tool list', () => {
	it('lists afd-detail alongside afd-batch, afd-pipe and afd-call, but not afd-discover', () => {
		const names = getToolsList([create, list], 'grouped').map((t) => t.name);
		expect(names).toEqual(['afd-batch', 'afd-pipe', 'afd-call', 'afd-detail', 'todo']);
	});

	it('puts every action with its schema and metadata in _meta.actions', () => {
		const tool = groupTool([create, list]);
		expect(tool._meta?.actions).toEqual([
			{
				action: 'create',
				command: 'todo-create',
				description: 'Create a todo',
				inputSchema: {
					type: 'object',
					properties: {
						title: { type: 'string', description: 'Todo title' },
						priority: { type: 'string', enum: ['low', 'high'], default: 'low' },
					},
					required: ['title'],
				},
				category: 'todo',
				requires: ['auth-sign-in'],
				mutation: true,
				examples: [{ title: 'Basic', input: { title: 'Buy milk' } }],
				outputSchema: create.outputJsonSchema,
			},
			{
				action: 'list',
				command: 'todo-list',
				description: 'List todos',
				inputSchema: { type: 'object', properties: {} },
				category: 'todo',
			},
		]);
	});

	it('inlines small per-action params schemas as anyOf branches under params', () => {
		const { inputSchema } = groupTool([create, list]);
		expect(inputSchema).not.toHaveProperty('oneOf');
		expect(inputSchema).not.toHaveProperty('anyOf');
		expect(inputSchema.required).toEqual(['action']);
		const properties = inputSchema.properties as Record<string, Record<string, unknown>>;
		expect(properties.action).toMatchObject({ type: 'string', enum: ['create', 'list'] });
		expect(properties.params?.type).toBe('object');
		expect(properties.params?.anyOf).toEqual([
			{
				title: 'create',
				description: "Parameters for action 'create' (todo-create)",
				...create.jsonSchema,
			},
			{
				title: 'list',
				description: "Parameters for action 'list' (todo-list)",
				...list.jsonSchema,
			},
		]);
	});

	it('keeps large or $ref schemas out of params and points to _meta and afd-detail', () => {
		const noop = async () => ({ success: true, data: null });
		const wide = defineCommand({
			...list,
			name: 'todo-import',
			input: z.object(
				Object.fromEntries(
					Array.from({ length: 200 }, (_, i) => [`field${i}`, z.string().describe('x'.repeat(40))])
				)
			),
			handler: noop,
		});
		const large = groupTool([list, wide]);
		const params = (large.inputSchema.properties as Record<string, Record<string, unknown>>).params;
		expect(JSON.stringify(wide.jsonSchema).length).toBeGreaterThan(GROUPED_PARAMS_SCHEMA_BUDGET);
		expect(params).not.toHaveProperty('anyOf');
		expect(params?.description).toContain('afd-detail');
		expect(large._meta?.actions?.[1]?.inputSchema).toEqual({ ...wide.jsonSchema, type: 'object' });

		const Node: z.ZodType<{ name: string; children?: unknown[] }> = z.object({
			name: z.string(),
			get children() {
				return z.array(Node).optional();
			},
		});
		const tree = defineCommand({
			name: 'todo-tree',
			description: 'Store a tree',
			category: 'todo',
			expose: { mcp: true },
			input: z.object({ root: Node }),
			handler: noop,
		});
		const withRef = groupTool([tree]);
		const refParams = (withRef.inputSchema.properties as Record<string, Record<string, unknown>>)
			.params;
		expect(refParams).not.toHaveProperty('anyOf');
	});

	it('dedupes the action enum and lists ambiguous actions with their full names', () => {
		const other = defineCommand({
			...list,
			name: 'item-list',
			category: 'todo',
			input: z.object({}),
		});
		const tool = groupTool([list, other]);
		const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;
		expect(properties.action?.enum).toEqual(['list']);
		expect(tool._meta?.actions?.map((action) => action.command)).toEqual([
			'todo-list',
			'item-list',
		]);
	});
});

describe('grouped strategy routing', () => {
	function router(commands: ZodCommandDefinition[]) {
		return createToolRouter({
			executeCommand: async (name, input) => ({ success: true, data: { name, input } }),
			executeBatch: async () => {
				throw new Error('unused');
			},
			executePipeline: async () => {
				throw new Error('unused');
			},
			commands,
			toolStrategy: 'grouped',
			devMode: false,
		});
	}

	it('answers the listed afd-detail tool', async () => {
		const result = await router([create, list])('afd-detail', { command: 'todo-create' });
		const parsed = JSON.parse(result.content[0]?.text ?? '{}');
		expect(parsed.data[0]).toMatchObject({ name: 'todo-create', found: true, callable: true });
		expect(parsed.data[0].inputSchema).toEqual(create.jsonSchema);
	});

	it('routes an action to its command with params', async () => {
		const result = await router([create, list])('todo', {
			action: 'create',
			params: { title: 'x' },
		});
		expect(JSON.parse(result.content[0]?.text ?? '{}').data).toEqual({
			name: 'todo-create',
			input: { title: 'x' },
		});
	});
});
