import {
	type AuditDayCount,
	type AuditEvent,
	AuditEventTypeSchema,
} from '@lushly-dev/violet-core/types';
import { z } from 'zod';
import { ErrorCodes, failure, success } from '../../types/command-result.js';
import type { CommandContext, CommandDefinition } from '../registry.js';

/** Largest page `audit.list` returns; page through longer histories with `offset` */
export const MAX_AUDIT_PAGE = 500;

/**
 * Input schema for audit.list command
 */
const InputSchema = z.object({
	nodeId: z.string().min(1).optional(), // Events on this node (deleted nodes keep their history)
	subtree: z.boolean().optional().default(false), // Also events on the node's descendants
	tokenId: z.string().min(1).optional(), // Events on this exact token id
	eventTypes: z.array(AuditEventTypeSchema).min(1).optional(), // Any of these event types
	actor: z.string().min(1).optional(), // Who made the change
	since: z.string().min(1).optional(), // ISO time or date, or a span back from now: 30d, 12h, 2w
	until: z.string().min(1).optional(), // Same forms; events before this time
	limit: z.number().int().min(1).max(MAX_AUDIT_PAGE).optional().default(50),
	offset: z.number().int().min(0).optional().default(0),
});

const AuditEntrySchema = z.object({
	id: z.string(),
	timestamp: z.string(),
	eventType: AuditEventTypeSchema,
	actor: z.string(),
	targetNode: z.string(),
	targetToken: z.string().optional(),
	oldValue: z.any().optional(),
	newValue: z.any().optional(),
	metadata: z.any().optional(),
});

/**
 * Output schema for audit.list command
 */
const OutputSchema = z.object({
	events: z.array(AuditEntrySchema),
	/** Matching events per UTC day, oldest first, across every page */
	days: z.array(
		z.object({
			date: z.string(),
			count: z.number(),
			byType: z.record(z.string(), z.number()),
		}),
	),
	summary: z.object({
		total: z.number(),
		byType: z.record(z.string(), z.number()),
		/** Time range applied, as ISO timestamps */
		since: z.string().optional(),
		until: z.string().optional(),
		/** Nodes whose events were included, when filtering by node */
		nodes: z.array(z.string()).optional(),
	}),
	page: z.object({
		offset: z.number(),
		limit: z.number(),
		returned: z.number(),
		/** Offset of the next page, or null on the last one */
		nextOffset: z.number().nullable(),
	}),
});

type Output = z.infer<typeof OutputSchema>;
export type AuditEntry = Output['events'][number];

const SPAN_UNITS: Record<string, number> = {
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
	w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Read a time bound: a span back from `now` (`30d`, `12h`, `2w`) or anything
 * `Date.parse` accepts (`2026-10-01`, `2026-10-01T12:00:00Z`). Null when it is
 * neither.
 */
export function parseAuditTime(value: string, now: number = Date.now()): string | null {
	const span = /^(\d+)\s*([hdw])$/i.exec(value.trim());
	if (span) {
		return new Date(now - Number(span[1]) * SPAN_UNITS[span[2].toLowerCase()]).toISOString();
	}
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function parseJson(raw: string | null): unknown {
	if (raw === null) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function toEntry(event: AuditEvent): AuditEntry {
	const entry: AuditEntry = {
		id: event.id,
		timestamp: event.timestamp,
		eventType: event.eventType,
		actor: event.actor,
		targetNode: event.targetNode,
	};
	if (event.targetToken) entry.targetToken = event.targetToken;
	const oldValue = parseJson(event.oldValue);
	if (oldValue !== undefined) entry.oldValue = oldValue;
	const newValue = parseJson(event.newValue);
	if (newValue !== undefined) entry.newValue = newValue;
	const metadata = parseJson(event.metadata);
	if (metadata !== undefined) entry.metadata = metadata;
	return entry;
}

/** Both time bounds as ISO timestamps, or which one could not be read */
function resolveRange(input: {
	since?: string;
	until?: string;
}): { since?: string; until?: string } | { invalid: 'since' | 'until' } {
	const now = Date.now();
	const range: { since?: string; until?: string } = {};
	for (const bound of ['since', 'until'] as const) {
		const raw = input[bound];
		if (raw === undefined) continue;
		const parsed = parseAuditTime(raw, now);
		if (!parsed) return { invalid: bound };
		range[bound] = parsed;
	}
	return range;
}

/** Per-day totals (oldest first) and per-type totals from the store's day × type counts */
function groupDays(counts: AuditDayCount[]): {
	days: Output['days'];
	byType: Record<string, number>;
} {
	const byDate = new Map<string, Output['days'][number]>();
	const byType: Record<string, number> = {};
	for (const day of counts) {
		const entry = byDate.get(day.date) ?? { date: day.date, count: 0, byType: {} };
		entry.count += day.count;
		entry.byType[day.eventType] = (entry.byType[day.eventType] ?? 0) + day.count;
		byDate.set(day.date, entry);
		byType[day.eventType] = (byType[day.eventType] ?? 0) + day.count;
	}
	return { days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), byType };
}

/**
 * audit.list command
 *
 * Query the audit log every write command already records: filter by node
 * (optionally with its subtree), token, event type, actor and time range, page
 * through the matches newest first, and count them per day. The day counts
 * cover every match, not only the page, so they can drive a trend line.
 */
export const auditListCommand: CommandDefinition<typeof InputSchema, Output> = {
	name: 'audit.list',
	description:
		'Query the audit log by node, token, event type, actor and time range, with counts per day',
	category: 'audit',
	inputSchema: InputSchema,
	outputSchema: OutputSchema,

	async handler(rawInput, context: CommandContext) {
		const { db } = context;

		// Parse input to apply defaults
		const input = InputSchema.parse(rawInput);

		const range = resolveRange(input);
		if ('invalid' in range) {
			return failure({
				code: ErrorCodes.VALIDATION_ERROR,
				message: `Invalid ${range.invalid} '${input[range.invalid]}'`,
				suggestion: 'Use an ISO date or time (2026-10-01) or a span back from now (30d, 12h, 2w)',
			});
		}

		let nodeIds: string[] | undefined;
		if (input.nodeId) {
			nodeIds = [input.nodeId];
			if (input.subtree) {
				const node = await db.getNode(input.nodeId);
				if (!node) {
					return failure({
						code: ErrorCodes.NODE_NOT_FOUND,
						message: `Node '${input.nodeId}' not found`,
						suggestion: `Use 'node.list' to see available nodes, or drop 'subtree' to read a removed node's history`,
					});
				}
				nodeIds.push(...(await db.getDescendants(input.nodeId)).map((child) => child.id));
			}
		}

		const page = await db.queryAuditEvents({
			nodeIds,
			tokenId: input.tokenId,
			eventTypes: input.eventTypes,
			actor: input.actor,
			...range,
			limit: input.limit,
			offset: input.offset,
		});

		const { days, byType } = groupDays(page.days);

		const end = input.offset + page.events.length;
		const scope = input.nodeId
			? ` on ${input.nodeId}${input.subtree ? ` and ${(nodeIds?.length ?? 1) - 1} descendant(s)` : ''}`
			: '';

		return success(
			{
				events: page.events.map(toEntry),
				days,
				summary: {
					total: page.total,
					byType,
					...range,
					...(nodeIds ? { nodes: nodeIds } : {}),
				},
				page: {
					offset: input.offset,
					limit: input.limit,
					returned: page.events.length,
					nextOffset: end < page.total ? end : null,
				},
			},
			{
				reasoning: `${page.total} event(s)${scope} over ${days.length} day(s); showing ${page.events.length > 0 ? `${input.offset + 1}–${end}` : 'none'}`,
			},
		);
	},

	examples: [
		{
			description: 'The latest changes anywhere',
			input: {},
		},
		{
			description: 'Changes to the xbox subtree in the last 30 days',
			input: { nodeId: 'xbox', subtree: true, since: '30d' },
		},
		{
			description: 'Token changes and removals by one actor, second page',
			input: {
				eventTypes: ['token_updated', 'token_deleted'],
				actor: 'cli',
				limit: 50,
				offset: 50,
			},
		},
	],
};
