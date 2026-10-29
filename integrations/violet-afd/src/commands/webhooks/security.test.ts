import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import type { WebhookDelivery } from '@lushly-dev/violet-core/types';
/**
 * Regression tests for webhook command-level security/integrity fixes:
 * SSRF URL policy, secrets in the audit log, response bodies in logs,
 * and clearing nodeFilter/description via update.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '../registry.js';
import { webhooksDeleteCommand } from './delete.js';
import { webhooksLogsCommand } from './logs.js';
import { webhooksRegisterCommand } from './register.js';
import { webhooksUpdateCommand } from './update.js';

describe('webhook command security', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(() => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };
	});

	async function register(overrides: Record<string, unknown> = {}) {
		return webhooksRegisterCommand.handler(
			{ url: 'https://example.com/webhook', events: ['token.added'], ...overrides },
			context,
		);
	}

	describe('URL policy (SSRF)', () => {
		it.each([
			'http://example.com/hook',
			'https://user:pass@example.com/hook',
			'https://169.254.169.254/latest/meta-data/',
			'https://10.0.0.5/hook',
			'https://192.168.0.1/hook',
			'https://172.20.0.1/hook',
			'https://100.64.0.1/hook',
			'https://[::2]/hook',
			'https://[fd00::1]/hook',
			'https://[::ffff:127.0.0.1]/hook',
			'https://0.0.0.0/hook',
			'https://127.0.0.2/hook',
		])('register rejects %s', async (url) => {
			const result = await register({ url });
			expect(result.success).toBe(false);
			expect(await db.listWebhooks()).toHaveLength(0);
		});

		it.each([
			'http://localhost:3000/hook',
			'http://127.0.0.1:3000/hook',
			'http://[::1]:3000/hook',
			'https://example.com/hook',
		])('register still allows %s', async (url) => {
			expect((await register({ url })).success).toBe(true);
		});

		it('update rejects private or credentialed URLs and leaves the webhook unchanged', async () => {
			const created = await register();
			const id = created.data?.webhook.id as string;

			for (const url of [
				'https://169.254.169.254/',
				'https://10.1.1.1/hook',
				'https://u:p@example.com/hook',
				'http://example.com/hook',
			]) {
				const result = await webhooksUpdateCommand.handler({ id, url }, context);
				expect(result.success).toBe(false);
				expect(result.error?.code).toBe('INVALID_URL');
			}
			expect((await db.getWebhook(id))?.url).toBe('https://example.com/webhook');
		});
	});

	describe('audit log never contains secrets', () => {
		it('register', async () => {
			const result = await register({ secret: 'my-custom-secret-123456' });
			expect(result.data?.secret).toBe('my-custom-secret-123456');

			const events = await db.getAuditEvents({ eventType: 'webhook_registered' });
			expect(events).toHaveLength(1);
			expect(JSON.stringify(events)).not.toContain('my-custom-secret-123456');
			expect(JSON.parse(events[0].newValue as string).secret).toBe('[REDACTED]');
		});

		it('update with regenerated secret', async () => {
			const created = await register({ secret: 'my-custom-secret-123456' });
			const id = created.data?.webhook.id as string;

			const result = await webhooksUpdateCommand.handler(
				{ id, regenerateSecret: true, description: 'x' },
				context,
			);
			const newSecret = result.data?.secret as string;
			expect(newSecret).toBeTruthy();

			const events = await db.getAuditEvents({ eventType: 'webhook_updated' });
			const serialized = JSON.stringify(events);
			expect(serialized).not.toContain('my-custom-secret-123456');
			expect(serialized).not.toContain(newSecret);
		});

		it('delete', async () => {
			const created = await register({ secret: 'my-custom-secret-123456' });
			const id = created.data?.webhook.id as string;

			await webhooksDeleteCommand.handler({ id, confirm: true }, context);

			const events = await db.getAuditEvents({ eventType: 'webhook_deleted' });
			expect(events).toHaveLength(1);
			expect(JSON.stringify(events)).not.toContain('my-custom-secret-123456');
		});
	});

	describe('regenerateSecret', () => {
		it('stores the secret that it returns', async () => {
			const created = await register();
			const id = created.data?.webhook.id as string;

			const result = await webhooksUpdateCommand.handler({ id, regenerateSecret: true }, context);

			expect((await db.getWebhook(id))?.secret).toBe(result.data?.secret);
			expect(result.data?.secret).not.toBe(created.data?.secret);
		});
	});

	describe('clearing optional fields', () => {
		it('null clears nodeFilter and description', async () => {
			const created = await register({ nodeFilter: 'xbox', description: 'desc' });
			const id = created.data?.webhook.id as string;

			const result = await webhooksUpdateCommand.handler(
				{ id, nodeFilter: null, description: null },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.nodeFilter).toBeNull();
			expect(result.data?.description).toBeNull();
			const stored = await db.getWebhook(id);
			expect(stored?.nodeFilter).toBeUndefined();
			expect(stored?.description).toBeUndefined();
		});

		it('omitting them leaves them untouched', async () => {
			const created = await register({ nodeFilter: 'xbox', description: 'desc' });
			const id = created.data?.webhook.id as string;

			await webhooksUpdateCommand.handler({ id, active: false }, context);

			const stored = await db.getWebhook(id);
			expect(stored?.nodeFilter).toBe('xbox');
			expect(stored?.description).toBe('desc');
		});
	});

	describe('webhooks.logs', () => {
		it('does not return stored response bodies', async () => {
			const created = await register();
			const id = created.data?.webhook.id as string;
			const base: WebhookDelivery = {
				id: 'del_a',
				webhookId: id,
				eventType: 'token.added',
				payload: '{}',
				status: 200,
				attempts: 1,
				createdAt: '2026-01-01T00:00:01.000Z',
				deliveredAt: '2026-01-01T00:00:01.000Z',
				// legacy row from before bodies stopped being stored
				response: '{"internal":"LEGACY-BODY"}',
			};
			await db.createDelivery(base);
			await db.createDelivery({
				...base,
				id: 'del_b',
				status: 500,
				deliveredAt: undefined,
				createdAt: '2026-01-01T00:00:02.000Z',
				response: `HTTP 500${'x'.repeat(1000)}`,
			});

			const result = await webhooksLogsCommand.handler({ id }, context);

			expect(JSON.stringify(result.data)).not.toContain('LEGACY-BODY');
			const byId = Object.fromEntries((result.data?.logs ?? []).map((l) => [l.id, l]));
			expect(byId.del_a.response).toBeUndefined();
			expect((byId.del_b.response ?? '').length).toBeLessThanOrEqual(200);
		});
	});
});
