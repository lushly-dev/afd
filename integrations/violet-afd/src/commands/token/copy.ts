import { validateTokenId } from '@lushly-dev/violet-core/engine';
import { findDependencyPath } from '@lushly-dev/violet-core/engine';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { resolvePreviousValue } from './previous-value.js';

/**
 * Input schema for token.copy command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1),
	tokenId: z.string().min(1),
	fromNode: z.string().min(1),
	asTokenId: z.string().optional(), // Rename if copying to a different name
	reason: z.string().optional(),
});

/**
 * Output schema for token.copy command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	tokenId: z.string(),
	fromNode: z.string(),
	fromTokenId: z.string(),
	operationId: z.string(),
});

type Output = z.infer<typeof OutputSchema>;

/**
 * token.copy command
 *
 * Copy a token's value from another node (not necessarily an ancestor).
 */
export const tokenCopyCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.copy',
	description: "Copy a token's value from another node",
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		// Reject ids that could reach Object.prototype when exported as object keys
		const tokenIdError = validateTokenId(input.asTokenId || input.tokenId);
		if (tokenIdError) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: tokenIdError,
				suggestion: "Avoid the path segments '__proto__', 'constructor' and 'prototype'",
			});
		}

		// Verify target node exists
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

		// Verify source node exists
		const sourceNode = await db.getNode(input.fromNode);
		if (!sourceNode) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Source node '${input.fromNode}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		if (sourceNode.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Source node '${input.fromNode}' has been deleted`,
			});
		}

		// A node resolves its copy sources through the same inheritance resolver it
		// is being resolved by, so copying from the node itself (under any token id)
		// is always self-referential.
		if (input.nodeId === input.fromNode) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Cannot copy a token from node '${input.nodeId}' to itself`,
				suggestion: 'Choose a different source node, or use token.add/token.override on this node',
			});
		}

		// Reject copies that would close a loop (e.g. A <- B then B <- A, or copying
		// from a descendant of the target). The source must not depend on the target
		// through parent, include, or existing copy relationships.
		const cyclePath = await findDependencyPath(db, input.fromNode, input.nodeId);
		if (cyclePath) {
			return failure({
				code: ErrorCodes.CIRCULAR_REFERENCE,
				message: `Copying from '${input.fromNode}' to '${input.nodeId}' would create a circular reference`,
				suggestion: `'${input.fromNode}' already depends on '${input.nodeId}' (${cyclePath.join(' -> ')})`,
			});
		}

		const targetTokenId = input.asTokenId || input.tokenId;
		// The value the copy replaces, when the node already had the token (#90)
		const before = await resolvePreviousValue(db, input.nodeId, targetTokenId);

		// Create the operation
		const existingOps = await db.getOperations(input.nodeId);
		const operationId = nanoid();
		const now = new Date().toISOString();

		await db.addOperation({
			id: operationId,
			nodeId: input.nodeId,
			sequence: existingOps.length + 1,
			type: 'copy',
			// For copy operations `tokenId` is the SOURCE token on `fromNode`; the id the
			// value lands under on this node is `asTokenId` (or `tokenId` when not renamed).
			// The resolver looks the source up by `tokenId` and stores it as `asTokenId`.
			tokenId: input.tokenId,
			value: null,
			metadata: null,
			fromNode: input.fromNode,
			asTokenId: input.asTokenId || null,
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
			targetToken: targetTokenId,
			oldValue: before.oldValue,
			newValue: JSON.stringify({
				copy: true,
				fromNode: input.fromNode,
				fromTokenId: input.tokenId,
			}),
			metadata: JSON.stringify({ reason: input.reason, ...before.metadata }),
		});

		return success(
			{
				nodeId: input.nodeId,
				tokenId: targetTokenId,
				fromNode: input.fromNode,
				fromTokenId: input.tokenId,
				operationId,
			},
			{
				reasoning: `Copied '${input.tokenId}' from '${input.fromNode}' to '${
					input.nodeId
				}'${input.asTokenId ? ` as '${input.asTokenId}'` : ''}`,
				sources: [
					{ type: 'node', id: input.nodeId, title: node.name },
					{ type: 'node', id: input.fromNode, title: sourceNode.name },
					{ type: 'token', id: input.tokenId },
				],
			},
		);
	},

	examples: [
		{
			description: 'Copy accent color from VS Code to Azure',
			input: {
				nodeId: 'azure',
				tokenId: 'color.accent.primary',
				fromNode: 'vscode',
				reason: 'Aligning Azure accent with VS Code',
			},
		},
		{
			description: 'Copy and rename',
			input: {
				nodeId: 'xbox',
				tokenId: 'color.brand.primary',
				fromNode: 'global-base',
				asTokenId: 'color.xbox.signature',
				reason: 'Creating Xbox-specific alias',
			},
		},
	],
};
