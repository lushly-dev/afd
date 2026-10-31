import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { resolvePreviousValue } from './previous-value.js';

/**
 * Input schema for token.reset command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	tokenId: z.string().min(1),
	toAncestor: z.string().optional(), // Specific ancestor, defaults to parent
	reason: z.string().optional(),
});

/**
 * Output schema for token.reset command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	tokenId: z.string(),
	toAncestor: z.string(),
	operationId: z.string(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * token.reset command
 *
 * Reset a token to an ancestor's value, undoing local overrides.
 */
export const tokenResetCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.reset',
	description: "Reset a token to an ancestor's value",
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Verify node exists
		const node = await db.getNode(input.nodeId);
		if (!node) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		if (node.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.nodeId}' has been deleted`,
			});
		}

		// A reset only lands on an ancestor of the node; anything else would be a
		// stored no-op (see the reset rules in resolver.ts)
		if (!node.parentId) {
			return failure({
				code: ErrorCodes.INVALID_PARENT,
				message: `'${input.nodeId}' is a root node, so it has no ancestor to reset to`,
				suggestion: `Use 'token.override' or 'token.subtract' to change a root's token`,
			});
		}
		let targetAncestor = input.toAncestor;
		if (targetAncestor) {
			const ancestryChain = await db.getAncestryChain(input.nodeId);
			if (!ancestryChain.includes(targetAncestor)) {
				return failure({
					code: ErrorCodes.INVALID_PARENT,
					message: `'${targetAncestor}' is not an ancestor of '${input.nodeId}'`,
					suggestion: `Valid ancestors: ${ancestryChain.join(', ')}`,
				});
			}
		} else {
			// Default to parent
			targetAncestor = node.parentId;
		}

		// The value the reset replaces, even when inherited (#90)
		const before = await resolvePreviousValue(db, input.nodeId, input.tokenId);

		// Create the operation
		const existingOps = await db.getOperations(input.nodeId);
		const operationId = nanoid();
		const now = new Date().toISOString();

		await db.addOperation({
			id: operationId,
			nodeId: input.nodeId,
			sequence: existingOps.length + 1,
			type: 'reset',
			tokenId: input.tokenId,
			value: null,
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: targetAncestor,
			reason: input.reason || null,
			author: actor || null,
			createdAt: now,
		});

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'token_updated',
			actor: actor || 'system',
			targetNode: input.nodeId,
			targetToken: input.tokenId,
			oldValue: before.oldValue,
			newValue: JSON.stringify({ reset: true, toAncestor: targetAncestor }),
			metadata: JSON.stringify({ reason: input.reason, ...before.metadata }),
		});

		return success(
			{
				nodeId: input.nodeId,
				tokenId: input.tokenId,
				toAncestor: targetAncestor,
				operationId,
			},
			{
				reasoning: `Reset token '${input.tokenId}' at '${input.nodeId}' to value from '${targetAncestor}'`,
				sources: [
					{ type: 'node', id: input.nodeId, title: node.name },
					{ type: 'token', id: input.tokenId },
				],
			},
		);
	},

	examples: [
		{
			description: 'Reset to parent value',
			input: {
				nodeId: 'xbox-experimental',
				tokenId: 'color.accent.primary',
				reason: 'Experiment concluded, reverting',
			},
		},
		{
			description: 'Reset to specific ancestor',
			input: {
				nodeId: 'xbox-ios-dark',
				tokenId: 'spacing.base',
				toAncestor: 'global-base',
				reason: 'Re-aligning with brand guidelines',
			},
		},
	],
};
