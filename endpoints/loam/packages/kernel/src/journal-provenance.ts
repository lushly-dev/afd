/**
 * @fileoverview The journal's provenance for its wrappers (phase 4's step 6, seventh round): what each child of a running
 * wrapper's entry holds, exactly as the sink appended it (after the redaction and `loam.limits.journalEntryBytes`' bound),
 * so the wrapper journals that and never its live result. A wrapper is `palette-run` (its fill's run, by `origin`) or
 * `notification-act` (its action, nested by `parent`, and a confirmation's run, by `origin` and `confirmation`, which the
 * act's `prompt-settle` carries). Each is kept only while its wrapper runs, keyed by the wrapper's trace, and released when
 * the wrapper's own entry is written. The number of running wrappers is bounded: one past it is not tracked, and journals
 * no result data (fail closed). Private to the kernel; a follow-up may load it with `late`.
 */

import type { CommandMiddleware, CommandResult, JournalRecord } from '@lushly-dev/afd-core';

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
