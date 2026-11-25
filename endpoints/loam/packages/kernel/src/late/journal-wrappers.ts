/**
 * @fileoverview The journal's provenance and redaction for its wrappers (phase 4's step 6, third to ninth rounds;
 * #2107): moved out of first paint and injected by `late/` so stage A does not carry it. A wrapper is `palette-run`
 * (its fill's run, by `origin`) or `notification-act` (its action, nested by `parent`, and a confirmation's run, by
 * `origin` and `confirmation`, which the act's `prompt-settle` carries). Each running wrapper keeps its children's
 * outcomes as the sink appended them (after redaction and `loam.limits.journalEntryBytes`), keyed by the wrapper's
 * trace, and releases them when the wrapper's own entry is written. The number of running wrappers is bounded: one
 * past it is not tracked and journals no result data (fail closed).
 */

import type { CommandMiddleware, CommandResult, JournalRecord } from '@lushly-dev/afd-core';
import type { JournalFilterContext } from '../journal-redact.js';

/** The commands whose entries forward a child's outcome. */
export const JOURNAL_WRAPPERS: readonly string[] = Object.freeze([
	'palette-run',
	'notification-act',
]);

/** At most this many wrappers are tracked at once; another runs untracked and journals no result data. */
export const TRACKED_WRAPPERS = 64;

type Outcome = JournalRecord['result'];

/** A running wrapper's nested action refusal captured at the auth gate before the journal ran (#2253). */
export interface GateRefusalV1 {
	command: string;
	result: Outcome;
}

interface Wrapper {
	/** Its run by `origin`: a fill's run, or a confirmation's. */
	origin?: Outcome;
	/** Its action, nested by `parent`. */
	nested?: Outcome;
	/** When `nested` came from an auth gate refusal before the journal ran (#2253). */
	nestedGateRefusal?: GateRefusalV1;
	/** The confirmations' runs it made, by id. */
	runs: Map<string, Outcome>;
	/** The command its action runs (the act's). */
	action?: string;
	/** Whether it started a run by `origin`, and an action by `parent`, whether or not their entries were written. */
	startedOrigin?: true;
	startedNested?: true;
	/** Whether the act returned its action's failure as its own, the one path it answers with the action's (ninth round). */
	returned?: true;
}

export interface JournalProvenance {
	/** Track a wrapper while it runs; false when the bound is met, and it is not. */
	begin(trace: string): boolean;
	/** Its entry is written: what it kept goes. */
	end(trace: string): void;
	/** The command an act runs, kept for its entry alone. */
	noteAction(trace: string, command: string): void;
	/** The act returns its action's failure as its own, now (step 6's ninth round). */
	noteReturned(trace: string): void;
	/** Whether the act returned its action's failure. */
	returned(trace: string | undefined): boolean;
	/**
	 * An entry the sink accepted, as it holds it: kept when its parent or origin is a running wrapper. A rejected append
	 * records nothing (eighth round, D2).
	 */
	appended(record: JournalRecord): void;
	/**
	 * An auth gate's refusal of a running wrapper's nested action, which exits before the journal runs (#2253): kept as
	 * that action's outcome so the wrapper's own entry stays whole and replayable. Only plain error fields are copied.
	 */
	noteGateRefusal(parent: string, command: string, result: CommandResult): void;
	/** A call a running wrapper started, by `origin` or as a nested `parent`, before its entry is written, if ever. */
	started(trace: string, via: 'origin' | 'parent'): void;
	/** Whether a wrapper started a run by `origin`, or an action nested by `parent`. */
	startedOrigin(trace: string | undefined): boolean;
	startedNested(trace: string | undefined): boolean;
	/** Whether a wrapper is tracked now. */
	tracked(trace: string | undefined): boolean;
	origin(trace: string | undefined): Outcome | undefined;
	nested(trace: string | undefined): Outcome | undefined;
	/** When `nested` was recorded from an auth gate refusal (which carries no handler metadata). */
	gateRefusal(trace: string | undefined): GateRefusalV1 | undefined;
	action(trace: string | undefined): string | undefined;
	/** A confirmation's run, of whichever running wrapper made it. */
	run(confirmation: unknown): Outcome | undefined;
}

/**
 * The journal's provenance for its wrappers (step 6's sixth and seventh rounds), with which commands the journal
 * holds an entry of, so an act whose action has none (an unjournaled query) is redacted by the action's own rule.
 */
export type WrapperProvenance = JournalProvenance & {
	journals(command: string, context?: JournalFilterContext): boolean;
};

/** Wrapper redaction callback injected into stage A's `redactSafely` once `late/` loads (#2107). */
export type WrapperRedact = (
	record: JournalRecord,
	redact: (record: JournalRecord) => JournalRecord,
	known: (command: string) => boolean
) => JournalRecord;

/** The wrapper provenance and redaction seam `late/` injects into `kernel.ts` (#2107). */
export interface JournalWrappers {
	observeGate(gate: CommandMiddleware, onFinally?: (traceId: string) => void): CommandMiddleware;
	begin(name: string, traceId: string): boolean;
	end(traceId: string): void;
	started(traceId: string, via: 'origin' | 'parent'): void;
	appended(entry: JournalRecord): void;
	redact: WrapperRedact;
}

/** Internal `late/` handle: `JournalWrappers` plus `notifications.ts`'s `noteAction` and `noteReturned`. */
export interface LateJournalWrappers extends JournalWrappers {
	noteAction(trace: string, command: string): void;
	noteReturned(trace: string): void;
}

export function createJournalProvenance(limit = TRACKED_WRAPPERS): JournalProvenance {
	const running = new Map<string, Wrapper>();
	const of = (trace: string | undefined) => (trace === undefined ? undefined : running.get(trace));
	return {
		begin(trace) {
			if (running.size >= limit) return false;
			running.set(trace, { runs: new Map() });
			return true;
		},
		end(trace) {
			running.delete(trace);
		},
		noteAction(trace, command) {
			const wrapper = running.get(trace);
			if (wrapper) wrapper.action = command;
		},
		appended(record) {
			const { parent, origin, confirmation } = record.context ?? {};
			if (typeof parent === 'string') {
				const wrapper = running.get(parent);
				if (wrapper) {
					wrapper.nested = record.result;
					delete wrapper.nestedGateRefusal;
				}
			}
			if (typeof origin === 'string') {
				const wrapper = running.get(origin);
				if (wrapper) {
					wrapper.origin = record.result;
					if (typeof confirmation === 'string') wrapper.runs.set(confirmation, record.result);
				}
			}
		},
		noteReturned(trace) {
			const wrapper = running.get(trace);
			if (wrapper) wrapper.returned = true;
		},
		noteGateRefusal(parent, command, result) {
			const wrapper = running.get(parent);
			if (!wrapper || result.success || !result.error) return;
			const { code, message, suggestion, retryable } = result.error;
			const clean: Outcome = {
				success: false,
				error: {
					code,
					message,
					...(suggestion !== undefined ? { suggestion } : {}),
					...(retryable !== undefined ? { retryable } : {}),
				},
			};
			wrapper.nested = clean;
			wrapper.nestedGateRefusal = { command, result: clean };
		},
		returned: (trace) => of(trace)?.returned === true,
		started(trace, via) {
			const wrapper = running.get(trace);
			if (!wrapper) return;
			if (via === 'origin') wrapper.startedOrigin = true;
			else wrapper.startedNested = true;
		},
		startedOrigin: (trace) => of(trace)?.startedOrigin === true,
		startedNested: (trace) => of(trace)?.startedNested === true,
		tracked: (trace) => of(trace) !== undefined,
		origin: (trace) => of(trace)?.origin,
		nested: (trace) => of(trace)?.nested,
		gateRefusal: (trace) => of(trace)?.nestedGateRefusal,
		action: (trace) => of(trace)?.action,
		run(confirmation) {
			if (typeof confirmation !== 'string') return undefined;
			for (const wrapper of running.values()) {
				const found = wrapper.runs.get(confirmation);
				if (found) return found;
			}
			return undefined;
		},
	};
}

/**
 * Wrap the chain's auth gate so a refusal of a running wrapper's nested action (which returns without calling `next`,
 * before the journal runs) is recorded as that action's outcome (#2253). Calls that pass the gate are untouched, so a
 * journaled action whose append fails still fails closed. Optional `onFinally` cleans up per-trace state (e.g. throws).
 */
export function observeGate(
	tracker: JournalProvenance,
	gate: CommandMiddleware,
	onFinally?: (traceId: string) => void
): CommandMiddleware {
	return async (name, input, context, next) => {
		let passed = false;
		try {
			const result = await gate(name, input, context, () => {
				passed = true;
				return next();
			});
			if (!passed && !result.success && typeof context.parent === 'string') {
				tracker.noteGateRefusal(context.parent, name, result);
			}
			return result;
		} finally {
			if (onFinally && typeof context.traceId === 'string') onFinally(context.traceId);
		}
	};
}

/** An object, never an array or null; undefined for anything else. */
const objectOf = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** `holder` with its `key` replaced by `change` of it, when that is an object. */
const changed = (
	holder: Record<string, unknown> | undefined,
	key: string,
	change: (value: Record<string, unknown>) => unknown
): Record<string, unknown> | undefined => {
	const value = objectOf(holder?.[key]);
	return value ? { ...holder, [key]: change(value) } : holder;
};

/** The metadata the registry sets on every result, the wrapper's own and never the child's server content. */
const REGISTRY_METADATA = ['actorKind', 'commandVersion', 'executionTimeMs', 'traceId'] as const;

/**
 * A child's outcome as its entry holds it, without the journal's own sequence, with the wrapper's own registry metadata
 * alone from its live result (seventh round, C1): the wrapper's registry sets those whatever the child answered.
 */
const outcomeOfEntry = (
	result: JournalRecord['result'],
	wrapper: JournalRecord['result']
): JournalRecord['result'] => {
	const { 'dev.loam/seq': _seq, ...metadata } = (result.metadata ?? {}) as Record<string, unknown>;
	const own = (wrapper.metadata ?? {}) as Record<string, unknown>;
	// As the wrapper's registry left them: set, or absent where its own definition has none.
	for (const key of REGISTRY_METADATA) {
		if (own[key] !== undefined) metadata[key] = own[key];
		else delete metadata[key];
	}
	// The whole recorded outcome, its undo and warnings among them (eighth round, D3), its metadata the wrapper's own.
	const { metadata: _metadata, ...whole } = result;
	return {
		...whole,
		...(Object.keys(metadata).length > 0 ? { metadata } : {}),
	} as JournalRecord['result'];
};

/** What a wrapper keeps of an outcome it cannot vouch for: whether it succeeded, and an error's code (fail closed). */
const closedOutcome = (result: JournalRecord['result']): JournalRecord['result'] =>
	({
		success: result.success,
		...(result.error !== undefined ? { error: { code: result.error.code, message: '' } } : {}),
	}) as JournalRecord['result'];

/** A wrapper's entry kept at its least, lossy: a replay stops there rather than compare it (eighth round, D4). */
const closedEntry = (record: JournalRecord, input: unknown): JournalRecord =>
	({
		...record,
		input,
		result: closedOutcome(record.result),
		unreplayable: true,
		lossy: true,
	}) as unknown as JournalRecord;

/** How deep wrappers inside wrappers are followed; past it, an input is dropped (step 6's fourth round, 2). */
const WRAPPED_DEPTH = 8;

/**
 * Every input a record carries for another command, redacted as that command's own entry is (phase 4's 7.1 and 7.2; the
 * trust review's R4; step 6's third and fourth rounds, B, 1 and 2): `redact` applied to each `{ command, input }` inside
 * it, through every wrapper up to {@link WRAPPED_DEPTH}, each on its own input alone, and an input dropped where no
 * command `known` names it, since no rule can say what it holds. The input shapes: `palette-run`'s target;
 * `prompt-settle`'s `open` and `decline`; a notice's `action` (`notification-push`); a popover menu's `items`
 * (`popover-open`). The result shapes, by the command whose result it is: a notice's action (`notification-push`), each
 * listed notice's action and confirmation (`notification-list`), `overlay-list`'s projection of each overlay's `for` and
 * items, `palette-run`'s forwarded result by its target's, and `prompt-settle`'s `settle.result` by the act's command. A
 * replay answers the same, since what it opens and stores holds what the redacted entries gave it.
 */
export function redactWrapped(
	record: JournalRecord,
	redact: (record: JournalRecord) => JournalRecord,
	known: (command: string) => boolean = () => true,
	depth = 0,
	provenance?: WrapperProvenance
): JournalRecord {
	/** `holder`'s `input`, redacted as `holder.command`'s own entry would be, alone, or dropped. */
	const within = (holder: Record<string, unknown>): Record<string, unknown> => {
		if (!('input' in holder)) return holder;
		const { input: inner, ...rest } = holder;
		const { command } = holder;
		if (typeof command !== 'string' || !known(command) || depth >= WRAPPED_DEPTH) return rest;
		// Its own input alone: never the outer result, which would lead back here (the fourth round's 2).
		const own = redact({ ...record, command, input: inner, result: { success: true } });
		return { ...rest, input: redactWrapped(own, redact, known, depth + 1).input };
	};
	const items = (holder: Record<string, unknown>) =>
		Array.isArray(holder.items)
			? { ...holder, items: holder.items.map((item) => (objectOf(item) ? within(item) : item)) }
			: holder;
	const each = (list: unknown, change: (value: Record<string, unknown>) => unknown) =>
		Array.isArray(list)
			? list.map((value) =>
					objectOf(value) ? change(objectOf(value) as Record<string, unknown>) : value
				)
			: list;
	/** A result's data as `command`'s own entry would keep it; dropped for a command no rule can read. */
	const resultOf = (
		command: unknown,
		data: Record<string, unknown> | undefined
	): Record<string, unknown> | undefined => {
		if (!data) return data;
		if (command === 'notification-push')
			return changed(data, 'notification', (notice) => changed(notice, 'action', within));
		if (command === 'notification-list')
			return {
				...data,
				notifications: each(data.notifications, (notice) =>
					changed(changed(notice, 'action', within), 'confirmation', within)
				),
			};
		if (command === 'overlay-list')
			return {
				...data,
				overlays: each(data.overlays, (overlay) =>
					changed(
						overlay.kind === 'popover' ? changed(overlay, 'input', items) : overlay,
						'for',
						within
					)
				),
			};
		// An act's result is its action's, else dropped (fail closed: Opus 4): nested, with no provenance, it is (#1672).
		if (command === 'notification-act' && depth > 0) {
			const { result: _result, ...rest } = data;
			return rest;
		}
		// Any other command's result is its own entry's, which no rule reads today.
		return data;
	};
	/**
	 * A forwarded result, the target's: through the target's own `redact` rule and its result's shapes (fifth round, 1;
	 * Opus 3), and dropped for a target no rule can read.
	 */
	function forwarded(command: unknown, data: Record<string, unknown>): Record<string, unknown> {
		if (typeof command !== 'string' || !known(command) || depth >= WRAPPED_DEPTH) return {};
		const own = redact({ ...record, command, input: {}, result: { success: true, data } });
		return resultOf(command, objectOf(own.result?.data) ?? {}) ?? {};
	}
	const wrappedContext = {
		interface: 'palette',
		actor: record.actor,
		caller: record.context?.caller,
	};
	const { command } = record;
	let input = objectOf(record.input);
	let data = objectOf(record.result?.data);
	if (input) {
		if (command === 'palette-run') {
			// The run's outcome is the target's, forwarded: as the target's own entry kept it, failures included (sixth
			// round, B5), else redacted by the target's rule (the fourth round's 1).
			if (provenance && record.result) {
				// Wholly the run's own entry, as the sink accepted it, nothing of the live result (seventh round, C1, C2;
				// eighth round, D2, D3); untracked, the least of it, lossy (C3; D4).
				if (!provenance.tracked(record.traceId)) return closedEntry(record, within(input));
				const child = provenance.origin(record.traceId);
				if (child)
					return {
						...record,
						input: within(input),
						result: outcomeOfEntry(child, record.result),
					};
				// It ran its target, whose entry is not held: a journaled target's is missing, so fail closed; an unjournaled
				// one's never is, and its own rule applies (Opus I3).
				if (
					provenance.startedOrigin(record.traceId) &&
					provenance.journals(String(input.command), wrappedContext)
				)
					return closedEntry(record, within(input));
			}
			if (data) data = forwarded(input.command, data);
			input = within(input);
		} else if (command === 'prompt-settle') {
			input = changed(changed(input, 'open', within), 'decline', within);
			input = changed(input, 'settle', (settle) => {
				// The run's outcome as its own entry kept it (sixth round, B5), else by its command's rule.
				const run = provenance?.run(settle.id);
				if (run)
					return {
						...settle,
						result: {
							success: run.success,
							...(run.data !== undefined ? { data: run.data } : {}),
							...(run.error !== undefined ? { error: run.error } : {}),
						},
					};
				// Its run's entry missing: no result kept (fail closed, seventh round).
				if (provenance) {
					const { result: _result, ...rest } = settle;
					return rest;
				}
				return changed(settle, 'result', (result) =>
					changed(result, 'data', (inner) => forwarded(settle.command, inner) ?? {})
				);
			});
		} else if (command === 'notification-push') input = changed(input, 'action', within);
		else if (command === 'popover-open') input = items(input);
	}
	if (data && command !== 'palette-run') data = resultOf(command, data);
	// An act whose action failed answers the action's failure: as the action's own entry kept it (sixth round, B5).
	// The act, by what it started (eighth round, D1, D4): untracked, the least of it, lossy. Its action started: the act's
	// outcome is the action's, from its entry, a failure whole and a success's `result`; with no entry held, a journaled
	// action's is missing, so fail closed, and an unjournaled one's by its own rule. No action started: the act's own (a
	// confirmation's answer, a settle's failure), as it is.
	if (command === 'notification-act' && record.result && provenance) {
		if (!provenance.tracked(record.traceId)) return closedEntry(record, record.input);
		if (provenance.startedNested(record.traceId)) {
			const child = provenance.nested(record.traceId);
			const own = objectOf(record.result.data) ?? {};
			const { result: given, ...rest } = own;
			// A failure is the action's only when the act returned it (ninth round): any other, a store's throw while the
			// claim is released among them, is the act's own, which a replay with a healthy store cannot reconstruct, so it
			// stops there.
			if (!record.result.success && !provenance.returned(record.traceId))
				return { ...record, unreplayable: true, lossy: true } as unknown as JournalRecord;
			if (child) {
				if (!record.result.success) {
					const gate = provenance.gateRefusal(record.traceId);
					const result = outcomeOfEntry(gate ? gate.result : child, record.result);
					return gate
						? ({ ...record, result, gateRefusal: gate } as unknown as JournalRecord)
						: { ...record, result };
				}
				return {
					...record,
					result: {
						...record.result,
						data: child.data === undefined ? rest : { ...rest, result: child.data },
					},
				};
			}
			const action = provenance.action(record.traceId);
			if (action === undefined || provenance.journals(action, wrappedContext))
				return closedEntry(record, record.input);
			const object = objectOf(given);
			return {
				...record,
				result: {
					...record.result,
					...(record.result.success
						? { data: object ? { ...rest, result: forwarded(action, object) } : rest }
						: {}),
				},
			};
		}
	}
	return {
		...record,
		...(input ? { input } : {}),
		...(data ? { result: { ...record.result, data } } : {}),
	};
}

/** Build the late-injected wrapper provenance and redaction seam for one kernel (#2107). */
export function createJournalWrappers(
	journals: (command: string, context?: JournalFilterContext) => boolean,
	limit = TRACKED_WRAPPERS
): LateJournalWrappers {
	const tracker = createJournalProvenance(limit);
	const provenance: WrapperProvenance = {
		...tracker,
		journals,
	};
	return {
		observeGate: (gate, onFinally) => observeGate(tracker, gate, onFinally),
		begin: (name, traceId) => JOURNAL_WRAPPERS.includes(name) && tracker.begin(traceId),
		end: (traceId) => tracker.end(traceId),
		started: (traceId, via) => tracker.started(traceId, via),
		appended: (entry) => tracker.appended(entry),
		noteAction: (trace, command) => tracker.noteAction(trace, command),
		noteReturned: (trace) => tracker.noteReturned(trace),
		redact: (record, redact, known) => redactWrapped(record, redact, known, 0, provenance),
	};
}
