/**
 * @fileoverview Read command handlers for `violet-tree` documents (spec §6.2).
 */
import { type AppCallContextV1, type CommandResult, failure, success } from '@lushly-dev/loam-sdk';
import { defaultPort, type TokenValue, type VioletPort } from '../port/engine.js';
import { byCodePoint, orderNodeIds, orderNodesPreOrder, sortByKey } from '../port/results.js';
import { parseOperationValue } from '../port/undo.js';

interface ResolvedTokenRow {
	id: string;
	resolvedValue: TokenValue;
	resolvedAt: string;
	metadata?: { type?: string; category?: string };
}

interface CompareCellRow {
	value: TokenValue | null;
	differs: boolean;
}

interface AuditEntryRow {
	timestamp: string;
	eventType: string;
	actor: string;
	targetNode: string;
	targetToken?: string;
	oldValue?: unknown;
	newValue?: unknown;
	metadata?: Record<string, unknown>;
}

function mapAuditOperation(entry: AuditEntryRow): string {
	switch (entry.eventType) {
		case 'token_created':
			return 'add';
		case 'token_updated': {
			const next = entry.newValue as Record<string, unknown> | null | undefined;
			return next && typeof next === 'object' && next.reset === true ? 'reset' : 'override';
		}
		case 'operation_removed':
			return 'reset';
		case 'node_created':
			return 'node-create';
		case 'node_updated':
			return 'node-restore';
		case 'node_deleted':
			return 'node-delete';
		case 'constraint_set':
			return 'constraint-set';
		default:
			return entry.eventType;
	}
}

function unwrapAuditNewValue(entry: AuditEntryRow): unknown {
	if (entry.newValue === undefined || entry.newValue === null) return null;
	if (entry.eventType === 'token_created' && typeof entry.newValue === 'object') {
		const record = entry.newValue as Record<string, unknown>;
		if ('value' in record) return record.value ?? null;
	}
	return entry.newValue;
}

export function createReadHandlers(port: VioletPort = defaultPort) {
	return {
		async 'violet-node-list'(input: { document: string }, context: AppCallContextV1) {
			return port.read(input.document, context, 'violet-node-list', async ({ db, content }) => {
				const ordered = orderNodesPreOrder(await db.listNodes());
				const nodes = await Promise.all(
					ordered.map(async (node) => {
						const ops = await db.getOperations(node.id);
						const distinct = new Set(ops.map((op) => op.asTokenId ?? op.tokenId));
						return {
							id: node.id,
							parent: node.parentId ?? null,
							type: node.type,
							customizations: distinct.size,
						};
					})
				);
				const root = ordered.find((node) => node.parentId === null)?.id ?? null;
				return success({
					root,
					nodes,
					unexported: content.rev - content.syncedRev,
				});
			});
		},

		async 'violet-node-get'(input: { document: string; node: string }, context: AppCallContextV1) {
			return port.read(input.document, context, 'violet-node-get', async ({ db, engine }) => {
				const res = await engine.call<{
					node: { id: string; parentId: string | null; type: string };
					operations?: Array<{
						tokenId: string;
						asTokenId?: string | null;
						type: string;
						value: TokenValue | null;
						sequence: number;
					}>;
				}>('node.get', { id: input.node, includeOperations: true });
				if (!res.success || !res.data) return res as CommandResult<never>;
				const node = await db.getNode(input.node);
				if (!node || node.deletedAt) {
					return failure({
						code: 'NODE_NOT_FOUND',
						message: `Node '${input.node}' not found`,
						suggestion: 'Use violet-node-list to see available nodes',
					});
				}
				const ops = await db.getOperations(input.node);
				const latestByToken = new Map<
					string,
					{ token: string; operation: 'add' | 'override'; value: TokenValue }
				>();
				for (const op of [...ops].sort((a, b) => a.sequence - b.sequence)) {
					if (op.type !== 'add' && op.type !== 'override') continue;
					const parsed = parseOperationValue(op.value);
					if (parsed === null) continue;
					const token = op.asTokenId ?? op.tokenId;
					latestByToken.set(token, { token, operation: op.type, value: parsed });
				}
				const own = sortByKey([...latestByToken.values()], (row) => row.token);
				return success({
					node: { id: node.id, parent: node.parentId ?? null, type: node.type },
					own,
				});
			});
		},

		async 'violet-token-resolve'(
			input: { document: string; node: string; filter?: string; limit?: number },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-token-resolve', async ({ engine }) => {
				const res = await engine.call<{ nodeId: string; tokens: ResolvedTokenRow[] }>(
					'tokens.resolve',
					{
						nodeId: input.node,
						...(input.filter ? { filter: input.filter } : {}),
					}
				);
				if (!res.success || !res.data) return res as CommandResult<never>;
				const sorted = sortByKey(res.data.tokens, (t) => t.id).map((t) => ({
					id: t.id,
					value: t.resolvedValue,
					from: t.resolvedAt,
				}));
				const limit = input.limit ?? 500;
				const total = sorted.length;
				const tokens = sorted.slice(0, limit);
				return success({
					node: input.node,
					tokens,
					total,
					truncated: total > limit,
				});
			});
		},

		async 'violet-token-find'(
			input: { document: string; query: string; category?: string },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-token-find', async ({ db, engine }) => {
				const ordered = orderNodesPreOrder(await db.listNodes());
				const res = await engine.call<{
					tokens: Array<{
						id: string;
						category: string;
						definedAt: string;
						customizedOn: string[];
					}>;
					total: number;
				}>('tokens.catalog', {
					query: input.query,
					...(input.category ? { category: input.category } : {}),
				});
				if (!res.success || !res.data) return res as CommandResult<never>;
				const tokens = sortByKey(res.data.tokens, (t) => t.id).map((t) => ({
					id: t.id,
					category: t.category,
					customizedAt: orderNodeIds([...new Set([t.definedAt, ...t.customizedOn])], ordered),
				}));
				return success({ tokens, total: res.data.total });
			});
		},

		async 'violet-token-lineage'(
			input: { document: string; node: string; token: string },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-token-lineage', async ({ engine }) => {
				const res = await engine.call<{
					tokenId: string;
					currentValue: TokenValue;
					resolvedAt: string;
					chain: Array<{
						nodeId: string;
						operation: string;
						value?: TokenValue;
						superseded?: boolean;
					}>;
				}>('token.lineage', { nodeId: input.node, tokenId: input.token });
				if (!res.success || !res.data) return res as CommandResult<never>;
				const chain = res.data.chain.map((step) => ({
					node: step.nodeId,
					operation: step.operation,
					...(step.value !== undefined && step.operation !== 'inherit'
						? { value: step.value }
						: {}),
				}));
				let from = res.data.resolvedAt;
				for (let i = res.data.chain.length - 1; i >= 0; i--) {
					const step = res.data.chain[i];
					if (step && step.operation !== 'inherit' && !step.superseded) {
						from = step.nodeId;
						break;
					}
				}
				return success({
					token: res.data.tokenId,
					value: res.data.currentValue,
					from,
					chain,
				});
			});
		},

		async 'violet-token-compare'(
			input: { document: string; nodes: string[]; filter?: string },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-token-compare', async ({ engine }) => {
				const res = await engine.call<{
					tokens: Array<{ id: string; cells: Record<string, CompareCellRow> }>;
					summary: { different: number };
				}>('tokens.compare', {
					nodeIds: input.nodes,
					onlyDifferent: true,
					...(input.filter ? { filter: input.filter } : {}),
				});
				if (!res.success || !res.data) return res as CommandResult<never>;
				const rows = sortByKey(res.data.tokens, (t) => t.id).map((t) => ({
					token: t.id,
					cells: input.nodes.map((nodeId) => ({
						node: nodeId,
						value: t.cells[nodeId]?.value ?? null,
						differs: t.cells[nodeId]?.differs ?? false,
					})),
				}));
				return success({
					nodes: [...input.nodes],
					rows,
					summary: { differing: res.data.summary.different },
				});
			});
		},

		async 'violet-tree-compare'(
			input: {
				document: string;
				node: string;
				other: { document: string; node: string };
				filter?: string;
			},
			context: AppCallContextV1
		) {
			// Verify `other.document` is a readable, untrashed violet-tree in this scope via nested query (F4, §6.2).
			const docCheck = await context.client.call<{
				id: string;
				type: string;
				status: string;
			}>('document-get', { document: input.other.document });
			if (
				!docCheck.success ||
				!docCheck.data ||
				docCheck.data.type !== 'violet-tree' ||
				docCheck.data.status === 'trashed'
			) {
				return failure({
					code: 'DOCUMENT_NOT_FOUND',
					message: `Tree document '${input.other.document}' was not found in this scope`,
					suggestion: 'Use document-list { type: "violet-tree" } to see available trees',
				});
			}

			const hereRes = await port.read(
				input.document,
				context,
				'violet-tree-compare',
				async ({ engine }) =>
					engine.call<{ tokens: ResolvedTokenRow[] }>('tokens.resolve', {
						nodeId: input.node,
						...(input.filter ? { filter: input.filter } : {}),
					})
			);
			if (!hereRes.success || !hereRes.data) return hereRes as CommandResult<never>;

			const thereRes = await port.read(
				input.other.document,
				context,
				'violet-tree-compare',
				async ({ engine }) =>
					engine.call<{ tokens: ResolvedTokenRow[] }>(
						'tokens.resolve',
						{
							nodeId: input.other.node,
							...(input.filter ? { filter: input.filter } : {}),
						},
						{ otherDocument: input.other.document }
					)
			);
			if (!thereRes.success || !thereRes.data) return thereRes as CommandResult<never>;

			const hereMap = new Map(hereRes.data.tokens.map((t) => [t.id, t.resolvedValue]));
			const thereMap = new Map(thereRes.data.tokens.map((t) => [t.id, t.resolvedValue]));
			const allIds = [...new Set([...hereMap.keys(), ...thereMap.keys()])].sort(byCodePoint);

			const rows: Array<{ token: string; here: TokenValue | null; there: TokenValue | null }> = [];
			let differing = 0;
			let onlyHere = 0;
			let onlyThere = 0;

			for (const id of allIds) {
				const hasHere = hereMap.has(id);
				const hasThere = thereMap.has(id);
				const here = hasHere ? (hereMap.get(id) ?? null) : null;
				const there = hasThere ? (thereMap.get(id) ?? null) : null;
				if (hasHere && hasThere) {
					if (JSON.stringify(here) !== JSON.stringify(there)) {
						differing++;
						rows.push({ token: id, here, there });
					}
				} else if (hasHere) {
					onlyHere++;
					rows.push({ token: id, here, there: null });
				} else {
					onlyThere++;
					rows.push({ token: id, here: null, there });
				}
			}

			return success({ rows, summary: { differing, onlyHere, onlyThere } });
		},

		async 'violet-change-list'(
			input: { document: string; node?: string; token?: string; limit?: number },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-change-list', async ({ db, engine }) => {
				if (input.node) {
					// Accept soft-deleted nodes so their history remains readable, but reject unknown ids (§6.2).
					const node = await db.getNode(input.node);
					if (!node) {
						return failure({
							code: 'NODE_NOT_FOUND',
							message: `Node '${input.node}' not found`,
							suggestion: 'Use violet-node-list to see available nodes',
						});
					}
				}
				const res = await engine.call<{ events: AuditEntryRow[]; summary: { total: number } }>(
					'audit.list',
					{
						...(input.node ? { nodeId: input.node } : {}),
						...(input.token ? { tokenId: input.token } : {}),
						limit: input.limit ?? 50,
					}
				);
				if (!res.success || !res.data) return res as CommandResult<never>;
				const changes = res.data.events.map((event) => ({
					node: event.targetNode,
					token: event.targetToken ?? null,
					operation: mapAuditOperation(event),
					oldValue: event.oldValue ?? null,
					value: unwrapAuditNewValue(event),
					reason: typeof event.metadata?.reason === 'string' ? event.metadata.reason : null,
					actor: event.actor,
					at: event.timestamp,
				}));
				return success({ changes, total: res.data.summary.total });
			});
		},
	};
}
