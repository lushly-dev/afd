import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import type { Webhook, WebhookEvent } from '@lushly-dev/violet-core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhookDispatcher } from './dispatcher.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

const event: WebhookEvent = {
	id: 'evt_1',
	type: 'token.added',
	timestamp: '2026-01-01T00:00:00.000Z',
	data: { nodeId: 'xbox', tokenId: 'color.primary', value: '#fff' },
};

function makeWebhook(id: string, overrides: Partial<Webhook> = {}): Webhook {
	return {
		id,
		url: `https://${id}.example.com/hook`,
		secret: 'a-sufficiently-long-secret',
		events: ['token.added'],
		active: true,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

describe('WebhookDispatcher', () => {
	let db: ReturnType<typeof createMemoryDatabase>;

	beforeEach(() => {
		db = createMemoryDatabase();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	describe('SSRF protection', () => {
		it('refuses to deliver when the host now resolves to a private address (DNS rebinding)', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
			const dispatcher = new WebhookDispatcher({
				db,
				fetch: fetchMock,
				lookup: async () => [{ address: '169.254.169.254', family: 4 }],
			});

			const [deliveryId] = await dispatcher.dispatch(event);

			expect(fetchMock).not.toHaveBeenCalled();
			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.status).toBeNull();
			expect(delivery?.response).toMatch(/^Blocked:/);
		});

		it('re-resolves DNS before every attempt, not just the first', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			let rebound = false;
			const lookup = vi.fn(async () =>
				rebound ? [{ address: '10.0.0.7', family: 4 }] : [{ address: '93.184.216.34', family: 4 }],
			);
			const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup });

			const [deliveryId] = await dispatcher.dispatch(event);
			expect(fetchMock).toHaveBeenCalledTimes(1);

			rebound = true;
			const retry = await dispatcher.retryDelivery(deliveryId);

			expect(lookup).toHaveBeenCalledTimes(2);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(retry.success).toBe(false);
			expect(retry.response).toMatch(/^Blocked:/);
		});

		it('refuses to deliver to a webhook whose stored URL is a private literal', async () => {
			await db.createWebhook(makeWebhook('wh_1', { url: 'https://192.168.1.5/hook' }));
			const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			await dispatcher.dispatch(event);

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('allows private destinations only with the explicit allowPrivate option', async () => {
			await db.createWebhook(makeWebhook('wh_1', { url: 'https://192.168.1.5/hook' }));
			const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, allowPrivate: true });

			await dispatcher.dispatch(event);

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('allows private destinations when VIOLET_WEBHOOK_ALLOW_PRIVATE=1', async () => {
			vi.stubEnv('VIOLET_WEBHOOK_ALLOW_PRIVATE', '1');
			await db.createWebhook(makeWebhook('wh_1', { url: 'https://192.168.1.5/hook' }));
			const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock });

			await dispatcher.dispatch(event);

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('keeps delivering to explicit dev loopback hosts without DNS checks', async () => {
			await db.createWebhook(makeWebhook('wh_1', { url: 'http://localhost:9999/hook' }));
			const lookup = vi.fn(publicLookup);
			const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup });

			await dispatcher.dispatch(event);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(lookup).not.toHaveBeenCalled();
		});

		it('does not follow redirects and records a 3xx as a failed delivery', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: 'http://169.254.169.254/latest/meta-data/' },
					}),
			);
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const [deliveryId] = await dispatcher.dispatch(event);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
			expect(init.redirect).toBe('manual');

			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.status).toBe(302);
			expect(delivery?.deliveredAt).toBeUndefined();
			expect(delivery?.response).toContain('Redirect not followed');
			expect(delivery?.nextRetryAt).toBeDefined(); // scheduled for retry like any failure
		});
	});

	describe('response handling', () => {
		it('never persists the target response body', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(
				async () => new Response('INTERNAL-SECRET-BODY stack trace ...', { status: 500 }),
			);
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const [deliveryId] = await dispatcher.dispatch(event);

			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.status).toBe(500);
			expect(delivery?.response).toBe('HTTP 500');
			expect(JSON.stringify(delivery)).not.toContain('INTERNAL-SECRET-BODY');
		});

		it('does not read the response body (it cancels it)', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const text = vi.fn(async () => 'should not be read');
			const cancel = vi.fn(async () => {});
			const fetchMock = vi.fn(async () => ({
				status: 200,
				ok: true,
				type: 'basic',
				body: { cancel },
				text,
			})) as unknown as typeof fetch;
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const [deliveryId] = await dispatcher.dispatch(event);

			expect(text).not.toHaveBeenCalled();
			expect(cancel).toHaveBeenCalled();
			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.status).toBe(200);
			expect(delivery?.response).toBeUndefined();
			expect(delivery?.deliveredAt).toBeDefined();
		});

		it('stores only a short generic error for network failures', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(async () => {
				throw Object.assign(new TypeError('fetch failed to 10.1.2.3:5432 internal detail'), {
					cause: { code: 'ECONNREFUSED' },
				});
			});
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const [deliveryId] = await dispatcher.dispatch(event);

			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.status).toBeNull();
			expect(delivery?.response).toBe('Network error (ECONNREFUSED)');
		});
	});

	describe('timeouts', () => {
		it('clears the timeout timer when the request rejects', async () => {
			vi.useFakeTimers();
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(async () => {
				throw new TypeError('fetch failed');
			});
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			await dispatcher.dispatch(event);

			expect(vi.getTimerCount()).toBe(0);
		});

		it('clears the timeout timer after a successful response', async () => {
			vi.useFakeTimers();
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			await dispatcher.dispatch(event);

			expect(vi.getTimerCount()).toBe(0);
		});

		it('aborts a hung request after the timeout and records a timeout error', async () => {
			vi.useFakeTimers();
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(
				(_url: string, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
						);
					}),
			) as unknown as typeof fetch;
			const dispatcher = new WebhookDispatcher({
				db,
				fetch: fetchMock,
				lookup: publicLookup,
				requestTimeout: 1_000,
			});

			const pending = dispatcher.dispatch(event);
			await vi.advanceTimersByTimeAsync(1_000);
			const [deliveryId] = await pending;

			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.response).toBe('Request timed out');
			expect(vi.getTimerCount()).toBe(0);
		});

		it('unrefs its timers so they cannot keep the process alive', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const unref = vi.fn();
			const realSetTimeout = globalThis.setTimeout;
			const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
				fn: () => void,
				ms?: number,
			) => {
				const t = realSetTimeout(fn, ms);
				const originalUnref = t.unref.bind(t);
				t.unref = () => {
					unref();
					return originalUnref();
				};
				return t;
			}) as unknown as typeof setTimeout);
			const dispatcher = new WebhookDispatcher({
				db,
				fetch: vi.fn(async () => new Response(null, { status: 200 })),
				lookup: publicLookup,
			});

			await dispatcher.dispatch(event);
			spy.mockRestore();

			expect(unref).toHaveBeenCalled();
		});
	});

	describe('fan-out concurrency', () => {
		it('limits in-flight deliveries to the configured cap (default 5)', async () => {
			for (let i = 0; i < 12; i++) await db.createWebhook(makeWebhook(`wh_${i}`));

			let inFlight = 0;
			let maxInFlight = 0;
			const fetchMock = vi.fn(async () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight--;
				return new Response(null, { status: 200 });
			});
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const ids = await dispatcher.dispatch(event);

			expect(ids).toHaveLength(12);
			expect(fetchMock).toHaveBeenCalledTimes(12);
			expect(maxInFlight).toBeLessThanOrEqual(5);
			expect(maxInFlight).toBeGreaterThan(1);
		});
	});

	describe('retry schedule', () => {
		it('uses every delay (including 12h) and stops after 6 attempts, clearing nextRetryAt', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const [deliveryId] = await dispatcher.dispatch(event);

			const expectedDelays = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
			for (let attempt = 1; attempt <= 5; attempt++) {
				const delivery = await db.getDelivery(deliveryId);
				expect(delivery?.attempts).toBe(attempt);
				const delay = new Date(delivery?.nextRetryAt as string).getTime() - Date.now();
				expect(Math.abs(delay - expectedDelays[attempt - 1])).toBeLessThan(5_000);
				await dispatcher.retryDelivery(deliveryId);
			}

			const final = await db.getDelivery(deliveryId);
			expect(final?.attempts).toBe(6);
			expect(final?.nextRetryAt).toBeUndefined();
			expect(await db.getPendingDeliveries()).toHaveLength(0);
			expect(await db.listDeliveries({ status: 'failed' })).toHaveLength(1);
		});

		it('counts network failures (no status) as failed once retries are exhausted', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			const dispatcher = new WebhookDispatcher({
				db,
				fetch: vi.fn(async () => {
					throw new TypeError('fetch failed');
				}),
				lookup: publicLookup,
			});

			const [deliveryId] = await dispatcher.dispatch(event);
			for (let i = 0; i < 5; i++) await dispatcher.retryDelivery(deliveryId);

			expect(await db.listDeliveries({ status: 'failed' })).toHaveLength(1);
		});

		it('clears a stale error string once a retry succeeds', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			let status = 500;
			const fetchMock = vi.fn(async () => new Response(null, { status }));
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const [deliveryId] = await dispatcher.dispatch(event);
			expect((await db.getDelivery(deliveryId))?.response).toBe('HTTP 500');

			status = 200;
			await dispatcher.retryDelivery(deliveryId);

			const delivery = await db.getDelivery(deliveryId);
			expect(delivery?.response).toBeUndefined();
			expect(delivery?.nextRetryAt).toBeUndefined();
			expect(delivery?.deliveredAt).toBeDefined();
		});

		it('processRetries does not double-deliver when sweeps overlap', async () => {
			await db.createWebhook(makeWebhook('wh_1'));
			await db.createDelivery({
				id: 'del_due',
				webhookId: 'wh_1',
				eventType: 'token.added',
				payload: JSON.stringify(event),
				status: 500,
				attempts: 1,
				nextRetryAt: '2020-01-01T00:00:00.000Z',
				createdAt: '2020-01-01T00:00:00.000Z',
			});
			let release: () => void = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const fetchMock = vi.fn(async () => {
				await gate;
				return new Response(null, { status: 200 });
			});
			const dispatcher = new WebhookDispatcher({ db, fetch: fetchMock, lookup: publicLookup });

			const first = dispatcher.processRetries();
			const second = dispatcher.processRetries();
			await new Promise((resolve) => setTimeout(resolve, 10));
			release();
			const [a, b] = await Promise.all([first, second]);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(a + b).toBe(1);
		});

		it('auto-retry swallows sweep errors instead of raising unhandled rejections', async () => {
			vi.useFakeTimers();
			const failingDb = createMemoryDatabase();
			failingDb.getPendingDeliveries = async () => {
				throw new Error('db down');
			};
			const unhandled = vi.fn();
			process.on('unhandledRejection', unhandled);

			const dispatcher = new WebhookDispatcher({
				db: failingDb,
				autoRetry: true,
				retryInterval: 1_000,
			});
			await vi.advanceTimersByTimeAsync(3_500);
			dispatcher.stop();
			await vi.advanceTimersByTimeAsync(0);
			process.off('unhandledRejection', unhandled);

			expect(unhandled).not.toHaveBeenCalled();
		});

		it('stop() clears the auto-retry timer', () => {
			vi.useFakeTimers();
			const dispatcher = new WebhookDispatcher({ db, autoRetry: true, retryInterval: 1_000 });
			expect(vi.getTimerCount()).toBe(1);
			dispatcher.stop();
			expect(vi.getTimerCount()).toBe(0);
		});
	});
});
