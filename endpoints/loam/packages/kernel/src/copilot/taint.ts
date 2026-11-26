/**
 * @fileoverview Taint (phase 5 specification, 5.3; D144): the mark a copilot session carries once content entered its
 * context. A middleware sees every call that carries a copilot trace, the copilot's own and every call nested in one
 * (an app's under a `calls` grant included), and the shell's run of a call a person confirmed, which carries the
 * trace its confirmation stored (6.2). Whatever result would put content before the model taints the session from its
 * source, the first time, whatever the model then does: a part labelled `"trust": "content"`, a mounted result its
 * entry does not label per part, and a confirmation's stored outcome, by the labels of the run it was.
 *
 * What it keeps:
 *
 * - on the session's record, `taint`, each source once with when it first entered (3.4), for the session's life;
 * - by trace, until the agent port's half reads it, the labels of a top-level call and of every call nested in it;
 * - by confirmation, the labels of a confirmed run (`copilot-outcome-labels`), so reading its outcome back taints as
 *   that run did (5.1's row for a stored outcome).
 *
 * In the `late-copilot` chunk; it imports types alone.
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { KernelFieldContext } from '../context-fields.js';
import { type LabelledCommandV1, labelResult, mergeLabels, type ResultLabelsV1 } from './labels.js';
import type { CopilotSessionV1, CopilotTraceV1 } from './types.js';
import { marksUnit } from './units.js';

/** A confirmed run's labels, by its confirmation's id (5.1, 6.2). */
export const OUTCOME_LABELS_TABLE = 'copilot-outcome-labels';

/** One confirmed run's labels, kept with the confirmation's id. Each carries `person`, as every row of the store. */
export interface OutcomeLabelsV1 {
	id: string;
	person: string;
	session: string;
	labels: ResultLabelsV1;
	/** When the run kept them: a row past {@link OUTCOME_LABELS_DAYS} goes when its person's next one is kept (I13). */
	at: number;
}

/** A stored outcome's labels are kept as long as a session (3.4's default 90 days). */
export const OUTCOME_LABELS_DAYS = 90;

export interface TaintDeps {
	store: DataAdapter;
	/** The copilot's session table (3.4). */
	sessionTable: string;
	/** What 5.1 needs of a command. */
	commandOf(name: string): LabelledCommandV1;
	/**
	 * The mounted instances whose servers' words a shell read's result can carry (a catalog listing, B1): `whole` ones,
	 * content, and `per-part` ones, their claims.
	 */
	mountWordsOf(
		name: string,
		input: unknown,
		result: CommandResult
	): { whole: string[]; vouched: string[] };
	personOf(context: CommandContext): string | undefined;
	now(context: CommandContext): number;
	/** A unit's submit (7.3), whose result never reaches the parent. Absent: none. */
	submitting?(trace: CopilotTraceV1): boolean;
}

export interface Taint {
	/** Outermost in the copilot's gate: records what each traced call's result puts before the model. */
	record: CommandMiddleware;
	/** The sources a session is tainted from, in the order they entered. */
	sourcesOf(session: string): Promise<string[]>;
	/**
	 * Atomically commit a new turn row and any attachment taint sources on the session row,
	 * serialized on the session's taint queue (3.5, 5.1, 5.3).
	 */
	commitTurn(
		session: string,
		sources: readonly string[],
		at: number,
		turnTable: string,
		turnId: string,
		turnRow: Record<string, unknown>
	): Promise<CopilotSessionV1 | undefined>;
	/** The labels of a top-level traced call, once, for the agent port's half (3.4). */
	take(trace: CopilotTraceV1): ResultLabelsV1 | undefined;
}

const keyOf = (trace: CopilotTraceV1) => `${trace.session}/${trace.turn}/${trace.call}`;

/** A stored outcome whose run kept no labels: content whole, tainting from `confirmation` (the review's B9). */
const UNLABELLED: ResultLabelsV1 = Object.freeze({
	mode: 'whole',
	source: 'confirmation',
	counts: { content: 1, server: 0, trusted: 0 },
	sources: ['confirmation'],
}) as ResultLabelsV1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function createTaint(deps: TaintDeps): Taint {
	const { store } = deps;
	/** The sources nested calls added while a top-level call runs, by its trace (5.3). */
	const nested = new Map<string, Set<string>>();
	/** A top-level call's labels until the port's half reads them; bounded, as a refused path may never read. */
	const taken = new Map<string, ResultLabelsV1>();
	/** One write at a time per session, so two sources entering together both land. */
	const writing = new Map<string, Promise<unknown>>();

	async function sourcesOf(session: string): Promise<string[]> {
		const row = await store.get<CopilotSessionV1>(deps.sessionTable, session);
		return (row?.taint ?? []).map((each) => each.source);
	}

	function taint(session: string, sources: readonly string[], at: number): Promise<unknown> {
		const before = writing.get(session) ?? Promise.resolve();
		const mine = before.then(async () => {
			const row = await store.get<CopilotSessionV1>(deps.sessionTable, session);
			if (!row) return;
			const known = new Set(row.taint.map((each) => each.source));
			const added = sources.filter((source) => !known.has(source));
			if (added.length === 0) return;
			await store.update(deps.sessionTable, session, {
				taint: [...row.taint, ...[...new Set(added)].map((source) => ({ source, at }))],
			} as never);
		});
		const settled = mine.catch(() => {});
		writing.set(session, settled);
		void settled.then(() => {
			if (writing.get(session) === settled) writing.delete(session);
		});
		return mine;
	}

	/** A stored outcome read back (`confirmation-get`): the labels of the run it was, kept with its id. */
	async function storedLabels(
		input: unknown,
		result: CommandResult,
		session: string
	): Promise<ResultLabelsV1 | undefined> {
		const data = (result as { data?: unknown }).data;
		if (
			!result.success ||
			!isRecord(data) ||
			data.state !== 'confirmed' ||
			data.result === undefined
		)
			return undefined;
		const id = isRecord(input) ? input.notification : undefined;
		if (typeof id !== 'string') return undefined;
		const row = await store.get<OutcomeLabelsV1>(OUTCOME_LABELS_TABLE, id);
		// A run with no labels kept (one the copilot did not raise) is given as content whole and taints the session from
		// `confirmation`: a stored outcome is never laundered into the shell's own words (T17, the review's B9).
		if (!row || row.session !== session) return UNLABELLED;
		return structuredClone(row.labels);
	}

	/**
	 * The confirmations' stored outcomes an inbox read returns (`notification-list` with their
	 * bodies): each by the labels its run kept, as `confirmation-get` reads one (the review's B9).
	 */
	async function inboxLabels(
		result: CommandResult,
		session: string
	): Promise<ResultLabelsV1 | undefined> {
		const data = (result as { data?: unknown }).data;
		const rows = isRecord(data)
			? Array.isArray(data.notifications)
				? data.notifications
				: [data.notification ?? data]
			: [];
		let found: ResultLabelsV1 | undefined;
		for (const row of rows) {
			if (!isRecord(row) || !isRecord(row.confirmation) || row.confirmation.result === undefined)
				continue;
			const kept =
				typeof row.id === 'string'
					? await store.get<OutcomeLabelsV1>(OUTCOME_LABELS_TABLE, row.id)
					: undefined;
			const labels = kept && kept.session === session ? kept.labels : UNLABELLED;
			// The shell's own outcome stays its own, as `confirmation-get` reads it.
			if (labels.mode === 'trusted' && labels.sources.length === 0) continue;
			// A confirmed unit's mark is kept whichever row holds it (7.3, the re-check's B1).
			found = found
				? {
						...found,
						mode: 'whole',
						sources: [...new Set([...found.sources, ...labels.sources])],
						...(found.unit || labels.unit ? { unit: true as const } : {}),
					}
				: { ...labels, mode: 'whole' };
		}
		return found;
	}

	const record: CommandMiddleware = async (name, input, context, next) => {
		const call = context as CommandContext &
			KernelFieldContext & { trace?: CopilotTraceV1; confirmation?: string };
		const trace = call.trace;
		if (trace === undefined) return next();
		const key = keyOf(trace);
		const top = call.parent === undefined;
		if (top) nested.set(key, new Set());
		// Who answers is read before the call: a discovery that runs meanwhile cannot make it the shell's (the review's B3).
		const command = deps.commandOf(name);
		let result: CommandResult;
		try {
			result = await next();
		} catch (cause) {
			if (top) nested.delete(key);
			throw cause;
		}
		let labels = labelResult(result, command);
		// A unit (7.3): the port's own call whose vouched result marks one is given to the composer, never the parent, so
		// its content taints nothing; nor does a unit's submit, whose result the parent never gets. A call an app makes,
		// or a confirmed run, whose result its caller or the inbox holds, is an ordinary result.
		const unit = top && marksUnit(result, labels, command.instance);
		// A confirmed run's unit is given to no composer: it taints as its content does, and its kept labels say it was a
		// unit, so its outcome read back is never given to the parent either (7.3).
		if (unit && call.confirmation !== undefined) labels = { ...labels, unit: true };
		else if (top && call.caller === undefined && (deps.submitting?.(trace) === true || unit)) {
			labels = { ...labels, sources: [], unit: true };
			taken.set(key, labels);
			if (taken.size > 256) taken.delete(taken.keys().next().value as string);
			nested.delete(key);
			return result;
		}
		// A shell read that lists a mounted catalog carries its server's words: content whole from each (the review's B1).
		// A `per-part` instance's words alone are its claims, which taint nothing (5.1, the re-check).
		const words =
			labels.mode === 'trusted'
				? deps.mountWordsOf(name, input, result)
				: { whole: [], vouched: [] };
		if (words.whole.length > 0) {
			labels = {
				mode: 'whole',
				source: words.whole[0] as string,
				counts: { content: 1, server: 0, trusted: 0 },
				sources: [...new Set([...labels.sources, ...words.whole])],
			};
		} else if (words.vouched.length > 0) {
			labels = {
				mode: 'per-part',
				source: words.vouched[0] as string,
				counts: { content: labels.counts.content, server: 1, trusted: 0 },
				sources: labels.sources,
			};
		}
		if (name === 'notification-list') {
			const kept = await inboxLabels(result, trace.session);
			if (kept) labels = { ...kept, sources: [...new Set([...labels.sources, ...kept.sources])] };
		}
		// A stored outcome answered again (phase 4's confirmations mark it with its confirmation): the labels its run kept,
		// as `confirmation-get` reads them, whatever command answered (the second re-check).
		const stored = (result as unknown as Record<symbol, unknown>)[Symbol.for('dev.loam/stored')];
		if (typeof stored === 'string') {
			const kept = await store.get<OutcomeLabelsV1>(OUTCOME_LABELS_TABLE, stored);
			const again = kept && kept.session === trace.session ? kept.labels : UNLABELLED;
			if (again.mode !== 'trusted' || again.sources.length > 0)
				labels = { ...again, sources: [...new Set([...labels.sources, ...again.sources])] };
		}
		if (name === 'confirmation-get') {
			const stored = await storedLabels(input, result, trace.session);
			if (stored) {
				labels =
					stored.mode === 'trusted' && stored.sources.length === 0
						? labels
						: { ...stored, sources: [...new Set([...labels.sources, ...stored.sources])] };
			}
		}
		if (!top) {
			const into = nested.get(key);
			for (const source of labels.sources) into?.add(source);
		} else {
			const added = [...(nested.get(key) ?? [])];
			nested.delete(key);
			// A native app that returns its mount's text, labelled or not, is given as that content whole (5.3, T17): the
			// kernel cannot tell which of its fields came from the mount (the review's B11).
			if (added.length > 0 && labels.mode === 'trusted') {
				labels = {
					mode: 'whole',
					source: added[0] as string,
					counts: { content: Math.max(1, labels.counts.content), server: 0, trusted: 0 },
					sources: [...new Set([...labels.sources, ...added])],
				};
			} else labels = mergeLabels(labels, added);
			taken.set(key, labels);
			if (taken.size > 256) taken.delete(taken.keys().next().value as string);
			// A run a person confirmed: its outcome keeps the labels it ran with, nested calls included (5.1, 6.2).
			if (call.confirmation?.startsWith('ntf_') && result.success !== undefined) {
				const person = deps.personOf(context);
				if (person !== undefined) {
					const row: OutcomeLabelsV1 = {
						id: call.confirmation,
						person,
						session: trace.session,
						labels,
						at: deps.now(context),
					};
					const old = deps.now(context) - OUTCOME_LABELS_DAYS * 86_400_000;
					const listed = await store.list<OutcomeLabelsV1>(OUTCOME_LABELS_TABLE, {
						person,
					} as never);
					for (const each of listed.data)
						if (each.person === person && (each.at ?? 0) < old)
							await store.remove(OUTCOME_LABELS_TABLE, each.id);
					const found = await store.get(OUTCOME_LABELS_TABLE, call.confirmation);
					if (found) await store.update(OUTCOME_LABELS_TABLE, call.confirmation, row as never);
					else await store.create(OUTCOME_LABELS_TABLE, row);
				}
			}
		}
		if (labels.sources.length > 0) await taint(trace.session, labels.sources, deps.now(context));
		return result;
	};

	function commitTurn(
		session: string,
		sources: readonly string[],
		at: number,
		turnTable: string,
		turnId: string,
		turnRow: Record<string, unknown>
	): Promise<CopilotSessionV1 | undefined> {
		const before = writing.get(session) ?? Promise.resolve();
		const mine = before.then(async () => {
			const row = await store.get<CopilotSessionV1>(deps.sessionTable, session);
			if (!row) return undefined;
			const known = new Set(row.taint.map((each) => each.source));
			const added = [...new Set(sources.filter((source) => !known.has(source)))];
			if (added.length === 0) {
				await store.create(turnTable, turnRow);
				return row;
			}
			const updated: CopilotSessionV1 = {
				...row,
				taint: [...row.taint, ...added.map((source) => ({ source, at }))],
			};
			const { summary } = await store.batch([
				{
					method: 'PUT' as const,
					path: `/${deps.sessionTable}/${encodeURIComponent(session)}`,
					body: updated,
				},
				{
					method: 'PUT' as const,
					path: `/${turnTable}/${encodeURIComponent(turnId)}`,
					body: turnRow,
				},
			]);
			if (summary.failed > 0) throw new Error(`The store could not write turn '${turnId}'`);
			return updated;
		});
		const settled = mine.catch(() => {});
		writing.set(session, settled);
		void settled.then(() => {
			if (writing.get(session) === settled) writing.delete(session);
		});
		return mine;
	}

	return {
		record,
		sourcesOf,
		commitTurn,
		take(trace) {
			const key = keyOf(trace);
			const labels = taken.get(key);
			taken.delete(key);
			return labels;
		},
	};
}
