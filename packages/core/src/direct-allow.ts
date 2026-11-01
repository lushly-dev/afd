/**
 * Internal client/server seam for DirectClient's `allow` option: how a predicate is asked, and the
 * one refusal both sides give. `DirectClient` refuses a name its predicate rejects before reaching
 * the registry; `createDirectRegistry` refuses each command a call runs (directly, or through
 * `afd-call`, `afd-batch`, `afd-pipe` or a grouped tool) that the `allow` call option rejects.
 */
import type { CommandError } from './errors.js';
import { truncateName } from './similarity.js';

/** A trusted, in-process predicate over command and tool names. */
export type DirectAllow = (name: string) => boolean;

/** Whether `allow` permits `name`: only an explicit `true` does, and a throwing predicate denies. */
export function directAllows(allow: DirectAllow, name: string): boolean {
	try {
		return allow(name) === true;
	} catch {
		return false;
	}
}

/** The `COMMAND_NOT_ALLOWED` error for a name the predicate rejects. */
export function commandNotAllowed(name: string): CommandError {
	return {
		code: 'COMMAND_NOT_ALLOWED',
		message: `Command '${truncateName(String(name))}' is not allowed for this client`,
		suggestion: 'Call one of the commands returned by listCommandNames()',
		retryable: false,
	};
}
