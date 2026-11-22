import type { OperationRecord } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { contextId, contextNow } from '../context-sources.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { operationTarget } from './definitions.js';

/**
 * Input schema for token.remove command: one operation by id, or every one
 * the node holds on a token
 */
const InputSchema = z
	.object({
		nodeId: z.string().min(1),
		operationId: z.string().min(1).optional(),
		tokenId: z.string().min(1).optional(),
		/** Remove an add even when descendants still change the token it creates */
		force: z.boolean().default(false),
		reason: z.string().optional(),
	})
	.refine((input) => (input.operationId === undefined) !== (input.tokenId === undefined), {
		message: 'Give exactly one of operationId or tokenId',
	});

const RemovedOperationSchema = z.object({
	operationId: z.string(),
	type: z.string(),
	tokenId: z.string(),
	/** The value the operation set, parsed, for an add or an override */
	value: z.unknown().optional(),
});

/**
 * Output schema for token.remove command
 */
const OutputSchema = z.object({
	nodeId: z.string(),
	removed: z.array(RemovedOperationSchema),
});

type Output = z.infer<typeof OutputSchema>;

function parseValue(op: OperationRecord): unknown {
	if (op.value === null || op.value === undefined) return undefined;
	try {
		return JSON.parse(op.value);
	} catch {
		return op.value;
	}
}

/**
 * token.remove command
 *
 * Remove operations a node holds itself, as if they had never been written: the
 * undo of token.add (#1328). Unlike token.subtract, which records that a token is
 * taken away, and token.reset, which records a return to an ancestor's value, this
 * leaves no operation behind; the audit log keeps the record.
 */
export const tokenRemoveCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'token.remove',
	description:
		"Remove a node's own operation, by operationId or every one on a tokenId, as if never written (the undo of token.add)",
	category: 'token',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db, actor } = context;
		const input = InputSchema.parse(rawInput);

		const node = await db.getNode(input.nodeId);
		if (!node || node.deletedAt) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: node
					? `Node '${input.nodeId}' has been deleted`
					: `Node '${input.nodeId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		const own = await db.getOperations(input.nodeId);
		// A copy may rename the token it brings in, so match on the token it changes here
		const targets = input.operationId
			? own.filter((op) => op.id === input.operationId)
			: own.filter((op) => operationTarget(op) === input.tokenId);

		if (targets.length === 0) {
			return failure({
				code: input.operationId ? ErrorCodes.INVALID_OPERATION : ErrorCodes.TOKEN_NOT_FOUND,
				message: input.operationId
					? `Node '${input.nodeId}' has no operation '${input.operationId}'`
					: `Node '${input.nodeId}' has no operations of its own on '${input.tokenId}'`,
				suggestion: `Use 'node.get' with includeOperations to see the node's own operations`,
			});
		}

		// Removing an add takes the token away from every node that reads it: one that
		// still changes, copies, includes or references it would be left pointing at
		// a token that no longer exists
		const addedTokens = new Set(targets.filter((op) => op.type === 'add').map(operationTarget));
		if (addedTokens.size > 0 && !input.force) {
			const removing = new Set(targets.map((op) => op.id));
			const dependents = await dependentsOf(context, input.nodeId, addedTokens, removing);
			if (dependents.length > 0) {
				const names = dependents.map((entry) => `${entry.node} (${entry.why})`).join(', ');
				return failure({
					code: ErrorCodes.OPERATION_NOT_ALLOWED,
					message: `Other nodes still read ${[...addedTokens].map((id) => `'${id}'`).join(', ')}: ${names}`,
					suggestion: `Remove or change what each of ${[...new Set(dependents.map((entry) => entry.node))].join(', ')} holds on the token first ('token.remove' there), or pass force: true`,
				});
			}
		}

		const now = contextNow(context);
		// The removals and their audit records land together, or not at all, where the store can
		await db.transaction(async () => {
			for (const op of targets) {
				await db.removeOperation(op.id);
				await db.addAuditEvent({
					id: contextId(context),
					timestamp: now,
					eventType: 'operation_removed',
					actor: actor || 'system',
					targetNode: input.nodeId,
					targetToken: operationTarget(op),
					oldValue: op.value ?? null,
					newValue: null,
					metadata: JSON.stringify({
						reason: input.reason,
						operationId: op.id,
						operationType: op.type,
					}),
				});
			}
		});

		const removed = targets.map((op) => {
			const value = parseValue(op);
			return {
				operationId: op.id,
				type: op.type,
				tokenId: operationTarget(op),
				...(value === undefined ? {} : { value }),
			};
		});

		return success(
			{ nodeId: input.nodeId, removed },
			{
				reasoning:
					removed.length === 1
						? `Removed the ${removed[0]?.type} of '${removed[0]?.tokenId}' at '${input.nodeId}'`
						: `Removed ${removed.length} operations at '${input.nodeId}'`,
				sources: [{ type: 'node', id: input.nodeId, title: node.name }],
			},
		);
	},

	examples: [
		{
			description: 'Undo a token.add by the operationId it returned',
			input: { nodeId: 'xbox', operationId: 'V1StGXR8_Z5jdHi6B-myT' },
		},
		{
			description: "Take every one of a node's own changes to a token away",
			input: { nodeId: 'xbox', tokenId: 'color.xbox.green', reason: 'Added by mistake' },
		},
	],
};

/** Whether a stored value names `tokenId` as a reference, whole or inside a composite */
function referencesToken(value: unknown, tokenIds: ReadonlySet<string>): boolean {
	if (typeof value === 'string') {
		const alias = /^\{([^{}\s]+)\}$/.exec(value.trim());
		return alias !== null && tokenIds.has(alias[1] as string);
	}
	if (Array.isArray(value)) return value.some((item) => referencesToken(item, tokenIds));
	if (typeof value === 'object' && value !== null) {
		const record = value as Record<string, unknown>;
		if (typeof record.ref === 'string' && tokenIds.has(record.ref)) return true;
		return Object.values(record).some((item) => referencesToken(item, tokenIds));
	}
	return false;
}

/**
 * The nodes that read one of `tokenIds` from `nodeId`, by an operation the removal
 * leaves in place: a node that changes it and sees it (this node, a descendant, a
 * node that includes one of these, directly or through another include, and that
 * node's descendants), a node that copies it from here, and any node that sees it
 * and references it.
 */
async function dependentsOf(
	context: CommandContext,
	nodeId: string,
	tokenIds: ReadonlySet<string>,
	removing: ReadonlySet<string>,
): Promise<Array<{ node: string; why: string }>> {
	const { db } = context;
	const live = (await db.listNodes()).filter((node) => !node.deletedAt);
	const subtree = new Set([nodeId, ...(await db.getDescendants(nodeId)).map((node) => node.id)]);
	// Every node that sees this subtree's tokens: its descendants, nodes that include
	// any node already counted, and their descendants, until nothing more is added
	const reading = new Set(subtree);
	for (let grew = true; grew; ) {
		grew = false;
		for (const node of live) {
			if (reading.has(node.id) || !node.includes.some((id) => reading.has(id))) continue;
			for (const id of [node.id, ...(await db.getDescendants(node.id)).map((n) => n.id)]) {
				if (!reading.has(id)) {
					reading.add(id);
					grew = true;
				}
			}
		}
	}
	const found: Array<{ node: string; why: string }> = [];
	for (const node of live) {
		const reads = reading.has(node.id);
		for (const op of await db.getOperations(node.id)) {
			if (removing.has(op.id)) continue;
			const copies =
				op.type === 'copy' &&
				op.fromNode !== null &&
				subtree.has(op.fromNode) &&
				tokenIds.has(op.tokenId);
			const changes = reads && op.type !== 'subtract' && tokenIds.has(operationTarget(op));
			const why = copies
				? 'copies it'
				: changes
					? 'changes it'
					: reads && referencesToken(parseValue(op), tokenIds)
						? 'references it'
						: null;
			if (why) {
				found.push({ node: node.id, why });
				break;
			}
		}
	}
	return found;
}
