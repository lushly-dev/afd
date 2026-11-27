/**
 * @fileoverview What only `replayKernel` (`testing.ts`) asks of a kernel it builds with `createKernelParts`: answers from
 * the journal in place of running a call, and the replay's own state. Split from `kernel.ts`, which re-exports it.
 */

import { type Actor, type CommandResult, failure, type JournalEntry } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { NestedRerunV1 } from './journal-order.js';

/** Finish a re-run nested call on an early return, forwarding `result` to `rerun.done` (#2325). */
export function finishRerun<T>(
	rerun: NestedRerunV1['rerun'] | undefined,
	result: CommandResult<T>
): CommandResult<T> {
	rerun?.done(result);
	return result;
}

/** Synthesize a failure result for `rerun.done` when `registry.execute` throws during replay (#2325). */
export function rerunFailure(thrown: unknown): CommandResult<never> {
	return failure({
		code: 'COMMAND_EXECUTION_ERROR',
		message: thrown instanceof Error ? thrown.message : String(thrown),
		suggestion: 'Inspect the error thrown during replay',
	});
}

/** What only `replayKernel` asks of a kernel. */
export interface KernelPartsInternals {
	/**
	 * A nested call's answer from the journal, in place of running it (7.6), given the palette's and the agent's
	 * commands, whose schema for `name` validates `input` as the registry will: the record is matched on the whole
	 * validated input (#859). Undefined runs it: a refusal before the middleware, as a name neither registry holds or
	 * an input the schema refuses, leaves no entry, and answers the same again. A recorded call (`replay: 'recorded'`) that passes
	 * validation then stops in the scope middleware as `REPLAY_NOT_RECORDED`, before its handler could reach a
	 * server, and the outer call is reported diverged (phase 2 specification, 10 and 12). A `rerun` runs it again (#2119).
	 */
	answerNested?(
		parent: string,
		name: string,
		input: unknown,
		commands: readonly ZodCommandDefinition[]
	): CommandResult | NestedRerunV1 | undefined;
	/** A nested call ran and reached the journal, so the record has no answer for what it did. */
	nestedUnrecorded?(parent: string, name: string): void;
	/** A replay: stage B's own journaled work is skipped, since the entries are what ran (10). */
	replaying?: boolean;
	/** A replay of a journal whose `workspace-deployment-apply` records a hosted host (phase 6's A5). */
	hostedReplay?: boolean;
	/** The journal's actor for a trace ID, undefined for one it does not hold (10). */
	actorOf?(traceId: string | undefined): { actor?: Actor } | undefined;
	/** The replay's Mock set to the person a `session-settle` entry records (phase 3 specification, 4.4). */
	drive?(person: string | null): void;
	/** At a reload, the replay's Mock set to the person the page's first settle names (4.4). */
	startPage?(): void;
	/**
	 * Set by `late/`'s bus when it is built for a replay (phase 5's 9.2), since the replay's own journal stays empty:
	 * decide the original entries' readers through `through` as the replay reaches them, then write them all.
	 */
	events?: {
		replayed(entries: readonly JournalEntry[], through: number): void;
		flush(): Promise<void>;
	};
	/** Set by the kernel for replay: a confirmed run answered from record, with command and result (#1656). */
	recordedRun?(confirmation: string, command: string, result: CommandResult): void;
}
