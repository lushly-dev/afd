/**
 * @fileoverview The keyed digests, canonical JSON and nonce bookkeeping behind approval tokens and
 * relayed approvals (`approval.ts`).
 *
 * Runs on WebCrypto (`globalThis.crypto`), which Node.js 22 and every current browser provide, so
 * the approval middleware loads no Node.js built-in. Tokens are byte for byte what the
 * `node:crypto` implementation issued: `spec/vectors/approval-tokens.json` checks it.
 */

import type { Actor } from '@lushly-dev/afd-core';

const MIN_SECRET_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

/** An HMAC-SHA256 key, imported once and reused for every token it signs or checks. */
export interface ApprovalKey {
	readonly key: Promise<CryptoKey>;
}

export function toKeys(
	secret: ApprovalSecret | readonly ApprovalSecret[] | undefined
): ApprovalKey[] {
	const secrets: readonly unknown[] = Array.isArray(secret) ? secret : [secret];
	if (secrets.length === 0) throw new TypeError('Approval secret is required');
	return secrets.map((candidate) => {
		if (typeof candidate !== 'string' && !(candidate instanceof Uint8Array)) {
			throw new TypeError('Approval secret is required: pass a string or Uint8Array');
		}
		// A copy, so a caller that reuses its buffer cannot change the key.
		const bytes = typeof candidate === 'string' ? encoder.encode(candidate) : candidate.slice();
		if (bytes.length < MIN_SECRET_BYTES) {
			throw new TypeError(`Approval secret must be at least ${MIN_SECRET_BYTES} bytes`);
		}
		const key = cryptoApi().subtle.importKey(
			'raw',
			bytes,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		// Reported when the key is first used; keeps an unused rejection from going unhandled.
		key.catch(() => undefined);
		return { key };
	});
}

/** HMAC-SHA256 of the UTF-8 bytes of `data`. */
export async function hmac(key: ApprovalKey, data: string): Promise<Uint8Array> {
	const mac = await cryptoApi().subtle.sign('HMAC', await key.key, encoder.encode(data));
	return new Uint8Array(mac);
}

/** A keyed digest; `purpose` keeps an input digest from ever matching an actor digest. */
export function digest(
	key: ApprovalKey,
	purpose: 'input' | 'actor',
	value: string
): Promise<Uint8Array> {
	return hmac(key, `${purpose}\0${value}`);
}

/** Constant-time equality. Lengths are not secret (every digest here is 32 bytes). */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index++) {
		difference |= (a[index] as number) ^ (b[index] as number);
	}
	return difference === 0;
}

/** Constant-time equality of two strings' UTF-8 bytes. */
export function safeEqualText(a: string, b: string): boolean {
	return safeEqual(encoder.encode(a), encoder.encode(b));
}

/** `count` random bytes from the platform's cryptographic source. */
export function randomBytes(count: number): Uint8Array {
	return cryptoApi().getRandomValues(new Uint8Array(count));
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_VALUES = new Map([...BASE64URL].map((character, index) => [character, index]));

/** Unpadded base64url, as Node.js `Buffer.toString('base64url')` writes it. */
export function base64url(bytes: Uint8Array): string {
	let out = '';
	let index = 0;
	for (; index + 2 < bytes.length; index += 3) {
		const triple =
			((bytes[index] as number) << 16) |
			((bytes[index + 1] as number) << 8) |
			(bytes[index + 2] as number);
		out += `${BASE64URL[triple >> 18]}${BASE64URL[(triple >> 12) & 63]}${BASE64URL[(triple >> 6) & 63]}${BASE64URL[triple & 63]}`;
	}
	const rest = bytes.length - index;
	if (rest === 1) {
		const single = bytes[index] as number;
		out += `${BASE64URL[single >> 2]}${BASE64URL[(single & 3) << 4]}`;
	} else if (rest === 2) {
		const pair = ((bytes[index] as number) << 8) | (bytes[index + 1] as number);
		out += `${BASE64URL[pair >> 10]}${BASE64URL[(pair >> 4) & 63]}${BASE64URL[(pair & 15) << 2]}`;
	}
	return out;
}

/** Unpadded base64url of a string's UTF-8 bytes. */
export function base64urlText(text: string): string {
	return base64url(encoder.encode(text));
}

/**
 * Decode unpadded base64url to UTF-8 text, or `undefined` when it is not base64url. Invalid UTF-8
 * becomes U+FFFD, as `Buffer.toString('utf8')` does.
 */
export function decodeBase64urlText(text: string): string | undefined {
	if (text.length % 4 === 1) return undefined;
	const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
	let bits = 0;
	let count = 0;
	let length = 0;
	for (const character of text) {
		const value = BASE64URL_VALUES.get(character);
		if (value === undefined) return undefined;
		bits = (bits << 6) | value;
		count += 6;
		if (count >= 8) {
			count -= 8;
			bytes[length++] = (bits >> count) & 0xff;
		}
	}
	return decoder.decode(bytes.subarray(0, length));
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

function cryptoApi(): Crypto {
	const api = globalThis.crypto;
	if (!api?.subtle) {
		throw new TypeError(
			'The approval middleware needs WebCrypto (globalThis.crypto.subtle): Node.js 22 or later, or a browser on a secure origin'
		);
	}
	return api;
}
