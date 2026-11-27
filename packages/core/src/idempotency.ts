/**
 * @fileoverview Idempotency keys (`spec/idempotency.md`): what a command declares about repeats,
 * the key a caller sends, its form (K2) and the keys a batch or pipeline derives from it (K4).
 *
 * Browser-safe: no Node.js built-ins. The engine's step, which answers repeats from a store, is
 * the server's (`@lushly-dev/afd-server`). The engine's record of where a key came from is
 * internal (`idempotency-keys.ts`, published as `@lushly-dev/afd-core/internal/idempotency`).
 */

import type { CommandError } from './errors.js';

/** The `_meta` key a caller sends an idempotency key in (`spec/idempotency.md`, K1). */
export const AFD_IDEMPOTENCY_KEY_META_KEY = 'dev.afd/idempotencyKey';

/**
 * What a command declares about repeating a call (`spec/idempotency.md`, D1 to D5):
 * - `natural`: a repeat leaves the same state as one call (a set, a delete by id). Anyone may
 *   repeat it, and the command reports the MCP annotation `idempotentHint: true`.
 * - `keyed`: a repeat that carries the same key and input is safe, because the handler or the
 *   engine's idempotency step answers it. Only a caller that sends a key may repeat it.
 *
 * Unset claims nothing: nothing is derived from `mutation`.
 */
export type IdempotencySupport = 'natural' | 'keyed';

/** Whether `value` is one of the declared values. */
export function isIdempotencySupport(value: unknown): value is IdempotencySupport {
	return value === 'natural' || value === 'keyed';
}

/** A caller's key: 1 to 200 characters of `A-Z a-z 0-9 . _ ~ -` (K2). */
const KEY_FORM = /^[A-Za-z0-9._~-]{1,200}$/;

/** Whether `value` is a key a caller may send (K2). A derived key, which holds `:`, is not. */
export function isIdempotencyKey(value: unknown): value is string {
	return typeof value === 'string' && KEY_FORM.test(value);
}

/**
 * The key the item or step at 0-based `index` of a batch or pipeline runs under, when the
 * request carried `base` (K4): `<base>:<index>` for a batch item, `<base>:step:<index>` for a
 * pipeline step.
 */
export function deriveIdempotencyKey(
	base: string,
	kind: 'batch' | 'pipeline',
	index: number
): string {
	return kind === 'batch' ? `${base}:${index}` : `${base}:step:${index}`;
}

/** The `VALIDATION_ERROR` for a key that is not of K2's form. */
export function invalidIdempotencyKeyError(): CommandError {
	return {
		code: 'VALIDATION_ERROR',
		message: 'The idempotency key is not valid',
		suggestion: `Send _meta["${AFD_IDEMPOTENCY_KEY_META_KEY}"] as a string of 1 to 200 characters, each one of A-Z a-z 0-9 . _ ~ -, or leave it out`,
		retryable: false,
		details: { field: 'idempotencyKey', meta: AFD_IDEMPOTENCY_KEY_META_KEY },
	};
}
