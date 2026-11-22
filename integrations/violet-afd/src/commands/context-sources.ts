import { nanoid } from 'nanoid';
import type { CommandContext } from './registry.js';

/**
 * The clock and the ids a write stamps on its records, taken from the command
 * context so a host can inject them and a recorded run replays exactly (#1324).
 * Without them a write falls back to the wall clock and `nanoid`.
 */

/** nanoid's alphabet and default length, so injected ids look like the fallback's */
const ID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';
const ID_LENGTH = 21;

/** The context's clock as an ISO 8601 timestamp, or the wall clock's */
export function contextNow(context: Pick<CommandContext, 'now'>): string {
	const millis = context.now ? context.now() : Date.now();
	return new Date(millis).toISOString();
}

/** The context's clock in epoch milliseconds, or the wall clock's */
export function contextMillis(context: Pick<CommandContext, 'now'>): number {
	return context.now ? context.now() : Date.now();
}

/**
 * A new record id: drawn from the context's random source when it has one, so the
 * same source gives the same ids, otherwise from `nanoid`.
 */
export function contextId(context: Pick<CommandContext, 'random'>, length = ID_LENGTH): string {
	const random = context.random;
	if (!random) return nanoid(length);
	let id = '';
	for (let i = 0; i < length; i++) {
		// Clamp, so a source that returns exactly 1 still picks a real character
		const index = Math.min(Math.floor(random() * ID_ALPHABET.length), ID_ALPHABET.length - 1);
		id += ID_ALPHABET[Math.max(index, 0)];
	}
	return id;
}
