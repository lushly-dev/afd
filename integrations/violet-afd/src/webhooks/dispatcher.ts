/**
 * Webhook Dispatcher - Event matching, delivery, and retry logic
 *
 * Handles:
 * - Matching events to subscribed webhooks
 * - Queuing deliveries with immediate first attempt
 * - Retry logic with exponential backoff
 * - SSRF protection: the destination is re-validated (including a fresh DNS
 *   resolution) immediately before every attempt, and redirects are never followed
 *
 * @module webhooks/dispatcher
 */

import type { DeliveryUpdate, Webhook, WebhookEvent } from '@lushly-dev/violet-core/types';
import type { Database } from '../commands/registry.js';
import { createDeliveryHeaders } from './signer.js';
import { type LookupFn, assertWebhookUrlSafe } from './url-policy.js';

/**
 * Retry schedule: delays between retry attempts (in milliseconds)
 * Pattern: 1m, 5m, 30m, 2h, 12h
 */
const RETRY_DELAYS = [
	60_000, // 1 minute
	300_000, // 5 minutes
	1_800_000, // 30 minutes
	7_200_000, // 2 hours
	43_200_000, // 12 hours
];

/**
 * Maximum number of delivery attempts: the initial attempt plus one retry per
 * entry in RETRY_DELAYS (so every delay in the schedule is actually used).
 */
const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

/**
 * Request timeout in milliseconds
 */
const REQUEST_TIMEOUT = 30_000;

/**
 * Maximum number of deliveries in flight at once during fan-out / retry sweeps
 */
const DEFAULT_CONCURRENCY = 5;

/**
 * Dispatcher configuration options
 */
export interface DispatcherOptions {
	/** Database instance for webhook/delivery storage */
	db: Database;

	/** Custom fetch implementation (for testing) */
	fetch?: typeof globalThis.fetch;

	/** Whether to process retries automatically */
	autoRetry?: boolean;

	/** Retry check interval in ms (default: 60000) */
	retryInterval?: number;

	/** Per-request timeout in ms (default: 30000) */
	requestTimeout?: number;

	/** Max deliveries in flight at once (default: 5) */
	concurrency?: number;

	/**
	 * Allow delivery to private/internal addresses (disables the SSRF address-range
	 * checks). Defaults to true only when VIOLET_WEBHOOK_ALLOW_PRIVATE=1. Intended
	 * for local development and tests; leave off in any shared deployment.
	 */
	allowPrivate?: boolean;

	/** DNS resolver used for the pre-delivery SSRF check (injectable for tests) */
	lookup?: LookupFn;
}

/**
 * Result of a single delivery attempt
 */
export interface DeliveryResult {
	/** Whether the delivery succeeded */
	success: boolean;

	/** HTTP status code (null if request failed) */
	status: number | null;

	/**
	 * Short error string for failed attempts (e.g. "HTTP 500", "Request timed out").
	 * The target's response body is never read, stored or returned.
	 */
	response?: string;

	/** Time taken in ms */
	duration: number;

	/** ID of the delivery record created for this attempt (when one was created) */
	deliveryId?: string;
}

/**
 * WebhookDispatcher - Handles event delivery to registered webhooks
 *
 * @example
 * ```typescript
 * const dispatcher = new WebhookDispatcher({ db });
 *
 * // Dispatch an event
 * await dispatcher.dispatch({
 *   id: "evt_123",
 *   type: "node.created",
 *   timestamp: new Date().toISOString(),
 *   data: { node: { id: "xbox", name: "Xbox", type: "product" } }
 * });
 *
 * // Process pending retries
 * await dispatcher.processRetries();
 * ```
 */
export class WebhookDispatcher {
	private db: Database;
	private fetch: typeof globalThis.fetch;
	private retryTimer?: ReturnType<typeof setInterval>;
	private requestTimeout: number;
	private concurrency: number;
	private allowPrivate?: boolean;
	private lookup?: LookupFn;
	/** Delivery IDs claimed by a retry sweep (prevents overlapping sweeps double-delivering) */
	private inFlight = new Set<string>();

	constructor(options: DispatcherOptions) {
		this.db = options.db;
		this.fetch = options.fetch ?? globalThis.fetch;
		this.requestTimeout = options.requestTimeout ?? REQUEST_TIMEOUT;
		this.concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
		this.allowPrivate = options.allowPrivate;
		this.lookup = options.lookup;

		// Start auto-retry if enabled
		if (options.autoRetry) {
			const interval = options.retryInterval ?? 60_000;
			this.retryTimer = setInterval(() => {
				// Never let a failed sweep become an unhandled rejection. Overlap is
				// prevented per delivery by the in-flight set in processRetries().
				this.processRetries().catch(() => {});
			}, interval);
			// Do not keep the process alive just for retries
			this.retryTimer.unref?.();
		}
	}

	/**
	 * Stops the auto-retry timer
	 */
	stop(): void {
		if (this.retryTimer) {
			clearInterval(this.retryTimer);
			this.retryTimer = undefined;
		}
	}

	/**
	 * Dispatches an event to all matching webhooks
	 *
	 * @param event - The event to dispatch
	 * @returns Array of delivery IDs created
	 */
	async dispatch(event: WebhookEvent): Promise<string[]> {
		// Find matching webhooks
		const webhooks = await this.findMatchingWebhooks(event);

		if (webhooks.length === 0) {
			return [];
		}

		// Create deliveries and attempt immediate delivery, a few at a time
		return mapWithConcurrency(webhooks, this.concurrency, (webhook) =>
			this.createAndDeliver(webhook, event),
		);
	}

	/**
	 * Finds webhooks that should receive this event
	 */
	private async findMatchingWebhooks(event: WebhookEvent): Promise<Webhook[]> {
		// Get all active webhooks
		const webhooks = await this.db.listWebhooks({ active: true });

		return webhooks.filter((webhook) => {
			// Check if webhook subscribes to this event type
			if (!webhook.events.includes(event.type)) {
				return false;
			}

			// Check node filter if present
			if (webhook.nodeFilter) {
				const eventNodeId = this.extractNodeId(event);
				if (eventNodeId && !this.matchesNodeFilter(eventNodeId, webhook.nodeFilter)) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * Extracts the node ID from an event (if applicable)
	 */
	private extractNodeId(event: WebhookEvent): string | undefined {
		const data = event.data as unknown as Record<string, unknown>;

		// Try common patterns
		if ('nodeId' in data) return data.nodeId as string;
		if ('node' in data && typeof data.node === 'object' && data.node !== null) {
			return (data.node as Record<string, unknown>).id as string;
		}

		return undefined;
	}

	/**
	 * Checks if an event node matches the webhook's node filter
	 * Filter matches if event node is the filter node or a descendant
	 */
	private matchesNodeFilter(eventNodeId: string, filterNodeId: string): boolean {
		// Exact match
		if (eventNodeId === filterNodeId) return true;

		// Descendant match (node IDs typically use hierarchical naming)
		// e.g., filter="xbox" matches "xbox", "xbox-ios", "xbox-web"
		if (eventNodeId.startsWith(`${filterNodeId}-`)) return true;

		return false;
	}

	/**
	 * Creates a delivery record and attempts immediate delivery
	 */
	private async createAndDeliver(webhook: Webhook, event: WebhookEvent): Promise<string> {
		const deliveryId = `del_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const payload = JSON.stringify(event);

		// Create delivery record
		await this.db.createDelivery({
			id: deliveryId,
			webhookId: webhook.id,
			eventType: event.type,
			payload,
			status: null,
			attempts: 0,
			createdAt: new Date().toISOString(),
		});

		// Attempt immediate delivery
		await this.attemptDelivery(deliveryId, webhook, payload);

		return deliveryId;
	}

	/**
	 * Attempts to deliver a payload to a webhook
	 */
	private async attemptDelivery(
		deliveryId: string,
		webhook: Webhook,
		payload: string,
	): Promise<DeliveryResult> {
		const delivery = await this.db.getDelivery(deliveryId);
		if (!delivery) {
			return {
				success: false,
				status: null,
				response: 'Delivery not found',
				duration: 0,
			};
		}

		const result = await this.send(deliveryId, webhook, payload, delivery.eventType);

		// Update delivery record. `null` explicitly clears a column; `undefined` would
		// leave the previous value in place.
		const attempts = delivery.attempts + 1;
		const update: DeliveryUpdate = {
			status: result.status,
			response: result.success ? null : (result.response ?? null),
			attempts,
		};

		if (result.success) {
			update.deliveredAt = new Date().toISOString();
			update.nextRetryAt = null;
		} else if (attempts < MAX_ATTEMPTS) {
			// Schedule retry
			const delay = RETRY_DELAYS[attempts - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
			update.nextRetryAt = new Date(Date.now() + delay).toISOString();
		} else {
			// Max attempts reached: stop retrying
			update.nextRetryAt = null;
		}

		await this.db.updateDelivery(deliveryId, update);

		return result;
	}

	/**
	 * Performs one HTTP attempt. Never throws; failures are reported in the result.
	 *
	 * Security notes:
	 * - The destination is validated, and its DNS re-resolved, right before the request
	 *   so a hostname that was public at registration but now points at an internal
	 *   address (DNS rebinding) is refused.
	 * - Redirects are not followed (a 3xx is a failed delivery), otherwise a public
	 *   endpoint could bounce the request to an internal one.
	 * - The response body is never read (it is cancelled), so nothing the target
	 *   returns is buffered, stored or surfaced.
	 */
	private async send(
		deliveryId: string,
		webhook: Webhook,
		payload: string,
		eventType: WebhookEvent['type'],
	): Promise<DeliveryResult> {
		const startTime = Date.now();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.requestTimeout);
		timer.unref?.();

		try {
			const policy = await assertWebhookUrlSafe(webhook.url, {
				allowPrivate: this.allowPrivate,
				lookup: this.lookup,
			});
			if (!policy.ok) {
				return {
					success: false,
					status: null,
					response: `Blocked: ${policy.reason}`,
					duration: Date.now() - startTime,
				};
			}

			const headers = createDeliveryHeaders(
				webhook.secret,
				JSON.parse(payload),
				eventType,
				deliveryId,
			);

			const response = await this.fetch(webhook.url, {
				method: 'POST',
				headers,
				body: payload,
				signal: controller.signal,
				redirect: 'manual',
			});

			// Discard the body without reading it
			try {
				await response.body?.cancel();
			} catch {
				// ignore
			}

			const duration = Date.now() - startTime;

			if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
				return {
					success: false,
					status: response.status || null,
					response: `Redirect not followed${response.status ? ` (HTTP ${response.status})` : ''}`,
					duration,
				};
			}

			const success = response.status >= 200 && response.status < 300;
			return {
				success,
				status: response.status,
				response: success ? undefined : `HTTP ${response.status}`,
				duration,
			};
		} catch (error) {
			return {
				success: false,
				status: null,
				response: describeFetchError(error),
				duration: Date.now() - startTime,
			};
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Processes all pending retries that are due
	 */
	async processRetries(): Promise<number> {
		const pending = await this.db.getPendingDeliveries();

		const due = pending.filter((delivery) => {
			// Skip attempts already in progress (e.g. a slow sweep still running)
			if (this.inFlight.has(delivery.id)) return false;
			if (delivery.nextRetryAt) {
				return new Date(delivery.nextRetryAt).getTime() <= Date.now();
			}
			return true;
		});

		// Claim synchronously (before any await) so an overlapping sweep skips these
		for (const delivery of due) this.inFlight.add(delivery.id);

		const results = await mapWithConcurrency(due, this.concurrency, async (delivery) => {
			try {
				// Get webhook
				const webhook = await this.db.getWebhook(delivery.webhookId);
				if (!webhook || !webhook.active) {
					// Webhook deleted or disabled: stop retrying
					await this.db.updateDelivery(delivery.id, {
						nextRetryAt: null,
						response: 'Webhook disabled or deleted',
					});
					return false;
				}

				// Attempt retry
				await this.attemptDelivery(delivery.id, webhook, delivery.payload);
				return true;
			} finally {
				this.inFlight.delete(delivery.id);
			}
		});

		return results.filter(Boolean).length;
	}

	/**
	 * Manually retry a specific delivery
	 */
	async retryDelivery(deliveryId: string): Promise<DeliveryResult> {
		const delivery = await this.db.getDelivery(deliveryId);
		if (!delivery) {
			return {
				success: false,
				status: null,
				response: 'Delivery not found',
				duration: 0,
			};
		}

		const webhook = await this.db.getWebhook(delivery.webhookId);
		if (!webhook) {
			return {
				success: false,
				status: null,
				response: 'Webhook not found',
				duration: 0,
			};
		}

		return this.attemptDelivery(deliveryId, webhook, delivery.payload);
	}

	/**
	 * Sends a test ping to a webhook
	 */
	async sendTestPing(webhookId: string): Promise<DeliveryResult> {
		const webhook = await this.db.getWebhook(webhookId);
		if (!webhook) {
			return {
				success: false,
				status: null,
				response: 'Webhook not found',
				duration: 0,
			};
		}

		const event: WebhookEvent = {
			id: `evt_test_${Date.now()}`,
			type: 'test.ping',
			timestamp: new Date().toISOString(),
			data: {
				test: true,
				message: 'This is a test ping from Violet',
				webhookId,
			},
		};

		const deliveryId = await this.createAndDeliver(webhook, event);
		const delivery = await this.db.getDelivery(deliveryId);

		const status = delivery?.status ?? null;
		return {
			success: status !== null && status >= 200 && status < 300,
			status,
			response: delivery?.response,
			duration: 0, // Already completed
			deliveryId,
		};
	}
}

/**
 * Maps `items` through `fn` with at most `limit` calls in flight, preserving order.
 */
async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index]);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

/**
 * Short, non-sensitive description of a failed request. Deliberately excludes the
 * raw error message, which can include resolved addresses and other internals.
 */
function describeFetchError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === 'AbortError' || error.name === 'TimeoutError') {
			return 'Request timed out';
		}
		const code = (error as { cause?: { code?: unknown } }).cause?.code;
		if (typeof code === 'string' && /^[A-Z0-9_]{3,40}$/.test(code)) {
			return `Network error (${code})`;
		}
	}
	return 'Network error';
}
