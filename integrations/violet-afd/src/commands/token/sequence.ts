import type { OperationRecord } from '@lushly-dev/violet-core/types';

/**
 * The sequence a node's next operation takes: one past the highest it holds.
 * Counting the operations instead would repeat a sequence once token.remove
 * has taken one out of the middle (#1328), and operations apply in sequence order.
 */
export function nextSequence(ops: readonly Pick<OperationRecord, 'sequence'>[]): number {
	return ops.reduce((max, op) => Math.max(max, op.sequence), 0) + 1;
}
