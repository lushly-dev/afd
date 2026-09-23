import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../schema.js';
import { generateInputTypes, inputTypeName, toType } from './json-schema-to-ts.js';

describe('toType', () => {
	it('maps primitive types, integer and null', () => {
		expect(toType({ type: 'string' })).toBe('string');
		expect(toType({ type: 'number' })).toBe('number');
		expect(toType({ type: 'integer' })).toBe('number');
		expect(toType({ type: 'boolean' })).toBe('boolean');
		expect(toType({ type: 'null' })).toBe('null');
		expect(toType({ type: ['string', 'null'] })).toBe('string | null');
	});

	it('maps enum, const, unions and intersections', () => {
		expect(toType({ type: 'string', enum: ['a', 'b'] })).toBe('"a" | "b"');
		expect(toType({ const: 3 })).toBe('3');
		expect(toType({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number');
		expect(toType({ oneOf: [{ const: 'x' }, { const: 'x' }] })).toBe('"x"');
		expect(
			toType({
				allOf: [
					{ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
					{ type: 'object', properties: { b: { anyOf: [{ type: 'string' }, { type: 'null' }] } } },
				],
			})
		).toBe('{\n\ta: string;\n} & {\n\tb?: string | null;\n}');
		expect(
			toType({ type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } })
		).toBe('Array<string | number>');
		expect(
			toType({ anyOf: [{ type: 'array', items: { type: 'string' } }, { enum: ['a', 'b'] }] })
		).toBe('Array<string> | ("a" | "b")');
		expect(toType({ anyOf: [{ const: 'a|"b&' }, { type: 'number' }] })).toBe('"a|\\"b&" | number');
	});

	it('maps arrays and objects, quoting keys and documenting properties', () => {
		expect(toType({ type: 'array' })).toBe('unknown[]');
		expect(
			toType({
				type: 'object',
				properties: {
					'first-name': { type: 'string', description: 'Given */ name\nline two' },
					tags: { type: 'array', items: { type: 'string' } },
				},
				required: ['first-name'],
				additionalProperties: { type: 'number' },
			})
		).toBe(
			'{\n\t/** Given *\\/ name line two */\n\t"first-name": string;\n\ttags?: Array<string>;\n\t[key: string]: number;\n}'
		);
		expect(toType({ type: 'object', additionalProperties: true })).toBe(
			'{\n\t[key: string]: unknown;\n}'
		);
		expect(toType({ type: 'object', properties: {} })).toBe('Record<string, never>');
		expect(toType({ properties: { a: { type: 'string' } } })).toBe('{\n\ta?: string;\n}');
	});

	it('falls back to unknown for refs, unknown types and deep nesting', () => {
		expect(toType({ $ref: '#/definitions/Node' })).toBe('unknown');
		expect(toType({})).toBe('unknown');
		expect(toType('string')).toBe('unknown');
		let deep: Record<string, unknown> = { type: 'string' };
		for (let i = 0; i < 40; i++) deep = { type: 'array', items: deep };
		expect(toType(deep)).toContain('unknown');
	});
});

describe('generateInputTypes', () => {
	it('names types after commands and avoids collisions', () => {
		expect(inputTypeName('todo-create')).toBe('TodoCreateInput');
		expect(inputTypeName('3d-render')).toBe('_3dRenderInput');
		expect(inputTypeName('--')).toBe('CommandInput');
		const source = generateInputTypes([
			{ name: 'todo-create', description: 'Create', inputSchema: { type: 'object' } },
			{ name: 'todo_create', description: 'Create too', inputSchema: { type: 'object' } },
		]);
		expect(source).toContain('export type TodoCreateInput = Record<string, never>;');
		expect(source).toContain('export type TodoCreateInput2 = Record<string, never>;');
		expect(source).toContain('/** Input of `todo-create`: Create */');
	});

	it('describes Zod input schemas, with defaulted fields optional', () => {
		const schema = zodToJsonSchema(
			z.object({
				title: z.string().describe('Title'),
				priority: z.enum(['low', 'high']).default('low'),
				limit: z.number().int().optional(),
			})
		);
		const source = generateInputTypes([
			{ name: 'todo-list', description: 'List', inputSchema: schema },
		]);
		expect(source).toBe(
			'/** Input of `todo-list`: List */\nexport type TodoListInput = {\n\t/** Title */\n\ttitle: string;\n\tpriority?: "low" | "high";\n\tlimit?: number;\n};\n'
		);
	});
});
