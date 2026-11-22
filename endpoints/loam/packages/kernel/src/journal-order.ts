/**
 * @fileoverview The journal's order for a read of a write it saw (#1936; phase 4's R5). The journal appends calls in the
 * order they finish, which a replay runs them in. A write's chain still works after its handler has written (the
 * confirmations' gate stores a confirmed run's outcome on its row, phase 4's 7.2), and an app's surface, told of the
 * change by the handler, reads again through its port at once, so that read could finish first, and a replay ran it
 * before the write it saw.
 *
 * So the order follows what each read saw. An app's store tells this module, by the call's trace ID, of each read a
 * call issues and of each write as its batch is sent, after the quota's own reads (`apps/store.ts`). A read issued
 * after a write was sent to the same instance's store has seen it, as the store orders them (IndexedDB runs a
 * transaction after the ones created before it); such a read, once its handler has run, waits for that write's entry
 * (or the write's end, with none) before its journal turn. A nested write (a notice's action under its act) counts as
 * its top-level call's, whose entry follows its own. Nothing else waits:
 *
 * - **A write never waits**, so no chain of writes can hold another; nor does a nested read, which the replay answers
 *   from its parent's record, a read the journal leaves out, or a read issued before the write, which journals where it
 *   ends, as before.
 * - **Only a call from outside the kernel waits**: a person's, an agent's or an app port's through the kernel's own
 *   `call`. The kernel's own calls (boot's work, the instance refresh, the provider hook's settle, the copilot's
 *   calls, a confirmed run or `palette-run`'s run) never do, so the work a write's chain does after its handler, which may start and await the
 *   kernel's own calls, is never held by them. A call from outside is never awaited by the kernel's chain, nor by a
 *   write's handler, whose own calls are nested. That is the invariant the wait rests on.
 * - **An aborted call stops waiting** when its signal aborts. Otherwise a read waits as long as the write it saw takes
 *   to reach its entry, which a slow store makes longer.
 *
 * Not ordered, each a follow-up in phase 4's specification: what a read saw of the kernel's own records (a
 * confirmation's row, a document's stamp); a read issued before a write and ending after its entry; the kernel's own
 * reads (`palette-run`'s run, the copilot's); and a hosted server's MCP calls, which do not run through `execute`.
 * Private to the kernel.
 */

import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';

/**
 * Set by `replayKernel` alone, on an entry it answers from its record whose call the enforcement gate decided (its
 * `autonomy` field; #1936): the call runs the kernel's chain, its gates among them, and the handler alone is answered
 * from the record, so what the gates did live (a confirmation raised, a count, a suggestion) is done again. A symbol, so
 * no input or `_meta` carries it.
 */
export const RECORDED_ANSWER = Symbol('dev.loam/recorded-answer');

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

interface Call {
	/** The outer call's trace ID, for a nested call. */
	parent?: string;
	mutation: boolean;
	/** A top-level call: no `parent`. */
	top: boolean;
	/** A call from outside the kernel: a person's, an agent's or an app port's. */
	external: boolean;
	/** For a top-level write: settles once its entry is appended, or it ended with none. */
	appended?: Promise<void>;
	release?: () => void;
	/** The instances whose stores this write wrote, while its entry is pending. */
	wrote?: Set<string>;
	/** For a read from outside: the pending writes it saw. */
	seen?: Set<Promise<void>>;
}

/** What an app's store tells the order of one call's operations. */
export interface StoreOrderV1 {
	/** A read is issued. */
	read(): void;
	/** A write (a put or a delete) is issued. */
	wrote(): void;
}

export interface JournalOrder {
	/**
	 * A call starts, before its registry runs it: a mutation or not, by its fields (a `parent` makes it nested), and
	 * whether the kernel made it itself (boot's work, the instance refresh, the copilot's, the provider hook's), which,
	 * with a run {@link JournalOrder.own} marked, never waits.
	 */
	begin(traceId: string, mutation: boolean, fields: { parent?: unknown }, kernels: unknown): void;
	/** The fields of the kernel's own top-level run (a confirmed run, `palette-run`'s), a copy marked as such. */
	own<T extends object>(fields: T): T;
	/** The sink accepted its entry. */
	appended(traceId: string | undefined): void;
	/** It returned, whether or not it was journaled: nothing waits for it after this. */
	end(traceId: string): void;
	/** What a call's operations on `instance`'s store tell the order. */
	store(traceId: string, instance: string): StoreOrderV1;
	/**
	 * The chain's last middleware, around the handler alone: in a replay, the record's answer in place of the handler for
	 * a call marked {@link RECORDED_ANSWER}.
	 */
	readonly handler: CommandMiddleware;
	/**
	 * Right inside the journal: a read waits here for the writes it saw. It also clears `autonomy`, a field only the
	 * enforcement gate sets, before anything else in the chain reads the context; in a replay it is handed to the gate as
	 * {@link RECORDED_AUTONOMY}.
	 */
	readonly turn: CommandMiddleware;
}

export function createJournalOrder(
	journaled: (command: string) => boolean,
	replaying: () => boolean
): JournalOrder {
	const calls = new Map<string, Call>();
	const owned = new WeakSet<object>();
	/** By instance, the writes whose entries are pending. */
	const writers = new Map<string, Set<Call>>();
	const release = (call: Call | undefined) => {
		if (!call?.release) return;
		call.release();
		delete call.release;
		for (const instance of call.wrote ?? []) writers.get(instance)?.delete(call);
	};
	const aborted = (signal: AbortSignal | undefined): Promise<void> =>
		new Promise((resolve) => {
			if (!signal) return;
			if (signal.aborted) resolve();
			else signal.addEventListener('abort', () => resolve(), { once: true });
		});
	const waitFor = async (call: Call | undefined, context: CommandContext): Promise<void> => {
		if (!call?.seen || call.seen.size === 0) return;
		await Promise.race([Promise.all(call.seen), aborted(context.signal)]);
	};
	return {
		begin(traceId, mutation, fields, kernels) {
			const { parent } = fields;
			const top = parent === undefined;
			const external = !kernels && !owned.has(fields);
			const call: Call = {
				mutation,
				top,
				external,
				...(typeof parent === 'string' ? { parent } : {}),
			};
			if (mutation && top) {
				call.appended = new Promise((resolve) => {
					call.release = resolve;
				});
			}
			calls.set(traceId, call);
		},
		own(fields) {
			const copy = { ...fields };
			owned.add(copy);
			return copy;
		},
		appended(traceId) {
			if (traceId !== undefined) release(calls.get(traceId));
		},
		end(traceId) {
			release(calls.get(traceId));
			calls.delete(traceId);
		},
		store(traceId, instance) {
			return {
				wrote() {
					// A nested write is its top-level call's, whose entry follows it: a notice's action under its act (#1936).
					let call = calls.get(traceId);
					for (let depth = 0; call?.parent !== undefined && depth < 16; depth++)
						call = calls.get(call.parent);
					if (!call?.release) return;
					call.wrote ??= new Set();
					call.wrote.add(instance);
					const held = writers.get(instance) ?? new Set<Call>();
					writers.set(instance, held);
					held.add(call);
				},
				read() {
					const call = calls.get(traceId);
					if (!call || call.mutation || !call.top || !call.external) return;
					for (const write of writers.get(instance) ?? []) {
						if (!write.appended) continue;
						call.seen ??= new Set();
						call.seen.add(write.appended);
					}
				},
			};
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
			delete (context as { autonomy?: unknown }).autonomy;
			if (given !== undefined && replaying())
				(context as Record<symbol, unknown>)[RECORDED_AUTONOMY] = given;
			else delete (context as Record<symbol, unknown>)[RECORDED_AUTONOMY];
			const call = typeof context.traceId === 'string' ? calls.get(context.traceId) : undefined;
			const waits = journaled(name);
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
