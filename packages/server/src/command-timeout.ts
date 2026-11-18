import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import { failure, truncateName } from '@lushly-dev/afd-core';

/** Bound middleware and handler execution by one per-command deadline. */
async function withCommandTimeout(
	name: string,
	context: CommandContext,
	execute: () => Promise<CommandResult>
): Promise<CommandResult> {
	const { timeout, signal } = context;
	// Match DirectClient: only positive, finite millisecond values enforce a deadline.
	if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) return execute();

	const controller = new AbortController();
	context.signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<CommandResult>((resolve) => {
		timer = setTimeout(
			() => {
				// Settle the deadline first, so a handler completing on abort cannot win the race.
				resolve(
					failure({
						code: 'TIMEOUT',
						message: `Command '${truncateName(name)}' timed out after ${timeout}ms`,
						suggestion:
							'Retry with a larger timeout. The command was signalled to abort but may have completed, so check its effect before retrying a mutation.',
						retryable: true,
						details: { command: name, timeoutMs: timeout },
					})
				);
				controller.abort();
			},
			Math.min(Math.ceil(timeout), 2_147_483_647)
		);
	});
	try {
		// The race also consumes late rejections from work that ignores cancellation.
		return await Promise.race([execute(), timedOut]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * The standalone server's deadline boundary: outside user middleware, with a cancellation guard
 * directly before the handler. Keep this out of `/direct`, whose callers use DirectClient's
 * deadline, so in-process hosts that never set `context.timeout` do not bundle timer machinery.
 */
export function withCommandDeadlines(
	middleware: readonly CommandMiddleware[]
): CommandMiddleware[] {
	return [
		(name, _input, context, next) => withCommandTimeout(name, context, next),
		...middleware,
		async (name, _input, context, next) => {
			// A delayed approval must never start work after its caller received a timeout or
			// cancelled the request, including an ungated step resuming after the shared plan.
			if (context.signal?.aborted) {
				return failure({
					code: 'COMMAND_CANCELLED',
					message: `Command '${truncateName(name)}' was cancelled before it started`,
					suggestion: 'Retry with a fresh signal if the command is still needed.',
				});
			}
			return next();
		},
	];
}
