/**
 * @fileoverview AFD's JWT access-token verifier (`spec/authorization.md`, M3, RFC 9068), its key
 * sources, and introspection as the alternative for opaque tokens.
 *
 * `jose` checks the signature, through WebCrypto, and nothing else: AFD never calls `jwtVerify`,
 * so no library default applies. Routing, every header and key rule, and every claim rule are
 * this module's and `mcp-auth-rules.ts`'s own code, in the specification's order. AFD opens no
 * socket: keys and introspection answers come from the host.
 */

import { createHash } from 'node:crypto';
import { type Clock, systemClock } from '@lushly-dev/afd-core';
import { compactVerify, errors, importJWK } from 'jose';
import { assertHttpsUrl } from './mcp-auth-resource.js';
import {
	type AuthRuleCode,
	type Credentials,
	checkClaims,
	checkIntrospection,
	checkJwsHeader,
	checkKeyFit,
	createTokenRules,
	type RuleResult,
	SIGNING_ALGORITHMS,
	type SigningAlgorithm,
	type TokenRules,
	type TokenRulesOptions,
} from './mcp-auth-rules.js';
import { decodeBase64url, decodeJoseObject } from './strict-json.js';

/** What a {@link TokenVerifier} knows of the request a token came on. Never a header. */
export interface TokenRequest {
	/**
	 * The SHA-256 thumbprint (unpadded base64url, RFC 8705 3.1) of the TLS client certificate the
	 * request was made with; `undefined` when there is none.
	 */
	readonly certificate?: string;
}

/**
 * A verifier's answer: the credentials, or the rule the token broke. `rule` is an M5 rule code,
 * or a host's own code for a refusal of its own (logged, never sent; every refusal is the same
 * 401 with `error="invalid_token"`). `issuer` is the alias of the issuer the token was routed
 * to, once known: never the `iss` claim as sent.
 */
export type TokenVerification =
	| { ok: true; credentials: Credentials }
	| { ok: false; rule: AuthRuleCode | (string & {}); issuer?: string };

/**
 * Verifies one request's bearer token (`spec/authorization.md`, M3). AFD's {@link JwtVerifier}
 * handles JWTs; {@link createIntrospectionVerifier} handles opaque tokens through the host's
 * introspection call. A host may wrap either to refuse more (its own `rule`), never to accept
 * what it refused. A throw fails the request closed as `unavailable`.
 */
export interface TokenVerifier {
	verify(token: string, request: TokenRequest): Promise<TokenVerification>;
	/**
	 * The claim rules this verifier applies, when it can say: `createMcpHandler` then checks that
	 * the metadata publishes the same resource and binding requirement.
	 */
	readonly rules?: TokenRules;
	/**
	 * The exact `iss` strings whose tokens this verifier accepts, when it can say:
	 * `createMcpHandler` then checks that the metadata names each in `authorizationServers`.
	 */
	readonly issuers?: readonly string[];
}

/** Why a {@link KeySource} gave no key: `unknown` refuses with `key`, `unavailable` fails closed. */
export type KeyLookup =
	| { key: Readonly<Record<string, unknown>> }
	| { error: 'unknown' | 'unavailable' };

/**
 * Where an issuer's signing keys come from (`spec/authorization.md`, M3 rule 3). The host fetches
 * them; AFD opens no socket. The `kid` comes from a token not yet verified, so it is the
 * caller's choice: refetch on an unknown `kid` at most once in a while, and keep the last good
 * keys, as {@link jwksKeySource} does.
 */
export interface KeySource {
	/** The key of `issuer` (its exact configured string) with this `kid`. */
	key(issuer: string, kid: string): Promise<KeyLookup>;
}

/** What {@link jwksKeySource} takes besides the document or its loader. */
export interface JwksKeySourceOptions {
	/** The shortest time between two loads, in milliseconds. Default: 30 seconds. */
	minRefetchIntervalMs?: number;
	/** How long loaded keys are used before they are loaded again, in milliseconds. Default: 5 minutes. */
	maxAgeMs?: number;
	/**
	 * How long the last good keys are kept while every load fails, in milliseconds, counted from
	 * the load that fetched them. Past it the source answers `unavailable`, so a key the issuer
	 * withdrew stops verifying even when its JWKS cannot be reached. Default: 1 hour; at least
	 * `maxAgeMs`.
	 */
	maxStaleMs?: number;
	/** The clock the intervals read. Default: the system clock. */
	clock?: Clock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The keys of a JWKS document by `kid`, or the reason it is not one. */
function readJwks(document: unknown): Map<string, Readonly<Record<string, unknown>>> | string {
	const keys = isRecord(document) ? document.keys : undefined;
	if (!Array.isArray(keys)) return 'a JWKS document has a "keys" array';
	const byKid = new Map<string, Readonly<Record<string, unknown>>>();
	for (const key of keys) {
		if (!isRecord(key) || typeof key.kid !== 'string' || key.kid === '') {
			return 'every key of a JWKS document is an object with a non-empty kid';
		}
		if (byKid.has(key.kid)) return `kid ${JSON.stringify(key.kid)} appears more than once`;
		byKid.set(key.kid, Object.freeze({ ...key }));
	}
	return byKid;
}

/**
 * A {@link KeySource} over a JWKS document (RFC 7517 5): fixed, or loaded by the host's `load`
 * (which fetches the issuer's `jwks_uri`, say). Loaded keys are used for `maxAgeMs`; an unknown
 * `kid` loads again at most once per `minRefetchIntervalMs`; a failed load keeps the last good
 * keys for up to `maxStaleMs`, and with none (or when a load for an unknown `kid` fails, or the
 * keys are older than `maxStaleMs`) answers `unavailable`.
 *
 * Give each issuer a key source of its own: a `kid` names a key only within one issuer's set,
 * and `JwtVerifier` refuses two issuers that share one.
 *
 * @throws Error for a fixed document that has no `keys` array, or a key without a non-empty
 *   `kid` or with one another key has; or `maxStaleMs` shorter than `maxAgeMs`
 */
export function jwksKeySource(jwks: unknown, options: JwksKeySourceOptions = {}): KeySource {
	if (typeof jwks !== 'function') {
		const keys = readJwks(jwks);
		if (typeof keys === 'string') throw new Error(`[AFD] ${keys}`);
		return {
			key: async (_issuer, kid) => {
				const key = keys.get(kid);
				return key ? { key } : { error: 'unknown' };
			},
		};
	}
	const load = jwks as () => Promise<unknown>;
	const clock = options.clock ?? systemClock;
	const minInterval = options.minRefetchIntervalMs ?? 30_000;
	const maxAge = options.maxAgeMs ?? 300_000;
	const maxStale = options.maxStaleMs ?? 3_600_000;
	if (!(maxStale >= maxAge)) throw new Error('[AFD] maxStaleMs must be at least maxAgeMs');
	let keys: Map<string, Readonly<Record<string, unknown>>> | undefined;
	let loadedAt = Number.NEGATIVE_INFINITY;
	let attemptedAt = Number.NEGATIVE_INFINITY;
	let pending: Promise<boolean> | undefined;

	async function attempt(): Promise<boolean> {
		try {
			const read = readJwks(await load());
			if (typeof read === 'string') return false;
			keys = read;
			loadedAt = clock.now();
			return true;
		} catch {
			return false;
		}
	}

	/** Load once, shared by concurrent callers; whether this load succeeded. */
	function refresh(): Promise<boolean> {
		if (!pending) {
			attemptedAt = clock.now();
			pending = attempt().finally(() => {
				pending = undefined;
			});
		}
		return pending;
	}

	return {
		async key(_issuer, kid) {
			const now = clock.now();
			const mayLoad = now - attemptedAt >= minInterval;
			if ((keys === undefined || now - loadedAt >= maxAge) && (mayLoad || pending)) {
				await refresh();
			}
			// Keys older than `maxStaleMs` (every load since has failed) verify nothing.
			if (keys === undefined || clock.now() - loadedAt >= maxStale) return { error: 'unavailable' };
			const known = keys.get(kid);
			if (known) return { key: known };
			if (clock.now() - attemptedAt >= minInterval || pending) {
				if (!(await refresh())) return { error: 'unavailable' };
				const fetched = keys?.get(kid);
				if (fetched) return { key: fetched };
			}
			return { error: 'unknown' };
		},
	};
}

/** One issuer whose JWT access tokens a {@link JwtVerifier} accepts. */
export interface JwtIssuer {
	/** The issuer's exact `iss` string: an absolute `https` URL. */
	issuer: string;
	/** The algorithms it signs with. `none` and `HS*` are never accepted. */
	algorithms: readonly SigningAlgorithm[];
	/** Where its keys come from. */
	keys: KeySource;
	/** Logged with a refused token's rule code. Default: `issuer`. */
	alias?: string;
}

/** What {@link JwtVerifier} takes. */
export interface JwtVerifierOptions {
	/** The claim rules: the resource (the only audience accepted), skew, lifetime and scopes. */
	rules: TokenRules | TokenRulesOptions;
	/** The issuers whose tokens are accepted; at least one, none twice. */
	issuers: readonly JwtIssuer[];
	/** The one introspection issuer, which every token that is not a compact JWS goes to. */
	introspection?: TokenVerifier;
	/** The clock the time rules read. Default: the system clock. */
	clock?: Clock;
}

const COMPACT_PART = /^[A-Za-z0-9_-]*$/;

/** The three parts of a compact JWS (the first two non-empty), or `undefined` (M3 rule 1). */
function compactJwsParts(token: string): [string, string, string] | undefined {
	const parts = token.split('.');
	if (parts.length !== 3) return undefined;
	const [header, payload, signature] = parts as [string, string, string];
	if (header === '' || payload === '' || !parts.every((part) => COMPACT_PART.test(part))) {
		return undefined;
	}
	return [header, payload, signature];
}

/** Whether `token` has the shape of a compact JWS: the routing test of M3 rule 1. */
export function isCompactJws(token: string): boolean {
	return compactJwsParts(token) !== undefined;
}

/** The public members each key type needs for verification; nothing else reaches `jose`. */
const PUBLIC_MEMBERS: Record<string, readonly string[]> = {
	RSA: ['n', 'e'],
	EC: ['crv', 'x', 'y'],
	OKP: ['crv', 'x'],
};

/** Coordinate sizes in bytes, where the curve fixes them. */
const COORDINATE_BYTES: Partial<Record<SigningAlgorithm, number>> = {
	ES256: 32,
	ES384: 48,
	EdDSA: 32,
};

/**
 * The verification key of a JWK that passed rule 3, holding only its public members, or
 * `undefined` when its material is unusable (bad base64url, a coordinate of the wrong length, an
 * Ed448 key, which this verifier does not implement).
 */
async function verificationKey(alg: SigningAlgorithm, jwk: Readonly<Record<string, unknown>>) {
	const kty = jwk.kty as string;
	const members = PUBLIC_MEMBERS[kty] ?? [];
	const material: Record<string, string> = { kty };
	for (const member of members) {
		const value = jwk[member];
		if (typeof value !== 'string' || value === '') return undefined;
		if (member !== 'crv' && !decodeBase64url(value)?.length) return undefined;
		material[member] = value;
	}
	if (alg === 'EdDSA' && material.crv !== 'Ed25519') return undefined;
	const size = COORDINATE_BYTES[alg];
	if (size !== undefined) {
		const coordinates = alg === 'EdDSA' ? ['x'] : ['x', 'y'];
		for (const member of coordinates) {
			if (decodeBase64url(material[member] as string)?.length !== size) return undefined;
		}
	}
	try {
		return await importJWK(material, alg);
	} catch {
		return undefined;
	}
}

interface Issuer extends JwtIssuer {
	alias: string;
}

/**
 * AFD's verifier of JWT access tokens (RFC 9068), applying `spec/authorization.md` M3 in order.
 *
 * A compact JWS goes to the configured issuer its unverified `iss` names exactly (else
 * `unknown-issuer`). Any other token goes to the introspection verifier, when one is configured,
 * and is otherwise refused with `unknown-issuer`: a token is never sent to an issuer that did not
 * issue it. A JWS whose header or payload is not a JSON object with unique member names is
 * refused (`typ` for the header, `unknown-issuer` for the payload). The audience check (M3.1)
 * always runs: `rules.resource` is required.
 */
export class JwtVerifier implements TokenVerifier {
	readonly rules: TokenRules;
	/** The `iss` strings accepted: the JWT issuers', then the introspection verifier's. */
	readonly issuers: readonly string[];
	readonly #issuers: readonly Issuer[];
	readonly #introspection: TokenVerifier | undefined;
	readonly #clock: Clock;

	/**
	 * @throws Error for invalid rules, no issuer, an issuer that is not an absolute `https` URL,
	 *   one with no algorithm or an algorithm AFD cannot verify, two issuers with the same `iss`
	 *   string, alias or key source object, or an introspection verifier whose rules name another
	 *   resource or binding requirement
	 */
	constructor(options: JwtVerifierOptions) {
		this.rules = createTokenRules(options.rules);
		const issuers: Issuer[] = [];
		for (const entry of options.issuers ?? []) {
			assertHttpsUrl('issuer', entry.issuer);
			const alias = entry.alias ?? entry.issuer;
			if (typeof alias !== 'string' || !/^[\x21-\x7E]{1,256}$/.test(alias)) {
				throw new Error(`[AFD] issuer alias ${JSON.stringify(alias)} is not visible ASCII`);
			}
			const algorithms = [...new Set(entry.algorithms ?? [])];
			if (algorithms.length === 0) {
				throw new Error(`[AFD] issuer ${JSON.stringify(alias)} lists no signing algorithm`);
			}
			for (const algorithm of algorithms) {
				if (!SIGNING_ALGORITHMS.includes(algorithm)) {
					throw new Error(`[AFD] AFD cannot verify ${JSON.stringify(algorithm)} signatures`);
				}
			}
			if (typeof entry.keys?.key !== 'function') {
				throw new Error(`[AFD] issuer ${JSON.stringify(alias)} has no key source`);
			}
			if (issuers.some((kept) => kept.issuer === entry.issuer || kept.alias === alias)) {
				throw new Error(`[AFD] issuer ${JSON.stringify(alias)} is configured twice`);
			}
			// A kid names a key only within one issuer's set: a shared source would let one
			// issuer's token be checked against another issuer's key.
			if (issuers.some((kept) => kept.keys === entry.keys)) {
				throw new Error(
					`[AFD] issuer ${JSON.stringify(alias)} shares its key source with another issuer; give each issuer its own`
				);
			}
			issuers.push(Object.freeze({ ...entry, alias, algorithms: Object.freeze(algorithms) }));
		}
		if (issuers.length === 0) throw new Error('[AFD] a JWT verifier needs at least one issuer');
		const introspection = options.introspection;
		const inner = introspection?.rules;
		if (
			inner &&
			(inner.resource !== this.rules.resource ||
				inner.requireBoundTokens !== this.rules.requireBoundTokens)
		) {
			throw new Error(
				'[AFD] the introspection verifier accepts another audience or binding requirement than the JWT verifier'
			);
		}
		this.#issuers = Object.freeze(issuers);
		this.issuers = Object.freeze([
			...issuers.map((entry) => entry.issuer),
			...(introspection?.issuers ?? []),
		]);
		this.#introspection = introspection;
		this.#clock = options.clock ?? systemClock;
	}

	async verify(token: string, request: TokenRequest = {}): Promise<TokenVerification> {
		const parts = compactJwsParts(token);
		if (!parts) {
			return this.#introspection
				? this.#introspection.verify(token, request)
				: { ok: false, rule: 'unknown-issuer' };
		}
		const [headerPart, payloadPart, signaturePart] = parts;
		// 1. Route by the unverified `iss`.
		const payload = decodeJoseObject(payloadPart);
		const iss = payload?.iss;
		const issuer = this.#issuers.find((candidate) => candidate.issuer === iss);
		if (!payload || !issuer) return { ok: false, rule: 'unknown-issuer' };
		const refused = (rule: AuthRuleCode): TokenVerification => ({
			ok: false,
			rule,
			issuer: issuer.alias,
		});
		const outcome = <T>(result: RuleResult<T>) => (result.ok ? undefined : refused(result.rule));
		// 2. Header.
		const header = decodeJoseObject(headerPart);
		if (!header) return refused('typ');
		const headerRefusal = outcome(checkJwsHeader(header, issuer.algorithms));
		if (headerRefusal) return headerRefusal;
		const alg = header.alg as SigningAlgorithm;
		// 3. Key.
		let lookup: KeyLookup;
		try {
			lookup = await issuer.keys.key(issuer.issuer, header.kid as string);
		} catch {
			return refused('unavailable');
		}
		if ('error' in lookup) return refused(lookup.error === 'unknown' ? 'key' : 'unavailable');
		const keyRefusal = outcome(checkKeyFit(header, lookup.key));
		if (keyRefusal) return keyRefusal;
		const key = await verificationKey(alg, lookup.key);
		if (!key) return refused('key');
		// 4. Signature.
		if (!decodeBase64url(signaturePart)) return refused('signature');
		try {
			await compactVerify(token, key, { algorithms: [alg] });
		} catch (error) {
			return refused(error instanceof errors.JWSSignatureVerificationFailed ? 'signature' : 'key');
		}
		// 5 to 10. Claims.
		const now = Math.floor(this.#clock.now() / 1000);
		const claims = checkClaims(payload, issuer.issuer, this.rules, now, request.certificate);
		return claims.ok ? { ok: true, credentials: claims.value } : refused(claims.rule);
	}
}

/** What {@link createIntrospectionVerifier} takes. */
export interface IntrospectionVerifierOptions {
	/** The introspection issuer's exact `iss` string: an absolute `https` URL. */
	issuer: string;
	/** The claim rules, as for {@link JwtVerifier}. */
	rules: TokenRules | TokenRulesOptions;
	/**
	 * The host's RFC 7662 call: POST the token to the issuer's introspection endpoint with the
	 * server's own client authentication, and resolve to the parsed JSON response. A throw fails
	 * the request closed (`unavailable`). The token goes to this issuer alone.
	 */
	introspect(token: string): Promise<unknown>;
	/** Logged with a refused token's rule code. Default: `issuer`. */
	alias?: string;
	/** The clock the time rules and the cache read. Default: the system clock. */
	clock?: Clock;
	/**
	 * Active responses cached by the token's SHA-256 until the earlier of their `exp` and 60
	 * seconds, re-checked on every use. Default 1000 entries; 0 turns caching off.
	 */
	cacheSize?: number;
}

/** How long an introspection answer may be reused (M3, "Introspection"). */
const INTROSPECTION_CACHE_MS = 60_000;

/**
 * A {@link TokenVerifier} for opaque tokens through the host's introspection call
 * (`spec/authorization.md`, M3, "Introspection"): `active: true` and the six required fields,
 * then rules 5 to 10. Give it to {@link JwtVerifier} as `introspection`, so only tokens that are
 * not a compact JWS reach it.
 *
 * @throws Error for invalid rules or an issuer that is not an absolute `https` URL
 */
export function createIntrospectionVerifier(options: IntrospectionVerifierOptions): TokenVerifier {
	assertHttpsUrl('issuer', options.issuer);
	const rules = createTokenRules(options.rules);
	const { issuer, introspect } = options;
	const alias = options.alias ?? issuer;
	const clock = options.clock ?? systemClock;
	const cacheSize = options.cacheSize ?? 1000;
	const cache = new Map<string, { response: unknown; until: number }>();

	async function response(token: string): Promise<unknown> {
		const digest = createHash('sha256').update(token).digest('base64url');
		const cached = cache.get(digest);
		if (cached && cached.until > clock.now()) return cached.response;
		cache.delete(digest);
		const answer = await introspect(token);
		const exp = isRecord(answer) && answer.active === true ? answer.exp : undefined;
		if (cacheSize > 0 && typeof exp === 'number' && Number.isFinite(exp)) {
			if (cache.size >= cacheSize) cache.delete(cache.keys().next().value as string);
			cache.set(digest, {
				response: answer,
				until: Math.min(exp * 1000, clock.now() + INTROSPECTION_CACHE_MS),
			});
		}
		return answer;
	}

	return {
		rules,
		issuers: Object.freeze([issuer]),
		async verify(token, request = {}) {
			let answer: unknown;
			try {
				answer = await response(token);
			} catch {
				return { ok: false, rule: 'unavailable', issuer: alias };
			}
			const now = Math.floor(clock.now() / 1000);
			const checked = checkIntrospection(answer, issuer, rules, now, request.certificate);
			return checked.ok
				? { ok: true, credentials: checked.value }
				: { ok: false, rule: checked.rule, issuer: alias };
		},
	};
}
