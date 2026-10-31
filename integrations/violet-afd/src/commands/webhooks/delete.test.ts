import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksDeleteCommand } from './delete.js';
import { webhooksGetCommand } from './get.js';
import { webhooksListCommand } from './list.js';
import { webhooksRegisterCommand } from './register.js';

describe('webhooks.delete command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;
	let webhookId: string;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Register a webhook for testing deletion
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
			},
			context,
		);
		webhookId = result.data?.webhook.id!;
	});

	it('should require confirmation to delete', async () => {
		const result = await webhooksDeleteCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CONFIRMATION_REQUIRED');
	});

	it('should require explicit confirm=true', async () => {
		const result = await webhooksDeleteCommand.handler({ id: webhookId, confirm: false }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('CONFIRMATION_REQUIRED');
	});

	it('should delete webhook with confirmation', async () => {
		const result = await webhooksDeleteCommand.handler({ id: webhookId, confirm: true }, context);

		expect(result.success).toBe(true);
		expect(result.data?.id).toBe(webhookId);
		expect(result.data?.deleted).toBe(true);
	});

	it('should remove webhook from database', async () => {
		await webhooksDeleteCommand.handler({ id: webhookId, confirm: true }, context);

		// Verify webhook no longer exists
		const getResult = await webhooksGetCommand.handler({ id: webhookId }, context);
		expect(getResult.success).toBe(false);
		expect(getResult.error?.code).toBe('WEBHOOK_NOT_FOUND');
	});

	it('should remove webhook from list', async () => {
		// Verify webhook is in list
		const beforeList = await webhooksListCommand.handler({}, context);
		expect(beforeList.data?.total).toBe(1);

		// Delete
		await webhooksDeleteCommand.handler({ id: webhookId, confirm: true }, context);

		// Verify webhook is not in list
		const afterList = await webhooksListCommand.handler({}, context);
		expect(afterList.data?.total).toBe(0);
	});

	it('should fail for non-existent webhook', async () => {
		const result = await webhooksDeleteCommand.handler(
			{ id: 'wh_nonexistent', confirm: true },
			context,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('WEBHOOK_NOT_FOUND');
	});

	it('should return count of deleted deliveries', async () => {
		const result = await webhooksDeleteCommand.handler({ id: webhookId, confirm: true }, context);

		expect(result.success).toBe(true);
		expect(result.data?.deliveriesDeleted).toBeDefined();
		expect(typeof result.data?.deliveriesDeleted).toBe('number');
	});

	it('should create audit event for deletion', async () => {
		await webhooksDeleteCommand.handler({ id: webhookId, confirm: true }, context);

		// Verify audit event was created
		const events = await db.getAuditEvents({});
		const deleteEvent = events.find(
			(e: { eventType: string }) => e.eventType === 'webhook_deleted',
		);
		expect(deleteEvent).toBeDefined();
		expect(deleteEvent?.actor).toBe('test');
	});
});
