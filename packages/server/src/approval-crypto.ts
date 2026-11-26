/**
 * @fileoverview The keyed digests, canonical JSON and nonce bookkeeping behind approval tokens and
 * relayed approvals (`approval.ts`).
 *
 * Runs on WebCrypto (`globalThis.crypto`), which Node.js 22 and every current browser provide, so
 * the approval middleware loads no Node.js built-in. Tokens are byte for byte what the
 * `node:crypto` implementation issued: `spec/vectors/approval-tokens.json` checks it.
 */

import type { Actor, CommandError } from '@lushly-dev/afd-core';
import { canonicalJson } from '@lushly-dev/afd-core/internal/canonical-json';

export { canonicalJson };

/**
 * The answer to a call that needs approval on an input with no canonical form: no token can bind
 * it, so the person is not asked.
 */
export function inputNotCanonical(commandName: string): CommandError {
	return {
		code: 'APPROVAL_UNAVAILABLE',
		message: `${commandName} needs a person's approval, and this input cannot be bound to one`,
		suggestion:
			"Do not retry with this input: it has no exact canonical form, so an approval cannot be bound to it. Send the input in a form canonical JSON accepts (for example, an integer a JavaScript number cannot hold exactly, such as 2^53 + 1, as a string). If the command's schema itself produces such a value (a Set, Map, bigint or class instance), tell the user: the operator must change the schema.",
		retryable: false,
		details: { reason: 'input-not-canonical' },
	};
}

/**
 * The answer when a call's input changed while the approval step was deciding on it (inside a
 * policy function or a store it awaited), so what a person would be shown is not what a token
 * would bind.
 */
export function inputChanged(commandName: string): CommandError {
	return {
		code: 'APPROVAL_UNAVAILABLE',
		message: `${commandName}'s input changed while its approval was being decided`,
		suggestion:
			'Do not retry: this call is not the one the approval step decided on. The operator fixes the policy function or middleware that changes the input.',
		retryable: false,
		recovery: { kind: 'external' },
		details: { reason: 'admission-mismatch' },
	};
}

/** The canonical JSON of `value`, or undefined for a value canonical JSON refuses. */
export function canonicalOrUndefined(value: unknown): string | undefined {
	try {
		return canonicalJson(value);
	} catch {
		return undefined;
	}
}

export const MIN_SECRET_BYTES = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** An HMAC key: a string (UTF-8) or raw bytes, at least 32 bytes long. */
export type ApprovalSecret = string | Uint8Array;

/** The actor fields a token is bound to. `label` is display text, so it is left out. */
export function actorJson(actor: Actor | undefined): string {
	if (!actor) return 'null';
	return canonicalJson({ kind: actor.kind, id: actor.id, onBehalfOf: actor.onBehalfOf });
}

/**
 * An HMAC-SHA256 key, imported on first use and reused for every token it signs or checks. The
 * import waits for first use so that an app that never asks for approval starts where WebCrypto
 * is missing, such as a browser page served over plain HTTP from a network address (#1699).
 */
export interface ApprovalKey {
	readonly key: Promise<CryptoKey>;
}

/**
 * WebCrypto is missing: Node.js before 22, or a browser page on an insecure origin, where
 * `crypto.subtle` is not exposed. The approval middleware answers a call it meets this way with
 * `APPROVAL_UNAVAILABLE` (`details.reason: "no-webcrypto"`).
 */
export class WebCryptoUnavailableError extends TypeError {
	constructor() {
		super(
			'The approval middleware needs WebCrypto (globalThis.crypto.subtle): Node.js 22 or later, or a browser on a secure origin (HTTPS or localhost)'
		);
		this.name = 'WebCryptoUnavailableError';
	}
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
		// A copy, so a caller that reuses its buffer cannot change the key, which is imported only
		// on first use. `new Uint8Array` copies a Node.js `Buffer` too, whose `slice` shares memory.
		const bytes =
			typeof candidate === 'string' ? encoder.encode(candidate) : new Uint8Array(candidate);
		if (bytes.length < MIN_SECRET_BYTES) {
			throw new TypeError(`Approval secret must be at least ${MIN_SECRET_BYTES} bytes`);
		}
		let key: Promise<CryptoKey> | undefined;
		return {
			get key() {
				if (!key) {
					try {
						const imported = cryptoApi().subtle.importKey(
							'raw',
							bytes,
							{ name: 'HMAC', hash: 'SHA-256' },
							false,
							['sign']
						);
						// A failed import is not kept, so a later call tries again.
						imported.catch(() => {
							if (key === imported) key = undefined;
						});
						key = imported;
					} catch (error) {
						// Not kept: a page that gains WebCrypto later is not held to the first answer.
						return Promise.reject(error);
					}
				}
				return key;
			},
		};
	});
}

/** HMAC-SHA256 of the UTF-8 bytes of `data`. */
export async function hmac(key: ApprovalKey, data: string): Promise<Uint8Array> {
	const mac = await cryptoApi().subtle.sign('HMAC', await key.key, encoder.encode(data));
	return new Uint8Array(mac);
}

/** Unpadded base64url SHA-256 of the UTF-8 bytes of `data` (WebCrypto, Node and browser). */
export async function sha256Base64url(data: string): Promise<string> {
	const hash = await cryptoApi().subtle.digest('SHA-256', encoder.encode(data));
	return base64url(new Uint8Array(hash));
}

/**
 * A keyed digest; `purpose` keeps an input digest from ever matching an actor digest, and an
 * approver's principal digest from matching either.
 */
export function digest(
	key: ApprovalKey,
	purpose: 'input' | 'actor' | 'principal',
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
	if (!api?.subtle) throw new WebCryptoUnavailableError();
	return api;
}
