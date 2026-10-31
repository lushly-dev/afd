import { matchesGlob } from '@lushly-dev/violet-core/engine';
import { withResolutionCache } from '@lushly-dev/violet-core/engine';
import {
	ChainTokens,
	InheritanceResolutionError,
	resolveChainState,
} from '@lushly-dev/violet-core/engine';
import type { Node } from '@lushly-dev/violet-core/types';
import { TokenCategorySchema, type TokenMetadata } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { validateCommand } from '../constraints/validate.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Upper bound on matrix columns. A matrix wider than this is not readable and
 * the payload grows with nodes × tokens, so callers narrow with rootId/nodeIds.
 */
export const MAX_MATRIX_NODES = 200;

/** Upper bound on rows per page (`limit`) */
export const MAX_MATRIX_PAGE_SIZE = 5000;

export const MatrixGroupBySchema = z.enum(['category', 'tier']);
export type MatrixGroupBy = z.infer<typeof MatrixGroupBySchema>;

/** Row order by token id; groups (with groupBy) always stay in ascending order */
export const MatrixSortSchema = z.enum(['token-asc', 'token-desc']);
export type MatrixSort = z.infer<typeof MatrixSortSchema>;

/**
 * How a token's value arrived at a node.
 *
 * - add / override / copy / reset / include: the last operation on this node that
 *   set the token
 * - inherited: the value flows unchanged from an ancestor (or an ancestor's include)
 * - subtracted: this node removed the token
 * - absent: the token does not exist here (never defined in this chain, or removed
 *   by an ancestor, which is reported as `source`)
 * - unresolved: the node could not be resolved (e.g. a copy/include cycle)
 */
export const MatrixCellStateSchema = z.enum([
	'add',
	'override',
	'copy',
	'reset',
	'include',
	'inherited',
	'subtracted',
	'absent',
	'unresolved',
]);

export type MatrixCellState = z.infer<typeof MatrixCellStateSchema>;

const LOCAL_STATES = new Set<MatrixCellState>(['add', 'override', 'copy', 'reset', 'include']);

/**
 * Input schema for tokens.matrix command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // Subtree root (inclusive); defaults to every root
	nodeIds: z.array(z.string().min(1)).min(1).max(MAX_MATRIX_NODES).optional(), // Explicit columns, in order
	filter: z.string().optional(), // Glob pattern like "color.*"
	category: TokenCategorySchema.optional(), // Only tokens of this category (from their metadata)
	onlyVarying: z.boolean().optional().default(false), // Keep tokens whose value differs (see rowVaries)
	onlyViolating: z.boolean().optional().default(false), // Keep tokens with a violation (implies includeViolations)
	includeViolations: z.boolean().optional().default(false), // Run constraints.validate per node
	groupBy: MatrixGroupBySchema.optional(), // Order rows by group and count each group (`groups`)
	sort: MatrixSortSchema.optional().default('token-asc'), // Token id order (within each group)
	summaryOnly: z.boolean().optional().default(false), // No rows: nodes, summary and groups only
	limit: z.number().int().min(1).max(MAX_MATRIX_PAGE_SIZE).optional(), // Rows per page
	cursor: z.string().min(1).optional(), // `page.nextCursor` or `page.prevCursor` of another page
	around: z.string().min(1).optional(), // With limit: the page holding this token id
});

const ViolationSchema = z.object({
	constraintId: z.string(),
	severity: z.enum(['error', 'warning', 'info']),
	message: z.string(),
});

const ReferenceErrorSchema = z.object({
	code: z.enum(['TOKEN_REFERENCE_NOT_FOUND', 'CIRCULAR_REFERENCE', 'NOT_IMPLEMENTED']),
	message: z.string(),
	path: z.array(z.string()),
});

export const MatrixCellSchema = z.object({
	state: MatrixCellStateSchema,
	value: z.any().optional(), // As stored: a literal, or a reference such as { ref: 'color.brand' }
	resolvedValue: z.union([z.string(), z.number()]).optional(), // References followed in this node
	aliasOf: z.string().optional(), // Token the value refers to, when it is a single reference
	referenceError: ReferenceErrorSchema.optional(), // Why the reference could not be followed
	source: z.string().nullable(), // Node the value (or removal) came from
	fromNode: z.string().optional(), // Copy source, included node, or reset target of a local value
	violations: z.array(ViolationSchema).optional(),
});

export type MatrixCell = z.infer<typeof MatrixCellSchema>;

/**
 * Output schema for tokens.matrix command
 */
const OutputSchema = z.object({
	nodes: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			type: z.string(),
			status: z.string(),
			parentId: z.string().nullable(),
			depth: z.number(),
			error: z.string().optional(),
		}),
	),
	tokens: z.array(
		z.object({
			id: z.string(),
			category: z.string(),
			tier: z.string(),
			varies: z.boolean(),
			cells: z.record(z.string(), MatrixCellSchema),
		}),
	),
	/** Counts over every matching row, not only this page */
	summary: z.object({
		nodes: z.number(),
		tokens: z.number(),
		varyingTokens: z.number(),
		states: z.record(z.string(), z.number()),
		violations: z.number(),
	}),
	/** With groupBy: one entry per category or tier, in row order */
	groups: z
		.array(
			z.object({
				id: z.string(),
				tokens: z.number(),
				varyingTokens: z.number(),
				violations: z.number(),
			}),
		)
		.optional(),
	/**
	 * With limit: where this page sits. Pass nextCursor (or prevCursor) as
	 * cursor for the page after (or before) it.
	 */
	page: z
		.object({
			limit: z.number(),
			returned: z.number(),
			/** Matching rows before this page */
			offset: z.number(),
			nextCursor: z.string().nullable(),
			prevCursor: z.string().nullable(),
		})
		.optional(),
});

type Output = z.infer<typeof OutputSchema>;
export type MatrixNode = Output['nodes'][number];
export type MatrixRow = Output['tokens'][number];

/** Sort key of a row: its group (when grouping) and its token id */
function rowKey(
	row: Pick<MatrixRow, 'id' | 'category' | 'tier'>,
	groupBy: MatrixGroupBy | undefined,
): [string, string] {
	return [groupBy ? row[groupBy] : '', row.id];
}

/** Row order: groups ascending, then token ids in `sort` order */
function compareKeys(a: [string, string], b: [string, string], sort: MatrixSort): number {
	const ids = a[1].localeCompare(b[1]);
	return a[0].localeCompare(b[0]) || (sort === 'token-desc' ? -ids : ids);
}

/** How a page was ordered, so its cursor can't continue a differently ordered matrix */
interface PageOrder {
	groupBy: MatrixGroupBy | undefined;
	sort: MatrixSort;
}

/** Where a cursor points: the rows after a key (next page) or before it (previous page) */
interface PageCursor {
	key: [string, string];
	before: boolean;
}

/**
 * Opaque page cursor: the sort key of the last row on the page (or the first,
 * for the page before it). Keyed on the row rather than an offset, so a token
 * added between pages doesn't shift the rest by one.
 */
function encodeCursor({ groupBy, sort }: PageOrder, { key, before }: PageCursor): string {
	// base64url without Buffer, so the worker entrypoint can page too. Ascending
	// next-page cursors leave the order and direction out, so cursors from
	// before `sort` and `prevCursor` still work.
	const order = sort === 'token-asc' ? {} : { s: sort };
	const direction = before ? { d: 'before' } : {};
	const bytes = new TextEncoder().encode(
		JSON.stringify({ g: groupBy ?? null, k: key, ...order, ...direction }),
	);
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

function decodeCursor(cursor: string, { groupBy, sort }: PageOrder): PageCursor | null {
	try {
		const binary = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		const valid =
			parsed?.g === (groupBy ?? null) &&
			(parsed.s ?? 'token-asc') === sort &&
			(parsed.d === undefined || parsed.d === 'before') &&
			Array.isArray(parsed.k) &&
			parsed.k.length === 2 &&
			parsed.k.every((part: unknown) => typeof part === 'string');
		return valid ? { key: [parsed.k[0], parsed.k[1]], before: parsed.d === 'before' } : null;
	} catch {
		return null;
	}
}

/** Cell states, violations and (with groupBy) per-group counts over `rows` */
function countRows(rows: MatrixRowCounts[], groupBy: MatrixGroupBy | undefined) {
	const states: Record<string, number> = {};
	let violationCount = 0;
	const groups = new Map<string, NonNullable<Output['groups']>[number]>();
	for (const row of rows) {
		for (const state of row.states) {
			states[state] = (states[state] ?? 0) + 1;
		}
		violationCount += row.violations;
		if (groupBy) {
			const id = row[groupBy];
			const group = groups.get(id) ?? { id, tokens: 0, varyingTokens: 0, violations: 0 };
			group.tokens += 1;
			group.varyingTokens += row.varies ? 1 : 0;
			group.violations += row.violations;
			groups.set(id, group);
		}
	}
	return { states, violationCount, groups: [...groups.values()] };
}

/** Which rows a page holds: after or before a cursor, the page holding a token, or the first */
type PageStart =
	| { cursor: PageCursor }
	| { around: number } // index of the row the page must hold
	| Record<string, never>;

/**
 * The rows of one page, at most `limit` of them, with where it sits. Pages
 * reached with `around` start at a multiple of `limit`, where paging from the
 * first page would put them, so a client can mix both.
 */
function pageOf<Row extends Pick<MatrixRow, 'id' | 'category' | 'tier'>>(
	rows: Row[],
	order: PageOrder,
	start: PageStart,
	limit: number | undefined,
): { rows: Row[]; page?: Output['page'] } {
	const { groupBy, sort } = order;
	const keyOf = (row: Row) => rowKey(row, groupBy);
	let from = 0;
	let to = rows.length;
	if ('cursor' in start && start.cursor) {
		const { key, before } = start.cursor;
		const index = rows.findIndex((row) => compareKeys(keyOf(row), key, sort) >= 0);
		const at = index < 0 ? rows.length : index;
		if (before) {
			to = at;
			from = limit === undefined ? 0 : Math.max(0, to - limit);
		} else {
			// The cursor's row may have gone since; the page starts after its key
			from = rows[at] && compareKeys(keyOf(rows[at]), key, sort) === 0 ? at + 1 : at;
		}
	} else if ('around' in start && limit !== undefined) {
		from = Math.floor((start.around as number) / limit) * limit;
	}
	if (limit === undefined) {
		return { rows: rows.slice(from, to) };
	}
	to = Math.min(to, from + limit);
	const pageRows = rows.slice(from, to);
	const first = pageRows[0];
	const last = pageRows[pageRows.length - 1];
	return {
		rows: pageRows,
		page: {
			limit,
			returned: pageRows.length,
			offset: from,
			nextCursor:
				to < rows.length && last ? encodeCursor(order, { key: keyOf(last), before: false }) : null,
			prevCursor:
				from > 0 && first ? encodeCursor(order, { key: keyOf(first), before: true }) : null,
		},
	};
}

/** Cell for a token this node's tree never had: absent, and no node on its chain removed it */
function neverDefined(cell: Pick<MatrixCell, 'state' | 'source'>): boolean {
	return cell.state === 'absent' && cell.source === null;
}

/**
 * Whether a token's value differs between the columns.
 *
 * Values are compared with references followed, so two nodes that both point
 * at `color.brand` differ when their brand colors do. A removal or a gap counts
 * as a value of its own, but only inside a tree (columns sharing a root) where
 * the token exists or was removed. A tree that never had the token, such as a
 * shared set's own root, is left out, otherwise every token outside a shared
 * set would count as varying. Unresolved columns are left out too.
 */
function rowVaries(
	cells: Array<Pick<MatrixCell, 'state' | 'source'> & { tree: string; key: string | null }>,
): boolean {
	const treesWithToken = new Set(
		cells.filter((cell) => !neverDefined(cell)).map(({ tree }) => tree),
	);
	const distinct = new Set<string>();
	for (const { state, tree, key } of cells) {
		if (state === 'unresolved' || !treesWithToken.has(tree)) {
			continue;
		}
		distinct.add(key ?? '∅');
	}
	return distinct.size > 1;
}

/**
 * Constraint violations per node, keyed by token id, from constraints.validate.
 * Nodes that could not be resolved are skipped.
 */
async function collectViolations(
	context: CommandContext,
	nodes: MatrixNode[],
	filter: string | undefined,
): Promise<Map<string, Map<string, MatrixCell['violations']>>> {
	const violationsByNode = new Map<string, Map<string, MatrixCell['violations']>>();
	for (const node of nodes) {
		if (node.error) {
			continue;
		}
		const result = await validateCommand.handler({ nodeId: node.id, filter }, context);
		if (!result.success || !result.data) {
			continue;
		}
		const byToken = new Map<string, MatrixCell['violations']>();
		for (const tokenResult of result.data.results) {
			if (tokenResult.violations.length > 0) {
				byToken.set(
					tokenResult.tokenId,
					tokenResult.violations.map((violation) => ({
						constraintId: violation.constraintId,
						severity: violation.severity,
						message: violation.message,
					})),
				);
			}
		}
		violationsByNode.set(node.id, byToken);
	}
	return violationsByNode;
}

/** A cell's state, the node its value (or removal) came from, and a local value's fromNode */
interface CellLocation {
	state: MatrixCellState;
	source: string | null;
	fromNode?: string;
}

/** One column of a matrix: a node, its chain and its walked tokens */
interface MatrixColumn {
	node: MatrixNode;
	/** Root first, the node last */
	chain: string[];
	/** Undefined when the node could not be resolved */
	tokens: ChainTokens | undefined;
}

/**
 * What every matching row needs for counting, filtering and ordering: one
 * state per column (in `nodes` order), without values, so a page can be
 * picked before any cell is described.
 */
export interface MatrixRowCounts {
	id: string;
	category: string;
	tier: string;
	varies: boolean;
	states: MatrixCellState[];
	/** Violations across the row's cells */
	violations: number;
}

/** A matrix whose rows are counted but not described; see countTokenMatrix */
export interface TokenMatrix {
	nodes: MatrixNode[];
	/** Every row, sorted by token id */
	rows: MatrixRowCounts[];
	/** Full rows for these token ids, in the given order; the same cells for any subset */
	describe(tokenIds: readonly string[]): Promise<MatrixRow[]>;
}

/**
 * Walk every column's chain and count each token × node cell. Shared by
 * tokens.matrix and nodes.graph (token trace). Rows are sorted by token id;
 * with `tokenIds`, exactly those tokens get a row.
 *
 * Counting a row needs only its states and whether its values differ, so
 * references are followed per token and cells (values, sources, violations)
 * are built by `describe`, for the rows a caller returns (#114).
 */
export async function countTokenMatrix(
	context: CommandContext,
	columns: Node[],
	options: {
		filter?: string;
		category?: string;
		tokenIds?: string[];
		includeViolations?: boolean;
	} = {},
): Promise<TokenMatrix> {
	// Every column walks the same ancestors; share reads and resolved chains
	// across them, and with the constraints.validate calls for violations
	const scoped = withResolutionCache(context);
	const { db, resolutionCache: cache } = scoped;

	// Walk each column's chain; its history tells local changes from inheritance
	const matrixColumns: MatrixColumn[] = [];
	const metadataById = new Map<string, TokenMetadata>();

	for (const node of columns) {
		const ancestryChain = await cache.getAncestryChain(node.id);
		const entry: MatrixNode = {
			id: node.id,
			name: node.name,
			type: node.type,
			status: node.status,
			parentId: node.parentId,
			depth: ancestryChain.length,
		};
		const chain = [...ancestryChain, node.id];
		let tokens: ChainTokens | undefined;
		try {
			const state = await resolveChainState(db, node.id, ancestryChain, { cache });
			tokens = new ChainTokens(state, chain);
			for (const [id, token] of state.tokens) {
				if (!metadataById.has(id)) {
					metadataById.set(id, token.metadata);
				}
			}
		} catch (error) {
			if (!(error instanceof InheritanceResolutionError)) {
				throw error;
			}
			entry.error = error.message;
		}
		matrixColumns.push({ node: entry, chain, tokens });
	}
	const matrixNodes = matrixColumns.map((column) => column.node);

	// Token ids each node subtracts, for the cells of tokens a column lacks
	const subtractedBy = new Map<string, Set<string>>();
	const subtracted = async (nodeId: string) => {
		let ids = subtractedBy.get(nodeId);
		if (!ids) {
			ids = new Set();
			for (const op of await cache.getOperations(nodeId)) {
				if (op.type === 'subtract') ids.add(op.tokenId);
			}
			subtractedBy.set(nodeId, ids);
		}
		return ids;
	};

	// Tokens that exist somewhere but were subtracted in a column still need a row,
	// so collect subtracted ids from the columns' own operations too
	const rowIds = new Set(metadataById.keys());
	for (const node of columns) {
		for (const id of await subtracted(node.id)) {
			rowIds.add(id);
		}
	}

	const { filter } = options;
	const { category } = options;
	const tokenIds = (options.tokenIds ?? [...rowIds])
		.filter((id) => !filter || matchesGlob(id, filter))
		.filter((id) => !category || metadataById.get(id)?.category === category)
		.sort((a, b) => a.localeCompare(b));

	const violationsByNode = options.includeViolations
		? await collectViolations(scoped, matrixNodes, filter)
		: new Map<string, Map<string, MatrixCell['violations']>>();

	/** A cell's state and the node its value (or removal) came from */
	const locate = async (column: MatrixColumn, tokenId: string): Promise<CellLocation> => {
		const { node, tokens } = column;
		if (!tokens) {
			return { state: 'unresolved', source: null };
		}
		const entry = tokens.entry(tokenId);
		if (entry) {
			let last: (typeof entry.history)[number] | undefined;
			for (const step of entry.history) {
				if (step.nodeId === node.id) last = step;
			}
			const state = (last?.operation ?? 'inherited') as MatrixCellState;
			const local = LOCAL_STATES.has(state);
			return {
				state: local ? state : 'inherited',
				source: entry.resolvedAt,
				...(local && last?.fromNode ? { fromNode: last.fromNode } : {}),
			};
		}
		// Missing: find the nearest node on the chain that subtracted it
		const { chain } = column;
		for (let i = chain.length - 1; i >= 0; i--) {
			if ((await subtracted(chain[i])).has(tokenId)) {
				return chain[i] === node.id
					? { state: 'subtracted', source: node.id }
					: { state: 'absent', source: chain[i] };
			}
		}
		return { state: 'absent', source: null };
	};

	const rows: MatrixRowCounts[] = [];
	// Kept for describe, so a described row doesn't look its cells up again
	const locations = new Map<string, CellLocation[]>();
	for (const tokenId of tokenIds) {
		const states: MatrixCellState[] = [];
		const located: CellLocation[] = [];
		const compared: Parameters<typeof rowVaries>[0] = [];
		let violations = 0;
		for (const column of matrixColumns) {
			const location = await locate(column, tokenId);
			const { state, source } = location;
			located.push(location);
			states.push(state);
			const { tokens } = column;
			const entry = tokens?.entry(tokenId);
			// Only a cell with a value carries violations (see describeCell)
			if (entry) {
				violations += violationsByNode.get(column.node.id)?.get(tokenId)?.length ?? 0;
			}
			const value = entry ? (tokens?.finalValue(tokenId) ?? entry.value) : undefined;
			compared.push({
				state,
				source,
				tree: column.chain[0],
				key: value === undefined ? null : JSON.stringify(value),
			});
		}
		locations.set(tokenId, located);
		const metadata = metadataById.get(tokenId);
		rows.push({
			id: tokenId,
			category: metadata?.category ?? 'custom',
			tier: metadata?.tier ?? 'semantic',
			varies: rowVaries(compared),
			states,
			violations,
		});
	}

	const describeCell = (
		column: MatrixColumn,
		tokenId: string,
		located: CellLocation,
	): MatrixCell => {
		const token = column.tokens?.token(tokenId);
		if (!token) {
			return { state: located.state, source: located.source };
		}
		const cell: MatrixCell = {
			state: located.state,
			value: token.value,
			resolvedValue: token.resolvedValue,
			...(token.aliasOf ? { aliasOf: token.aliasOf } : {}),
			...(token.referenceError ? { referenceError: token.referenceError } : {}),
			source: located.source,
		};
		if (located.fromNode) {
			cell.fromNode = located.fromNode;
		}
		const violations = violationsByNode.get(column.node.id)?.get(tokenId);
		if (violations) {
			cell.violations = violations;
		}
		return cell;
	};

	const byId = new Map(rows.map((row) => [row.id, row]));
	const describe = async (ids: readonly string[]): Promise<MatrixRow[]> => {
		const described: MatrixRow[] = [];
		for (const id of ids) {
			const row = byId.get(id);
			const located = locations.get(id);
			if (!row || !located) continue;
			const cells: Record<string, MatrixCell> = {};
			matrixColumns.forEach((column, index) => {
				cells[column.node.id] = describeCell(column, id, located[index]);
			});
			described.push({
				id: row.id,
				category: row.category,
				tier: row.tier,
				varies: row.varies,
				cells,
			});
		}
		return described;
	};

	return { nodes: matrixNodes, rows, describe };
}

/**
 * Every row of a matrix with its cells described, for callers that compare
 * whole matrices (tokens.compare, changes.impact).
 */
export async function computeTokenMatrix(
	context: CommandContext,
	columns: Node[],
	options: Parameters<typeof countTokenMatrix>[2] = {},
): Promise<{ nodes: MatrixNode[]; rows: MatrixRow[] }> {
	const matrix = await countTokenMatrix(context, columns, options);
	return { nodes: matrix.nodes, rows: await matrix.describe(matrix.rows.map((row) => row.id)) };
}

/**
 * tokens.matrix command
 *
 * Resolve tokens across many nodes at once and report, for every token × node
 * cell, the value and how it got there. Powers the Matrix view and answers
 * "what is this token everywhere?" in one call.
 */
export const tokensMatrixCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'tokens.matrix',
	description: 'Resolve tokens across many nodes and show how each value got there',
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);
		if (input.rootId && input.nodeIds) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: 'Use either rootId or nodeIds, not both',
				suggestion:
					'Pass rootId for a subtree, nodeIds for explicit columns, or neither for all nodes',
			});
		}

		// Pick the columns
		let columns: Node[];
		if (input.nodeIds) {
			columns = [];
			for (const nodeId of input.nodeIds) {
				const node = await db.getNode(nodeId);
				if (!node || node.deletedAt) {
					return failure({
						code: ErrorCodes.NODE_NOT_FOUND,
						message: `Node '${nodeId}' not found`,
						suggestion: `Use 'node.list' to see available nodes`,
					});
				}
				columns.push(node);
			}
		} else {
			const scope = await selectSubtree(db, input.rootId);
			if (!scope) {
				return failure({
					code: ErrorCodes.NODE_NOT_FOUND,
					message: `Node '${input.rootId}' not found`,
					suggestion: `Use 'node.list' to see available nodes`,
				});
			}
			columns = scope;
		}

		const order: PageOrder = { groupBy: input.groupBy, sort: input.sort };
		const cursor = input.cursor ? decodeCursor(input.cursor, order) : undefined;
		if (cursor === null) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: 'cursor is not a page cursor for this groupBy and sort',
				suggestion:
					'Pass page.nextCursor or page.prevCursor from another page with the same groupBy and sort, or leave cursor out for the first page',
			});
		}
		if (input.around && (input.cursor || input.limit === undefined)) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: input.cursor
					? 'Use either around or cursor, not both'
					: 'around picks a page, so it needs limit',
				suggestion:
					'Pass around with limit (and no cursor) to get the page holding a token, then page on with its cursors',
			});
		}

		if (columns.length > MAX_MATRIX_NODES) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Matrix would have ${columns.length} nodes (max ${MAX_MATRIX_NODES})`,
				suggestion: 'Narrow the matrix with rootId (a subtree) or nodeIds (explicit columns)',
			});
		}

		const matrix = await countTokenMatrix(context, columns, {
			filter: input.filter,
			category: input.category,
			includeViolations: input.includeViolations || input.onlyViolating,
		});
		const matrixNodes = matrix.nodes;
		const { groupBy } = input;
		const rows = matrix.rows.filter(
			(row) => (!input.onlyVarying || row.varies) && (!input.onlyViolating || row.violations > 0),
		);
		if (groupBy || input.sort !== 'token-asc') {
			rows.sort((a, b) => compareKeys(rowKey(a, groupBy), rowKey(b, groupBy), input.sort));
		}

		const { states, violationCount, groups } = countRows(rows, groupBy);

		const varyingTokens = rows.filter((row) => row.varies).length;
		const unresolved = matrixNodes.filter((node) => node.error).length;
		const unresolvedNote = unresolved > 0 ? `; ${unresolved} node(s) could not be resolved` : '';

		let start: PageStart = cursor ? { cursor } : {};
		if (input.around && !input.summaryOnly) {
			const index = rows.findIndex((row) => row.id === input.around);
			if (index < 0) {
				return failure({
					code: ErrorCodes.TOKEN_NOT_FOUND,
					message: `Token '${input.around}' is not among the matching rows`,
					suggestion:
						'Check the token id, or loosen filter, category, onlyVarying or onlyViolating so its row matches',
				});
			}
			start = { around: index };
		}

		// Summary and groups count every row; only the page's cells are described
		const { rows: pageCounts, page } = input.summaryOnly
			? { rows: [], page: undefined }
			: pageOf(rows, order, start, input.limit);
		const pageRows = await matrix.describe(pageCounts.map((row) => row.id));
		const pageNote = page
			? `; returned ${pageRows.length} from row ${page.offset + 1}${page.nextCursor ? ', more after page.nextCursor' : ''}`
			: input.summaryOnly
				? '; rows left out (summaryOnly)'
				: '';

		return success(
			{
				nodes: matrixNodes,
				tokens: pageRows,
				summary: {
					nodes: matrixNodes.length,
					tokens: rows.length,
					varyingTokens,
					states,
					violations: violationCount,
				},
				...(groupBy ? { groups: [...groups.values()] } : {}),
				...(page ? { page } : {}),
			},
			{
				reasoning: `Resolved ${rows.length} token(s) across ${matrixNodes.length} node(s); ${varyingTokens} vary between nodes${pageNote}${unresolvedNote}`,
				sources: matrixNodes.map((node) => ({ type: 'node', id: node.id, title: node.name })),
			},
		);
	},

	examples: [
		{
			description: 'Every token across every node',
			input: {},
		},
		{
			description: 'Color tokens across the xbox subtree',
			input: { rootId: 'xbox', filter: 'color.*' },
		},
		{
			description: 'Token counts per category, without rows, to load one category at a time',
			input: { groupBy: 'category', summaryOnly: true },
		},
		{
			description: 'The first 200 color tokens across every node; pass page.nextCursor for more',
			input: { category: 'color', limit: 200 },
		},
		{
			description: 'The page of 100 color tokens holding color.text.primary, for a link to it',
			input: { category: 'color', limit: 100, around: 'color.text.primary' },
		},
		{
			description: 'Rows grouped by category, token ids in reverse order within each group',
			input: { groupBy: 'category', sort: 'token-desc' },
		},
		{
			description: 'Only tokens that differ between three nodes, with constraint violations',
			input: {
				nodeIds: ['xbox-ios', 'xbox-android', 'xbox-ios-dark'],
				onlyVarying: true,
				includeViolations: true,
			},
		},
	],
};
