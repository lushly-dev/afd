/**
 * @fileoverview Pure OAuth 2.1 client protocol rules (`spec/authorization.md`, M9):
 *
 * - RFC 9110 / RFC 6750 / RFC 9728 `WWW-Authenticate: Bearer` challenge parsing
 * - RFC 9728 protected-resource metadata URLs and validation
 * - RFC 8414 and OpenID Connect Discovery 1.0 authorization-server metadata URLs and validation
 * - Client ID Metadata Document (CIMD) URL validation
 * - RFC 7636 PKCE S256 generation and challenge computation
 * - RFC 8707 canonical resource URI normalization and M3.1 resource equality
 * - Token response and expiry checks
 */

import { createHash, randomBytes } from 'node:crypto';
import { urlHasCredentials } from './credentials.js';

/** Default Client ID Metadata Document URL for `@lushly-dev/afd-cli`. */
export const DEFAULT_CLI_CLIENT_METADATA_URL = 'https://afd.dev/oauth/cli-client.json';

/** Refresh a stored token when it expires within this many seconds. */
export const EXPIRY_SKEW_SECONDS = 30;

/** RFC 9728 well-known suffix. */
const PRM_WELL_KNOWN = '/.well-known/oauth-protected-resource';
/** RFC 8414 well-known suffix. */
const AS_OAUTH_WELL_KNOWN = '/.well-known/oauth-authorization-server';
/** OpenID Connect Discovery 1.0 well-known suffix. */
const AS_OIDC_WELL_KNOWN = '/.well-known/openid-configuration';

/** RFC 6749 §3.3 scope token: `%x21 / %x23-5B / %x5D-7E`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;
/** RFC 6750 §2.1 / M2 `b64token`. */
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/;
/** RFC 9110 token character. */
const HTTP_TOKEN_CHAR = /^[!#$%&'*+.^_`|~0-9A-Za-z-]$/;
const VISIBLE_ASCII = /^[\x21-\x7E]+$/;
const FORBIDDEN_URL_CHARS = /["\\<>`{}|^]/;
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*$/;

export type TokenAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post';

export interface BearerChallenge {
	scheme: 'Bearer';
	resourceMetadata?: string;
	scope?: string;
	error?: string;
	errorDescription?: string;
}

export interface ProtectedResourceMetadata {
	resource: string;
	authorizationServers: readonly string[];
	scopesSupported?: readonly string[];
	resourceName?: string;
}

export interface AuthorizationServerMetadata {
	issuer: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	codeChallengeMethodsSupported: readonly string[];
	tokenEndpointAuthMethodsSupported?: readonly string[];
	scopesSupported?: readonly string[];
	clientIdMetadataDocumentSupported?: boolean;
	authorizationResponseIssParameterSupported?: boolean;
}

export interface ValidatedTokenSet {
	accessToken: string;
	tokenType: 'Bearer';
	expiresAt?: number;
	refreshToken?: string;
	scope?: string;
}

interface UrlParts {
	scheme: string;
	host: string;
	port: string | undefined;
	path: string;
	origin: string;
}

/**
 * Split a URL with no query or fragment into its exact parts without normalizing default ports
 * or paths, matching `spec/authorization.md` M3.1.
 */
function splitResourceUrl(url: string): UrlParts | undefined {
	if (!VISIBLE_ASCII.test(url) || /[?#"\\<>`{}|^]/.test(url)) return undefined;
	const separator = url.indexOf('://');
	if (separator < 0) return undefined;
	const scheme = url.slice(0, separator);
	if (!SCHEME_PATTERN.test(scheme)) return undefined;
	const rest = url.slice(separator + 3);
	const slash = rest.indexOf('/');
	const authority = slash < 0 ? rest : rest.slice(0, slash);
	const path = slash < 0 ? '' : rest.slice(slash);
	if (authority === '' || authority.includes('@')) return undefined;
	let host: string;
	let port: string | undefined;
	if (authority.startsWith('[')) {
		const close = authority.indexOf(']');
		if (close < 0) return undefined;
		host = authority.slice(0, close + 1);
		const after = authority.slice(close + 1);
		if (after !== '') {
			if (!after.startsWith(':')) return undefined;
			port = after.slice(1);
		}
	} else {
		const colon = authority.lastIndexOf(':');
		host = colon < 0 ? authority : authority.slice(0, colon);
		port = colon < 0 ? undefined : authority.slice(colon + 1);
	}
	if (
		host === '' ||
		(host.includes(':') && !host.startsWith('[')) ||
		(port !== undefined && !/^[0-9]+$/.test(port))
	) {
		return undefined;
	}
	return {
		scheme,
		host,
		port,
		path,
		origin: `${scheme}://${authority}`,
	};
}

/** Whether `hostname` is a loopback host (`127.0.0.1`, `::1`, `[::1]`, `localhost`). */
export function isLoopbackHost(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return (
		normalized === '127.0.0.1' ||
		normalized === '::1' ||
		normalized === '[::1]' ||
		normalized === 'localhost'
	);
}

/**
 * Canonical resource URI (`spec/authorization.md`, M3.1 & M9.1): strips query and fragment,
 * lowercases scheme and host, and preserves port and path exactly as written.
 */
export function canonicalResourceUri(serverUrl: string): string {
	if (!VISIBLE_ASCII.test(serverUrl) || FORBIDDEN_URL_CHARS.test(serverUrl)) {
		throw new Error('Server URL is not a valid HTTP(S) URL.');
	}
	const queryOrHash = serverUrl.search(/[?#]/);
	const base = queryOrHash === -1 ? serverUrl : serverUrl.slice(0, queryOrHash);
	const parts = splitResourceUrl(base);
	if (!parts) {
		throw new Error(
			'Server URL must be an absolute http(s) URL without userinfo or control characters.'
		);
	}
	const scheme = parts.scheme.toLowerCase();
	if (scheme !== 'https' && scheme !== 'http') {
		throw new Error('Server URL must use the https (or loopback http) scheme.');
	}
	// Validate host/port syntax with WHATWG URL as well.
	try {
		new URL(base);
	} catch {
		throw new Error('Server URL is not a valid URL.');
	}
	const portSuffix = parts.port !== undefined ? `:${parts.port}` : '';
	return `${scheme}://${parts.host.toLowerCase()}${portSuffix}${parts.path}`;
}

/** Exact M3.1 resource equality (ASCII case-insensitive scheme/host; exact port and path). */
export function sameResource(expected: string, candidate: string): boolean {
	const a = splitResourceUrl(expected);
	const b = splitResourceUrl(candidate);
	if (!a || !b) return false;
	return (
		a.scheme.toLowerCase() === b.scheme.toLowerCase() &&
		a.host.toLowerCase() === b.host.toLowerCase() &&
		a.port === b.port &&
		a.path === b.path
	);
}

/** Whether two HTTP(S) URLs share the same origin (scheme, host, effective port) with no userinfo. */
export function sameOrigin(a: string, b: string): boolean {
	try {
		const urlA = new URL(a);
		const urlB = new URL(b);
		if (
			(urlA.protocol !== 'https:' && urlA.protocol !== 'http:') ||
			(urlB.protocol !== 'https:' && urlB.protocol !== 'http:')
		) {
			return false;
		}
		if (urlA.username || urlA.password || urlB.username || urlB.password) return false;
		return urlA.origin === urlB.origin;
	} catch {
		return false;
	}
}

/** Whether `serverUrl` is a loopback `http://` URL (the only case where `http:` is permitted). */
export function isLoopbackHttpUrl(serverUrl: string): boolean {
	try {
		const parsed = new URL(serverUrl);
		return parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
	} catch {
		return false;
	}
}

/**
 * Validate an OAuth URL (`spec/authorization.md`, M9.1): `https:` required unless
 * `allowLoopbackHttp` is true and the URL points to a loopback host; never userinfo or fragment;
 * query rejected unless `allowQuery` is true.
 */
export function assertAllowedOAuthUrl(
	what: string,
	rawUrl: unknown,
	allowLoopbackHttp: boolean,
	options: { allowQuery?: boolean } = {}
): URL {
	if (
		typeof rawUrl !== 'string' ||
		!VISIBLE_ASCII.test(rawUrl) ||
		FORBIDDEN_URL_CHARS.test(rawUrl)
	) {
		throw new Error(`Invalid ${what}: must be a valid URL.`);
	}
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid ${what}: must be an absolute URL.`);
	}
	if (parsed.username !== '' || parsed.password !== '') {
		throw new Error(`Invalid ${what}: userinfo is not allowed.`);
	}
	if (parsed.hash !== '' || rawUrl.includes('#')) {
		throw new Error(`Invalid ${what}: fragment is not allowed.`);
	}
	if (!options.allowQuery && (parsed.search !== '' || rawUrl.includes('?'))) {
		throw new Error(`Invalid ${what}: query string is not allowed.`);
	}
	if (parsed.protocol === 'https:') {
		return parsed;
	}
	if (parsed.protocol === 'http:' && allowLoopbackHttp && isLoopbackHost(parsed.hostname)) {
		return parsed;
	}
	throw new Error(
		`Refusing insecure ${what}: HTTPS is required (non-loopback HTTP and HTTPS-to-HTTP downgrades are not allowed).`
	);
}

/**
 * Parse a `WWW-Authenticate` header for a `Bearer` challenge (`spec/authorization.md`, M5 & M9.1).
 * Handles multiple challenges, quoted-strings with `\"`/`\\` escapes, and unquoted tokens.
 */
export function parseWwwAuthenticate(header: string | null | undefined): BearerChallenge | null {
	if (!header) return null;
	const length = header.length;
	let pos = 0;

	const skipWs = () => {
		while (pos < length && (header[pos] === ' ' || header[pos] === '\t')) pos++;
	};

	const readToken = (): string => {
		const start = pos;
		while (pos < length && HTTP_TOKEN_CHAR.test(header[pos] as string)) pos++;
		return header.slice(start, pos);
	};

	const readQuotedString = (): string | undefined => {
		if (header[pos] !== '"') return undefined;
		pos++; // opening quote
		let value = '';
		while (pos < length) {
			const ch = header[pos] as string;
			if (ch === '\\') {
				if (pos + 1 >= length) return undefined;
				value += header[pos + 1] as string;
				pos += 2;
				continue;
			}
			if (ch === '"') {
				pos++; // closing quote
				return value;
			}
			value += ch;
			pos++;
		}
		return undefined;
	};

	/** Check whether the current position starts `token "=" (token | quoted-string)` (not a `==`-padded token68). */
	const looksLikeAuthParam = (): boolean => {
		let scan = pos;
		while (scan < length && HTTP_TOKEN_CHAR.test(header[scan] as string)) scan++;
		if (scan === pos) return false;
		while (scan < length && (header[scan] === ' ' || header[scan] === '\t')) scan++;
		if (header[scan] !== '=') return false;
		scan++;
		while (scan < length && (header[scan] === ' ' || header[scan] === '\t')) scan++;
		if (scan >= length) return false;
		const next = header[scan] as string;
		return next === '"' || HTTP_TOKEN_CHAR.test(next);
	};

	while (pos < length) {
		// Skip whitespace and empty comma elements.
		while (pos < length && (header[pos] === ' ' || header[pos] === '\t' || header[pos] === ',')) {
			pos++;
		}
		if (pos >= length) break;

		const scheme = readToken();
		if (!scheme) return null;
		const isBearer = scheme.toLowerCase() === 'bearer';
		const params = new Map<string, string>();

		skipWs();
		if (pos < length && header[pos] !== ',') {
			// Either auth-params or a token68 followed by comma/end.
			if (!looksLikeAuthParam()) {
				// Skip token68 (base64 / visible non-comma/space chars)
				while (pos < length && header[pos] !== ',' && header[pos] !== ' ' && header[pos] !== '\t') {
					pos++;
				}
			} else {
				while (pos < length) {
					const name = readToken();
					if (!name) break;
					skipWs();
					if (header[pos] !== '=') break;
					pos++; // '='
					skipWs();
					const value = header[pos] === '"' ? readQuotedString() : readToken();
					if (value === undefined) return null;
					const lowerName = name.toLowerCase();
					if (!params.has(lowerName)) params.set(lowerName, value);
					skipWs();
					if (header[pos] !== ',') break;
					// Comma: either another param of this scheme or the next challenge scheme.
					const afterComma = pos + 1;
					pos = afterComma;
					skipWs();
					if (pos >= length || !looksLikeAuthParam()) {
						// Next item is a new challenge (or end); let outer loop read it.
						break;
					}
				}
			}
		}

		if (isBearer) {
			const challenge: BearerChallenge = { scheme: 'Bearer' };
			const resourceMetadata = params.get('resource_metadata');
			const scope = params.get('scope');
			const error = params.get('error');
			const errorDescription = params.get('error_description');
			if (resourceMetadata !== undefined) challenge.resourceMetadata = resourceMetadata;
			if (scope !== undefined) challenge.scope = scope;
			if (error !== undefined) challenge.error = error;
			if (errorDescription !== undefined) challenge.errorDescription = errorDescription;
			return challenge;
		}
	}

	return null;
}

/**
 * RFC 9728 protected-resource metadata URLs for `resource`, in M7 probe order:
 * path-inserted first, then root well-known (single URL when path is empty or `/`).
 */
export function protectedResourceMetadataUrls(resource: string): string[] {
	const canonical = canonicalResourceUri(resource);
	const parts = splitResourceUrl(canonical);
	if (!parts) throw new Error('Resource URL is not a valid HTTP(S) URL.');
	const bare = `${parts.origin}${PRM_WELL_KNOWN}`;
	if (parts.path === '' || parts.path === '/') return [bare];
	return [`${bare}${parts.path}`, bare];
}

/**
 * RFC 8414 and OpenID Connect Discovery 1.0 candidate metadata URLs for `issuer`,
 * in MCP 2026-07-28 probe order.
 */
export function authorizationServerMetadataUrls(issuer: string): string[] {
	const parts = splitResourceUrl(issuer);
	if (!parts)
		throw new Error(
			'Authorization server issuer must be an absolute URL without query or fragment.'
		);
	const normalizedPath = parts.path === '/' ? '' : parts.path.replace(/\/+$/, '');
	if (normalizedPath === '') {
		return [`${parts.origin}${AS_OAUTH_WELL_KNOWN}`, `${parts.origin}${AS_OIDC_WELL_KNOWN}`];
	}
	return [
		`${parts.origin}${AS_OAUTH_WELL_KNOWN}${normalizedPath}`,
		`${parts.origin}${AS_OIDC_WELL_KNOWN}${normalizedPath}`,
		`${parts.origin}${normalizedPath}${AS_OIDC_WELL_KNOWN}`,
	];
}

/**
 * Whether `clientId` is a valid Client ID Metadata Document URL (`spec/authorization.md`, M9.2):
 * `https:` only, non-empty path beyond `/`, no userinfo/query/fragment, no `.` or `..` segments
 * (literal or percent-encoded), and no backslash or encoded slash.
 */
export function isClientIdMetadataDocumentUrl(clientId: string): boolean {
	if (!VISIBLE_ASCII.test(clientId) || FORBIDDEN_URL_CHARS.test(clientId)) return false;
	const parts = splitResourceUrl(clientId);
	if (parts?.scheme.toLowerCase() !== 'https') return false;
	if (parts.path === '' || parts.path === '/') return false;
	// Reject dot-segments and encoded slashes before URL normalization can collapse them.
	const segments = parts.path.slice(1).split('/');
	if (!segments.some((segment) => segment.length > 0)) return false;
	for (const segment of segments) {
		if (segment === '.' || segment === '..') return false;
		if (/%2f|%5c/i.test(segment)) return false;
		try {
			const decoded = decodeURIComponent(segment);
			if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
				return false;
			}
		} catch {
			return false;
		}
	}
	try {
		const parsed = new URL(clientId);
		return parsed.protocol === 'https:' && parsed.pathname !== '/';
	} catch {
		return false;
	}
}

/** RFC 7636 PKCE S256 challenge: `BASE64URL-ENCODE(SHA256(ASCII(verifier)))` without padding. */
export function pkceChallengeS256(verifier: string): string {
	return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Generate a 32-byte CSPRNG PKCE verifier (43 base64url chars) and its S256 challenge. */
export function generatePkcePair(): { verifier: string; challenge: string; method: 'S256' } {
	const verifier = randomBytes(32).toString('base64url');
	return { verifier, challenge: pkceChallengeS256(verifier), method: 'S256' };
}

/** Generate a 32-byte CSPRNG OAuth `state` parameter (43 base64url chars). */
export function generateOAuthState(): string {
	return randomBytes(32).toString('base64url');
}

/** Whether `value` is a single RFC 6749 §3.3 scope token. */
export function isScopeToken(value: unknown): value is string {
	return typeof value === 'string' && SCOPE_TOKEN.test(value);
}

/** Parse and validate a space-delimited scope string; throws on malformed tokens. */
export function parseScopes(scopeString: string): string[] {
	const trimmed = scopeString.trim();
	if (!trimmed) return [];
	const seen = new Set<string>();
	const scopes: string[] = [];
	for (const token of trimmed.split(/\s+/)) {
		if (!isScopeToken(token)) {
			throw new Error(`Invalid OAuth scope token: ${JSON.stringify(token)}`);
		}
		if (!seen.has(token)) {
			seen.add(token);
			scopes.push(token);
		}
	}
	return scopes;
}

/** Whether `token` matches M2's `b64token` bearer syntax. */
export function isValidBearerToken(token: unknown): token is string {
	return typeof token === 'string' && token.length > 0 && BEARER_TOKEN.test(token);
}

/** Validate an RFC 9728 protected-resource metadata document (`spec/authorization.md`, M9.1). */
export function validateProtectedResourceMetadata(
	raw: unknown,
	expectedResource: string,
	allowLoopbackHttp: boolean
): ProtectedResourceMetadata {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('Protected-resource metadata must be a JSON object.');
	}
	const doc = raw as Record<string, unknown>;
	if (typeof doc.resource !== 'string' || !sameResource(expectedResource, doc.resource)) {
		throw new Error(
			'Protected-resource metadata "resource" does not match the target MCP server URL.'
		);
	}
	if (!Array.isArray(doc.authorization_servers) || doc.authorization_servers.length === 0) {
		throw new Error('Protected-resource metadata must list at least one authorization server.');
	}
	const authorizationServers: string[] = [];
	for (const server of doc.authorization_servers) {
		assertAllowedOAuthUrl('authorization server', server, allowLoopbackHttp);
		if (!authorizationServers.includes(server as string)) {
			authorizationServers.push(server as string);
		}
	}
	if (doc.bearer_methods_supported !== undefined) {
		if (
			!Array.isArray(doc.bearer_methods_supported) ||
			!doc.bearer_methods_supported.includes('header')
		) {
			throw new Error(
				'Protected resource does not accept Bearer tokens in the Authorization header.'
			);
		}
	}
	if (doc.tls_client_certificate_bound_access_tokens === true) {
		throw new Error(
			'Protected resource requires TLS client-certificate-bound tokens, which afd-cli does not support.'
		);
	}
	let scopesSupported: string[] | undefined;
	if (doc.scopes_supported !== undefined) {
		if (
			!Array.isArray(doc.scopes_supported) ||
			!doc.scopes_supported.every((s) => isScopeToken(s))
		) {
			throw new Error('Protected-resource metadata "scopes_supported" contains an invalid scope.');
		}
		scopesSupported = [...doc.scopes_supported];
	}
	return {
		resource: doc.resource,
		authorizationServers,
		...(scopesSupported ? { scopesSupported } : {}),
		...(typeof doc.resource_name === 'string' ? { resourceName: doc.resource_name } : {}),
	};
}

/** Validate an RFC 8414 / OIDC Discovery authorization-server metadata document (M9.1). */
export function validateAuthorizationServerMetadata(
	raw: unknown,
	expectedIssuer: string,
	allowLoopbackHttp: boolean
): AuthorizationServerMetadata {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('Authorization-server metadata must be a JSON object.');
	}
	const doc = raw as Record<string, unknown>;
	if (typeof doc.issuer !== 'string' || doc.issuer !== expectedIssuer) {
		throw new Error(
			'Authorization-server metadata "issuer" does not match the discovered authorization server (RFC 8414 §3.3).'
		);
	}
	assertAllowedOAuthUrl('authorization_endpoint', doc.authorization_endpoint, allowLoopbackHttp, {
		allowQuery: true,
	});
	if (urlHasCredentials(doc.authorization_endpoint as string)) {
		throw new Error(
			'Authorization-server metadata "authorization_endpoint" must not contain credentials or credential-like query parameters.'
		);
	}
	assertAllowedOAuthUrl('token_endpoint', doc.token_endpoint, allowLoopbackHttp, {
		allowQuery: false,
	});
	if (
		!Array.isArray(doc.code_challenge_methods_supported) ||
		!doc.code_challenge_methods_supported.includes('S256')
	) {
		throw new Error(
			'Authorization server does not advertise PKCE S256 support (code_challenge_methods_supported must include "S256").'
		);
	}
	if (doc.response_types_supported !== undefined) {
		if (
			!Array.isArray(doc.response_types_supported) ||
			!doc.response_types_supported.includes('code')
		) {
			throw new Error('Authorization server does not support response_type "code".');
		}
	}
	if (doc.grant_types_supported !== undefined) {
		if (
			!Array.isArray(doc.grant_types_supported) ||
			!doc.grant_types_supported.includes('authorization_code')
		) {
			throw new Error('Authorization server does not support grant_type "authorization_code".');
		}
	}
	const tokenEndpointAuthMethodsSupported = Array.isArray(doc.token_endpoint_auth_methods_supported)
		? doc.token_endpoint_auth_methods_supported.filter((v): v is string => typeof v === 'string')
		: undefined;
	const scopesSupported = Array.isArray(doc.scopes_supported)
		? doc.scopes_supported.filter((v): v is string => isScopeToken(v))
		: undefined;

	return {
		issuer: doc.issuer,
		authorizationEndpoint: doc.authorization_endpoint as string,
		tokenEndpoint: doc.token_endpoint as string,
		codeChallengeMethodsSupported: doc.code_challenge_methods_supported.filter(
			(v): v is string => typeof v === 'string'
		),
		...(tokenEndpointAuthMethodsSupported ? { tokenEndpointAuthMethodsSupported } : {}),
		...(scopesSupported ? { scopesSupported } : {}),
		...(typeof doc.client_id_metadata_document_supported === 'boolean'
			? { clientIdMetadataDocumentSupported: doc.client_id_metadata_document_supported }
			: {}),
		...(typeof doc.authorization_response_iss_parameter_supported === 'boolean'
			? {
					authorizationResponseIssParameterSupported:
						doc.authorization_response_iss_parameter_supported,
				}
			: {}),
	};
}

/** Choose the token-endpoint client authentication method (M9.2). */
export function selectTokenAuthMethod(
	hasSecret: boolean,
	supported?: readonly string[]
): TokenAuthMethod {
	if (!hasSecret) {
		if (supported && supported.length > 0 && !supported.includes('none')) {
			throw new Error(
				'Authorization server does not allow public clients (token_endpoint_auth_methods_supported excludes "none"). Supply a client secret via AFD_OAUTH_CLIENT_SECRET or --client-secret-file.'
			);
		}
		return 'none';
	}
	if (!supported || supported.length === 0 || supported.includes('client_secret_basic')) {
		return 'client_secret_basic';
	}
	if (supported.includes('client_secret_post')) {
		return 'client_secret_post';
	}
	throw new Error(
		'Authorization server does not support client_secret_basic or client_secret_post authentication.'
	);
}

/** Validate an OAuth 2.1 token endpoint JSON response (M9.3). */
export function validateTokenResponse(
	raw: unknown,
	nowSeconds = Math.floor(Date.now() / 1000)
): ValidatedTokenSet {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		throw new Error('Token endpoint response must be a JSON object.');
	}
	const doc = raw as Record<string, unknown>;
	if (typeof doc.token_type !== 'string' || doc.token_type.toLowerCase() !== 'bearer') {
		throw new Error(
			'Token endpoint returned an unsupported token_type; only Bearer tokens are accepted.'
		);
	}
	if (!isValidBearerToken(doc.access_token)) {
		throw new Error('Token endpoint response is missing a valid Bearer access_token.');
	}
	let expiresAt: number | undefined;
	if (doc.expires_in !== undefined) {
		if (
			typeof doc.expires_in !== 'number' ||
			!Number.isFinite(doc.expires_in) ||
			doc.expires_in <= 0
		) {
			throw new Error('Token endpoint response has an invalid expires_in value.');
		}
		expiresAt = Math.floor(nowSeconds + doc.expires_in);
	}
	let refreshToken: string | undefined;
	if (doc.refresh_token !== undefined) {
		if (typeof doc.refresh_token !== 'string' || doc.refresh_token.length === 0) {
			throw new Error('Token endpoint response has an invalid refresh_token value.');
		}
		refreshToken = doc.refresh_token;
	}
	let scope: string | undefined;
	if (doc.scope !== undefined) {
		if (typeof doc.scope !== 'string') {
			throw new Error('Token endpoint response has an invalid scope value.');
		}
		const parsed = parseScopes(doc.scope);
		if (parsed.length > 0) scope = parsed.join(' ');
	}
	return {
		accessToken: doc.access_token,
		tokenType: 'Bearer',
		...(expiresAt !== undefined ? { expiresAt } : {}),
		...(refreshToken !== undefined ? { refreshToken } : {}),
		...(scope !== undefined ? { scope } : {}),
	};
}

/** Whether a token with `expiresAt` (epoch seconds) is expired or within `skewSeconds` of expiry. */
export function isTokenExpiring(
	expiresAt: number | undefined,
	nowSeconds = Math.floor(Date.now() / 1000),
	skewSeconds = EXPIRY_SKEW_SECONDS
): boolean {
	if (expiresAt === undefined) return false;
	return nowSeconds >= expiresAt - skewSeconds;
}

/**
 * Resolve the space-separated `scope` parameter for an authorization request:
 * explicit `--scope` > challenge `scope` > PRM `scopes_supported`, appending `offline_access`
 * when advertised by the server and not disabled.
 */
export function resolveRequestedScope(options: {
	explicitScope?: string;
	challengeScope?: string;
	resourceScopes?: readonly string[];
	asScopes?: readonly string[];
	offline?: boolean;
}): string | undefined {
	let scopes: string[];
	if (options.explicitScope !== undefined) {
		scopes = parseScopes(options.explicitScope);
	} else if (options.challengeScope !== undefined) {
		scopes = parseScopes(options.challengeScope);
	} else if (options.resourceScopes && options.resourceScopes.length > 0) {
		scopes = [...options.resourceScopes];
	} else {
		scopes = [];
	}

	const supportsOffline =
		options.asScopes?.includes('offline_access') === true ||
		options.resourceScopes?.includes('offline_access') === true;
	if (options.offline !== false && supportsOffline && !scopes.includes('offline_access')) {
		scopes.push('offline_access');
	}
	return scopes.length > 0 ? scopes.join(' ') : undefined;
}
