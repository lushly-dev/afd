/**
 * @fileoverview Session state comparison and expiry helpers shared by the
 * adapters, the middleware and the React hooks.
 */

import type { AuthSessionState, Session, User } from './types.js';

export function areUsersEqual(left: User, right: User): boolean {
	return (
		left.id === right.id &&
		left.email === right.email &&
		left.name === right.name &&
		left.image === right.image
	);
}

/**
 * Compare two session states by value. Providers may allocate a new state
 * object on every read, so identity is not a usable signal for "changed".
 */
export function areSessionStatesEqual(left: AuthSessionState, right: AuthSessionState): boolean {
	if (left.status !== right.status) return false;
	if (left.status !== 'authenticated' || right.status !== 'authenticated') return true;

	return (
		left.session.id === right.session.id &&
		isSameInstant(left.session.expiresAt, right.session.expiresAt) &&
		areUsersEqual(left.user, right.user)
	);
}

function isSameInstant(left: Date | undefined, right: Date | undefined): boolean {
	if (left instanceof Date && right instanceof Date) {
		return Object.is(left.getTime(), right.getTime());
	}
	return Object.is(left, right);
}

/**
 * Whether a session has reached its expiry. A session without `expiresAt`
 * does not expire here, because its provider manages the token lifetime. An
 * `expiresAt` that is not a valid date counts as expired, so a malformed value
 * fails closed.
 */
export function isSessionExpired(session: Session, now: number = Date.now()): boolean {
	if (session.expiresAt === undefined) return false;
	const expiresAt = new Date(session.expiresAt).getTime();
	return !(expiresAt > now);
}
