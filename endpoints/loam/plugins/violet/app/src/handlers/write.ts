/**
 * @fileoverview Write mutation handlers for `violet-tree` documents (spec §6.4).
 */
import { type AppCallContextV1, type CommandResult, failure, success } from '@lushly-dev/loam-sdk';
import {
	type Constraint,
	type Database,
	defaultPort,
	type Engine,
	type TokenMetadata,
	type TokenValue,
	type VioletPort,
} from '../port/engine.js';
import {
	type BatchChangeInput,
	collapseRemovedOperations,
	parseOperationValue,
	undoForAdd,
	undoForBatchApply,
	undoForConstraintSet,
	undoForNodeCreate,
	undoForNodeDelete,
	undoForOverride,
	undoForReset,
} from '../port/undo.js';
import { computeBatchImpact, dryRunBatch, tokenTypeOn } from './check.js';

/** Resolve whether `tokenId` is currently inherited on `nodeId`, its resolved value, and raw own value for lossless undo. */
async function resolveBeforeWrite(
	db: Database,
	engine: Engine,
	nodeId: string,
	tokenId: string
): Promise<{ oldValue: TokenValue; undoValue: TokenValue; inherited: boolean } | null> {
	const res = await engine.call<{
		tokens: Array<{ id: string; resolvedValue: TokenValue; resolvedAt: string }>;
	}>('tokens.resolve', { nodeId });
	const found = res.data?.tokens.find((t) => t.id === tokenId);
	if (!found) return null;
	const inherited = found.resolvedAt !== nodeId;
	let undoValue = found.resolvedValue;
	if (!inherited) {
		const ownOps = (await db.getOperations(nodeId))
			.filter(
				(op) =>
					(op.asTokenId ?? op.tokenId) === tokenId && (op.type === 'add' || op.type === 'override')
			)
			.sort((a, b) => a.sequence - b.sequence);
		const lastOwn = ownOps.at(-1);
		const rawOwn = lastOwn ? parseOperationValue(lastOwn.value) : null;
		if (rawOwn !== null) undoValue = rawOwn;
	}
	return { oldValue: found.resolvedValue, undoValue, inherited };
}

export function createWriteHandlers(port: VioletPort = defaultPort) {
	return {
		async 'violet-token-add'(
			input: {
				document: string;
				node: string;
				token: string;
				value: TokenValue;
				metadata?: Partial<TokenMetadata>;
				reason?: string;
			},
			context: AppCallContextV1
		) {
			return port.write(input.document, context, 'violet-token-add', async ({ engine }) => {
				const res = await engine.call<{ nodeId: string; tokenId: string; value: TokenValue }>(
					'token.add',
					{
						nodeId: input.node,
						tokenId: input.token,
						value: input.value,
						...(input.metadata ? { metadata: input.metadata } : {}),
						...(input.reason ? { reason: input.reason } : {}),
					},
					{ tokenType: input.metadata?.type ?? input.metadata?.category }
				);
				if (!res.success || !res.data) return res as CommandResult<never>;
				return success(
					{ node: input.node, token: input.token, value: res.data.value },
					undoForAdd(input.document, input.node, input.token)
				);
			});
		},

		async 'violet-token-override'(
			input: {
				document: string;
				node: string;
				token: string;
				value: TokenValue;
				reason?: string;
			},
			context: AppCallContextV1
		) {
			return port.write(
				input.document,
				context,
				'violet-token-override',
				async ({ db, engine }) => {
					const before = await resolveBeforeWrite(db, engine, input.node, input.token);
					const tokenType = await tokenTypeOn(db, engine, input.node, input.token);
					const res = await engine.call<{
						nodeId: string;
						tokenId: string;
						newValue?: TokenValue;
						value?: TokenValue;
						previousValue?: TokenValue;
					}>(
						'token.override',
						{
							nodeId: input.node,
							tokenId: input.token,
							value: input.value,
							...(input.reason ? { reason: input.reason } : {}),
						},
						{ tokenType }
					);
					if (!res.success || !res.data) return res as CommandResult<never>;
					const oldValue = before?.oldValue ?? res.data.previousValue ?? input.value;
					const undoValue = before?.undoValue ?? oldValue;
					const inherited = before?.inherited ?? false;
					const nextValue = res.data.newValue ?? res.data.value ?? input.value;
					return success(
						{ node: input.node, token: input.token, oldValue, inherited, value: nextValue },
						undoForOverride(input.document, input.node, input.token, inherited, undoValue)
					);
				}
			);
		},

		async 'violet-token-reset'(
			input: { document: string; node: string; token: string; reason?: string },
			context: AppCallContextV1
		) {
			return port.write(input.document, context, 'violet-token-reset', async ({ db, engine }) => {
				// Read own operations before removal so add metadata is preserved in undoArgs (spec §5.7).
				const ownOps = (await db.getOperations(input.node)).filter(
					(op) => (op.asTokenId ?? op.tokenId) === input.token
				);
				const removed = await engine.call('token.remove', {
					nodeId: input.node,
					tokenId: input.token,
					...(input.reason ? { reason: input.reason } : {}),
				});
				if (!removed.success) return removed as CommandResult<never>;

				const after = await engine.call<{ currentValue: TokenValue; resolvedAt: string }>(
					'token.lineage',
					{ nodeId: input.node, tokenId: input.token }
				);
				const value = after.success && after.data ? after.data.currentValue : null;
				const from = after.success && after.data ? after.data.resolvedAt : null;
				const undo = undoForReset(input.document, input.node, input.token, ownOps);
				return success({ node: input.node, token: input.token, value, from }, undo);
			});
		},

		async 'violet-change-apply'(
			input: {
				document: string;
				node: string;
				changes: BatchChangeInput[];
				reason?: string;
				expectedRev?: number;
			},
			context: AppCallContextV1
		) {
			return port.write(
				input.document,
				context,
				'violet-change-apply',
				async ({ db, engine, content }) => {
					if (input.expectedRev !== undefined && input.expectedRev !== content.rev) {
						return failure({
							code: 'OPERATION_NOT_ALLOWED',
							message: `Tree revision ${content.rev} does not match previewed revision ${input.expectedRev}`,
							suggestion:
								'The tree changed since the preview; run violet-change-preview again before applying',
						});
					}

					const staged = await dryRunBatch(
						db,
						engine,
						input.node,
						input.changes,
						'violet-change-apply'
					);
					if (!staged.success) return staged as CommandResult<never>;

					const impact = await computeBatchImpact(
						db,
						engine,
						input.node,
						input.changes,
						'violet-change-apply'
					);
					if (!impact.success || !impact.data) return impact as CommandResult<never>;

					const inverseChanges: BatchChangeInput[] = [];
					for (let index = 0; index < input.changes.length; index++) {
						const change = input.changes[index] as BatchChangeInput;
						if (change.operation === 'add') {
							if (change.value === undefined) {
								return failure({
									code: 'VALIDATION_ERROR',
									message: `Change ${index} (add '${change.token}') requires a value`,
									suggestion: `Provide a value for '${change.token}' in changes[${index}]`,
									details: { index },
								});
							}
							const res = await engine.call(
								'token.add',
								{
									nodeId: input.node,
									tokenId: change.token,
									value: change.value,
									...(change.metadata ? { metadata: change.metadata } : {}),
									...(input.reason ? { reason: input.reason } : {}),
								},
								{ tokenType: change.metadata?.type ?? change.metadata?.category }
							);
							if (!res.success && res.error) {
								return failure({ ...res.error, details: { ...(res.error.details ?? {}), index } });
							}
							inverseChanges.push({ operation: 'reset', token: change.token });
						} else if (change.operation === 'override') {
							if (change.value === undefined) {
								return failure({
									code: 'VALIDATION_ERROR',
									message: `Change ${index} (override '${change.token}') requires a value`,
									suggestion: `Provide a value for '${change.token}' in changes[${index}]`,
									details: { index },
								});
							}
							const before = await resolveBeforeWrite(db, engine, input.node, change.token);
							const tokenType = await tokenTypeOn(db, engine, input.node, change.token);
							const res = await engine.call(
								'token.override',
								{
									nodeId: input.node,
									tokenId: change.token,
									value: change.value,
									...(input.reason ? { reason: input.reason } : {}),
								},
								{ tokenType }
							);
							if (!res.success && res.error) {
								return failure({ ...res.error, details: { ...(res.error.details ?? {}), index } });
							}
							if (before?.inherited) {
								inverseChanges.push({ operation: 'reset', token: change.token });
							} else if (before) {
								inverseChanges.push({
									operation: 'override',
									token: change.token,
									value: before.undoValue,
								});
							}
						} else {
							const ownOps = (await db.getOperations(input.node)).filter(
								(op) => (op.asTokenId ?? op.tokenId) === change.token
							);
							const res = await engine.call('token.remove', {
								nodeId: input.node,
								tokenId: change.token,
								...(input.reason ? { reason: input.reason } : {}),
							});
							if (!res.success && res.error) {
								return failure({ ...res.error, details: { ...(res.error.details ?? {}), index } });
							}
							const collapsed = collapseRemovedOperations(change.token, ownOps);
							if (collapsed) inverseChanges.push(collapsed);
						}
					}

					return success(
						{ applied: input.changes.length, summary: impact.data.summary },
						undoForBatchApply(input.document, input.node, inverseChanges)
					);
				}
			);
		},

		async 'violet-node-create'(
			input: {
				document: string;
				parent: string | null;
				id: string;
				type: string;
				restore?: boolean;
			},
			context: AppCallContextV1
		) {
			if (input.id.includes('#')) {
				return failure({
					code: 'VALIDATION_ERROR',
					message: `Node id '${input.id}' cannot contain '#'`,
					suggestion:
						"Choose a node id without '#' (used to separate node and token in selections)",
				});
			}
			return port.write(input.document, context, 'violet-node-create', async ({ db, engine }) => {
				if (input.parent !== null) {
					const parentNode = await db.getNode(input.parent);
					if (!parentNode || parentNode.deletedAt) {
						return failure({
							code: 'INVALID_PARENT',
							message: parentNode
								? `Parent node '${input.parent}' has been deleted`
								: `Parent node '${input.parent}' not found`,
							suggestion: 'Use violet-node-list to pick an existing, active parent node id',
						});
					}
				}

				if (input.restore) {
					const existing = await db.getNode(input.id);
					if (!existing?.deletedAt || existing.parentId !== input.parent) {
						return failure({
							code: 'NODE_NOT_FOUND',
							message: `No deleted node '${input.id}' under parent '${input.parent ?? 'null'}' to restore`,
							suggestion:
								'Use violet-node-list to inspect active nodes or omit restore to create a new node',
						});
					}
					const now = new Date(context.now ? context.now() : 0).toISOString();
					await db.updateNode(input.id, { deletedAt: null, updatedAt: now });
					const idRand = Math.floor((context.random ? context.random() : 0) * 1e12)
						.toString(36)
						.padStart(8, '0');
					await db.addAuditEvent({
						id: `evt_restore_${idRand}`,
						timestamp: now,
						eventType: 'node_updated',
						actor: context.actor?.id ?? 'local',
						targetNode: input.id,
						targetToken: null,
						oldValue: JSON.stringify({ deletedAt: existing.deletedAt }),
						newValue: JSON.stringify({ deletedAt: null }),
						metadata: JSON.stringify({ restore: true }),
					});
					return success(
						{ node: { id: existing.id, parent: existing.parentId, type: existing.type } },
						undoForNodeCreate(input.document, existing.id)
					);
				}

				const res = await engine.call<{
					node: { id: string; parentId: string | null; type: string };
				}>('node.create', {
					id: input.id,
					name: input.id,
					parentId: input.parent,
					type: input.type,
				});
				if (!res.success || !res.data) return res as CommandResult<never>;
				return success(
					{
						node: {
							id: res.data.node.id,
							parent: res.data.node.parentId ?? null,
							type: res.data.node.type,
						},
					},
					undoForNodeCreate(input.document, res.data.node.id)
				);
			});
		},

		async 'violet-node-delete'(
			input: { document: string; node: string; reason?: string },
			context: AppCallContextV1
		) {
			return port.write(input.document, context, 'violet-node-delete', async ({ db, engine }) => {
				const existing = await db.getNode(input.node);
				const res = await engine.call('node.delete', {
					id: input.node,
					force: false,
					...(input.reason ? { reason: input.reason } : {}),
				});
				if (!res.success) return res as CommandResult<never>;
				return success(
					{ node: input.node },
					existing
						? undoForNodeDelete(
								input.document,
								existing.parentId ?? null,
								existing.id,
								existing.type
							)
						: undefined
				);
			});
		},

		async 'violet-constraint-set'(
			input: { document: string; node: string; constraints: Constraint[]; merge?: boolean },
			context: AppCallContextV1
		) {
			return port.write(
				input.document,
				context,
				'violet-constraint-set',
				async ({ db, engine }) => {
					const existingNode = await db.getNode(input.node);
					if (!existingNode || existingNode.deletedAt) {
						return failure({
							code: 'NODE_NOT_FOUND',
							message: existingNode
								? `Node '${input.node}' has been deleted`
								: `Node '${input.node}' not found`,
							suggestion: 'Use violet-node-list to see available nodes',
						});
					}
					const prevRes = await engine.call<{ constraints: Constraint[] }>('constraints.list', {
						nodeId: input.node,
						includeInherited: false,
					});
					if (!prevRes.success || !prevRes.data) return prevRes as CommandResult<never>;
					// Strip `source` / `inherited` added by ConstraintWithSourceSchema to keep plain local Constraint records.
					const previous = (await db.getConstraints(input.node)).map((rule) =>
						structuredClone(rule)
					);

					const merge = input.merge ?? false;
					if (merge) {
						const existingIds = new Set(previous.map((r) => r.id));
						let nextCount = previous.length;
						for (const incoming of input.constraints) {
							if (!existingIds.has(incoming.id)) {
								nextCount++;
								existingIds.add(incoming.id);
							}
						}
						if (nextCount > 50) {
							return failure({
								code: 'VALIDATION_ERROR',
								message: `Merging ${input.constraints.length} rule(s) would leave ${nextCount} local rules on '${input.node}', over the 50-rule limit`,
								suggestion:
									'Keep at most 50 local rules on a node, or pass merge: false to replace them',
							});
						}
					}

					const res = await engine.call<{ constraints: Constraint[] }>('constraints.set', {
						nodeId: input.node,
						constraints: input.constraints,
						merge,
					});
					if (!res.success || !res.data) return res as CommandResult<never>;
					const localAfter = (await db.getConstraints(input.node)).map((rule) =>
						structuredClone(rule)
					);
					return success(
						{ node: input.node, constraints: localAfter, previous },
						undoForConstraintSet(input.document, input.node, previous)
					);
				}
			);
		},
	};
}
