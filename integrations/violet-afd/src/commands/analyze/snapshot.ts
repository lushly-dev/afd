import {
	CheckCountsSchema,
	type CheckIssue,
	type CheckSnapshot,
	CheckSnapshotSchema,
} from '@lushly-dev/violet-core/types';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandResult } from '../../types/command-result.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { analyzeViolationsCommand } from './violations.js';

/**
 * Input schema for analyze.snapshot command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // Subtree to check; defaults to every tree
});

/**
 * Output schema for analyze.snapshot command
 */
const OutputSchema = z.object({
	/** The stored snapshot, without its issue list */
	snapshot: CheckSnapshotSchema.omit({ issues: true }),
	/** Against the previous snapshot of the same subtree, when there is one */
	change: z
		.object({
			previousAt: z.string(),
			previous: CheckCountsSchema,
			/** Issues open now that were not open then */
			introduced: z.number(),
			/** Issues open then that are not open now */
			fixed: z.number(),
		})
		.nullable(),
});

type Output = z.infer<typeof OutputSchema>;

/** One issue as a stable key, to tell snapshots apart */
export function issueKey(issue: CheckIssue): string {
	return `${issue.nodeId}\u0000${issue.tokenId}\u0000${issue.constraintId}`;
}

/** Issues in `next` that are not in `previous`, and the other way round */
export function compareIssues(
	previous: CheckIssue[],
	next: CheckIssue[],
): { introduced: number; fixed: number } {
	const before = new Set(previous.map(issueKey));
	const after = new Set(next.map(issueKey));
	return {
		introduced: [...after].filter((key) => !before.has(key)).length,
		fixed: [...before].filter((key) => !after.has(key)).length,
	};
}

/**
 * Check the rules on a subtree (or every tree) and store the result as a
 * snapshot taken at `takenAt`. The demo seed passes a past time to build
 * history; the command always records now.
 */
export async function recordCheckSnapshot(
	context: CommandContext,
	rootId: string | undefined,
	takenAt: string,
): Promise<CommandResult<Output>> {
	const scope = await selectSubtree(context.db, rootId);
	if (!scope) {
		return failure({
			code: ErrorCodes.NODE_NOT_FOUND,
			message: `Node '${rootId}' not found`,
			suggestion: `Use 'node.list' to see available nodes`,
		});
	}
	const checked = await analyzeViolationsCommand.handler({ rootId }, context);
	if (!checked.success || !checked.data) {
		return failure(
			checked.error ?? { code: ErrorCodes.INTERNAL_ERROR, message: 'Could not check the rules' },
		);
	}
	const { summary, violations } = checked.data;
	const snapshot: CheckSnapshot = {
		id: nanoid(),
		rootId: rootId ?? null,
		takenAt,
		nodes: scope.length,
		counts: {
			total: summary.total,
			error: summary.errors,
			warning: summary.warnings,
			info: summary.infos,
		},
		issues: violations.map((violation) => ({
			nodeId: violation.nodeId,
			tokenId: violation.tokenId,
			constraintId: violation.constraintId,
			severity: violation.severity,
		})),
		actor: context.actor ?? null,
	};

	const [previous] = await context.db.listCheckSnapshots({
		rootIds: [snapshot.rootId],
		until: takenAt,
		limit: 1,
	});
	await context.db.addCheckSnapshot(snapshot);

	const { issues: _issues, ...stored } = snapshot;
	const change = previous
		? {
				previousAt: previous.takenAt,
				previous: previous.counts,
				...compareIssues(previous.issues, snapshot.issues),
			}
		: null;
	const scopeText = rootId ? `'${rootId}' and its descendants` : 'every tree';
	return success(
		{ snapshot: stored, change },
		{
			reasoning: `Recorded ${snapshot.counts.total} open rule issue(s) on ${scopeText} (${scope.length} node(s))${
				change
					? `; since ${change.previousAt}: ${change.introduced} new, ${change.fixed} fixed`
					: '; the first snapshot of this subtree'
			}`,
		},
	);
}

/**
 * analyze.snapshot command
 *
 * Check the rules on a node and its descendants (or every tree) and store the
 * results, so `analyze.trends` can show true rule-check history: what was open
 * on each day, issues fixed since included. Run it on a schedule (for example
 * a daily CI job running `violet snapshot`).
 */
export const analyzeSnapshotCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'analyze.snapshot',
	description:
		'Check the rules on a node and its descendants and store the results, for rule-check history in analyze.trends',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const input = InputSchema.parse(rawInput);
		return recordCheckSnapshot(context, input.rootId, new Date().toISOString());
	},

	examples: [
		{ description: 'Record the rule checks across every tree', input: {} },
		{ description: 'Record the rule checks for the xbox subtree', input: { rootId: 'xbox' } },
	],
};
