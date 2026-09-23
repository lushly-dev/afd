/**
 * @fileoverview Shared CLI connection resolution
 */

import { createClient, type McpClient } from '@lushly-dev/afd-client';
import { getConfig } from './config.js';

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

export interface ConnectionOptions {
	/** Use this URL for only the current command. */
	url?: string;
	/** Override the configured transport for this connection. */
	transport?: 'sse' | 'http';
	/** Override the configured timeout for this connection. */
	timeout?: number;
}

/**
 * Return the live client or reconnect from explicit/configured connection details.
 * Explicit options are never persisted, so scenario tests do not replace the
 * user's default server.
 *
 * Clients created here serve one-shot commands, so they never auto-reconnect.
 */
export async function ensureConnected(options: ConnectionOptions = {}): Promise<McpClient | null> {
	const active = getClient();
	const activeUrl = active?.getStatus().url;

	if (active?.isConnected() && (!options.url || options.url === activeUrl)) {
		return active;
	}

	const config = getConfig();
	const url = options.url ?? config.serverUrl;
	if (!url) return null;

	const client = createClient({
		url,
		transport: options.transport ?? (options.url ? 'http' : (config.transport ?? 'http')),
		timeout: options.timeout ?? config.timeout ?? 30000,
		autoReconnect: false,
	});

	try {
		await client.connect();
		// Close the replaced client so its stream cannot keep the process alive.
		await active?.disconnect().catch(() => undefined);
		setClient(client);
		return client;
	} catch {
		await client.disconnect().catch(() => undefined);
		return null;
	}
}
