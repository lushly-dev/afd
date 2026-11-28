/**
 * @fileoverview The journal's order for reads and writes (#1936, #2117; phase 4's R5). The journal appends calls in
 * the order they finish, which a replay runs them in.
 *
 * The order follows what each read saw, across both app stores (`apps/store.ts`) and the kernel's own records
 * (confirmations, documents, projects):
 *
 * - **Read-after-write (RAW):** a top-level journaled read that reads a resource after a pending write to it was
 *   issued waits, after its handler, for that write's journal entry (or its end, with none) before its own journal
 *   turn. A nested write counts as its top-level call's, and so does a nested read (#2727).
 * - **Write-after-read (WAR, #2117, #1045):** a top-level journaled write issued while a read that already read the
 *   same resource has not yet been journaled waits for that read's entry before its own journal turn, so a read that
 *   saw the pre-write state never lands after the write in the journal.
 * - **Write-after-write (WAW, #1045):** a top-level journaled write issued while an earlier write to the same resource
 *   is still pending waits for that earlier write's entry, so concurrent writes journal in store order.
 * - **Cycle freedom (#2117, #1045):** every dependency edge (`waitsOn`) and every execution wait (`origin` / `parent`
 *   children, such as `palette-run` or `notification-act` awaiting its run) forms a single wait-for graph; an edge is
 *   added only when it creates no cycle (`reaches`). Internal kernel calls (boot, instance refresh, provider hook)
 *   never wait, while `palette-run`'s run, confirmed runs and the copilot's calls do (except on their own awaiting
 *   ancestor).
 * - **Hosted MCP calls (#2117):** `track`, placed right before the journal middleware, begins and ends calls that
 *   enter the chain outside `execute` (such as `createMcpHandler` on the hosted server).
 * - **Abort:** an aborted call stops waiting when its signal aborts, and cleans up its listener.
 * Private to the kernel.
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import type { JournalFilterContext } from './journal-redact.js';

/**
 * Set by `replayKernel` alone, on an entry it answers from its record whose call the enforcement gate decided (its
 * `autonomy` field; #1936): the call runs the kernel's chain, its gates among them, and the handler alone is answered
 * from the record, so what the gates did live (a confirmation raised, a count, a suggestion) is done again. A symbol, so
 * no input or `_meta` carries it.
 */
export const RECORDED_ANSWER = Symbol('dev.loam/recorded-answer');

/**
 * In a replay, a nested call run again rather than answered from its record, a notice's action (#2119): under its
 * recorded trace ID, so its own nested calls find their entries, on its context (its entry's tape), and told its result.
 */
export interface NestedRerunV1 {
	rerun: { traceId: string; context: CommandContext; done(result: CommandResult): void };
}

/** What {@link RECORDED_ANSWER} holds: the entry's result, and whether the handler was reached and answered with it. */
export interface RecordedAnswerV1 {
	result: CommandResult;
	answered: boolean;
}

/**
 * In a replay, the enforcement gate's decision as the entry journaled it (`autonomy`), which the gate takes in place of
 * resolving it again: a policy changed while the call ran, journaled before it, does not change it (#1936). By
 * `Symbol.for`, as `copilot/enforce.ts` imports nothing of this module; set only here, and only in a replay.
 */
export const RECORDED_AUTONOMY = Symbol.for('dev.loam/recorded-autonomy');

/** In a replay, the taint sources the gate read for the call as its entry journaled them (`taint`; #2118). */
export const RECORDED_TAINT = Symbol.for('dev.loam/recorded-taint');

interface Call {
	traceId: string;
	/** The outer call's trace ID, for a nested call. */
	parent?: string;
	/** The outer call that started and awaits this top-level run (`palette-run`, `notification-act`). */
	origin?: string;
	mutation: boolean;
	/** A top-level call: no `parent`. */
	top: boolean;
	/** Whether the journal records this command; an unjournaled call neither waits nor is waited on. */
	journaled: boolean;
	/** True for kernel-internal boot/instance/hook calls that a write's chain may await; never waits. */
	internal: boolean;
	/** A call a replay answers from its record: its nested calls' reads order nothing (#2727). */
	recorded: boolean;
	/** Settles once its entry is appended, or it ended with none. Created lazily when needed. */
	appended?: Promise<void>;
	release?: () => void;
	done: boolean;
	/** Resources this call wrote to while its entry is pending. */
	wrote?: Set<string>;
	/** Resources this read read from while its entry is pending. */
	readFrom?: Set<string>;
	/** Calls whose entries this call waits for before journaling its own. */
	waitsOn?: Set<Call>;
	/** Calls currently waiting on this call's entry (`dep.waiters` mirrors `waiter.waitsOn`). */
	waiters?: Set<Call>;
	/** Active nested or `origin` calls that this call awaits in execution (implicit wait edges). */
	children?: Set<Call>;
}

/** What a store or kernel record tells the order of one call's operations. */
export interface StoreOrderV1 {
	/** A read is issued. */
	read(): void;
	/** A write (a put or a delete) is issued. */
	wrote(): void;
}

export interface JournalOrder {
	/**
	 * A call starts, before its registry runs it: a mutation or not, by its fields (`parent` makes it nested; `origin`
	 * links a top-level run to the outer call awaiting it), whether it is kernel-internal (boot, instance refresh,
	 * provider hook), and optionally its command name (so `journaled` is known before `turn`).
	 */
	begin(
		traceId: string,
		mutation: boolean,
		fields: { parent?: unknown; origin?: unknown },
		internal: unknown,
		command?: string,
		context?: JournalFilterContext
	): void;
	/** The sink accepted its entry. */
	appended(traceId: string | undefined): void;
	/** It returned, whether or not it was journaled: nothing waits for it after this. */
	end(traceId: string): void;
	/**
	 * A call suspended waiting for human input (such as a slot confirmation): drop its pre-wait reads so concurrent
	 * writes made while it waits never deadlock on WAR (#2117).
	 */
	suspend(traceId: string): void;
	/** What a call's operations on `resource` (an app store or kernel record table) tell the order. */
	store(traceId: string, resource: string): StoreOrderV1;
	/**
	 * Right outside the journal: begins and ends calls that enter the chain without `execute` (hosted MCP calls, #2117).
	 */
	readonly track: CommandMiddleware;
	/**
	 * The chain's last middleware, around the handler alone: in a replay, the record's answer in place of the handler for
	 * a call marked {@link RECORDED_ANSWER}.
	 */
	readonly handler: CommandMiddleware;
	/**
	 * Right inside the journal: waits here for every write it saw and every earlier read of a resource it wrote. It also
	 * clears `autonomy` and `taint`, fields only the enforcement gate sets, before anything else in the chain reads the
	 * context; in a replay they are handed to the gate as {@link RECORDED_AUTONOMY} and {@link RECORDED_TAINT}.
	 */
	readonly turn: CommandMiddleware;
}

export function createJournalOrder(
	journaled: (command: string, context?: JournalFilterContext) => boolean,
	replaying: () => boolean,
	isMutation: (command: string) => boolean = () => false,
	recorded: (command: string) => boolean = () => false
): JournalOrder {
	const calls = new Map<string, Call>();
	/** By resource, the writes whose entries are pending. */
	const writers = new Map<string, Set<Call>>();
	/** By resource, the top-level journaled reads whose entries are pending (#2117). */
	const readers = new Map<string, Set<Call>>();

	const ensureLatch = (call: Call): Promise<void> | undefined => {
		if (call.done) return undefined;
		if (!call.appended) {
			call.appended = new Promise<void>((resolve) => {
				call.release = resolve;
			});
		}
		return call.appended;
	};

	const rootOf = (traceId: string): Call | undefined => {
		let call = calls.get(traceId);
		for (let depth = 0; call?.parent !== undefined && depth < 16; depth++)
			call = calls.get(call.parent);
		return call;
	};

	/** True when `from` can reach `target` via explicit `waitsOn` or implicit execution `children` edges. */
	const reaches = (from: Call, target: Call): boolean => {
		const seen = new Set<Call>();
		const stack: Call[] = [from];
		while (stack.length > 0) {
			const cur = stack.pop() as Call;
			if (cur === target) return true;
			if (seen.has(cur)) continue;
			seen.add(cur);
			for (const next of cur.waitsOn ?? []) if (!next.done) stack.push(next);
			for (const child of cur.children ?? []) if (!child.done) stack.push(child);
		}
		return false;
	};

	const addWait = (waiter: Call, dep: Call): void => {
		if (waiter === dep || waiter.done || dep.done) return;
		if (!waiter.journaled || !dep.journaled || waiter.internal) return;
		if (reaches(dep, waiter)) return;
		if (!ensureLatch(dep)) return;
		waiter.waitsOn ??= new Set();
		waiter.waitsOn.add(dep);
		dep.waiters ??= new Set();
		dep.waiters.add(waiter);
	};

	const release = (call: Call | undefined) => {
		if (!call || call.done) return;
		call.done = true;
		if (call.release) {
			call.release();
			delete call.release;
		}
		for (const dep of call.waitsOn ?? []) dep.waiters?.delete(call);
		call.waiters?.clear();
		for (const resource of call.wrote ?? []) {
			const set = writers.get(resource);
			set?.delete(call);
			if (set?.size === 0) writers.delete(resource);
		}
		for (const resource of call.readFrom ?? []) {
			const set = readers.get(resource);
			set?.delete(call);
			if (set?.size === 0) readers.delete(resource);
		}
	};

	const waitFor = async (call: Call | undefined, context: CommandContext): Promise<void> => {
		if (!call?.waitsOn || call.waitsOn.size === 0) return;
		const signal = context.signal;
		if (signal?.aborted) return;
		let onAbort: (() => void) | undefined;
		const abortPromise = signal
			? new Promise<void>((resolve) => {
					onAbort = () => resolve();
					signal.addEventListener('abort', onAbort, { once: true });
				})
			: undefined;
		try {
			const pending = [...call.waitsOn]
				.filter((dep) => !dep.done && dep.appended)
				.map((dep) => dep.appended as Promise<void>);
			if (pending.length === 0) return;
			await (abortPromise
				? Promise.race([Promise.all(pending), abortPromise])
				: Promise.all(pending));
		} finally {
			if (signal && onAbort) signal.removeEventListener('abort', onAbort);
		}
	};
	/** A call waits for a person: its pre-wait reads are dropped, and every edge on its entry (#2117). */
	const suspended = (call: Call): void => {
		for (const resource of call.readFrom ?? []) {
			const set = readers.get(resource);
			set?.delete(call);
			if (set?.size === 0) readers.delete(resource);
		}
		call.readFrom?.clear();
		// Remove stale WAR edges on this suspended read so a post-resume re-read can still wait on that writer (#2117).
		for (const waiter of call.waiters ?? []) waiter.waitsOn?.delete(call);
		call.waiters?.clear();
		if (call.release) {
			call.release();
			delete call.release;
			delete call.appended;
		}
	};

	const begin: JournalOrder['begin'] = (traceId, mutation, fields, internal, command, context) => {
		const parent = typeof fields.parent === 'string' ? fields.parent : undefined;
		const origin =
			typeof fields.origin === 'string' && fields.origin !== '' ? fields.origin : undefined;
		const top = parent === undefined;
		const call: Call = {
			traceId,
			mutation,
			top,
			journaled: command === undefined ? true : journaled(command, context),
			internal: Boolean(internal),
			recorded: command !== undefined && recorded(command),
			done: false,
			...(parent !== undefined ? { parent } : {}),
			...(origin !== undefined ? { origin } : {}),
		};
		calls.set(traceId, call);
		const ownerId = parent ?? origin;
		if (ownerId !== undefined) {
			const owner = calls.get(ownerId);
			if (owner && !owner.done) {
				owner.children ??= new Set();
				owner.children.add(call);
			}
		}
	};

	const end: JournalOrder['end'] = (traceId) => {
		const call = calls.get(traceId);
		if (!call) return;
		release(call);
		const ownerId = call.parent ?? call.origin;
		if (ownerId !== undefined) calls.get(ownerId)?.children?.delete(call);
		calls.delete(traceId);
	};

	return {
		begin,
		appended(traceId) {
			if (traceId !== undefined) release(calls.get(traceId));
		},
		end,
		suspend(traceId) {
			const call = calls.get(traceId);
			if (!call || call.done) return;
			suspended(call);
			// A nested call's reads are its top-level call's (#2727), which awaits it: they are dropped with it, so a
			// write made while the person answers is not held on the root's entry.
			const root = rootOf(traceId);
			// A root with a write of its own keeps its entry's edges: what waits on that write still waits.
			if (root && root !== call && !root.done && !root.mutation && !root.wrote?.size)
				suspended(root);
		},
		store(traceId, resource) {
			return {
				wrote() {
					// A nested write is its top-level call's, whose entry follows it: a notice's action under its act (#1936).
					const call = rootOf(traceId);
					if (!call || call.done || !call.journaled) return;
					// WAR (#2117, #1045): any active read that already read `resource` must journal before this write.
					for (const reader of readers.get(resource) ?? []) addWait(call, reader);
					// WAW (#1045): any earlier pending write to `resource` must journal before this write.
					for (const prev of writers.get(resource) ?? []) addWait(call, prev);
					ensureLatch(call);
					call.wrote ??= new Set();
					call.wrote.add(resource);
					const held = writers.get(resource) ?? new Set<Call>();
					writers.set(resource, held);
					held.add(call);
				},
				read() {
					// A nested read is its top-level call's, as a nested write is: `document-export`'s type export (#2727).
					// Under a mutation it adds nothing, so a mutation's own nested read never waits on its own write. Nor under
					// a call a replay answers from its record, as `project-summary-get`, whose place in the journal changes no
					// replay: a write after it never waits on its summaries' deadline.
					const call = rootOf(traceId);
					if (
						!call ||
						call.done ||
						call.mutation ||
						(call.recorded && call.traceId !== traceId) ||
						!call.top ||
						!call.journaled ||
						call.internal
					)
						return;
					for (const write of writers.get(resource) ?? []) addWait(call, write);
					call.readFrom ??= new Set();
					call.readFrom.add(resource);
					const held = readers.get(resource) ?? new Set<Call>();
					readers.set(resource, held);
					held.add(call);
				},
			};
		},
		track: async (name, _input, context, next) => {
			const traceId = typeof context.traceId === 'string' ? context.traceId : undefined;
			if (traceId === undefined || calls.has(traceId)) return next();
			begin(
				traceId,
				isMutation(name),
				context as { parent?: unknown; origin?: unknown },
				false,
				name,
				context
			);
			try {
				return await next();
			} finally {
				end(traceId);
			}
		},
		handler: async (_name, _input, context, next) => {
			const recorded = (context as Record<symbol, unknown>)[RECORDED_ANSWER] as
				| RecordedAnswerV1
				| undefined;
			if (!recorded) return next();
			recorded.answered = true;
			return structuredClone(recorded.result);
		},
		turn: async (name, _input, context, next) => {
			const given = (context as { autonomy?: unknown }).autonomy;
			const taint = (context as { taint?: unknown }).taint;
			delete (context as { autonomy?: unknown }).autonomy;
			delete (context as { taint?: unknown }).taint;
			if (given !== undefined && replaying())
				(context as Record<symbol, unknown>)[RECORDED_AUTONOMY] = given;
			else delete (context as Record<symbol, unknown>)[RECORDED_AUTONOMY];
			if (replaying())
				(context as Record<symbol, unknown>)[RECORDED_TAINT] = Array.isArray(taint) ? taint : [];
			else delete (context as Record<symbol, unknown>)[RECORDED_TAINT];
			const call = typeof context.traceId === 'string' ? calls.get(context.traceId) : undefined;
			const waits = journaled(name, context);
			if (call) call.journaled = waits;
			let result: CommandResult;
			try {
				result = await next();
			} catch (thrown) {
				if (waits) await waitFor(call, context);
				throw thrown;
			}
			if (waits) await waitFor(call, context);
			return result;
		},
	};
}
