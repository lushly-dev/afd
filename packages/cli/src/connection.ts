/**
 * @fileoverview Shared CLI connection resolution
 */

import { createClient, type McpClient } from '@lushly-dev/afd-client';
import { type CliTransport, getConfig } from './config.js';
import { HEADERS_ENV, redactUrl, resolveHeaders } from './credentials.js';
import { printError, printInfo } from './output.js';

let activeClient: McpClient | null = null;

/** Get the active in-process client. */
export function getClient(): McpClient | null {
	return activeClient;
}

/** Replace the active in-process client. */
export function setClient(client: McpClient | null): void {
	activeClient = client;
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
	await client?.disconnect().catch(() => undefined);
}

/** Settings for one client. Headers are never persisted. */
export interface ClientSettings {
	url: string;
	transport: CliTransport;
	timeout: number;
	autoReconnect: boolean;
	headers?: Record<string, string>;
}

/** Create a client; request headers are passed only when there are any. */
export function createCliClient(settings: ClientSettings): McpClient {
	const { headers, ...rest } = settings;
	return createClient(headers && Object.keys(headers).length > 0 ? { ...rest, headers } : rest);
}

/** Default transport for a URL: SSE for a `/sse` endpoint, HTTP otherwise. */
export function inferTransport(url: string): CliTransport {
	try {
		return /\/sse\/?$/.test(new URL(url).pathname) ? 'sse' : 'http';
	} catch {
		return 'http';
	}
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
}

/**
 * Outcome of {@link tryConnect}: a client, or why there is none. Without a
 * client, `url` is absent when no server is configured, and `error` says why
 * connecting to `url` failed.
 */
export type ConnectionAttempt =
	| { client: McpClient }
	| { client: null; url?: string; error?: Error };

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

	if (active?.isConnected() && (!options.url || options.url === activeUrl)) {
		return { client: active };
	}

	const config = getConfig();
	const url = options.url ?? config.serverUrl;
	if (!url) return { client: null };

	const client = createCliClient({
		url,
		transport: options.transport ?? (options.url ? 'http' : (config.transport ?? 'http')),
		timeout: options.timeout ?? config.timeout ?? 30000,
		autoReconnect: false,
		headers: options.headers,
	});

	try {
		await client.connect();
		// Close the replaced client so its stream cannot keep the process alive.
		await active?.disconnect().catch(() => undefined);
		setClient(client);
		return { client };
	} catch (error) {
		await client.disconnect().catch(() => undefined);
		return { client: null, url, error: error instanceof Error ? error : new Error(String(error)) };
	}
}

/** {@link tryConnect}, returning `null` instead of the reason for failing. */
export async function ensureConnected(options: ConnectionOptions = {}): Promise<McpClient | null> {
	return (await tryConnect(options)).client;
}

/**
 * Request headers from `AFD_HEADERS` and `--header` flags. Prints the problem
 * and exits with code 1 when a header is malformed.
 */
export function headersOrExit(flags: readonly string[] | undefined): Record<string, string> {
	try {
		return resolveHeaders(flags);
	} catch (error) {
		printError(error instanceof Error ? error.message : String(error));
		return process.exit(1);
	}
}

/** Commander options shared by commands that connect to a server. */
export interface ConnectFlags {
	/** `-H, --header` values. */
	header?: string[];
}

/**
 * Connect for a one-shot command, or print why that is impossible and exit
 * with code 1.
 */
export async function requireClient(
	flags: ConnectFlags,
	options: Omit<ConnectionOptions, 'headers'> = {}
): Promise<McpClient> {
	const attempt = await tryConnect({ ...options, headers: headersOrExit(flags.header) });
	if (attempt.client) return attempt.client;

	if (attempt.url === undefined) {
		printError('Not connected. Run "afd connect <url>" first.');
	} else {
		printError(`Could not connect to ${redactUrl(attempt.url)}`, attempt.error);
		printInfo(
			`If the server requires authentication, pass --header "Name: value" or set ${HEADERS_ENV}.`
		);
	}
	return process.exit(1);
}
