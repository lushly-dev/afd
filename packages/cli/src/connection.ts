/**
 * @fileoverview Shared CLI connection resolution
 */

import {
	createClient,
	type ElicitationHandler,
	HttpStatusError,
	JsonRpcResponseError,
	type McpClient,
	NotConnectedError,
	type RequestOptions,
	RequestTimeoutError,
	SessionLimitError,
} from '@lushly-dev/afd-client';
import {
	type CommandError,
	type CommandResult,
	ErrorCodes,
	failure,
	type McpToolCallResult,
	success,
} from '@lushly-dev/afd-core';
import { type CliTransport, getConfig } from './config.js';
import { HEADERS_ENV, hasAuthorizationHeader, redactUrl, resolveHeaders } from './credentials.js';
import { interactiveElicitation } from './elicitation.js';
import { OAuthFlowError, resolveOAuthBearerToken } from './oauth-client.js';
import { printError, printInfo } from './output.js';
import { getStoredToken, tryDefaultTokenStorePath } from './token-store.js';

interface ActiveClientAuthContext {
	url: string;
	transport: CliTransport;
	timeout: number;
	autoReconnect: boolean;
	headers?: Record<string, string>;
	onElicitation?: ElicitationHandler;
	storePath?: string;
	usedOAuth: boolean;
	hasRefreshToken: boolean;
}

let activeClient: McpClient | null = null;
let activeClientAuth: ActiveClientAuthContext | null = null;

/** Get the active in-process client. */
export function getClient(): McpClient | null {
	return activeClient;
}

/** Replace the active in-process client. */
export function setClient(client: McpClient | null): void {
	activeClient = client;
	if (!client) {
		activeClientAuth = null;
	}
}

/**
 * Disconnect and forget the active client.
 *
 * The CLI entry point calls this after every command: an open SSE stream (or a
 * pending reconnect) would otherwise keep the process alive after the result
 * has been printed.
 */
export async function closeClient(): Promise<void> {
	const client = activeClient;
	activeClient = null;
	activeClientAuth = null;
	await client?.disconnect().catch(() => undefined);
}

/** Settings for one client. Headers are never persisted. */
export interface ClientSettings {
	url: string;
	transport: CliTransport;
	timeout: number;
	autoReconnect: boolean;
	headers?: Record<string, string>;
	/** Answers server elicitations (confirmations). */
	onElicitation?: ElicitationHandler;
}

/** Create a client; request headers are passed only when there are any. */
export function createCliClient(settings: ClientSettings): McpClient {
	const { headers, onElicitation, ...rest } = settings;
	return createClient({
		...rest,
		...(headers && Object.keys(headers).length > 0 && { headers }),
		...(onElicitation && { onElicitation }),
	});
}

/**
 * Default transport for a URL: the deprecated `sse` and `http` transports for an AFD server's
 * `/sse` and `/message` endpoints, MCP Streamable HTTP for anything else (such as `/mcp`).
 */
export function inferTransport(url: string): CliTransport {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return 'streamable-http';
	}
	if (/\/sse\/?$/.test(pathname)) return 'sse';
	if (/\/messages?\/?$/.test(pathname)) return 'http';
	return 'streamable-http';
}

export interface ConnectionOptions {
	/** Use this URL for only the current command. */
	url?: string;
	/** Override the configured transport for this connection. */
	transport?: CliTransport;
	/** Override the configured timeout for this connection. */
	timeout?: number;
	/** Request headers for this connection (from `--header` and `AFD_HEADERS`). */
	headers?: Record<string, string>;
	/**
	 * Whether this command dispatches requests to a derived sibling route (such as `afd stream`
	 * posting to `/stream/<command>`) instead of the exact RFC 8707 MCP resource URL.
	 */
	derivedRoute?: boolean;
}

/**
 * Outcome of {@link tryConnect}: a client, or why there is none. Without a
 * client, `url` is absent when no server is configured, and `error` says why
 * connecting to `url` failed.
 */
export type ConnectionAttempt =
	| { client: McpClient }
	| { client: null; url?: string; error?: Error };

/** Whether an error from connecting or calling an MCP server represents HTTP 401 Unauthorized. */
export function isUnauthorizedError(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const record = error as {
		status?: unknown;
		code?: unknown;
		name?: unknown;
		message?: unknown;
		cause?: unknown;
	};
	if (record.status === 401 || record.code === 401) return true;
	if (record.name === 'UnauthorizedError') return true;
	if (typeof record.message === 'string' && /\b401\b|unauthorized/i.test(record.message)) {
		return true;
	}
	return record.cause !== undefined && record.cause !== error && isUnauthorizedError(record.cause);
}

/** Resolved headers for a connection, including whether an OAuth token was attached. */
export interface ResolvedConnectionAuth {
	headers?: Record<string, string>;
	usedOAuth: boolean;
	hasRefreshToken: boolean;
}

/**
 * Merge explicit request headers (`--header` / `AFD_HEADERS`) with a stored OAuth bearer token
 * for `url` when no explicit `Authorization` header was supplied (`spec/authorization.md`, M9.4).
 *
 * Refuses to attach a stored OAuth token automatically to derived sibling routes (`afd stream`
 * targeting `/stream/<command>`, or legacy `http`/`sse` transports probing `/health` or secondary
 * endpoints) so an RFC 8707 resource-bound token never leaves its bound endpoint unintentionally.
 */
export async function resolveConnectionAuth(
	url: string,
	explicitHeaders?: Record<string, string>,
	options: {
		forceRefresh?: boolean;
		storePath?: string;
		transport?: CliTransport;
		derivedRoute?: boolean;
	} = {}
): Promise<ResolvedConnectionAuth> {
	const baseHeaders = explicitHeaders ?? {};
	if (hasAuthorizationHeader(baseHeaders)) {
		return {
			headers: explicitHeaders,
			usedOAuth: false,
			hasRefreshToken: false,
		};
	}

	const storePath = options.storePath ?? tryDefaultTokenStorePath();
	if (!storePath) {
		return {
			headers: explicitHeaders,
			usedOAuth: false,
			hasRefreshToken: false,
		};
	}

	const isDerivedTarget =
		options.derivedRoute === true ||
		(options.transport !== undefined && options.transport !== 'streamable-http');
	if (isDerivedTarget) {
		const existing = getStoredToken(url, storePath);
		if (existing) {
			throw new OAuthFlowError(
				'OAUTH_DERIVED_ROUTE_REFUSED',
				`Refused to send the stored OAuth token for ${redactUrl(existing.resource)} to a derived route (${options.derivedRoute ? '/stream/<command>' : `${options.transport} transport`}).`,
				'OAuth tokens are bound to the exact Streamable HTTP MCP resource URL. Use Streamable HTTP, or pass an explicit --header "Authorization: Bearer ..." if you trust that route.'
			);
		}
		return {
			headers: explicitHeaders,
			usedOAuth: false,
			hasRefreshToken: false,
		};
	}

	const resolved = await resolveOAuthBearerToken(url, {
		storePath,
		forceRefresh: options.forceRefresh,
	});
	if (!resolved) {
		return {
			headers: explicitHeaders,
			usedOAuth: false,
			hasRefreshToken: false,
		};
	}

	return {
		headers: { ...baseHeaders, Authorization: `Bearer ${resolved.token}` },
		usedOAuth: true,
		hasRefreshToken: Boolean(resolved.entry.refreshToken),
	};
}

/**
 * Connect an MCP client using explicit headers or stored OAuth tokens, refreshing once on an
 * initial HTTP 401 when a stored refresh token is available.
 */
export async function connectWithAuth(
	settings: Omit<ClientSettings, 'headers'> & { headers?: Record<string, string> },
	authOptions: { storePath?: string; forceRefresh?: boolean; derivedRoute?: boolean } = {}
): Promise<{
	client: McpClient;
	initResult: Awaited<ReturnType<McpClient['connect']>>;
	usedOAuth: boolean;
	hasRefreshToken: boolean;
}> {
	let auth = await resolveConnectionAuth(settings.url, settings.headers, {
		...authOptions,
		transport: settings.transport,
	});
	let client = createCliClient({ ...settings, headers: auth.headers });
	try {
		const initResult = await client.connect();
		return {
			client,
			initResult,
			usedOAuth: auth.usedOAuth,
			hasRefreshToken: auth.hasRefreshToken,
		};
	} catch (error) {
		await client.disconnect().catch(() => undefined);
		if (
			authOptions.forceRefresh ||
			!auth.usedOAuth ||
			!auth.hasRefreshToken ||
			!isUnauthorizedError(error)
		) {
			throw error;
		}
		// One reactive refresh retry on 401 (never loops).
		auth = await resolveConnectionAuth(settings.url, settings.headers, {
			...authOptions,
			transport: settings.transport,
			forceRefresh: true,
		});
		client = createCliClient({ ...settings, headers: auth.headers });
		try {
			const initResult = await client.connect();
			return {
				client,
				initResult,
				usedOAuth: auth.usedOAuth,
				hasRefreshToken: auth.hasRefreshToken,
			};
		} catch (retryError) {
			await client.disconnect().catch(() => undefined);
			throw retryError;
		}
	}
}

/** Convert an `McpToolCallResult` returned by `client.callTool` into a `CommandResult`. */
function parseToolCallResult(result: McpToolCallResult): CommandResult {
	const text = result.content
		?.filter((item): item is { type: 'text'; text: string } => item.type === 'text')
		.map((item) => item.text)
		.join('\n');

	let parsed: unknown;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = undefined;
		}
	}
	if (
		typeof parsed === 'object' &&
		parsed !== null &&
		'success' in parsed &&
		typeof (parsed as { success?: unknown }).success === 'boolean'
	) {
		return parsed as CommandResult;
	}
	if (result.isError) {
		return failure({
			code: 'TOOL_ERROR',
			message: text || 'Tool execution failed',
			suggestion: 'Check the tool arguments and try again',
		});
	}
	if (parsed !== undefined) return success(parsed);
	return success(text ?? '');
}

function isReadOnlyListedTool(client: McpClient, name: string): boolean {
	const tools = typeof client.getTools === 'function' ? client.getTools() : [];
	const tool = tools.find((item) => item.name === name);
	if (!tool) return false;
	const meta = tool._meta as { mutation?: unknown; destructive?: unknown } | undefined;
	const annotations = tool.annotations as
		| { readOnlyHint?: unknown; destructiveHint?: unknown }
		| undefined;
	if (
		meta?.mutation === true ||
		meta?.destructive === true ||
		annotations?.destructiveHint === true ||
		annotations?.readOnlyHint === false
	) {
		return false;
	}
	return annotations?.readOnlyHint === true || meta?.mutation === false;
}

/** Preserve `McpClient.call()` error and `OUTCOME_UNKNOWN` classification on non-401 `callTool` throws. */
function mapCallToolError(client: McpClient, name: string, error: unknown): CommandResult {
	const readOnly = isReadOnlyListedTool(client, name);
	let cause: CommandError;
	let outcomeUnknown = true;

	if (error instanceof HttpStatusError) {
		const serverSide = error.status >= 500 || error.status === 429;
		outcomeUnknown = error.status < 400 || error.status >= 500;
		cause = {
			code: `HTTP_${error.status}`,
			message: error.message,
			suggestion: serverSide
				? 'The server is unavailable or overloaded; retry later'
				: 'The server refused the request; check authorization scopes and URL',
			retryable: serverSide,
		};
	} else if (error instanceof JsonRpcResponseError) {
		outcomeUnknown = error.code === -32603;
		const codeMap: Record<number, { code: string; retryable: boolean; suggestion: string }> = {
			[-32700]: {
				code: 'PARSE_ERROR',
				retryable: false,
				suggestion: 'The server could not parse the request as JSON',
			},
			[-32600]: {
				code: 'INVALID_REQUEST',
				retryable: false,
				suggestion: 'The server rejected the JSON-RPC envelope',
			},
			[-32601]: {
				code: 'METHOD_NOT_FOUND',
				retryable: false,
				suggestion: 'The server does not support this MCP method',
			},
			[-32602]: {
				code: ErrorCodes.INVALID_INPUT,
				retryable: false,
				suggestion: 'Correct the request parameters (tool name and arguments object) and try again',
			},
			[-32603]: {
				code: ErrorCodes.INTERNAL_ERROR,
				retryable: true,
				suggestion:
					'The server failed while handling the request; check server logs if it persists',
			},
			[-32000]: {
				code: 'REQUEST_REJECTED',
				retryable: false,
				suggestion: 'The server rejected the HTTP request; check URL and headers',
			},
			[-32001]: {
				code: 'SESSION_NOT_FOUND',
				retryable: true,
				suggestion: 'The MCP session is unknown or expired; reconnect to start a new session',
			},
			[-32021]: {
				code: 'MISSING_CLIENT_CAPABILITY',
				retryable: false,
				suggestion: 'Reconnect with the required client capability enabled',
			},
		};
		const mapped = codeMap[error.code];
		cause = {
			code: mapped?.code ?? 'JSON_RPC_ERROR',
			message: error.message || 'The server returned a JSON-RPC error',
			suggestion: mapped?.suggestion ?? 'Check the request against the server documentation',
			retryable: mapped?.retryable ?? false,
			details: { jsonRpcCode: error.code },
		};
	} else if (error instanceof SessionLimitError) {
		outcomeUnknown = false;
		cause = {
			code: error.code,
			message: error.message,
			suggestion: error.suggestion,
			retryable: true,
			...(error.retryAfterSeconds === undefined
				? {}
				: { details: { retryAfterSeconds: error.retryAfterSeconds } }),
		};
	} else if (error instanceof NotConnectedError) {
		outcomeUnknown = false;
		cause = {
			code: 'NOT_CONNECTED',
			message: 'The client is not connected',
			suggestion: 'Call connect() and try again',
			retryable: false,
		};
	} else if (error instanceof RequestTimeoutError) {
		outcomeUnknown = true;
		cause = {
			code: ErrorCodes.TIMEOUT,
			message: error.message,
			suggestion:
				'Retry with a larger timeout. The server may still have run the request, so check its effect before retrying a mutation.',
			retryable: true,
			details: { method: error.method, timeoutMs: error.timeoutMs },
		};
	} else {
		outcomeUnknown = true;
		const message = error instanceof Error ? error.message : String(error);
		cause = {
			code: ErrorCodes.CONNECTION_ERROR,
			message: message || 'The request failed',
			suggestion:
				'Check that the server is reachable and retry. The request may have reached the server, so check its effect before retrying a mutation.',
			retryable: true,
		};
	}

	if (outcomeUnknown && !readOnly) {
		return failure({
			code: 'OUTCOME_UNKNOWN',
			message: cause.message,
			suggestion:
				'The request may have run on the server before failing. Check its effect before retrying.',
			retryable: false,
			details: { cause },
		});
	}
	return failure(cause);
}

/**
 * Call a tool on `client` with a single reactive OAuth refresh retry on a real transport HTTP 401.
 *
 * Uses `client.callTool` when OAuth-backed with a refresh token so a real transport HTTP 401 throw
 * is cleanly distinguished from an application tool result whose own error code happens to be
 * `HTTP_401` (preventing false replay of mutations).
 */
export async function callWithOAuthRetry(
	client: McpClient,
	name: string,
	args: Record<string, unknown>,
	onReconnect?: (next: { client: McpClient; usedOAuth: boolean; hasRefreshToken: boolean }) => void,
	request?: RequestOptions
): Promise<CommandResult> {
	const authCtx = activeClient === client ? activeClientAuth : null;
	if (!authCtx?.usedOAuth || !authCtx.hasRefreshToken || typeof client.callTool !== 'function') {
		return request ? client.call(name, args, request) : client.call(name, args);
	}

	try {
		const raw = await (request
			? client.callTool(name, args, request)
			: client.callTool(name, args));
		return parseToolCallResult(raw);
	} catch (error) {
		if (!isUnauthorizedError(error)) {
			return mapCallToolError(client, name, error);
		}

		// Real transport HTTP 401 on tools/call: refresh once, reconnect, and retry ONCE.
		const previous = activeClient;
		const reconnected = await connectWithAuth(
			{
				url: authCtx.url,
				transport: authCtx.transport,
				timeout: authCtx.timeout,
				autoReconnect: authCtx.autoReconnect,
				headers: authCtx.headers,
				onElicitation: authCtx.onElicitation,
			},
			{ storePath: authCtx.storePath, forceRefresh: true }
		);
		await previous?.disconnect().catch(() => undefined);
		setClient(reconnected.client);
		activeClientAuth = {
			...authCtx,
			usedOAuth: reconnected.usedOAuth,
			hasRefreshToken: reconnected.hasRefreshToken,
		};
		onReconnect?.({
			client: reconnected.client,
			usedOAuth: reconnected.usedOAuth,
			hasRefreshToken: reconnected.hasRefreshToken,
		});
		// The same call again, its idempotency key included.
		return request
			? reconnected.client.call(name, args, request)
			: reconnected.client.call(name, args);
	}
}

/**
 * Return the live client or reconnect from explicit/configured connection details.
 * Explicit options are never persisted, so scenario tests do not replace the
 * user's default server.
 *
 * Clients created here serve one-shot commands, so they never auto-reconnect.
 */
export async function tryConnect(options: ConnectionOptions = {}): Promise<ConnectionAttempt> {
	const active = getClient();
	const activeUrl = active?.getStatus().url;

	if (
		active?.isConnected() &&
		(!options.url || options.url === activeUrl) &&
		!options.derivedRoute
	) {
		return { client: active };
	}

	const config = getConfig();
	const url = options.url ?? config.serverUrl;
	if (!url) return { client: null };

	const transport =
		options.transport ??
		(options.url ? inferTransport(url) : (config.transport ?? inferTransport(url)));
	const timeout = options.timeout ?? config.timeout ?? 30000;
	const onElicitation = interactiveElicitation();

	try {
		const { client, usedOAuth, hasRefreshToken } = await connectWithAuth(
			{
				url,
				transport,
				timeout,
				autoReconnect: false,
				headers: options.headers,
				// At a terminal, confirmations are asked; otherwise the server's error explains how to
				// acknowledge, which keeps scripts from hanging on a prompt.
				onElicitation,
			},
			{ derivedRoute: options.derivedRoute }
		);
		// Close the replaced client so its stream cannot keep the process alive.
		await active?.disconnect().catch(() => undefined);
		setClient(client);
		activeClientAuth = {
			url,
			transport,
			timeout,
			autoReconnect: false,
			headers: options.headers,
			onElicitation,
			usedOAuth,
			hasRefreshToken,
		};
		return { client };
	} catch (error) {
		return { client: null, url, error: error instanceof Error ? error : new Error(String(error)) };
	}
}

/** Record OAuth connection metadata for a client opened outside `tryConnect` (such as `afd shell`). */
export function setActiveClientAuth(context: ActiveClientAuthContext | null): void {
	activeClientAuth = context;
}

/**
 * Ensure we have a connected client, reconnecting from config if needed.
 * Returns null if no connection is configured or reconnection fails.
 */
export async function ensureConnected(options: ConnectionOptions = {}): Promise<McpClient | null> {
	const attempt = await tryConnect(options);
	return attempt.client;
}

/** Options accepted by every command that connects to a server. */
export interface ConnectFlags {
	header?: string[];
}

/**
 * Resolve `--header` and `AFD_HEADERS`, exiting with an error before any
 * connection is attempted if a header is malformed.
 */
export function headersOrExit(flags?: string[]): Record<string, string> {
	try {
		return resolveHeaders(flags);
	} catch (error) {
		printError(error instanceof Error ? error.message : String(error));
		return process.exit(1);
	}
}

/**
 * Connect with the command's `--header` and `AFD_HEADERS` headers, or print an
 * actionable error (with a redacted URL) and exit.
 */
export async function requireClient(
	flags: ConnectFlags,
	options: Omit<ConnectionOptions, 'headers'> = {}
): Promise<McpClient> {
	const headers = headersOrExit(flags.header);
	const attempt = await tryConnect({ ...options, headers });
	if (attempt.client) return attempt.client;

	if (attempt.url === undefined) {
		printError('Not connected. Run "afd connect <url>" first.');
	} else {
		printError(`Could not connect to ${redactUrl(attempt.url)}`, attempt.error);
		printInfo(
			`If the server requires authentication, run "afd auth login ${redactUrl(attempt.url)}", pass --header "Name: value", or set ${HEADERS_ENV}.`
		);
	}
	return process.exit(1);
}
