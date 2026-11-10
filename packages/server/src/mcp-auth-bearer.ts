/**
 * @fileoverview The one bearer token of a request (`spec/authorization.md`, M2).
 */

import type { AuthRuleCode } from './mcp-auth-rules.js';

/**
 * `Bearer 1*SP b64token` (RFC 6750 2.1), the scheme in any ASCII case, around which an HTTP parser
 * may have left spaces or tabs. One anchored match whose parts cannot overlap (no space or tab
 * inside a `b64token`), so it runs in time linear in the value: it reads an unauthenticated
 * header on every route.
 */
const BEARER = /^[ \t]*bearer +([A-Za-z0-9\-._~+/]+=*)[ \t]*$/i;

/** The token of a `Bearer` value, or `undefined` when the value breaks M2's grammar. */
function parseBearer(value: string): string | undefined {
	return BEARER.exec(value)?.[1];
}

/** Percent- and `+`-decoding of one form name, bytewise. A malformed escape is kept as written. */
function formDecode(encoded: string): string {
	return encoded
		.replace(/\+/g, ' ')
		.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
			String.fromCharCode(Number.parseInt(hex, 16))
		);
}

/** Whether an `application/x-www-form-urlencoded` string has a parameter named `access_token`. */
function namesAccessToken(encoded: string): boolean {
	return encoded
		.split('&')
		.some((pair) => formDecode(pair.split('=', 1)[0] ?? '') === 'access_token');
}

/** The token, or the rule a request broke. */
export type BearerResult = { token: string } | { refused: AuthRuleCode };

/**
 * The one bearer token of a request (`spec/authorization.md`, M2), or the rule it breaks.
 *
 * - `authorization` holds every `Authorization` header value, in order (`[]` for none).
 * - `query` is the request's query string without its `?`, and `formBody` the body of a request
 *   whose `Content-Type` is `application/x-www-form-urlencoded`. An `access_token` parameter in
 *   either refuses the request, even beside a valid header.
 *
 * Refused with `token-location` (a token in the query or a form body, or a second header;
 * checked first), `no-token`, or `token-malformed` (not `Bearer <b64token>`).
 */
export function extractBearer(
	authorization: readonly string[],
	query?: string,
	formBody?: string
): BearerResult {
	if (
		(query !== undefined && namesAccessToken(query)) ||
		(formBody !== undefined && namesAccessToken(formBody)) ||
		authorization.length > 1
	) {
		return { refused: 'token-location' };
	}
	const value = authorization[0];
	if (value === undefined) return { refused: 'no-token' };
	const token = parseBearer(value);
	return token === undefined ? { refused: 'token-malformed' } : { token };
}
