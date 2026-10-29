import { findDependencyPath } from '@lushly-dev/violet-core/engine';
import { NodeSchema, UpdateNodeInputSchema } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { checkDeprecationPlan } from './deprecation.js';

/**
 * Input schema for node.update command
 */
const InputSchema = z.object({
	id: z.string().min(1),
	updates: UpdateNodeInputSchema,
});

/**
 * Output schema for node.update command
 */
const OutputSchema = z.object({
	node: NodeSchema,
	changedFields: z.array(z.string()),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * node.update command
 *
 * Update a node's properties.
 */
export const nodeUpdateCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'node.update',
	description: 'Update a node in the design system tree',
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
				message: `Node '${input.id}' has been deleted`,
				suggestion: 'Deleted nodes cannot be updated. Contact an admin to restore.',
			});
		}

		// Validate includes if being updated
		if (input.updates.includes) {
			for (const includeId of input.updates.includes) {
				// Prevent self-reference
				if (includeId === input.id) {
					return failure({
						code: ErrorCodes.CIRCULAR_REFERENCE,
						message: 'Node cannot include itself',
						suggestion: `Remove '${input.id}' from the includes list`,
					});
				}

				const includeNode = await db.getNode(includeId);
				if (!includeNode) {
					return failure({
						code: ErrorCodes.NODE_NOT_FOUND,
						message: `Include node '${includeId}' not found`,
						suggestion: 'Make sure all include nodes exist',
					});
				}

				// Check for circular reference. Resolving a node depends on its parent
				// chain, its includes, and its copy sources, so the include would be
				// circular if input.id is reachable from includeId through ANY of those
				// edges (e.g. a parent including its own descendant).
				const cyclePath = await findDependencyPath(db, includeId, input.id);
				if (cyclePath) {
					return failure({
						code: ErrorCodes.CIRCULAR_REFERENCE,
						message: `Including '${includeId}' would create a circular reference`,
						suggestion: `'${includeId}' already depends on '${input.id}' (${cyclePath.join(' -> ')}) through parent, include, or copy relationships`,
					});
				}
			}
		}

		// The plan the node will have, so a write that leaves it alone still warns about it
		const plan = await checkDeprecationPlan(db, input.id, {
			sunsetAt: input.updates.sunsetAt === undefined ? node.sunsetAt : input.updates.sunsetAt,
			replacedBy:
				input.updates.replacedBy === undefined ? node.replacedBy : input.updates.replacedBy,
		});
		if ('error' in plan) return failure(plan.error);
		const warnings = [...plan.warnings];

		// Track what changed
		const changedFields: string[] = [];
		const oldNode = { ...node };

		// Apply updates
		const now = new Date().toISOString();
		const updates: Partial<typeof node> = {
			updatedAt: now,
		};

		if (input.updates.name !== undefined && input.updates.name !== node.name) {
			updates.name = input.updates.name;
			changedFields.push('name');
		}
		if (input.updates.type !== undefined && input.updates.type !== node.type) {
			updates.type = input.updates.type;
			changedFields.push('type');
		}
		if (input.updates.owner !== undefined && input.updates.owner !== node.owner) {
			updates.owner = input.updates.owner;
			changedFields.push('owner');
		}
		if (input.updates.status !== undefined && input.updates.status !== node.status) {
			updates.status = input.updates.status;
			changedFields.push('status');
		}
		if (
			input.updates.sunsetAt !== undefined &&
			input.updates.sunsetAt !== (node.sunsetAt ?? null)
		) {
			updates.sunsetAt = input.updates.sunsetAt;
			changedFields.push('sunsetAt');
		}
		if (
			input.updates.replacedBy !== undefined &&
			input.updates.replacedBy !== (node.replacedBy ?? null)
		) {
			updates.replacedBy = input.updates.replacedBy;
			changedFields.push('replacedBy');
		}
		if (
			input.updates.includes !== undefined &&
			JSON.stringify(input.updates.includes) !== JSON.stringify(node.includes)
		) {
			updates.includes = input.updates.includes;
			changedFields.push('includes');
		}
		if (
			input.updates.includePolicy !== undefined &&
			input.updates.includePolicy !== node.includePolicy
		) {
			updates.includePolicy = input.updates.includePolicy;
			changedFields.push('includePolicy');
		}
		if (
			input.updates.tags !== undefined &&
			JSON.stringify(input.updates.tags) !== JSON.stringify(node.tags)
		) {
			updates.tags = input.updates.tags;
			changedFields.push('tags');
		}

		if (changedFields.length === 0) {
			return success(
				{ node, changedFields: [] },
				{
					reasoning: 'No changes detected',
					...(warnings.length > 0 ? { warnings } : {}),
				},
			);
		}

		// Deprecating a node other nodes name as their replacement leaves them pointing at it
		if (updates.status === 'deprecated') {
			const replaced = (await db.listNodes())
				.filter((other) => other.replacedBy === input.id && !other.deletedAt)
				.map((other) => other.id);
			if (replaced.length > 0) {
				warnings.push({
					code: 'REPLACEMENT_DEPRECATED',
					message: `'${input.id}' is the replacement for ${replaced.join(', ')}, and is now deprecated itself`,
					severity: 'warning',
					details: { replaces: replaced },
				});
			}
		}

		await db.updateNode(input.id, updates);

		// Get updated node
		const updatedNode = await db.getNode(input.id);
		if (!updatedNode) {
			return failure({
				code: ErrorCodes.INTERNAL_ERROR,
				message: 'Failed to retrieve updated node',
			});
		}

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'node_updated',
			actor: actor || 'system',
			targetNode: input.id,
			targetToken: null,
			oldValue: JSON.stringify(oldNode),
			newValue: JSON.stringify(updatedNode),
			metadata: JSON.stringify({ changedFields }),
		});

		return success(
			{ node: updatedNode, changedFields },
			{
				reasoning: `Updated ${changedFields.length} field(s): ${changedFields.join(', ')}`,
				sources: [{ type: 'node', id: updatedNode.id, title: updatedNode.name }],
				...(warnings.length > 0 ? { warnings } : {}),
			},
		);
	},

	examples: [
		{
			description: 'Update node name',
			input: {
				id: 'xbox',
				updates: {
					name: 'Xbox Gaming',
				},
			},
		},
		{
			description: 'Update node status',
			input: {
				id: 'old-product',
				updates: {
					status: 'deprecated',
				},
			},
		},
		{
			description: 'Plan a deprecated node: the day it goes away and what replaces it',
			input: {
				id: 'old-product',
				updates: {
					status: 'deprecated',
					sunsetAt: '2027-03-31',
					replacedBy: 'new-product',
				},
			},
		},
		{
			description: 'Add includes to a node',
			input: {
				id: 'my-app',
				updates: {
					includes: ['accessibility-enhanced', 'motion-reduced'],
				},
			},
		},
	],
};
