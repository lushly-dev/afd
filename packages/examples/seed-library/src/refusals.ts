/**
 * @fileoverview Refusals and the other pieces every command shares.
 *
 * Nine of the library's codes come from the shared catalog (`spec/error-codes.md`); the
 * library adds three where none fits. Every refusal carries a suggestion that names the
 * command to call next.
 */

import {
	type CommandContext,
	type CommandResult,
	failure,
	systemClock,
} from '@lushly-dev/afd-core';

/** The library's own error codes. */
export const LibraryErrors = {
	/** The variety has no packet left to lend. */
	OUT_OF_STOCK: 'OUT_OF_STOCK',
	/** The variety has run out and nothing the library keeps is close to it. */
	NO_SUBSTITUTE: 'NO_SUBSTITUTE',
	/** The request's hold ran out before it was decided. */
	REQUEST_EXPIRED: 'REQUEST_EXPIRED',
} as const;

export function refuse(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): CommandResult<never> {
	return failure({
		code,
		message,
		suggestion,
		retryable: code === 'SERVICE_UNAVAILABLE',
		...(details && { details }),
	});
}

/** The refusal of a list while the records cannot be read. */
export function unavailable(what: string, command: string): CommandResult<never> {
	return refuse(
		'SERVICE_UNAVAILABLE',
		`The ${what} cannot be read just now`,
		`Wait a moment, then call ${command} again`
	);
}

/** The time a handler acts at: the call's clock, never `Date.now()`. */
export function nowOf(context: CommandContext): number {
	return (context.clock ?? systemClock).now();
}

/** Case-insensitive substring match; an absent query matches everything. */
export function matches(query: string | undefined, ...values: string[]): boolean {
	if (!query) return true;
	const needle = query.trim().toLowerCase();
	return values.some((value) => value.toLowerCase().includes(needle));
}

export function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`;
}
