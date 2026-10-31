import type { Node } from '@lushly-dev/violet-core/types';
import { TokenCategorySchema } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import {
	type MatrixCell,
	MatrixCellSchema,
	type MatrixNode,
	type MatrixRow,
	computeTokenMatrix,
} from './matrix.js';

/** Fewest and most nodes one comparison takes */
export const MIN_COMPARE_NODES = 2;
export const MAX_COMPARE_NODES = 4;

const InputSchema = z.object({
	// Nodes side by side, in order; the first is the baseline each cell is compared with
	nodeIds: z.array(z.string().min(1)).min(MIN_COMPARE_NODES).max(MAX_COMPARE_NODES),
	filter: z.string().optional(), // Glob pattern like "color.*"
	category: TokenCategorySchema.optional(), // Only tokens of this category
	onlyDifferent: z.boolean().optional().default(true), // Leave out tokens equal everywhere
});

const CompareCellSchema = MatrixCellSchema.extend({
	/** The value here differs from the baseline (the first node) */
	differs: z.boolean(),
});

const OutputSchema = z.object({
	nodes: z.array(
		z.object({
			id: z.string(),
			name: z.string(),
			type: z.string(),
			depth: z.number(),
			error: z.string().optional(),
		}),
	),
	/** The first node: each cell's `differs` compares with it */
	baseline: z.string(),
	tokens: z.array(
		z.object({
			id: z.string(),
			category: z.string(),
			tier: z.string(),
			/** Not every node has the same value */
			differs: z.boolean(),
			cells: z.record(z.string(), CompareCellSchema),
		}),
	),
	summary: z.object({
		/** Tokens compared (after filter and category), different or not */
		compared: z.number(),
		different: z.number(),
		identical: z.number(),
		/** Per category, in category order, over every compared token */
		categories: z.array(z.object({ id: z.string(), compared: z.number(), different: z.number() })),
		/** Each pair of nodes: how many tokens differ and the share that match (0–100) */
		pairs: z.array(
			z.object({
				nodes: z.tuple([z.string(), z.string()]),
				different: z.number(),
				similarity: z.number(),
			}),
		),
	}),
});

type Output = z.infer<typeof OutputSchema>;
export type CompareCell = z.infer<typeof CompareCellSchema>;
export type CompareRow = Output['tokens'][number];

/**
 * What a cell's value is, for comparing: its value with references followed in
 * that node, or a marker for "no value here". Unresolved nodes are left out.
 */
function comparisonKey(cell: MatrixCell): string | null {
	if (cell.state === 'unresolved') return null;
	if (cell.resolvedValue === undefined) return '∅';
	return JSON.stringify(cell.resolvedValue);
}

type Summary = Output['summary'];

/** The nodes to compare, in order, or why they can't be compared */
async function loadColumns(
	context: CommandContext,
	nodeIds: string[],
): Promise<{ columns: Node[] } | { error: Parameters<typeof failure>[0] }> {
	if (new Set(nodeIds).size !== nodeIds.length) {
		return {
			error: {
				code: ErrorCodes.VALIDATION_ERROR,
				message: 'nodeIds lists a node more than once',
				suggestion: `Pass ${MIN_COMPARE_NODES}–${MAX_COMPARE_NODES} different nodes`,
			},
		};
	}
	const columns: Node[] = [];
	for (const nodeId of nodeIds) {
		const node = await context.db.getNode(nodeId);
		if (!node || node.deletedAt) {
			return {
				error: {
					code: ErrorCodes.NODE_NOT_FOUND,
					message: `Node '${nodeId}' not found`,
					suggestion: `Use 'node.list' to see available nodes`,
				},
			};
		}
		columns.push(node);
	}
	return { columns };
}

/** One matrix row compared across `nodeIds`: whether it differs, and each cell against the baseline */
function compareRow(
	row: MatrixRow,
	nodeIds: string[],
): { row: CompareRow; keys: Map<string, string | null> } {
	const keys = new Map(nodeIds.map((id) => [id, comparisonKey(row.cells[id])]));
	const known = [...keys.values()].filter((key) => key !== null);
	const baseKey = keys.get(nodeIds[0]) ?? null;
	const cells: Record<string, CompareCell> = {};
	for (const id of nodeIds) {
		const key = keys.get(id) ?? null;
		cells[id] = { ...row.cells[id], differs: key !== null && baseKey !== null && key !== baseKey };
	}
	const differs = new Set(known).size > 1;
	return { row: { id: row.id, category: row.category, tier: row.tier, differs, cells }, keys };
}

/** Counts per category and per pair of nodes over every compared row */
function summarize(compared: ReturnType<typeof compareRow>[], nodeIds: string[]): Summary {
	const categories = new Map<string, Summary['categories'][number]>();
	for (const { row } of compared) {
		const category = categories.get(row.category) ?? {
			id: row.category,
			compared: 0,
			different: 0,
		};
		category.compared += 1;
		category.different += row.differs ? 1 : 0;
		categories.set(row.category, category);
	}
	const order = TokenCategorySchema.options as readonly string[];
	const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);

	const pairs = nodeIds.flatMap((a, i) =>
		nodeIds.slice(i + 1).map((b) => {
			const both = compared
				.map(({ keys }) => [keys.get(a), keys.get(b)])
				.filter(([x, y]) => x != null && y != null);
			const different = both.filter(([x, y]) => x !== y).length;
			const similarity =
				both.length === 0 ? 100 : Math.round(((both.length - different) / both.length) * 100);
			return { nodes: [a, b] as [string, string], different, similarity };
		}),
	);

	const different = compared.filter(({ row }) => row.differs).length;
	return {
		compared: compared.length,
		different,
		identical: compared.length - different,
		categories: [...categories.values()].sort(
			(a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id),
		),
		pairs,
	};
}

/** "3 of 40 token(s) differ across a, b (92% the same)" */
function describeResult(summary: Summary, nodes: MatrixNode[]): string {
	const unresolved = nodes.filter((node) => node.error).length;
	const unresolvedNote = unresolved > 0 ? `; ${unresolved} node(s) could not be resolved` : '';
	const closest = [...summary.pairs].sort((a, b) => b.similarity - a.similarity)[0];
	const pairNote =
		nodes.length > 2 && closest
			? `; closest pair ${closest.nodes.join(' and ')} (${closest.similarity}% the same)`
			: ` (${summary.pairs[0]?.similarity ?? 100}% the same)`;
	const ids = nodes.map((node) => node.id).join(', ');
	return `${summary.different} of ${summary.compared} token(s) differ across ${ids}${pairNote}${unresolvedNote}`;
}

/**
 * tokens.compare command
 *
 * Put two to four nodes side by side and report, per token, each node's value
 * (references followed), how it got there, and whether it differs from the
 * first node. Answers "why does Xbox dark look different from VS Code dark?"
 * and powers the Specimens compare view.
 */
export const tokensCompareCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'tokens.compare',
	description:
		'Compare 2–4 nodes token by token: each value, how it got there, and what differs from the first node',
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		const loaded = await loadColumns(context, input.nodeIds);
		if ('error' in loaded) {
			return failure(loaded.error);
		}

		const { nodes, rows } = await computeTokenMatrix(context, loaded.columns, {
			filter: input.filter,
			category: input.category,
		});
		const nodeIds = nodes.map((node) => node.id);
		const compared = rows.map((row) => compareRow(row, nodeIds));
		const summary = summarize(compared, nodeIds);
		const tokens = compared
			.map(({ row }) => row)
			.filter((row) => row.differs || !input.onlyDifferent);

		return success(
			{
				nodes: nodes.map(({ id, name, type, depth, error }) => ({
					id,
					name,
					type,
					depth,
					...(error ? { error } : {}),
				})),
				baseline: nodeIds[0],
				tokens,
				summary,
			},
			{
				reasoning: describeResult(summary, nodes),
				sources: nodes.map((node) => ({ type: 'node', id: node.id, title: node.name })),
			},
		);
	},

	examples: [
		{
			description: 'What differs between two dark themes',
			input: { nodeIds: ['xbox-dark', 'vscode-dark'] },
		},
		{
			description: 'Spacing tokens across three platforms, equal ones included',
			input: {
				nodeIds: ['xbox-ios', 'xbox-android', 'xbox-web'],
				category: 'spacing',
				onlyDifferent: false,
			},
		},
	],
};
