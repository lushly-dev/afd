/**
 * @fileoverview Token rules that need no key and no network (`spec/authorization.md`, M3 rules 2,
 * 3 and 5 to 10, M3.2 and M4), shared by AFD's JWT verifier and a host's introspection verifier.
 * Each rule is checked here explicitly, in the specification's order: no library default is
 * relied on.
 */

import { assertHttpsUrl, audienceAccepts, isScopeToken } from './mcp-auth-resource.js';

/** The rule a refused token or request broke (`spec/authorization.md`, M5). Logged, never sent. */
export type AuthRuleCode =
	| 'no-token'
	| 'token-location'
	| 'token-malformed'
	| 'unknown-issuer'
	| 'typ'
	| 'alg'
	| 'kid'
	| 'crit'
	| 'key-reference'
	| 'key'
	| 'signature'
	| 'issuer'
	| 'audience'
	| 'claims'
	| 'expired'
	| 'not-yet-valid'
	| 'lifetime'
	| 'scope-malformed'
	| 'scopes-too-many'
	| 'dpop-unsupported'
	| 'binding'
	| 'inactive'
	| 'unavailable';

/** Every rule code, in the specification's order. */
export const AUTH_RULE_CODES: readonly AuthRuleCode[] = Object.freeze([
	'no-token',
	'token-location',
	'token-malformed',
	'unknown-issuer',
	'typ',
	'alg',
	'kid',
	'crit',
	'key-reference',
	'key',
	'signature',
	'issuer',
	'audience',
	'claims',
	'expired',
	'not-yet-valid',
	'lifetime',
	'scope-malformed',
	'scopes-too-many',
	'dpop-unsupported',
	'binding',
	'inactive',
	'unavailable',
]);

/**
 * The verified claims of one request's access token (`spec/authorization.md`, M4): what a command
 * sees as `context.credentials` on a call the server verified. Never the token.
 */
export interface Credentials {
	/** `iss`: the issuer, exactly as configured. */
	readonly issuer: string;
	/** `sub`: the subject. */
	readonly subject: string;
	/** `client_id`: the OAuth client the token was issued to. */
	readonly clientId: string;
	/** `scope`, parsed (M3.2): each scope once, in token order. */
	readonly scopes: readonly string[];
	/** The server's configured resource, as configured (not the token's spelling of `aud`). */
	readonly resource: string;
	/** `exp`, in whole seconds since the epoch, rounded down. */
	readonly expiresAt: number;
	/** `iat`, in whole seconds since the epoch, rounded down. */
	readonly issuedAt: number;
	/** `auth_time`, in whole seconds since the epoch, rounded down, when present. */
	readonly authTime?: number;
	/** `acr`, when present. */
	readonly acr?: string;
	/** The TLS client certificate the token is bound to (RFC 8705 3.1), when it is bound. */
	readonly cnf?: { readonly 'x5t#S256': string };
}

/** The largest clock skew a verifier may allow, in seconds. */
export const MAX_CLOCK_SKEW_S = 300;
/** The default clock skew, in seconds. */
export const DEFAULT_CLOCK_SKEW_S = 60;
/** The default longest token lifetime (`exp - iat`), in seconds. */
export const DEFAULT_MAX_TOKEN_LIFETIME_S = 3600;
/** The default scope limit. */
export const DEFAULT_SCOPE_LIMIT = 64;
/** The most Unicode code points a `jti`, `sub`, `client_id` or `acr` may hold. */
export const MAX_CLAIM_CHARS = 255;

/** What {@link createTokenRules} takes. */
export interface TokenRulesOptions {
	/** The resource: the only audience accepted, and the credentials' `resource`. */
	resource: string;
	/** The clock skew allowed on `exp`, `iat` and `nbf`, in seconds. Default 60, at most 300. */
	clockSkewS?: number;
	/** The longest `exp - iat` accepted, in seconds. Default 3600, at least 1. */
	maxTokenLifetimeS?: number;
	/** Count only scopes starting with `<prefix>:` against the limit. Default: every scope. */
	scopePrefix?: string;
	/** The most scopes a token may hold (under the prefix, when set). Default 64, at least 1. */
	scopeLimit?: number;
	/** Refuse every token that is not bound to the TLS client certificate. Default `false`. */
	requireBoundTokens?: boolean;
}

/** The rules a verified token's claims must pass (M3 rules 6 to 10), checked and frozen. */
export interface TokenRules {
	readonly resource: string;
	readonly clockSkewS: number;
	readonly maxTokenLifetimeS: number;
	readonly scopePrefix: string | undefined;
	readonly scopeLimit: number;
	readonly requireBoundTokens: boolean;
}

function wholeNumber(what: string, value: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error(`[AFD] ${what} must be a whole number from ${min} to ${max}`);
	}
	return value;
}

/**
 * The claim rules for tokens whose audience is `options.resource`.
 *
 * @throws Error when the resource is not an absolute `https` URL without user information, query
 *   or fragment, the skew is over 300 seconds, the lifetime or limit is under 1, or the prefix
 *   is not a scope token
 */
export function createTokenRules(options: TokenRulesOptions): TokenRules {
	assertHttpsUrl('resource', options.resource);
	const prefix = options.scopePrefix;
	if (prefix !== undefined && !isScopeToken(prefix)) {
		throw new Error(`[AFD] scope prefix ${JSON.stringify(prefix)} is not an OAuth scope token`);
	}
	return Object.freeze({
		resource: options.resource,
		clockSkewS: wholeNumber(
			'clockSkewS',
			options.clockSkewS ?? DEFAULT_CLOCK_SKEW_S,
			0,
			MAX_CLOCK_SKEW_S
		),
		maxTokenLifetimeS: wholeNumber(
			'maxTokenLifetimeS',
			options.maxTokenLifetimeS ?? DEFAULT_MAX_TOKEN_LIFETIME_S,
			1
		),
		scopePrefix: prefix,
		scopeLimit: wholeNumber('scopeLimit', options.scopeLimit ?? DEFAULT_SCOPE_LIMIT, 1),
		requireBoundTokens: options.requireBoundTokens === true,
	});
}

/** A rule's outcome: a value, or the code of the rule that refused. */
export type RuleResult<T> = { ok: true; value: T } | { ok: false; rule: AuthRuleCode };

const pass = <T>(value: T): RuleResult<T> => ({ ok: true, value });
const refuse = <T = never>(rule: AuthRuleCode): RuleResult<T> => ({ ok: false, rule });

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A `scope` claim parsed (`spec/authorization.md`, M3.2; `undefined` when absent): scope tokens
 * separated by single spaces, each kept once at its first place. An empty string or no claim
 * grants no scope. Only scopes starting with `<prefix>:` count against `limit` when a prefix is
 * given. Refused with `scope-malformed` or `scopes-too-many`.
 */
export function parseScopeClaim(
	scope: unknown,
	prefix: string | undefined,
	limit: number
): RuleResult<string[]> {
	if (scope === undefined) return pass([]);
	if (typeof scope !== 'string') return refuse('scope-malformed');
	if (scope === '') return pass([]);
	const scopes: string[] = [];
	for (const token of scope.split(' ')) {
		if (!isScopeToken(token)) return refuse('scope-malformed');
		if (!scopes.includes(token)) scopes.push(token);
	}
	const counted =
		prefix === undefined
			? scopes.length
			: scopes.filter((held) => held.startsWith(`${prefix}:`)).length;
	return counted > limit ? refuse('scopes-too-many') : pass(scopes);
}

/** The JWS algorithms AFD's verifier can check. `none` and `HS*` are always refused. */
export type SigningAlgorithm =
	| 'RS256'
	| 'RS384'
	| 'RS512'
	| 'PS256'
	| 'PS384'
	| 'PS512'
	| 'ES256'
	| 'ES384'
	| 'EdDSA';

/** Every {@link SigningAlgorithm}. */
export const SIGNING_ALGORITHMS: readonly SigningAlgorithm[] = Object.freeze([
	'RS256',
	'RS384',
	'RS512',
	'PS256',
	'PS384',
	'PS512',
	'ES256',
	'ES384',
	'EdDSA',
]);

const TYP = new Set(['at+jwt', 'application/at+jwt']);
const KEY_REFERENCES = ['jku', 'x5u', 'x5c', 'jwk'];

/**
 * Rule 2 on a decoded JWS header, against the issuer's algorithm list: `typ`, then `alg`, `kid`,
 * `crit` and the key references, the first broken rule refusing. `none` and every `HS*`
 * algorithm are refused whatever the list says.
 */
export function checkJwsHeader(header: unknown, algorithms: readonly string[]): RuleResult<void> {
	if (!isRecord(header)) return refuse('typ');
	const { typ, alg, kid } = header;
	if (typeof typ !== 'string' || !TYP.has(typ.toLowerCase())) return refuse('typ');
	if (
		typeof alg !== 'string' ||
		alg === 'none' ||
		alg.startsWith('HS') ||
		!algorithms.includes(alg)
	) {
		return refuse('alg');
	}
	if (typeof kid !== 'string' || kid === '') return refuse('kid');
	if (Object.hasOwn(header, 'crit')) return refuse('crit');
	if (KEY_REFERENCES.some((member) => Object.hasOwn(header, member))) {
		return refuse('key-reference');
	}
	return pass(undefined);
}

/** The `kty`, and `crv` when it matters, each algorithm needs (RFC 7518 3.4, RFC 8037 3.1). */
function keyFits(alg: string, kty: unknown, crv: unknown): boolean {
	switch (alg) {
		case 'RS256':
		case 'RS384':
		case 'RS512':
		case 'PS256':
		case 'PS384':
		case 'PS512':
			return kty === 'RSA';
		case 'ES256':
			return kty === 'EC' && crv === 'P-256';
		case 'ES384':
			return kty === 'EC' && crv === 'P-384';
		case 'ES512':
			return kty === 'EC' && crv === 'P-521';
		case 'EdDSA':
			return kty === 'OKP' && (crv === 'Ed25519' || crv === 'Ed448');
		default:
			return false;
	}
}

/**
 * Rule 3 on a header that passed rule 2 and the issuer's key with its `kid` (`undefined` for
 * none): the key's `kid` is the header's; its `kty` is the `alg`'s family; its `alg`, when
 * present, is the header's; its `use`, when present, is `sig`; its `key_ops`, when present,
 * contain `verify`. Refused with `key`.
 */
export function checkKeyFit(header: unknown, key: unknown): RuleResult<void> {
	if (!isRecord(header) || !isRecord(key)) return refuse('key');
	const { alg, kid } = header;
	if (typeof alg !== 'string' || typeof kid !== 'string' || key.kid !== kid) return refuse('key');
	if (!keyFits(alg, key.kty, key.crv)) return refuse('key');
	if (Object.hasOwn(key, 'alg') && key.alg !== alg) return refuse('key');
	if (Object.hasOwn(key, 'use') && key.use !== 'sig') return refuse('key');
	if (Object.hasOwn(key, 'key_ops')) {
		const ops = key.key_ops;
		if (!Array.isArray(ops) || !ops.includes('verify')) return refuse('key');
	}
	return pass(undefined);
}

const CONTROL = /\p{Cc}/u;

/** A string claim of rule 7: non-empty, at most 255 code points, no control character. */
function claimText(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value !== '' &&
		[...value].length <= MAX_CLAIM_CHARS &&
		!CONTROL.test(value)
	);
}

const isTime = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** Redacted debug output (M4): every field but `issuer` and `expiresAt` prints `[redacted]`. */
function inspectRedacted(this: Credentials): string {
	const fields = this as unknown as Record<string, unknown>;
	const shown = Object.keys(fields).map((key) =>
		key === 'issuer' || key === 'expiresAt'
			? `${key}: ${JSON.stringify(fields[key])}`
			: `${key}: '[redacted]'`
	);
	return `Credentials { ${shown.join(', ')} }`;
}

/**
 * `fields` as credentials whose Node.js debug form (`util.inspect`, `console.log`) redacts every
 * field but `issuer` and `expiresAt` (M4). JSON keeps every field.
 */
export function withRedactedInspect(fields: Credentials): Credentials {
	Object.defineProperty(fields, Symbol.for('nodejs.util.inspect.custom'), {
		value: inspectRedacted,
		enumerable: false,
	});
	return fields;
}

/**
 * Rules 5 to 10 on a token's claims after its signature (or on an introspection response), at
 * `now` (whole seconds since the epoch), for `issuer` (its exact configured string) under
 * `rules`. `certificate` is the SHA-256 thumbprint (unpadded base64url) of the request's TLS
 * client certificate, `undefined` for none.
 *
 * Rule 10 also refuses a `cnf` that is not an object, and one holding a confirmation method
 * other than `x5t#S256` (`jkt` is `dpop-unsupported`, anything else `binding`).
 */
export function checkClaims(
	claims: Record<string, unknown>,
	issuer: string,
	rules: TokenRules,
	now: number,
	certificate?: string
): RuleResult<Credentials> {
	// 5. Issuer.
	if (claims.iss !== issuer) return refuse('issuer');
	// 6. Audience: never optional.
	if (!audienceAccepts(claims.aud, rules.resource)) return refuse('audience');
	// 7. Required claims.
	const { exp, iat, nbf, auth_time: authTime, acr, jti, sub, client_id: clientId } = claims;
	if (!isTime(exp) || !isTime(iat)) return refuse('claims');
	if (!claimText(jti) || !claimText(sub) || !claimText(clientId)) return refuse('claims');
	if (Object.hasOwn(claims, 'nbf') && !isTime(nbf)) return refuse('claims');
	if (Object.hasOwn(claims, 'auth_time') && !isTime(authTime)) return refuse('claims');
	if (Object.hasOwn(claims, 'acr') && !claimText(acr)) return refuse('claims');
	// 8. Time.
	const skew = rules.clockSkewS;
	if (now >= exp + skew) return refuse('expired');
	if (iat > now + skew || (isTime(nbf) && nbf > now + skew)) return refuse('not-yet-valid');
	// A token that expires before it was issued has no lifetime at all.
	if (exp < iat || exp - iat > rules.maxTokenLifetimeS) return refuse('lifetime');
	// 9. Scopes.
	const scopes = parseScopeClaim(claims.scope, rules.scopePrefix, rules.scopeLimit);
	if (!scopes.ok) return scopes;
	// 10. Binding.
	let thumbprint: string | undefined;
	if (Object.hasOwn(claims, 'cnf')) {
		const cnf = claims.cnf;
		if (!isRecord(cnf)) return refuse('binding');
		if (Object.hasOwn(cnf, 'jkt')) return refuse('dpop-unsupported');
		if (Object.keys(cnf).some((method) => method !== 'x5t#S256')) return refuse('binding');
		if (Object.hasOwn(cnf, 'x5t#S256')) {
			const bound = cnf['x5t#S256'];
			if (typeof bound !== 'string' || certificate === undefined || bound !== certificate) {
				return refuse('binding');
			}
			thumbprint = bound;
		}
	}
	if (thumbprint === undefined && rules.requireBoundTokens) return refuse('binding');
	return pass(
		withRedactedInspect({
			issuer,
			subject: sub,
			clientId,
			scopes: scopes.value,
			resource: rules.resource,
			expiresAt: Math.floor(exp),
			issuedAt: Math.floor(iat),
			...(isTime(authTime) ? { authTime: Math.floor(authTime) } : {}),
			...(typeof acr === 'string' ? { acr } : {}),
			...(thumbprint !== undefined ? { cnf: { 'x5t#S256': thumbprint } } : {}),
		})
	);
}

const INTROSPECTION_REQUIRED = ['exp', 'iat', 'iss', 'aud', 'sub', 'client_id'];

/**
 * An RFC 7662 introspection response for the one issuer configured for introspection
 * (`spec/authorization.md`, M3, "Introspection"): `active` must be `true` (else `inactive`), and
 * `exp`, `iat`, `iss`, `aud`, `sub` and `client_id` must be present (else `claims`); rules 5 to
 * 10 ({@link checkClaims}) then apply to it, `jti` among rule 7's claims.
 */
export function checkIntrospection(
	response: unknown,
	issuer: string,
	rules: TokenRules,
	now: number,
	certificate?: string
): RuleResult<Credentials> {
	if (!isRecord(response) || response.active !== true) return refuse('inactive');
	if (INTROSPECTION_REQUIRED.some((field) => !Object.hasOwn(response, field))) {
		return refuse('claims');
	}
	return checkClaims(response, issuer, rules, now, certificate);
}
