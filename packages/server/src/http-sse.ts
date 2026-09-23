/**
 * @fileoverview `/sse` connections: a concurrency cap, heartbeat comments and cleanup.
 */

import type { ServerResponse } from 'node:http';

/** Default maximum number of concurrent `/sse` connections. */
export const DEFAULT_MAX_SSE_CONNECTIONS = 100;

/** Default interval between SSE heartbeat comments (25 seconds). */
export const DEFAULT_SSE_HEARTBEAT_MS = 25_000;

export interface SseClient {
	id: string;
	response: ServerResponse;
}

export interface SseHubOptions {
	maxConnections?: number;
	heartbeatMs?: number;
}

/**
 * Track open `/sse` responses. One shared timer writes a `: ping` comment to every client so
 * proxies keep idle streams open and dead peers are detected; it runs only while clients exist.
 */
export function createSseHub(options: SseHubOptions = {}) {
	const maxConnections = options.maxConnections ?? DEFAULT_MAX_SSE_CONNECTIONS;
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
	if (!Number.isSafeInteger(maxConnections) || maxConnections <= 0) {
		throw new Error('maxSseConnections must be a positive integer');
	}
	if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) {
		throw new Error('SSE heartbeat interval must be positive');
	}
	const clients = new Map<string, SseClient>();
	let counter = 0;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	function stopHeartbeat(): void {
		if (heartbeat === undefined) return;
		clearInterval(heartbeat);
		heartbeat = undefined;
	}

	function remove(id: string): void {
		clients.delete(id);
		if (clients.size === 0) stopHeartbeat();
	}

	function beat(): void {
		for (const client of clients.values()) {
			const { response } = client;
			if (response.destroyed || response.writableEnded) remove(client.id);
			else response.write(': ping\n\n');
		}
	}

	return {
		clients,
		/** Whether another connection would exceed the cap. */
		isFull(): boolean {
			return clients.size >= maxConnections;
		},
		/** Register an SSE response whose headers were sent; it is removed when it closes. */
		add(response: ServerResponse): SseClient {
			const client = { id: `client-${++counter}`, response };
			clients.set(client.id, client);
			response.once('close', () => remove(client.id));
			if (heartbeat === undefined) {
				heartbeat = setInterval(beat, heartbeatMs);
				heartbeat.unref();
			}
			return client;
		},
		/** End every connection and stop the heartbeat. */
		closeAll(): void {
			for (const client of clients.values()) client.response.end();
			clients.clear();
			stopHeartbeat();
		},
	};
}
