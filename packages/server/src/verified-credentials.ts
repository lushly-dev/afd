/**
 * @fileoverview The brand on `credentials` that afd-server set on a call itself, after verifying
 * the call's token (`spec/authorization.md`, M4).
 *
 * The brand is a module-private `WeakSet`: only this package can add to it, and no entry exports
 * {@link brandVerifiedCredentials}. Credentials a caller builds and puts on a context itself, on
 * a direct registry or through `createContext`, are never branded, so code that trusts
 * {@link isVerifiedCredentials} trusts only what afd-server verified.
 */

const verified = new WeakSet<object>();

/**
 * Mark `credentials` as set by afd-server after it verified the call's token. Internal: the MCP
 * authorization layer calls it on the object it puts on the context, and nothing else may.
 *
 * @returns the same object
 */
export function brandVerifiedCredentials<T extends object>(credentials: T): T {
	verified.add(credentials);
	return credentials;
}

/**
 * Whether `credentials` is the object afd-server put on a call after verifying its token. A copy,
 * or an object built with the same fields, is not. Pass this to afd-auth's
 * `createAuthMiddleware({ isVerifiedCredentials })` so a token's call keeps its actor.
 */
export function isVerifiedCredentials(credentials: unknown): boolean {
	return typeof credentials === 'object' && credentials !== null && verified.has(credentials);
}
