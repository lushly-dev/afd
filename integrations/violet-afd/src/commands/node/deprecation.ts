import type { Node } from '@lushly-dev/violet-core/types';
import type { CommandError, Warning } from '../../types/command-result.js';
import { ErrorCodes } from '../../types/command-result.js';
import type { Database } from '../registry.js';

/** A node's deprecation plan: the day it goes away and the node that replaces it */
export interface DeprecationPlan {
	sunsetAt?: string | null;
	replacedBy?: string | null;
}

/** An unusable plan stops the write; a doubtful one is stored with warnings */
export type PlanCheck = { error: CommandError } | { warnings: Warning[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from today (UTC) to a `YYYY-MM-DD` date; negative once it has passed */
export function daysUntil(date: string, now = Date.now()): number {
	const today = Date.parse(new Date(now).toISOString().slice(0, 10));
	return Math.round((Date.parse(date) - today) / DAY_MS);
}

/**
 * Check the plan a node will have after a write (#117). The replacement must
 * be another node that exists. A sunset date with no replacement, and a
 * replacement that is itself deprecated, are allowed but warned about: the
 * same cases `analyze.health` flags.
 */
export async function checkDeprecationPlan(
	db: Database,
	nodeId: string,
	plan: DeprecationPlan,
): Promise<PlanCheck> {
	const warnings: Warning[] = [];
	let replacement: Node | null = null;
	if (plan.replacedBy) {
		if (plan.replacedBy === nodeId) {
			return {
				error: {
					code: ErrorCodes.VALIDATION_ERROR,
					message: 'A node cannot replace itself',
					suggestion: 'Set replacedBy to the node that takes over from this one',
				},
			};
		}
		replacement = await db.getNode(plan.replacedBy);
		if (!replacement || replacement.deletedAt) {
			return {
				error: {
					code: ErrorCodes.NODE_NOT_FOUND,
					message: `Replacement node '${plan.replacedBy}' not found`,
					suggestion: `Use 'node.list' to see available nodes, or create the replacement first`,
				},
			};
		}
	}
	if (plan.sunsetAt && !plan.replacedBy) {
		warnings.push({
			code: 'SUNSET_WITHOUT_REPLACEMENT',
			message: `'${nodeId}' goes away on ${plan.sunsetAt}, but no node replaces it`,
			severity: 'warning',
			details: { sunsetAt: plan.sunsetAt },
		});
	}
	if (replacement?.status === 'deprecated') {
		warnings.push({
			code: 'REPLACEMENT_DEPRECATED',
			message: `The replacement '${replacement.id}' is itself deprecated`,
			severity: 'warning',
			details: {
				replacedBy: replacement.id,
				...(replacement.sunsetAt ? { replacementSunsetAt: replacement.sunsetAt } : {}),
			},
		});
	}
	return { warnings };
}
