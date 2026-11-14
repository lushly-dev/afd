/**
 * @fileoverview Single-use link tokens (phase 3 specification, 5.6 and 5.7; D94): 32 random bytes, sent once in a link
 * and stored only as their SHA-256, compared in constant time. Join and recovery tokens and the single sign-on
 * recovery nonce are all made here.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A new token, base64url: what the link carries. */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** What the provider stores of a token: its SHA-256, hex. */
export const tokenHash = (token: string): string =>
	createHash('sha256').update(token).digest('hex');

/** Whether `token` hashes to `stored`, in constant time. A token off the shape never matches. */
export function tokenMatches(token: unknown, stored: unknown): boolean {
	if (typeof token !== 'string' || typeof stored !== 'string') return false;
	if (!/^[A-Za-z0-9_-]{43}$/.test(token) || stored.length !== 64) return false;
	return timingSafeEqual(Buffer.from(tokenHash(token)), Buffer.from(stored));
}

/** The time a stored date stands for: Better Auth's adapters answer a `Date`, a number or a string. */
export const timeOf = (value: unknown): number =>
	value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
