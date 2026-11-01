/**
 * @fileoverview The kernel's test kit, `@lushly-dev/loam-kernel/testing` (phase 0 specification,
 * 6.4, 6.7 and 8.2): `replayKernel`, `diffJournals`, the sessions and the reference workspace.
 * No DOM dependency.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import { type CommandContext, type JournalEntry, MemoryJournalSink } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	type JournalReplayTarget,
	type ReplayDifference,
	type ReplayReport,
	replayJournal,
} from '@lushly-dev/afd-server/direct';
import { MemoryAdapter } from '@lushly-dev/local-db';
import type { AppearanceV0 } from './appearance.js';
import { LoamKernelError } from './errors.js';
import { createKernelParts } from './kernel.js';
import type { LayoutStateV0 } from './layout.js';
import { createFixedEnvironment } from './session.js';
import type { KernelEnvironmentV0 } from './types.js';

export {
	createReferenceWorkspace,
	type ReferenceWorkspace,
	type ReferenceWorkspaceOptions,
} from './reference-workspace.js';
export {
	createFixedEnvironment,
	createSeededRandom,
	createSteppingClock,
	type RecordedSession,
	type RecordSessionOptions,
	recordSession,
	runSession,
	SESSION_50,
	type SessionCall,
} from './session.js';

// ─── Replay ─────────────────────────────────────────────────────────────────────

/**
 * Result paths replay leaves out: the timing, the environment-dependent results
 * (`appearance-*` `data.resolved`, `shell-info-get` `data.host` and `data.store`) and the Mock
 * session's timestamps. `MockAuthAdapter` derives the session and user ids from `Date.now()`,
 * so they are timestamps too.
 */
export const REPLAY_IGNORE: readonly string[] = Object.freeze([
	'metadata.executionTimeMs',
	'data.resolved',
	'data.host',
	'data.store',
	'data.session.id',
	'data.session.expiresAt',
	'data.user.id',
]);

export interface ReplayKernelOptions {
	/** The environment of the fresh kernel. Default: one that matches no media query. */
	environment?: KernelEnvironmentV0;
	/** Extra commands the recording kernel had (its `options.commands`). */
	commands?: ZodCommandDefinition[];
	/** Result paths left out besides {@link REPLAY_IGNORE}. */
	ignore?: readonly string[];
}

export interface ReplayKernelResult {
	report: ReplayReport;
	/** `layout-get` after the last entry. */
	layout: LayoutStateV0;
	/** `appearance-get` after the last entry. */
	appearance: AppearanceV0;
}

/** The first difference of a report, for a divergence message. */
function firstDivergence(report: ReplayReport) {
	const entry = report.entries.find((candidate) => candidate.status !== 'same');
	if (!entry) return undefined;
	const difference: ReplayDifference | undefined = entry.differences?.[0];
	return {
		seq: entry.seq,
		command: entry.command,
		status: entry.status,
		difference,
		error: entry.error,
	};
}

/**
 * Replay a kernel journal on a fresh kernel over an empty `MemoryAdapter`, a fresh
 * `MockAuthAdapter` and a fixed environment, with each entry's recorded tape, and compare every
 * result. Each entry runs through the registry of the interface it was recorded on.
 *
 * @throws LoamKernelError `REPLAY_START_INVALID` when the journal does not start at `seq` 1, since
 *   the state it starts from is not in it; `REPLAY_DIVERGED`, with the report and the first
 *   difference in `details`, when any entry differs
 */
export async function replayKernel(
	entries: readonly JournalEntry[],
	options: ReplayKernelOptions = {}
): Promise<ReplayKernelResult> {
	const ordered = [...entries].sort((a, b) => a.seq - b.seq);
	const first = ordered[0];
	if (first !== undefined && first.seq !== 1) {
		throw new LoamKernelError({
			code: 'REPLAY_START_INVALID',
			message: `The journal starts at seq ${first.seq}, not 1, so the state it starts from is not in it`,
			suggestion: 'Replay the whole journal from its first entry',
			details: { firstSeq: first.seq },
		});
	}
	const { kernel, registries } = await createKernelParts({
		store: new MemoryAdapter(),
		storeKind: 'memory',
		journal: new MemoryJournalSink(),
		auth: new MockAuthAdapter(),
		environment: options.environment ?? createFixedEnvironment(),
		host: 'test',
		...(options.commands !== undefined ? { commands: options.commands } : {}),
	});
	try {
		const target: JournalReplayTarget = {
			execute(name: string, input: unknown, context: CommandContext = {}) {
				const registry = context.interface === 'agent' ? registries.agent : registries.palette;
				return registry.execute(name, input, context);
			},
		};
		const report = await replayJournal(target, ordered, {
			ignore: [...REPLAY_IGNORE, ...(options.ignore ?? [])],
		});
		if (report.diverged) {
			const divergence = firstDivergence(report);
			const where = divergence?.difference?.path ? ` at ${divergence.difference.path}` : '';
			throw new LoamKernelError({
				code: 'REPLAY_DIVERGED',
				message: `Replay diverged at seq ${divergence?.seq} (${divergence?.command})${where}: ${
					divergence?.error ?? divergence?.difference?.kind ?? divergence?.status
				}`,
				suggestion: 'Read details.report for every entry that differs',
				details: { report, firstDifference: divergence },
			});
		}
		const layout = await kernel.call<LayoutStateV0>('layout-get');
		const appearance = await kernel.call<AppearanceV0>('appearance-get');
		return {
			report,
			layout: layout.data as LayoutStateV0,
			appearance: appearance.data as AppearanceV0,
		};
	} finally {
		await kernel.dispose();
	}
}

// ─── Journal diff (A3) ──────────────────────────────────────────────────────────

export type JournalDiffField = 'command' | 'input' | 'result' | 'success' | 'length';

export interface JournalDiff {
	equal: boolean;
	/** The first entry that differs, by position, and what differs in it. */
	firstDifference?: { index: number; field: JournalDiffField; path?: string };
	counts: { a: number; b: number; same: number; different: number };
}

export interface DiffJournalsOptions {
	/** Result paths left out besides {@link DIFF_IGNORE}, exact, with everything under them. */
	ignore?: readonly string[];
}

/**
 * Result paths `diffJournals` leaves out: the duration, the per-session trace ID, and the Mock
 * session's timestamps (its ids come from `Date.now()`).
 */
export const DIFF_IGNORE: readonly string[] = Object.freeze([
	'metadata.executionTimeMs',
	'metadata.traceId',
	'data.session.id',
	'data.session.expiresAt',
	'data.user.id',
]);

/** JSON with object keys sorted at every level, so key order never counts as a difference. */
function canonicalJson(value: unknown): string {
	const sort = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(sort);
		if (item && typeof item === 'object') {
			const record = item as Record<string, unknown>;
			return Object.fromEntries(
				Object.keys(record)
					.sort()
					.map((key) => [key, sort(record[key])])
			);
		}
		return item;
	};
	return JSON.stringify(sort(value)) ?? 'null';
}

function stripPaths(value: unknown, ignore: readonly string[]): unknown {
	const copy = JSON.parse(JSON.stringify(value ?? null)) as unknown;
	for (const path of ignore) {
		const keys = path.split('.');
		let target: unknown = copy;
		for (const key of keys.slice(0, -1)) {
			target =
				typeof target === 'object' && target !== null
					? (target as Record<string, unknown>)[key]
					: undefined;
		}
		if (typeof target === 'object' && target !== null) {
			delete (target as Record<string, unknown>)[keys[keys.length - 1] as string];
		}
	}
	return copy;
}

/** The first differing top-level-first path between two JSON values, or undefined. */
function firstPath(a: unknown, b: unknown, path = ''): string | undefined {
	if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
		const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
		for (const key of keys) {
			const found = firstPath(
				(a as Record<string, unknown>)[key],
				(b as Record<string, unknown>)[key],
				path === '' ? key : `${path}.${key}`
			);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	return canonicalJson(a ?? null) === canonicalJson(b ?? null) ? undefined : path;
}

/**
 * Compare two journals entry by entry on command, input, result and success, ignoring
 * timestamps and durations (and {@link DIFF_IGNORE}). Entries past the shorter journal count
 * as different, with `field: 'length'`.
 */
export function diffJournals(
	a: readonly JournalEntry[],
	b: readonly JournalEntry[],
	options: DiffJournalsOptions = {}
): JournalDiff {
	const ignore = [...DIFF_IGNORE, ...(options.ignore ?? [])];
	let same = 0;
	let different = 0;
	let firstDifference: JournalDiff['firstDifference'];
	const shared = Math.min(a.length, b.length);
	for (let index = 0; index < shared; index++) {
		const left = a[index] as JournalEntry;
		const right = b[index] as JournalEntry;
		let found: JournalDiff['firstDifference'];
		if (left.command !== right.command) found = { index, field: 'command' };
		else if (left.result.success !== right.result.success) found = { index, field: 'success' };
		else if (canonicalJson(left.input ?? null) !== canonicalJson(right.input ?? null)) {
			found = { index, field: 'input', path: firstPath(left.input, right.input) ?? '' };
		} else {
			const leftResult = stripPaths(left.result, ignore);
			const rightResult = stripPaths(right.result, ignore);
			if (canonicalJson(leftResult) !== canonicalJson(rightResult)) {
				found = { index, field: 'result', path: firstPath(leftResult, rightResult) ?? '' };
			}
		}
		if (found) {
			different++;
			firstDifference ??= found;
		} else {
			same++;
		}
	}
	if (a.length !== b.length) {
		different += Math.abs(a.length - b.length);
		firstDifference ??= { index: shared, field: 'length' };
	}
	return {
		equal: different === 0,
		...(firstDifference !== undefined ? { firstDifference } : {}),
		counts: { a: a.length, b: b.length, same, different },
	};
}
