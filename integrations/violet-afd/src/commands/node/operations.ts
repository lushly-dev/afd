import type { OperationRecord } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { operationTarget } from '../token/definitions.js';

/**
 * A node's own operation as nodes.graph (`includeOperations`) and node.get
 * (`includeOperations`) list it: the stored record with its value parsed, and
 * whether a later operation on the node replaced it.
 */
export const GraphOperationSchema = z.object({
	sequence: z.number(),
	type: z.enum(['add', 'override', 'subtract', 'reset', 'copy']),
	tokenId: z.string(),
	value: z.any().optional(),
	fromNode: z.string().optional(),
	asTokenId: z.string().optional(),
	toAncestor: z.string().optional(),
	reason: z.string().optional(),
	author: z.string().optional(),
	createdAt: z.string(),
	/** Sequence of the later operation on this node that replaced this one for the same token */
	supersededBy: z.number().optional(),
	/** Copies only: true because later changes at `fromNode` show up here (read live) */
	tracksSource: z.boolean().optional(),
});

function parseValue(raw: string | null): unknown {
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

export type GraphOperation = z.infer<typeof GraphOperationSchema>;

function toGraphOperation(op: OperationRecord): GraphOperation {
	return {
		sequence: op.sequence,
		type: op.type,
		tokenId: op.tokenId,
		value: parseValue(op.value),
		fromNode: op.fromNode ?? undefined,
		asTokenId: op.asTokenId ?? undefined,
		toAncestor: op.toAncestor ?? undefined,
		reason: op.reason ?? undefined,
		author: op.author ?? undefined,
		createdAt: op.createdAt,
		tracksSource: op.type === 'copy' ? true : undefined,
	};
}

/**
 * A node's operations in sequence order, each marked with the later operation
 * that replaced it for the same token, so only the last change per token reads
 * as effective.
 */
export function toGraphOperations(ops: OperationRecord[]): GraphOperation[] {
	const result = ops.map(toGraphOperation);
	const latest = new Map<string, GraphOperation>();
	for (let i = ops.length - 1; i >= 0; i--) {
		const target = operationTarget(ops[i]);
		const later = latest.get(target);
		if (later) result[i].supersededBy = later.sequence;
		latest.set(target, result[i]);
	}
	return result;
}
