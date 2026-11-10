/**
 * @fileoverview The brand on `credentials` that afd-server set on a call itself, after verifying
 * the call's token (`spec/authorization.md`, M4).
 *
 * The brand is a module-private `WeakSet`: only this package can add to it, and no entry exports
 * {@link brandVerifiedCredentials} or {@link unbrandVerifiedCredentials}. Credentials a caller
 * builds and puts on a context itself, on a direct registry or through `createContext`, are never
 * branded, so code that trusts {@link isVerifiedCredentials} trusts only what afd-server verified.
 */

const verified = new WeakSet<object>();

/**
 * Mark `credentials` as set by afd-server after it verified the call's token, freezing them and
 * their object and array fields (`scopes`, `cnf`) first, so nothing can change what was
 * verified. Internal: the MCP authorization layer calls it on the object it puts on the context,
 * and nothing else may.
 *
 * @returns the same object, frozen
 */
export function brandVerifiedCredentials<T extends object>(credentials: T): Readonly<T> {
	for (const value of Object.values(credentials)) {
		if (typeof value === 'object' && value !== null) Object.freeze(value);
	}
	Object.freeze(credentials);
	verified.add(credentials);
	return credentials;
}

/**
 * Remove the brand when the request that verified `credentials` ends. Internal, as
 * {@link brandVerifiedCredentials} is: the MCP authorization layer calls it.
 */
export function unbrandVerifiedCredentials(credentials: object): void {
	verified.delete(credentials);
}

/**
 * Whether `credentials` is the object afd-server put on a call after verifying its token, and
 * its `expiresAt` (whole seconds since the epoch, M4) is still after `now`. A copy, an object
 * built with the same fields, branded credentials without a numeric `expiresAt`, and unbranded
 * ones are not. Pass this to afd-auth's `createAuthMiddleware({ isVerifiedCredentials })`, which
 * gives `now` from its clock, so a token's call keeps its actor.
 *
 * @param now - milliseconds since the epoch. Default: `Date.now()`.
 */
export function isVerifiedCredentials(credentials: unknown, now: number = Date.now()): boolean {
	if (typeof credentials !== 'object' || credentials === null || !verified.has(credentials)) {
		return false;
	}
	const { expiresAt } = credentials as { expiresAt?: unknown };
	return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt * 1000 > now;
}
