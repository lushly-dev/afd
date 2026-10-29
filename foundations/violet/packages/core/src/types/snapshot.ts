import { z } from 'zod';

/** Rule issues by severity */
export const CheckCountsSchema = z.object({
	total: z.number(),
	error: z.number(),
	warning: z.number(),
	info: z.number(),
});

export type CheckCounts = z.infer<typeof CheckCountsSchema>;

/** One open rule issue at the time of a snapshot */
export const CheckIssueSchema = z.object({
	nodeId: z.string(),
	tokenId: z.string(),
	constraintId: z.string(),
	severity: z.enum(['error', 'warning', 'info']),
});

export type CheckIssue = z.infer<typeof CheckIssueSchema>;

/**
 * The rule check results for a subtree at one moment (#117). The audit log
 * records changes, not check results, so snapshots are what history is made of:
 * `analyze.snapshot` records one, `analyze.trends` reads them back.
 */
export const CheckSnapshotSchema = z.object({
	id: z.string(),
	/** The subtree checked; null is every tree */
	rootId: z.string().nullable(),
	/** ISO time the check ran */
	takenAt: z.string(),
	/** Nodes checked */
	nodes: z.number(),
	counts: CheckCountsSchema,
	issues: z.array(CheckIssueSchema),
	/** Who recorded it */
	actor: z.string().nullable(),
});

export type CheckSnapshot = z.infer<typeof CheckSnapshotSchema>;

/** Snapshots taken in a time range, oldest first. `since` is inclusive, `until` exclusive. */
export interface CheckSnapshotQuery {
	/** Only snapshots of these subtrees; null in the list matches every-tree snapshots */
	rootIds?: Array<string | null>;
	since?: string;
	until?: string;
	/** Most snapshots returned, newest kept */
	limit?: number;
}
