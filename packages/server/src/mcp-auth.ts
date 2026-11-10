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
 *
 * Scopes (M6): each admitted request gets a scope view, decided once as it arrives, which the
 * routes, the router, the engine and the listings read; the layer decides a `POST` body before
 * dispatch and answers a missing scope with M5's 403. A host whose own layer vouches for its
 * callers admits them with `handler.admit` and runs the same decision with
 * `handler.preDispatchCheck`.
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TLSSocket } from 'node:tls';
import { type Actor, type Clock, systemClock } from '@lushly-dev/afd-core';
import type { GroupByFn } from './command-routing.js';
import {
	HttpRequestError,
	isJsonContent,
	prereadBody,
	readBodyBytes,
	setPrereadBody,
} from './http-security.js';
import { extractBearer } from './mcp-auth-bearer.js';
import {
	bodyTooLarge,
	decideBody,
	decidesBody,
	type ForbiddenStyle,
	type PreDispatch,
} from './mcp-auth-dispatch.js';

export type { PreDispatch } from './mcp-auth-dispatch.js';

import type { TokenVerifier } from './mcp-auth-jwt.js';
import {
	createProtectedResource,
	isScopeToken,
	type ProtectedResource,
} from './mcp-auth-resource.js';
import { type AuthRuleCode, type Credentials, withRedactedInspect } from './mcp-auth-rules.js';
import type { ScopeChallenge, ScopeResolver } from './mcp-auth-scopes.js';
import { createScopeAuthority } from './mcp-auth-view.js';
import type { ZodCommandDefinition } from './schema.js';
import type { ScopeView } from './scope-view.js';
import type { ToolStrategy } from './server-types.js';
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
	/** Scopes every request needs, checked before a call's own (M6). Default: none. */
	requiredScopes?: readonly string[];
	/**
	 * Decides every call instead of the static rule (a command's `scopes`); `requiredScopes`
	 * still apply. Default: none, the static rule.
	 */
	resolver?: ScopeResolver;
	/**
	 * List only what the caller may use (M6, "Listing"): `tools/list`, `afd-discover`,
	 * `afd-detail`, `afd-help`, `afd-docs`, `afd-schema` and grouped actions, with `tools/list`
	 * then `cacheScope: "private"`. With a `resolver`, a command its `known` rejects does not exist
	 * for the caller on any route (M6, "Hidden commands"). Default: `false`.
	 */
	filterToolsByScope?: boolean;
}

/** What the server tells the layer about its own commands, for the scope decisions. */
export interface AuthLayerContext {
	maxBodyBytes: number;
	clock?: Clock;
	/** The MCP-exposed commands, built-ins included. */
	commands: readonly ZodCommandDefinition[];
	toolStrategy: ToolStrategy;
	groupByFn?: GroupByFn;
}

/** What `handler.preDispatchCheck` takes: how a host's 403 is spelled. */
export interface PreDispatchCheckOptions {
	/** The 403's challenge in the host's own scheme, instead of M5's `Bearer` one. */
	challenge?: ScopeChallenge;
	/**
	 * What a caller obtains to gain a scope, in the 403's suggestion ("Obtain `<scopeSource>`
	 * that also grants ..."). Default: "a token for `<resource>`".
	 */
	scopeSource?: string;
}

/**
 * The decision before dispatch for a host's own layer (`spec/authorization.md`, M6): the bearer
 * layer's own implementation, so the two cannot drift.
 */
export interface PreDispatchCheck {
	/** The largest body the decision reads; read at most this many bytes, plus one, before it. */
	readonly maxBodyBytes: number;
	/**
	 * Decide `req`, whose body the host has read (`body`, as bytes or text), after admitting its
	 * credentials with `handler.admit`. Pass the request on (with the body, as the handler's
	 * third argument) only on `{ proceed: true }`; otherwise answer with the response given: the
	 * 403 naming every missing scope, the 400 for a JSON-RPC batch, or the 413 for a body over
	 * `maxBodyBytes`. A request without credentials admitted for this handler, a method other
	 * than `POST`, and a body that cannot be parsed proceed, to be decided after routing.
	 */
	decide(req: IncomingMessage, body: Uint8Array | string): PreDispatch;
}

/** The default actor of a verified call (M4), when `createContext` maps none. */
export function credentialsActor(credentials: Credentials): Actor {
	return { kind: 'agent', id: credentials.clientId, onBehalfOf: credentials.subject };
}

/** The layer one HTTP handler runs before its routes. */
export interface AuthLayer {
	readonly protectedResource: ProtectedResource;
	/** Whether the listings are filtered by scope (`filterToolsByScope`). */
	readonly filterToolsByScope: boolean;
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
	/** The scope view of an admitted request, decided once as it arrived. */
	viewFor(req: IncomingMessage): ScopeView | undefined;
	/**
	 * Admit `credentials` a host's own layer vouches for, for `req` alone (`handler.admit`).
	 *
	 * @throws Error when `req` carries a bearer token or was admitted before, or the credentials
	 *   fail the checks a verifier's do
	 */
	hostAdmit(req: IncomingMessage, credentials: Credentials): void;
	/** The decision before dispatch for a host's own layer (`handler.preDispatchCheck`). */
	preDispatchCheck(options?: PreDispatchCheckOptions): PreDispatchCheck;
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

/** Scope tokens, each once, or a configuration error naming `what`. */
function scopeList(what: string, scopes: unknown): string[] {
	if (scopes === undefined) return [];
	if (!Array.isArray(scopes)) throw new Error(`[AFD] ${what} must be an array of scope tokens`);
	const kept: string[] = [];
	for (const scope of scopes) {
		if (!isScopeToken(scope)) {
			throw new Error(`[AFD] ${what}: ${JSON.stringify(scope)} is not an OAuth scope token`);
		}
		if (!kept.includes(scope)) kept.push(scope);
	}
	return kept;
}

/** A query string naming `access_token` (RFC 6750 2.3), percent-encoded or not. */
const BEARER_QUERY = /(?:^|&)access(?:_|%5[Ff])token(?:=|&|$)/;

/**
 * The authorization layer of one HTTP handler.
 *
 * @throws Error for invalid options: the resource, an authorization server or a published scope
 *   malformed; a verifier missing or whose rules name another resource or binding requirement;
 *   a required scope or a command's declared scope that is not a scope token; a resolver without
 *   `resolve` and `visible`
 */
export function createAuthLayer(options: McpAuthOptions, server: AuthLayerContext): AuthLayer {
	const { maxBodyBytes } = server;
	const clock = server.clock ?? systemClock;
	const requiredScopes = scopeList('auth.requiredScopes', options.requiredScopes);
	const { resolver } = options;
	if (
		resolver !== undefined &&
		(typeof resolver?.resolve !== 'function' || typeof resolver.visible !== 'function')
	) {
		throw new Error('[AFD] auth.resolver must have resolve() and visible()');
	}
	if (options.filterToolsByScope !== undefined && typeof options.filterToolsByScope !== 'boolean') {
		throw new Error('[AFD] auth.filterToolsByScope must be a boolean');
	}
	const filterToolsByScope = options.filterToolsByScope === true;
	for (const command of server.commands) {
		scopeList(`the scopes of command ${JSON.stringify(command.name)}`, command.scopes);
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
	const authority = createScopeAuthority({
		requiredScopes,
		resolver,
		filterToolsByScope,
		commands: server.commands,
		toolStrategy: server.toolStrategy,
		groupByFn: server.groupByFn,
		resource,
	});
	// Only this layer's admissions count: a request admitted by another handler's layer is not.
	const admitted = new WeakMap<IncomingMessage, Credentials>();
	const views = new WeakMap<IncomingMessage, ScopeView>();
	// Credentials a host's own layer vouched for, until the handler takes the request.
	const vouched = new WeakMap<IncomingMessage, Credentials>();

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

	function respond(res: ServerResponse, answer: PreDispatch): boolean {
		if (answer.proceed) return true;
		res.writeHead(answer.status, answer.headers);
		res.end(answer.body);
		return false;
	}

	/** Admit `credentials` for `req` and its response alone, branded until the response closes. */
	function take(req: IncomingMessage, res: ServerResponse, credentials: Credentials): boolean {
		if (res.destroyed || res.writableEnded) return false;
		brandVerifiedCredentials(credentials);
		admitted.set(req, credentials);
		views.set(req, authority.view(credentials));
		// No credentials outlive their request as verified.
		res.once('close', () => unbrandVerifiedCredentials(credentials));
		return true;
	}

	/**
	 * The decision before dispatch on a body `req` carries (M6), read here when the route reads
	 * one: at most `maxBodyBytes`, kept for the route to read again.
	 */
	async function decideBefore(
		req: IncomingMessage,
		path: string,
		view: ScopeView,
		style: ForbiddenStyle = {}
	): Promise<PreDispatch> {
		if (req.method !== 'POST' || !decidesBody(path) || !isJsonContent(req))
			return { proceed: true };
		let body = prereadBody(req);
		if (!body) {
			const read = await readBodyBytes(req, maxBodyBytes);
			if (!read) return bodyTooLarge(path);
			body = read;
			setPrereadBody(req, body);
		}
		if (body.length > maxBodyBytes) return bodyTooLarge(path);
		return decideBody(view, path, body.toString('utf8'), resource, style);
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
		// A host's own layer vouched for this caller: its credentials, and its own decision before
		// dispatch (`preDispatchCheck`), stand for the bearer token's.
		const host = vouched.get(req);
		if (host) {
			vouched.delete(req);
			if (authorizationValues(req).length > 0 || BEARER_QUERY.test(url.search.slice(1))) {
				return unauthorized(res, 'token-location');
			}
			return take(req, res, host);
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
		if (!take(req, res, credentials)) return false;
		// M6: the 403 before dispatch.
		return respond(res, await decideBefore(req, url.pathname, views.get(req) as ScopeView));
	}

	function hostAdmit(req: IncomingMessage, credentials: Credentials): void {
		const query = new URL(req.url ?? '/', 'http://host').search.slice(1);
		if (authorizationValues(req).length > 0 || BEARER_QUERY.test(query)) {
			throw new Error(
				'[AFD] admit refuses a request that carries a bearer token: one request has one source of credentials'
			);
		}
		if (vouched.has(req) || admitted.has(req)) {
			throw new Error('[AFD] admit refuses a request whose credentials were admitted before');
		}
		const checked = admissible(credentials, {
			resource: resource.resource,
			requireBoundTokens,
			certificate: certificateThumbprint(req),
			now: Math.floor(clock.now() / 1000),
			skewS: 0,
		});
		if (typeof checked === 'string') {
			throw new Error(`[AFD] admit refuses the credentials: rule ${checked}`);
		}
		vouched.set(req, checked);
	}

	function preDispatchCheck(style: PreDispatchCheckOptions = {}): PreDispatchCheck {
		return Object.freeze({
			maxBodyBytes,
			decide(req: IncomingMessage, body: Uint8Array | string): PreDispatch {
				const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
				const path = new URL(req.url ?? '/', 'http://host').pathname;
				if (bytes.length > maxBodyBytes) return bodyTooLarge(path);
				if (req.method !== 'POST') return { proceed: true };
				const credentials = vouched.get(req) ?? admitted.get(req);
				if (!credentials || !decidesBody(path) || !isJsonContent(req)) return { proceed: true };
				const view = views.get(req) ?? authority.view(credentials);
				return decideBody(view, path, bytes.toString('utf8'), resource, style);
			},
		});
	}

	function credentialsFor(req: IncomingMessage): Credentials {
		const credentials = admitted.get(req);
		if (credentials) return credentials;
		throw new HttpRequestError(401, 'This server requires a verified access token', {
			suggestion: resource.unauthorizedBody().suggestion,
		});
	}

	return {
		protectedResource: resource,
		filterToolsByScope,
		admit,
		credentialsFor,
		viewFor: (req) => views.get(req),
		hostAdmit,
		preDispatchCheck,
	};
}
