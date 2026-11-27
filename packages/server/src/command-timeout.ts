import type { CommandContext, CommandMiddleware, CommandResult } from '@lushly-dev/afd-core';
import { failure, truncateName } from '@lushly-dev/afd-core';
import { idempotencyStepActed } from './approval-admission.js';

/** Normative server-level default per-command deadline in milliseconds (`spec/execution-controls.md`). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Validate and normalize `defaultTimeoutMs` for a server:
 * - `undefined` → {@link DEFAULT_COMMAND_TIMEOUT_MS} (`30000`)
 * - `0` or `null` → `null` (default deadline disabled)
 * - positive finite number → that millisecond value
 */
export function resolveDefaultTimeoutMs(value: number | null | undefined): number | null {
	if (value === undefined) return DEFAULT_COMMAND_TIMEOUT_MS;
	if (value === null || value === 0) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new RangeError('defaultTimeoutMs must be a positive finite number, 0, or null');
	}
	return value;
}

function cancelledBeforeStart(name: string): CommandResult {
	return failure({
		code: 'COMMAND_CANCELLED',
		message: `Command '${truncateName(name)}' was cancelled before it started`,
		suggestion: 'Retry with a fresh signal if the command is still needed.',
		retryable: false,
	});
}

/** Bound middleware and handler execution by one per-command deadline. */
async function withCommandTimeout(
	name: string,
	context: CommandContext,
	execute: () => Promise<CommandResult>,
	defaultTimeoutMs: number | null
): Promise<CommandResult> {
	const { timeout, signal } = context;
	if (signal?.aborted) return cancelledBeforeStart(name);

	const effectiveTimeout = timeout === undefined ? defaultTimeoutMs : timeout;
	// Match DirectClient: only positive, finite millisecond values enforce a deadline.
	if (
		typeof effectiveTimeout !== 'number' ||
		!Number.isFinite(effectiveTimeout) ||
		effectiveTimeout <= 0
	) {
		return execute();
	}

	const controller = new AbortController();
	const effectiveSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	// Preserve Object.keys(context) when the server attaches a deadline signal to a call whose
	// caller supplied none, so journal context digests stay identical to un-timed contexts.
	Object.defineProperty(context, 'signal', {
		value: effectiveSignal,
		configurable: true,
		writable: true,
		enumerable: Boolean(signal),
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<CommandResult>((resolve) => {
		timer = setTimeout(
			() => {
				// Settle the deadline first, so a handler completing on abort cannot win the race.
				// Where the idempotency step holds the call's key, a repeat with that key is answered
				// from its store, so it is safe (spec/idempotency.md, R3); anywhere else it is not.
				const keyed = idempotencyStepActed(context);
				resolve(
					failure({
						code: 'TIMEOUT',
						message: `Command '${truncateName(name)}' timed out after ${effectiveTimeout}ms`,
						suggestion: keyed
							? 'Repeat the call with the same idempotency key and input: this server answers it from the first call, so the change is not applied twice.'
							: 'Retry with a larger timeout. The command was signalled to abort but may have completed, so check its effect before retrying a mutation.',
						retryable: true,
						...(keyed && { recovery: { kind: 'retry' as const } }),
						details: { command: name, timeoutMs: effectiveTimeout },
					})
				);
				controller.abort();
			},
			Math.min(Math.ceil(effectiveTimeout), 2_147_483_647)
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
	middleware: readonly CommandMiddleware[],
	defaultTimeoutMs: number | null = null
): CommandMiddleware[] {
	const resolvedDefault =
		defaultTimeoutMs === null ? null : resolveDefaultTimeoutMs(defaultTimeoutMs);
	return [
		(name, _input, context, next) => withCommandTimeout(name, context, next, resolvedDefault),
		...middleware,
		async (name, _input, context, next) => {
			// A delayed approval must never start work after its caller received a timeout or
			// cancelled the request, including an ungated step resuming after the shared plan.
			if (context.signal?.aborted) {
				return cancelledBeforeStart(name);
			}
			return next();
		},
	];
}
