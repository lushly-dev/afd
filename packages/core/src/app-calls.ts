/**
 * Internal core/server seam for app-to-app calls (`spec/command-metadata.md`, "App-to-app calls"):
 * the one check both registries make for a call with the `apps` interface, and its one refusal.
 * The core registry and `createDirectRegistry` both run it first, before lookup, so a command that
 * does not exist, one not exposed to apps and one the caller is not granted answer alike.
 */
import type { CommandContext, ExposeOptions } from './commands.js';
import type { CommandError } from './errors.js';

/** A host's grant check: whether the caller in `context` holds a grant naming `command`. */
export type CallGrant = (command: string, context: CommandContext) => boolean;

/**
 * Whether an app call to `command` may run: the command exists, sets `expose.apps`, and `grant`
 * returns exactly `true`. No grant, any other value and a throw all refuse.
 */
export function appCallGranted(
	command: { expose?: ExposeOptions } | undefined,
	name: string,
	context: CommandContext,
	grant: CallGrant | undefined
): boolean {
	if (command === undefined || command.expose?.apps !== true || grant === undefined) return false;
	try {
		return grant(name, context) === true;
	} catch {
		return false;
	}
}

/** The `CALL_NOT_GRANTED` refusal: fixed bytes that name neither the command nor the reason. */
export function callNotGranted(): CommandError {
	return {
		code: 'CALL_NOT_GRANTED',
		message: 'This app may not call that command',
		suggestion:
			'Ask the deployer for a calls grant that names the command; the command must also set expose.apps',
		retryable: false,
		recovery: { kind: 'external' },
	};
}
