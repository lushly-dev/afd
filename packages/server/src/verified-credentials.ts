/**
 * @fileoverview The brand on `credentials` that afd-server set on a call itself, after verifying
 * the call's token (`spec/authorization.md`, M4).
 *
 * The brand is a module-private `WeakSet`: only this package can add to it, and no entry exports
 * {@link brandVerifiedCredentials} or {@link unbrandVerifiedCredentials}. Credentials a caller
 * builds and puts on a context itself, on a direct registry or through `createContext`, are never
 * branded, so code that trusts {@link isVerifiedCredentials} trusts only what afd-server verified.
 */

const verified = new WeakMap<object, number>();

/**
 * Mark `credentials` as set by afd-server after it verified the call's token, freezing them and
 * their object and array fields (`scopes`, `cnf`) first, so nothing can change what was
 * verified. Internal: the MCP authorization layer calls it on the object it puts on the context,
 * and nothing else may.
 *
 * @param skewS - clock skew in seconds the admission layer accepted past `expiresAt`. Default: `0`.
 * @returns the same object, frozen
 */
export function brandVerifiedCredentials<T extends object>(credentials: T, skewS = 0): Readonly<T> {
	for (const value of Object.values(credentials)) {
		if (typeof value === 'object' && value !== null) Object.freeze(value);
	}
	Object.freeze(credentials);
	const { expiresAt } = credentials as { expiresAt?: unknown };
	const deadline =
		typeof expiresAt === 'number' &&
		Number.isFinite(expiresAt) &&
		Number.isFinite(skewS) &&
		skewS >= 0
			? (expiresAt + skewS) * 1000
			: Number.NaN;
	verified.set(credentials, deadline);
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
 * If `credentials` is branded as verified by afd-server, return a frozen shallow copy branded
 * with the same admission deadline (so a background task outliving its HTTP response keeps its
 * verified brand until the task finishes, when it calls {@link unbrandVerifiedCredentials}).
 * Returns `undefined` when `credentials` is not branded.
 */
export function cloneVerifiedCredentials<T extends object>(
	credentials: T
): Readonly<T> | undefined {
	const deadline = verified.get(credentials);
	if (deadline === undefined) return undefined;
	const copy: Record<string, unknown> = { ...(credentials as Record<string, unknown>) };
	if (Array.isArray(copy.scopes)) copy.scopes = Object.freeze([...copy.scopes]);
	if (copy.cnf && typeof copy.cnf === 'object') {
		copy.cnf = Object.freeze({ ...(copy.cnf as Record<string, unknown>) });
	}
	const inspectSymbol = Symbol.for('nodejs.util.inspect.custom');
	const inspectDesc = Object.getOwnPropertyDescriptor(credentials, inspectSymbol);
	if (inspectDesc) {
		Object.defineProperty(copy, inspectSymbol, inspectDesc);
	}
	Object.freeze(copy);
	verified.set(copy, deadline);
	return copy as Readonly<T>;
}

/**
 * Whether `credentials` is the object afd-server put on a call after verifying its token, and
 * its admitted expiry (`expiresAt` plus any admission clock skew, M4) is still after `now`. A
 * copy, an object built with the same fields, branded credentials without a numeric `expiresAt`,
 * and unbranded ones are not. Pass this to afd-auth's `createAuthMiddleware({ isVerifiedCredentials })`,
 * which gives `now` from its clock, so a token's call keeps its actor.
 *
 * @param now - milliseconds since the epoch. Default: `Date.now()`.
 */
export function isVerifiedCredentials(credentials: unknown, now: number = Date.now()): boolean {
	if (typeof credentials !== 'object' || credentials === null) {
		return false;
	}
	const deadline = verified.get(credentials);
	return deadline !== undefined && Number.isFinite(deadline) && deadline > now;
}
