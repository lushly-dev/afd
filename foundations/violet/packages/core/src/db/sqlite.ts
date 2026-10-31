import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';
import type { Database as IDatabase } from '../storage.js';
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
 * Load better-sqlite3 on first use, so in-memory and file-driven workflows
 * (e.g. `violet --from ./tokens export ...` in CI) never need the native module.
 */
function loadBetterSqlite3(): typeof Database {
	try {
		return createRequire(import.meta.url)('better-sqlite3');
	} catch (err) {
		throw new Error(
			`SQLite storage needs the optional 'better-sqlite3' package, which failed to load (${
				err instanceof Error ? err.message : String(err)
			}). Install it, or use --memory / --from for a database-free run.`,
		);
	}
}

/**
 * SQLite database implementation
 *
 * Production-ready storage using better-sqlite3.
 */
export class SQLiteDatabase implements IDatabase {
	private db: Database.Database;

	constructor(filename = ':memory:') {
		this.db = new (loadBetterSqlite3())(filename);
		this.db.pragma('journal_mode = WAL');
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
			-- Nodes table
			CREATE TABLE IF NOT EXISTS nodes (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				parent_id TEXT,
				type TEXT NOT NULL DEFAULT 'custom',
				owner TEXT,
				status TEXT NOT NULL DEFAULT 'active',
				-- Deprecation plan (#117)
				sunset_at TEXT,
				replaced_by TEXT,
				includes TEXT NOT NULL DEFAULT '[]',
				include_policy TEXT NOT NULL DEFAULT 'merge',
				tags TEXT NOT NULL DEFAULT '[]',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				FOREIGN KEY (parent_id) REFERENCES nodes(id)
			);

			-- Operations table (append-only)
			CREATE TABLE IF NOT EXISTS operations (
				id TEXT PRIMARY KEY,
				node_id TEXT NOT NULL,
				sequence INTEGER NOT NULL,
				type TEXT NOT NULL,
				token_id TEXT NOT NULL,
				value TEXT,
				metadata TEXT,
				from_node TEXT,
				as_token_id TEXT,
				to_ancestor TEXT,
				reason TEXT,
				author TEXT,
				created_at TEXT NOT NULL,
				FOREIGN KEY (node_id) REFERENCES nodes(id)
			);

			-- Audit events table (immutable)
			CREATE TABLE IF NOT EXISTS audit_events (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				event_type TEXT NOT NULL,
				actor TEXT NOT NULL,
				target_node TEXT NOT NULL,
				target_token TEXT,
				old_value TEXT,
				new_value TEXT,
				metadata TEXT,
				-- Write order, which breaks timestamp ties (#89)
				seq INTEGER
			);

			-- Constraints table
			CREATE TABLE IF NOT EXISTS constraints (
				id TEXT NOT NULL,
				node_id TEXT NOT NULL,
				name TEXT NOT NULL,
				description TEXT,
				constraint_type TEXT NOT NULL,
				config TEXT NOT NULL,
				severity TEXT NOT NULL DEFAULT 'error',
				apply_to TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				PRIMARY KEY (node_id, id),
				FOREIGN KEY (node_id) REFERENCES nodes(id)
			);

			-- Indexes for common queries
			CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id);
			CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
			CREATE INDEX IF NOT EXISTS idx_operations_node ON operations(node_id);
			CREATE INDEX IF NOT EXISTS idx_operations_token ON operations(token_id);
			CREATE INDEX IF NOT EXISTS idx_audit_node ON audit_events(target_node);
			CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
			CREATE INDEX IF NOT EXISTS idx_constraints_node ON constraints(node_id);

			-- Webhooks table
			CREATE TABLE IF NOT EXISTS webhooks (
				id TEXT PRIMARY KEY,
				url TEXT NOT NULL,
				secret TEXT NOT NULL,
				events TEXT NOT NULL,
				node_filter TEXT,
				description TEXT,
				active INTEGER NOT NULL DEFAULT 1,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				created_by TEXT
			);

			-- Webhook deliveries table
			CREATE TABLE IF NOT EXISTS webhook_deliveries (
				id TEXT PRIMARY KEY,
				webhook_id TEXT NOT NULL,
				event_type TEXT NOT NULL,
				payload TEXT NOT NULL,
				status INTEGER,
				response TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				next_retry_at TEXT,
				delivered_at TEXT,
				created_at TEXT NOT NULL,
				FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id);
			CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status);
			CREATE INDEX IF NOT EXISTS idx_deliveries_retry ON webhook_deliveries(next_retry_at);

			-- Rule check results over time (#117)
			CREATE TABLE IF NOT EXISTS check_snapshots (
				id TEXT PRIMARY KEY,
				root_id TEXT,
				taken_at TEXT NOT NULL,
				nodes INTEGER NOT NULL,
				counts TEXT NOT NULL,
				issues TEXT NOT NULL,
				actor TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_check_snapshots_taken ON check_snapshots(taken_at);

			-- Specimen role maps, one per tree root (#118)
			CREATE TABLE IF NOT EXISTS specimen_maps (
				root_id TEXT PRIMARY KEY,
				map TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				updated_by TEXT
			);
		`);
		this.upgradeAuditSequence();
		this.upgradeDeprecationPlan();
	}

	/**
	 * Give a nodes table made before #117 its sunset date and replacement
	 * columns. Both are nullable, so existing nodes simply have no plan.
	 */
	private upgradeDeprecationPlan(): void {
		const columns = this.db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
		const names = new Set(columns.map((column) => column.name));
		this.db.transaction(() => {
			if (!names.has('sunset_at')) this.db.exec('ALTER TABLE nodes ADD COLUMN sunset_at TEXT');
			if (!names.has('replaced_by')) this.db.exec('ALTER TABLE nodes ADD COLUMN replaced_by TEXT');
		})();
	}

	/**
	 * Give an audit_events table made before #89 its write-order column. Rows
	 * already there are numbered by rowid, the order they were inserted in.
	 */
	private upgradeAuditSequence(): void {
		const columns = this.db.prepare('PRAGMA table_info(audit_events)').all() as Array<{
			name: string;
		}>;
		if (!columns.some((column) => column.name === 'seq')) {
			this.db.transaction(() => {
				this.db.exec('ALTER TABLE audit_events ADD COLUMN seq INTEGER');
				this.db.exec('UPDATE audit_events SET seq = rowid');
			})();
		}
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_audit_seq ON audit_events(seq);
			CREATE INDEX IF NOT EXISTS idx_audit_timestamp_seq ON audit_events(timestamp, seq);
		`);
	}

	async getNode(id: string): Promise<Node | null> {
		const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;

		if (!row) return null;

		return rowToNode(row);
	}

	async createNode(node: Node): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO nodes (id, name, parent_id, type, owner, status, sunset_at, replaced_by, includes, include_policy, tags, created_at, updated_at, deleted_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				node.id,
				node.name,
				node.parentId,
				node.type,
				node.owner || null,
				node.status,
				node.sunsetAt ?? null,
				node.replacedBy ?? null,
				JSON.stringify(node.includes),
				node.includePolicy,
				JSON.stringify(node.tags),
				node.createdAt,
				node.updatedAt,
				node.deletedAt,
			);
	}

	async updateNode(id: string, updates: Partial<Node>): Promise<void> {
		const setClauses: string[] = [];
		const values: unknown[] = [];

		if (updates.name !== undefined) {
			setClauses.push('name = ?');
			values.push(updates.name);
		}
		if (updates.type !== undefined) {
			setClauses.push('type = ?');
			values.push(updates.type);
		}
		if (updates.owner !== undefined) {
			setClauses.push('owner = ?');
			values.push(updates.owner);
		}
		if (updates.status !== undefined) {
			setClauses.push('status = ?');
			values.push(updates.status);
		}
		if (updates.sunsetAt !== undefined) {
			setClauses.push('sunset_at = ?');
			values.push(updates.sunsetAt);
		}
		if (updates.replacedBy !== undefined) {
			setClauses.push('replaced_by = ?');
			values.push(updates.replacedBy);
		}
		if (updates.includes !== undefined) {
			setClauses.push('includes = ?');
			values.push(JSON.stringify(updates.includes));
		}
		if (updates.includePolicy !== undefined) {
			setClauses.push('include_policy = ?');
			values.push(updates.includePolicy);
		}
		if (updates.tags !== undefined) {
			setClauses.push('tags = ?');
			values.push(JSON.stringify(updates.tags));
		}
		if (updates.updatedAt !== undefined) {
			setClauses.push('updated_at = ?');
			values.push(updates.updatedAt);
		}
		if (updates.deletedAt !== undefined) {
			setClauses.push('deleted_at = ?');
			values.push(updates.deletedAt);
		}

		if (setClauses.length === 0) return;

		values.push(id);
		this.db.prepare(`UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
	}

	async deleteNode(id: string): Promise<void> {
		this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
	}

	async listNodes(parentId?: string | null): Promise<Node[]> {
		let rows: NodeRow[];

		if (parentId === undefined) {
			rows = this.db.prepare('SELECT * FROM nodes').all() as NodeRow[];
		} else if (parentId === null) {
			rows = this.db.prepare('SELECT * FROM nodes WHERE parent_id IS NULL').all() as NodeRow[];
		} else {
			rows = this.db.prepare('SELECT * FROM nodes WHERE parent_id = ?').all(parentId) as NodeRow[];
		}

		return rows.map(rowToNode);
	}

	async getAncestryChain(nodeId: string): Promise<string[]> {
		const chain: string[] = [];
		let currentId: string | null = nodeId;

		while (currentId) {
			const row = this.db.prepare('SELECT parent_id FROM nodes WHERE id = ?').get(currentId) as
				| { parent_id: string | null }
				| undefined;

			if (!row?.parent_id) break;

			chain.unshift(row.parent_id);
			currentId = row.parent_id;
		}

		return chain;
	}

	async getDescendants(nodeId: string): Promise<Node[]> {
		// SQLite recursive CTE for descendants
		const rows = this.db
			.prepare(
				`WITH RECURSIVE descendants AS (
					SELECT * FROM nodes WHERE parent_id = ?
					UNION ALL
					SELECT n.* FROM nodes n
					JOIN descendants d ON n.parent_id = d.id
				)
				SELECT * FROM descendants`,
			)
			.all(nodeId) as NodeRow[];

		return rows.map(rowToNode);
	}

	async getOperations(nodeId: string): Promise<OperationRecord[]> {
		const rows = this.db
			.prepare('SELECT * FROM operations WHERE node_id = ? ORDER BY sequence')
			.all(nodeId) as OperationRow[];

		return rows.map(rowToOperation);
	}

	async addOperation(record: OperationRecord): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO operations (id, node_id, sequence, type, token_id, value, metadata, from_node, as_token_id, to_ancestor, reason, author, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				record.id,
				record.nodeId,
				record.sequence,
				record.type,
				record.tokenId,
				record.value,
				record.metadata,
				record.fromNode,
				record.asTokenId,
				record.toAncestor,
				record.reason,
				record.author,
				record.createdAt,
			);
	}

	async removeOperation(id: string): Promise<void> {
		this.db.prepare('DELETE FROM operations WHERE id = ?').run(id);
	}

	async addAuditEvent(event: AuditEvent): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO audit_events (id, timestamp, event_type, actor, target_node, target_token, old_value, new_value, metadata, seq)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM audit_events))`,
			)
			.run(
				event.id,
				event.timestamp,
				event.eventType,
				event.actor,
				event.targetNode,
				event.targetToken,
				event.oldValue,
				event.newValue,
				event.metadata,
			);
	}

	async getAuditEvents(filter: AuditEventFilter): Promise<AuditEvent[]> {
		const whereClauses: string[] = [];
		const values: unknown[] = [];

		if (filter.targetNode !== undefined) {
			whereClauses.push('target_node = ?');
			values.push(filter.targetNode);
		}
		if (filter.targetToken !== undefined) {
			whereClauses.push('target_token = ?');
			values.push(filter.targetToken);
		}
		if (filter.eventType !== undefined) {
			whereClauses.push('event_type = ?');
			values.push(filter.eventType);
		}
		if (filter.actor !== undefined) {
			whereClauses.push('actor = ?');
			values.push(filter.actor);
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const rows = this.db
			.prepare(`SELECT * FROM audit_events ${where} ORDER BY timestamp DESC, seq DESC`)
			.all(...values) as AuditRow[];

		return rows.map(rowToAudit);
	}

	async queryAuditEvents(query: AuditEventQuery): Promise<AuditEventPage> {
		const whereClauses: string[] = [];
		const values: unknown[] = [];
		const anyOf = (column: string, list: readonly string[]) => {
			// An empty list matches nothing, like Array.includes
			whereClauses.push(list.length > 0 ? `${column} IN (${list.map(() => '?').join(', ')})` : '0');
			values.push(...list);
		};

		if (query.nodeIds) anyOf('target_node', query.nodeIds);
		if (query.tokenId) {
			whereClauses.push('target_token = ?');
			values.push(query.tokenId);
		}
		if (query.eventTypes) anyOf('event_type', query.eventTypes);
		if (query.actor) {
			whereClauses.push('actor = ?');
			values.push(query.actor);
		}
		// Timestamps are stored as ISO strings, which sort chronologically
		if (query.since) {
			whereClauses.push('timestamp >= ?');
			values.push(new Date(query.since).toISOString());
		}
		if (query.until) {
			whereClauses.push('timestamp < ?');
			values.push(new Date(query.until).toISOString());
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const rows = this.db
			.prepare(
				`SELECT * FROM audit_events ${where} ORDER BY timestamp DESC, seq DESC LIMIT ? OFFSET ?`,
			)
			.all(...values, query.limit, query.offset) as AuditRow[];
		const total = this.db
			.prepare(`SELECT COUNT(*) AS count FROM audit_events ${where}`)
			.get(...values) as { count: number };
		const days = this.db
			.prepare(
				`SELECT substr(timestamp, 1, 10) AS date, event_type, COUNT(*) AS count
				 FROM audit_events ${where}
				 GROUP BY date, event_type`,
			)
			.all(...values) as Array<{ date: string; event_type: string; count: number }>;

		return {
			events: rows.map(rowToAudit),
			total: total.count,
			days: days.map(
				(day): AuditDayCount => ({
					date: day.date,
					eventType: day.event_type as AuditDayCount['eventType'],
					count: day.count,
				}),
			),
		};
	}

	async transaction<T>(fn: () => Promise<T>): Promise<T> {
		return this.db.transaction(() => fn())();
	}

	// =============================================================================
	// Rule Check History and Specimen Maps
	// =============================================================================

	async addCheckSnapshot(snapshot: CheckSnapshot): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO check_snapshots (id, root_id, taken_at, nodes, counts, issues, actor)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				snapshot.id,
				snapshot.rootId,
				snapshot.takenAt,
				snapshot.nodes,
				JSON.stringify(snapshot.counts),
				JSON.stringify(snapshot.issues),
				snapshot.actor,
			);
	}

	async listCheckSnapshots(query: CheckSnapshotQuery = {}): Promise<CheckSnapshot[]> {
		const where: string[] = [];
		const values: unknown[] = [];
		if (query.rootIds) {
			const ids = query.rootIds.filter((id): id is string => id !== null);
			const matches = [
				...(ids.length > 0 ? [`root_id IN (${ids.map(() => '?').join(', ')})`] : []),
				...(query.rootIds.includes(null) ? ['root_id IS NULL'] : []),
			];
			where.push(matches.length > 0 ? `(${matches.join(' OR ')})` : '0');
			values.push(...ids);
		}
		if (query.since) {
			where.push('taken_at >= ?');
			values.push(query.since);
		}
		if (query.until) {
			where.push('taken_at < ?');
			values.push(query.until);
		}
		const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
		const limit = query.limit === undefined ? '' : 'LIMIT ?';
		if (query.limit !== undefined) values.push(query.limit);
		// Newest first so a limit keeps the latest, then back to oldest first
		const rows = this.db
			.prepare(
				`SELECT * FROM check_snapshots ${filter} ORDER BY taken_at DESC, rowid DESC ${limit}`,
			)
			.all(...values) as CheckSnapshotRow[];
		return rows.reverse().map(rowToCheckSnapshot);
	}

	async getSpecimenMap(rootId: string): Promise<SpecimenMapRecord | null> {
		const row = this.db.prepare('SELECT * FROM specimen_maps WHERE root_id = ?').get(rootId) as
			| SpecimenMapRow
			| undefined;
		return row ? rowToSpecimenMap(row) : null;
	}

	async setSpecimenMap(rootId: string, record: SpecimenMapRecord | null): Promise<void> {
		if (!record) {
			this.db.prepare('DELETE FROM specimen_maps WHERE root_id = ?').run(rootId);
			return;
		}
		this.db
			.prepare(
				`INSERT INTO specimen_maps (root_id, map, updated_at, updated_by) VALUES (?, ?, ?, ?)
				 ON CONFLICT(root_id) DO UPDATE SET
				   map = excluded.map, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
			)
			.run(rootId, JSON.stringify(record.map), record.updatedAt, record.updatedBy);
	}

	// =============================================================================
	// Constraint Methods
	// =============================================================================

	async getConstraints(nodeId: string): Promise<Constraint[]> {
		const rows = this.db
			.prepare('SELECT * FROM constraints WHERE node_id = ?')
			.all(nodeId) as ConstraintRow[];

		return rows.map(rowToConstraint);
	}

	async setConstraints(nodeId: string, constraints: Constraint[]): Promise<void> {
		// Delete existing constraints for this node
		this.db.prepare('DELETE FROM constraints WHERE node_id = ?').run(nodeId);

		// Insert new constraints
		const insert = this.db.prepare(
			`INSERT INTO constraints (id, node_id, name, description, constraint_type, config, severity, apply_to, enabled)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);

		for (const constraint of constraints) {
			insert.run(
				constraint.id,
				nodeId,
				constraint.name,
				constraint.description || null,
				constraint.config.type,
				JSON.stringify(constraint.config),
				constraint.severity,
				constraint.applyTo,
				constraint.enabled ? 1 : 0,
			);
		}
	}

	async addConstraint(nodeId: string, constraint: Constraint): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO constraints (id, node_id, name, description, constraint_type, config, severity, apply_to, enabled)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				constraint.id,
				nodeId,
				constraint.name,
				constraint.description || null,
				constraint.config.type,
				JSON.stringify(constraint.config),
				constraint.severity,
				constraint.applyTo,
				constraint.enabled ? 1 : 0,
			);
	}

	async removeConstraint(nodeId: string, constraintId: string): Promise<void> {
		this.db
			.prepare('DELETE FROM constraints WHERE node_id = ? AND id = ?')
			.run(nodeId, constraintId);
	}

	// =============================================================================
	// Webhook Methods
	// =============================================================================

	async createWebhook(webhook: Webhook): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO webhooks (id, url, secret, events, node_filter, description, active, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				webhook.id,
				webhook.url,
				webhook.secret,
				JSON.stringify(webhook.events),
				webhook.nodeFilter || null,
				webhook.description || null,
				webhook.active ? 1 : 0,
				webhook.createdAt,
				webhook.updatedAt,
				webhook.createdBy || null,
			);
	}

	async getWebhook(id: string): Promise<Webhook | null> {
		const row = this.db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as
			| WebhookRow
			| undefined;

		if (!row) return null;
		return rowToWebhook(row);
	}

	async updateWebhook(id: string, updates: WebhookUpdate): Promise<void> {
		// undefined = leave unchanged; null (or '') = clear nodeFilter/description
		const setClauses: string[] = [];
		const values: unknown[] = [];

		if (updates.url !== undefined) {
			setClauses.push('url = ?');
			values.push(updates.url);
		}
		if (updates.secret !== undefined) {
			setClauses.push('secret = ?');
			values.push(updates.secret);
		}
		if (updates.events !== undefined) {
			setClauses.push('events = ?');
			values.push(JSON.stringify(updates.events));
		}
		if (updates.nodeFilter !== undefined) {
			setClauses.push('node_filter = ?');
			values.push(updates.nodeFilter || null);
		}
		if (updates.description !== undefined) {
			setClauses.push('description = ?');
			values.push(updates.description || null);
		}
		if (updates.active !== undefined) {
			setClauses.push('active = ?');
			values.push(updates.active ? 1 : 0);
		}

		// Nothing to change (also keeps updated_at untouched for no-op updates)
		if (setClauses.length === 0) return;

		setClauses.push('updated_at = ?');
		values.push(new Date().toISOString());
		values.push(id);

		this.db.prepare(`UPDATE webhooks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
	}

	async deleteWebhook(id: string): Promise<void> {
		// Deliveries are cascade deleted via foreign key
		this.db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
	}

	async listWebhooks(filter?: WebhookFilter): Promise<Webhook[]> {
		const whereClauses: string[] = [];
		const values: unknown[] = [];

		if (filter?.active !== undefined) {
			whereClauses.push('active = ?');
			values.push(filter.active ? 1 : 0);
		}

		if (filter?.events && filter.events.length > 0) {
			// Match webhooks that have any of the specified events
			const eventConditions = filter.events.map(() => 'events LIKE ?');
			whereClauses.push(`(${eventConditions.join(' OR ')})`);
			for (const event of filter.events) {
				values.push(`%"${event}"%`);
			}
		}

		if (filter?.nodeFilter) {
			whereClauses.push("(node_filter IS NULL OR node_filter = ? OR ? LIKE node_filter || '%')");
			values.push(filter.nodeFilter, filter.nodeFilter);
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const rows = this.db
			.prepare(`SELECT * FROM webhooks ${where} ORDER BY created_at DESC`)
			.all(...values) as WebhookRow[];

		return rows.map(rowToWebhook);
	}

	// =============================================================================
	// Webhook Delivery Methods
	// =============================================================================

	async createDelivery(delivery: WebhookDelivery): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, response, attempts, next_retry_at, delivered_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				delivery.id,
				delivery.webhookId,
				delivery.eventType,
				delivery.payload,
				delivery.status,
				delivery.response || null,
				delivery.attempts,
				delivery.nextRetryAt || null,
				delivery.deliveredAt || null,
				delivery.createdAt,
			);
	}

	async getDelivery(id: string): Promise<WebhookDelivery | null> {
		const row = this.db.prepare('SELECT * FROM webhook_deliveries WHERE id = ?').get(id) as
			| DeliveryRow
			| undefined;

		if (!row) return null;
		return rowToDelivery(row);
	}

	async updateDelivery(id: string, updates: DeliveryUpdate): Promise<void> {
		// undefined = leave unchanged; null clears response/nextRetryAt/deliveredAt
		const setClauses: string[] = [];
		const values: unknown[] = [];

		if (updates.status !== undefined) {
			setClauses.push('status = ?');
			values.push(updates.status);
		}
		if (updates.response !== undefined) {
			setClauses.push('response = ?');
			values.push(updates.response || null);
		}
		if (updates.attempts !== undefined) {
			setClauses.push('attempts = ?');
			values.push(updates.attempts);
		}
		if (updates.nextRetryAt !== undefined) {
			setClauses.push('next_retry_at = ?');
			values.push(updates.nextRetryAt || null);
		}
		if (updates.deliveredAt !== undefined) {
			setClauses.push('delivered_at = ?');
			values.push(updates.deliveredAt || null);
		}

		values.push(id);

		if (setClauses.length > 0) {
			this.db
				.prepare(`UPDATE webhook_deliveries SET ${setClauses.join(', ')} WHERE id = ?`)
				.run(...values);
		}
	}

	async listDeliveries(filter?: DeliveryFilter): Promise<WebhookDelivery[]> {
		const whereClauses: string[] = [];
		const values: unknown[] = [];

		if (filter?.webhookId) {
			whereClauses.push('webhook_id = ?');
			values.push(filter.webhookId);
		}

		if (filter?.status) {
			switch (filter.status) {
				case 'success':
					whereClauses.push('status >= 200 AND status < 300');
					break;
				case 'failed':
					// Includes network failures (status NULL) once at least one attempt was made
					whereClauses.push(
						'((status IS NULL AND attempts > 0) OR status < 200 OR status >= 300) AND next_retry_at IS NULL',
					);
					break;
				case 'pending':
					whereClauses.push('delivered_at IS NULL AND (next_retry_at IS NOT NULL OR attempts = 0)');
					break;
			}
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const limit =
			Number.isInteger(filter?.limit) && (filter?.limit as number) > 0
				? (filter?.limit as number)
				: 100;
		values.push(limit);
		const rows = this.db
			.prepare(`SELECT * FROM webhook_deliveries ${where} ORDER BY created_at DESC LIMIT ?`)
			.all(...values) as DeliveryRow[];

		return rows.map(rowToDelivery);
	}

	async getPendingDeliveries(): Promise<WebhookDelivery[]> {
		const now = new Date().toISOString();
		const rows = this.db
			.prepare(
				`SELECT * FROM webhook_deliveries
         WHERE delivered_at IS NULL
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= ?
         ORDER BY next_retry_at ASC
         LIMIT 100`,
			)
			.all(now) as DeliveryRow[];

		return rows.map(rowToDelivery);
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		this.db.close();
	}
}

// Row types for SQLite
interface NodeRow {
	id: string;
	name: string;
	parent_id: string | null;
	type: string;
	owner: string | null;
	status: string;
	sunset_at: string | null;
	replaced_by: string | null;
	includes: string;
	include_policy: string;
	tags: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

interface OperationRow {
	id: string;
	node_id: string;
	sequence: number;
	type: string;
	token_id: string;
	value: string | null;
	metadata: string | null;
	from_node: string | null;
	as_token_id: string | null;
	to_ancestor: string | null;
	reason: string | null;
	author: string | null;
	created_at: string;
}

interface AuditRow {
	id: string;
	timestamp: string;
	event_type: string;
	actor: string;
	target_node: string;
	target_token: string | null;
	old_value: string | null;
	new_value: string | null;
	metadata: string | null;
}

interface ConstraintRow {
	id: string;
	node_id: string;
	name: string;
	description: string | null;
	constraint_type: string;
	config: string;
	severity: string;
	apply_to: string;
	enabled: number;
}

function rowToNode(row: NodeRow): Node {
	return {
		id: row.id,
		name: row.name,
		parentId: row.parent_id,
		type: row.type as Node['type'],
		owner: row.owner || undefined,
		status: row.status as Node['status'],
		...(row.sunset_at ? { sunsetAt: row.sunset_at } : {}),
		...(row.replaced_by ? { replacedBy: row.replaced_by } : {}),
		includes: JSON.parse(row.includes),
		includePolicy: row.include_policy as Node['includePolicy'],
		tags: JSON.parse(row.tags),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at,
	};
}

function rowToOperation(row: OperationRow): OperationRecord {
	return {
		id: row.id,
		nodeId: row.node_id,
		sequence: row.sequence,
		type: row.type as OperationRecord['type'],
		tokenId: row.token_id,
		value: row.value,
		metadata: row.metadata,
		fromNode: row.from_node,
		asTokenId: row.as_token_id,
		toAncestor: row.to_ancestor,
		reason: row.reason,
		author: row.author,
		createdAt: row.created_at,
	};
}

function rowToAudit(row: AuditRow): AuditEvent {
	return {
		id: row.id,
		timestamp: row.timestamp,
		eventType: row.event_type as AuditEvent['eventType'],
		actor: row.actor,
		targetNode: row.target_node,
		targetToken: row.target_token,
		oldValue: row.old_value,
		newValue: row.new_value,
		metadata: row.metadata,
	};
}

function rowToConstraint(row: ConstraintRow): Constraint {
	return {
		id: row.id,
		name: row.name,
		description: row.description || undefined,
		config: JSON.parse(row.config),
		severity: row.severity as Constraint['severity'],
		applyTo: row.apply_to,
		enabled: row.enabled === 1,
	};
}

interface CheckSnapshotRow {
	id: string;
	root_id: string | null;
	taken_at: string;
	nodes: number;
	counts: string;
	issues: string;
	actor: string | null;
}

function rowToCheckSnapshot(row: CheckSnapshotRow): CheckSnapshot {
	return {
		id: row.id,
		rootId: row.root_id,
		takenAt: row.taken_at,
		nodes: row.nodes,
		counts: JSON.parse(row.counts),
		issues: JSON.parse(row.issues),
		actor: row.actor,
	};
}

interface SpecimenMapRow {
	root_id: string;
	map: string;
	updated_at: string;
	updated_by: string | null;
}

function rowToSpecimenMap(row: SpecimenMapRow): SpecimenMapRecord {
	return {
		rootId: row.root_id,
		map: JSON.parse(row.map),
		updatedAt: row.updated_at,
		updatedBy: row.updated_by,
	};
}

interface WebhookRow {
	id: string;
	url: string;
	secret: string;
	events: string;
	node_filter: string | null;
	description: string | null;
	active: number;
	created_at: string;
	updated_at: string;
	created_by: string | null;
}

interface DeliveryRow {
	id: string;
	webhook_id: string;
	event_type: string;
	payload: string;
	status: number | null;
	response: string | null;
	attempts: number;
	next_retry_at: string | null;
	delivered_at: string | null;
	created_at: string;
}

function rowToWebhook(row: WebhookRow): Webhook {
	return {
		id: row.id,
		url: row.url,
		secret: row.secret,
		events: JSON.parse(row.events),
		nodeFilter: row.node_filter || undefined,
		description: row.description || undefined,
		active: row.active === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		createdBy: row.created_by || undefined,
	};
}

function rowToDelivery(row: DeliveryRow): WebhookDelivery {
	return {
		id: row.id,
		webhookId: row.webhook_id,
		eventType: row.event_type as WebhookDelivery['eventType'],
		payload: row.payload,
		status: row.status,
		response: row.response || undefined,
		attempts: row.attempts,
		nextRetryAt: row.next_retry_at || undefined,
		deliveredAt: row.delivered_at || undefined,
		createdAt: row.created_at,
	};
}

/**
 * Create a new SQLite database instance
 */
export function createSQLiteDatabase(filename?: string): SQLiteDatabase {
	return new SQLiteDatabase(filename);
}
