/**
 * The WebCrypto helpers behind approval tokens, checked against Node.js `Buffer` and `node:crypto`,
 * which the previous implementation used, so tokens stay byte for byte the same.
 */
import { createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	type ApprovalKey,
	base64url,
	base64urlText,
	decodeBase64urlText,
	digest,
	hmac,
	randomBytes,
	safeEqual,
	safeEqualText,
	toKeys,
} from './approval-crypto.js';

const SECRET = 'approval-crypto-test-secret-0123456789abcdef';

describe('approval crypto on WebCrypto', () => {
	it('encodes base64url exactly as Buffer does, for every length up to 64 bytes', () => {
		for (let length = 0; length <= 64; length++) {
			const bytes = new Uint8Array(nodeRandomBytes(length));
			expect(base64url(bytes), `length ${length}`).toBe(Buffer.from(bytes).toString('base64url'));
		}
		expect(base64urlText('café ✓ 😀')).toBe(Buffer.from('café ✓ 😀').toString('base64url'));
	});

	it('decodes what it encodes, and refuses text that is not base64url', () => {
		for (const text of ['', 'a', 'ab', 'abc', '{"c":"todo-delete"}', 'é ✓ 😀']) {
			expect(decodeBase64urlText(base64urlText(text))).toBe(text);
		}
		expect(decodeBase64urlText('!!!!')).toBeUndefined();
		expect(decodeBase64urlText('ab+/')).toBeUndefined();
		expect(decodeBase64urlText('abc=')).toBeUndefined();
		expect(decodeBase64urlText('abcde')).toBeUndefined();
	});

	it('replaces invalid UTF-8 as Buffer does', () => {
		const invalid = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
		expect(decodeBase64urlText(base64url(invalid))).toBe(Buffer.from(invalid).toString('utf8'));
	});

	it('computes HMAC-SHA256 and the keyed digests as node:crypto does', async () => {
		const key = toKeys(SECRET)[0] as ApprovalKey;
		for (const data of ['', 'afdap1.payload', 'input\0{"id":42}', 'é ✓ 😀']) {
			const expected = createHmac('sha256', SECRET).update(data).digest();
			expect(Buffer.from(await hmac(key, data)).equals(expected), data).toBe(true);
		}
		const expected = createHmac('sha256', SECRET).update('actor\0null').digest();
		expect(Buffer.from(await digest(key, 'actor', 'null')).equals(expected)).toBe(true);
	});

	it('keys a byte secret from a copy, so later changes to the caller buffer do not change it', async () => {
		const bytes = new TextEncoder().encode(SECRET);
		const key = toKeys(bytes)[0] as ApprovalKey;
		bytes.fill(0);
		const expected = createHmac('sha256', SECRET).update('data').digest();
		expect(Buffer.from(await hmac(key, 'data')).equals(expected)).toBe(true);
	});

	it('refuses missing and short secrets', () => {
		expect(() => toKeys(undefined)).toThrow('Approval secret is required');
		expect(() => toKeys([])).toThrow('Approval secret is required');
		expect(() => toKeys('short')).toThrow('at least 32 bytes');
		expect(() => toKeys(new Uint8Array(31))).toThrow('at least 32 bytes');
	});

	it('compares in constant time, by length first', () => {
		expect(safeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
		expect(safeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
		expect(safeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
		expect(safeEqualText('todo-delete', 'todo-delete')).toBe(true);
		expect(safeEqualText('todo-delete', 'todo-archive')).toBe(false);
	});

	it('draws random bytes from the platform source', () => {
		const first = randomBytes(16);
		expect(first).toHaveLength(16);
		expect(base64url(first)).not.toBe(base64url(randomBytes(16)));
	});
});
