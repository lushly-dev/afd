/**
 * @fileoverview Session state comparison and expiry helpers shared by the
 * adapters, the middleware and the React hooks.
 */

import type { AuthSessionState, User } from './types.js';

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
