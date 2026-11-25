/**
 * @fileoverview Whether afd-auth's middleware on a server with MCP token authorization can tell
 * a token's call from a local session's.
 *
 * afd-auth's `createAuthMiddleware` marks itself under a registered symbol with whether it was
 * given `isVerifiedCredentials`. Without it, a call carrying the credentials this server verified
 * is gated on the local adapter's session and runs as the session's user. A server with `auth`
 * refuses to be built with such a middleware, directly in `middleware` or inside
 * `composeMiddleware`, rather than serve every token's call as that user.
 */

/** Registered, so a middleware made by any installed copy of afd-auth is recognised. */
const MARK = Symbol.for('dev.afd/auth-middleware-credentials');

interface AuthMiddlewareMark {
	/** Whether the middleware was given `isVerifiedCredentials`. */
	recognisesVerifiedCredentials: boolean;
}

function markOf(middleware: unknown): AuthMiddlewareMark | undefined {
	return typeof middleware === 'function' && Object.hasOwn(middleware, MARK)
		? (middleware as unknown as Record<symbol, AuthMiddlewareMark>)[MARK]
		: undefined;
}

/**
 * Mark `composed` as unable to recognise verified credentials when any of `parts` is: one such
 * part in a composition is enough to stamp the session on a token's call.
 */
export function carryAuthMiddlewareMark(composed: object, parts: readonly unknown[]): void {
	const marks = parts.map(markOf).filter((mark) => mark !== undefined);
	if (marks.length === 0) return;
	Object.defineProperty(composed, MARK, {
		value: {
			recognisesVerifiedCredentials: marks.every((mark) => mark.recognisesVerifiedCredentials),
		},
	});
}

/**
 * Throw when a server with `auth` runs afd-auth's middleware without `isVerifiedCredentials`.
 *
 * @param hasAuth - whether the server verifies bearer tokens (its `auth` option)
 * @param middleware - the server's `middleware` option
 */
export function assertAuthMiddlewareRecognisesTokens(
	hasAuth: boolean,
	middleware: readonly unknown[] | undefined
): void {
	if (!hasAuth) return;
	if ((middleware ?? []).some((step) => markOf(step)?.recognisesVerifiedCredentials === false)) {
		throw new Error(
			'afd-auth middleware on a server with auth needs isVerifiedCredentials: without it every ' +
				"token's call is gated on the local adapter's session and runs as its user. Pass " +
				'createAuthMiddleware(adapter, { isVerifiedCredentials }), importing isVerifiedCredentials ' +
				'from @lushly-dev/afd-server/credentials'
		);
	}
}
