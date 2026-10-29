import type { AuditEventType } from '@lushly-dev/violet-core/types';
import type { CheckIssue, CheckSnapshot } from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import { parseAuditTime } from '../audit/list.js';
import { selectSubtree } from '../node/scope.js';
import type { CommandContext, CommandDefinition } from '../registry.js';
import { compareIssues } from './snapshot.js';
import { type NodeViolation, analyzeViolationsCommand } from './violations.js';

/** Longest range `analyze.trends` reports, in days */
export const MAX_TREND_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Events that change a token on a node: add, override, copy, subtract, reset */
const TOKEN_EVENTS = new Set<AuditEventType>(['token_created', 'token_updated', 'token_deleted']);
/** Events that set a value, so a failing value dates from the latest one */
const VALUE_EVENTS: AuditEventType[] = ['token_created', 'token_updated'];

/**
 * Input schema for analyze.trends command
 */
const InputSchema = z.object({
	rootId: z.string().min(1).optional(), // The node and its descendants; defaults to every tree
	since: z.string().min(1).optional().default('90d'), // ISO date or time, or a span back from now
	until: z.string().min(1).optional(), // Same forms; defaults to now
	includeViolations: z.boolean().optional().default(true), // Date the open rule issues too
	includeHistory: z.boolean().optional().default(true), // Recorded rule checks (analyze.snapshot)
});

const SeverityCountsSchema = z.object({
	total: z.number(),
	error: z.number(),
	warning: z.number(),
	info: z.number(),
});

const TrendDaySchema = z.object({
	/** UTC day, `YYYY-MM-DD` */
	date: z.string(),
	/** Every audit event on the nodes that day */
	changes: z.number(),
	/** Token adds, overrides, copies, subtractions and resets */
	tokenChanges: z.number(),
	/** Open rule issues whose failing value was last set that day */
	introduced: SeverityCountsSchema.optional(),
	/** Open rule issues whose failing value was set by the end of that day */
	open: z.number().optional(),
	/** The rule check recorded that day (the day's last snapshot), when there is one */
	recorded: SeverityCountsSchema.extend({ takenAt: z.string() }).optional(),
});

/**
 * Output schema for analyze.trends command
 */
const OutputSchema = z.object({
	since: z.string(),
	until: z.string(),
	/** Every UTC day in the range, oldest first, including quiet days */
	days: z.array(TrendDaySchema),
	summary: z.object({
		/** Nodes counted: the root and its descendants, or every node */
		nodes: z.number(),
		changes: z.number(),
		tokenChanges: z.number(),
		byType: z.record(z.string(), z.number()),
		/** Rule issues open now; omitted when not checked */
		violations: z
			.object({
				open: SeverityCountsSchema,
				/** Failing value set before the range */
				before: z.number(),
				/** Failing value set within the range */
				during: z.number(),
				/** No audit event sets the failing value (e.g. data imported before auditing) */
				undated: z.number(),
			})
			.optional(),
		/**
		 * Recorded rule checks in the range (analyze.snapshot): true history, issues
		 * fixed since included. Snapshots of the subtree, an ancestor or every tree
		 * count, cut to the subtree's nodes. Omitted when not read.
		 */
		history: z
			.object({
				/** Days with a recorded check */
				days: z.number(),
				first: z.string().nullable(),
				last: z.string().nullable(),
				/** Issues open at the first and last recorded check */
				firstOpen: z.number(),
				lastOpen: z.number(),
				/** Issues that appeared, and that were fixed, from one recorded check to the next, summed */
				introduced: z.number(),
				fixed: z.number(),
			})
			.optional(),
	}),
});

type Output = z.infer<typeof OutputSchema>;
export type TrendDay = Output['days'][number];

function counts(): z.infer<typeof SeverityCountsSchema> {
	return { total: 0, error: 0, warning: 0, info: 0 };
}

/** Every UTC date from `since` up to (not including) `until` */
export function daysBetween(since: string, until: string): string[] {
	const dates: string[] = [];
	const end = Date.parse(until);
	for (let day = Date.parse(since.slice(0, 10)); day < end; day += DAY_MS) {
		dates.push(new Date(day).toISOString().slice(0, 10));
	}
	return dates;
}

/** When each open violation's failing value was last set, from the audit log */
async function dateViolations(
	context: CommandContext,
	violations: NodeViolation[],
): Promise<Map<NodeViolation, string | null>> {
	const setAt = new Map<string, string | null>();
	const dated = new Map<NodeViolation, string | null>();
	for (const violation of violations) {
		const key = `${violation.source}\u0000${violation.tokenId}`;
		if (!setAt.has(key)) {
			const page = await context.db.queryAuditEvents({
				nodeIds: [violation.source],
				tokenId: violation.tokenId,
				eventTypes: VALUE_EVENTS,
				limit: 1,
				offset: 0,
			});
			setAt.set(key, page.events[0]?.timestamp ?? null);
		}
		dated.set(violation, setAt.get(key) ?? null);
	}
	return dated;
}

/** Spread the open violations over the days their failing values were set */
function addViolations(
	days: TrendDay[],
	dated: Map<NodeViolation, string | null>,
	since: string,
): NonNullable<Output['summary']['violations']> {
	const open = counts();
	const byDate = new Map(days.map((day) => [day.date, day]));
	let before = 0;
	let undated = 0;
	for (const day of days) day.introduced = counts();
	for (const [violation, timestamp] of dated) {
		open.total += 1;
		open[violation.severity] += 1;
		if (!timestamp) undated += 1;
		else if (timestamp < since) before += 1;
		else {
			const introduced = byDate.get(timestamp.slice(0, 10))?.introduced;
			if (introduced) {
				introduced.total += 1;
				introduced[violation.severity] += 1;
			}
		}
	}
	let running = before;
	for (const day of days) {
		running += day.introduced?.total ?? 0;
		day.open = running;
	}
	return { open, before, during: running - before, undated };
}

/** A snapshot's issues on the scoped nodes only */
function scopedIssues(snapshot: CheckSnapshot, nodeIds: Set<string> | null): CheckIssue[] {
	return nodeIds ? snapshot.issues.filter((issue) => nodeIds.has(issue.nodeId)) : snapshot.issues;
}

/**
 * Put each day's last recorded check on the day, cut to the scoped nodes, and
 * count the issues that appeared and were fixed from one check to the next.
 */
function addHistory(
	days: TrendDay[],
	snapshots: CheckSnapshot[],
	nodeIds: Set<string> | null,
): NonNullable<Output['summary']['history']> {
	const byDate = new Map(days.map((day) => [day.date, day]));
	const lastOfDay = new Map<string, CheckSnapshot>();
	for (const snapshot of snapshots) lastOfDay.set(snapshot.takenAt.slice(0, 10), snapshot);
	const recorded: CheckIssue[][] = [];
	for (const [date, snapshot] of [...lastOfDay].sort(([a], [b]) => a.localeCompare(b))) {
		const day = byDate.get(date);
		if (!day) continue;
		const issues = scopedIssues(snapshot, nodeIds);
		recorded.push(issues);
		const tally = { ...counts(), takenAt: snapshot.takenAt };
		for (const issue of issues) {
			tally.total += 1;
			tally[issue.severity] += 1;
		}
		day.recorded = tally;
	}
	const firstDay = days.find((day) => day.recorded);
	const lastDay = [...days].reverse().find((day) => day.recorded);
	let introduced = 0;
	let fixed = 0;
	for (let i = 1; i < recorded.length; i++) {
		const step = compareIssues(recorded[i - 1], recorded[i]);
		introduced += step.introduced;
		fixed += step.fixed;
	}
	return {
		days: recorded.length,
		first: firstDay?.recorded?.takenAt ?? null,
		last: lastDay?.recorded?.takenAt ?? null,
		firstOpen: firstDay?.recorded?.total ?? 0,
		lastOpen: lastDay?.recorded?.total ?? 0,
		introduced,
		fixed,
	};
}

/**
 * analyze.trends command
 *
 * "Is it getting better or worse?" for a node and its descendants: changes per
 * day from the audit log, and the rule issues open now spread over the days
 * their failing values were last set. The audit log records changes, not past
 * check results, so an issue fixed since then is not counted on earlier days;
 * rule checks recorded with `analyze.snapshot` add that true history.
 */
export const analyzeTrendsCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'analyze.trends',
	description:
		'Changes per day, open rule issues by the day their value was set, and recorded rule checks, for a node and its descendants',
	category: 'analyze',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const now = Date.now();
		const since = parseAuditTime(input.since, now);
		const until = input.until ? parseAuditTime(input.until, now) : new Date(now).toISOString();
		if (!since || !until) {
			const bound = since ? 'until' : 'since';
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Invalid ${bound} '${input[bound]}'`,
				suggestion: 'Use an ISO date or time (2026-10-01) or a span back from now (30d, 12h, 2w)',
			});
		}
		const dates = daysBetween(since, until);
		if (dates.length === 0 || dates.length > MAX_TREND_DAYS) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `The range covers ${dates.length} day(s); trends take 1 to ${MAX_TREND_DAYS}`,
				suggestion: "Make 'since' earlier than 'until', and keep the range within a year",
			});
		}

		const scope = await selectSubtree(db, input.rootId);
		if (!scope) {
			return failure({
				code: ErrorCodes.NODE_NOT_FOUND,
				message: `Node '${input.rootId}' not found`,
				suggestion: `Use 'node.list' to see available nodes`,
			});
		}

		// Day counts cover every match, so one event is enough to page
		const audit = await db.queryAuditEvents({
			nodeIds: input.rootId ? scope.map((node) => node.id) : undefined,
			since,
			until,
			limit: 1,
			offset: 0,
		});
		const days: TrendDay[] = dates.map((date) => ({ date, changes: 0, tokenChanges: 0 }));
		const byDate = new Map(days.map((day) => [day.date, day]));
		const byType: Record<string, number> = {};
		for (const count of audit.days) {
			byType[count.eventType] = (byType[count.eventType] ?? 0) + count.count;
			const day = byDate.get(count.date);
			if (!day) continue;
			day.changes += count.count;
			if (TOKEN_EVENTS.has(count.eventType)) day.tokenChanges += count.count;
		}

		const summary: Output['summary'] = {
			nodes: scope.length,
			changes: audit.total,
			tokenChanges: days.reduce((sum, day) => sum + day.tokenChanges, 0),
			byType,
		};

		if (input.includeViolations) {
			const checked = await analyzeViolationsCommand.handler({ rootId: input.rootId }, context);
			if (!checked.success || !checked.data) {
				return failure(
					checked.error ?? {
						code: ErrorCodes.INTERNAL_ERROR,
						message: 'Could not check the rules',
					},
				);
			}
			const dated = await dateViolations(context, checked.data.violations);
			summary.violations = addViolations(days, dated, since);
		}

		if (input.includeHistory) {
			const covering: Array<string | null> = [null];
			if (input.rootId) {
				covering.push(...(await db.getAncestryChain(input.rootId)), input.rootId);
			}
			const snapshots = await db.listCheckSnapshots({ rootIds: covering, since, until });
			const nodeIds = input.rootId ? new Set(scope.map((node) => node.id)) : null;
			summary.history = addHistory(days, snapshots, nodeIds);
		}

		const recordedText =
			summary.history && summary.history.days > 0
				? `; ${summary.history.days} day(s) of recorded checks, ${summary.history.firstOpen} → ${summary.history.lastOpen} open`
				: '';
		const issues = summary.violations
			? `; ${summary.violations.open.total} open issue(s), ${summary.violations.during} set in the range`
			: '';
		return success(
			{ since, until, days, summary },
			{
				reasoning: `${summary.changes} change(s) on ${scope.length} node(s) over ${days.length} day(s)${issues}${recordedText}`,
			},
		);
	},

	examples: [
		{
			description: 'The last 90 days across the system',
			input: {},
		},
		{
			description: 'The xbox subtree over the last 4 weeks',
			input: { rootId: 'xbox', since: '4w' },
		},
	],
};
