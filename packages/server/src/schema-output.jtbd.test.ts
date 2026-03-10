import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';

describe('JTBD: Agent builds pipeline referencing output fields', () => {
	it('output schema is accessible via toCommandDefinition().returns', () => {
		const Todo = z.object({
			id: z.string(),
			title: z.string(),
			done: z.boolean(),
			createdAt: z.string(),
		});

		const listCmd = defineCommand({
			name: 'todo-list',
			description: 'Lists all todos',
			input: z.object({}),
			output: Todo.array(),
			handler: async () => ({ success: true, data: [] }),
		});

		const updateCmd = defineCommand({
			name: 'todo-update',
			description: 'Updates a todo',
			input: z.object({ id: z.string(), done: z.boolean().optional() }),
			output: Todo,
			handler: async (input) => ({
				success: true,
				data: { id: input.id, title: 'Test', done: true, createdAt: '2024-01-01' },
			}),
		});

		// Agent discovers output schema
		const listReturns = listCmd.toCommandDefinition().returns;
		expect(listReturns?.type).toBe('array');
		expect(listReturns?.items?.properties?.id).toBeDefined();
		expect(listReturns?.items?.properties?.title).toBeDefined();
		expect(listReturns?.items?.properties?.done).toBeDefined();
		expect(listReturns?.items?.properties?.createdAt).toBeDefined();

		// Agent can verify field exists before building pipeline
		const updateReturns = updateCmd.toCommandDefinition().returns;
		expect(updateReturns?.properties?.id).toBeDefined();
	});

	it('_meta.outputSchema matches toCommandDefinition().returns', () => {
		const cmd = defineCommand({
			name: 'todo-get',
			description: 'Gets a todo by ID',
			input: z.object({ id: z.string() }),
			output: z.object({ id: z.string(), title: z.string() }),
			handler: async () => ({ success: true, data: { id: '1', title: 'Test' } }),
		});

		const returns = cmd.toCommandDefinition().returns;
		const outputJsonSchema = cmd.outputJsonSchema;

		// Both should be the same JSON Schema
		expect(outputJsonSchema).toEqual(returns);
	});
});
