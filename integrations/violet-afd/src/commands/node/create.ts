import {
	CreateNodeInputSchema,
	IncludePolicySchema,
	type Node,
	NodeStatusSchema,
	NodeTypeSchema,
} from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { checkDeprecationPlan } from './deprecation.js';

/**
 * Input schema for node.create command
 */
const InputSchema = CreateNodeInputSchema;

/**
 * Output schema for node.create command
 */
const OutputSchema = z.object({
	node: z.object({
		id: z.string(),
		name: z.string(),
		parentId: z.string().nullable(),
		type: NodeTypeSchema,
		status: NodeStatusSchema,
		sunsetAt: z.string().nullable().optional(),
		replacedBy: z.string().nullable().optional(),
		includes: z.array(z.string()),
		includePolicy: IncludePolicySchema,
		tags: z.array(z.string()),
		createdAt: z.string(),
		updatedAt: z.string(),
	}),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * node.create command
 *
 * Creates a new node in the design system tree.
 */
export const nodeCreateCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'node.create',
	description: 'Create a new node in the design system tree',
	category: 'node',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Generate ID if not provided
		const nodeId = input.id || generateNodeId(input.name);

		// Check if node already exists
		const existing = await db.getNode(nodeId);
		if (existing) {
			return failure({
				code: ErrorCodes.NODE_ALREADY_EXISTS,
				message: `Node '${nodeId}' already exists`,
				suggestion: `Use 'node.update' to modify an existing node, or choose a different ID`,
			});
		}

		// Validate parent exists (if provided)
		if (input.parentId) {
			const parent = await db.getNode(input.parentId);
			if (!parent) {
				return failure({
					code: ErrorCodes.INVALID_PARENT,
					message: `Parent node '${input.parentId}' not found`,
					suggestion: 'Create the parent node first, or use null for a root node',
				});
			}

			// Check for circular reference (shouldn't happen on create, but be safe)
			const ancestry = await db.getAncestryChain(input.parentId);
			if (ancestry.includes(nodeId)) {
				return failure({
					code: ErrorCodes.CIRCULAR_REFERENCE,
					message: 'Creating this node would create a circular reference',
					suggestion: 'Check the node hierarchy',
				});
			}
		}

		// Validate includes exist
		for (const includeId of input.includes || []) {
			const includeNode = await db.getNode(includeId);
			if (!includeNode) {
				return failure({
					code: ErrorCodes.NODE_NOT_FOUND,
					message: `Include node '${includeId}' not found`,
					suggestion: 'Make sure all include nodes exist before creating this node',
				});
			}
		}

		const plan = await checkDeprecationPlan(db, nodeId, input);
		if ('error' in plan) return failure(plan.error);

		// Create the node
		const now = new Date().toISOString();
		const node: Node = {
			id: nodeId,
			name: input.name,
			parentId: input.parentId ?? null,
			type: input.type ?? 'custom',
			owner: input.owner,
			status: input.status ?? 'active',
			...(input.sunsetAt ? { sunsetAt: input.sunsetAt } : {}),
			...(input.replacedBy ? { replacedBy: input.replacedBy } : {}),
			includes: input.includes ?? [],
			includePolicy: input.includePolicy ?? 'merge',
			tags: input.tags ?? [],
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
		};

		await db.createNode(node);

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'node_created',
			actor: actor || 'system',
			targetNode: nodeId,
			targetToken: null,
			oldValue: null,
			newValue: JSON.stringify(node),
			metadata: null,
		});

		return success(
			{ node },
			{
				reasoning: `Created node '${nodeId}' ${
					input.parentId ? `as child of '${input.parentId}'` : 'as root node'
				}`,
				sources: [{ type: 'node', id: nodeId, title: node.name }],
				...(plan.warnings.length > 0 ? { warnings: plan.warnings } : {}),
			},
		);
	},

	examples: [
		{
			description: 'Create a root node',
			input: {
				name: 'global-base',
				type: 'root',
			},
		},
		{
			description: 'Create a product node',
			input: {
				name: 'xbox',
				parentId: 'global-base',
				type: 'product',
				owner: 'xbox-design@company.com',
			},
		},
		{
			description: 'Create a node with includes',
			input: {
				name: 'my-app',
				parentId: 'global-base',
				type: 'product',
				includes: ['accessibility-enhanced', 'motion-reduced'],
			},
		},
		{
			description: 'Create a deprecated node with a sunset date and its replacement',
			input: {
				name: 'legacy-theme',
				parentId: 'global-base',
				type: 'theme',
				status: 'deprecated',
				sunsetAt: '2027-03-31',
				replacedBy: 'modern-theme',
			},
		},
	],
};

/**
 * Generate a URL-safe node ID from name
 */
function generateNodeId(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}
