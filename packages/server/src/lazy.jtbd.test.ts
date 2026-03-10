import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executeDetail, executeDiscover } from './lazy-tools.js';
import { defineCommand } from './schema.js';
import { createMcpServer } from './server.js';

function createLargeCommandSet() {
	const commands = [];
	const categories = ['user', 'order', 'payment', 'product', 'shipping'];
	const actions = ['create', 'get', 'list', 'update', 'delete'];

	for (const cat of categories) {
		for (const action of actions) {
			commands.push(
				defineCommand({
					name: `${cat}-${action}`,
					description: `${action.charAt(0).toUpperCase() + action.slice(1)}s a ${cat}`,
					category: cat,
					tags: ['crud', action === 'get' || action === 'list' ? 'read' : 'write'],
					mutation: action !== 'get' && action !== 'list',
					input: z.object(
						action === 'create' ? { name: z.string() } : action === 'list' ? {} : { id: z.string() }
					),
					handler: async () => ({ success: true as const, data: null }),
				})
			);
		}
	}
	return commands;
}

describe('JTBD: Agent explores unfamiliar server', () => {
	it('discovers -> filters by category -> details -> calls', async () => {
		const commands = createLargeCommandSet();
		const server = createMcpServer({
			name: 'ecommerce',
			version: '1.0.0',
			commands,
			toolStrategy: 'lazy',
			transport: 'http',
			port: 3410,
		});
		const exposedNames = new Set(commands.map((c) => c.name));

		// Agent: "What can this server do?"
		const catalog = executeDiscover(commands, {});
		expect(catalog.data?.total).toBe(25);
		expect(catalog.data?.availableCategories).toHaveLength(5);

		// Agent: "Show me order commands"
		const orders = executeDiscover(commands, { category: 'order' });
		expect(orders.data?.commands).toHaveLength(5);

		// Agent: "Let me see order-create schema"
		const detail = executeDetail(commands, exposedNames, { command: 'order-create' });
		expect(detail.data?.[0]?.found).toBe(true);

		// Agent: "Create an order"
		const result = await server.execute('order-create', { name: 'Test Order' });
		expect(result.success).toBe(true);
	});
});

describe('JTBD: Agent recovers from typo', () => {
	it('gets fuzzy suggestions and self-corrects', () => {
		const commands = createLargeCommandSet();
		const exposedNames = new Set(commands.map((c) => c.name));

		// Agent misspells command
		const detail = executeDetail(commands, exposedNames, { command: 'order-craete' });
		const entry = detail.data?.[0];
		expect(entry?.found).toBe(false);
		if (!entry?.found) {
			expect(entry?.error.suggestion).toContain('order-create');
		}

		// Agent uses correct name
		const retry = executeDetail(commands, exposedNames, { command: 'order-create' });
		expect(retry.data?.[0]?.found).toBe(true);
	});
});
