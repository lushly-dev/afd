/**
 * @fileoverview Bounded undo helpers for Violet mutations (spec §5.7).
 */
import type {
	Constraint,
	OperationRecord,
	TokenMetadata,
	TokenValue,
} from '@lushly-dev/violet-core/types';

export interface BatchChangeInput {
	operation: 'add' | 'override' | 'reset';
	token: string;
	value?: TokenValue;
	metadata?: Partial<TokenMetadata>;
}

export interface UndoDescriptor {
	undoCommand: string;
	undoArgs: Record<string, unknown>;
}

/** Parse a JSON-serialized `OperationRecord.value` back into a `TokenValue`. */
export function parseOperationValue(raw: string | null): TokenValue | null {
	if (raw === null) return null;
	try {
		return JSON.parse(raw) as TokenValue;
	} catch {
		return raw;
	}
}

/** Parse a JSON-serialized `OperationRecord.metadata` into `Partial<TokenMetadata>`. */
export function parseOperationMetadata(raw: string | null): Partial<TokenMetadata> | undefined {
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== 'object') return undefined;
	const meta = parsed as Partial<TokenMetadata>;
	const out: Partial<TokenMetadata> = {};
	if (meta.type !== undefined) out.type = meta.type;
	if (meta.category !== undefined) out.category = meta.category;
	if (meta.tier !== undefined) out.tier = meta.tier;
	if (meta.description !== undefined) out.description = meta.description;
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Collapse all removed operations on one token to a single inverse change (spec §5.7).
 * Guarantees 1 change per reset token (<= 50 for any valid batch) and matches `export.tree`'s collapsing rule.
 */
export function collapseRemovedOperations(
	token: string,
	removedOps: readonly OperationRecord[]
): BatchChangeInput | null {
	const sorted = [...removedOps].sort((a, b) => a.sequence - b.sequence);
	if (sorted.length === 0) return null;
	const addOp = sorted.find((op) => op.type === 'add');
	const lastOp = sorted.at(-1);
	if (!lastOp) return null;
	const value = parseOperationValue(lastOp.value);
	if (value === null) return null;
	if (addOp) {
		const metadata = parseOperationMetadata(addOp.metadata);
		return {
			operation: 'add',
			token,
			value,
			...(metadata ? { metadata } : {}),
		};
	}
	return {
		operation: 'override',
		token,
		value,
	};
}

export function undoForOverride(
	document: string,
	node: string,
	token: string,
	inherited: boolean,
	oldValue: TokenValue
): UndoDescriptor {
	if (inherited) {
		return { undoCommand: 'violet-token-reset', undoArgs: { document, node, token } };
	}
	return {
		undoCommand: 'violet-token-override',
		undoArgs: { document, node, token, value: oldValue },
	};
}

export function undoForAdd(document: string, node: string, token: string): UndoDescriptor {
	return { undoCommand: 'violet-token-reset', undoArgs: { document, node, token } };
}

export function undoForReset(
	document: string,
	node: string,
	token: string,
	removedOps: readonly OperationRecord[]
): UndoDescriptor | undefined {
	const collapsed = collapseRemovedOperations(token, removedOps);
	if (!collapsed) return undefined;
	return {
		undoCommand: 'violet-change-apply',
		undoArgs: { document, node, changes: [collapsed] },
	};
}

export function undoForBatchApply(
	document: string,
	node: string,
	inverseChangesInForwardOrder: readonly BatchChangeInput[]
): UndoDescriptor {
	return {
		undoCommand: 'violet-change-apply',
		undoArgs: { document, node, changes: [...inverseChangesInForwardOrder].reverse() },
	};
}

export function undoForNodeCreate(document: string, node: string): UndoDescriptor {
	return { undoCommand: 'violet-node-delete', undoArgs: { document, node } };
}

export function undoForNodeDelete(
	document: string,
	parent: string | null,
	id: string,
	type: string
): UndoDescriptor {
	return {
		undoCommand: 'violet-node-create',
		undoArgs: { document, parent, id, type, restore: true },
	};
}

export function undoForConstraintSet(
	document: string,
	node: string,
	previous: readonly Constraint[]
): UndoDescriptor {
	return {
		undoCommand: 'violet-constraint-set',
		undoArgs: { document, node, constraints: [...previous], merge: false },
	};
}
