import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksListCommand } from './list.js';
import { webhooksRegisterCommand } from './register.js';

describe('webhooks.list command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(() => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
	});

	it('should return empty list when no webhooks exist', async () => {
		const result = await webhooksListCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.data?.webhooks).toEqual([]);
		expect(result.data?.total).toBe(0);
	});

	it('should list all registered webhooks', async () => {
		// Register two webhooks
		await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/hook1', events: ['token.added'] },
			context,
		);
		await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/hook2', events: ['node.created'] },
			context,
		);

		const result = await webhooksListCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.data?.webhooks.length).toBe(2);
		expect(result.data?.total).toBe(2);
	});

	it('should not return webhook secrets in list', async () => {
		await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/hook', events: ['token.added'] },
			context,
		);

		const result = await webhooksListCommand.handler({}, context);

		expect(result.success).toBe(true);
		// @ts-expect-error - checking secret is not returned
		expect(result.data?.webhooks[0].secret).toBeUndefined();
	});

	it('should filter by active status', async () => {
		await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/active',
				events: ['token.added'],
				active: true,
			},
			context,
		);
		await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/inactive',
				events: ['token.added'],
				active: false,
			},
			context,
		);

		const activeResult = await webhooksListCommand.handler({ active: true }, context);
		expect(activeResult.success).toBe(true);
		expect(activeResult.data?.webhooks.length).toBe(1);
		expect(activeResult.data?.webhooks[0].url).toBe('https://example.com/active');

		const inactiveResult = await webhooksListCommand.handler({ active: false }, context);
		expect(inactiveResult.success).toBe(true);
		expect(inactiveResult.data?.webhooks.length).toBe(1);
		expect(inactiveResult.data?.webhooks[0].url).toBe('https://example.com/inactive');
	});

	it('should filter by event type', async () => {
		await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/tokens',
				events: ['token.added', 'token.updated'],
			},
			context,
		);
		await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/nodes',
				events: ['node.created', 'node.deleted'],
			},
			context,
		);

		const result = await webhooksListCommand.handler({ event: 'token.added' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.webhooks.length).toBe(1);
		expect(result.data?.webhooks[0].url).toBe('https://example.com/tokens');
	});

	it('should paginate results', async () => {
		// Register 5 webhooks
		for (let i = 1; i <= 5; i++) {
			await webhooksRegisterCommand.handler(
				{ url: `https://example.com/hook${i}`, events: ['token.added'] },
				context,
			);
		}

		// Get first page (2 items)
		const page1 = await webhooksListCommand.handler({ limit: 2, offset: 0 }, context);
		expect(page1.success).toBe(true);
		expect(page1.data?.webhooks.length).toBe(2);
		expect(page1.data?.total).toBe(5);
		expect(page1.data?.limit).toBe(2);
		expect(page1.data?.offset).toBe(0);

		// Get second page
		const page2 = await webhooksListCommand.handler({ limit: 2, offset: 2 }, context);
		expect(page2.success).toBe(true);
		expect(page2.data?.webhooks.length).toBe(2);

		// Get last page
		const page3 = await webhooksListCommand.handler({ limit: 2, offset: 4 }, context);
		expect(page3.success).toBe(true);
		expect(page3.data?.webhooks.length).toBe(1);
	});

	it('should apply default limit and offset', async () => {
		const result = await webhooksListCommand.handler({}, context);

		expect(result.success).toBe(true);
		expect(result.data?.limit).toBe(50);
		expect(result.data?.offset).toBe(0);
	});
});
