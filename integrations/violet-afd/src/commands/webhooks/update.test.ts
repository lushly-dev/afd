import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksGetCommand } from './get.js';
import { webhooksRegisterCommand } from './register.js';
import { webhooksUpdateCommand } from './update.js';

describe('webhooks.update command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;
	let webhookId: string;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Register a webhook for testing updates
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
				description: 'Original description',
			},
			context,
		);
		webhookId = result.data?.webhook.id!;
	});

	it('should update webhook URL', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, url: 'https://new-url.com/webhook' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.url).toBe('https://new-url.com/webhook');
	});

	it('should update webhook events', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, events: ['node.created', 'node.deleted'] },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.events).toEqual(['node.created', 'node.deleted']);
	});

	it('should update webhook description', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, description: 'Updated description' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.description).toBe('Updated description');
	});

	it('should update webhook node filter', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, nodeFilter: 'xbox.*' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeFilter).toBe('xbox.*');
	});

	it('should clear node filter with null', async () => {
		// First set a filter
		await webhooksUpdateCommand.handler({ id: webhookId, nodeFilter: 'xbox.*' }, context);

		// Then clear it
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, nodeFilter: null },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.nodeFilter).toBeNull();
	});

	it('should deactivate webhook', async () => {
		const result = await webhooksUpdateCommand.handler({ id: webhookId, active: false }, context);

		expect(result.success).toBe(true);
		expect(result.data?.active).toBe(false);
	});

	it('should reactivate webhook', async () => {
		// Deactivate first
		await webhooksUpdateCommand.handler({ id: webhookId, active: false }, context);

		// Reactivate
		const result = await webhooksUpdateCommand.handler({ id: webhookId, active: true }, context);

		expect(result.success).toBe(true);
		expect(result.data?.active).toBe(true);
	});

	it('should regenerate secret when requested', async () => {
		// Get original (we don't have access to it after registration, but we can check new one is returned)
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, regenerateSecret: true },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.secret).toBeDefined();
		expect(result.data?.secret?.length).toBeGreaterThanOrEqual(32);
	});

	it('should not return secret when regenerateSecret is false', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, description: 'New description' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.secret).toBeUndefined();
	});

	it('should fail for non-existent webhook', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: 'wh_nonexistent', description: 'Test' },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('WEBHOOK_NOT_FOUND');
	});

	it('should reject non-HTTPS URL for non-localhost', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, url: 'http://example.com/webhook' },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('INVALID_URL');
	});

	it('should allow localhost URL update', async () => {
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, url: 'http://localhost:3000/webhook' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.url).toBe('http://localhost:3000/webhook');
	});

	it('should update timestamp on modification', async () => {
		// Get original
		const original = await webhooksGetCommand.handler({ id: webhookId }, context);
		const originalUpdatedAt = original.data?.updatedAt;

		// Wait a tiny bit to ensure different timestamp
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Update
		const result = await webhooksUpdateCommand.handler(
			{ id: webhookId, description: 'Updated' },
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.updatedAt).not.toBe(originalUpdatedAt);
	});

	it('should update multiple fields at once', async () => {
		const result = await webhooksUpdateCommand.handler(
			{
				id: webhookId,
				url: 'https://new-url.com/webhook',
				events: ['node.created'],
				description: 'New description',
				active: false,
			},
			context,
		);

		expect(result.success).toBe(true);
		expect(result.data?.url).toBe('https://new-url.com/webhook');
		expect(result.data?.events).toEqual(['node.created']);
		expect(result.data?.description).toBe('New description');
		expect(result.data?.active).toBe(false);
	});
});
