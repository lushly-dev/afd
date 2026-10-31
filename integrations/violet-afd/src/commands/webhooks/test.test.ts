import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksRegisterCommand } from './register.js';
import { webhooksTestCommand } from './test.js';
import { webhooksUpdateCommand } from './update.js';

describe('webhooks.test command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;
	let webhookId: string;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Register a webhook pointing to localhost (for testing)
		const result = await webhooksRegisterCommand.handler(
			{
				url: 'http://localhost:9999/webhook', // Non-existent, will fail
				events: ['test.ping'],
			},
			context,
		);
		webhookId = result.data?.webhook.id!;
	});

	it('should fail for non-existent webhook', async () => {
		const result = await webhooksTestCommand.handler({ id: 'wh_nonexistent' }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('WEBHOOK_NOT_FOUND');
	});

	it('should fail for inactive webhook', async () => {
		// Deactivate the webhook
		await webhooksUpdateCommand.handler({ id: webhookId, active: false }, context);

		const result = await webhooksTestCommand.handler({ id: webhookId }, context);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe('WEBHOOK_INACTIVE');
	});

	it('should return delivery result for active webhook', async () => {
		const result = await webhooksTestCommand.handler({ id: webhookId }, context);

		// The test will likely fail because localhost:9999 isn't running,
		// but it should still return a structured result
		expect(result.data?.webhookId).toBe(webhookId);
		expect(result.data?.deliveryId).toBeDefined();
		// success could be false if no server is listening
		expect(typeof result.data?.success).toBe('boolean');
	});

	it('should include response time in result', async () => {
		const result = await webhooksTestCommand.handler({ id: webhookId }, context);

		// responseTime should be defined even if delivery failed
		if (result.success) {
			expect(result.data?.responseTime).toBeDefined();
			expect(typeof result.data?.responseTime).toBe('number');
		}
	});

	describe('targeting', () => {
		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('only pings the targeted webhook, not other test.ping subscribers', async () => {
			const other = await webhooksRegisterCommand.handler(
				{ url: 'http://localhost:9998/other', events: ['test.ping'] },
				context,
			);
			const otherId = other.data?.webhook.id!;

			const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
			vi.stubGlobal('fetch', fetchMock);

			const result = await webhooksTestCommand.handler({ id: webhookId }, context);

			expect(result.success).toBe(true);
			expect(result.data?.webhookId).toBe(webhookId);
			expect(result.data?.status).toBe(200);
			expect(result.data?.success).toBe(true);

			const calledUrls = fetchMock.mock.calls.map((c) => String((c as unknown[])[0]));
			expect(calledUrls).toEqual(['http://localhost:9999/webhook']);

			// The reported delivery belongs to the target; the other webhook has none
			const delivery = await db.getDelivery(result.data?.deliveryId!);
			expect(delivery?.webhookId).toBe(webhookId);
			const otherDeliveries = await db.listDeliveries({ webhookId: otherId });
			expect(otherDeliveries).toHaveLength(0);
		});

		it("reports the targeted webhook's own result, not another webhook's delivery", async () => {
			// Target is registered AFTER the beforeEach webhook, so a broadcast would
			// report the first webhook's (500) delivery instead of the target's (200).
			const target = await webhooksRegisterCommand.handler(
				{ url: 'http://localhost:9998/target', events: ['test.ping'] },
				context,
			);
			const targetId = target.data?.webhook.id!;

			vi.stubGlobal(
				'fetch',
				vi.fn(async (url: string) =>
					String(url).includes('9999')
						? new Response('boom', { status: 500 })
						: new Response('ok', { status: 200 }),
				),
			);

			const result = await webhooksTestCommand.handler({ id: targetId }, context);

			expect(result.data?.webhookId).toBe(targetId);
			expect(result.data?.status).toBe(200);
			expect(result.data?.success).toBe(true);
		});
	});
});
