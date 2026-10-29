import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksGetCommand } from './get.js';
import { webhooksRegisterCommand } from './register.js';

describe('webhooks.get command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(() => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
	});

	it('should get webhook by ID', async () => {
		// Register a webhook
		const registerResult = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added', 'token.updated'],
				description: 'Test webhook',
			},
			context,
		);
		const webhookId = registerResult.data?.webhook.id!;

		const result = await webhooksGetCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.id).toBe(webhookId);
		expect(result.data?.url).toBe('https://example.com/webhook');
		expect(result.data?.events).toEqual(['token.added', 'token.updated']);
		expect(result.data?.description).toBe('Test webhook');
		expect(result.data?.active).toBe(true);
	});

	it('should not return secret in get response', async () => {
		const registerResult = await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/webhook', events: ['token.added'] },
			context,
		);
		const webhookId = registerResult.data?.webhook.id!;

		const result = await webhooksGetCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		// @ts-expect-error - checking secret is not returned
		expect(result.data?.secret).toBeUndefined();
	});

	it('should fail for non-existent webhook', async () => {
		const result = await webhooksGetCommand.handler({ id: 'wh_nonexistent' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('WEBHOOK_NOT_FOUND');
	});

	it('should include stats when requested', async () => {
		const registerResult = await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/webhook', events: ['token.added'] },
			context,
		);
		const webhookId = registerResult.data?.webhook.id!;

		const result = await webhooksGetCommand.handler({ id: webhookId, includeStats: true }, context);

		expect(result.success).toBe(true);
		expect(result.data?.stats).toBeDefined();
		expect(result.data?.stats?.totalDeliveries).toBe(0);
		expect(result.data?.stats?.successfulDeliveries).toBe(0);
		expect(result.data?.stats?.failedDeliveries).toBe(0);
	});

	it('should not include stats by default', async () => {
		const registerResult = await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/webhook', events: ['token.added'] },
			context,
		);
		const webhookId = registerResult.data?.webhook.id!;

		const result = await webhooksGetCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.stats).toBeUndefined();
	});

	it('should return correct timestamps', async () => {
		const registerResult = await webhooksRegisterCommand.handler(
			{ url: 'https://example.com/webhook', events: ['token.added'] },
			context,
		);
		const webhookId = registerResult.data?.webhook.id!;

		const result = await webhooksGetCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.createdAt).toBeDefined();
		expect(result.data?.updatedAt).toBeDefined();
		// Timestamps should be ISO format
		expect(() => new Date(result.data?.createdAt!)).not.toThrow();
	});
});
