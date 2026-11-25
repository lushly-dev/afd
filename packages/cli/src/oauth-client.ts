/**
 * @fileoverview OAuth 2.1 client for `@lushly-dev/afd-cli` (`spec/authorization.md`, M9).
 *
 * Implements:
 * - RFC 9728 protected-resource metadata + RFC 8414 / OIDC Discovery 1.0 AS metadata discovery
 * - Client ID Metadata Document (CIMD) and pre-registered client flows
 * - Authorization code flow with PKCE (S256), RFC 8707 `resource`, RFC 9207 `iss` verification,
 *   constant-time `state` check, and loopback `127.0.0.1` callback listener
 * - Automatic token refresh on expiry with refresh-token rotation and revocation cleanup
 */

import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { redactSecrets, redactUrl } from './credentials.js';
import {
	type AuthorizationServerMetadata,
	assertAllowedOAuthUrl,
	authorizationServerMetadataUrls,
	type BearerChallenge,
	canonicalResourceUri,
	DEFAULT_CLI_CLIENT_METADATA_URL,
	EXPIRY_SKEW_SECONDS,
	generateOAuthState,
	generatePkcePair,
	isClientIdMetadataDocumentUrl,
	isLoopbackHttpUrl,
	isTokenExpiring,
	type ProtectedResourceMetadata,
	parseWwwAuthenticate,
	protectedResourceMetadataUrls,
	resolveRequestedScope,
	sameOrigin,
	selectTokenAuthMethod,
	type TokenAuthMethod,
	type ValidatedTokenSet,
	validateAuthorizationServerMetadata,
	validateProtectedResourceMetadata,
	validateTokenResponse,
} from './oauth-protocol.js';
import {
	deleteStoredTokenIfRefreshMatchesUnlocked,
	getStoredToken,
	getTokenStorePath,
	readSecretFile,
	type StoredOAuthToken,
	type StoredOAuthTokenSummary,
	saveStoredToken,
	saveStoredTokenUnlocked,
	withTokenStoreLockAsync,
} from './token-store.js';

/** Environment variable for a default OAuth client ID (CIMD URL or pre-registered ID). */
export const OAUTH_CLIENT_ID_ENV = 'AFD_OAUTH_CLIENT_ID';
/** Environment variable for a pre-registered confidential client secret. */
export const OAUTH_CLIENT_SECRET_ENV = 'AFD_OAUTH_CLIENT_SECRET';
/** Environment variable binding a pre-registered confidential client secret to one exact issuer. */
export const OAUTH_ISSUER_ENV = 'AFD_OAUTH_ISSUER';

/** Maximum response size accepted from metadata or token endpoints (256 KiB). */
export const MAX_OAUTH_RESPONSE_BYTES = 262_144;
/** Default HTTP timeout for metadata and token requests. */
export const DEFAULT_OAUTH_HTTP_TIMEOUT_MS = 15_000;
/** Default timeout waiting for interactive browser authorization callback. */
export const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;
/** Cap on invalid/unmatched requests accepted by the loopback callback server before aborting. */
const MAX_INVALID_CALLBACKS = 10;

/** Standard OAuth 2.0 / 2.1 error codes safe to surface verbatim in CLI diagnostics. */
const RECOGNIZED_OAUTH_ERRORS = new Set([
	'invalid_request',
	'invalid_client',
	'invalid_grant',
	'unauthorized_client',
	'unsupported_grant_type',
	'invalid_scope',
	'invalid_target',
	'access_denied',
	'unsupported_response_type',
	'server_error',
	'temporarily_unavailable',
	'interaction_required',
	'login_required',
	'consent_required',
	'insufficient_scope',
	'invalid_token',
]);

const PERMANENT_REFRESH_ERRORS = new Set([
	'invalid_grant',
	'invalid_client',
	'unauthorized_client',
]);

/**
 * Sanitize an OAuth `error` value from an authorization callback or token endpoint response
 * so arbitrary server strings or echoed secrets can never leak into stderr (`spec/authorization.md`, M9.3 & M9.5).
 */
export function sanitizeOAuthErrorCode(
	raw: unknown,
	secrets: readonly (string | undefined)[] = []
): string {
	if (typeof raw !== 'string') return 'unknown_error';
	const redacted = redactSecrets(raw.trim(), secrets);
	if (RECOGNIZED_OAUTH_ERRORS.has(redacted)) return redacted;
	return 'unknown_error';
}

export class OAuthFlowError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly suggestion: string,
		readonly oauthErrorCode?: string
	) {
		super(message);
		this.name = 'OAuthFlowError';
	}
}

export interface DiscoveredOAuthMetadata {
	resource: string;
	allowLoopbackHttp: boolean;
	resourceMetadata: ProtectedResourceMetadata;
	asMetadata: AuthorizationServerMetadata;
	challenge?: BearerChallenge;
}

export interface ClientRegistration {
	clientId: string;
	clientSecret?: string;
	authMethod: TokenAuthMethod;
	mode: 'cimd' | 'pre-registered';
}

export interface OAuthDiscoveryOptions {
	issuer?: string;
	challenge?: BearerChallenge;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
}

export interface OAuthRegistrationOptions {
	clientId?: string;
	clientSecret?: string;
	clientSecretFile?: string;
	/** Expected authorization server issuer binding for confidential client secrets (`AFD_OAUTH_ISSUER`). */
	issuer?: string;
	env?: NodeJS.ProcessEnv;
}

export interface OAuthLoginOptions extends OAuthDiscoveryOptions, OAuthRegistrationOptions {
	serverUrl: string;
	scope?: string;
	offline?: boolean;
	redirectPort?: number;
	noBrowser?: boolean;
	loginTimeoutMs?: number;
	storePath?: string;
	now?: () => number;
	signal?: AbortSignal;
	/** Called with the authorization URL before waiting for the browser callback. */
	onAuthorizationUrl?: (url: string) => void | Promise<void>;
	/** Custom browser opener (defaults to OS browser launch when `!noBrowser`). */
	openUrl?: (url: string) => Promise<boolean>;
}

export interface OAuthLoginResult {
	summary: StoredOAuthTokenSummary;
	registrationMode: 'cimd' | 'pre-registered';
	browserOpened: boolean;
}

export interface ResolvedOAuthToken {
	token: string;
	entry: StoredOAuthToken;
	refreshed: boolean;
}

export interface ResolveTokenOptions {
	storePath?: string;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
	forceRefresh?: boolean;
	clientSecret?: string;
	clientSecretFile?: string;
	/** Expected issuer binding for confidential client secret refresh (`AFD_OAUTH_ISSUER`). */
	issuer?: string;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	skewSeconds?: number;
}

function safeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a, 'utf8');
	const bufB = Buffer.from(b, 'utf8');
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

/** Read a fetch Response body up to `maxBytes`, aborting if exceeded. */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null) {
		const parsed = Number(contentLength);
		if (Number.isFinite(parsed) && parsed > maxBytes) {
			await response.body?.cancel().catch(() => undefined);
			throw new OAuthFlowError(
				'OAUTH_RESPONSE_TOO_LARGE',
				`OAuth endpoint response exceeded the ${maxBytes}-byte limit.`,
				'Verify the server URL and authorization server configuration.'
			);
		}
	}
	if (!response.body) return '';
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new OAuthFlowError(
					'OAUTH_RESPONSE_TOO_LARGE',
					`OAuth endpoint response exceeded the ${maxBytes}-byte limit.`,
					'Verify the server URL and authorization server configuration.'
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks).toString('utf8');
}

async function fetchOAuthRaw(
	url: string,
	init: RequestInit,
	options: {
		fetchFn?: typeof fetch;
		timeoutMs?: number;
		secrets?: readonly (string | undefined)[];
	} = {}
): Promise<{ status: number; headers: Headers; text: string }> {
	const fetchFn = options.fetchFn ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_OAUTH_HTTP_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error('OAuth HTTP request timed out')),
		timeoutMs
	);
	const signal = init.signal
		? AbortSignal.any([init.signal, controller.signal])
		: controller.signal;
	try {
		const response = await fetchFn(url, {
			...init,
			redirect: 'manual',
			signal,
		});
		if (response.status >= 300 && response.status < 400) {
			await response.body?.cancel().catch(() => undefined);
			throw new OAuthFlowError(
				'OAUTH_REDIRECT_REFUSED',
				`Refused HTTP ${response.status} redirect from ${redactUrl(url)}.`,
				'OAuth metadata and token endpoints must answer directly without redirecting.'
			);
		}
		const text = await readBoundedText(response, MAX_OAUTH_RESPONSE_BYTES);
		return { status: response.status, headers: response.headers, text };
	} catch (error) {
		if (error instanceof OAuthFlowError) throw error;
		const reason = redactSecrets(
			error instanceof Error ? error.message : String(error),
			options.secrets ?? []
		);
		throw new OAuthFlowError(
			'OAUTH_NETWORK_ERROR',
			`OAuth request to ${redactUrl(url)} failed: ${reason}`,
			'Check network connectivity and the server URL.'
		);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Discover RFC 9728 protected-resource metadata and RFC 8414 / OIDC Discovery authorization-server
 * metadata for `serverUrl` (`spec/authorization.md`, M9.1).
 *
 * Probes the MCP Streamable HTTP endpoint first (unless a challenge was already provided) to
 * capture any authoritative 401 `WWW-Authenticate: Bearer` `resource_metadata` and `scope`, then
 * falls back to RFC 9728 well-known URLs.
 */
export async function discoverOAuthMetadata(
	serverUrl: string,
	options: OAuthDiscoveryOptions = {}
): Promise<DiscoveredOAuthMetadata> {
	let resource: string;
	let allowLoopbackHttp: boolean;
	try {
		resource = canonicalResourceUri(serverUrl);
		allowLoopbackHttp = isLoopbackHttpUrl(resource);
		assertAllowedOAuthUrl('MCP server URL', resource, allowLoopbackHttp);
	} catch (error) {
		throw new OAuthFlowError(
			'OAUTH_INVALID_URL',
			error instanceof Error ? error.message : String(error),
			'Use an https:// MCP server URL (or http:// on loopback 127.0.0.1 / localhost / [::1]).'
		);
	}

	const fetchOpts = { fetchFn: options.fetchFn, timeoutMs: options.timeoutMs };
	let challenge = options.challenge;

	// Probe the MCP endpoint first with a valid Streamable HTTP request to capture any
	// authoritative 401 WWW-Authenticate challenge (`resource_metadata` and `scope`).
	if (!challenge) {
		try {
			const probe = await fetchOAuthRaw(
				resource,
				{
					method: 'POST',
					headers: {
						Accept: 'application/json, text/event-stream',
						'Content-Type': 'application/json',
						'MCP-Protocol-Version': '2026-07-28',
						'Mcp-Method': 'server/discover',
						'Cache-Control': 'no-store',
					},
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} }),
				},
				fetchOpts
			);
			if (probe.status === 401) {
				const parsedChallenge = parseWwwAuthenticate(probe.headers.get('www-authenticate'));
				if (parsedChallenge) {
					challenge = parsedChallenge;
				}
			}
		} catch (error) {
			// Re-throw security refusals (redirect/oversized); tolerate transport/404/other probe errors
			// and fall back to RFC 9728 well-known URLs.
			if (
				error instanceof OAuthFlowError &&
				(error.code === 'OAUTH_REDIRECT_REFUSED' || error.code === 'OAUTH_RESPONSE_TOO_LARGE')
			) {
				throw error;
			}
		}
	}

	const prmCandidates: string[] = [];
	if (challenge?.resourceMetadata) {
		try {
			assertAllowedOAuthUrl('resource_metadata URL', challenge.resourceMetadata, allowLoopbackHttp);
		} catch (error) {
			throw new OAuthFlowError(
				'OAUTH_METADATA_INVALID',
				error instanceof Error ? error.message : String(error),
				'Protected-resource metadata URL must use https:// (or loopback http:// for a loopback MCP server).'
			);
		}
		if (!sameOrigin(resource, challenge.resourceMetadata)) {
			throw new OAuthFlowError(
				'OAUTH_METADATA_ORIGIN_MISMATCH',
				`Refused cross-origin resource_metadata URL ${redactUrl(challenge.resourceMetadata)}.`,
				'Protected-resource metadata must be served from the same origin as the MCP server.'
			);
		}
		prmCandidates.push(challenge.resourceMetadata);
	}
	for (const wellKnown of protectedResourceMetadataUrls(resource)) {
		if (!prmCandidates.includes(wellKnown)) {
			prmCandidates.push(wellKnown);
		}
	}

	let prmRaw: unknown;
	let prmFound = false;
	for (const candidate of prmCandidates) {
		const res = await fetchOAuthRaw(
			candidate,
			{
				method: 'GET',
				headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
			},
			fetchOpts
		);
		if (res.status === 404) continue;
		if (res.status !== 200) {
			throw new OAuthFlowError(
				'OAUTH_DISCOVERY_FAILED',
				`Protected-resource metadata endpoint ${redactUrl(candidate)} returned HTTP ${res.status}.`,
				'Verify that the server publishes RFC 9728 metadata.'
			);
		}
		try {
			prmRaw = JSON.parse(res.text);
		} catch {
			throw new OAuthFlowError(
				'OAUTH_DISCOVERY_FAILED',
				`Protected-resource metadata at ${redactUrl(candidate)} is not valid JSON.`,
				'Verify the server RFC 9728 metadata response.'
			);
		}
		prmFound = true;
		break;
	}

	if (!prmFound) {
		throw new OAuthFlowError(
			'OAUTH_DISCOVERY_FAILED',
			`No RFC 9728 protected-resource metadata found for ${redactUrl(resource)}.`,
			'Confirm the server supports MCP OAuth 2.1 authorization, or authenticate with --header / AFD_HEADERS.'
		);
	}

	let resourceMetadata: ProtectedResourceMetadata;
	try {
		resourceMetadata = validateProtectedResourceMetadata(prmRaw, resource, allowLoopbackHttp);
	} catch (error) {
		throw new OAuthFlowError(
			'OAUTH_METADATA_INVALID',
			error instanceof Error ? error.message : String(error),
			'Verify that the server protected-resource metadata conforms to RFC 9728 and MCP 2026-07-28.'
		);
	}

	const selectedIssuer = options.issuer ?? (resourceMetadata.authorizationServers[0] as string);
	if (options.issuer && !resourceMetadata.authorizationServers.includes(options.issuer)) {
		throw new OAuthFlowError(
			'OAUTH_ISSUER_NOT_LISTED',
			`Issuer ${redactUrl(options.issuer)} is not listed in the server's authorization_servers.`,
			'Choose one of the issuers advertised by the server protected-resource metadata.'
		);
	}

	const asCandidates = authorizationServerMetadataUrls(selectedIssuer);
	let asRaw: unknown;
	let asFound = false;
	for (const candidate of asCandidates) {
		const res = await fetchOAuthRaw(
			candidate,
			{
				method: 'GET',
				headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
			},
			fetchOpts
		);
		if (res.status === 404) continue;
		if (res.status !== 200) {
			throw new OAuthFlowError(
				'OAUTH_DISCOVERY_FAILED',
				`Authorization-server metadata endpoint ${redactUrl(candidate)} returned HTTP ${res.status}.`,
				'Verify that the authorization server publishes RFC 8414 or OpenID Connect Discovery metadata.'
			);
		}
		try {
			asRaw = JSON.parse(res.text);
		} catch {
			throw new OAuthFlowError(
				'OAUTH_DISCOVERY_FAILED',
				`Authorization-server metadata at ${redactUrl(candidate)} is not valid JSON.`,
				'Verify the authorization server metadata response.'
			);
		}
		asFound = true;
		break;
	}

	if (!asFound) {
		throw new OAuthFlowError(
			'OAUTH_DISCOVERY_FAILED',
			`No RFC 8414 or OpenID Connect metadata found for issuer ${redactUrl(selectedIssuer)}.`,
			'Confirm the authorization server publishes well-known metadata.'
		);
	}

	let asMetadata: AuthorizationServerMetadata;
	try {
		asMetadata = validateAuthorizationServerMetadata(asRaw, selectedIssuer, allowLoopbackHttp);
	} catch (error) {
		throw new OAuthFlowError(
			'OAUTH_METADATA_INVALID',
			error instanceof Error ? error.message : String(error),
			'Verify that the authorization server metadata conforms to RFC 8414 and supports PKCE S256.'
		);
	}

	return {
		resource,
		allowLoopbackHttp,
		resourceMetadata,
		asMetadata,
		...(challenge ? { challenge } : {}),
	};
}

/** Resolve client secret from explicit option, `--client-secret-file`, or `AFD_OAUTH_CLIENT_SECRET`. */
export function resolveClientSecret(options: {
	clientSecret?: string;
	clientSecretFile?: string;
	env?: NodeJS.ProcessEnv;
}): string | undefined {
	if (options.clientSecret !== undefined && options.clientSecret !== '') {
		return options.clientSecret;
	}
	if (options.clientSecretFile !== undefined) {
		return readSecretFile(options.clientSecretFile);
	}
	const envSecret = (options.env ?? process.env)[OAUTH_CLIENT_SECRET_ENV];
	return envSecret ? envSecret : undefined;
}

function pickTokenAuthMethod(
	hasClientSecret: boolean,
	supported: readonly string[] | undefined
): TokenAuthMethod {
	try {
		return selectTokenAuthMethod(hasClientSecret, supported);
	} catch (error) {
		throw new OAuthFlowError(
			'OAUTH_CLIENT_AUTH_INVALID',
			error instanceof Error ? error.message : String(error),
			hasClientSecret
				? 'Check that the authorization server supports client_secret_basic or client_secret_post.'
				: 'Pass a pre-registered --client-id and secret if the server does not allow public clients.'
		);
	}
}

function assertConfidentialIssuerBinding(
	actualIssuer: string,
	options: { issuer?: string; env?: NodeJS.ProcessEnv }
): void {
	const boundIssuer = options.issuer ?? (options.env ?? process.env)[OAUTH_ISSUER_ENV];
	if (!boundIssuer) {
		throw new OAuthFlowError(
			'OAUTH_ISSUER_BINDING_REQUIRED',
			'A confidential client secret must be bound to an explicit authorization server issuer.',
			`Pass --issuer "${actualIssuer}" or set ${OAUTH_ISSUER_ENV}="${actualIssuer}" so the secret is never sent to a different authorization server.`
		);
	}
	if (boundIssuer !== actualIssuer) {
		throw new OAuthFlowError(
			'OAUTH_ISSUER_MISMATCH',
			`Refused to send confidential client secret to ${redactUrl(actualIssuer)}: secret is bound to ${redactUrl(boundIssuer)}.`,
			`Verify the server's authorization_servers or update --issuer / ${OAUTH_ISSUER_ENV}.`
		);
	}
}

/**
 * Resolve client registration: Client ID Metadata Document (CIMD) or pre-registered client (M9.2).
 */
export function resolveClientRegistration(
	asMetadata: AuthorizationServerMetadata,
	options: OAuthRegistrationOptions = {}
): ClientRegistration {
	const env = options.env ?? process.env;
	const explicitClientId = options.clientId ?? env[OAUTH_CLIENT_ID_ENV];
	const clientSecret = resolveClientSecret({
		clientSecret: options.clientSecret,
		clientSecretFile: options.clientSecretFile,
		env,
	});

	if (explicitClientId) {
		const isUrlLike = /^https?:\/\//i.test(explicitClientId);
		if (isUrlLike) {
			if (!isClientIdMetadataDocumentUrl(explicitClientId)) {
				throw new OAuthFlowError(
					'OAUTH_CLIENT_ID_INVALID',
					`Invalid Client ID Metadata Document URL: ${redactUrl(explicitClientId)}.`,
					'A CIMD client_id must be an HTTPS URL with a non-empty path and no userinfo, query, fragment or dot segments.'
				);
			}
			if (asMetadata.clientIdMetadataDocumentSupported === false) {
				throw new OAuthFlowError(
					'OAUTH_CIMD_UNSUPPORTED',
					'This authorization server does not support Client ID Metadata Documents.',
					'Pass a pre-registered client ID with --client-id <id> or AFD_OAUTH_CLIENT_ID.'
				);
			}
			if (clientSecret !== undefined) {
				throw new OAuthFlowError(
					'OAUTH_CLIENT_AUTH_INVALID',
					'A Client ID Metadata Document client is public and cannot be combined with a client secret.',
					'Unset AFD_OAUTH_CLIENT_SECRET / omit --client-secret-file, or use a pre-registered client ID.'
				);
			}
			return {
				clientId: explicitClientId,
				authMethod: pickTokenAuthMethod(false, asMetadata.tokenEndpointAuthMethodsSupported),
				mode: 'cimd',
			};
		}

		if (clientSecret !== undefined) {
			assertConfidentialIssuerBinding(asMetadata.issuer, { issuer: options.issuer, env });
		}
		const authMethod = pickTokenAuthMethod(
			clientSecret !== undefined,
			asMetadata.tokenEndpointAuthMethodsSupported
		);
		return {
			clientId: explicitClientId,
			...(clientSecret !== undefined ? { clientSecret } : {}),
			authMethod,
			mode: 'pre-registered',
		};
	}

	if (asMetadata.clientIdMetadataDocumentSupported === true) {
		if (clientSecret !== undefined) {
			throw new OAuthFlowError(
				'OAUTH_CLIENT_AUTH_INVALID',
				'A client secret was supplied without --client-id or AFD_OAUTH_CLIENT_ID.',
				'Provide the pre-registered --client-id that owns the secret.'
			);
		}
		return {
			clientId: DEFAULT_CLI_CLIENT_METADATA_URL,
			authMethod: pickTokenAuthMethod(false, asMetadata.tokenEndpointAuthMethodsSupported),
			mode: 'cimd',
		};
	}

	throw new OAuthFlowError(
		'OAUTH_CLIENT_ID_REQUIRED',
		'No OAuth client ID is configured and the authorization server does not advertise Client ID Metadata Document support.',
		`Pass --client-id <id> (or set ${OAUTH_CLIENT_ID_ENV}) with a pre-registered client ID or CIMD HTTPS URL.`
	);
}

const HTML_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	'Cache-Control': 'no-store',
	'Content-Security-Policy': "default-src 'none'",
	'X-Content-Type-Options': 'nosniff',
	Connection: 'close',
} as const;

const SUCCESS_HTML =
	'<!doctype html><html><head><meta charset="utf-8"><title>AFD CLI Authorized</title></head><body><h1>Authorization complete</h1><p>You can close this tab and return to your terminal.</p></body></html>';
const DENIED_HTML =
	'<!doctype html><html><head><meta charset="utf-8"><title>AFD CLI Authorization Denied</title></head><body><h1>Authorization failed</h1><p>The authorization was denied or cancelled. Return to your terminal for details.</p></body></html>';
const INVALID_HTML =
	'<!doctype html><html><head><meta charset="utf-8"><title>Invalid OAuth Callback</title></head><body><h1>Invalid callback</h1><p>This request was rejected.</p></body></html>';

export interface LoopbackCallbackServer {
	readonly redirectUri: string;
	readonly port: number;
	waitForCode(): Promise<{ code: string }>;
	close(): Promise<void>;
}

/**
 * Start a loopback `127.0.0.1` HTTP server waiting for one OAuth authorization callback (M9.3).
 */
export async function startLoopbackCallbackServer(options: {
	port?: number;
	expectedState: string;
	expectedIssuer: string;
	requireIssuer: boolean;
	timeoutMs?: number;
	signal?: AbortSignal;
}): Promise<LoopbackCallbackServer> {
	const requestedPort = options.port ?? 0;
	if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
		throw new OAuthFlowError(
			'OAUTH_INVALID_PORT',
			`Invalid loopback redirect port: ${String(options.port)}.`,
			'Use a port between 1 and 65535, or omit --redirect-port for an ephemeral port.'
		);
	}

	let resolveCode!: (result: { code: string }) => void;
	let rejectCode!: (error: Error) => void;
	let settled = false;
	let invalidCount = 0;
	const sockets = new Set<Socket>();

	const codePromise = new Promise<{ code: string }>((resolve, reject) => {
		resolveCode = resolve;
		rejectCode = reject;
	});
	// Prevent Node unhandled-rejection crashes if a callback error arrives before waitForCode() is awaited.
	codePromise.catch(() => undefined);

	const finishOk = (code: string) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', onAbort);
		resolveCode({ code });
	};

	const finishErr = (error: Error) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', onAbort);
		rejectCode(error);
	};

	const sendHtml = (res: ServerResponse, status: number, html: string, onFlushed?: () => void) => {
		res.writeHead(status, HTML_HEADERS);
		if (onFlushed) {
			res.end(html, onFlushed);
		} else {
			res.end(html);
		}
	};

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.method !== 'GET') {
			res.writeHead(405, { ...HTML_HEADERS, Allow: 'GET' });
			res.end(INVALID_HTML);
			return;
		}
		let url: URL;
		try {
			url = new URL(req.url ?? '/', 'http://127.0.0.1');
		} catch {
			sendHtml(res, 400, INVALID_HTML);
			return;
		}
		if (url.pathname !== '/callback') {
			sendHtml(res, 404, INVALID_HTML);
			return;
		}

		const state = url.searchParams.get('state') ?? '';
		if (!safeEqual(state, options.expectedState)) {
			invalidCount += 1;
			const tooMany = invalidCount >= MAX_INVALID_CALLBACKS;
			sendHtml(res, 400, INVALID_HTML, () => {
				if (tooMany) {
					finishErr(
						new OAuthFlowError(
							'OAUTH_STATE_MISMATCH',
							'Too many OAuth callbacks with a missing or mismatched state parameter.',
							'Restart "afd auth login" and complete the authorization flow in your browser.'
						)
					);
				}
			});
			return;
		}

		// RFC 9207: verify iss whenever required or present, BEFORE processing either error or code.
		const iss = url.searchParams.get('iss');
		if (options.requireIssuer && iss === null) {
			sendHtml(res, 400, INVALID_HTML, () => {
				finishErr(
					new OAuthFlowError(
						'OAUTH_ISSUER_MISMATCH',
						'Authorization callback omitted the required "iss" parameter (RFC 9207).',
						'Verify the authorization server configuration and retry.'
					)
				);
			});
			return;
		}
		if (iss !== null && iss !== options.expectedIssuer) {
			sendHtml(res, 400, INVALID_HTML, () => {
				finishErr(
					new OAuthFlowError(
						'OAUTH_ISSUER_MISMATCH',
						'Authorization callback "iss" did not match the expected issuer (RFC 9207).',
						'Aborting to prevent an OAuth mix-up attack; verify the server URL.'
					)
				);
			});
			return;
		}

		const rawOAuthError = url.searchParams.get('error');
		if (rawOAuthError !== null && rawOAuthError !== '') {
			const oauthError = sanitizeOAuthErrorCode(rawOAuthError);
			sendHtml(res, 200, DENIED_HTML, () => {
				finishErr(
					new OAuthFlowError(
						'OAUTH_AUTHORIZATION_DENIED',
						`Authorization server returned error "${oauthError}".`,
						'Approve the consent prompt in your browser or check the requested scopes.',
						oauthError
					)
				);
			});
			return;
		}

		const code = url.searchParams.get('code');
		if (!code) {
			sendHtml(res, 400, INVALID_HTML, () => {
				finishErr(
					new OAuthFlowError(
						'OAUTH_MISSING_CODE',
						'Authorization callback did not include an authorization code.',
						'Retry "afd auth login".'
					)
				);
			});
			return;
		}

		sendHtml(res, 200, SUCCESS_HTML, () => {
			finishOk(code);
		});
	});

	server.on('connection', (socket) => {
		sockets.add(socket);
		socket.once('close', () => sockets.delete(socket));
	});

	const timeoutMs = options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
	const timer = setTimeout(() => {
		finishErr(
			new OAuthFlowError(
				'OAUTH_LOGIN_TIMEOUT',
				`Timed out waiting for the browser authorization callback after ${timeoutMs}ms.`,
				'Run "afd auth login" again and complete sign-in in your browser.'
			)
		);
	}, timeoutMs);
	timer.unref();

	const onAbort = () => {
		finishErr(
			new OAuthFlowError(
				'OAUTH_LOGIN_CANCELLED',
				'OAuth authorization was cancelled.',
				'Run "afd auth login" when you are ready to sign in.'
			)
		);
	};
	if (options.signal?.aborted) {
		onAbort();
	} else {
		options.signal?.addEventListener('abort', onAbort, { once: true });
	}

	await new Promise<void>((resolve, reject) => {
		server.once('error', (error) => {
			clearTimeout(timer);
			options.signal?.removeEventListener('abort', onAbort);
			reject(
				new OAuthFlowError(
					'OAUTH_LOOPBACK_BIND_FAILED',
					`Could not bind loopback callback listener on 127.0.0.1:${requestedPort}: ${error.message}`,
					'Choose a free port with --redirect-port or omit it to use an ephemeral port.'
				)
			);
		});
		server.listen(requestedPort, '127.0.0.1', () => resolve());
	});

	const boundPort = (server.address() as AddressInfo).port;
	const redirectUri = `http://127.0.0.1:${boundPort}/callback`;

	const close = async (): Promise<void> => {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', onAbort);
		for (const socket of sockets) socket.destroy();
		sockets.clear();
		await new Promise<void>((resolve) => {
			if (!server.listening) {
				resolve();
				return;
			}
			server.close(() => resolve());
		});
	};

	return {
		redirectUri,
		port: boundPort,
		waitForCode: () => codePromise,
		close,
	};
}

function buildTokenRequestHeadersAndBody(
	params: Record<string, string>,
	client: { clientId: string; clientSecret?: string; authMethod: TokenAuthMethod }
): { headers: Record<string, string>; body: string } {
	const form = new URLSearchParams(params);
	const headers: Record<string, string> = {
		'Content-Type': 'application/x-www-form-urlencoded',
		Accept: 'application/json',
		'Cache-Control': 'no-store',
	};
	if (client.authMethod === 'client_secret_basic') {
		if (!client.clientSecret) {
			throw new OAuthFlowError(
				'OAUTH_CLIENT_SECRET_REQUIRED',
				'This OAuth client requires a client secret for token requests.',
				`Set ${OAUTH_CLIENT_SECRET_ENV} or pass --client-secret-file <path>.`
			);
		}
		// RFC 6749 §2.3.1: URL-encode client_id and client_secret before base64.
		const encoded = Buffer.from(
			`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`,
			'utf8'
		).toString('base64');
		headers.Authorization = `Basic ${encoded}`;
	} else if (client.authMethod === 'client_secret_post') {
		if (!client.clientSecret) {
			throw new OAuthFlowError(
				'OAUTH_CLIENT_SECRET_REQUIRED',
				'This OAuth client requires a client secret for token requests.',
				`Set ${OAUTH_CLIENT_SECRET_ENV} or pass --client-secret-file <path>.`
			);
		}
		form.set('client_id', client.clientId);
		form.set('client_secret', client.clientSecret);
	} else {
		form.set('client_id', client.clientId);
	}
	return { headers, body: form.toString() };
}

async function postTokenRequest(
	tokenEndpoint: string,
	params: Record<string, string>,
	client: { clientId: string; clientSecret?: string; authMethod: TokenAuthMethod },
	options: {
		fetchFn?: typeof fetch;
		timeoutMs?: number;
		now?: () => number;
		secrets?: readonly (string | undefined)[];
	} = {}
): Promise<ValidatedTokenSet> {
	const { headers, body } = buildTokenRequestHeadersAndBody(params, client);
	const secrets = [
		client.clientSecret,
		params.code,
		params.code_verifier,
		params.refresh_token,
		...(options.secrets ?? []),
	];
	const res = await fetchOAuthRaw(
		tokenEndpoint,
		{ method: 'POST', headers, body },
		{ fetchFn: options.fetchFn, timeoutMs: options.timeoutMs, secrets }
	);

	let parsed: unknown;
	try {
		parsed = JSON.parse(res.text);
	} catch {
		if (res.status !== 200) {
			throw new OAuthFlowError(
				'OAUTH_TOKEN_ERROR',
				`Token endpoint returned HTTP ${res.status}.`,
				'Verify client registration and retry "afd auth login".'
			);
		}
		throw new OAuthFlowError(
			'OAUTH_TOKEN_INVALID',
			'Token endpoint returned non-JSON body.',
			'Verify the authorization server token endpoint.'
		);
	}

	if (res.status !== 200) {
		const record =
			typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
		const hasErrorField = typeof record.error === 'string' && record.error.trim().length > 0;
		const oauthError = hasErrorField ? sanitizeOAuthErrorCode(record.error, secrets) : undefined;
		const message = oauthError
			? `Token endpoint refused request with "${oauthError}" (HTTP ${res.status}).`
			: `Token endpoint returned HTTP ${res.status}.`;
		throw new OAuthFlowError(
			'OAUTH_TOKEN_ERROR',
			message,
			'Run "afd auth login" to obtain a new token.',
			oauthError
		);
	}

	try {
		return validateTokenResponse(parsed, (options.now ?? (() => Math.floor(Date.now() / 1000)))());
	} catch (error) {
		throw new OAuthFlowError(
			'OAUTH_TOKEN_INVALID',
			redactSecrets(error instanceof Error ? error.message : String(error), secrets),
			'Verify the authorization server issues OAuth 2.1 Bearer tokens.'
		);
	}
}

/** Exchange an authorization code for access (and optional refresh) tokens (M9.3). */
export async function exchangeAuthorizationCode(options: {
	tokenEndpoint: string;
	code: string;
	redirectUri: string;
	codeVerifier: string;
	resource: string;
	client: { clientId: string; clientSecret?: string; authMethod: TokenAuthMethod };
	fetchFn?: typeof fetch;
	timeoutMs?: number;
	now?: () => number;
}): Promise<ValidatedTokenSet> {
	return postTokenRequest(
		options.tokenEndpoint,
		{
			grant_type: 'authorization_code',
			code: options.code,
			redirect_uri: options.redirectUri,
			code_verifier: options.codeVerifier,
			resource: options.resource,
		},
		options.client,
		{ fetchFn: options.fetchFn, timeoutMs: options.timeoutMs, now: options.now }
	);
}

/** Refresh an access token using a stored refresh token (M9.4). */
export async function refreshAccessToken(options: {
	tokenEndpoint: string;
	refreshToken: string;
	resource: string;
	client: { clientId: string; clientSecret?: string; authMethod: TokenAuthMethod };
	fetchFn?: typeof fetch;
	timeoutMs?: number;
	now?: () => number;
}): Promise<ValidatedTokenSet> {
	return postTokenRequest(
		options.tokenEndpoint,
		{
			grant_type: 'refresh_token',
			refresh_token: options.refreshToken,
			resource: options.resource,
		},
		options.client,
		{ fetchFn: options.fetchFn, timeoutMs: options.timeoutMs, now: options.now }
	);
}

/**
 * Open `url` in the system browser without shell interpolation.
 * Returns `false` if launching fails; callers always print the URL as a fallback.
 */
export async function openBrowser(url: string): Promise<boolean> {
	const parsed = new URL(url);
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
	const safeUrl = parsed.toString();

	return new Promise<boolean>((resolve) => {
		let command: string;
		let args: string[];
		let env: NodeJS.ProcessEnv = process.env;

		if (process.platform === 'darwin') {
			command = 'open';
			args = [safeUrl];
		} else if (process.platform === 'win32') {
			const root = process.env.SystemRoot;
			command = root
				? join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
				: 'powershell.exe';
			args = [
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				'Start-Process -FilePath $env:AFD_OPEN_URL',
			];
			env = { ...process.env, AFD_OPEN_URL: safeUrl };
		} else {
			command = 'xdg-open';
			args = [safeUrl];
		}

		execFile(command, args, { env, timeout: 10_000, windowsHide: true }, (error) => {
			resolve(!error);
		});
	});
}

/** Run the full OAuth 2.1 authorization code + PKCE (S256) login flow and persist tokens (M9). */
export async function loginWithOAuth(options: OAuthLoginOptions): Promise<OAuthLoginResult> {
	const discovery = await discoverOAuthMetadata(options.serverUrl, {
		issuer: options.issuer,
		challenge: options.challenge,
		fetchFn: options.fetchFn,
		timeoutMs: options.timeoutMs,
	});
	const registration = resolveClientRegistration(discovery.asMetadata, {
		clientId: options.clientId,
		clientSecret: options.clientSecret,
		clientSecretFile: options.clientSecretFile,
		issuer: options.issuer,
		env: options.env,
	});

	const pkce = generatePkcePair();
	const state = generateOAuthState();
	let scope: string | undefined;
	try {
		scope = resolveRequestedScope({
			explicitScope: options.scope,
			challengeScope: discovery.challenge?.scope,
			resourceScopes: discovery.resourceMetadata.scopesSupported,
			asScopes: discovery.asMetadata.scopesSupported,
			offline: options.offline,
		});
	} catch (error) {
		throw new OAuthFlowError(
			'OAUTH_INVALID_SCOPE',
			error instanceof Error ? error.message : String(error),
			'Pass space-separated RFC 6749 scope tokens with --scope.'
		);
	}

	const callbackServer = await startLoopbackCallbackServer({
		port: options.redirectPort,
		expectedState: state,
		expectedIssuer: discovery.asMetadata.issuer,
		requireIssuer: discovery.asMetadata.authorizationResponseIssParameterSupported === true,
		timeoutMs: options.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS,
		signal: options.signal,
	});

	let code: string;
	let browserOpened = false;
	const redirectUri = callbackServer.redirectUri;
	try {
		const authUrl = new URL(discovery.asMetadata.authorizationEndpoint);
		authUrl.searchParams.set('response_type', 'code');
		authUrl.searchParams.set('client_id', registration.clientId);
		authUrl.searchParams.set('redirect_uri', redirectUri);
		authUrl.searchParams.set('code_challenge', pkce.challenge);
		authUrl.searchParams.set('code_challenge_method', pkce.method);
		authUrl.searchParams.set('state', state);
		authUrl.searchParams.set('resource', discovery.resource);
		if (scope) authUrl.searchParams.set('scope', scope);

		const authUrlString = authUrl.toString();
		await options.onAuthorizationUrl?.(authUrlString);

		if (!options.noBrowser) {
			const opener = options.openUrl ?? openBrowser;
			browserOpened = await opener(authUrlString).catch(() => false);
		}

		({ code } = await callbackServer.waitForCode());
	} finally {
		// Close loopback listener immediately after receiving the callback (M9.3), before token exchange.
		await callbackServer.close();
	}

	const tokenSet = await exchangeAuthorizationCode({
		tokenEndpoint: discovery.asMetadata.tokenEndpoint,
		code,
		redirectUri,
		codeVerifier: pkce.verifier,
		resource: discovery.resource,
		client: {
			clientId: registration.clientId,
			clientSecret: registration.clientSecret,
			authMethod: registration.authMethod,
		},
		fetchFn: options.fetchFn,
		timeoutMs: options.timeoutMs,
		now: options.now,
	});

	const updatedAt = new Date().toISOString();
	const entry: StoredOAuthToken = {
		resource: discovery.resource,
		issuer: discovery.asMetadata.issuer,
		tokenEndpoint: discovery.asMetadata.tokenEndpoint,
		clientId: registration.clientId,
		clientAuthMethod: registration.authMethod,
		accessToken: tokenSet.accessToken,
		...(tokenSet.refreshToken ? { refreshToken: tokenSet.refreshToken } : {}),
		...(tokenSet.expiresAt !== undefined ? { expiresAt: tokenSet.expiresAt } : {}),
		...((tokenSet.scope ?? scope) ? { scope: tokenSet.scope ?? scope } : {}),
		updatedAt,
	};
	saveStoredToken(entry, options.storePath ?? getTokenStorePath());

	return {
		summary: {
			resource: entry.resource,
			issuer: entry.issuer,
			clientId: entry.clientId,
			clientAuthMethod: entry.clientAuthMethod,
			...(entry.scope !== undefined ? { scope: entry.scope } : {}),
			...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
			hasRefreshToken: Boolean(entry.refreshToken),
			updatedAt: entry.updatedAt,
		},
		registrationMode: registration.mode,
		browserOpened,
	};
}

/**
 * Return a valid Bearer token for `serverUrl` from the separate token store, automatically
 * refreshing it when expired/expiring or when `forceRefresh` is requested (M9.4).
 *
 * Serializes refresh across processes via the store lockfile, reuses a token already rotated by a
 * concurrent process, enforces issuer binding for confidential clients, and conditionally clears
 * permanent refresh failures only when the stored refresh token still matches.
 *
 * Returns `undefined` when no OAuth token is stored for `serverUrl`.
 */
export async function resolveOAuthBearerToken(
	serverUrl: string,
	options: ResolveTokenOptions = {}
): Promise<ResolvedOAuthToken | undefined> {
	const storePath = options.storePath ?? getTokenStorePath();
	const initialEntry = getStoredToken(serverUrl, storePath);
	if (!initialEntry) return undefined;

	const nowFn = options.now ?? (() => Math.floor(Date.now() / 1000));
	const skewSeconds = options.skewSeconds ?? EXPIRY_SKEW_SECONDS;
	const initialNow = nowFn();

	if (
		options.forceRefresh !== true &&
		!isTokenExpiring(initialEntry.expiresAt, initialNow, skewSeconds)
	) {
		return { token: initialEntry.accessToken, entry: initialEntry, refreshed: false };
	}

	return withTokenStoreLockAsync(storePath, async () => {
		const entry = getStoredToken(serverUrl, storePath);
		if (!entry) return undefined;

		const nowSeconds = nowFn();
		// If another process already rotated this token while we waited for the lock, reuse it.
		if (
			entry.accessToken !== initialEntry.accessToken &&
			!isTokenExpiring(entry.expiresAt, nowSeconds, skewSeconds)
		) {
			return { token: entry.accessToken, entry, refreshed: true };
		}
		if (
			options.forceRefresh !== true &&
			!isTokenExpiring(entry.expiresAt, nowSeconds, skewSeconds)
		) {
			return { token: entry.accessToken, entry, refreshed: false };
		}

		if (!entry.refreshToken) {
			throw new OAuthFlowError(
				'OAUTH_TOKEN_EXPIRED',
				`Stored OAuth token for ${redactUrl(entry.resource)} has expired and has no refresh token.`,
				`Run "afd auth login ${redactUrl(entry.resource)}" to sign in again.`
			);
		}

		try {
			const allowLoopbackHttp = isLoopbackHttpUrl(entry.resource);
			assertAllowedOAuthUrl('token_endpoint', entry.tokenEndpoint, allowLoopbackHttp, {
				allowQuery: false,
			});
		} catch (error) {
			throw new OAuthFlowError(
				'OAUTH_INVALID_URL',
				error instanceof Error ? error.message : String(error),
				`Re-authenticate with "afd auth login ${redactUrl(entry.resource)}".`
			);
		}

		let clientSecret: string | undefined;
		if (entry.clientAuthMethod !== 'none') {
			assertConfidentialIssuerBinding(entry.issuer, {
				issuer: options.issuer,
				env: options.env,
			});
			clientSecret = resolveClientSecret({
				clientSecret: options.clientSecret,
				clientSecretFile: options.clientSecretFile,
				env: options.env,
			});
		}

		try {
			const refreshed = await refreshAccessToken({
				tokenEndpoint: entry.tokenEndpoint,
				refreshToken: entry.refreshToken,
				resource: entry.resource,
				client: {
					clientId: entry.clientId,
					clientSecret,
					authMethod: entry.clientAuthMethod,
				},
				fetchFn: options.fetchFn,
				timeoutMs: options.timeoutMs,
				now: () => nowSeconds,
			});

			const updated: StoredOAuthToken = {
				...entry,
				accessToken: refreshed.accessToken,
				// Preserve previous refresh token if the AS did not rotate it (RFC 6749 §6).
				refreshToken: refreshed.refreshToken ?? entry.refreshToken,
				expiresAt: refreshed.expiresAt,
				scope: refreshed.scope ?? entry.scope,
				updatedAt: new Date().toISOString(),
			};
			saveStoredTokenUnlocked(updated, storePath);
			return { token: updated.accessToken, entry: updated, refreshed: true };
		} catch (error) {
			if (
				error instanceof OAuthFlowError &&
				error.oauthErrorCode &&
				PERMANENT_REFRESH_ERRORS.has(error.oauthErrorCode)
			) {
				deleteStoredTokenIfRefreshMatchesUnlocked(entry.resource, entry.refreshToken, storePath);
				throw new OAuthFlowError(
					'OAUTH_REFRESH_FAILED',
					`Stored OAuth session for ${redactUrl(entry.resource)} is no longer valid (${error.oauthErrorCode}) and was cleared.`,
					`Run "afd auth login ${redactUrl(entry.resource)}" to sign in again.`,
					error.oauthErrorCode
				);
			}
			throw error;
		}
	});
}
