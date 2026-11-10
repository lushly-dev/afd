/**
 * @fileoverview MCP authorization on HTTP (`spec/authorization.md`, M1 to M5 and M7): the options
 * of `createMcpHandler({ auth })`, and the layer the HTTP handler runs before every route.
 *
 * For each request the layer serves the protected-resource metadata at its two paths without
 * authentication (M7); otherwise it takes the one bearer token (M2), verifies it (M3), and either
 * answers 401 with M5's exact challenge and body, or removes the `Authorization` header and
 * admits the verified credentials (M4), frozen and branded, for that request alone: the brand is
 * removed when the response closes. A route that runs a command without admitted credentials is
 * refused (M1: fail closed).
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import { type Actor, type Clock, systemClock } from '@lushly-dev/afd-core';
import { HttpRequestError } from './http-security.js';
import { extractBearer } from './mcp-auth-bearer.js';
import type { TokenVerifier } from './mcp-auth-jwt.js';
import {
	createProtectedResource,
	isScopeToken,
	type ProtectedResource,
} from './mcp-auth-resource.js';
import { type AuthRuleCode, type Credentials, withRedactedInspect } from './mcp-auth-rules.js';
import { brandVerifiedCredentials, unbrandVerifiedCredentials } from './verified-credentials.js';

/** A refused token, as {@link McpAuthOptions.onRefusal} receives it. Never the token or a claim. */
export interface AuthRefusal {
	/** The rule code (M5), or a host verifier's own code. */
	rule: string;
	/** The alias of the issuer the token was routed to, once known. */
	issuer?: string;
}

/**
 * `createMcpHandler`'s `auth` option (`spec/authorization.md`, "Options"): the server becomes an
 * OAuth 2.1 protected resource on every HTTP route. stdio, `server.execute` and in-process
 * registries are unaffected.
 */
export interface McpAuthOptions {
	/** The MCP endpoint's absolute `https` URL, with no query or fragment: the token audience. */
	resource: string;
	/** The issuers named in the metadata's `authorization_servers`, in order; at least one. */
	authorizationServers: readonly string[];
	/**
	 * Verifies each request's token: AFD's `JwtVerifier` (with `createIntrospectionVerifier` for
	 * opaque tokens), or the host's own. When it states its `rules`, their `resource` must be
	 * `resource` exactly.
	 */
	verifier: TokenVerifier;
	/** The metadata's `scopes_supported`, and the 401's `scope`. Default: none. */
	scopesSupported?: readonly string[];
	/** The metadata's `resource_name`. Default: none. */
	resourceName?: string;
	/**
	 * Publish `tls_client_certificate_bound_access_tokens: true`. Default: the verifier's
	 * `rules.requireBoundTokens`; it must agree with them.
	 */
	requireBoundTokens?: boolean;
	/**
	 * Receives each refused token's rule code and issuer alias, never the token or a claim value.
	 * Default: a `console.warn` line.
	 */
	onRefusal?: (refusal: AuthRefusal) => void;
}

/** Options of M6 (scopes), which this version does not enforce; passing one fails closed. */
const SCOPE_OPTIONS = ['requiredScopes', 'resolver', 'filterToolsByScope'] as const;

/** The default actor of a verified call (M4), when `createContext` maps none. */
export function credentialsActor(credentials: Credentials): Actor {
	return { kind: 'agent', id: credentials.clientId, onBehalfOf: credentials.subject };
}

/** The layer one HTTP handler runs before its routes. */
export interface AuthLayer {
	readonly protectedResource: ProtectedResource;
	/**
	 * Serve the metadata, or verify the request's token. `true` when the request may go on to its
	 * route with credentials admitted; `false` when the layer answered it.
	 */
	admit(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
	/**
	 * The credentials this layer admitted for `req`.
	 *
	 * @throws HttpRequestError 401 when it admitted none (M1: fail closed)
	 */
	credentialsFor(req: IncomingMessage): Credentials;
}

const SAFE_RULE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** What an issuer alias may be (`JwtVerifier`'s rule): visible ASCII, at most 256 characters. */
const SAFE_ALIAS = /^[\x21-\x7E]{1,256}$/;

function defaultRefusal({ rule, issuer }: AuthRefusal): void {
	console.warn(`[afd] refused a request's bearer token: rule=${rule} issuer=${issuer ?? '-'}`);
}

function isFormBody(req: IncomingMessage): boolean {
	return (
		req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ===
		'application/x-www-form-urlencoded'
	);
}

/** Read a body of at most `maxBytes` (413 over it) as Latin-1 text: names are ASCII. */
async function readFormBody(req: IncomingMessage, maxBytes: number): Promise<string> {
	const length = Number(req.headers['content-length']);
	if (Number.isFinite(length) && length > maxBytes) {
		throw new HttpRequestError(413, 'Request body is too large');
	}
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > maxBytes) throw new HttpRequestError(413, 'Request body is too large');
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString('latin1');
}

/** Every `Authorization` value, in order, from the raw headers (Node keeps only the first). */
function authorizationValues(req: IncomingMessage): string[] {
	const values: string[] = [];
	for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
		if (req.rawHeaders[index]?.toLowerCase() === 'authorization') {
			values.push(req.rawHeaders[index + 1] ?? '');
		}
	}
	return values;
}

/** Remove the `Authorization` header from every view of `req` (M2). */
function removeAuthorization(req: IncomingMessage): void {
	// Node builds `headers` and `headersDistinct` lazily from `rawHeaders` and a count it keeps,
	// so both are built before `rawHeaders` shrinks, then edited.
	const headers = req.headers;
	const distinct = req.headersDistinct as Record<string, unknown>;
	for (let index = req.rawHeaders.length - 2; index >= 0; index -= 2) {
		if (req.rawHeaders[index]?.toLowerCase() === 'authorization') req.rawHeaders.splice(index, 2);
	}
	delete headers.authorization;
	delete distinct.authorization;
}

/** The SHA-256 thumbprint of the TLS client certificate (RFC 8705 3.1), when there is one. */
function certificateThumbprint(req: IncomingMessage): string | undefined {
	if (!(req.socket instanceof TLSSocket)) return undefined;
	const certificate = req.socket.getPeerCertificate();
	const der = certificate && 'raw' in certificate ? certificate.raw : undefined;
	return der?.length ? createHash('sha256').update(der).digest('base64url') : undefined;
}

const isWhole = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value);
const isName = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** What the layer holds a verifier's credentials to, whatever verifier made them. */
interface Admission {
	resource: string;
	requireBoundTokens: boolean;
	/** The TLS client certificate's thumbprint on this request, when there is one. */
	certificate: string | undefined;
	/** Whole seconds since the epoch. */
	now: number;
	/** The verifier's clock skew in seconds (its rules'), else none. */
	skewS: number;
}

/**
 * A fresh copy of a verifier's credentials when they have M4's shape for the resource and still
 * hold on this request, else the rule they break: a host verifier whose own rules are looser
 * fails closed (`claims` for the shape; `binding` for a bound token's missing or other
 * certificate, or no binding where one is required; `expired` past `expiresAt` and the skew).
 * Nothing the verifier keeps can change the copy.
 */
function admissible(value: unknown, admission: Admission): Credentials | AuthRuleCode {
	const { resource } = admission;
	if (!value || typeof value !== 'object') return 'claims';
	const c = value as Record<string, unknown>;
	const scopes = c.scopes;
	const cnf = c.cnf as Record<string, unknown> | undefined;
	if (
		!isName(c.issuer) ||
		!isName(c.subject) ||
		!isName(c.clientId) ||
		c.resource !== resource ||
		!isWhole(c.expiresAt) ||
		!isWhole(c.issuedAt) ||
		!Array.isArray(scopes) ||
		!scopes.every((scope) => isScopeToken(scope)) ||
		(c.authTime !== undefined && !isWhole(c.authTime)) ||
		(c.acr !== undefined && typeof c.acr !== 'string') ||
		(cnf !== undefined &&
			(typeof cnf !== 'object' ||
				cnf === null ||
				Object.keys(cnf).join() !== 'x5t#S256' ||
				!isName(cnf['x5t#S256'])))
	) {
		return 'claims';
	}
	// M3 rules 8 and 10 again, against this layer's own settings and this request.
	if (cnf !== undefined && cnf['x5t#S256'] !== admission.certificate) return 'binding';
	if (cnf === undefined && admission.requireBoundTokens) return 'binding';
	if (admission.now >= (c.expiresAt as number) + admission.skewS) return 'expired';
	return withRedactedInspect({
		issuer: c.issuer,
		subject: c.subject,
		clientId: c.clientId,
		scopes: [...new Set(scopes as string[])],
		resource,
		expiresAt: c.expiresAt,
		issuedAt: c.issuedAt,
		...(c.authTime !== undefined ? { authTime: c.authTime as number } : {}),
		...(c.acr !== undefined ? { acr: c.acr as string } : {}),
		...(cnf !== undefined ? { cnf: { 'x5t#S256': cnf['x5t#S256'] as string } } : {}),
	});
}

/**
 * The authorization layer of one HTTP handler.
 *
 * @throws Error for invalid options: the resource, an authorization server or a published scope
 *   malformed; a verifier missing or whose rules name another resource or binding requirement;
 *   or an M6 option (`requiredScopes`, `resolver`, `filterToolsByScope`), which this version
 *   does not enforce
 */
export function createAuthLayer(
	options: McpAuthOptions,
	maxBodyBytes: number,
	clock: Clock = systemClock
): AuthLayer {
	for (const name of SCOPE_OPTIONS) {
		if ((options as unknown as Record<string, unknown>)[name] !== undefined) {
			throw new Error(
				`[AFD] auth.${name} is not supported yet: scopes (spec/authorization.md, M6) are not enforced by this version, so the server refuses to start rather than ignore it`
			);
		}
	}
	const { verifier } = options;
	if (typeof verifier?.verify !== 'function') {
		throw new Error('[AFD] auth.verifier must be a TokenVerifier, such as a JwtVerifier');
	}
	const rules = verifier.rules;
	if (rules && rules.resource !== options.resource) {
		throw new Error(
			`[AFD] the verifier accepts the audience ${JSON.stringify(rules.resource)} but auth.resource is ${JSON.stringify(options.resource)}`
		);
	}
	const requireBoundTokens = options.requireBoundTokens ?? rules?.requireBoundTokens ?? false;
	if (rules && rules.requireBoundTokens !== requireBoundTokens) {
		throw new Error(
			'[AFD] the verifier and auth.requireBoundTokens disagree on whether certificate-bound tokens are required'
		);
	}
	const resource = createProtectedResource({
		resource: options.resource,
		authorizationServers: options.authorizationServers,
		scopesSupported: options.scopesSupported,
		resourceName: options.resourceName,
		requireBoundTokens,
	});
	const servers = new Set(options.authorizationServers ?? []);
	for (const issuer of verifier.issuers ?? []) {
		if (!servers.has(issuer)) {
			throw new Error(
				`[AFD] the verifier accepts tokens from ${JSON.stringify(issuer)}, which auth.authorizationServers does not name`
			);
		}
	}
	const onRefusal = options.onRefusal ?? defaultRefusal;
	// Only this layer's admissions count: a request admitted by another handler's layer is not.
	const admitted = new WeakMap<IncomingMessage, Credentials>();

	function json(res: ServerResponse, status: number, body: unknown, challenge?: string): void {
		res.writeHead(status, {
			'Content-Type': 'application/json',
			...(challenge ? { 'WWW-Authenticate': challenge } : {}),
		});
		res.end(JSON.stringify(body));
	}

	function unauthorized(res: ServerResponse, rule: string, issuer?: string): false {
		try {
			onRefusal({
				rule: SAFE_RULE.test(rule) ? rule : 'host',
				// A host verifier's issuer is held to the alias pattern before it is logged.
				...(issuer !== undefined ? { issuer: SAFE_ALIAS.test(issuer) ? issuer : 'host' } : {}),
			});
		} catch {}
		json(
			res,
			401,
			resource.unauthorizedBody(),
			resource.unauthorizedChallenge(rule !== 'no-token')
		);
		return false;
	}

	async function admit(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
		// M7: the metadata is public.
		if (resource.metadataPaths.includes(url.pathname)) {
			if (req.method !== 'GET') {
				res.writeHead(405, { Allow: 'GET' });
				res.end();
				return false;
			}
			json(res, 200, resource.document());
			return false;
		}
		// M2: a form body is read before the token, since a token in it refuses the request.
		const form = isFormBody(req) ? await readFormBody(req, maxBodyBytes) : undefined;
		const query = url.search === '' ? undefined : url.search.slice(1);
		const bearer = extractBearer(authorizationValues(req), query, form);
		if ('refused' in bearer) return unauthorized(res, bearer.refused);
		removeAuthorization(req);
		// M3: verify, then forget the token.
		const certificate = certificateThumbprint(req);
		let verification: Awaited<ReturnType<TokenVerifier['verify']>>;
		try {
			verification = await verifier.verify(bearer.token, { certificate });
		} catch {
			return unauthorized(res, 'unavailable');
		}
		if (!verification.ok) return unauthorized(res, verification.rule, verification.issuer);
		const credentials = admissible(verification.credentials, {
			resource: resource.resource,
			requireBoundTokens,
			certificate,
			now: Math.floor(clock.now() / 1000),
			skewS: rules?.clockSkewS ?? 0,
		});
		if (typeof credentials === 'string') return unauthorized(res, credentials);
		// Every route takes JSON; a form body has served its one purpose (M2).
		if (form !== undefined)
			throw new HttpRequestError(415, 'Content-Type must be application/json');
		if (res.destroyed || res.writableEnded) return false;
		brandVerifiedCredentials(credentials);
		admitted.set(req, credentials);
		// No credentials outlive their request as verified.
		res.once('close', () => unbrandVerifiedCredentials(credentials));
		return true;
	}

	function credentialsFor(req: IncomingMessage): Credentials {
		const credentials = admitted.get(req);
		if (credentials) return credentials;
		throw new HttpRequestError(401, 'This server requires a verified access token', {
			suggestion: resource.unauthorizedBody().suggestion,
		});
	}

	return { protectedResource: resource, admit, credentialsFor };
}
