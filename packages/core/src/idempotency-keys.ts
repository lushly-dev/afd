/**
 * @fileoverview Where a call's idempotency key came from, as the engines decide it
 * (`spec/idempotency.md`, K1 to K6). Internal: published as
 * `@lushly-dev/afd-core/internal/idempotency` for AFD's own packages.
 *
 * A key reaches an engine on `context.idempotencyKey`. The engine takes it:
 * - as no key when it is absent or `null` (K2), or when it equals the key the engine delivered to
 *   the handler of the call this one is nested in (K6), marked on that handler's context;
 * - as it is when the engine set it itself, a derived key (K4) or one restored from a journal,
 *   which fail K2's form;
 * - as a caller's key when it has K2's form, and otherwise refuses the call.
 *
 * The marks are registered symbols, so separately loaded copies of the packages agree. They are
 * not a boundary against code in the same process: a key marked as the engine's still scopes
 * only its caller's own calls (K5).
 */

import type { CommandContext } from './commands.js';
import { deriveIdempotencyKey, isIdempotencyKey } from './idempotency.js';

/** Marks a key the engine set itself: derived (K4) or restored from a journal entry. */
export const IDEMPOTENCY_KEY_SET_BY_ENGINE: unique symbol = Symbol.for(
	'dev.afd/idempotency-key-set-by-engine'
);

/**
 * Marks the key the engine delivered to a handler on its context. A command the handler runs
 * through the registry on that context, or a copy of it, finds its key equal to this mark and
 * starts without one (K6), also as a batch or pipeline whose items would derive keys from it.
 */
export const IDEMPOTENCY_KEY_DELIVERED: unique symbol = Symbol.for(
	'dev.afd/idempotency-key-delivered'
);

/** The key a call carries, as an engine decides it. */
export type CallIdempotencyKey =
	| { readonly kind: 'none' }
	| { readonly kind: 'key'; readonly key: string; readonly setByEngine: boolean }
	| { readonly kind: 'invalid' };

function marks(context: CommandContext): Record<symbol, unknown> {
	return context as Record<symbol, unknown>;
}

/** The key `context` carries, decided as the file comment says. */
export function resolveIdempotencyKey(context: CommandContext | undefined): CallIdempotencyKey {
	const raw: unknown = context?.idempotencyKey;
	if (!context || raw === undefined || raw === null) return { kind: 'none' };
	if (marks(context)[IDEMPOTENCY_KEY_DELIVERED] === raw) return { kind: 'none' };
	if (typeof raw === 'string' && marks(context)[IDEMPOTENCY_KEY_SET_BY_ENGINE] === raw) {
		return { kind: 'key', key: raw, setByEngine: true };
	}
	return isIdempotencyKey(raw)
		? { kind: 'key', key: raw, setByEngine: false }
		: { kind: 'invalid' };
}

/**
 * Put the call's key on `context` itself, the object its middleware and handler share (K3), and
 * mark it delivered, so a call the handler makes on this context starts without it (K6).
 */
export function deliverIdempotencyKey(context: CommandContext, key: CallIdempotencyKey): void {
	delete context.idempotencyKey;
	delete marks(context)[IDEMPOTENCY_KEY_SET_BY_ENGINE];
	delete marks(context)[IDEMPOTENCY_KEY_DELIVERED];
	if (key.kind !== 'key') return;
	context.idempotencyKey = key.key;
	marks(context)[IDEMPOTENCY_KEY_DELIVERED] = key.key;
}

/**
 * A copy of `context` carrying `key` as a key the engine chose (a derived or restored key), or no
 * key when `key` is undefined.
 */
export function withEngineIdempotencyKey(
	context: CommandContext,
	key: string | undefined
): CommandContext {
	const next: CommandContext = { ...context };
	delete next.idempotencyKey;
	delete marks(next)[IDEMPOTENCY_KEY_SET_BY_ENGINE];
	delete marks(next)[IDEMPOTENCY_KEY_DELIVERED];
	if (key === undefined) return next;
	next.idempotencyKey = key;
	marks(next)[IDEMPOTENCY_KEY_SET_BY_ENGINE] = key;
	return next;
}

/**
 * The context of a batch or pipeline request, with its key decided as a call's would be: the
 * same context when it carries no key at all; without a key it inherited (K6); unchanged with an
 * invalid one, so each item fails K2 at its engine.
 */
export function requestIdempotencyContext(context: CommandContext): CommandContext {
	if (
		context.idempotencyKey === undefined &&
		marks(context)[IDEMPOTENCY_KEY_DELIVERED] === undefined &&
		marks(context)[IDEMPOTENCY_KEY_SET_BY_ENGINE] === undefined
	) {
		return context;
	}
	const key = resolveIdempotencyKey(context);
	if (key.kind === 'invalid') return context;
	if (key.kind === 'none') return withEngineIdempotencyKey(context, undefined);
	if (key.setByEngine) return withEngineIdempotencyKey(context, key.key);
	const next: CommandContext = { ...context, idempotencyKey: key.key };
	delete marks(next)[IDEMPOTENCY_KEY_DELIVERED];
	return next;
}

/**
 * The context of the item or step at `index` of a batch or pipeline whose request ran on
 * `context`: under the key derived from the request's (K4), without one when the request had none
 * or inherited it (K6), and unchanged with an invalid one, so the item fails K2 at its engine.
 */
export function withDerivedIdempotencyKey(
	context: CommandContext,
	kind: 'batch' | 'pipeline',
	index: number
): CommandContext {
	const key = resolveIdempotencyKey(context);
	if (key.kind === 'invalid') return context;
	if (key.kind === 'none') {
		return context.idempotencyKey === undefined
			? context
			: withEngineIdempotencyKey(context, undefined);
	}
	return withEngineIdempotencyKey(context, deriveIdempotencyKey(key.key, kind, index));
}
