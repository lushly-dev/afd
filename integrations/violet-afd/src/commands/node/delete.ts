import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for node.delete command
 */
const InputSchema = z.object({
	id: z.string().min(1),
	reason: z.string().optional(),
	force: z.boolean().optional().default(false), // Force delete even if has children
});

/**
 * Output schema for node.delete command
 */
const OutputSchema = z.object({
	id: z.string(),
	deletedAt: z.string(),
	cascade: z.boolean(),
	affectedNodes: z.array(z.string()).optional(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * node.delete command
 *
 * Soft-delete a node (marks as deleted, doesn't remove from database).
 */
export const nodeDeleteCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'node.delete',
	description: 'Delete a node from the design system tree (soft delete)',
	category: 'node',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const node = await db.getNode(input.id);

		if (!node) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.id}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		if (node.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.id}' is already deleted`,
				suggestion: `The node was deleted at ${node.deletedAt}`,
			});
		}

		// Check for children
		const descendants = await db.getDescendants(input.id);
		const activeDescendants = descendants.filter((d) => !d.deletedAt);

		if (activeDescendants.length > 0 && !input.force) {
			return failure(
				{
					code: ErrorCodes.NODE_HAS_CHILDREN,
					message: `Node '${input.id}' has ${activeDescendants.length} child node(s)`,
					suggestion: 'Delete child nodes first, or use --force to cascade delete',
				},
				{
					warnings: [
						{
							code: 'HAS_CHILDREN',
							message: `Child nodes: ${activeDescendants.map((d) => d.id).join(', ')}`,
							severity: 'warning',
						},
					],
				},
			);
		}

		const now = new Date().toISOString();
		const affectedNodes: string[] = [input.id];

		// Soft delete the node
		await db.updateNode(input.id, { deletedAt: now });

		// Cascade delete if forced
		if (input.force && activeDescendants.length > 0) {
			for (const descendant of activeDescendants) {
				await db.updateNode(descendant.id, { deletedAt: now });
				affectedNodes.push(descendant.id);
			}
		}

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'node_deleted',
			actor: actor || 'system',
			targetNode: input.id,
			targetToken: null,
			oldValue: JSON.stringify(node),
			newValue: null,
			metadata: JSON.stringify({
				reason: input.reason,
				cascade: input.force,
				affectedNodes,
			}),
		});

		return success(
			{
				id: input.id,
				deletedAt: now,
				cascade: input.force && activeDescendants.length > 0,
				affectedNodes: affectedNodes.length > 1 ? affectedNodes : undefined,
			},
			{
				reasoning:
					affectedNodes.length > 1
						? `Deleted '${input.id}' and ${affectedNodes.length - 1} descendant(s)`
						: `Deleted '${input.id}'`,
				warnings:
					affectedNodes.length > 1
						? [
								{
									code: 'CASCADE_DELETE',
									message: `${affectedNodes.length - 1} descendant(s) were also deleted`,
									severity: 'warning',
								},
							]
						: undefined,
			},
		);
	},

	examples: [
		{
			description: 'Delete a node',
			input: {
				id: 'old-product',
				reason: 'No longer maintained',
			},
		},
		{
			description: 'Force delete with children',
			input: {
				id: 'deprecated-product',
				reason: 'Removing entire product line',
				force: true,
			},
		},
	],
};
