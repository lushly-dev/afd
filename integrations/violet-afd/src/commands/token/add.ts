import { validateTokenId } from '@lushly-dev/violet-core/engine';
import {
	InheritanceResolutionError,
	resolveAncestorTokenMap,
} from '@lushly-dev/violet-core/engine';
import { TokenMetadataSchema, TokenValueSchema } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/**
 * Input schema for token.add command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	tokenId: z.string().min(1),
	value: TokenValueSchema,
	metadata: TokenMetadataSchema.optional(),
	reason: z.string().optional(),
});

/**
 * Output schema for token.add command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	tokenId: z.string(),
	value: TokenValueSchema,
	operationId: z.string(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * token.add command
 *
 * Add a new token to a node. The token must not exist in ancestors.
 */
export const tokenAddCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.add',
	description: 'Add a new token to a node',
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Reject ids that could reach Object.prototype when exported as object keys
		const tokenIdError = validateTokenId(input.tokenId);
		if (tokenIdError) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: tokenIdError,
				suggestion: "Avoid the path segments '__proto__', 'constructor' and 'prototype'",
			});
		}

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

		// Check if token already exists in this node's operations
		const existingOps = await db.getOperations(input.nodeId);
		const existingAdd = existingOps.find((op) => op.tokenId === input.tokenId && op.type === 'add');
		if (existingAdd) {
			return failure({
				code: ErrorCodes.TOKEN_ALREADY_EXISTS,
				message: `Token '${input.tokenId}' already exists at node '${input.nodeId}'`,
				suggestion: `Use 'token.override' to change an existing token's value`,
			});
		}

		// The token must not already be provided by an ancestor: an add op for an id that
		// is already resolved is ignored by the resolver, so reject it instead of
		// silently doing nothing.
		try {
			const inherited = await resolveAncestorTokenMap(db, node.parentId);
			if (inherited.has(input.tokenId)) {
				return failure({
					code: ErrorCodes.TOKEN_ALREADY_EXISTS,
					message: `Token '${input.tokenId}' already exists in an ancestor of node '${input.nodeId}'`,
					suggestion: `Use 'token.override' to change an inherited token's value`,
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
		const operationId = nanoid();
		const now = new Date().toISOString();

		await db.addOperation({
			id: operationId,
			nodeId: input.nodeId,
			sequence: existingOps.length + 1,
			type: 'add',
			tokenId: input.tokenId,
			value: JSON.stringify(input.value),
			metadata: input.metadata ? JSON.stringify(input.metadata) : null,
			fromNode: null,
			asTokenId: null,
			toAncestor: null,
			reason: input.reason || null,
			author: actor || null,
			createdAt: now,
		});

		// Log audit event
		await db.addAuditEvent({
			id: nanoid(),
			timestamp: now,
			eventType: 'token_created',
			actor: actor || 'system',
			targetNode: input.nodeId,
			targetToken: input.tokenId,
			oldValue: null,
			newValue: JSON.stringify({
				value: input.value,
				metadata: input.metadata,
			}),
			metadata: JSON.stringify({ reason: input.reason }),
		});

		return success(
			{
				nodeId: input.nodeId,
				tokenId: input.tokenId,
				value: input.value,
				operationId,
			},
			{
				reasoning: `Added token '${input.tokenId}' to node '${input.nodeId}'`,
				sources: [
					{ type: 'node', id: input.nodeId, title: node.name },
					{ type: 'token', id: input.tokenId },
				],
			},
		);
	},

	examples: [
		{
			description: 'Add a color token',
			input: {
				nodeId: 'xbox',
				tokenId: 'color.xbox.green',
				value: '#107C10',
			},
		},
		{
			description: 'Add a spacing token',
			input: {
				nodeId: 'xbox',
				tokenId: 'spacing.controller.padding',
				value: '24px',
				reason: 'Larger padding for controller UI',
			},
		},
	],
};
