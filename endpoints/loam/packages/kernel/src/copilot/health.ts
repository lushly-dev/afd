/**
 * @fileoverview Approval health (phase 5 specification, 6.3; D41's control-health signal): counters per person, project,
 * instance and command, reason and day, kept 90 days in the workspace store beside the person's other records. Each is
 * counted on the path of the call that caused it, or the journaled entry that ends it, so a replay that runs those calls
 * again into a fresh store counts them again; a call a replay answers from its entry is not (a follow-up). `expired` is never written: a confirmation expires by the clock, which no call marks, so it is what was asked
 * less what ended and what still waits.
 *
 * In the `late-copilot` chunk; it imports types alone.
 */

import type { DataAdapter } from '@lushly-dev/local-db';

/** The workspace store's table of counters (6.3). */
export const APPROVAL_HEALTH_TABLE = 'approval-health';
/** How long a day's counters are kept (6.3). */
export const HEALTH_DAYS = 90;
const DAY_MS = 86_400_000;

/** A `confirmRate` above this over {@link FLAG_ASKS} or more policy asks is flagged (6.3). */
export const FLAG_RATE = 0.95;
export const FLAG_ASKS = 50;

/** 6.3's counters. */
export interface ApprovalCountersV1 {
	acted: number;
	asked: number;
	confirmed: number;
	declined: number;
	expired: number;
	withdrawn: number;
	suggested: number;
	ranSuggestion: number;
}

export type HealthReasonV1 = 'policy' | 'taint' | 'unit';

/** What a count is about: one person's call of one command, in one project or none, for one reason, on one day. */
export interface HealthKeyV1 {
	person: string;
	project?: string | undefined;
	/** The command's instance, or `shell`. */
	instance: string;
	command: string;
	reason: HealthReasonV1;
	/** When it happened, or when the confirmation it ends was raised: its day keys the row. */
	at: number;
}

export interface ApprovalHealthRowV1 extends ApprovalCountersV1 {
	instance: string;
	command: string;
	reason: HealthReasonV1;
}

/** `approval-health-get`'s answer (6.3). */
export interface ApprovalHealthV1 {
	totals: ApprovalCountersV1;
	askRate: number | null;
	confirmRate: number | null;
	declineRate: number | null;
	rows: ApprovalHealthRowV1[];
	flags: Array<{ code: 'APPROVES_NEARLY_ALL'; instance: string; command: string; message: string }>;
}

type Written = Exclude<keyof ApprovalCountersV1, 'expired'>;

interface StoredRow extends Omit<ApprovalCountersV1, 'expired'> {
	id: string;
	workspace: string;
	person: string;
	day: number;
	project?: string;
	instance: string;
	command: string;
	reason: HealthReasonV1;
}

export const zeroCounters = (): ApprovalCountersV1 => ({
	acted: 0,
	asked: 0,
	confirmed: 0,
	declined: 0,
	expired: 0,
	withdrawn: 0,
	suggested: 0,
	ranSuggestion: 0,
});

const WRITTEN: readonly Written[] = [
	'acted',
	'asked',
	'confirmed',
	'declined',
	'withdrawn',
	'suggested',
	'ranSuggestion',
];

const dayOf = (at: number): number => Math.floor(at / DAY_MS);
const part = (value: string): string => encodeURIComponent(value);
const rowKey = (row: { instance: string; command: string; reason: string }) =>
	`${row.instance}\u0000${row.command}\u0000${row.reason}`;

export interface Health {
	/** Count one event, on the call's path. */
	bump(key: HealthKeyV1, field: Written): Promise<void>;
	/**
	 * The person's counters from `since` (a time), in `project` or every project, with `pending` the keys of the
	 * confirmations still waiting now, so `expired` is what was asked less what ended and what waits.
	 */
	read(
		person: string,
		filter: { project?: string | undefined; since?: number | undefined; now?: number | undefined },
		pending: readonly HealthKeyV1[]
	): Promise<ApprovalHealthV1>;
}

export function createHealth(deps: { store: DataAdapter; workspace: string }): Health {
	const { store, workspace } = deps;
	/** One write at a time: a count is a read and a write of its row. */
	let writing: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = writing.then(work, work);
		writing = run.catch(() => undefined);
		return run;
	};
	/** The last day each person's old rows were swept, so a sweep runs once a day at most. */
	const swept = new Map<string, number>();

	async function rowsOf(person: string): Promise<StoredRow[]> {
		const listed = await store.list<StoredRow>(APPROVAL_HEALTH_TABLE, { person } as never);
		return listed.data.filter((row) => row.person === person && row.workspace === workspace);
	}

	return {
		bump(key, field) {
			return serial(async () => {
				const day = dayOf(key.at);
				const id = [
					workspace,
					key.person,
					day,
					key.project ?? '-',
					key.instance,
					key.command,
					key.reason,
				]
					.map((each) => part(String(each)))
					.join('/');
				const held = await store.get<StoredRow>(APPROVAL_HEALTH_TABLE, id);
				if (held) {
					await store.update(APPROVAL_HEALTH_TABLE, id, {
						[field]: (held[field] ?? 0) + 1,
					} as never);
				} else {
					const { expired: _e, ...zero } = zeroCounters();
					const row: StoredRow = {
						id,
						workspace,
						person: key.person,
						day,
						...(key.project !== undefined ? { project: key.project } : {}),
						instance: key.instance,
						command: key.command,
						reason: key.reason,
						...zero,
						[field]: 1,
					};
					await store.create(APPROVAL_HEALTH_TABLE, row);
				}
				// Older than 90 days goes, once a day per person (6.3).
				if (swept.get(key.person) !== day) {
					swept.set(key.person, day);
					const old = (await rowsOf(key.person)).filter((row) => row.day <= day - HEALTH_DAYS);
					for (const row of old) await store.remove(APPROVAL_HEALTH_TABLE, row.id);
				}
			});
		},

		async read(person, filter, pending) {
			// 90 days by the reader's clock too (the review's improvement): no write may be needed to drop old rows.
			const oldest = filter.now === undefined ? undefined : dayOf(filter.now) - HEALTH_DAYS + 1;
			const asked = filter.since === undefined ? undefined : dayOf(filter.since);
			const from =
				oldest === undefined ? asked : asked === undefined ? oldest : Math.max(asked, oldest);
			const kept = (row: { project?: string | undefined; day: number }) =>
				(filter.project === undefined || row.project === filter.project) &&
				(from === undefined || row.day >= from);
			const rows = new Map<string, ApprovalHealthRowV1>();
			for (const row of (await rowsOf(person)).filter(kept)) {
				const at = rowKey(row);
				const sum = rows.get(at) ?? {
					instance: row.instance,
					command: row.command,
					reason: row.reason,
					...zeroCounters(),
				};
				for (const field of WRITTEN) sum[field] += row[field] ?? 0;
				rows.set(at, sum);
			}
			const waiting = new Map<string, number>();
			for (const key of pending) {
				if (key.person !== person || !kept({ project: key.project, day: dayOf(key.at) })) continue;
				waiting.set(rowKey(key), (waiting.get(rowKey(key)) ?? 0) + 1);
			}
			for (const [at, sum] of rows) {
				const ended = sum.confirmed + sum.declined + sum.withdrawn + (waiting.get(at) ?? 0);
				sum.expired = Math.max(0, sum.asked - ended);
			}
			const totals = zeroCounters();
			for (const sum of rows.values())
				for (const field of Object.keys(totals) as Array<keyof ApprovalCountersV1>)
					totals[field] += sum[field];
			const rate = (top: number, bottom: number) => (bottom === 0 ? null : top / bottom);
			// Per command, over its policy asks alone: no setting removes taint's or a unit's (6.3).
			const flags: ApprovalHealthV1['flags'] = [];
			for (const sum of rows.values()) {
				if (sum.reason !== 'policy' || sum.asked < FLAG_ASKS) continue;
				if (sum.confirmed / sum.asked <= FLAG_RATE) continue;
				flags.push({
					code: 'APPROVES_NEARLY_ALL',
					instance: sum.instance,
					command: sum.command,
					message: 'You approve nearly everything here. Consider letting it act',
				});
			}
			const listed = [...rows.values()].sort(
				(a, b) =>
					b.asked + b.acted + b.suggested - (a.asked + a.acted + a.suggested) ||
					(rowKey(a) < rowKey(b) ? -1 : 1)
			);
			return {
				totals,
				askRate: rate(totals.asked, totals.acted + totals.asked),
				confirmRate: rate(totals.confirmed, totals.asked),
				declineRate: rate(totals.declined, totals.asked),
				rows: listed,
				flags,
			};
		},
	};
}
