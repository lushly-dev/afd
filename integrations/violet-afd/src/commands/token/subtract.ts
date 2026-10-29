import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import type { ResolvedToken } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { previousValue } from './previous-value.js';

/**
 * Input schema for token.subtract command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	tokenId: z.string().min(1),
	reason: z.string().optional(),
});

/**
 * Output schema for token.subtract command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	tokenId: z.string(),
	operationId: z.string(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * token.subtract command
 *
 * Remove a token from a node (and its descendants).
 */
export const tokenSubtractCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.subtract',
	description: 'Remove a token from a node',
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

		// Subtracting a token that does not resolve at this node is a no-op that would
		// still be recorded (and audited as a deletion), so reject it.
		let previous: ResolvedToken | undefined;
		try {
			previous = (await resolveNodeTokenMap(db, input.nodeId)).get(input.tokenId);
			if (!previous) {
				return failure({
					code: ErrorCodes.TOKEN_NOT_FOUND,
					message: `Token '${input.tokenId}' not found in node '${input.nodeId}' or its ancestors`,
					suggestion: `Use 'tokens.resolve ${input.nodeId}' to see available tokens`,
				});
			}
		} catch (error) {
			if (error instanceof InheritanceResolutionError) {
				return failure({
					code: ErrorCodes.CIRCULAR_REFERENCE,
					message: error.message,
				});
			}
			throw error;
		}

		// Create the operation
		const existingOps = await db.getOperations(input.nodeId);
		const operationId = nanoid();
		const now = new Date().toISOString();

		await db.addOperation({
			id: operationId,
			nodeId: input.nodeId,
			sequence: existingOps.length + 1,
			type: 'subtract',
			tokenId: input.tokenId,
			value: null,
			metadata: null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: input.reason || null,
			author: actor || null,
			createdAt: now,
		});

		// Log audit event, with the value removed even when inherited (#90)
		const before = previousValue(input.nodeId, previous);
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'token_deleted',
			actor: actor || 'system',
			targetNode: input.nodeId,
			targetToken: input.tokenId,
			oldValue: before.oldValue,
			newValue: null,
			metadata: JSON.stringify({ reason: input.reason, ...before.metadata }),
		});

		return success(
			{
				nodeId: input.nodeId,
				tokenId: input.tokenId,
				operationId,
			},
			{
				reasoning: `Subtracted token '${input.tokenId}' from node '${input.nodeId}'`,
				sources: [
					{ type: 'node', id: input.nodeId, title: node.name },
					{ type: 'token', id: input.tokenId },
				],
			},
		);
	},

	examples: [
		{
			description: 'Remove monospace font from gaming UI',
			input: {
				nodeId: 'xbox',
				tokenId: 'typography.code.monospace',
				reason: 'Xbox gaming UI has no code display',
			},
		},
	],
};
