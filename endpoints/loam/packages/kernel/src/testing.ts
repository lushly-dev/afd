/**
 * @fileoverview The kernel's test kit, `@lushly-dev/loam-kernel/testing` (phase 0 specification,
 * 6.4, 6.7 and 8.2; phase 1 specification, 7.6): `replayKernel`, `diffJournals`, the sessions, the
 * reference workspace and the `probe` fixture app. No DOM dependency.
 */

import {
	MockAuthAdapter,
	type SignInOptions,
	type SignInOutcome,
	type User,
} from '@lushly-dev/afd-auth';
import {
	type CommandContext,
	type CommandResult,
	type JournalEntry,
	type JournalRecord,
	MemoryJournalSink,
	seededRandom,
} from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	type JournalReplayTarget,
	type ReplayDifference,
	type ReplayEntryReport,
	type ReplayReport,
	replayJournal,
} from '@lushly-dev/afd-server/direct';
import type { IdentityV1, ProjectionV4 } from '@lushly-dev/loam-manifest';
import { type DataAdapter, MemoryAdapter } from '@lushly-dev/local-db';
import * as z from 'zod/mini';
import type { AppearanceV0 } from './appearance.js';
import { oversizedInput } from './apps/mounted.js';
import { BOOT_ONLY } from './commands.js';
import { DOCUMENT_INPUT_MAX_BYTES } from './documents/document-types.js';
import { LoamKernelError, PAGE_DECIDED } from './errors.js';
import { type NestedRerunV1, RECORDED_ANSWER, type RecordedAnswerV1 } from './journal-order.js';
import {
	createKernelParts,
	KERNEL_OWN,
	type KernelParts,
	type KernelPartsInternals,
	redactJournalRecord,
} from './kernel.js';
import type { LayoutStateV0 } from './layout.js';
import type { LimitKeyV1 } from './limits.js';
import { REPLAY_RECORDED_QUERIES, recordedCommand } from './replay-recorded.js';
import type { MembershipV1 } from './scope/access.js';
import { CALL_MARK } from './scope/runtime.js';
import { createFixedEnvironment } from './session.js';
import type { KernelEnvironment, KernelPorts, LoamKernel } from './types.js';

/** The link index, which A4 builds from the reference workspace's links (documents specification, 9.3). */
export { createDocumentIndex, type DocumentIndex, LINK_TABLE } from './documents/links.js';
/**
 * The commands no server serves over MCP (phase 3 specification, 3.4 and 9.5; phase 2's `PERSON_SESSION`), for the
 * hosted server's unit that holds its served list clear of them (phase 6 specification, 7).
 */
export { HUMAN_COMMANDS } from './identity/identity-commands.js';
export { OWNER_COMMANDS } from './identity/member-commands.js';
export { PERSON_SESSION } from './identity/person-session.js';
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
/** The resolver's collision rule and the overrides' check, which the chrome's settings chunk repeats (step 7). */
export { keysCollide } from './settings/keybinding-resolve.js';
export { overridesProblem } from './settings/setting-sections.js';
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

/**
 * `entry` without its `VIEW_STATE_NOT_SAVED` warnings: the recording's store failed to write a record, which says
 * nothing of what the call did, and a replay's store does not fail, so the replay reads the rest (#861). A result with
 * no other warning loses the key; one whose handler returned `warnings: []` itself would compare as `added`, which no
 * kernel command does.
 */
function withoutUnsavedWarning(entry: JournalEntry): JournalEntry {
	const warnings = entry.result.warnings;
	if (!warnings?.some((warning) => warning.code === 'VIEW_STATE_NOT_SAVED')) return entry;
	const kept = warnings.filter((warning) => warning.code !== 'VIEW_STATE_NOT_SAVED');
	const { warnings: _dropped, ...result } = entry.result;
	return { ...entry, result: kept.length > 0 ? { ...result, warnings: kept } : result };
}

export interface ReplayKernelOptions {
	/** The environment of the fresh kernel. Default: one that matches no media query. */
	environment?: KernelEnvironment;
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
	deployment?: ProjectionV4;
	/** Ports that serve the deployment's packages in process, so a view replays with no iframe. */
	ports?: KernelPorts;
	/** The recording kernel's identity (phase 3 specification, 2.1). */
	identity?: IdentityV1;
	/** The replay's store, for a test that reads what it rebuilt (the bus's tables, phase 5's 9.2). Default: a new one. */
	store?: DataAdapter;
	/** Which auth gate the recording kernel used (`'session'` for browser, `'principal'` for hosted server). */
	gate?: 'session' | 'principal';
	/**
	 * The membership the recording kernel started with. Each `session-settle` entry records the settled person's
	 * role and digest, which the replay applies over it as the original did (4.4).
	 */
	membership?: MembershipV1;
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
	kernel?: LoamKernel;
}

export { REPLAY_RECORDED_QUERIES };

/**
 * An agent's `auth-sign-in`, journaled while the agent interface still listed it (refused `HUMAN_REQUIRED` by the
 * identity gate). afd-auth no longer exposes the command to agents, so a new call is refused before the journal and
 * re-running an old entry would answer `COMMAND_NOT_EXPOSED`: a journal from before keeps replaying from its record.
 */
function historicalAgentSignIn(entry: JournalEntry): boolean {
	return entry.command === 'auth-sign-in' && entry.contextDigest?.interface === 'agent';
}

/**
 * The redirect outcome recorded on a single sign-on `auth-sign-in` entry, if any (#2954):
 * returns `{ kind: 'redirect', url? }` for a successful `oauth` `auth-sign-in` carrying a
 * `SIGN_IN_REDIRECT` warning. Driving the replay's Mock with this outcome lets the full command
 * pipeline (interface check, schema validation, `provider`-mode `identity.methods`, `afd-auth`'s
 * `incompleteSignIn` handler, and whole-result comparison) run while leaving the Mock's session
 * state unchanged.
 */
function recordedRedirectOutcome(entry: JournalEntry | undefined): SignInOutcome | undefined {
	if (
		entry?.command !== 'auth-sign-in' ||
		entry.result.success !== true ||
		(entry.input as { method?: unknown } | undefined)?.method !== 'oauth' ||
		!Array.isArray(entry.result.warnings)
	) {
		return undefined;
	}
	const warning = entry.result.warnings.find((candidate) => candidate?.code === 'SIGN_IN_REDIRECT');
	if (!warning) return undefined;
	const url = (warning.details as { url?: unknown } | undefined)?.url;
	return typeof url === 'string' ? { kind: 'redirect', url } : { kind: 'redirect' };
}

/** Whether a replay answers `entry` from its record, because re-running it would prove nothing. */
function answeredFromRecord(entry: JournalEntry): boolean {
	const details = entry.result.error?.details as Record<string, unknown> | undefined;
	return (
		recordedCommand(entry.command) ||
		historicalAgentSignIn(entry) ||
		entry.context?.replay === 'recorded' ||
		entry.context?.parent !== undefined ||
		details?.[PAGE_DECIDED] === true
	);
}

/** Whether two JSON values are equal: every key, every item, in any key order. */
function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => sameJson(item, b[index]))
		);
	}
	if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
	const left = Object.keys(a);
	const right = b as Record<string, unknown>;
	return (
		left.length === Object.keys(b).length &&
		left.every(
			(key) =>
				Object.hasOwn(right, key) && sameJson((a as Record<string, unknown>)[key], right[key])
		)
	);
}

/**
 * `input` as the registry validates it and the journal records it (JSON); undefined for a name the kernel does not
 * hold or an input its schema refuses, which only running the call answers (#859).
 */
function validatedInput(
	command: ZodCommandDefinition | undefined,
	input: unknown
): { input: unknown } | undefined {
	if (!command) return undefined;
	try {
		const parsed = z.safeParse(command.inputSchema, input);
		if (!parsed.success) return undefined;
		const text = JSON.stringify(parsed.data);
		return { input: text === undefined ? null : JSON.parse(text) };
	} catch {
		// A schema callback that throws: the registry answers it as a `VALIDATION_ERROR`.
		return undefined;
	}
}

/**
 * Whether `given`, validated by the command's schema, is the call `recorded` journals: the whole input, after the
 * journal's own redactions (`input.password` removed). Never a subset: `{}` is not a recorded `{ filter: 'a' }`. An entry
 * the kernel's input bound refused (`oversized`, which only the kernel sets) keeps its document's id alone, so it is
 * matched by that id and by `given` being over `inputBytes`, the replay kernel's bound, as it would be refused live: a
 * small call to the same document is not it, and runs (#859). An app's own `DOCUMENT_CONTENT_TOO_LARGE` keeps its whole
 * input and no mark, so it compares whole, a mounted server's too (its result is marked untrusted). Any other entry
 * from before the mark that has that refusal, `replay: 'recorded'` and an input no more than a document's id is
 * ambiguous, what was left of a larger call or the whole of a small one, so it
 * answers nothing: the call runs, and the replay reports any difference.
 * The journal records the input after the handler ran, so a handler that changes its own input is recorded changed,
 * and a nested call into it no longer matches: the replay reports it diverged rather than answer the wrong entry.
 * So would a schema default that is not deterministic (one read from the clock or a random source), which the kernel's
 * schemas do not have.
 */
function sameCall(recorded: JournalEntry, given: unknown, inputBytes: number): boolean {
	const journaled = redactJournalRecord({
		command: recorded.command,
		input: given,
	} as JournalRecord).input;
	if (recorded.context?.oversized === true) {
		// What the live check measures: `document-import`'s envelope, every other command's whole input.
		const measured =
			recorded.command === 'document-import' ? (given as { envelope?: unknown })?.envelope : given;
		const over = new TextEncoder().encode(JSON.stringify(measured) ?? '').length > inputBytes;
		return over && sameJson(recorded.input, oversizedInput(journaled));
	}
	// A mounted server's result is marked untrusted, and the kernel's own refusal never is: that one is never ambiguous.
	const ambiguous =
		recorded.context?.replay === 'recorded' &&
		recorded.result.error?.code === 'DOCUMENT_CONTENT_TOO_LARGE' &&
		recorded.result.metadata?.['dev.loam/trust'] !== 'untrusted' &&
		sameJson(recorded.input, oversizedInput(recorded.input));
	return !ambiguous && sameJson(recorded.input, journaled);
}

/**
 * A handler's nested calls during a replay: answered from the entries with that `parent`, in order, and
 * what differs from them is kept against the outer call, whose result may not show it.
 *
 * A notice's action is the exception (#2119): `notification-act` runs it nested, and a write answered from its record
 * would never land in the replay's store, so a later read of it would diverge. Its handler runs again instead, under
 * its recorded trace ID, so its own nested calls are answered from their entries as any handler's are (a write among
 * them still lands only through its own handler), with the clock and random values its entry recorded
 * ({@link nestedTape}). Its whole result is compared with its entry's, by `ignore`, and what differs, a call it made
 * or did not make among it, is kept against its entry. Not when the replay would answer it from its record at the top
 * level too: a mounted command's, a recorded query's, a refusal the page decided.
 */
/** @internal Exported for its unit test alone. */
export function nestedReplay(
	entries: readonly JournalEntry[],
	ignore: readonly string[] = REPLAY_IGNORE
) {
	const byParent = new Map<string, JournalEntry[]>();
	for (const entry of entries) {
		const parent = entry.context?.parent;
		if (typeof parent !== 'string') continue;
		byParent.set(parent, [...(byParent.get(parent) ?? []), entry]);
	}
	// In the order the calls were made: `run` numbers a trace ID when a call starts, and the journal gives
	// it a `seq` when it finishes, so a handler's calls made together can be journaled in the other order.
	for (const queue of byParent.values()) queue.sort((a, b) => callNumber(a) - callNumber(b));
	const commandOf = new Map(entries.map((entry) => [entry.traceId, entry.command]));
	const gateRefusals = new Map<string, { command: string; result: CommandResult }>();
	for (const entry of entries) {
		const refused = (
			entry as JournalEntry & { gateRefusal?: { command?: unknown; result?: CommandResult } }
		).gateRefusal;
		if (
			entry.command === 'notification-act' &&
			typeof entry.traceId === 'string' &&
			typeof refused?.command === 'string' &&
			refused.result?.success === false
		) {
			gateRefusals.set(entry.traceId, { command: refused.command, result: refused.result });
		}
	}
	const problems = new Map<string, string>();
	const rerunning = new Set<string>();
	let last: JournalEntry | undefined;
	/** The outer call has finished: every call the record holds for it should have happened. */
	const finish = (parent: string): void => {
		const left = byParent.get(parent)?.[0];
		if (left && !problems.has(parent)) {
			problems.set(parent, `The handler did not call '${left.command}', which the journal records`);
		}
	};
	/**
	 * The next call `parent` made, by its trace ID's number, when it is this one; undefined runs the call,
	 * as `KernelPartsInternals.answerNested` says, and a call out of order or with another input diverges. A notice's
	 * action is a `rerun` instead (#2119).
	 */
	function take(
		parent: string,
		name: string,
		input: unknown,
		command: ZodCommandDefinition | undefined,
		inputBytes: number = DOCUMENT_INPUT_MAX_BYTES
	): CommandResult | NestedRerunV1 | undefined {
		const queue = byParent.get(parent);
		const next = queue?.[0];
		// A nested call the call rate refused, recorded as `app-limit-refuse` for it: a replay takes no rate, so it
		// answers the call with that refusal, matched by the command it names (phase 4's section 11; the review's 10).
		const refused = next?.input as { command?: unknown; limit?: unknown } | undefined;
		if (
			next?.command === 'app-limit-refuse' &&
			refused?.limit === 'callsPerSecond' &&
			refused.command === name.slice(0, 256)
		) {
			queue?.shift();
			last = next;
			return next.result;
		}
		if (next?.command !== name) {
			// An auth-gate refusal recorded under a running `notification-act` (#2253): the nested action never reached
			// the journal, so replay answers it with that recorded gate refusal (tampering with `act.result` still diverges).
			const gateRefused = next === undefined ? gateRefusals.get(parent) : undefined;
			if (gateRefused?.command === name) {
				gateRefusals.delete(parent);
				return gateRefused.result;
			}
			return undefined;
		}
		const validated = validatedInput(command, input);
		if (!validated || !sameCall(next, validated.input, inputBytes)) return undefined;
		queue?.shift();
		const traceId = next.traceId;
		const isAction = commandOf.get(parent) === 'notification-act';
		const isNestedWrite = !isAction && rerunning.has(parent) && command?.mutation === true;
		if (
			traceId !== undefined &&
			(isAction || isNestedWrite) &&
			!answeredFromRecord({ ...next, context: { ...next.context, parent: undefined } })
		) {
			rerunning.add(traceId);
			// Run again, so its write (and any nested write inside it, #2325) lands (#2119), and compare whole with its entry.
			const label = isNestedWrite ? `The nested write '${name}'` : `The notice's action '${name}'`;
			const done = (result: CommandResult) => {
				rerunning.delete(traceId);
				if (!sameJson(stripPaths(result, ignore), stripPaths(next.result, ignore)))
					problems.set(traceId, `${label} answered other than its entry`);
				finish(traceId);
			};
			const context: CommandContext = {
				...nestedTape(next),
				...(next.context?.taint !== undefined ? { taint: next.context.taint } : {}),
			};
			return { rerun: { traceId, context, done } };
		}
		last = next;
		return next.result;
	}
	return {
		problems,
		/** The entry the last answer came from, which the replay counts when it is a limit's refusal (section 11). */
		lastAnswered: () => last,
		/** {@link take}'s answer from the record alone: undefined for a call it runs, again or for the first time. */
		answer(...args: Parameters<typeof take>): CommandResult | undefined {
			const taken = take(...args);
			return taken && 'rerun' in taken ? undefined : taken;
		},
		take,
		unrecorded(parent: string, name: string): void {
			problems.set(parent, `The handler called '${name}', which the journal does not record there`);
		},
		finish,
	};
}

/** `replayJournal`'s mark (afd-server's `JOURNAL_REPLAY`, a registered symbol): the journal rewinds the tape there. */
const JOURNAL_REPLAY = Symbol.for('@lushly-dev/afd-server/journal-replay');

/**
 * A nested entry's tape as its call's clock and random source, as `replayJournal` gives a top-level entry's: the journal
 * middleware rewinds it where it sits, so readings outside it shift nothing, and records no entry for it (#2119).
 */
function nestedTape(entry: JournalEntry): CommandContext {
	const readings = entry.tape?.clock ?? [];
	const values = entry.tape?.random ?? [];
	const start = Date.parse(entry.timestamp) || 0;
	// `replayJournal`'s own, for its default seed: what a top-level entry's random source falls back to.
	const seed = `afd-replay:${entry.seq}`;
	let read = 0;
	let drawn = 0;
	let last = start;
	let ended = false;
	let fallback = seededRandom(seed);
	const context: CommandContext = {
		clock: {
			now() {
				if (!ended && read < readings.length) last = readings[read++] as number;
				return last;
			},
		},
		random: {
			seed,
			next: () => (!ended && drawn < values.length ? (values[drawn++] as number) : fallback.next()),
		},
	};
	(context as Record<symbol, unknown>)[JOURNAL_REPLAY] = {
		rewind() {
			read = 0;
			drawn = 0;
			last = start;
			ended = false;
			fallback = seededRandom(seed);
		},
		end() {
			ended = true;
		},
	};
	return context;
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
 *   difference in `details`, when any entry differs; `REPLAY_JOURNAL_GAP`, before anything runs, when an entry is
 *   missing between two the journal kept (phase 4's step 6); `REPLAY_ENTRY_TRUNCATED`, naming the entry, once the entries
 *   before the first one the journal kept truncated and `unreplayable` have replayed (phase 4 specification, 11)
 */
export async function replayKernel(
	entries: readonly JournalEntry[],
	options: ReplayKernelOptions = {}
): Promise<ReplayKernelResult> {
	// Without the recording store's unsaved-write warnings, everywhere the replay reads an entry: what it compares, what
	// it answers from a record, and a nested answer (#861).
	const sorted = entries.map(withoutUnsavedWarning).sort((a, b) => a.seq - b.seq);
	// A replay stops at the first entry kept truncated or missing taint context (section 11, #2325): what it did is not in the journal.
	const cut = sorted.findIndex(
		(entry) =>
			(entry as JournalEntry & { unreplayable?: unknown }).unreplayable === true ||
			entry.contextOmitted?.includes('taint') === true
	);
	const ordered = cut === -1 ? sorted : sorted.slice(0, cut);
	const truncated = cut === -1 ? undefined : (sorted[cut] as JournalEntry);
	const first = sorted[0];
	if (first !== undefined && first.seq !== 1) {
		throw new LoamKernelError({
			code: 'REPLAY_START_INVALID',
			message: `The journal starts at seq ${first.seq}, not 1, so the state it starts from is not in it`,
			suggestion: 'Replay the whole journal from its first entry',
			details: { firstSeq: first.seq },
		});
	}
	// Every entry up to where the replay stops, in order with none missing (step 6's fourth round, 6): a journal with a
	// hole holds a state change the replay would never make, so it diverges later or, worse, never.
	const through = truncated ? [...ordered, truncated] : ordered;
	for (let index = 1; index < through.length; index++) {
		const after = (through[index - 1] as JournalEntry).seq;
		const next = (through[index] as JournalEntry).seq;
		if (next !== after + 1) {
			throw new LoamKernelError({
				code: 'REPLAY_JOURNAL_GAP',
				message: `The journal has no entry between seq ${after} and seq ${next}, so what it held is not in it`,
				suggestion: `Replay up to seq ${after} only, or replay the whole journal again from its source`,
				details: { after, next },
			});
		}
	}
	const nested = nestedReplay(ordered, [...REPLAY_IGNORE, ...(options.ignore ?? [])]);
	const byTrace = new Map(ordered.map((entry) => [entry.traceId, entry]));
	/**
	 * The calls whose run, journaled as its own entry with `origin` (phase 4's 7.1, 7.2), the replay answers from its
	 * record: that call answers from its own record too, as it could not run its child again (step 6's second round, 7).
	 */
	const recordedOrigins = new Set(
		ordered.flatMap((entry) => {
			const origin = entry.context?.origin;
			return typeof origin === 'string' && answeredFromRecord(entry) ? [origin] : [];
		})
	);
	let nextRedirect: SignInOutcome | undefined;
	class ReplayAuthAdapter extends MockAuthAdapter {
		override async signIn(options: SignInOptions): Promise<SignInOutcome> {
			if (options.method === 'oauth' && nextRedirect !== undefined) {
				const outcome = nextRedirect;
				nextRedirect = undefined;
				return outcome;
			}
			return super.signIn(options);
		}
	}
	const auth = new ReplayAuthAdapter();
	// The users the journal's `auth-*` results name, so a settled person reads back as they were recorded.
	const users = new Map<string, User>();
	for (const entry of ordered) {
		const user = (entry.result.data as { user?: User } | undefined)?.user;
		if (typeof user?.id === 'string') users.set(user.id, user);
	}
	/** The replay's Mock set to `person`, as an entry records it: no provider is reached (phase 3 specification, 4.4). */
	const drive = (person: string | null): void => {
		const state = auth.getSession();
		if (person === null) {
			if (state.status !== 'unauthenticated') auth._reset();
			return;
		}
		if (state.status === 'authenticated' && state.user.id === person) return;
		const email = person.startsWith('mock-user-') ? person.slice('mock-user-'.length) : person;
		auth._setUser(users.get(person) ?? { id: person, email, name: email.split('@')[0] as string });
	};
	/**
	 * A page starts as the person its first `session-settle { reason: 'provider' }` names: the original's stage A
	 * ran as the probe's person, which that settle records (4.4). A page with none starts signed out, as the Mock's
	 * page does.
	 */
	const startPage = (base: string | undefined): void => {
		const first = ordered.find(
			(entry) =>
				traceBaseOf(entry.traceId) === base &&
				entry.command === 'session-settle' &&
				(entry.input as { reason?: unknown } | undefined)?.reason === 'provider'
		);
		if (first) drive((first.input as { person: string | null }).person);
	};
	let session = traceBaseOf(ordered[0]?.traceId);
	startPage(session);
	// Shared with the kernel, which reads it at each call, so a kept kernel goes live when the replay ends.
	/** The replay kernel's limits, once it is built: what a nested refusal answered from its record counts in. */
	let counted: KernelParts['limits'] | undefined;
	const internals: KernelPartsInternals = {
		answerNested: (parent, name, input, commands) => {
			const answered = nested.take(
				parent,
				name,
				input,
				commands.find((command) => command.name === name),
				counted?.values().inputBytes
			);
			// A nested refusal answered from its record still counts, as its handler counted it live, at the time it
			// read (phase 4's section 11): `limit-usage-get` then replays the same.
			const entry = answered && !('rerun' in answered) ? nested.lastAnswered() : undefined;
			const caller = entry?.context?.caller;
			const limit = (entry?.input as { limit?: unknown } | undefined)?.limit;
			if (
				entry?.command === 'app-limit-refuse' &&
				typeof caller === 'string' &&
				typeof limit === 'string'
			)
				counted?.refused(
					caller,
					limit as LimitKeyV1,
					entry.tape?.clock?.[0] ?? (Date.parse(entry.timestamp) || 0)
				);
			return answered;
		},
		nestedUnrecorded: (parent, name) => nested.unrecorded(parent, name),
		replaying: true,
		// Whether the deployment was hosted, from the journal's own apply, never the projection replayed against (A5).
		hostedReplay: ordered.some(
			(entry) =>
				entry.command === 'workspace-deployment-apply' &&
				(entry.input as { host?: { kind?: unknown } } | undefined)?.host?.kind === 'hosted'
		),
		// The journal's actor, whatever the replay's one Mock holds, so a refusal stays one (10).
		// On a principal-gated kernel, `principalGate` sets `context.actor` to the admitted principal's frozen actor
		// (the WeakMap key `principals.of` reads), so `actorOf` must not replace it with a plain journal copy.
		// A `shell-open` entry's result alone: what answers a `mounted-ui` open's `mountedView` (phase 5's 9.3).
		recordedResult(traceId) {
			const entry = traceId === undefined ? undefined : byTrace.get(traceId);
			return entry?.command === 'shell-open' ? entry.result : undefined;
		},
		actorOf(traceId) {
			if (options.gate === 'principal') return undefined;
			const entry = traceId === undefined ? undefined : byTrace.get(traceId);
			return entry ? { ...(entry.actor !== undefined ? { actor: entry.actor } : {}) } : undefined;
		},
		drive,
		startPage: () => startPage(session),
	};
	const parts: KernelParts = await createKernelParts(
		{
			store: options.store ?? new MemoryAdapter(),
			storeKind: 'memory',
			journal: new MemoryJournalSink(),
			auth,
			environment: options.environment ?? createFixedEnvironment(),
			host: 'test',
			// A replay's page answered every anchor: a refusal it decided is answered from the record (phase 4's 6.3).
			overlayAnchors: { resolve: () => true },
			...(options.commands !== undefined ? { commands: options.commands } : {}),
			...(options.deployment !== undefined ? { deployment: options.deployment } : {}),
			...(options.ports !== undefined ? { ports: options.ports } : {}),
			...(options.identity !== undefined ? { identity: options.identity } : {}),
			...(options.gate !== undefined ? { gate: options.gate } : {}),
			...(options.membership !== undefined ? { membership: options.membership } : {}),
		},
		internals
	);
	const { kernel } = parts;
	counted = parts.limits;
	let kept = false;
	try {
		const recorded: number[] = [];
		/** The entry `replayJournal` replays next, from its `context` option, which it reads first for each entry. */
		let replaying: JournalEntry | undefined;
		const target: JournalReplayTarget & { readonly interface?: string } = {
			// The registry the next entry runs on, as AFD's guard reads it: an app's call to another app's command only on
			// the `apps` registry, which re-checks its grant (phase 5 specification, 9.1).
			get interface() {
				return replaying?.contextDigest.interface === 'apps' ? 'apps' : undefined;
			},
			async execute(name: string, input: unknown, context: CommandContext = {}) {
				const base = traceBaseOf(context.traceId);
				if (base !== session) {
					session = base;
					await parts.resetSession();
				}
				const entry = byTrace.get(context.traceId);
				const fromRecord =
					entry !== undefined &&
					(answeredFromRecord(entry) ||
						(entry.traceId !== undefined && recordedOrigins.has(entry.traceId)));
				// An agent's call the enforcement gate decided (#1936): it reached the gates live, so they run again with the
				// decision its entry journaled, and the handler alone answers from the record, a refusal the page decided in
				// the handler among them. A copilot call too: its entry journals its `trace` (and `copilotSession`, `turn`),
				// which the replay restores to its context, so the gate reads the same trace for its key, its confirmation
				// and its suggestion (#2118). Never a nested call or the run of a recorded act.
				const gated =
					fromRecord &&
					entry.context?.autonomy !== undefined &&
					entry.context?.parent === undefined &&
					entry.context?.origin === undefined &&
					!(entry.traceId !== undefined && recordedOrigins.has(entry.traceId));
				const answer: RecordedAnswerV1 | undefined = gated
					? { result: entry.result, answered: false }
					: undefined;
				if (answer) {
					(context as Record<symbol, unknown>)[RECORDED_ANSWER] = answer;
				} else if (entry && fromRecord) {
					recorded.push(entry.seq);
					// A confirmed run answered from its record: credit it only when its origin is the confirming
					// `notification-act` for this confirmation in the same session, and bind the credit to its command
					// (step 6's fifth round, 3; #1656).
					const confirmation = entry.context?.confirmation;
					if (
						typeof confirmation === 'string' &&
						confirmation.startsWith('ntf_') &&
						entry.context?.parent === undefined
					) {
						const origin = entry.context?.origin;
						const act = typeof origin === 'string' ? byTrace.get(origin) : undefined;
						const actInput = act?.input as { notification?: unknown; answer?: unknown } | undefined;
						if (
							act?.command === 'notification-act' &&
							act.seq > entry.seq &&
							traceBaseOf(act.traceId) === traceBaseOf(entry.traceId) &&
							act.context?.parent === undefined &&
							act.context?.caller === undefined &&
							act.contextDigest.interface === 'palette' &&
							act.actor?.kind !== 'agent' &&
							act.result.success === true &&
							(act.result.data as { state?: unknown } | undefined)?.state === 'confirmed' &&
							actInput?.notification === confirmation &&
							actInput?.answer === 'confirm'
						) {
							internals.recordedRun?.(confirmation, entry.command, entry.result);
						}
					}
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
				// Boot's own work is in a registry of its own, which only boot and a replay reach (2.2). An app's call to
				// another app's command replays on the `apps` registry with its recorded caller, re-checking the grant (9.1).
				const registry = BOOT_ONLY.includes(name)
					? registries.boot
					: context.interface === 'agent'
						? registries.agent
						: context.interface === 'apps'
							? (registries.apps ?? registries.palette)
							: registries.palette;
				let replayPrincipal: import('./scope/principal.js').KernelPrincipalV1 | undefined;
				let restoreSession: { had: string | null } | undefined;
				if (options.gate === 'principal') {
					const ownContext = context as Record<symbol, unknown>;
					if (BOOT_ONLY.includes(name)) ownContext[KERNEL_OWN] = 'boot';
					else if (name === 'agent-member-settle') ownContext[KERNEL_OWN] = 'hook';
					else if (name === 'app-instance-refresh' && entry?.actor === undefined)
						ownContext[KERNEL_OWN] = 'instance';
					else if (entry?.actor?.id && entry.actor.kind === 'human' && parts.admitPrincipal) {
						const role = options.membership?.members.get(entry.actor.id) ?? null;
						replayPrincipal = parts.admitPrincipal({
							actor: { kind: 'human', id: entry.actor.id },
							person: entry.actor.id,
							role,
							digest: options.membership?.digest ?? '',
						});
						(context as Record<string, unknown>).principal = replayPrincipal;
					}
				} else if (
					entry?.command === 'notification-act' &&
					(entry as JournalEntry & { gateRefusal?: unknown }).gateRefusal !== undefined &&
					entry.actor?.kind === 'human' &&
					typeof entry.actor.id === 'string'
				) {
					// A concurrent `session-settle` may have finished before `notification-act`, signing out the replay's
					// `MockAuthAdapter` before `notification-act` replays (#2253). Restore `entry.actor.id` for the outer
					// act so its handler runs and `nestedReplay` answers its nested action with the recorded gate refusal.
					const current = auth.getSession();
					const currentId = current.status === 'authenticated' ? current.user.id : null;
					if (currentId !== entry.actor.id) {
						restoreSession = { had: currentId };
						drive(entry.actor.id);
					}
				}
				let result: CommandResult;
				nextRedirect =
					entry?.context?.parent === undefined ? recordedRedirectOutcome(entry) : undefined;
				try {
					result = await registry.execute(name, input, context);
				} finally {
					nextRedirect = undefined;
					if (replayPrincipal) parts.retirePrincipal?.(replayPrincipal);
					if (restoreSession !== undefined) drive(restoreSession.had);
				}
				if (answer?.answered && entry) {
					// The handler answered from its record, so its nested calls were never made again: theirs are the record's.
					recorded.push(entry.seq);
					if (entry.command === 'app-instance-refresh' && entry.result.success) {
						const { instance, catalog } = entry.result.data as {
							instance?: unknown;
							catalog?: unknown;
						};
						if (typeof instance === 'string') parts.applyCatalog(instance, catalog);
					}
					return result;
				}
				if (context.traceId !== undefined) nested.finish(context.traceId);
				return result;
			},
		};
		const report = withNestedProblems(
			await replayJournal(target, ordered, {
				ignore: [...REPLAY_IGNORE, ...(options.ignore ?? [])],
				context: (entry) => {
					// Every entry before this one has run: the bus decides their readers now, with the state they left, as the
					// live kernel decided each when it was appended (phase 5's 9.2).
					internals.events?.replayed(ordered, entry.seq - 1);
					replaying = entry;
					return {};
				},
			}),
			ordered,
			nested.problems,
			recorded
		);
		// Every original entry, re-executed or answered from its record, once, in journal order (phase 5's 9.2): AFD's
		// replay never appends, so the bus projects the journal it replays, and its rows match the live kernel's.
		internals.events?.replayed(ordered, Number.POSITIVE_INFINITY);
		await internals.events?.flush();
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
		if (truncated) {
			throw new LoamKernelError({
				code: 'REPLAY_ENTRY_TRUNCATED',
				message: (truncated as { unredacted?: unknown }).unredacted
					? `The journal kept seq ${truncated.seq} (${truncated.command}) without its input, since its redaction failed, so the replay stops there`
					: truncated.contextOmitted?.includes('taint')
						? `The journal omitted taint on seq ${truncated.seq} (${truncated.command}), over the 4 KB context limit, so the replay stops there`
						: (truncated as { lossy?: unknown }).lossy
							? truncated.result.error?.code === 'COMMAND_EXECUTION_ERROR'
								? `The journal kept seq ${truncated.seq} (${truncated.command}) lossy, since its handler threw (COMMAND_EXECUTION_ERROR), so the replay stops there`
								: `The journal kept seq ${truncated.seq} (${truncated.command}) at its least, since it could not vouch for its outcome, so the replay stops there`
							: `The journal kept seq ${truncated.seq} (${truncated.command}) truncated, over loam.limits.journalEntryBytes, so the replay stops there`,
				suggestion: `Replay up to seq ${truncated.seq - 1} only`,
				details: { seq: truncated.seq, command: truncated.command },
			});
		}
		const layout = await kernel.call<LayoutStateV0>('layout-get');
		const appearance = await kernel.call<AppearanceV0>('appearance-get');
		// The replay is over: a kept kernel's calls are live ones, which no journal answers or refuses.
		internals.replaying = false;
		delete internals.answerNested;
		delete internals.nestedUnrecorded;
		delete internals.actorOf;
		delete internals.recordedResult;
		delete internals.drive;
		delete internals.startPage;
		delete internals.recordedRun;
		delete internals.events;
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
