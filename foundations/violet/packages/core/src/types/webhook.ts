/**
 * Webhook Types
 *
 * Types for webhook registration, delivery, and events.
 */

/**
 * Event types that can trigger webhooks
 */
export type WebhookEventType =
	| 'token.added'
	| 'token.updated'
	| 'token.removed'
	| 'node.created'
	| 'node.updated'
	| 'node.deleted'
	| 'export.completed'
	| 'constraint.failed'
	| 'test.ping';

/**
 * Registered webhook configuration
 */
export interface Webhook {
	/** Unique webhook ID (wh_xxx) */
	id: string;

	/** Destination URL for webhook delivery */
	url: string;

	/**
	 * HMAC signing secret. Stored as-is (the dispatcher needs the raw value to sign
	 * payloads), so it is NOT hashed. It is returned to the caller only once (on
	 * registration or regeneration) and must never be logged or audited.
	 */
	secret: string;

	/** Event types this webhook subscribes to */
	events: WebhookEventType[];

	/** Optional: Only trigger for events on this node (and descendants) */
	nodeFilter?: string;

	/** Human-readable description */
	description?: string;

	/** Whether the webhook is active */
	active: boolean;

	/** Creation timestamp */
	createdAt: string;

	/** Last update timestamp */
	updatedAt: string;

	/** Who created this webhook */
	createdBy?: string;
}

/**
 * Partial update for a webhook.
 *
 * `undefined` leaves a field unchanged; `null` clears `nodeFilter`/`description`.
 */
export type WebhookUpdate = Partial<Omit<Webhook, 'nodeFilter' | 'description'>> & {
	nodeFilter?: string | null;
	description?: string | null;
};

/**
 * Webhook event payload
 */
export interface WebhookEvent {
	/** Unique event ID (evt_xxx) */
	id: string;

	/** Event type */
	type: WebhookEventType;

	/** Event timestamp */
	timestamp: string;

	/** Event-specific data */
	data: WebhookEventData;
}

/**
 * Event data varies by event type
 */
export type WebhookEventData =
	| TokenAddedData
	| TokenUpdatedData
	| TokenRemovedData
	| NodeCreatedData
	| NodeUpdatedData
	| NodeDeletedData
	| ExportCompletedData
	| ConstraintFailedData
	| TestPingData;

export interface TokenAddedData {
	nodeId: string;
	tokenId: string;
	value: unknown;
}

export interface TokenUpdatedData {
	nodeId: string;
	tokenId: string;
	oldValue: unknown;
	newValue: unknown;
}

export interface TokenRemovedData {
	nodeId: string;
	tokenId: string;
}

export interface NodeCreatedData {
	node: {
		id: string;
		name: string;
		parentId?: string;
		type: string;
	};
}

export interface NodeUpdatedData {
	nodeId: string;
	changes: Record<string, { old: unknown; new: unknown }>;
}

export interface NodeDeletedData {
	nodeId: string;
}

export interface ExportCompletedData {
	nodeId: string;
	format: string;
	url?: string;
}

export interface ConstraintFailedData {
	nodeId: string;
	violations: Array<{
		constraintId: string;
		tokenId: string;
		message: string;
	}>;
}

export interface TestPingData {
	test: true;
	message: string;
	webhookId: string;
}

/**
 * Delivery status for tracking webhook attempts
 */
export type DeliveryStatus = 'pending' | 'success' | 'failed' | 'retrying';

/**
 * Webhook delivery record
 */
export interface WebhookDelivery {
	/** Unique delivery ID (del_xxx) */
	id: string;

	/** Webhook this delivery is for */
	webhookId: string;

	/** Event type delivered */
	eventType: WebhookEventType;

	/** JSON payload that was sent */
	payload: string;

	/** HTTP status code (null if not yet attempted) */
	status: number | null;

	/**
	 * Short error/status string for failed attempts (e.g. "HTTP 500", "Request timed out").
	 * Target response bodies are never stored.
	 */
	response?: string;

	/** Number of delivery attempts */
	attempts: number;

	/** Next retry timestamp (null if no more retries) */
	nextRetryAt?: string;

	/** When delivery succeeded (null if not delivered) */
	deliveredAt?: string;

	/** When this delivery was created */
	createdAt: string;
}

/**
 * Partial update for a delivery record.
 *
 * `undefined` leaves a field unchanged; `null` clears `response`,
 * `nextRetryAt` and `deliveredAt` (e.g. `nextRetryAt: null` stops retries).
 */
export type DeliveryUpdate = Partial<
	Omit<WebhookDelivery, 'response' | 'nextRetryAt' | 'deliveredAt'>
> & {
	response?: string | null;
	nextRetryAt?: string | null;
	deliveredAt?: string | null;
};

/**
 * Filter options for listing webhooks
 */
export interface WebhookFilter {
	/** Filter by active status */
	active?: boolean;

	/** Filter by event type subscription */
	events?: WebhookEventType[];

	/** Filter by node */
	nodeFilter?: string;
}

/**
 * Filter options for listing deliveries
 */
export interface DeliveryFilter {
	/** Filter by webhook ID */
	webhookId?: string;

	/** Filter by status */
	status?: 'success' | 'failed' | 'pending';

	/** Maximum results */
	limit?: number;
}
