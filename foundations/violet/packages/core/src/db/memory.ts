import type { Database } from '../storage.js';
import type { Constraint } from '../types/constraint.js';
import type { Node } from '../types/node.js';
import type {
	AuditDayCount,
	AuditEvent,
	AuditEventFilter,
	AuditEventPage,
	AuditEventQuery,
	OperationRecord,
} from '../types/operation.js';
import type { CheckSnapshot, CheckSnapshotQuery } from '../types/snapshot.js';
import type { SpecimenMapRecord } from '../types/specimen.js';
import type {
	DeliveryFilter,
	DeliveryUpdate,
	Webhook,
	WebhookDelivery,
	WebhookFilter,
	WebhookUpdate,
} from '../types/webhook.js';

/**
 * In-memory database implementation
 *
 * Useful for testing and development.
 */
export class MemoryDatabase implements Database {
	private nodes = new Map<string, Node>();
	private operations: OperationRecord[] = [];
	private auditEvents: AuditEvent[] = [];
	private constraints = new Map<string, Constraint[]>(); // nodeId -> constraints
	private webhooks = new Map<string, Webhook>();
	private deliveries = new Map<string, WebhookDelivery>();
	private checkSnapshots: CheckSnapshot[] = [];
	private specimenMaps = new Map<string, SpecimenMapRecord>();

	async getNode(id: string): Promise<Node | null> {
		return this.nodes.get(id) || null;
	}

	async createNode(node: Node): Promise<void> {
		this.nodes.set(node.id, withoutClearedPlan(node));
	}

	async updateNode(id: string, updates: Partial<Node>): Promise<void> {
		const existing = this.nodes.get(id);
		if (existing) {
			this.nodes.set(id, withoutClearedPlan({ ...existing, ...updates }));
		}
	}

	async deleteNode(id: string): Promise<void> {
		this.nodes.delete(id);
		this.constraints.delete(id);
	}

	async listNodes(parentId?: string | null): Promise<Node[]> {
		const allNodes = Array.from(this.nodes.values());
		if (parentId === undefined) {
			return allNodes;
		}
		return allNodes.filter((n) => n.parentId === parentId);
	}

	async getAncestryChain(nodeId: string): Promise<string[]> {
		const chain: string[] = [];
		let current = this.nodes.get(nodeId);

		while (current?.parentId) {
			chain.unshift(current.parentId);
			current = this.nodes.get(current.parentId);
		}

		return chain;
	}

	async getDescendants(nodeId: string): Promise<Node[]> {
		const descendants: Node[] = [];
		const queue = [nodeId];

		while (queue.length > 0) {
			const currentId = queue.shift()!;
			const children = Array.from(this.nodes.values()).filter((n) => n.parentId === currentId);

			for (const child of children) {
				descendants.push(child);
				queue.push(child.id);
			}
		}

		return descendants;
	}

	async getOperations(nodeId: string): Promise<OperationRecord[]> {
		return this.operations.filter((op) => op.nodeId === nodeId);
	}

	async addOperation(record: OperationRecord): Promise<void> {
		this.operations.push(record);
	}

	async removeOperation(id: string): Promise<void> {
		const index = this.operations.findIndex((op) => op.id === id);
		if (index >= 0) {
			this.operations.splice(index, 1);
		}
	}

	// Constraint operations
	async getConstraints(nodeId: string): Promise<Constraint[]> {
		return this.constraints.get(nodeId) || [];
	}

	async setConstraints(nodeId: string, constraints: Constraint[]): Promise<void> {
		this.constraints.set(nodeId, constraints);
	}

	async addConstraint(nodeId: string, constraint: Constraint): Promise<void> {
		const existing = this.constraints.get(nodeId) || [];
		// Replace if same ID, otherwise append
		const index = existing.findIndex((c) => c.id === constraint.id);
		if (index >= 0) {
			existing[index] = constraint;
		} else {
			existing.push(constraint);
		}
		this.constraints.set(nodeId, existing);
	}

	async removeConstraint(nodeId: string, constraintId: string): Promise<void> {
		const existing = this.constraints.get(nodeId) || [];
		this.constraints.set(
			nodeId,
			existing.filter((c) => c.id !== constraintId),
		);
	}

	async addAuditEvent(event: AuditEvent): Promise<void> {
		this.auditEvents.push(event);
	}

	async getAuditEvents(filter: AuditEventFilter): Promise<AuditEvent[]> {
		const matching = this.auditEvents.filter(
			(event) =>
				(filter.targetNode === undefined || event.targetNode === filter.targetNode) &&
				(filter.targetToken === undefined || event.targetToken === filter.targetToken) &&
				(filter.eventType === undefined || event.eventType === filter.eventType) &&
				(filter.actor === undefined || event.actor === filter.actor),
		);
		return newestFirst(matching);
	}

	async queryAuditEvents(query: AuditEventQuery): Promise<AuditEventPage> {
		const since = query.since ? Date.parse(query.since) : undefined;
		const until = query.until ? Date.parse(query.until) : undefined;
		const matching = this.auditEvents.filter((event) => {
			const time = Date.parse(event.timestamp);
			return (
				(!query.nodeIds || query.nodeIds.includes(event.targetNode)) &&
				(!query.tokenId || event.targetToken === query.tokenId) &&
				(!query.eventTypes || query.eventTypes.includes(event.eventType)) &&
				(!query.actor || event.actor === query.actor) &&
				(since === undefined || time >= since) &&
				(until === undefined || time < until)
			);
		});
		newestFirst(matching);

		const counts = new Map<string, AuditDayCount>();
		for (const event of matching) {
			const date = new Date(event.timestamp).toISOString().slice(0, 10);
			const key = `${date} ${event.eventType}`;
			const entry = counts.get(key) ?? { date, eventType: event.eventType, count: 0 };
			entry.count += 1;
			counts.set(key, entry);
		}

		return {
			events: matching.slice(query.offset, query.offset + query.limit),
			total: matching.length,
			days: [...counts.values()],
		};
	}

	async addCheckSnapshot(snapshot: CheckSnapshot): Promise<void> {
		this.checkSnapshots.push(structuredClone(snapshot));
	}

	async listCheckSnapshots(query: CheckSnapshotQuery = {}): Promise<CheckSnapshot[]> {
		const matches = this.checkSnapshots
			.filter(
				(snapshot) =>
					(!query.rootIds || query.rootIds.includes(snapshot.rootId)) &&
					(!query.since || snapshot.takenAt >= query.since) &&
					(!query.until || snapshot.takenAt < query.until),
			)
			.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
		const kept = query.limit === undefined ? matches : matches.slice(-query.limit);
		return kept.map((snapshot) => structuredClone(snapshot));
	}

	async getSpecimenMap(rootId: string): Promise<SpecimenMapRecord | null> {
		const record = this.specimenMaps.get(rootId);
		return record ? structuredClone(record) : null;
	}

	async setSpecimenMap(rootId: string, record: SpecimenMapRecord | null): Promise<void> {
		if (record) this.specimenMaps.set(rootId, structuredClone(record));
		else this.specimenMaps.delete(rootId);
	}

	async transaction<T>(fn: () => Promise<T>): Promise<T> {
		// In-memory doesn't need transactions
		return fn();
	}

	// Webhook operations
	//
	// These intentionally mirror the SQL adapters: empty strings are normalized to
	// "absent", stored records are copied (callers cannot mutate them in place),
	// `undefined` in an update leaves a field unchanged and `null` clears it.
	async createWebhook(webhook: Webhook): Promise<void> {
		const record: Webhook = { ...webhook, events: [...webhook.events] };
		record.nodeFilter = webhook.nodeFilter || undefined;
		record.description = webhook.description || undefined;
		record.createdBy = webhook.createdBy || undefined;
		this.webhooks.set(webhook.id, record);
	}

	async getWebhook(id: string): Promise<Webhook | null> {
		const webhook = this.webhooks.get(id);
		return webhook ? { ...webhook, events: [...webhook.events] } : null;
	}

	async updateWebhook(id: string, updates: WebhookUpdate): Promise<void> {
		const existing = this.webhooks.get(id);
		if (!existing) return;

		const next: Webhook = { ...existing };
		let changed = false;

		if (updates.url !== undefined) {
			next.url = updates.url;
			changed = true;
		}
		if (updates.secret !== undefined) {
			next.secret = updates.secret;
			changed = true;
		}
		if (updates.events !== undefined) {
			next.events = [...updates.events];
			changed = true;
		}
		if (updates.nodeFilter !== undefined) {
			next.nodeFilter = updates.nodeFilter || undefined;
			changed = true;
		}
		if (updates.description !== undefined) {
			next.description = updates.description || undefined;
			changed = true;
		}
		if (updates.active !== undefined) {
			next.active = updates.active;
			changed = true;
		}

		// Nothing to change (also keeps updatedAt untouched, like the SQL adapters)
		if (!changed) return;

		next.updatedAt = new Date().toISOString();
		this.webhooks.set(id, next);
	}

	async deleteWebhook(id: string): Promise<void> {
		this.webhooks.delete(id);
		// Also delete associated deliveries
		for (const [deliveryId, delivery] of this.deliveries) {
			if (delivery.webhookId === id) {
				this.deliveries.delete(deliveryId);
			}
		}
	}

	async listWebhooks(filter?: WebhookFilter): Promise<Webhook[]> {
		let webhooks = Array.from(this.webhooks.values());

		if (filter?.active !== undefined) {
			webhooks = webhooks.filter((w) => w.active === filter.active);
		}

		if (filter?.events && filter.events.length > 0) {
			webhooks = webhooks.filter((w) => filter.events?.some((e) => w.events.includes(e)));
		}

		if (filter?.nodeFilter) {
			webhooks = webhooks.filter(
				(w) =>
					!w.nodeFilter ||
					w.nodeFilter === filter.nodeFilter ||
					filter.nodeFilter?.startsWith(w.nodeFilter),
			);
		}

		// Newest first, like the SQL adapters
		webhooks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		return webhooks.map((w) => ({ ...w, events: [...w.events] }));
	}

	// Webhook delivery operations
	async createDelivery(delivery: WebhookDelivery): Promise<void> {
		const record: WebhookDelivery = { ...delivery };
		record.response = delivery.response || undefined;
		record.nextRetryAt = delivery.nextRetryAt || undefined;
		record.deliveredAt = delivery.deliveredAt || undefined;
		this.deliveries.set(delivery.id, record);
	}

	async getDelivery(id: string): Promise<WebhookDelivery | null> {
		const delivery = this.deliveries.get(id);
		return delivery ? { ...delivery } : null;
	}

	async updateDelivery(id: string, updates: DeliveryUpdate): Promise<void> {
		const existing = this.deliveries.get(id);
		if (!existing) return;

		// undefined = leave unchanged; null clears response/nextRetryAt/deliveredAt
		const next: WebhookDelivery = { ...existing };

		if (updates.status !== undefined) next.status = updates.status;
		if (updates.attempts !== undefined) next.attempts = updates.attempts;
		if (updates.response !== undefined) next.response = updates.response || undefined;
		if (updates.nextRetryAt !== undefined) next.nextRetryAt = updates.nextRetryAt || undefined;
		if (updates.deliveredAt !== undefined) next.deliveredAt = updates.deliveredAt || undefined;

		this.deliveries.set(id, next);
	}

	async listDeliveries(filter?: DeliveryFilter): Promise<WebhookDelivery[]> {
		let deliveries = Array.from(this.deliveries.values());

		if (filter?.webhookId) {
			deliveries = deliveries.filter((d) => d.webhookId === filter.webhookId);
		}

		const status = filter?.status;
		if (status) {
			deliveries = deliveries.filter((d) => matchesDeliveryStatus(d, status));
		}

		// Sort by createdAt descending
		deliveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

		const limit =
			Number.isInteger(filter?.limit) && (filter?.limit as number) > 0
				? (filter?.limit as number)
				: 100;

		return deliveries.slice(0, limit).map((d) => ({ ...d }));
	}

	async getPendingDeliveries(): Promise<WebhookDelivery[]> {
		const now = new Date().toISOString();
		return Array.from(this.deliveries.values())
			.filter((d) => !d.deliveredAt && d.nextRetryAt && d.nextRetryAt <= now)
			.sort((a, b) => (a.nextRetryAt as string).localeCompare(b.nextRetryAt as string))
			.slice(0, 100)
			.map((d) => ({ ...d }));
	}

	/**
	 * Clear all data (useful for testing)
	 */
	clear(): void {
		this.nodes.clear();
		this.operations = [];
		this.auditEvents = [];
		this.constraints.clear();
		this.webhooks.clear();
		this.deliveries.clear();
		this.checkSnapshots = [];
		this.specimenMaps.clear();
	}

	/**
	 * Get stats (useful for debugging)
	 */
	getStats(): {
		nodes: number;
		operations: number;
		auditEvents: number;
		constraints: number;
		webhooks: number;
		deliveries: number;
	} {
		return {
			nodes: this.nodes.size,
			operations: this.operations.length,
			auditEvents: this.auditEvents.length,
			constraints: this.constraints.size,
			webhooks: this.webhooks.size,
			deliveries: this.deliveries.size,
		};
	}
}

/**
 * Create a new in-memory database instance
 */
export function createMemoryDatabase(): MemoryDatabase {
	return new MemoryDatabase();
}

/** Mirrors the SQL adapters' status filters (see SQLiteDatabase.listDeliveries) */
function matchesDeliveryStatus(
	d: WebhookDelivery,
	status: NonNullable<DeliveryFilter['status']>,
): boolean {
	const code = d.status;
	switch (status) {
		case 'success':
			return code !== null && code >= 200 && code < 300;
		case 'failed': {
			// Includes network failures (status null) once at least one attempt was made
			const failedStatus = code === null ? d.attempts > 0 : code < 200 || code >= 300;
			return failedStatus && !d.nextRetryAt;
		}
		case 'pending':
			return !d.deliveredAt && (!!d.nextRetryAt || d.attempts === 0);
		default:
			return true;
	}
}

/** A cleared sunset date or replacement is absent, as the SQL stores read it back */
function withoutClearedPlan(node: Node): Node {
	const { sunsetAt, replacedBy, ...rest } = node;
	return { ...rest, ...(sunsetAt ? { sunsetAt } : {}), ...(replacedBy ? { replacedBy } : {}) };
}

/**
 * Sorts events newest first, in place. Events are kept in write order and the
 * sort is stable, so reversing first puts the later of two same-millisecond
 * events first (#89), matching the SQL stores' `timestamp DESC, seq DESC`.
 */
function newestFirst(events: AuditEvent[]): AuditEvent[] {
	events.reverse();
	return events.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
