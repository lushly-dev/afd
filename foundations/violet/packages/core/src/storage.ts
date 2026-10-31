/**
 * Database interface (implemented by storage layer)
 */
export interface Database {
	// Node operations
	getNode(id: string): Promise<import('./types/node.js').Node | null>;
	createNode(node: import('./types/node.js').Node): Promise<void>;
	updateNode(id: string, updates: Partial<import('./types/node.js').Node>): Promise<void>;
	deleteNode(id: string): Promise<void>;
	listNodes(parentId?: string | null): Promise<import('./types/node.js').Node[]>;
	getAncestryChain(nodeId: string): Promise<string[]>;
	getDescendants(nodeId: string): Promise<import('./types/node.js').Node[]>;

	// Operation operations
	getOperations(nodeId: string): Promise<import('./types/operation.js').OperationRecord[]>;
	addOperation(record: import('./types/operation.js').OperationRecord): Promise<void>;
	removeOperation(id: string): Promise<void>;

	// Constraint operations
	getConstraints(nodeId: string): Promise<import('./types/constraint.js').Constraint[]>;
	setConstraints(
		nodeId: string,
		constraints: import('./types/constraint.js').Constraint[],
	): Promise<void>;
	addConstraint(
		nodeId: string,
		constraint: import('./types/constraint.js').Constraint,
	): Promise<void>;
	removeConstraint(nodeId: string, constraintId: string): Promise<void>;

	// Audit operations
	addAuditEvent(event: import('./types/operation.js').AuditEvent): Promise<void>;
	/** Newest first, like `queryAuditEvents`; see `AuditEventFilter` */
	getAuditEvents(
		filter: import('./types/operation.js').AuditEventFilter,
	): Promise<import('./types/operation.js').AuditEvent[]>;
	queryAuditEvents(
		query: import('./types/operation.js').AuditEventQuery,
	): Promise<import('./types/operation.js').AuditEventPage>;

	// Rule check history (#117)
	addCheckSnapshot(snapshot: import('./types/snapshot.js').CheckSnapshot): Promise<void>;
	listCheckSnapshots(
		query?: import('./types/snapshot.js').CheckSnapshotQuery,
	): Promise<import('./types/snapshot.js').CheckSnapshot[]>;

	// Specimen role maps, one per tree root (#118); null removes the map
	getSpecimenMap(rootId: string): Promise<import('./types/specimen.js').SpecimenMapRecord | null>;
	setSpecimenMap(
		rootId: string,
		record: import('./types/specimen.js').SpecimenMapRecord | null,
	): Promise<void>;

	// Webhook operations
	createWebhook(webhook: import('./types/webhook.js').Webhook): Promise<void>;
	getWebhook(id: string): Promise<import('./types/webhook.js').Webhook | null>;
	updateWebhook(id: string, updates: import('./types/webhook.js').WebhookUpdate): Promise<void>;
	deleteWebhook(id: string): Promise<void>;
	listWebhooks(
		filter?: import('./types/webhook.js').WebhookFilter,
	): Promise<import('./types/webhook.js').Webhook[]>;

	// Webhook delivery operations
	createDelivery(delivery: import('./types/webhook.js').WebhookDelivery): Promise<void>;
	getDelivery(id: string): Promise<import('./types/webhook.js').WebhookDelivery | null>;
	updateDelivery(id: string, updates: import('./types/webhook.js').DeliveryUpdate): Promise<void>;
	listDeliveries(
		filter?: import('./types/webhook.js').DeliveryFilter,
	): Promise<import('./types/webhook.js').WebhookDelivery[]>;
	getPendingDeliveries(): Promise<import('./types/webhook.js').WebhookDelivery[]>;

	// Utility
	transaction<T>(fn: () => Promise<T>): Promise<T>;
}
