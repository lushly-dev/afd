/**
 * @fileoverview `defineCommandWithSchema`: a command whose JSON Schema is given, on Zod Mini or classic.
 */

import type { JsonSchema } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as m from 'zod/mini';
import { config, locales, toJSONSchema } from 'zod/v4/core';
import { type ContextField, checkContextFields } from './context-fields.js';
import { describeContextFields } from './context-fields-describe.js';
import { createDirectRegistry } from './direct-registry.js';
import type { ZodCommandDefinition } from './schema.js';
import {
	defineCommand,
	defineCommandWithSchema,
	isObjectSchema,
	zodToJsonSchema,
} from './schema.js';
import { validateInput, validateInputEnhanced } from './validation.js';

const handler = async () => ({ success: true as const, data: null });

async function withoutLocale<T>(run: () => Promise<T>): Promise<T> {
	config({ localeError: undefined });
	try {
		return await run();
	} finally {
		config(locales.en());
	}
}

const LITERAL: JsonSchema = {
	type: 'object',
	properties: { id: { type: 'string', description: 'Written by hand' } },
	required: ['id'],
};

describe('defineCommandWithSchema', () => {
	it('shows the JSON Schema it is given, unconverted, and types the handler from Mini', async () => {
		const seen: string[] = [];
		const command = defineCommandWithSchema({
			name: 'panel-open',
			description: 'Open a panel',
			input: m.object({ id: m.string() }),
			jsonSchema: LITERAL,
			async handler(input) {
				seen.push(input.id);
				return { success: true, data: input.id };
			},
		});

		expect(command.jsonSchema).toBe(LITERAL);
		expect(command.toCommandDefinition().parameters).toEqual([
			{
				name: 'id',
				type: 'string',
				description: 'Written by hand',
				required: true,
				default: undefined,
				enum: undefined,
				schema: LITERAL.properties?.id,
			},
		]);

		const result = await createDirectRegistry([command as unknown as ZodCommandDefinition]).execute(
			'panel-open',
			{ id: 'settings' }
		);
		expect(result.success).toBe(true);
		expect(seen).toEqual(['settings']);
	});

	it('is what defineCommand returns for the same options and the schema it would compute', () => {
		const input = z.object({ id: z.string() });
		const output = z.object({ open: z.boolean() });
		const options = {
			name: 'panel-open',
			description: 'Open a panel',
			title: 'Open',
			category: 'panels',
			mutation: true,
			tags: ['a'],
			handoff: true,
			handoffProtocol: 'sse',
			input,
			output,
			examples: [{ title: 'Settings', input: { id: 'settings' } }],
			handler,
		};

		const computed = defineCommand(options);
		const given = defineCommandWithSchema({
			...options,
			jsonSchema: zodToJsonSchema(input),
			outputJsonSchema: zodToJsonSchema(output, { io: 'output' }),
		});

		const { toCommandDefinition: _a, ...fromComputed } = computed;
		const { toCommandDefinition: _b, ...fromGiven } = given;
		expect(fromGiven).toEqual(fromComputed);
		expect(given.toCommandDefinition()).toEqual(computed.toCommandDefinition());
		expect(given.tags).toEqual(['a', 'handoff', 'handoff:sse']);
	});

	it('keeps the keys and their order that defineCommand has always returned', () => {
		const command = defineCommand({
			name: 'panel-open',
			description: 'Open a panel',
			title: 'Open',
			input: z.object({ id: z.string() }),
			handler,
		});

		expect(Object.keys(command)).toEqual([
			'name',
			'description',
			'inputSchema',
			'jsonSchema',
			'handler',
			'title',
			'category',
			'mutation',
			'version',
			'tags',
			'requires',
			'executionTime',
			'errors',
			'handoff',
			'handoffProtocol',
			'destructive',
			'confirmPrompt',
			'undoable',
			'approval',
			'expose',
			'examples',
			'outputSchema',
			'outputJsonSchema',
			'contexts',
			'toolMeta',
			'toCommandDefinition',
		]);
		expect(Object.keys(command.toCommandDefinition())).toEqual([
			'name',
			'description',
			'title',
			'category',
			'mutation',
			'version',
			'tags',
			'requires',
			'executionTime',
			'errors',
			'handoff',
			'handoffProtocol',
			'destructive',
			'confirmPrompt',
			'undoable',
			'approval',
			'expose',
			'examples',
			'contexts',
			'toolMeta',
			'parameters',
			'returns',
			'handler',
		]);
		expect(command.title).toBe('Open');
		expect(command.toCommandDefinition().title).toBe('Open');
	});

	it('lets an advertised schema replace the given one, as defineCommand does', () => {
		const advertised: JsonSchema = { type: 'object', properties: {} };

		const command = defineCommandWithSchema({
			name: 'panel-open',
			description: 'Open a panel',
			input: m.object({}),
			jsonSchema: LITERAL,
			advertisedInputSchema: advertised,
			handler,
		});

		expect(command.jsonSchema).toBe(advertised);
	});

	it('does not convert output, and reports the JSON Schema it is given', () => {
		const outputJsonSchema: JsonSchema = {
			type: 'object',
			properties: { open: { type: 'boolean' } },
		};
		const output = m.object({ open: m.boolean() });
		const base = {
			name: 'panel-open',
			description: 'Open a panel',
			input: m.object({}),
			jsonSchema: LITERAL,
			output,
			handler: async () => ({ success: true as const, data: { open: true } }),
		};

		expect(defineCommandWithSchema(base).outputJsonSchema).toBeUndefined();
		const command = defineCommandWithSchema({ ...base, outputJsonSchema });
		expect(command.outputSchema).toBe(output);
		expect(command.outputJsonSchema).toBe(outputJsonSchema);
		expect(command.toCommandDefinition().returns).toBe(outputJsonSchema);
	});

	it.each([
		['null', null],
		['an array', []],
		['a string', 'object'],
		['nothing', undefined],
	])('refuses %s for jsonSchema, naming the command', (_label, jsonSchema) => {
		expect(() =>
			defineCommandWithSchema({
				name: 'panel-open',
				description: 'Open a panel',
				input: m.object({}),
				jsonSchema: jsonSchema as never,
				handler,
			})
		).toThrow('command "panel-open": jsonSchema must be an object');
	});

	it('refuses a bad advertised schema and warns on a bad name, as defineCommand does', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const base = { description: 'A', input: m.object({}), jsonSchema: LITERAL, handler };

		expect(() =>
			defineCommandWithSchema({
				...base,
				name: 'panel-open',
				advertisedInputSchema: { type: 'string' },
			})
		).toThrow('advertisedInputSchema must be a JSON Schema object');
		defineCommandWithSchema({ ...base, name: 'Not_Kebab' });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('[AFD]'));
		warn.mockRestore();
	});

	it('validates examples with a Mini schema, and says why one fails', () => {
		const base = {
			name: 'panel-open',
			description: 'Open a panel',
			input: m.object({ id: m.string() }),
			jsonSchema: LITERAL,
			handler,
		};

		expect(() =>
			defineCommandWithSchema({ ...base, examples: [{ title: 'Good', input: { id: 'a' } }] })
		).not.toThrow();
		expect(() =>
			defineCommandWithSchema({
				...base,
				examples: [{ title: 'Bad', input: { id: 7 as unknown as string } }],
			})
		).toThrow('Example "Bad" for command "panel-open" fails schema validation: id: Invalid input');
	});

	it('applies a Mini schema defaults and transforms before the handler', async () => {
		const seen: unknown[] = [];
		const command = defineCommandWithSchema({
			name: 'panel-open',
			description: 'Open a panel',
			input: m.object({
				size: m._default(m.number(), 3),
				id: m.pipe(
					m.string(),
					m.transform((value) => value.toUpperCase())
				),
			}),
			jsonSchema: { type: 'object' },
			async handler(input) {
				seen.push(input);
				return { success: true, data: null };
			},
		});

		await createDirectRegistry([command as unknown as ZodCommandDefinition]).execute('panel-open', {
			id: 'a',
		});

		expect(seen).toEqual([{ size: 3, id: 'A' }]);
	});
});

describe('the schema helpers take either API', () => {
	it('zodToJsonSchema converts Mini as it converts classic', () => {
		const shape = { id: 7 };

		expect(zodToJsonSchema(m.object({ id: m.string() }))).toEqual(
			zodToJsonSchema(z.object({ id: z.string() }))
		);
		expect(zodToJsonSchema(z.object({ id: z.string() }))).toMatchObject({
			type: 'object',
			required: ['id'],
		});
		expect(toJSONSchema(m.object({ id: m.string() }))).toBeDefined();
		expect(validateInput(m.object({ id: m.string() }), shape).success).toBe(false);
	});

	it('shows the literal the docs write for a Mini object', () => {
		expect(zodToJsonSchema(m.object({ id: m.string() }))).toEqual({
			type: 'object',
			properties: { id: { type: 'string' } },
			required: ['id'],
		});
	});

	it('isObjectSchema still answers for classic', () => {
		expect(isObjectSchema(z.object({}))).toBe(true);
		expect(isObjectSchema(z.string())).toBe(false);
	});

	it.each([
		['optional', m.optional(m.object({ a: m.string() }))],
		['nullable', m.nullable(m.object({ a: m.string() }))],
		['default', m._default(m.object({ a: m.string() }), { a: 'x' })],
		[
			'a pipe',
			m.pipe(
				m.object({ a: m.string() }),
				m.transform((value) => value)
			),
		],
	])('validateInputEnhanced finds the fields of Mini through %s', (_label, schema) => {
		const result = validateInputEnhanced(schema, { b: 1 });

		expect(result.expectedFields).toEqual(['a']);
		expect(result.unexpectedFields).toEqual(['b']);
		expect(result.missingFields).toEqual(['a']);
	});

	it('no longer calls an exactOptional field missing and required', () => {
		const schema = z.object({ a: z.string().exactOptional(), b: z.string() });

		expect(validateInputEnhanced(schema, {}).missingFields).toEqual(['b']);
	});
});

describe('a Zod Mini context field', () => {
	const field: ContextField<string> = {
		name: 'scope',
		meta: 'dev.example/scope',
		schema: m.string().check(m.minLength(2)),
	};
	const command = defineCommandWithSchema({
		name: 'scope-read',
		description: 'Read the scope',
		input: m.object({}),
		jsonSchema: { type: 'object' },
		async handler(_input, context) {
			return { success: true, data: (context as { scope?: string }).scope ?? null };
		},
	}) as unknown as ZodCommandDefinition;

	it('is accepted and validated', async () => {
		const registry = createDirectRegistry([command], { contextFields: [field] });

		const accepted = await registry.execute('scope-read', {}, { scope: 'ab' });
		const refused = await withoutLocale(() => registry.execute('scope-read', {}, { scope: 'a' }));

		expect(accepted.data).toBe('ab');
		expect(refused.error?.code).toBe('VALIDATION_ERROR');
		expect(refused.error?.details).toMatchObject({
			errors: [{ path: '', message: 'Too small: expected string to have >=2 characters' }],
		});
	});

	it('says what it received, which needs the issue to keep its input', async () => {
		const registry = createDirectRegistry([command], { contextFields: [field] });

		const refused = await withoutLocale(() =>
			registry.execute('scope-read', {}, { scope: 7 } as never)
		);

		expect(refused.error?.details).toMatchObject({
			errors: [{ path: '', message: 'Invalid input: expected string, received number' }],
		});
	});

	it('is described for discovery', () => {
		expect(describeContextFields([field])[0]?.schema).toMatchObject({
			type: 'string',
			minLength: 2,
		});
	});

	it('is told apart from something that is no schema', () => {
		expect(checkContextFields([field])).toEqual([field]);
		expect(() => checkContextFields([{ ...field, schema: { safeParse() {} } as never }])).toThrow(
			"Context field 'scope' needs a Zod schema"
		);
	});
});

describe('a definition with no type arguments', () => {
	it('still reads as classic, so callers of inputSchema.safeParse are unaffected', () => {
		const command = defineCommand({
			name: 'panel-open',
			description: 'Open a panel',
			input: z.object({ id: z.string() }),
			handler,
		}) as unknown as ZodCommandDefinition;

		expect(command.inputSchema.safeParse({ id: 'a' }).success).toBe(true);
	});
});
