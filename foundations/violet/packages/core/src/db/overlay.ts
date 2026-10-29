import type { Database } from '../storage.js';
import type { Constraint } from '../types/constraint.js';
import type { Node } from '../types/node.js';
import type {
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
 * Thrown by every write to an {@link OverlayDatabase}.
 */
export class OverlayWriteError extends Error {
	constructor(method: string) {
		super(`The impact overlay is read-only: '${method}' is not allowed`);
		this.name = 'OverlayWriteError';
	}
}

/**
 * A read-only view of a database with proposed operations layered on top.
 *
 * Reads go to the underlying database; `getOperations` also returns the
 * operations staged with {@link OverlayDatabase.stage}. Every write throws, so
 * code running against the overlay (resolution, constraint checks) cannot
 * change stored data. Used by `changes.impact` to dry-run token operations.
 */
export class OverlayDatabase implements Database {
	private readonly staged = new Map<string, OperationRecord[]>();

	constructor(private readonly base: Database) {}

	/** Layer a proposed operation onto a node's stored operations */
	stage(record: OperationRecord): void {
		const ops = this.staged.get(record.nodeId) ?? [];
		ops.push(record);
		this.staged.set(record.nodeId, ops);
	}

	/** Every staged operation, in the order it was staged */
	stagedOperations(): OperationRecord[] {
		return [...this.staged.values()].flat();
	}

	/**
	 * A view for running a mutation command against the overlay: its operation
	 * is staged instead of stored and its audit event is dropped. Every other
	 * write still throws.
	 */
	stagingView(): Database {
		const view: Database = Object.create(this);
		view.addOperation = async (record) => this.stage(record);
		view.addAuditEvent = async () => {};
		return view;
	}

	// Reads

	getNode(id: string): Promise<Node | null> {
		return this.base.getNode(id);
	}

	listNodes(parentId?: string | null): Promise<Node[]> {
		return this.base.listNodes(parentId);
	}

	getAncestryChain(nodeId: string): Promise<string[]> {
		return this.base.getAncestryChain(nodeId);
	}

	getDescendants(nodeId: string): Promise<Node[]> {
		return this.base.getDescendants(nodeId);
	}

	async getOperations(nodeId: string): Promise<OperationRecord[]> {
		const stored = await this.base.getOperations(nodeId);
		return [...stored, ...(this.staged.get(nodeId) ?? [])];
	}

	getConstraints(nodeId: string): Promise<Constraint[]> {
		return this.base.getConstraints(nodeId);
	}

	getAuditEvents(filter: AuditEventFilter): Promise<AuditEvent[]> {
		return this.base.getAuditEvents(filter);
	}

	queryAuditEvents(query: AuditEventQuery): Promise<AuditEventPage> {
		return this.base.queryAuditEvents(query);
	}

	listCheckSnapshots(query?: CheckSnapshotQuery): Promise<CheckSnapshot[]> {
		return this.base.listCheckSnapshots(query);
	}

	getSpecimenMap(rootId: string): Promise<SpecimenMapRecord | null> {
		return this.base.getSpecimenMap(rootId);
	}

	getWebhook(id: string): Promise<Webhook | null> {
		return this.base.getWebhook(id);
	}

	listWebhooks(filter?: WebhookFilter): Promise<Webhook[]> {
		return this.base.listWebhooks(filter);
	}

	getDelivery(id: string): Promise<WebhookDelivery | null> {
		return this.base.getDelivery(id);
	}

	listDeliveries(filter?: DeliveryFilter): Promise<WebhookDelivery[]> {
		return this.base.listDeliveries(filter);
	}

	getPendingDeliveries(): Promise<WebhookDelivery[]> {
		return this.base.getPendingDeliveries();
	}

	/** Nothing can be written, so there is nothing to roll back */
	transaction<T>(fn: () => Promise<T>): Promise<T> {
		return fn();
	}

	// Writes

	async createNode(_node: Node): Promise<void> {
		throw new OverlayWriteError('createNode');
	}

	async updateNode(_id: string, _updates: Partial<Node>): Promise<void> {
		throw new OverlayWriteError('updateNode');
	}

	async deleteNode(_id: string): Promise<void> {
		throw new OverlayWriteError('deleteNode');
	}

	async addOperation(_record: OperationRecord): Promise<void> {
		throw new OverlayWriteError('addOperation');
	}

	async removeOperation(_id: string): Promise<void> {
		throw new OverlayWriteError('removeOperation');
	}

	async setConstraints(_nodeId: string, _constraints: Constraint[]): Promise<void> {
		throw new OverlayWriteError('setConstraints');
	}

	async addConstraint(_nodeId: string, _constraint: Constraint): Promise<void> {
		throw new OverlayWriteError('addConstraint');
	}

	async removeConstraint(_nodeId: string, _constraintId: string): Promise<void> {
		throw new OverlayWriteError('removeConstraint');
	}

	async addAuditEvent(_event: AuditEvent): Promise<void> {
		throw new OverlayWriteError('addAuditEvent');
	}

	async addCheckSnapshot(_snapshot: CheckSnapshot): Promise<void> {
		throw new OverlayWriteError('addCheckSnapshot');
	}

	async setSpecimenMap(_rootId: string, _record: SpecimenMapRecord | null): Promise<void> {
		throw new OverlayWriteError('setSpecimenMap');
	}

	async createWebhook(_webhook: Webhook): Promise<void> {
		throw new OverlayWriteError('createWebhook');
	}

	async updateWebhook(_id: string, _updates: WebhookUpdate): Promise<void> {
		throw new OverlayWriteError('updateWebhook');
	}

	async deleteWebhook(_id: string): Promise<void> {
		throw new OverlayWriteError('deleteWebhook');
	}

	async createDelivery(_delivery: WebhookDelivery): Promise<void> {
		throw new OverlayWriteError('createDelivery');
	}

	async updateDelivery(_id: string, _updates: DeliveryUpdate): Promise<void> {
		throw new OverlayWriteError('updateDelivery');
	}
}
