/**
 * @fileoverview The dispatch id (`spec/dispatch.md`, "The dispatch id", I1 to I4): an id the
 * engine makes for each call it runs and puts on the command context as `dispatchId`.
 *
 * Internal: published as `@lushly-dev/afd-core/internal/dispatch-id` for AFD's own engines (the
 * core registry here and `@lushly-dev/afd-server`'s execution engine).
 */

import type { CommandContext } from './commands.js';

/** The context key the engine sets (`spec/context-fields.md`: a reserved name). */
export const DISPATCH_ID_KEY = 'dispatchId';

/**
 * Carries an id made before the engine to the engine that runs the call, through the copies a
 * surface makes of the context on the way. Module-private, so only AFD's code can set it; a symbol,
 * so `Object.keys`, JSON and the journal's context digest never see it.
 */
const PRESET = Symbol('afd.presetDispatchId');

/**
 * A fresh dispatch id: 128 bits from the platform's cryptographic random source, as unpadded
 * base64url (22 characters, the last `A`, `Q`, `g` or `w`). Never from `context.random`, so a
 * journal's tape is unchanged (I1).
 */
export function createDispatchId(): string {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Put `id` on `context`, a context object the engine has just made for this call, as `dispatchId`,
 * replacing whatever a caller or a context hook put there (I1). The property is a getter that cannot
 * be redefined or deleted, and writes to it are ignored, so every middleware and the handler read
 * the same value for the whole dispatch, whatever a link does (I3). It is not enumerable, so
 * `Object.keys(context)`, a spread copy and `JSON.stringify` leave it out: a journal's context
 * digest and every copy of the context are what they were before the id existed (I4), and a nested
 * call made with a copy gets an id of its own (I2).
 */
export function setDispatchId(context: CommandContext, id: string): void {
	Object.defineProperty(context, DISPATCH_ID_KEY, {
		get: () => id,
		set: () => {},
		configurable: false,
		enumerable: false,
	});
}

/**
 * Give the call the engine is about to run on `context` (or a copy of it) the id `id`, made by a
 * surface for a check it makes before the engine runs, such as an app call's grant, which reads the
 * id on a copy of its own ({@link setDispatchId}). Never hand `context` to host code: whoever holds
 * it could start calls under that id.
 */
export function presetDispatchId(context: CommandContext, id: string): void {
	Object.defineProperty(context, PRESET, {
		value: id,
		enumerable: true,
		configurable: true,
		writable: false,
	});
}

/**
 * The id for the call the engine runs on `context`, a copy it made of the caller's: the id a
 * surface preset for it, which is then removed from `context` so a nested call made with it gets
 * its own, or else a fresh one.
 */
export function takeDispatchId(context: CommandContext): string {
	const preset = (context as Record<symbol, unknown>)[PRESET];
	delete (context as Record<symbol, unknown>)[PRESET];
	return typeof preset === 'string' ? preset : createDispatchId();
}
