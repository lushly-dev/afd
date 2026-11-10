/**
 * @fileoverview The protected resource: its URI, the audience rule, the RFC 9728 metadata and the
 * challenges that point to it (`spec/authorization.md`, M3.1, M5 and M7).
 */

/** The well-known suffix of protected-resource metadata (RFC 9728 3.1). */
export const PROTECTED_RESOURCE_WELL_KNOWN = '/.well-known/oauth-protected-resource';

/** A scope token (RFC 6749 3.3): one or more of `%x21 / %x23-5B / %x5D-7E`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

/** Whether `scope` is one OAuth scope token (RFC 6749 3.3). */
export function isScopeToken(scope: unknown): scope is string {
	return typeof scope === 'string' && SCOPE_TOKEN.test(scope);
}

interface UrlParts {
	scheme: string;
	host: string;
	/** The port as written, without its colon; `undefined` when no colon is written. */
	port: string | undefined;
	/** Everything after the authority, as written (empty, or starting with `/`). */
	path: string;
	/** `scheme://authority`, as written. */
	origin: string;
}

const VISIBLE_ASCII = /^[\x21-\x7E]+$/;
const FORBIDDEN = /[?#"\\<>`{}|^]/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;

/**
 * `url` split for comparison, or `undefined` when it is not `scheme://host[:port][path]` in
 * visible ASCII with no user information, query or fragment. Nothing is normalized: the parts
 * are as written.
 */
function splitUrl(url: string): UrlParts | undefined {
	if (!VISIBLE_ASCII.test(url) || FORBIDDEN.test(url)) return undefined;
	const separator = url.indexOf('://');
	if (separator < 0) return undefined;
	const scheme = url.slice(0, separator);
	if (!SCHEME.test(scheme)) return undefined;
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
		(port !== undefined && !/^[0-9]*$/.test(port))
	) {
		return undefined;
	}
	return { scheme, host, port, path, origin: url.slice(0, separator + 3 + authority.length) };
}

/**
 * Whether `candidate` names `resource` (`spec/authorization.md`, M3.1): the scheme and the host
 * compare ignoring ASCII case; the port as written (`:443` is not the same as no port), the path
 * (a trailing slash differs), percent-encoding and case compare exactly; a value with user
 * information, a query or a fragment never matches.
 */
function sameResource(resource: string, candidate: string): boolean {
	const expected = splitUrl(resource);
	const actual = splitUrl(candidate);
	if (!expected || !actual) return false;
	return (
		expected.scheme.toLowerCase() === actual.scheme.toLowerCase() &&
		expected.host.toLowerCase() === actual.host.toLowerCase() &&
		expected.port === actual.port &&
		expected.path === actual.path
	);
}

/**
 * Whether an `aud` claim (`undefined` when absent) accepts `resource` (`spec/authorization.md`,
 * M3.1): a string, or an array of exactly one string, naming the resource. A token with several
 * audiences is refused even when one matches, since any of them could replay it here.
 */
export function audienceAccepts(aud: unknown, resource: string): boolean {
	if (typeof aud === 'string') return sameResource(resource, aud);
	if (Array.isArray(aud) && aud.length === 1 && typeof aud[0] === 'string') {
		return sameResource(resource, aud[0]);
	}
	return false;
}

/**
 * Throw unless `url` is an absolute `https` URL in visible ASCII with no user information, query
 * or fragment: the form of the resource, an issuer and an authorization server.
 */
export function assertHttpsUrl(what: string, url: unknown): asserts url is string {
	const parts = typeof url === 'string' ? splitUrl(url) : undefined;
	if (parts?.scheme.toLowerCase() !== 'https') {
		throw new Error(
			`[AFD] ${what} ${JSON.stringify(url)} is not an absolute https URL without user information, query or fragment`
		);
	}
}

/** The scope tokens of `scopes`, joined by single spaces; anything else is left out. */
function joinedTokens(scopes: readonly string[]): string {
	return scopes.filter((scope) => isScopeToken(scope)).join(' ');
}

/** What the protected-resource metadata publishes (`spec/authorization.md`, M7 and "Options"). */
export interface ProtectedResourceOptions {
	/** The MCP endpoint's absolute `https` URL, with no query or fragment: the token audience. */
	resource: string;
	/** The issuers whose access tokens the server accepts, in this order; at least one. */
	authorizationServers: readonly string[];
	/** The metadata's `scopes_supported`, and the 401's `scope`. Default: none. */
	scopesSupported?: readonly string[];
	/** The metadata's `resource_name`. Default: none. */
	resourceName?: string;
	/** Whether only certificate-bound tokens are accepted. Default: `false`. */
	requireBoundTokens?: boolean;
}

/**
 * RFC 9728 protected-resource metadata, the URLs it is served at and the challenges that point
 * to it (`spec/authorization.md`, M5 and M7). Built by {@link createProtectedResource}, which
 * checks its options.
 */
export interface ProtectedResource {
	/** The resource, as configured. */
	readonly resource: string;
	/** The metadata URLs: the path-inserted one first (every challenge's `resource_metadata`). */
	readonly metadataUrls: readonly string[];
	/** The request paths of {@link metadataUrls}, served without authentication. */
	readonly metadataPaths: readonly string[];
	/** The published scopes. */
	readonly scopesSupported: readonly string[];
	/** Whether only certificate-bound tokens are accepted. */
	readonly requireBoundTokens: boolean;
	/** The metadata document. Nothing else is published. */
	document(): Record<string, unknown>;
	/** The 401's `WWW-Authenticate` value; `error="invalid_token"` when a token was sent. */
	unauthorizedChallenge(tokenSent: boolean): string;
	/** The 401's JSON body. */
	unauthorizedBody(): { error: 'UNAUTHORIZED'; suggestion: string };
	/** The 403's `WWW-Authenticate` value for the `missing` scopes, in order. */
	forbiddenChallenge(missing: readonly string[]): string;
	/** The 403's JSON body for the `missing` scopes. */
	forbiddenBody(missing: readonly string[]): { error: 'INSUFFICIENT_SCOPE'; suggestion: string };
}

/**
 * The protected-resource metadata of `options.resource`.
 *
 * @throws Error when the resource or an authorization server is not an absolute `https` URL
 *   without user information, query or fragment, no authorization server is named or one is
 *   named twice, or a published scope is not a scope token or is published twice
 */
export function createProtectedResource(options: ProtectedResourceOptions): ProtectedResource {
	const { resource } = options;
	assertHttpsUrl('resource', resource);
	const servers: string[] = [];
	for (const server of options.authorizationServers ?? []) {
		assertHttpsUrl('authorization server', server);
		if (servers.includes(server)) {
			throw new Error(`[AFD] authorization server ${JSON.stringify(server)} is named twice`);
		}
		servers.push(server);
	}
	if (servers.length === 0) {
		throw new Error('[AFD] protected-resource metadata needs at least one authorization server');
	}
	const scopes: string[] = [];
	for (const scope of options.scopesSupported ?? []) {
		if (!isScopeToken(scope)) {
			throw new Error(`[AFD] scope ${JSON.stringify(scope)} is not an OAuth scope token`);
		}
		if (scopes.includes(scope)) {
			throw new Error(`[AFD] scope ${JSON.stringify(scope)} is published twice`);
		}
		scopes.push(scope);
	}
	const resourceName = options.resourceName;
	if (resourceName !== undefined && typeof resourceName !== 'string') {
		throw new Error('[AFD] resourceName must be a string');
	}
	const requireBoundTokens = options.requireBoundTokens === true;

	const parts = splitUrl(resource) as UrlParts;
	const bare = `${parts.origin}${PROTECTED_RESOURCE_WELL_KNOWN}`;
	const onlyOrigin = parts.path === '' || parts.path === '/';
	const metadataUrls = Object.freeze(onlyOrigin ? [bare] : [`${bare}${parts.path}`, bare]);
	const metadataPaths = Object.freeze(
		onlyOrigin
			? [PROTECTED_RESOURCE_WELL_KNOWN]
			: [`${PROTECTED_RESOURCE_WELL_KNOWN}${parts.path}`, PROTECTED_RESOURCE_WELL_KNOWN]
	);
	const metadata = metadataUrls[0] as string;
	const suggestion = (missing: readonly string[]) => {
		const joined = joinedTokens(missing);
		return joined
			? `Obtain a token for ${resource} that also grants ${joined}, then retry.`
			: `Obtain a token for ${resource} that grants the scopes this call needs, then retry.`;
	};

	return Object.freeze({
		resource,
		metadataUrls,
		metadataPaths,
		scopesSupported: Object.freeze([...scopes]),
		requireBoundTokens,
		document() {
			return {
				resource,
				authorization_servers: [...servers],
				...(scopes.length ? { scopes_supported: [...scopes] } : {}),
				bearer_methods_supported: ['header'],
				...(resourceName !== undefined ? { resource_name: resourceName } : {}),
				tls_client_certificate_bound_access_tokens: requireBoundTokens,
			};
		},
		unauthorizedChallenge(tokenSent: boolean) {
			let challenge = `Bearer resource_metadata="${metadata}"`;
			if (scopes.length) challenge += `, scope="${scopes.join(' ')}"`;
			if (tokenSent) challenge += ', error="invalid_token"';
			return challenge;
		},
		unauthorizedBody() {
			return {
				error: 'UNAUTHORIZED' as const,
				suggestion: `Obtain a token for ${resource} from an authorization server named in ${metadata}.`,
			};
		},
		forbiddenChallenge(missing: readonly string[]) {
			const joined = joinedTokens(missing);
			return joined
				? `Bearer error="insufficient_scope", scope="${joined}", resource_metadata="${metadata}"`
				: `Bearer error="insufficient_scope", resource_metadata="${metadata}"`;
		},
		forbiddenBody(missing: readonly string[]) {
			return { error: 'INSUFFICIENT_SCOPE' as const, suggestion: suggestion(missing) };
		},
	});
}
