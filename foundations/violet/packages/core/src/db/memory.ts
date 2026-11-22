import type { Database } from '../storage.js';
import type { Constraint } from '../types/constraint.js';
import type { Node } from '../types/node.js';
import type {
	AuditDayCount,
	AuditEvent,
	AuditEventFilter,
	AuditEventPage,
	AuditEventQuery,
	NewOperationRecord,
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

interface MemoryAsyncContext<T> {
	getStore(): T | undefined;
	run<R>(store: T, callback: () => R): R;
}

interface MemoryTxFrame {
	active: boolean;
	root: MemoryTxFrame;
	childQueue: Promise<void>;
	childPending: number;
}

const GUARDED_MEMORY_METHODS: ReadonlyArray<Exclude<keyof Database, 'transaction'>> = [
	'getNode',
	'createNode',
	'updateNode',
	'deleteNode',
	'listNodes',
	'getAncestryChain',
	'getDescendants',
	'getOperations',
	'addOperation',
	'appendOperation',
	'removeOperation',
	'getConstraints',
	'setConstraints',
	'addConstraint',
	'removeConstraint',
	'addAuditEvent',
	'getAuditEvents',
	'queryAuditEvents',
	'addCheckSnapshot',
	'listCheckSnapshots',
	'getSpecimenMap',
	'setSpecimenMap',
	'createWebhook',
	'getWebhook',
	'updateWebhook',
	'deleteWebhook',
	'listWebhooks',
	'createDelivery',
	'getDelivery',
	'updateDelivery',
	'listDeliveries',
	'getPendingDeliveries',
];

/**
 * Resolve Node's AsyncLocalStorage without importing `node:async_hooks`, keeping
 * MemoryDatabase browser- and worker-safe while isolating concurrent transactions
 * wherever Node builtins are available (#1973).
 */
function createMemoryAsyncContext<T>(): MemoryAsyncContext<T> | null {
	const getBuiltin = (
		globalThis as {
			process?: {
				getBuiltinModule?: (id: string) => {
					AsyncLocalStorage?: new () => MemoryAsyncContext<T>;
				};
			};
		}
	).process?.getBuiltinModule;
	const AsyncLocalStorageCtor = getBuiltin?.('node:async_hooks')?.AsyncLocalStorage;
	return AsyncLocalStorageCtor ? new AsyncLocalStorageCtor() : null;
}

/**
 * In-memory database implementation
 *
 * Useful for testing, development and browser/worker runtimes.
 */
export class MemoryDatabase implements Database {
	private nodes = new Map<string, Node>();
	private operations: OperationRecord[] = [];
	private maxSequenceByNode = new Map<string, number>();
	private auditEvents: AuditEvent[] = [];
	private constraints = new Map<string, Constraint[]>(); // nodeId -> constraints
	private webhooks = new Map<string, Webhook>();
	private deliveries = new Map<string, WebhookDelivery>();
	private checkSnapshots: CheckSnapshot[] = [];
	private specimenMaps = new Map<string, SpecimenMapRecord>();
	private readonly txContext = createMemoryAsyncContext<MemoryTxFrame>();
	private txQueue: Promise<void> = Promise.resolve();
	private txPending = 0;
	private activeTopTx: MemoryTxFrame | null = null;
	private activeFrame: MemoryTxFrame | null = null;

	constructor() {
		if (this.txContext) {
			this.guardConnectionMethods();
		}
	}

	private guardConnectionMethods(): void {
		const self = this as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
		for (const name of GUARDED_MEMORY_METHODS) {
			const original = self[name].bind(this);
			self[name] = (...args: unknown[]) => this.withConnection(() => original(...args));
		}
	}

	private async withConnection<T>(op: () => Promise<T>): Promise<T> {
		if (!this.txContext) {
			return op();
		}
		const frame = this.txContext.getStore();
		if (frame?.active && frame === this.activeFrame) {
			return op();
		}
		if (frame?.active && frame.root === this.activeTopTx) {
			const prior = frame.childQueue;
			let release!: () => void;
			frame.childPending++;
			frame.childQueue = new Promise<void>((resolve) => {
				release = resolve;
			});
			await prior;
			try {
				if (!frame.active || frame.root !== this.activeTopTx) {
					throw new Error('Transaction has already ended');
				}
				return await op();
			} finally {
				frame.childPending--;
				release();
			}
		}
		if (this.activeTopTx === null && this.txPending === 0) {
			return op();
		}
		const prior = this.txQueue;
		let release!: () => void;
		this.txPending++;
		this.txQueue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prior;
		try {
			return await op();
		} finally {
			this.txPending--;
			release();
		}
	}

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
		return this.operations
			.filter((op) => op.nodeId === nodeId)
			.sort((a, b) => a.sequence - b.sequence);
	}

	async addOperation(record: OperationRecord): Promise<void> {
		this.operations.push(record);
		const prev = this.maxSequenceByNode.get(record.nodeId) ?? 0;
		if (record.sequence > prev) {
			this.maxSequenceByNode.set(record.nodeId, record.sequence);
		}
	}

	async appendOperation(record: NewOperationRecord): Promise<OperationRecord> {
		const next = (this.maxSequenceByNode.get(record.nodeId) ?? 0) + 1;
		this.maxSequenceByNode.set(record.nodeId, next);
		const stored: OperationRecord = { ...record, sequence: next };
		this.operations.push(stored);
		return { ...stored };
	}

	async removeOperation(id: string): Promise<void> {
		const index = this.operations.findIndex((op) => op.id === id);
		if (index >= 0) {
			const [removed] = this.operations.splice(index, 1);
			if (removed && removed.sequence === this.maxSequenceByNode.get(removed.nodeId)) {
				let maxSeq = 0;
				for (const op of this.operations) {
					if (op.nodeId === removed.nodeId && op.sequence > maxSeq) {
						maxSeq = op.sequence;
					}
				}
				if (maxSeq > 0) this.maxSequenceByNode.set(removed.nodeId, maxSeq);
				else this.maxSequenceByNode.delete(removed.nodeId);
			}
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

	/**
	 * Run `fn` atomically: snapshots all mutable collections before running and
	 * restores them if `fn` throws or rejects, including nested savepoints (#1973).
	 * Where Node's `AsyncLocalStorage` is available, concurrent top-level
	 * transactions and outside writes are serialized so a rollback never reverts
	 * another caller's committed write. In browser runtimes without
	 * `AsyncLocalStorage`, callers must not overlap concurrent transactions.
	 */
	async transaction<T>(fn: () => Promise<T>): Promise<T> {
		if (!this.txContext) {
			const snapshot = this.snapshot();
			try {
				return await fn();
			} catch (error) {
				this.restore(snapshot);
				throw error;
			}
		}

		const parent = this.txContext.getStore();
		if (parent?.active && parent.root === this.activeTopTx) {
			const prior = parent.childQueue;
			let release!: () => void;
			parent.childPending++;
			parent.childQueue = new Promise<void>((resolve) => {
				release = resolve;
			});
			await prior;
			if (!parent.active || parent.root !== this.activeTopTx) {
				parent.childPending--;
				release();
				throw new Error('Parent transaction has already ended');
			}
			const childFrame: MemoryTxFrame = {
				active: true,
				root: parent.root,
				childQueue: Promise.resolve(),
				childPending: 0,
			};
			const previousFrame = this.activeFrame;
			this.activeFrame = childFrame;
			const snapshot = this.snapshot();
			try {
				const result = await this.txContext.run(childFrame, fn);
				childFrame.active = false;
				await childFrame.childQueue;
				return result;
			} catch (error) {
				childFrame.active = false;
				await childFrame.childQueue;
				this.restore(snapshot);
				throw error;
			} finally {
				childFrame.active = false;
				this.activeFrame = previousFrame;
				parent.childPending--;
				release();
			}
		}

		const prior = this.txQueue;
		let release!: () => void;
		this.txPending++;
		this.txQueue = new Promise<void>((resolve) => {
			release = resolve;
		});
		await prior;

		const topFrame = {
			active: true,
			childQueue: Promise.resolve(),
			childPending: 0,
		} as MemoryTxFrame;
		topFrame.root = topFrame;
		this.activeTopTx = topFrame;
		this.activeFrame = topFrame;
		const snapshot = this.snapshot();
		try {
			const result = await this.txContext.run(topFrame, fn);
			topFrame.active = false;
			await topFrame.childQueue;
			return result;
		} catch (error) {
			topFrame.active = false;
			await topFrame.childQueue;
			this.restore(snapshot);
			throw error;
		} finally {
			topFrame.active = false;
			this.activeTopTx = null;
			this.activeFrame = null;
			this.txPending--;
			release();
		}
	}

	private snapshot(): {
		nodes: Map<string, Node>;
		operations: OperationRecord[];
		maxSequenceByNode: Map<string, number>;
		auditEvents: AuditEvent[];
		constraints: Map<string, Constraint[]>;
		webhooks: Map<string, Webhook>;
		deliveries: Map<string, WebhookDelivery>;
		checkSnapshots: CheckSnapshot[];
		specimenMaps: Map<string, SpecimenMapRecord>;
	} {
		return {
			nodes: structuredClone(this.nodes),
			operations: structuredClone(this.operations),
			maxSequenceByNode: new Map(this.maxSequenceByNode),
			auditEvents: structuredClone(this.auditEvents),
			constraints: structuredClone(this.constraints),
			webhooks: structuredClone(this.webhooks),
			deliveries: structuredClone(this.deliveries),
			checkSnapshots: structuredClone(this.checkSnapshots),
			specimenMaps: structuredClone(this.specimenMaps),
		};
	}

	private restore(snapshot: ReturnType<MemoryDatabase['snapshot']>): void {
		this.nodes = snapshot.nodes;
		this.operations = snapshot.operations;
		this.maxSequenceByNode = snapshot.maxSequenceByNode;
		this.auditEvents = snapshot.auditEvents;
		this.constraints = snapshot.constraints;
		this.webhooks = snapshot.webhooks;
		this.deliveries = snapshot.deliveries;
		this.checkSnapshots = snapshot.checkSnapshots;
		this.specimenMaps = snapshot.specimenMaps;
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

		// The caller's clock when it gives one, so a replayed update stamps the same time
		next.updatedAt = updates.updatedAt ?? new Date().toISOString();
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
		this.maxSequenceByNode.clear();
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
