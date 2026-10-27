/**
 * @fileoverview The keyed digests, canonical JSON and nonce bookkeeping behind approval tokens and
 * relayed approvals (`approval.ts`).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Actor } from '@lushly-dev/afd-core';

const MIN_SECRET_BYTES = 32;

/** An HMAC key: a string (UTF-8) or raw bytes, at least 32 bytes long. */
export type ApprovalSecret = string | Uint8Array;

/**
 * Stable JSON for binding a token to an input: object keys sorted at every depth, otherwise the
 * `JSON.stringify` rules (`toJSON` is honoured, so a `Date` is its ISO string; `undefined`
 * members are dropped, and `undefined` in an array is `null`).
 *
 * It fails closed rather than collide: only plain objects, arrays, strings, finite numbers,
 * booleans, `null` and values with `toJSON` are accepted. A `bigint`, a non-finite number, a
 * cycle, or an object of any other kind (`Map`, `Set`, `RegExp`, typed arrays, class
 * instances) throws, so a call whose validated input holds one cannot be approved.
 *
 * @throws TypeError for a value it cannot encode without ambiguity
 */
export function canonicalJson(value: unknown): string {
	const ancestors = new Set<object>();

	function encode(raw: unknown): string | undefined {
		let value = raw;
		if (value !== null && typeof value === 'object' && 'toJSON' in value) {
			const toJSON = (value as { toJSON: unknown }).toJSON;
			if (typeof toJSON === 'function') value = toJSON.call(value);
		}
		switch (typeof value) {
			case 'string':
			case 'boolean':
				return JSON.stringify(value);
			case 'number':
				if (!Number.isFinite(value)) {
					throw new TypeError('Cannot bind an approval to a non-finite number');
				}
				return JSON.stringify(value);
			case 'bigint':
				throw new TypeError('Cannot bind an approval to a bigint');
			case 'undefined':
			case 'function':
			case 'symbol':
				return undefined;
		}
		if (value === null) return 'null';

		const object = value as object;
		if (ancestors.has(object)) throw new TypeError('Cannot bind an approval to a cyclic input');
		ancestors.add(object);
		try {
			if (Array.isArray(object)) {
				return `[${object.map((item) => encode(item) ?? 'null').join(',')}]`;
			}
			const prototype = Object.getPrototypeOf(object);
			if (prototype !== Object.prototype && prototype !== null) {
				const kind = object.constructor?.name ?? 'object';
				throw new TypeError(`Cannot bind an approval to a ${kind}: use plain JSON input`);
			}
			const members: string[] = [];
			for (const key of Object.keys(object).sort()) {
				const member = encode((object as Record<string, unknown>)[key]);
				if (member !== undefined) members.push(`${JSON.stringify(key)}:${member}`);
			}
			return `{${members.join(',')}}`;
		} finally {
			ancestors.delete(object);
		}
	}

	return encode(value) ?? 'null';
}

/** The actor fields a token is bound to. `label` is display text, so it is left out. */
export function actorJson(actor: Actor | undefined): string {
	if (!actor) return 'null';
	return canonicalJson({ kind: actor.kind, id: actor.id, onBehalfOf: actor.onBehalfOf });
}

export function toKeys(secret: ApprovalSecret | readonly ApprovalSecret[] | undefined): Buffer[] {
	const secrets: readonly unknown[] = Array.isArray(secret) ? secret : [secret];
	if (secrets.length === 0) throw new TypeError('Approval secret is required');
	return secrets.map((candidate) => {
		if (typeof candidate !== 'string' && !(candidate instanceof Uint8Array)) {
			throw new TypeError('Approval secret is required: pass a string or Uint8Array');
		}
		const key = Buffer.from(candidate);
		if (key.length < MIN_SECRET_BYTES) {
			throw new TypeError(`Approval secret must be at least ${MIN_SECRET_BYTES} bytes`);
		}
		return key;
	});
}

export function hmac(key: Buffer, data: string): Buffer {
	return createHmac('sha256', key).update(data).digest();
}

/** A keyed digest; `purpose` keeps an input digest from ever matching an actor digest. */
export function digest(key: Buffer, purpose: 'input' | 'actor', value: string): Buffer {
	return hmac(key, `${purpose}\0${value}`);
}

/** Constant-time equality. Lengths are not secret (every digest here is 32 bytes). */
export function safeEqual(a: Buffer, b: Buffer): boolean {
	return a.length === b.length && timingSafeEqual(a, b);
}

/** In-memory single-use nonces, forgotten once their token has expired. */
export function createMemoryNonceStore() {
	const used = new Map<string, number>();
	return {
		consume(nonce: string, expiresAt: number, now: number): boolean {
			for (const [spent, until] of used) {
				if (until <= now) used.delete(spent);
			}
			if (used.has(nonce)) return false;
			used.set(nonce, expiresAt);
			return true;
		},
	};
}
