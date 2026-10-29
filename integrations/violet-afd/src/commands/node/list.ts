import { NodeSchema, type NodeTreeItem } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for node.list command
 */
const InputSchema = z.object({
	parentId: z.string().nullable().optional(),
	view: z.enum(['flat', 'tree']).optional().default('flat'),
	includeDeleted: z.boolean().optional().default(false),
	filter: z
		.object({
			type: z.string().optional(),
			status: z.string().optional(),
			tags: z.array(z.string()).optional(),
		})
		.optional(),
});

/**
 * Output schema for node.list command
 */
const OutputSchema = z.object({
	nodes: z.array(NodeSchema).optional(),
	tree: z
		.array(
			z.object({
				id: z.string(),
				name: z.string(),
				type: z.string(),
				status: z.string(),
				depth: z.number(),
				children: z.array(z.any()), // Recursive type
			}),
		)
		.optional(),
	total: z.number(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * node.list command
 *
 * List nodes, optionally filtered or as a tree view.
 */
export const nodeListCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'node.list',
	description: 'List nodes in the design system tree',
	category: 'node',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		let nodes = await db.listNodes(input.parentId);

		// Filter out deleted nodes unless requested
		if (!input.includeDeleted) {
			nodes = nodes.filter((n) => !n.deletedAt);
		}

		// Apply filters
		if (input.filter) {
			if (input.filter.type) {
				nodes = nodes.filter((n) => n.type === input.filter?.type);
			}
			if (input.filter.status) {
				nodes = nodes.filter((n) => n.status === input.filter?.status);
			}
			if (input.filter.tags && input.filter.tags.length > 0) {
				nodes = nodes.filter((n) => input.filter?.tags?.some((tag) => n.tags.includes(tag)));
			}
		}

		// Return appropriate view
		if (input.view === 'tree') {
			const tree = await buildTree(db, nodes);
			return success(
				{ tree, total: nodes.length },
				{
					reasoning: `Found ${nodes.length} nodes in tree view`,
				},
			);
		}

		return success(
			{ nodes, total: nodes.length },
			{
				reasoning: `Found ${nodes.length} nodes`,
			},
		);
	},

	examples: [
		{
			description: 'List all nodes',
			input: {},
		},
		{
			description: 'List children of a specific node',
			input: {
				parentId: 'global-base',
			},
		},
		{
			description: 'List as tree view',
			input: {
				view: 'tree',
			},
		},
		{
			description: 'Filter by type',
			input: {
				filter: {
					type: 'product',
				},
			},
		},
	],
};

/**
 * Build tree structure from flat node list
 */
async function buildTree(
	db: CommandContext['db'],
	_nodes: import('@lushly-dev/violet-core/types').Node[],
): Promise<NodeTreeItem[]> {
	// Get all nodes for tree building
	const allNodes = await db.listNodes();

	// Find root nodes (no parent or parent is null)
	const rootNodes = allNodes.filter((n) => !n.parentId && !n.deletedAt);

	// Recursive tree builder
	function buildSubtree(
		node: import('@lushly-dev/violet-core/types').Node,
		depth: number,
	): NodeTreeItem {
		const children = allNodes
			.filter((n) => n.parentId === node.id && !n.deletedAt)
			.map((child) => buildSubtree(child, depth + 1));

		return {
			id: node.id,
			name: node.name,
			type: node.type,
			status: node.status,
			depth,
			children,
		};
	}

	return rootNodes.map((root) => buildSubtree(root, 0));
}
