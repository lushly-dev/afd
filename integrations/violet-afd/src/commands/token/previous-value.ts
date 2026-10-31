import { InheritanceResolutionError, resolveNodeTokenMap } from '@lushly-dev/violet-core/engine';
import type { ResolvedToken } from '@lushly-dev/violet-core/types';
import type { CommandContext } from '../registry.js';

/**
 * What a token change replaced, for its audit event (#90): the value the node
 * resolved before the change, inherited or its own, and where it came from.
 */
interface PreviousValue {
	/** The value before the change as JSON; null when the node had no such token */
	oldValue: string | null;
	/** Audit metadata: the node the old value resolved at, and whether that is an ancestor's */
	metadata: { oldValueFrom?: string; inherited?: boolean };
}

export function previousValue(nodeId: string, previous: ResolvedToken | undefined): PreviousValue {
	if (!previous) {
		return { oldValue: null, metadata: {} };
	}
	return {
		oldValue: JSON.stringify(previous.value),
		metadata: { oldValueFrom: previous.resolvedAt, inherited: previous.resolvedAt !== nodeId },
	};
}

/**
 * previousValue for a token, resolving the node first. A node that cannot be
 * resolved (a cycle) records no old value rather than failing the change.
 */
export async function resolvePreviousValue(
	db: CommandContext['db'],
	nodeId: string,
	tokenId: string,
): Promise<PreviousValue> {
	try {
		return previousValue(nodeId, (await resolveNodeTokenMap(db, nodeId)).get(tokenId));
	} catch (error) {
		if (error instanceof InheritanceResolutionError) {
			return previousValue(nodeId, undefined);
		}
		throw error;
	}
}
