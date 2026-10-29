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
 * Minimal Postgres query surface for Neon-compatible adapters.
 *
 * This is intentionally small so the core package can stay decoupled from a
 * specific Postgres client while we evaluate Neon/Vercel fit.
 */
export interface PostgresQueryable {
	query<TRow>(sql: string, params?: readonly unknown[]): Promise<readonly TRow[]>;
}

/**
 * Transaction-capable Postgres client.
 *
 * The callback receives a transaction-bound queryable. This maps cleanly to
 * popular clients such as `postgres` or Neon wrappers.
 */
export interface PostgresClient extends PostgresQueryable {
	transaction<T>(fn: (tx: PostgresQueryable) => Promise<T>): Promise<T>;
}

/**
 * Give an audit_events table made before #89 its insertion sequence. Existing
 * rows are numbered by (timestamp, id), so they keep the order they had; new
 * rows take the next value. Does nothing when the column exists. The hosted
 * database gets the same change from packages/api/migrations/0003.
 */
export const POSTGRES_AUDIT_SEQUENCE_UPGRADE = `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'audit_events'
      AND column_name = 'seq'
  ) THEN
    ALTER TABLE audit_events ADD COLUMN seq BIGINT;
    UPDATE audit_events AS event
    SET seq = numbered.n
    FROM (
      SELECT id, row_number() OVER (ORDER BY timestamp, id COLLATE "C") AS n
      FROM audit_events
    ) AS numbered
    WHERE event.id = numbered.id;
    CREATE SEQUENCE audit_events_seq_seq OWNED BY audit_events.seq;
    PERFORM setval('audit_events_seq_seq', COALESCE((SELECT MAX(seq) FROM audit_events), 0) + 1, false);
    ALTER TABLE audit_events
      ALTER COLUMN seq SET DEFAULT nextval('audit_events_seq_seq'),
      ALTER COLUMN seq SET NOT NULL;
  END IF;
END $$`;

/**
 * #117 and #118: a deprecation plan on nodes (sunset date, replacement), rule
 * check snapshots, and specimen role maps. Additive and idempotent: the new
 * columns are nullable, so existing nodes have no plan, and the tables start
 * empty. The hosted database gets the same statements from
 * packages/api/migrations/0004.
 */
export const POSTGRES_LENS_FOLLOW_UPS_UPGRADE = [
	'ALTER TABLE nodes ADD COLUMN IF NOT EXISTS sunset_at TEXT',
	'ALTER TABLE nodes ADD COLUMN IF NOT EXISTS replaced_by TEXT',
	`CREATE TABLE IF NOT EXISTS check_snapshots (
    id TEXT PRIMARY KEY,
    root_id TEXT,
    taken_at TIMESTAMPTZ NOT NULL,
    nodes INTEGER NOT NULL,
    counts JSONB NOT NULL,
    issues JSONB NOT NULL,
    actor TEXT
  )`,
	'CREATE INDEX IF NOT EXISTS idx_check_snapshots_taken ON check_snapshots(taken_at)',
	`CREATE TABLE IF NOT EXISTS specimen_maps (
    root_id TEXT PRIMARY KEY,
    map JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    updated_by TEXT
  )`,
] as const;

/**
 * Schema statements for the Neon/Postgres prototype.
 *
 * We keep operational payload fields as text where Violet already treats them
 * as serialized JSON strings, and upgrade structural list/config fields to
 * jsonb where Postgres is a natural improvement.
 */
export const POSTGRES_SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES nodes(id),
    type TEXT NOT NULL DEFAULT 'custom',
    owner TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    includes JSONB NOT NULL DEFAULT '[]'::jsonb,
    include_policy TEXT NOT NULL DEFAULT 'merge',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    deleted_at TIMESTAMPTZ
  )`,
	`CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id),
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
    created_at TIMESTAMPTZ NOT NULL
  )`,
	`CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    target_node TEXT NOT NULL,
    target_token TEXT,
    old_value TEXT,
    new_value TEXT,
    metadata TEXT,
    seq BIGSERIAL NOT NULL
  )`,
	POSTGRES_AUDIT_SEQUENCE_UPGRADE,
	`CREATE TABLE IF NOT EXISTS constraints (
    id TEXT NOT NULL,
    node_id TEXT NOT NULL REFERENCES nodes(id),
    name TEXT NOT NULL,
    description TEXT,
    constraint_type TEXT NOT NULL,
    config JSONB NOT NULL,
    severity TEXT NOT NULL DEFAULT 'error',
    apply_to TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (node_id, id)
  )`,
	`CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events JSONB NOT NULL,
    node_filter TEXT,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    created_by TEXT
  )`,
	`CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status INTEGER,
    response TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
  )`,
	'CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id)',
	'CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type)',
	'CREATE INDEX IF NOT EXISTS idx_operations_node ON operations(node_id)',
	'CREATE INDEX IF NOT EXISTS idx_operations_token ON operations(token_id)',
	'CREATE INDEX IF NOT EXISTS idx_operations_node_sequence ON operations(node_id, sequence)',
	'CREATE INDEX IF NOT EXISTS idx_audit_node ON audit_events(target_node)',
	'CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC)',
	'CREATE INDEX IF NOT EXISTS idx_audit_timestamp_seq ON audit_events(timestamp DESC, seq DESC)',
	'CREATE INDEX IF NOT EXISTS idx_constraints_node ON constraints(node_id)',
	'CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id)',
	'CREATE INDEX IF NOT EXISTS idx_deliveries_status ON webhook_deliveries(status)',
	'CREATE INDEX IF NOT EXISTS idx_deliveries_retry ON webhook_deliveries(next_retry_at)',
	...POSTGRES_LENS_FOLLOW_UPS_UPGRADE,
] as const;

/**
 * Postgres implementation of Violet's storage contract.
 *
 * This prototype assumes the adapter is used request-scoped or otherwise not
 * shared across overlapping transactions, which matches the current API usage.
 */
export class PostgresDatabase implements Database {
	private readonly client: PostgresClient;
	private executor: PostgresQueryable;

	constructor(client: PostgresClient) {
		this.client = client;
		this.executor = client;
	}

	async initSchema(): Promise<void> {
		for (const statement of POSTGRES_SCHEMA_STATEMENTS) {
			await this.executor.query(statement);
		}
	}

	async getNode(id: string): Promise<Node | null> {
		const rows = await this.executor.query<NodeRow>('SELECT * FROM nodes WHERE id = $1', [id]);
		return rows[0] ? rowToNode(rows[0]) : null;
	}

	async createNode(node: Node): Promise<void> {
		await this.executor.query(
			`INSERT INTO nodes (
        id, name, parent_id, type, owner, status, includes, include_policy,
        tags, created_at, updated_at, deleted_at, sunset_at, replaced_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13, $14
      )`,
			[
				node.id,
				node.name,
				node.parentId,
				node.type,
				node.owner || null,
				node.status,
				JSON.stringify(node.includes),
				node.includePolicy,
				JSON.stringify(node.tags),
				node.createdAt,
				node.updatedAt,
				node.deletedAt,
				node.sunsetAt ?? null,
				node.replacedBy ?? null,
			],
		);
	}

	async updateNode(id: string, updates: Partial<Node>): Promise<void> {
		const setClauses: string[] = [];
		const params: unknown[] = [];

		if (updates.name !== undefined) {
			setClauses.push(`name = ${bindParam(params, updates.name)}`);
		}
		if (updates.type !== undefined) {
			setClauses.push(`type = ${bindParam(params, updates.type)}`);
		}
		if (updates.owner !== undefined) {
			setClauses.push(`owner = ${bindParam(params, updates.owner)}`);
		}
		if (updates.status !== undefined) {
			setClauses.push(`status = ${bindParam(params, updates.status)}`);
		}
		if (updates.sunsetAt !== undefined) {
			setClauses.push(`sunset_at = ${bindParam(params, updates.sunsetAt)}`);
		}
		if (updates.replacedBy !== undefined) {
			setClauses.push(`replaced_by = ${bindParam(params, updates.replacedBy)}`);
		}
		if (updates.includes !== undefined) {
			const placeholder = bindParam(params, JSON.stringify(updates.includes));
			setClauses.push(`includes = ${placeholder}::jsonb`);
		}
		if (updates.includePolicy !== undefined) {
			setClauses.push(`include_policy = ${bindParam(params, updates.includePolicy)}`);
		}
		if (updates.tags !== undefined) {
			const placeholder = bindParam(params, JSON.stringify(updates.tags));
			setClauses.push(`tags = ${placeholder}::jsonb`);
		}
		if (updates.updatedAt !== undefined) {
			setClauses.push(`updated_at = ${bindParam(params, updates.updatedAt)}`);
		}
		if (updates.deletedAt !== undefined) {
			setClauses.push(`deleted_at = ${bindParam(params, updates.deletedAt)}`);
		}

		if (setClauses.length === 0) return;

		const idPlaceholder = bindParam(params, id);
		await this.executor.query(
			`UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ${idPlaceholder}`,
			params,
		);
	}

	async deleteNode(id: string): Promise<void> {
		await this.executor.query('DELETE FROM nodes WHERE id = $1', [id]);
	}

	async listNodes(parentId?: string | null): Promise<Node[]> {
		let rows: readonly NodeRow[];

		if (parentId === undefined) {
			rows = await this.executor.query<NodeRow>('SELECT * FROM nodes');
		} else if (parentId === null) {
			rows = await this.executor.query<NodeRow>('SELECT * FROM nodes WHERE parent_id IS NULL');
		} else {
			rows = await this.executor.query<NodeRow>('SELECT * FROM nodes WHERE parent_id = $1', [
				parentId,
			]);
		}

		return rows.map(rowToNode);
	}

	async getAncestryChain(nodeId: string): Promise<string[]> {
		const rows = await this.executor.query<{ id: string }>(
			`WITH RECURSIVE ancestry AS (
        SELECT id, parent_id, 0 AS depth
        FROM nodes
        WHERE id = $1
        UNION ALL
        SELECT n.id, n.parent_id, ancestry.depth + 1
        FROM nodes n
        JOIN ancestry ON n.id = ancestry.parent_id
      )
      SELECT id
      FROM ancestry
      WHERE id <> $1
      ORDER BY depth DESC`,
			[nodeId],
		);

		return rows.map((row) => row.id);
	}

	async getDescendants(nodeId: string): Promise<Node[]> {
		const rows = await this.executor.query<NodeRow>(
			`WITH RECURSIVE descendants AS (
        SELECT * FROM nodes WHERE parent_id = $1
        UNION ALL
        SELECT n.*
        FROM nodes n
        JOIN descendants d ON n.parent_id = d.id
      )
      SELECT * FROM descendants`,
			[nodeId],
		);

		return rows.map(rowToNode);
	}

	async getOperations(nodeId: string): Promise<OperationRecord[]> {
		const rows = await this.executor.query<OperationRow>(
			'SELECT * FROM operations WHERE node_id = $1 ORDER BY sequence',
			[nodeId],
		);
		return rows.map(rowToOperation);
	}

	async addOperation(record: OperationRecord): Promise<void> {
		await this.executor.query(
			`INSERT INTO operations (
        id, node_id, sequence, type, token_id, value, metadata, from_node,
        as_token_id, to_ancestor, reason, author, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )`,
			[
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
			],
		);
	}

	async removeOperation(id: string): Promise<void> {
		await this.executor.query('DELETE FROM operations WHERE id = $1', [id]);
	}

	async getConstraints(nodeId: string): Promise<Constraint[]> {
		const rows = await this.executor.query<ConstraintRow>(
			'SELECT * FROM constraints WHERE node_id = $1',
			[nodeId],
		);
		return rows.map(rowToConstraint);
	}

	async setConstraints(nodeId: string, constraints: Constraint[]): Promise<void> {
		await this.transaction(async () => {
			await this.executor.query('DELETE FROM constraints WHERE node_id = $1', [nodeId]);

			for (const constraint of constraints) {
				await this.addConstraint(nodeId, constraint);
			}
		});
	}

	async addConstraint(nodeId: string, constraint: Constraint): Promise<void> {
		await this.executor.query(
			`INSERT INTO constraints (
        id, node_id, name, description, constraint_type, config, severity,
        apply_to, enabled
      ) VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9
      )`,
			[
				constraint.id,
				nodeId,
				constraint.name,
				constraint.description || null,
				constraint.config.type,
				JSON.stringify(constraint.config),
				constraint.severity,
				constraint.applyTo,
				constraint.enabled,
			],
		);
	}

	async removeConstraint(nodeId: string, constraintId: string): Promise<void> {
		await this.executor.query('DELETE FROM constraints WHERE node_id = $1 AND id = $2', [
			nodeId,
			constraintId,
		]);
	}

	async addAuditEvent(event: AuditEvent): Promise<void> {
		await this.executor.query(
			`INSERT INTO audit_events (
        id, timestamp, event_type, actor, target_node, target_token,
        old_value, new_value, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )`,
			[
				event.id,
				event.timestamp,
				event.eventType,
				event.actor,
				event.targetNode,
				event.targetToken,
				event.oldValue,
				event.newValue,
				event.metadata,
			],
		);
	}

	async getAuditEvents(filter: AuditEventFilter): Promise<AuditEvent[]> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];

		if (filter.targetNode !== undefined) {
			whereClauses.push(`target_node = ${bindParam(params, filter.targetNode)}`);
		}
		if (filter.targetToken !== undefined) {
			whereClauses.push(`target_token = ${bindParam(params, filter.targetToken)}`);
		}
		if (filter.eventType !== undefined) {
			whereClauses.push(`event_type = ${bindParam(params, filter.eventType)}`);
		}
		if (filter.actor !== undefined) {
			whereClauses.push(`actor = ${bindParam(params, filter.actor)}`);
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const rows = await this.executor.query<AuditRow>(
			`SELECT * FROM audit_events ${where} ORDER BY timestamp DESC, seq DESC`,
			params,
		);

		return rows.map(rowToAudit);
	}

	async queryAuditEvents(query: AuditEventQuery): Promise<AuditEventPage> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];
		const anyOf = (column: string, list: readonly string[]) => {
			// An empty list matches nothing, like Array.includes
			whereClauses.push(
				list.length > 0 ? `${column} = ANY(${bindParam(params, [...list])})` : 'FALSE',
			);
		};

		if (query.nodeIds) anyOf('target_node', query.nodeIds);
		if (query.tokenId) {
			whereClauses.push(`target_token = ${bindParam(params, query.tokenId)}`);
		}
		if (query.eventTypes) anyOf('event_type', query.eventTypes);
		if (query.actor) {
			whereClauses.push(`actor = ${bindParam(params, query.actor)}`);
		}
		if (query.since) {
			whereClauses.push(`timestamp >= ${bindParam(params, new Date(query.since).toISOString())}`);
		}
		if (query.until) {
			whereClauses.push(`timestamp < ${bindParam(params, new Date(query.until).toISOString())}`);
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const pageParams = [...params];
		const limit = bindParam(pageParams, query.limit);
		const offset = bindParam(pageParams, query.offset);
		// seq breaks ties in write order, so same-millisecond events keep it (#89)
		const rows = await this.executor.query<AuditRow>(
			`SELECT * FROM audit_events ${where}
       ORDER BY timestamp DESC, seq DESC
       LIMIT ${limit} OFFSET ${offset}`,
			pageParams,
		);
		const total = await this.executor.query<{ count: string | number }>(
			`SELECT COUNT(*) AS count FROM audit_events ${where}`,
			params,
		);
		const days = await this.executor.query<{
			date: string;
			event_type: string;
			count: string | number;
		}>(
			`SELECT to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, event_type, COUNT(*) AS count
       FROM audit_events ${where}
       GROUP BY 1, 2`,
			params,
		);

		return {
			events: rows.map(rowToAudit),
			// COUNT(*) is a bigint, which Postgres clients return as a string
			total: Number(total[0]?.count ?? 0),
			days: days.map(
				(day): AuditDayCount => ({
					date: day.date,
					eventType: day.event_type as AuditDayCount['eventType'],
					count: Number(day.count),
				}),
			),
		};
	}

	async createWebhook(webhook: Webhook): Promise<void> {
		await this.executor.query(
			`INSERT INTO webhooks (
        id, url, secret, events, node_filter, description, active,
        created_at, updated_at, created_by
      ) VALUES (
        $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10
      )`,
			[
				webhook.id,
				webhook.url,
				webhook.secret,
				JSON.stringify(webhook.events),
				webhook.nodeFilter || null,
				webhook.description || null,
				webhook.active,
				webhook.createdAt,
				webhook.updatedAt,
				webhook.createdBy || null,
			],
		);
	}

	async getWebhook(id: string): Promise<Webhook | null> {
		const rows = await this.executor.query<WebhookRow>('SELECT * FROM webhooks WHERE id = $1', [
			id,
		]);
		return rows[0] ? rowToWebhook(rows[0]) : null;
	}

	async updateWebhook(id: string, updates: WebhookUpdate): Promise<void> {
		// undefined = leave unchanged; null (or '') = clear nodeFilter/description
		const setClauses: string[] = [];
		const params: unknown[] = [];

		if (updates.url !== undefined) {
			setClauses.push(`url = ${bindParam(params, updates.url)}`);
		}
		if (updates.secret !== undefined) {
			setClauses.push(`secret = ${bindParam(params, updates.secret)}`);
		}
		if (updates.events !== undefined) {
			const placeholder = bindParam(params, JSON.stringify(updates.events));
			setClauses.push(`events = ${placeholder}::jsonb`);
		}
		if (updates.nodeFilter !== undefined) {
			setClauses.push(`node_filter = ${bindParam(params, updates.nodeFilter || null)}`);
		}
		if (updates.description !== undefined) {
			setClauses.push(`description = ${bindParam(params, updates.description || null)}`);
		}
		if (updates.active !== undefined) {
			setClauses.push(`active = ${bindParam(params, updates.active)}`);
		}

		// Nothing to change (also keeps updated_at untouched for no-op updates)
		if (setClauses.length === 0) return;

		setClauses.push(`updated_at = ${bindParam(params, new Date().toISOString())}`);

		const idPlaceholder = bindParam(params, id);
		await this.executor.query(
			`UPDATE webhooks SET ${setClauses.join(', ')} WHERE id = ${idPlaceholder}`,
			params,
		);
	}

	async deleteWebhook(id: string): Promise<void> {
		await this.executor.query('DELETE FROM webhooks WHERE id = $1', [id]);
	}

	async listWebhooks(filter?: WebhookFilter): Promise<Webhook[]> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];

		if (filter?.active !== undefined) {
			whereClauses.push(`active = ${bindParam(params, filter.active)}`);
		}

		if (filter?.events && filter.events.length > 0) {
			const eventsPlaceholder = bindParam(params, filter.events);
			whereClauses.push(`EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(events) AS event(value)
        WHERE event.value = ANY(${eventsPlaceholder}::text[])
      )`);
		}

		if (filter?.nodeFilter) {
			const exactPlaceholder = bindParam(params, filter.nodeFilter);
			const prefixPlaceholder = bindParam(params, filter.nodeFilter);
			whereClauses.push(
				`(node_filter IS NULL OR node_filter = ${exactPlaceholder} OR ${prefixPlaceholder} LIKE node_filter || '%')`,
			);
		}

		const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
		const rows = await this.executor.query<WebhookRow>(
			`SELECT * FROM webhooks ${where} ORDER BY created_at DESC`,
			params,
		);

		return rows.map(rowToWebhook);
	}

	async createDelivery(delivery: WebhookDelivery): Promise<void> {
		await this.executor.query(
			`INSERT INTO webhook_deliveries (
        id, webhook_id, event_type, payload, status, response, attempts,
        next_retry_at, delivered_at, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )`,
			[
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
			],
		);
	}

	async getDelivery(id: string): Promise<WebhookDelivery | null> {
		const rows = await this.executor.query<DeliveryRow>(
			'SELECT * FROM webhook_deliveries WHERE id = $1',
			[id],
		);
		return rows[0] ? rowToDelivery(rows[0]) : null;
	}

	async updateDelivery(id: string, updates: DeliveryUpdate): Promise<void> {
		// undefined = leave unchanged; null clears response/nextRetryAt/deliveredAt
		const setClauses: string[] = [];
		const params: unknown[] = [];

		if (updates.status !== undefined) {
			setClauses.push(`status = ${bindParam(params, updates.status)}`);
		}
		if (updates.response !== undefined) {
			setClauses.push(`response = ${bindParam(params, updates.response || null)}`);
		}
		if (updates.attempts !== undefined) {
			setClauses.push(`attempts = ${bindParam(params, updates.attempts)}`);
		}
		if (updates.nextRetryAt !== undefined) {
			setClauses.push(`next_retry_at = ${bindParam(params, updates.nextRetryAt || null)}`);
		}
		if (updates.deliveredAt !== undefined) {
			setClauses.push(`delivered_at = ${bindParam(params, updates.deliveredAt || null)}`);
		}

		if (setClauses.length === 0) return;

		const idPlaceholder = bindParam(params, id);
		await this.executor.query(
			`UPDATE webhook_deliveries SET ${setClauses.join(', ')} WHERE id = ${idPlaceholder}`,
			params,
		);
	}

	async listDeliveries(filter?: DeliveryFilter): Promise<WebhookDelivery[]> {
		const whereClauses: string[] = [];
		const params: unknown[] = [];

		if (filter?.webhookId) {
			whereClauses.push(`webhook_id = ${bindParam(params, filter.webhookId)}`);
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
		const limitPlaceholder = bindParam(params, limit);
		const rows = await this.executor.query<DeliveryRow>(
			`SELECT * FROM webhook_deliveries ${where} ORDER BY created_at DESC LIMIT ${limitPlaceholder}`,
			params,
		);

		return rows.map(rowToDelivery);
	}

	async getPendingDeliveries(): Promise<WebhookDelivery[]> {
		const rows = await this.executor.query<DeliveryRow>(
			`SELECT * FROM webhook_deliveries
       WHERE delivered_at IS NULL
       AND next_retry_at IS NOT NULL
       AND next_retry_at <= $1
       ORDER BY next_retry_at ASC
       LIMIT 100`,
			[new Date().toISOString()],
		);

		return rows.map(rowToDelivery);
	}

	async addCheckSnapshot(snapshot: CheckSnapshot): Promise<void> {
		await this.executor.query(
			`INSERT INTO check_snapshots (id, root_id, taken_at, nodes, counts, issues, actor)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
			[
				snapshot.id,
				snapshot.rootId,
				snapshot.takenAt,
				snapshot.nodes,
				JSON.stringify(snapshot.counts),
				JSON.stringify(snapshot.issues),
				snapshot.actor,
			],
		);
	}

	async listCheckSnapshots(query: CheckSnapshotQuery = {}): Promise<CheckSnapshot[]> {
		const params: unknown[] = [];
		const where: string[] = [];
		if (query.rootIds) {
			const ids = query.rootIds.filter((id): id is string => id !== null);
			const matches = [
				...(ids.length > 0 ? [`root_id = ANY(${bindParam(params, ids)}::text[])`] : []),
				...(query.rootIds.includes(null) ? ['root_id IS NULL'] : []),
			];
			where.push(matches.length > 0 ? `(${matches.join(' OR ')})` : 'FALSE');
		}
		if (query.since) where.push(`taken_at >= ${bindParam(params, query.since)}`);
		if (query.until) where.push(`taken_at < ${bindParam(params, query.until)}`);
		const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
		const limit = query.limit === undefined ? '' : `LIMIT ${bindParam(params, query.limit)}`;
		// Newest first so a limit keeps the latest, then back to oldest first
		const rows = await this.executor.query<CheckSnapshotRow>(
			`SELECT * FROM check_snapshots ${filter} ORDER BY taken_at DESC, id DESC ${limit}`,
			params,
		);
		return [...rows].reverse().map(rowToCheckSnapshot);
	}

	async getSpecimenMap(rootId: string): Promise<SpecimenMapRecord | null> {
		const rows = await this.executor.query<SpecimenMapRow>(
			'SELECT * FROM specimen_maps WHERE root_id = $1',
			[rootId],
		);
		return rows[0] ? rowToSpecimenMap(rows[0]) : null;
	}

	async setSpecimenMap(rootId: string, record: SpecimenMapRecord | null): Promise<void> {
		if (!record) {
			await this.executor.query('DELETE FROM specimen_maps WHERE root_id = $1', [rootId]);
			return;
		}
		await this.executor.query(
			`INSERT INTO specimen_maps (root_id, map, updated_at, updated_by)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (root_id) DO UPDATE SET
         map = EXCLUDED.map, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
			[rootId, JSON.stringify(record.map), record.updatedAt, record.updatedBy],
		);
	}

	async transaction<T>(fn: () => Promise<T>): Promise<T> {
		return this.client.transaction(async (tx) => {
			const previousExecutor = this.executor;
			this.executor = tx;

			try {
				return await fn();
			} finally {
				this.executor = previousExecutor;
			}
		});
	}
}

interface NodeRow {
	id: string;
	name: string;
	parent_id: string | null;
	type: string;
	owner: string | null;
	status: string;
	sunset_at: string | null;
	replaced_by: string | null;
	includes: unknown;
	include_policy: string;
	tags: unknown;
	created_at: string | Date;
	updated_at: string | Date;
	deleted_at: string | Date | null;
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
	created_at: string | Date;
}

interface AuditRow {
	id: string;
	timestamp: string | Date;
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
	config: unknown;
	severity: string;
	apply_to: string;
	enabled: boolean;
}

interface WebhookRow {
	id: string;
	url: string;
	secret: string;
	events: unknown;
	node_filter: string | null;
	description: string | null;
	active: boolean;
	created_at: string | Date;
	updated_at: string | Date;
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
	next_retry_at: string | Date | null;
	delivered_at: string | Date | null;
	created_at: string | Date;
}

function bindParam(params: unknown[], value: unknown): string {
	params.push(value);
	return `$${params.length}`;
}

function parseJsonArray(value: unknown): string[] {
	if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
		return value;
	}

	if (typeof value === 'string') {
		return JSON.parse(value) as string[];
	}

	return [];
}

function parseJsonObject<T>(value: unknown): T {
	if (typeof value === 'string') {
		return JSON.parse(value) as T;
	}

	return value as T;
}

function toIsoString(value: string | Date | null): string | null {
	if (value === null) return null;
	return value instanceof Date ? value.toISOString() : value;
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
		includes: parseJsonArray(row.includes),
		includePolicy: row.include_policy as Node['includePolicy'],
		tags: parseJsonArray(row.tags),
		createdAt: toIsoString(row.created_at) || new Date(0).toISOString(),
		updatedAt: toIsoString(row.updated_at) || new Date(0).toISOString(),
		deletedAt: toIsoString(row.deleted_at),
	};
}

interface CheckSnapshotRow {
	id: string;
	root_id: string | null;
	taken_at: string | Date;
	nodes: number;
	counts: unknown;
	issues: unknown;
	actor: string | null;
}

/** jsonb comes back parsed from most clients, as text from some */
function parseJson<T>(value: unknown): T {
	return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

function rowToCheckSnapshot(row: CheckSnapshotRow): CheckSnapshot {
	return {
		id: row.id,
		rootId: row.root_id,
		takenAt: toIsoString(row.taken_at) || new Date(0).toISOString(),
		nodes: Number(row.nodes),
		counts: parseJson(row.counts),
		issues: parseJson(row.issues),
		actor: row.actor,
	};
}

interface SpecimenMapRow {
	root_id: string;
	map: unknown;
	updated_at: string | Date;
	updated_by: string | null;
}

function rowToSpecimenMap(row: SpecimenMapRow): SpecimenMapRecord {
	return {
		rootId: row.root_id,
		map: parseJson(row.map),
		updatedAt: toIsoString(row.updated_at) || new Date(0).toISOString(),
		updatedBy: row.updated_by,
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
		createdAt: toIsoString(row.created_at) || new Date(0).toISOString(),
	};
}

function rowToAudit(row: AuditRow): AuditEvent {
	return {
		id: row.id,
		timestamp: toIsoString(row.timestamp) || new Date(0).toISOString(),
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
		config: parseJsonObject<Constraint['config']>(row.config),
		severity: row.severity as Constraint['severity'],
		applyTo: row.apply_to,
		enabled: row.enabled,
	};
}

function rowToWebhook(row: WebhookRow): Webhook {
	return {
		id: row.id,
		url: row.url,
		secret: row.secret,
		events: parseJsonObject<Webhook['events']>(row.events),
		nodeFilter: row.node_filter || undefined,
		description: row.description || undefined,
		active: row.active,
		createdAt: toIsoString(row.created_at) || new Date(0).toISOString(),
		updatedAt: toIsoString(row.updated_at) || new Date(0).toISOString(),
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
		nextRetryAt: toIsoString(row.next_retry_at) || undefined,
		deliveredAt: toIsoString(row.delivered_at) || undefined,
		createdAt: toIsoString(row.created_at) || new Date(0).toISOString(),
	};
}

export function createPostgresDatabase(client: PostgresClient): PostgresDatabase {
	return new PostgresDatabase(client);
}
