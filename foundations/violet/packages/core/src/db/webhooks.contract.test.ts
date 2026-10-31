/**
 * Webhook storage contract: every Database adapter must behave identically for
 * these scenarios. Runs against MemoryDatabase, SQLiteDatabase(':memory:') and,
 * when VIOLET_TEST_POSTGRES_URL is set, Postgres in a schema of its own per test
 * (see store-adapters.test-support.ts for running that leg locally).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../storage.js';
import type { Webhook, WebhookDelivery } from '../types/webhook.js';
import { isolatedStoreAdapters } from './store-adapters.test-support.js';

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
	return {
		id: 'wh_1',
		url: 'https://example.com/hook',
		secret: 'original-secret-0123456789',
		events: ['token.added'],
		nodeFilter: 'xbox',
		description: 'original description',
		active: true,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
	return {
		id: 'del_1',
		webhookId: 'wh_1',
		eventType: 'token.added',
		payload: '{}',
		status: null,
		attempts: 0,
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

for (const { name, create, skip } of isolatedStoreAdapters)
	describe.skipIf(skip)(`webhook storage contract: ${name}`, () => {
		let db: Database;
		let close: () => Promise<void> = async () => {};

		beforeEach(async () => {
			({ db, close } = await create());
			await db.createWebhook(makeWebhook());
		});

		afterEach(async () => {
			await close();
		});

		describe('updateWebhook', () => {
			it('persists a regenerated secret', async () => {
				await db.updateWebhook('wh_1', { secret: 'brand-new-secret-9876543210' });
				expect((await db.getWebhook('wh_1'))?.secret).toBe('brand-new-secret-9876543210');
			});

			it('clears nodeFilter and description when null', async () => {
				await db.updateWebhook('wh_1', { nodeFilter: null, description: null });
				const updated = await db.getWebhook('wh_1');
				expect(updated?.nodeFilter).toBeUndefined();
				expect(updated?.description).toBeUndefined();
			});

			it('leaves fields unchanged when undefined', async () => {
				await db.updateWebhook('wh_1', {
					nodeFilter: undefined,
					description: undefined,
					url: undefined,
					active: false,
				});
				const updated = await db.getWebhook('wh_1');
				expect(updated?.nodeFilter).toBe('xbox');
				expect(updated?.description).toBe('original description');
				expect(updated?.url).toBe('https://example.com/hook');
				expect(updated?.active).toBe(false);
			});

			it('updates events and url and bumps updatedAt', async () => {
				await db.updateWebhook('wh_1', {
					url: 'https://example.com/other',
					events: ['node.created', 'node.deleted'],
				});
				const updated = await db.getWebhook('wh_1');
				expect(updated?.url).toBe('https://example.com/other');
				expect(updated?.events).toEqual(['node.created', 'node.deleted']);
				expect(updated?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
				expect(updated?.createdAt).toBe('2026-01-01T00:00:00.000Z');
			});

			it('is a no-op for an unknown webhook', async () => {
				await expect(db.updateWebhook('wh_missing', { active: false })).resolves.toBeUndefined();
				expect(await db.getWebhook('wh_missing')).toBeNull();
			});
		});

		describe('updateDelivery', () => {
			it('clears nextRetryAt, response and deliveredAt when null', async () => {
				await db.createDelivery(
					makeDelivery({
						attempts: 1,
						status: 500,
						response: 'HTTP 500',
						nextRetryAt: '2030-01-01T00:00:00.000Z',
						deliveredAt: '2026-01-02T00:00:00.000Z',
					}),
				);
				await db.updateDelivery('del_1', { nextRetryAt: null, response: null, deliveredAt: null });
				const updated = await db.getDelivery('del_1');
				expect(updated?.nextRetryAt).toBeUndefined();
				expect(updated?.response).toBeUndefined();
				expect(updated?.deliveredAt).toBeUndefined();
				expect(updated?.status).toBe(500);
			});

			it('leaves fields unchanged when undefined', async () => {
				await db.createDelivery(
					makeDelivery({ attempts: 1, status: 500, nextRetryAt: '2030-01-01T00:00:00.000Z' }),
				);
				await db.updateDelivery('del_1', { nextRetryAt: undefined, attempts: 2 });
				const updated = await db.getDelivery('del_1');
				expect(updated?.nextRetryAt).toBe('2030-01-01T00:00:00.000Z');
				expect(updated?.attempts).toBe(2);
			});

			it('stops being returned by getPendingDeliveries once nextRetryAt is cleared', async () => {
				await db.createDelivery(
					makeDelivery({ attempts: 1, status: 500, nextRetryAt: '2020-01-01T00:00:00.000Z' }),
				);
				expect(await db.getPendingDeliveries()).toHaveLength(1);
				await db.updateDelivery('del_1', { nextRetryAt: null });
				expect(await db.getPendingDeliveries()).toHaveLength(0);
			});
		});

		describe('listDeliveries status filters', () => {
			beforeEach(async () => {
				// ok: 2xx
				await db.createDelivery(
					makeDelivery({
						id: 'del_ok',
						status: 200,
						attempts: 1,
						deliveredAt: '2026-01-01T00:00:01.000Z',
						createdAt: '2026-01-01T00:00:01.000Z',
					}),
				);
				// http failure, retries exhausted
				await db.createDelivery(
					makeDelivery({
						id: 'del_http_failed',
						status: 500,
						attempts: 6,
						createdAt: '2026-01-01T00:00:02.000Z',
					}),
				);
				// network failure (no status), retries exhausted
				await db.createDelivery(
					makeDelivery({
						id: 'del_network_failed',
						status: null,
						attempts: 6,
						response: 'Network error',
						createdAt: '2026-01-01T00:00:03.000Z',
					}),
				);
				// network failure, retry still scheduled
				await db.createDelivery(
					makeDelivery({
						id: 'del_retrying',
						status: null,
						attempts: 1,
						nextRetryAt: '2030-01-01T00:00:00.000Z',
						createdAt: '2026-01-01T00:00:04.000Z',
					}),
				);
				// brand new, never attempted
				await db.createDelivery(
					makeDelivery({
						id: 'del_new',
						status: null,
						attempts: 0,
						createdAt: '2026-01-01T00:00:05.000Z',
					}),
				);
			});

			const ids = async (status: 'success' | 'failed' | 'pending') =>
				(await db.listDeliveries({ webhookId: 'wh_1', status })).map((d) => d.id).sort();

			it('success: only 2xx', async () => {
				expect(await ids('success')).toEqual(['del_ok']);
			});

			it('failed: includes network failures with NULL status once retries are exhausted', async () => {
				expect(await ids('failed')).toEqual(['del_http_failed', 'del_network_failed']);
			});

			it('pending: scheduled retries and never-attempted deliveries', async () => {
				expect(await ids('pending')).toEqual(['del_new', 'del_retrying']);
			});

			it('orders newest first and honours limit', async () => {
				const limited = await db.listDeliveries({ webhookId: 'wh_1', limit: 2 });
				expect(limited.map((d) => d.id)).toEqual(['del_new', 'del_retrying']);
			});

			it('treats a non-numeric limit as the default instead of interpolating it', async () => {
				const rows = await db.listDeliveries({
					webhookId: 'wh_1',
					limit: '1 OFFSET 4' as unknown as number,
				});
				expect(rows).toHaveLength(5);
			});
		});
	});
