import { withResolutionCache } from '@lushly-dev/violet-core/engine';
import type { Node } from '@lushly-dev/violet-core/types';
import type { OperationRecord, OperationType } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import {
	type TokenDefinitionSite,
	collectDefinitions,
	definitionOrder,
	operationTarget,
} from '../token/definitions.js';
import { MatrixCellSchema, countTokenMatrix } from '../token/matrix.js';
import { GraphOperationSchema, toGraphOperations } from './operations.js';
import { selectSubtree } from './scope.js';

/**
 * Input schema for nodes.graph command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // Subtree root (inclusive); defaults to every tree
	includeOperations: z.boolean().optional().default(false), // Each node's own operations (or node.get one node's)
	token: z.string().min(1).optional(), // Exact token id to trace across the graph
});

const ChangeCountsSchema = z.object({
	add: z.number(),
	override: z.number(),
	subtract: z.number(),
	reset: z.number(),
	copy: z.number(),
	total: z.number(),
	/** Operation counts per token category, e.g. { color: { override: 54 } } */
	byCategory: z.record(z.string(), z.record(z.string(), z.number())),
});

const GraphNodeSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	status: z.string(),
	parentId: z.string().nullable(),
	depth: z.number(),
	/** True for include/copy sources outside the requested subtree */
	external: z.boolean(),
	includes: z.array(z.string()),
	includePolicy: z.string(),
	tags: z.array(z.string()),
	owner: z.string().optional(),
	/** A deprecated node's plan: the day it goes away and the node that replaces it */
	sunsetAt: z.string().optional(),
	replacedBy: z.string().optional(),
	childCount: z.number(),
	changes: ChangeCountsSchema,
	/** Tokens the node's subtract operations remove, one per operation, in sequence order */
	subtractedTokens: z.array(z.string()).optional(),
	operations: z.array(GraphOperationSchema).optional(),
});

/**
 * Edges point the way values flow: parent → child, included node → includer,
 * copy source → copier.
 */
const GraphEdgeSchema = z.object({
	kind: z.enum(['parent', 'include', 'copy']),
	from: z.string(),
	to: z.string(),
	tokens: z.array(z.object({ tokenId: z.string(), asTokenId: z.string().optional() })).optional(),
});

/**
 * Output schema for nodes.graph command
 */
const OutputSchema = z.object({
	roots: z.array(z.string()),
	nodes: z.array(GraphNodeSchema),
	edges: z.array(GraphEdgeSchema),
	trace: z
		.object({
			tokenId: z.string(),
			/** False when no node in the graph has or removes the token */
			found: z.boolean(),
			varies: z.boolean(),
			cells: z.record(z.string(), MatrixCellSchema),
		})
		.optional(),
	summary: z.object({
		nodes: z.number(),
		external: z.number(),
		maxDepth: z.number(),
		operations: z.number(),
		edges: z.object({ parent: z.number(), include: z.number(), copy: z.number() }),
	}),
});

type Output = z.infer<typeof OutputSchema>;
type GraphNode = Output['nodes'][number];
type GraphEdge = Output['edges'][number];

function countChanges(
	ops: OperationRecord[],
	definitions: Map<string, TokenDefinitionSite>,
): GraphNode['changes'] {
	const counts: Record<OperationType, number> = {
		add: 0,
		override: 0,
		subtract: 0,
		reset: 0,
		copy: 0,
	};
	const byCategory: Record<string, Record<string, number>> = {};
	for (const op of ops) {
		counts[op.type] += 1;
		const category = definitions.get(operationTarget(op))?.metadata.category ?? 'custom';
		const forCategory = byCategory[category] ?? {};
		forCategory[op.type] = (forCategory[op.type] ?? 0) + 1;
		byCategory[category] = forCategory;
	}
	return { ...counts, total: ops.length, byCategory };
}

/**
 * nodes.graph command
 *
 * The node hierarchy as a graph: parent, include (mixin) and copy edges, how
 * much each node changes relative to what it inherits, optionally each node's
 * own operations, and optionally one token traced across every node.
 */
export const nodesGraphCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'nodes.graph',
	description:
		'Get the node hierarchy as a graph with parent, include and copy edges, change counts, and an optional token trace',
	category: 'node',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const scope = await selectSubtree(db, input.rootId);
		// One cache for the graph's reads and the trace's resolution, which reads
		// the same operations, nodes and chains again (#116)
		const scoped = withResolutionCache(context);
		const cache = scoped.resolutionCache;
		if (!scope) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.rootId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}
		const scopeIds = new Set(scope.map((node) => node.id));

		const opsByNode = new Map<string, OperationRecord[]>();
		const getOps = async (nodeId: string) => {
			const ops = await cache.getOperations(nodeId);
			opsByNode.set(nodeId, ops);
			return ops;
		};

		// Edges into in-scope nodes; sources outside the scope become external nodes
		const edges: GraphEdge[] = [];
		const externalIds: string[] = [];
		const addSource = async (sourceId: string): Promise<boolean> => {
			if (scopeIds.has(sourceId) || externalIds.includes(sourceId)) return true;
			const source = await cache.getNode(sourceId);
			if (!source || source.deletedAt) return false;
			externalIds.push(sourceId);
			return true;
		};

		for (const node of scope) {
			if (node.parentId && scopeIds.has(node.parentId)) {
				edges.push({ kind: 'parent', from: node.parentId, to: node.id });
			}
			for (const includeId of node.includes ?? []) {
				if (await addSource(includeId)) {
					edges.push({ kind: 'include', from: includeId, to: node.id });
				}
			}
			// One copy edge per source node, listing the tokens copied from it
			const copies = new Map<string, NonNullable<GraphEdge['tokens']>>();
			for (const op of await getOps(node.id)) {
				if (op.type !== 'copy' || !op.fromNode) continue;
				const tokens = copies.get(op.fromNode) ?? [];
				tokens.push(
					op.asTokenId ? { tokenId: op.tokenId, asTokenId: op.asTokenId } : { tokenId: op.tokenId },
				);
				copies.set(op.fromNode, tokens);
			}
			for (const [fromNode, tokens] of copies) {
				if (await addSource(fromNode)) {
					edges.push({ kind: 'copy', from: fromNode, to: node.id, tokens });
				}
			}
		}

		const external: Node[] = [];
		for (const id of externalIds) {
			const node = await cache.getNode(id);
			if (node) external.push(node);
		}
		external.sort((a, b) => a.name.localeCompare(b.name));

		const childCounts = new Map<string, number>();
		for (const node of scope) {
			if (node.parentId && scopeIds.has(node.parentId)) {
				childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
			}
		}

		// Token categories come from definitions in the graph and the subtree's ancestors
		const ancestors = input.rootId ? await cache.getAncestryChain(input.rootId) : [];
		const definingIds = definitionOrder(
			ancestors,
			scope,
			external.map((node) => node.id),
		);
		for (const nodeId of definingIds) {
			await getOps(nodeId);
		}
		const definitions = collectDefinitions(definingIds, opsByNode);

		const nodes: GraphNode[] = [];
		for (const node of [...scope, ...external]) {
			const ops = await getOps(node.id);
			const entry: GraphNode = {
				id: node.id,
				name: node.name,
				type: node.type,
				status: node.status,
				parentId: node.parentId,
				depth: (await cache.getAncestryChain(node.id)).length,
				external: !scopeIds.has(node.id),
				includes: node.includes ?? [],
				includePolicy: node.includePolicy ?? 'merge',
				tags: node.tags ?? [],
				childCount: childCounts.get(node.id) ?? 0,
				changes: countChanges(ops, definitions),
			};
			if (node.owner) entry.owner = node.owner;
			if (node.sunsetAt) entry.sunsetAt = node.sunsetAt;
			if (node.replacedBy) entry.replacedBy = node.replacedBy;
			const subtracted = ops.filter((op) => op.type === 'subtract').map((op) => op.tokenId);
			if (subtracted.length > 0) entry.subtractedTokens = subtracted;
			if (input.includeOperations) {
				entry.operations = toGraphOperations(ops);
			}
			nodes.push(entry);
		}

		const roots = scope
			.filter((node) => !node.parentId || !scopeIds.has(node.parentId))
			.map((node) => node.id);

		let trace: Output['trace'];
		if (input.token) {
			// Walks every chain, but follows references and describes cells for this token only
			const matrix = await countTokenMatrix(scoped, [...scope, ...external], {
				tokenIds: [input.token],
			});
			const rows = await matrix.describe([input.token]);
			const cells = rows[0]?.cells ?? {};
			const values = Object.values(cells);
			trace = {
				tokenId: input.token,
				found: values.some((cell) => cell.state !== 'absent' || cell.source !== null),
				varies: rows[0]?.varies ?? false,
				cells,
			};
		}

		const edgeCounts = { parent: 0, include: 0, copy: 0 };
		for (const edge of edges) {
			edgeCounts[edge.kind] += 1;
		}
		const operations = nodes.reduce((sum, node) => sum + node.changes.total, 0);
		const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);
		const traceNote = trace
			? trace.found
				? `; traced '${trace.tokenId}'`
				: `; token '${trace.tokenId}' is not defined in this graph`
			: '';

		return success(
			{
				roots,
				nodes,
				edges,
				trace,
				summary: {
					nodes: nodes.length,
					external: external.length,
					maxDepth,
					operations,
					edges: edgeCounts,
				},
			},
			{
				reasoning: `${scope.length} node(s) in ${roots.length} tree(s) with ${edgeCounts.include} include and ${edgeCounts.copy} copy edge(s); ${external.length} external source(s)${traceNote}`,
				sources: nodes.map((node) => ({ type: 'node', id: node.id, title: node.name })),
			},
		);
	},

	examples: [
		{
			description: 'The whole hierarchy with change counts',
			input: {},
		},
		{
			description: 'The xbox subtree with each node’s own operations',
			input: { rootId: 'xbox', includeOperations: true },
		},
		{
			description: 'Trace one token through the hierarchy',
			input: { token: 'color.accent.primary' },
		},
	],
};
