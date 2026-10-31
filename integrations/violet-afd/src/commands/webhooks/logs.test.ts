import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import type { WebhookDelivery } from '@lushly-dev/violet-core/types';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksLogsCommand } from './logs.js';
import { webhooksRegisterCommand } from './register.js';

describe('webhooks.logs command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;
	let webhookId: string;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Register a webhook
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'https://example.com/webhook',
				events: ['token.added'],
			},
			context,
		);
		webhookId = result.data?.webhook.id!;
	});

	it('should return empty logs for new webhook', async () => {
		const result = await webhooksLogsCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.logs).toEqual([]);
		expect(result.data?.total).toBe(0);
		expect(result.data?.webhookId).toBe(webhookId);
	});

	it('should fail for non-existent webhook', async () => {
		const result = await webhooksLogsCommand.handler({ id: 'wh_nonexistent' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('WEBHOOK_NOT_FOUND');
	});

	it('should return logs with deliveries', async () => {
		// Manually add delivery records (simulating webhook dispatch)
		const delivery: WebhookDelivery = {
			id: 'dlv_test1',
			webhookId,
			eventType: 'token.added',
			payload: JSON.stringify({ test: true }),
			status: 200,
			attempts: 1,
			deliveredAt: new Date().toISOString(),
			createdAt: new Date().toISOString(),
			response: 'OK',
		};
		await db.createDelivery(delivery);

		const result = await webhooksLogsCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.logs.length).toBe(1);
		expect(result.data?.logs[0].id).toBe('dlv_test1');
		expect(result.data?.logs[0].status).toBe(200);
	});

	it('should calculate summary statistics', async () => {
		// Add successful delivery
		await db.createDelivery({
			id: 'dlv_success1',
			webhookId,
			eventType: 'token.added',
			payload: '{}',
			status: 200,
			attempts: 1,
			deliveredAt: new Date().toISOString(),
			createdAt: new Date().toISOString(),
		});

		// Add failed delivery
		await db.createDelivery({
			id: 'dlv_fail1',
			webhookId,
			eventType: 'token.updated',
			payload: '{}',
			status: 500,
			attempts: 3,
			createdAt: new Date().toISOString(),
		});

		const result = await webhooksLogsCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.summary.totalDeliveries).toBe(2);
		expect(result.data?.summary.successRate).toBe(0.5); // 1 success out of 2
		expect(result.data?.summary.avgAttempts).toBe(2); // (1 + 3) / 2
	});

	it('should filter by success status', async () => {
		// Add successful delivery
		await db.createDelivery({
			id: 'dlv_success',
			webhookId,
			eventType: 'token.added',
			payload: '{}',
			status: 200,
			attempts: 1,
			createdAt: new Date().toISOString(),
		});

		// Add failed delivery
		await db.createDelivery({
			id: 'dlv_fail',
			webhookId,
			eventType: 'token.updated',
			payload: '{}',
			status: 500,
			attempts: 1,
			createdAt: new Date().toISOString(),
		});

		const result = await webhooksLogsCommand.handler({ id: webhookId, status: 'success' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.logs.length).toBe(1);
		expect(result.data?.logs[0].id).toBe('dlv_success');
	});

	it('should filter by failed status', async () => {
		await db.createDelivery({
			id: 'dlv_success',
			webhookId,
			eventType: 'token.added',
			payload: '{}',
			status: 200,
			attempts: 1,
			createdAt: new Date().toISOString(),
		});

		await db.createDelivery({
			id: 'dlv_fail',
			webhookId,
			eventType: 'token.updated',
			payload: '{}',
			status: 500,
			attempts: 1,
			createdAt: new Date().toISOString(),
		});

		const result = await webhooksLogsCommand.handler({ id: webhookId, status: 'failed' }, context);

		expect(result.success).toBe(true);
		expect(result.data?.logs.length).toBe(1);
		expect(result.data?.logs[0].id).toBe('dlv_fail');
	});

	it('should paginate logs', async () => {
		// Add 5 deliveries
		for (let i = 1; i <= 5; i++) {
			await db.createDelivery({
				id: `dlv_${i}`,
				webhookId,
				eventType: 'token.added',
				payload: '{}',
				status: 200,
				attempts: 1,
				createdAt: new Date().toISOString(),
			});
		}

		// Get first page
		const page1 = await webhooksLogsCommand.handler(
			{ id: webhookId, limit: 2, offset: 0 },
			context,
		);
		expect(page1.success).toBe(true);
		expect(page1.data?.logs.length).toBe(2);
		expect(page1.data?.total).toBe(5);

		// Get second page
		const page2 = await webhooksLogsCommand.handler(
			{ id: webhookId, limit: 2, offset: 2 },
			context,
		);
		expect(page2.success).toBe(true);
		expect(page2.data?.logs.length).toBe(2);
	});

	it('should apply default limit and offset', async () => {
		const result = await webhooksLogsCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(true);
		expect(result.data?.limit).toBe(50);
		expect(result.data?.offset).toBe(0);
	});
});
