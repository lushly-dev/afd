/**
 * @fileoverview The kernel's test kit, `@lushly-dev/loam-kernel/testing` (phase 0 specification,
 * 6.4, 6.7 and 8.2; phase 1 specification, 7.6): `replayKernel`, `diffJournals`, the sessions, the
 * reference workspace and the `probe` fixture app. No DOM dependency.
 */

import { MockAuthAdapter } from '@lushly-dev/afd-auth';
import {
	type CommandContext,
	type CommandResult,
	type JournalEntry,
	MemoryJournalSink,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	type JournalReplayTarget,
	type ReplayDifference,
	type ReplayEntryReport,
	type ReplayReport,
	replayJournal,
} from '@lushly-dev/afd-server/direct';
import type { ProjectionV3 } from '@lushly-dev/loam-manifest';
import { MemoryAdapter } from '@lushly-dev/local-db';
import type { AppearanceV0 } from './appearance.js';
import { BOOT_ONLY } from './commands.js';
import { LoamKernelError, PAGE_DECIDED } from './errors.js';
import { createKernelParts, type KernelPartsInternals } from './kernel.js';
import type { LayoutStateV0 } from './layout.js';
import { CALL_MARK } from './scope/runtime.js';
import { createFixedEnvironment } from './session.js';
import type { KernelEnvironmentV0, KernelPortsV1, LoamKernelV3 } from './types.js';

/** The link index, which A4 builds from the reference workspace's links (documents specification, 9.3). */
export { createDocumentIndex, type DocumentIndex, LINK_TABLE } from './late/links.js';
export {
	createReferenceWorkspace,
	type ReferenceDocumentType,
	type ReferenceWorkspace,
	type ReferenceWorkspaceOptions,
} from './reference-workspace.js';
export {
	createScopedWorkspace,
	DUAL_DEFINITION,
	DUAL_MANIFEST,
	SCOPED_PROJECTS,
	type ScopedWorkspace,
	type ScopedWorkspaceOptions,
	SOLO_DEFINITION,
	SOLO_MANIFEST,
	SOMEONE_ELSE,
	scopedDeployment,
	scopedPorts,
	seedProjects,
	TASKS_DEFINITION,
	TASKS_MANIFEST,
} from './scope/fixtures.js';
export {
	createFixedEnvironment,
	createSeededRandom,
	createSteppingClock,
	createTestKernel,
	type RecordedSession,
	type RecordSessionOptions,
	recordSession,
	runSession,
	SESSION_50,
	type SessionCall,
	type TestKernel,
	type TestKernelOptions,
} from './session.js';
export {
	documentsDeployment,
	documentsPorts,
	PROBE_DOCUMENTS_DEFINITION,
	PROBE_DOCUMENTS_MANIFEST,
} from './testing-documents.js';
export {
	createFixturePorts,
	type FixturePackage,
	type FixturePorts,
	PROBE_MANIFEST,
	PROBE_SESSION,
	probeDefinition,
	probeDeployment,
	probeViewManifest,
} from './testing-probe.js';

// ─── Replay ─────────────────────────────────────────────────────────────────────

/**
 * Result paths replay leaves out: the timing, the environment-dependent results
 * (`appearance-*` `data.resolved`, `shell-info-get` `data.host` and `data.store`) and the Mock
 * session's timestamps. `MockAuthAdapter` derives the session id from `Date.now()`, so it is a
 * timestamp too. Its user id comes from the email, so a replay compares it (phase 2 specification,
 * step 0b; the committed fixture was re-recorded by step 2).
 */
export const REPLAY_IGNORE: readonly string[] = Object.freeze([
	'metadata.executionTimeMs',
	'data.resolved',
	'data.host',
	'data.store',
	'data.session.id',
	'data.session.expiresAt',
]);

export interface ReplayKernelOptions {
	/** The environment of the fresh kernel. Default: one that matches no media query. */
	environment?: KernelEnvironmentV0;
	/** Extra commands the recording kernel had (its `options.commands`). */
	commands?: ZodCommandDefinition[];
	/** Result paths left out besides {@link REPLAY_IGNORE}. */
	ignore?: readonly string[];
	/**
	 * Keep the replayed kernel and return it as `kernel`, for a chrome to render; the caller
	 * disposes it. Added by step 7 for E2's replay fixture.
	 */
	keep?: boolean;
	/** The recording kernel's deployment. */
	deployment?: ProjectionV3;
	/** Ports that serve the deployment's packages in process, so a view replays with no iframe. */
	ports?: KernelPortsV1;
}

/** A replay's report, with the entries it answered from the record instead of running them. */
export interface KernelReplayReport extends ReplayReport {
	/** Their `seq`s, so nothing claims they re-ran. */
	recorded: number[];
}

export interface ReplayKernelResult {
	report: KernelReplayReport;
	/** `layout-get` after the last entry. */
	layout: LayoutStateV0;
	/** `appearance-get` after the last entry. */
	appearance: AppearanceV0;
	/** The replayed kernel, when `keep` was set; the caller disposes it. */
	kernel?: LoamKernelV3;
}

/**
 * Queries whose answers depend on what has loaded, not on a command, so a replay answers them from the
 * record (phase 1 specification, 7.6). `project-summary-get` too: a wall-clock deadline decided its rows,
 * and a summary that timed out left no nested entry to answer from (phase 2 specification, 7.7 and 10).
 */
export const REPLAY_RECORDED_QUERIES: readonly string[] = Object.freeze([
	'app-list',
	'app-get',
	'app-command-list',
	'app-instance-list',
	'project-summary-get',
]);

/** Whether a replay answers `entry` from its record, because re-running it would prove nothing. */
function answeredFromRecord(entry: JournalEntry): boolean {
	const details = entry.result.error?.details as Record<string, unknown> | undefined;
	return (
		REPLAY_RECORDED_QUERIES.includes(entry.command) ||
		entry.context?.replay === 'recorded' ||
		entry.context?.parent !== undefined ||
		details?.[PAGE_DECIDED] === true
	);
}

/**
 * Whether the validated input a journal holds is what `given` asks for. A schema may fill in a default,
 * so only what the call names must match.
 */
function sameCall(recorded: unknown, given: unknown): boolean {
	if (given === undefined) return true;
	if (Array.isArray(given)) {
		return (
			Array.isArray(recorded) &&
			recorded.length === given.length &&
			given.every((item, index) => sameCall(recorded[index], item))
		);
	}
	if (typeof given === 'object' && given !== null) {
		if (typeof recorded !== 'object' || recorded === null) return false;
		return Object.entries(given).every(([key, value]) =>
			sameCall((recorded as Record<string, unknown>)[key], value)
		);
	}
	return recorded === given;
}

/**
 * A handler's nested calls during a replay: answered from the entries with that `parent`, in order, and
 * what differs from them is kept against the outer call, whose result may not show it.
 */
/** @internal Exported for its unit test alone. */
export function nestedReplay(entries: readonly JournalEntry[]) {
	const byParent = new Map<string, JournalEntry[]>();
	for (const entry of entries) {
		const parent = entry.context?.parent;
		if (typeof parent !== 'string') continue;
		byParent.set(parent, [...(byParent.get(parent) ?? []), entry]);
	}
	// In the order the calls were made: `run` numbers a trace ID when a call starts, and the journal gives
	// it a `seq` when it finishes, so a handler's calls made together can be journaled in the other order.
	for (const queue of byParent.values()) queue.sort((a, b) => callNumber(a) - callNumber(b));
	const problems = new Map<string, string>();
	return {
		problems,
		/**
		 * The next call `parent` made, by its trace ID's number, when it is this one; undefined runs the call,
		 * as `KernelPartsInternals.answerNested` says, and a call out of order or with another input diverges.
		 */
		answer(parent: string, name: string, input: unknown): CommandResult | undefined {
			const queue = byParent.get(parent);
			const next = queue?.[0];
			if (next?.command !== name || !sameCall(next.input, input)) return undefined;
			queue?.shift();
			return next.result;
		},
		unrecorded(parent: string, name: string): void {
			problems.set(parent, `The handler called '${name}', which the journal does not record there`);
		},
		/** The outer call has finished: every call the record holds for it should have happened. */
		finish(parent: string): void {
			const left = byParent.get(parent)?.[0];
			if (left && !problems.has(parent)) {
				problems.set(
					parent,
					`The handler did not call '${left.command}', which the journal records`
				);
			}
		},
	};
}

/** The number `run` gave a call's trace ID, `<base>-<n>`, in the order calls start; else its `seq`. */
function callNumber(entry: JournalEntry): number {
	const n = Number(entry.traceId?.slice(entry.traceId.lastIndexOf('-') + 1));
	return Number.isInteger(n) ? n : entry.seq;
}

/** A replayed session ends where its trace IDs stop sharing their base: the page was reloaded. */
const traceBaseOf = (traceId: string | undefined): string | undefined =>
	traceId?.slice(0, traceId.lastIndexOf('-'));

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

/** The report with each entry whose nested calls differed marked `different`, even if its result did not. */
function withNestedProblems(
	report: ReplayReport,
	entries: readonly JournalEntry[],
	problems: ReadonlyMap<string, string>,
	recorded: number[]
): KernelReplayReport {
	const problemBySeq = new Map(
		entries.flatMap((entry) => {
			const problem = entry.traceId === undefined ? undefined : problems.get(entry.traceId);
			return problem === undefined ? [] : [[entry.seq, problem] as const];
		})
	);
	const reported = report.entries.map((entry): ReplayEntryReport => {
		const problem = problemBySeq.get(entry.seq);
		if (problem === undefined) return entry;
		return {
			...entry,
			status: 'different',
			differences: [
				...(entry.differences ?? []),
				{
					path: '',
					kind: 'changed',
					recorded: 'the nested calls in the journal',
					replayed: problem,
				},
			],
		};
	});
	const count = (status: ReplayEntryReport['status']) =>
		reported.filter((entry) => entry.status === status).length;
	return {
		...report,
		entries: reported,
		same: count('same'),
		different: count('different'),
		diverged: report.diverged || problemBySeq.size > 0,
		recorded,
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
	const nested = nestedReplay(ordered);
	const byTrace = new Map(ordered.map((entry) => [entry.traceId, entry]));
	// Shared with the kernel, which reads it at each call, so a kept kernel goes live when the replay ends.
	const internals: KernelPartsInternals = {
		answerNested: (parent, name, input) => nested.answer(parent, name, input),
		nestedUnrecorded: (parent, name) => nested.unrecorded(parent, name),
		replaying: true,
		// The journal's actor, whatever the replay's one Mock holds, so a refusal stays one (10).
		actorOf(traceId) {
			const entry = traceId === undefined ? undefined : byTrace.get(traceId);
			return entry ? { ...(entry.actor !== undefined ? { actor: entry.actor } : {}) } : undefined;
		},
	};
	const parts = await createKernelParts(
		{
			store: new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth: new MockAuthAdapter(),
			environment: options.environment ?? createFixedEnvironment(),
			host: 'test',
			...(options.commands !== undefined ? { commands: options.commands } : {}),
			...(options.deployment !== undefined ? { deployment: options.deployment } : {}),
			...(options.ports !== undefined ? { ports: options.ports } : {}),
		},
		internals
	);
	const { kernel } = parts;
	let kept = false;
	try {
		const recorded: number[] = [];
		let session = traceBaseOf(ordered[0]?.traceId);
		const target: JournalReplayTarget = {
			async execute(name: string, input: unknown, context: CommandContext = {}) {
				const base = traceBaseOf(context.traceId);
				if (base !== session) {
					session = base;
					await parts.resetSession();
				}
				const entry = byTrace.get(context.traceId);
				if (entry && answeredFromRecord(entry)) {
					recorded.push(entry.seq);
					if (entry.command === 'app-instance-refresh' && entry.result.success) {
						const { instance, catalog } = entry.result.data as {
							instance?: unknown;
							catalog?: unknown;
						};
						if (typeof instance === 'string') parts.applyCatalog(instance, catalog);
					}
					return entry.result;
				}
				// A call `run` made, as each entry was: the actor's changes replay as they ran (3.4).
				(context as Record<symbol, unknown>)[CALL_MARK] = 'run';
				const { registries } = parts;
				// Boot's own work is in a registry of its own, which only boot and a replay reach (2.2).
				const registry = BOOT_ONLY.includes(name)
					? registries.boot
					: context.interface === 'agent'
						? registries.agent
						: registries.palette;
				const result = await registry.execute(name, input, context);
				if (context.traceId !== undefined) nested.finish(context.traceId);
				return result;
			},
		};
		const report = withNestedProblems(
			await replayJournal(target, ordered, {
				ignore: [...REPLAY_IGNORE, ...(options.ignore ?? [])],
			}),
			ordered,
			nested.problems,
			recorded
		);
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
		// The replay is over: a kept kernel's calls are live ones, which no journal answers or refuses.
		internals.replaying = false;
		delete internals.answerNested;
		delete internals.nestedUnrecorded;
		delete internals.actorOf;
		kept = options.keep === true;
		return {
			report,
			layout: layout.data as LayoutStateV0,
			appearance: appearance.data as AppearanceV0,
			...(options.keep ? { kernel } : {}),
		};
	} finally {
		// A kept kernel is the caller's; one that diverged is disposed here all the same.
		if (!kept) await kernel.dispose();
	}
}

// ─── Journal diff (A3) ──────────────────────────────────────────────────────────

export type JournalDiffField = 'command' | 'input' | 'context' | 'result' | 'success' | 'length';

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
 * Result paths `diffJournals` leaves out: the duration, the per-session trace ID and the Mock
 * session's timestamps (its id comes from `Date.now()`). The user id comes from the email, so it is
 * compared.
 */
export const DIFF_IGNORE: readonly string[] = Object.freeze([
	'metadata.executionTimeMs',
	'metadata.traceId',
	'data.session.id',
	'data.session.expiresAt',
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
 * Compare two journals entry by entry on command, input, the journaled context fields, result and
 * success, ignoring
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
		} else if (canonicalJson(left.context ?? null) !== canonicalJson(right.context ?? null)) {
			// Two sessions that differ only in scope differ (phase 2 specification, 10).
			found = { index, field: 'context', path: firstPath(left.context, right.context) ?? '' };
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
