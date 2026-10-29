import { validateTokenId } from '@lushly-dev/violet-core/engine';
import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import { type ResolvedToken, TokenValueSchema } from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { previousValue } from './previous-value.js';

/**
 * Input schema for token.override command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	tokenId: z.string().min(1),
	value: TokenValueSchema,
	reason: z.string().optional(),
});

/**
 * Output schema for token.override command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	tokenId: z.string(),
	oldValue: TokenValueSchema.optional(),
	newValue: TokenValueSchema,
	operationId: z.string(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * token.override command
 *
 * Override an inherited token's value at a specific node.
 */
export const tokenOverrideCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.override',
	description: "Override an inherited token's value",
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

		// The token must exist (inherited, included, copied or added here); overriding an
		// unknown id would otherwise create a phantom token.
		let previous: ResolvedToken | undefined;
		try {
			previous = (await resolveNodeTokenMap(db, input.nodeId)).get(input.tokenId);
			if (!previous) {
				return failure({
					code: ErrorCodes.TOKEN_NOT_FOUND,
					message: `Token '${input.tokenId}' not found in node '${input.nodeId}' or its ancestors`,
					suggestion: `Use 'token.add' to create a new token, or 'tokens.resolve' to see available tokens`,
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

		// The old value is what the node resolved before, even when inherited (#90)
		const existingOps = await db.getOperations(input.nodeId);
		const hadOverride = existingOps.some(
			(op) => op.tokenId === input.tokenId && op.type === 'override',
		);
		const before = previousValue(input.nodeId, previous);

		// Create the operation
		const operationId = nanoid();
		const now = new Date().toISOString();

		await db.addOperation({
			id: operationId,
			nodeId: input.nodeId,
			sequence: existingOps.length + 1,
			type: 'override',
			tokenId: input.tokenId,
			value: JSON.stringify(input.value),
			metadata: null,
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
			eventType: 'token_updated',
			actor: actor || 'system',
			targetNode: input.nodeId,
			targetToken: input.tokenId,
			oldValue: before.oldValue,
			newValue: JSON.stringify(input.value),
			metadata: JSON.stringify({ reason: input.reason, ...before.metadata }),
		});

		return success(
			{
				nodeId: input.nodeId,
				tokenId: input.tokenId,
				oldValue: previous.value,
				newValue: input.value,
				operationId,
			},
			{
				reasoning: hadOverride
					? `Updated override for '${input.tokenId}' at '${input.nodeId}'`
					: `Created override for '${input.tokenId}' at '${input.nodeId}'`,
				sources: [
					{ type: 'node', id: input.nodeId, title: node.name },
					{ type: 'token', id: input.tokenId },
				],
			},
		);
	},

	examples: [
		{
			description: 'Override accent color for Xbox',
			input: {
				nodeId: 'xbox',
				tokenId: 'color.accent.primary',
				value: '#107C10',
				reason: 'Xbox brand requires green accent',
			},
		},
		{
			description: 'Override spacing for iOS',
			input: {
				nodeId: 'xbox-ios',
				tokenId: 'spacing.base',
				value: '4px',
				reason: 'iOS HIG requires tighter spacing',
			},
		},
	],
};
