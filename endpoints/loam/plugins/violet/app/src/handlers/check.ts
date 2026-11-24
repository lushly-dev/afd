/**
 * @fileoverview Checking command handlers (`violet-change-preview`, `violet-theme-preview`,
 * `violet-violation-list`, `violet-interface-check`) and shared preview/apply staging helpers (spec §6.3).
 */
import { type AppCallContextV1, type CommandResult, failure, success } from '@lushly-dev/loam-sdk';
import { tokenCustomProperty, VIOLET_CSS_PREFIX } from '@lushly-dev/violet-runtime/property';
import { resolveInterface } from '../interface.js';
import {
	checkCssTokenValue,
	type Database,
	defaultPort,
	type Engine,
	type TokenValue,
	type VioletPort,
} from '../port/engine.js';
import { byCodePoint, orderNodeIds, orderNodesPreOrder, sortByKey } from '../port/results.js';
import { type BatchChangeInput, parseOperationMetadata } from '../port/undo.js';

/** Look up a token's DTCG `$type` or category on a node (for `INVALID_TOKEN_VALUE` suggestions, F12). */
export async function tokenTypeOn(
	db: Database,
	engine: Engine,
	nodeId: string,
	tokenId: string
): Promise<string | undefined> {
	const res = await engine.call<{
		tokens: Array<{ id: string; metadata?: { type?: string; category?: string } }>;
	}>('tokens.resolve', { nodeId });
	const found = res.data?.tokens.find((t) => t.id === tokenId);
	if (found?.metadata?.type) return found.metadata.type;
	if (found?.metadata?.category) return found.metadata.category;
	const ops = await db.getOperations(nodeId);
	const addOp = ops.find((op) => (op.asTokenId ?? op.tokenId) === tokenId && op.type === 'add');
	const parsed = addOp ? parseOperationMetadata(addOp.metadata) : undefined;
	return parsed?.type ?? parsed?.category;
}

export interface ImpactSummary {
	changed: number;
	shielded: number;
	violationsIntroduced: number;
}

export interface ImpactNodeSummary {
	id: string;
	effect: string;
	violationsIntroduced: number;
}

class DryRunSentinel {
	constructor(readonly failureResult?: CommandResult<never>) {}
}

/** Check whether any ancestor of `nodeId` defines/provides `tokenId` (used for reset -> subtract translation). */
export async function ancestorProvidesToken(
	db: Database,
	engine: Engine,
	nodeId: string,
	tokenId: string
): Promise<boolean> {
	const node = await db.getNode(nodeId);
	if (!node?.parentId) return false;
	const lineage = await engine.call<{ tokenId: string }>('token.lineage', {
		nodeId: node.parentId,
		tokenId,
	});
	return lineage.success;
}

/**
 * Translate app batch changes into `changes.impact`'s input format (spec §6.3, §6.4):
 * a `reset` translates to `subtract` when no ancestor provides the token (avoiding `token.reset`'s
 * `INVALID_PARENT` on root or subtree-root adds), and to `reset` when an ancestor provides it.
 */
export async function computeBatchImpact(
	db: Database,
	engine: Engine,
	node: string,
	changes: readonly BatchChangeInput[],
	appCommand: string
): Promise<CommandResult<{ summary: ImpactSummary; nodes: ImpactNodeSummary[] }>> {
	const impactChanges = await Promise.all(
		changes.map(async (change) => {
			if (change.operation === 'add') {
				return {
					type: 'add' as const,
					tokenId: change.token,
					value: change.value,
					...(change.metadata ? { metadata: change.metadata } : {}),
				};
			}
			if (change.operation === 'override') {
				return {
					type: 'override' as const,
					tokenId: change.token,
					value: change.value,
				};
			}
			const hasAncestor = await ancestorProvidesToken(db, engine, node, change.token);
			return {
				type: hasAncestor ? ('reset' as const) : ('subtract' as const),
				tokenId: change.token,
			};
		})
	);

	const res = await engine.call<{
		summary: {
			effects: { changes: number; added: number; removed: number; shielded: number };
			violationsIntroduced: number;
		};
		nodes: Array<{ id: string; effect: string; violations: { introduced: unknown[] } }>;
	}>('changes.impact', { nodeId: node, changes: impactChanges }, { appCommand });
	if (!res.success || !res.data) return res as CommandResult<never>;

	const ordered = orderNodesPreOrder(await db.listNodes());
	const rank = new Map(ordered.map((n, index) => [n.id, index]));
	const nodes = [...res.data.nodes]
		.sort((a, b) => {
			const ra = rank.get(a.id);
			const rb = rank.get(b.id);
			if (ra !== undefined && rb !== undefined) return ra - rb;
			return byCodePoint(a.id, b.id);
		})
		.map((entry) => ({
			id: entry.id,
			effect: entry.effect,
			violationsIntroduced: entry.violations.introduced.length,
		}));

	const { effects } = res.data.summary;
	return success({
		summary: {
			changed: effects.changes + effects.added + effects.removed,
			shielded: effects.shielded,
			violationsIntroduced: res.data.summary.violationsIntroduced,
		},
		nodes,
	});
}

/**
 * Dry-run the exact `violet-change-apply` write sequence (`token.add`, `token.override`, `token.remove`)
 * inside a rolled-back transaction so preview and apply agree on every valid and invalid batch (spec §6.3).
 */
export async function dryRunBatch(
	db: Database,
	engine: Engine,
	node: string,
	changes: readonly BatchChangeInput[],
	appCommand: string
): Promise<CommandResult<true>> {
	try {
		await db.transaction(async () => {
			for (let index = 0; index < changes.length; index++) {
				const change = changes[index] as BatchChangeInput;
				let stepResult: CommandResult<unknown>;
				if (change.operation === 'add') {
					if (change.value === undefined) {
						stepResult = failure({
							code: 'VALIDATION_ERROR',
							message: `Change ${index} (add '${change.token}') requires a value`,
							suggestion: `Provide a value for '${change.token}' in changes[${index}]`,
						});
					} else {
						stepResult = await engine.call(
							'token.add',
							{
								nodeId: node,
								tokenId: change.token,
								value: change.value,
								...(change.metadata ? { metadata: change.metadata } : {}),
							},
							{ appCommand, tokenType: change.metadata?.type ?? change.metadata?.category }
						);
					}
				} else if (change.operation === 'override') {
					if (change.value === undefined) {
						stepResult = failure({
							code: 'VALIDATION_ERROR',
							message: `Change ${index} (override '${change.token}') requires a value`,
							suggestion: `Provide a value for '${change.token}' in changes[${index}]`,
						});
					} else {
						const tokenType = await tokenTypeOn(db, engine, node, change.token);
						stepResult = await engine.call(
							'token.override',
							{ nodeId: node, tokenId: change.token, value: change.value },
							{ appCommand, tokenType }
						);
					}
				} else {
					stepResult = await engine.call(
						'token.remove',
						{ nodeId: node, tokenId: change.token },
						{ appCommand }
					);
				}

				if (!stepResult.success && stepResult.error) {
					throw new DryRunSentinel(
						failure({
							...stepResult.error,
							details: { ...(stepResult.error.details ?? {}), index },
						})
					);
				}
			}
			// Always roll back preview staging.
			throw new DryRunSentinel();
		});
	} catch (caught) {
		if (caught instanceof DryRunSentinel) {
			return caught.failureResult ?? success(true);
		}
		throw caught;
	}
	return success(true);
}

function parseContrastRatio(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const match = /([0-9]+(?:\.[0-9]+)?)\s*:\s*1/.exec(text);
	return match ? Number(match[1]) : undefined;
}

export function createCheckHandlers(port: VioletPort = defaultPort) {
	return {
		async 'violet-change-preview'(
			input: { document: string; node: string; changes: BatchChangeInput[] },
			context: AppCallContextV1
		) {
			return port.read(
				input.document,
				context,
				'violet-change-preview',
				async ({ db, engine, content }) => {
					const staged = await dryRunBatch(
						db,
						engine,
						input.node,
						input.changes,
						'violet-change-preview'
					);
					if (!staged.success) return staged as CommandResult<never>;

					const impact = await computeBatchImpact(
						db,
						engine,
						input.node,
						input.changes,
						'violet-change-preview'
					);
					if (!impact.success || !impact.data) return impact as CommandResult<never>;

					return success({
						written: false,
						summary: impact.data.summary,
						nodes: impact.data.nodes,
						apply: {
							command: 'violet-change-apply',
							input: {
								document: input.document,
								node: input.node,
								changes: input.changes,
								expectedRev: content.rev,
							},
						},
					});
				},
				{ requireMutationGrants: true }
			);
		},

		async 'violet-theme-preview'(
			input: { document: string; node: string },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-theme-preview', async ({ engine }) => {
				const res = await engine.call<{
					tokens: Array<{
						id: string;
						resolvedValue: TokenValue;
						metadata?: { type?: string; category?: string };
					}>;
				}>('tokens.resolve', { nodeId: input.node });
				if (!res.success || !res.data) return res as CommandResult<never>;

				const sorted = sortByKey(res.data.tokens, (t) => t.id);
				const properties: Array<{ name: string; value: string }> = [];
				const refused: Array<{ token: string; reason: string }> = [];

				for (const token of sorted) {
					const problem = checkCssTokenValue(token.resolvedValue, token.metadata);
					if (problem) {
						refused.push({ token: token.id, reason: problem });
						continue;
					}
					const value =
						typeof token.resolvedValue === 'string' || typeof token.resolvedValue === 'number'
							? String(token.resolvedValue)
							: JSON.stringify(token.resolvedValue);
					properties.push({
						// The names the shared components and Loam's chrome read (#1786).
						name: tokenCustomProperty(token.id, VIOLET_CSS_PREFIX),
						value,
					});
				}

				return success({
					node: input.node,
					count: properties.length,
					properties,
					refused,
				});
			});
		},

		async 'violet-violation-list'(
			input: { document: string; root?: string },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-violation-list', async ({ db, engine }) => {
				const res = await engine.call<{
					violations: Array<{
						nodeId: string;
						tokenId: string;
						constraintId: string;
						severity: string;
						actual?: string;
						expected?: string;
					}>;
					summary: { total: number; errors: number };
				}>('analyze.violations', input.root ? { rootId: input.root } : {});
				if (!res.success || !res.data) return res as CommandResult<never>;

				const ordered = orderNodesPreOrder(await db.listNodes());
				const rank = new Map(ordered.map((n, index) => [n.id, index]));
				const violations = [...res.data.violations]
					.sort((a, b) => {
						const ra = rank.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER;
						const rb = rank.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER;
						if (ra !== rb) return ra - rb;
						const tok = byCodePoint(a.tokenId, b.tokenId);
						return tok !== 0 ? tok : byCodePoint(a.constraintId, b.constraintId);
					})
					.map((v) => {
						const ratio = parseContrastRatio(v.actual);
						const min = parseContrastRatio(v.expected);
						return {
							node: v.nodeId,
							token: v.tokenId,
							rule: v.constraintId,
							severity: v.severity,
							...(ratio !== undefined ? { ratio } : {}),
							...(min !== undefined ? { min } : {}),
						};
					});

				return success({
					violations,
					summary: { total: res.data.summary.total, errors: res.data.summary.errors },
				});
			});
		},

		async 'violet-interface-check'(
			input: { document: string; nodes?: string[] },
			context: AppCallContextV1
		) {
			return port.read(
				input.document,
				context,
				'violet-interface-check',
				async ({ db, engine }) => {
					const spec = resolveInterface(context.config);
					const res = await engine.call<{
						interface: { version: number; package?: string };
						complete: boolean;
						nodes: string[];
						missing: Array<{ node: string; token: string; reason: string }>;
						invalid: Array<{ node: string; token: string; type: string; problem: string }>;
						leaked?: Array<{ token: string; reason: 'private-prefix' | 'global-tier' }>;
					}>('interface.check', {
						interface: spec,
						...(input.nodes ? { nodes: input.nodes } : {}),
					});
					if (!res.success || !res.data) return res as CommandResult<never>;

					const ordered = orderNodesPreOrder(await db.listNodes());
					const rank = new Map(ordered.map((n, index) => [n.id, index]));
					const byNodeThenToken = (
						a: { node: string; token: string },
						b: { node: string; token: string }
					) => {
						const ra = rank.get(a.node) ?? Number.MAX_SAFE_INTEGER;
						const rb = rank.get(b.node) ?? Number.MAX_SAFE_INTEGER;
						if (ra !== rb) return ra - rb;
						return byCodePoint(a.token, b.token);
					};

					return success({
						interface: { version: res.data.interface.version },
						complete: res.data.complete,
						nodes: orderNodeIds(res.data.nodes, ordered),
						missing: [...res.data.missing].sort(byNodeThenToken),
						invalid: [...res.data.invalid].sort(byNodeThenToken),
						leaked: sortByKey(res.data.leaked ?? [], (entry) => entry.token),
					});
				}
			);
		},
	};
}
