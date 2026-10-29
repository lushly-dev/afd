import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { initializeCore } from '../index.js';
import { docsGenerate } from './docs/generator.js';
import { toJsonSchema } from './json-schema.js';
import { registry } from './registry.js';

describe('toJsonSchema', () => {
	it('converts a Zod object to inline draft-07 JSON Schema', () => {
		const shared = z.string().min(1);
		const schema = toJsonSchema(
			z.object({
				id: shared,
				parent: shared.optional(),
				mode: z.enum(['merge', 'replace']).default('merge'),
				tags: z.array(z.string()),
			}),
		);

		expect(schema).toEqual({
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			properties: {
				id: { type: 'string', minLength: 1 },
				parent: { type: 'string', minLength: 1 },
				mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' },
				tags: { type: 'array', items: { type: 'string' } },
			},
			required: ['id', 'tags'],
			additionalProperties: false,
		});
		// A reused schema is inlined, not a $ref
		expect(JSON.stringify(schema)).not.toContain('$ref');
	});
});

describe('registry.getInputJsonSchema', () => {
	beforeAll(() => {
		if (registry.list().length === 0) initializeCore();
	});

	it('describes real commands with their fields', () => {
		const register = registry.getInputJsonSchema('webhooks.register') as {
			properties: Record<string, { items?: { enum?: string[] } }>;
			required: string[];
		};
		expect(Object.keys(register.properties)).toEqual(
			expect.arrayContaining(['url', 'events', 'secret', 'nodeFilter', 'description', 'active']),
		);
		expect(register.properties.events.items?.enum).toContain('node.created');
		expect(register.required).toEqual(expect.arrayContaining(['url', 'events']));

		const create = registry.getInputJsonSchema('node.create') as {
			properties: Record<string, unknown>;
		};
		expect(create.properties).toHaveProperty('name');
	});

	it('is undefined for an unknown command', () => {
		expect(registry.getInputJsonSchema('no.such.command')).toBeUndefined();
	});

	it('is what docs.generate reports as each input schema', async () => {
		const result = await docsGenerate(
			{ format: 'json', filter: 'webhooks.*' },
			{} as Parameters<typeof docsGenerate>[1],
		);
		const commands = result.data?.commands ?? [];
		expect(commands.length).toBeGreaterThan(0);
		for (const cmd of commands) {
			expect(cmd.inputSchema).toEqual(registry.getInputJsonSchema(cmd.name));
		}
	});
});
